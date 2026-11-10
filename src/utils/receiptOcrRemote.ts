// receiptOcrRemote.ts —— 服务端 OCR 兜底（POST /ocr/lines）。
//
// 定位：只有本地 ML Kit 拿不准、且用户在「设置 → 扫票识别」里显式打开开关并粘贴共享密钥时才走这里。
// 它只做一件事：上传原图 → 把服务端返回的行还原成与本地同形的 OcrLine[]。
//
// 四条硬约束（改之前先读）：
// 1) 超时 6s：兜底不许把用户卡住（离线时 fetch 一般 1–2s 就自己报错，不会真等满 6s）；
// 2) 失败即熔断：一次失败后 10 分钟内不再上传（含重启后的续期），成功一次立刻复位；
// 3) 不重试、不排队：这里只发一次请求，失败就抛，由 scanReceipt 改回本地结果；
// 4) 只抛错误、绝不返回「空的成功」。
//
// 为什么不复用 apiClient.uploadMultipart：它固定注入 Authorization Bearer，且没有
// 自定义请求头的入口（X-OCR-Key 无处可放）；同时 /ocr/* 属于独立的 OCR 服务，
// 与 /api/* 的 Spring 后端可能不是同一个地址。同源代理额外校验订阅；独立服务不接收 App 凭证。
// 这里用 fetch + FormData 自己拼，
// 超时 / 取消 / JSON 解析的写法与 apiClient 保持一致。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAccessToken } from '../services/sessionStore';
import { guestToken } from '../services/premiumApi';
import { API_BASE_URL } from '../config/apiConfig';
import type { OcrLine } from './receiptParse';
import type { ServerOcrSettings } from './scanSettings';

/** 稳定错误码（只用于诊断日志，界面不展示） */
export type RemoteOcrErrorCode =
  | 'no-key'
  | 'no-image'
  | 'bad-key'
  | 'bad-image'
  | 'too-large'
  | 'engine-error'
  | 'timeout'
  | 'network'
  | 'no-text';

export class RemoteOcrError extends Error {
  readonly code: RemoteOcrErrorCode;
  constructor(code: RemoteOcrErrorCode, message: string) {
    super(message);
    this.name = 'RemoteOcrError';
    this.code = code;
  }
}

/** 单次上传超时（产品要求 6s：宁可放弃兜底，也不能让用户一直看着转圈） */
const OCR_UPLOAD_TIMEOUT_MS = 6_000;
/** 设置页那行「服务状态」的探测超时 */
const OCR_HEALTH_TIMEOUT_MS = 6_000;
/** 失败后的冷却时长：这段时间内所有扫票都直接跳过上传，连一次等待都不付 */
export const REMOTE_OCR_COOLDOWN_MS = 10 * 60_000;
/** 冷却截止时间戳（进程重启后靠它续上，避免每次冷启动都再撞一遍） */
const COOLDOWN_STORAGE_KEY = '@jizhang/scan.serverOcr.blockedUntil';

// ── 会话内熔断 ──────────────────────────────────────────────────────────────
let blockedUntil = 0;
let lastFailureCode = '';
let cooldownInFlight: Promise<void> | null = null;

/** 只读一次持久化的冷却截止时间；并发调用共享同一个 Promise（不会抢跑到「还没读到」。 */
function hydrateCooldown(): Promise<void> {
  if (!cooldownInFlight) {
    cooldownInFlight = (async () => {
      try {
        const raw = await AsyncStorage.getItem(COOLDOWN_STORAGE_KEY);
        const stored = raw ? Number(raw) : NaN;
        if (Number.isFinite(stored) && stored > Date.now()) blockedUntil = Math.max(blockedUntil, stored);
      } catch {
        /* 读不到就当没有冷却 */
      }
    })();
  }
  return cooldownInFlight;
}

/** 是否处于熔断冷却期（true ⇒ 本次扫票直接跳过上传） */
export function isRemoteOcrBlocked(): boolean {
  return Date.now() < blockedUntil;
}

/** 熔断原因（诊断用；未熔断时为空串） */
export function getRemoteOcrBlockReason(): string {
  return isRemoteOcrBlocked() ? lastFailureCode : '';
}

/**
 * 哪些失败算「服务端不可达」。
 * 400（图片问题）/413（太大）只针对这一张图 —— 换张图可能就好，所以不熔断。
 * 401（密钥错）是配置问题：不熔断会每张票都白撞一次，必须熔断。
 */
function shouldTripBreaker(code: RemoteOcrErrorCode): boolean {
  return code === 'timeout' || code === 'network' || code === 'bad-key' || code === 'engine-error';
}

function markFailure(code: RemoteOcrErrorCode): void {
  if (!shouldTripBreaker(code)) return;
  blockedUntil = Date.now() + REMOTE_OCR_COOLDOWN_MS;
  lastFailureCode = code;
  void AsyncStorage.setItem(COOLDOWN_STORAGE_KEY, String(blockedUntil)).catch(() => undefined);
}

function markSuccess(): void {
  blockedUntil = 0;
  lastFailureCode = '';
  void AsyncStorage.removeItem(COOLDOWN_STORAGE_KEY).catch(() => undefined);
}

// ── 地址 / 传输 ─────────────────────────────────────────────────────────────

/**
 * OCR 服务地址。优先 EXPO_PUBLIC_OCR_BASE_URL（独立部署时直接指向它）；
 * 没配就与后端同源 —— 容器里 nginx 会把 /ocr/* 反代到 ocr-service。
 * '/' 与 'same-origin' 表示同源（与 apiConfig 的约定一致）。
 */
function resolveOcrBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_OCR_BASE_URL;
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '/' || value === 'same-origin') return '';
  if (value) return value.replace(/\/+$/, '');
  return API_BASE_URL;
}

interface OcrResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

async function ocrFetch(
  path: string,
  method: 'GET' | 'POST',
  key: string,
  timeoutMs: number,
  body?: FormData,
): Promise<OcrResponse> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers['X-OCR-Key'] = key;
  // Never send application credentials to an independently configured third-party OCR origin.
  const base = resolveOcrBaseUrl();
  const sameOrigin = base === API_BASE_URL || (() => {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
      return new URL(base || '/', origin).origin === new URL(API_BASE_URL || '/', origin).origin;
    } catch { return false; }
  })();


  let response: Response;
  try {
  if (sameOrigin) {
    const accessToken = getAccessToken();
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    else headers['X-Premium-Guest-Token'] = (await guestToken()) ?? '';
  }
    response = await fetch(resolveOcrBaseUrl() + path, {
      method,
      headers,
      // multipart 的 Content-Type 必须带 boundary —— 只能由 fetch 自己生成，这里绝不手写
      body,
      signal: controller?.signal,
    });
  } catch (e) {
    const aborted = controller?.signal.aborted ?? false;
    const detail = e instanceof Error ? e.message : String(e);
    throw aborted
      ? new RemoteOcrError('timeout', '服务端 OCR 超时（' + timeoutMs + 'ms）')
      : new RemoteOcrError('network', '连不上服务端 OCR：' + detail.slice(0, 120));
  } finally {
    clearTimeout(timer);
  }

  let parsed: unknown;
  const text = await response.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, ok: response.ok, body: parsed };
}

/** 把 HTTP 状态翻译成稳定错误码（401 密钥 / 400·413 图片 / 其它＝引擎） */
function httpError(status: number, body: unknown): RemoteOcrError {
  const message =
    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
      ? '：' + String((body as { message?: unknown }).message).slice(0, 120)
      : '';
  if (status === 401 || status === 403) return new RemoteOcrError('bad-key', '服务端密钥不正确（HTTP ' + status + '）' + message);
  if (status === 400) return new RemoteOcrError('bad-image', '服务端不接受这张图（HTTP 400）' + message);
  if (status === 413) return new RemoteOcrError('too-large', '图片太大（HTTP 413）' + message);
  return new RemoteOcrError('engine-error', '服务端识别引擎出错（HTTP ' + status + '）' + message);
}

// ── 图片 / 响应映射 ─────────────────────────────────────────────────────────

/** 文件名决定 multipart 的 Content-Type（后端按扩展名判断） */
function fileNameOf(uri: string): string {
  const clean = uri.split('?')[0].split('#')[0];
  const name = clean.split('/').pop() ?? '';
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(name) ? name : 'receipt.jpg';
}

function mimeFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
}

/** 上传前拿到一个可读的本地图片路径：没有 uri 时用 base64 写临时文件（与本地识别同一套做法） */
async function ensureUploadableUri(imageUri: string, base64?: string): Promise<string> {
  if (imageUri) return imageUri;
  if (!base64) throw new RemoteOcrError('no-image', '没有可上传的图片');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require('expo-file-system');
    const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
    const tmp = dir + 'receipt-ocr-' + Date.now() + '.jpg';
    await FileSystem.writeAsStringAsync(tmp, base64, { encoding: 'base64' });
    return tmp;
  } catch (e) {
    throw new RemoteOcrError(
      'no-image',
      '临时图片写入失败：' + String((e as Error)?.message ?? e).slice(0, 100),
    );
  }
}

/** 坐标宽容一点：契约是数字，但引擎把 float 序列化成字符串时不该让解析退化成「没有坐标」。 */
function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 服务端响应 → 与本地 ML Kit 同形的 OcrLine[]（坐标缺失就留 undefined，解析器支持纯文本模式） */
function toOcrLines(body: unknown): OcrLine[] {
  const payload = body as { lines?: unknown } | null | undefined;
  const rows = Array.isArray(payload?.lines) ? payload!.lines : [];
  const lines: OcrLine[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (!text) continue;
    lines.push({
      text,
      top: finiteNumber(item.top),
      left: finiteNumber(item.left),
      width: finiteNumber(item.width),
      height: finiteNumber(item.height),
    });
  }
  if (lines.length === 0) {
    throw new RemoteOcrError('no-text', '服务端没有返回可用的文字行');
  }
  return lines;
}

// ── 对外两个入口 ────────────────────────────────────────────────────────────

/**
 * 上传原图 → 服务端 OCR 行。
 *
 * 任何失败（无密钥 / 熔断期 / 超时 / 非 200 / 响应不可解析）都抛 RemoteOcrError；
 * 调用方（scanReceipt）负责吞掉并回退到本地结果 —— 这里绝不静默返回空数组。
 */
export async function recognizeReceiptLinesRemote(
  imageUri: string,
  base64: string | undefined,
  settings: ServerOcrSettings,
): Promise<OcrLine[]> {
  const key = settings.key.trim();
  if (!key) throw new RemoteOcrError('no-key', '没有服务端密钥，跳过上传');

  await hydrateCooldown();
  if (isRemoteOcrBlocked()) {
    throw new RemoteOcrError('network', '熔断冷却中（上次失败：' + lastFailureCode + '），本次跳过上传');
  }

  const fileUri = await ensureUploadableUri(imageUri, base64);
  const name = fileNameOf(fileUri);
  // RN 的 FormData 认 { uri, name, type } 这种「文件」形状（DOM 类型里没有，故断言）
  const part = { uri: fileUri, name, type: mimeFor(name) } as unknown as Blob;
  const form = new FormData();
  form.append('file', part);

  let result: OcrResponse;
  try {
    result = await ocrFetch('/ocr/lines', 'POST', key, OCR_UPLOAD_TIMEOUT_MS, form);
  } catch (e) {
    const code = e instanceof RemoteOcrError ? e.code : 'network';
    markFailure(code);
    throw e instanceof RemoteOcrError
      ? e
      : new RemoteOcrError('network', '上传失败：' + String((e as Error)?.message ?? e).slice(0, 120));
  }

  if (!result.ok) {
    const error = httpError(result.status, result.body);
    markFailure(error.code);
    throw error;
  }

  // 拿到 2xx 就说明服务端可达：先复位熔断，再映射行（行里没文字是「引擎没读懂这张图」，不是不可达）
  markSuccess();
  return toOcrLines(result.body);
}

export interface RemoteOcrHealth {
  ok: boolean;
  /** 失败原因（诊断用；ok=true 时缺省） */
  detail?: string;
}

/**
 * 设置页那行「服务状态」：探测 GET /ocr/health（需要密钥头就带上）。
 * 这里**不受熔断冷却限制** —— 用户手动看状态就是想知道现在通不通，通了立刻复位熔断。
 */
export async function checkRemoteOcrHealth(settings: ServerOcrSettings): Promise<RemoteOcrHealth> {
  const key = settings.key.trim();
  if (!key) return { ok: false, detail: 'no-key' };
  try {
    const result = await ocrFetch('/ocr/health', 'GET', key, OCR_HEALTH_TIMEOUT_MS);
    if (!result.ok) {
      const error = httpError(result.status, result.body);
      markFailure(error.code);
      return { ok: false, detail: error.message };
    }
    markSuccess();
    return { ok: true };
  } catch (e) {
    const code = e instanceof RemoteOcrError ? e.code : 'network';
    markFailure(code as RemoteOcrErrorCode);
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
