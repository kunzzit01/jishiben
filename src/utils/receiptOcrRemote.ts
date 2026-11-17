// receiptOcrRemote.ts —— 服务端 OCR 兜底（POST /ocr/lines）。
//
// 定位：只有本地 ML Kit 拿不准、且用户在「设置 → 扫票识别」里显式打开开关并粘贴共享密钥时才走这里。
// 它只做一件事：上传原图 → 把服务端返回的行还原成与本地同形的 OcrLine[]。
//
// 四条硬约束（改之前先读）：
// 1) 超时 6s：兜底不许把用户卡住（离线时 fetch 一般 1–2s 就自己报错，不会真等满 6s）；
// 2) 不熔断：失败只影响当次，下一张票照样请求（熔断曾把线上配置错误悄悄藏了起来）；
// 3) 不重试、不排队：这里只发一次请求，失败就抛，由 scanReceipt 改回本地结果；
// 4) 只抛错误、绝不返回「空的成功」。
//
// 为什么不复用 apiClient.uploadMultipart：它固定注入 Authorization Bearer，且没有
// 自定义请求头的入口（X-OCR-Key 无处可放）；同时 /ocr/* 属于独立的 OCR 服务，
// 与 /api/* 的 Spring 后端可能不是同一个地址。同源代理额外校验订阅；独立服务不接收 App 凭证。
// 这里用 fetch + FormData 自己拼，
// 超时 / 取消 / JSON 解析的写法与 apiClient 保持一致。
import { getAccessToken } from '../services/sessionStore';
import { guestToken } from '../services/premiumApi';
import { API_BASE_URL } from '../config/apiConfig';
import type { OcrLine } from './receiptParse';
import { makeFilePart } from './formFilePart';
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

/** 单次上传超时：6s 对「手机网络上传几 MB 原图 + 服务端首次加载模型」太短，线上会频繁超时并触发熔断；放宽到 25s */
const OCR_UPLOAD_TIMEOUT_MS = 25_000;
/** 设置页那行「服务状态」的探测超时 */
const OCR_HEALTH_TIMEOUT_MS = 6_000;
// 说明：这里**没有熔断**。曾经失败一次就 N 分钟内跳过所有上传，结果线上配置错误（nginx 校验 500）
// 被它悄悄藏了起来 —— 用户只看到「读不到」，服务器上也没有任何请求记录。
// 现在每次扫票都老实请求，失败只影响当次，原因由调用方写进诊断提示。

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

  const fileUri = await ensureUploadableUri(imageUri, base64);
  // Expo SDK 57 的 fetch 不认 { uri, name, type }，必须用 File（见 formFilePart.ts）
  const part = makeFilePart(fileUri);
  const form = new FormData();
  form.append('file', part);

  let result: OcrResponse;
  try {
    result = await ocrFetch('/ocr/lines', 'POST', key, OCR_UPLOAD_TIMEOUT_MS, form);
  } catch (e) {
    throw e instanceof RemoteOcrError
      ? e
      : new RemoteOcrError('network', '上传失败：' + String((e as Error)?.message ?? e).slice(0, 120));
  }

  if (!result.ok) throw httpError(result.status, result.body);

  // 行里没文字是「引擎没读懂这张图」，由 toOcrLines 抛 no-text
  return toOcrLines(result.body);
}

// ── 视觉识别（多模态大模型，最精准的一层兜底）────────────────────────────────

/** 服务端 /ocr/vision 的结构化结果（字段已在服务端按类型收敛，这里再防一层） */
export interface VisionReceipt {
  amount: number | null;
  /** 金额在票面上的原文（程序用它与 OCR 行核对） */
  amountText: string | null;
  currency: string | null;
  date: string | null;
  merchant: string | null;
  type: 'expense' | 'income';
  /** 中文分类名（服务端提示词里给了内置分类清单） */
  category: string | null;
  handwritten: boolean;
  legible: boolean;
  /** 模型指出的总金额在原图中的位置（0~1 归一化，近似值）；没给或不合理为 null */
  amountBox: AmountBox | null;
}

/** 0~1 归一化矩形（相对整张图的宽高） */
export interface AmountBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseBox(v: unknown): AmountBox | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const x = Number(o.x), y = Number(o.y), w = Number(o.w), h = Number(o.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.01 || y + h > 1.01) return null;
  return { x, y, w, h };
}

/** 视觉识别比 OCR 慢（本机 CPU 跑视觉模型，一张约 20–50 秒）：给足时间，换来手写也读得出；服务端总超时 105s、nginx 120s */
const VISION_TIMEOUT_MS = 110_000;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * 上传原图 → 视觉识别结构化结果。失败一律抛 RemoteOcrError，由 scanReceipt 吞掉并退回已有结果。
 * 只有设置里有密钥（内置）才会发请求；失败后进入各自的冷却，不重试、不排队。
 */
export async function recognizeReceiptVisionRemote(
  imageUri: string,
  base64: string | undefined,
  settings: ServerOcrSettings,
): Promise<VisionReceipt> {
  const key = settings.key.trim();
  if (!key) throw new RemoteOcrError('no-key', '没有服务端密钥，跳过视觉识别');

  const fileUri = await ensureUploadableUri(imageUri, base64);
  const part = makeFilePart(fileUri);
  const form = new FormData();
  form.append('file', part);

  const result = await ocrFetch('/ocr/vision', 'POST', key, VISION_TIMEOUT_MS, form);
  if (!result.ok) throw httpError(result.status, result.body);

  const b = (result.body ?? {}) as Record<string, unknown>;
  const rawAmount = typeof b.amount === 'number' ? b.amount : null;
  return {
    amount: rawAmount !== null && Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null,
    amountText: str(b.amountText),
    currency: str(b.currency),
    date: str(b.date),
    merchant: str(b.merchant),
    type: b.type === 'income' ? 'income' : 'expense',
    category: str(b.category),
    handwritten: b.handwritten === true,
    legible: b.legible !== false,
    amountBox: parseBox(b.amountBox),
  };
}

export interface RemoteOcrHealth {
  ok: boolean;
  /** 失败原因（诊断用；ok=true 时缺省） */
  detail?: string;
}

/**
 * 设置页那行「服务状态」：探测 GET /ocr/health（需要密钥头就带上）。
 * 用户手动看状态就是想知道现在通不通。
 */
export async function checkRemoteOcrHealth(settings: ServerOcrSettings): Promise<RemoteOcrHealth> {
  const key = settings.key.trim();
  if (!key) return { ok: false, detail: 'no-key' };
  try {
    const result = await ocrFetch('/ocr/health', 'GET', key, OCR_HEALTH_TIMEOUT_MS);
    if (!result.ok) return { ok: false, detail: httpError(result.status, result.body).message };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
