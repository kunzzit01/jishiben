// receiptAi.ts —— 端侧 Gemini Nano 兜底：只在本地规则拿不准时，让设备里的模型再读一遍 OCR 文字。
// 模型跑在手机上：不联网、不上传图片、无按次费用。
// 任何一个环节（模块缺失 / 未就绪 / 超时 / 返回不是 JSON）都返回 null，**永不抛**。
// AI 的输出只是**草稿**：必须先过 receiptVerify 的程序校验，才允许进账。

import type { OcrLine } from './receiptParse';

export interface AiEvidence {
  /** 证据行原文：必须逐字来自 OCR 的某一行 */
  lineText: string | null;
  /** 该行里被认作金额的那个数字 */
  valueInLine: number | null;
}

export interface AiDraft {
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  evidence: AiEvidence;
}

/** 端侧模型预算：难票超时就放弃，界面照旧让用户手填 */
const AI_TIMEOUT_MS = 8000;

/** 原生模块契约（同事实现，这里只按契约调用） */
interface GeminiNanoNative {
  isReady(): Promise<boolean>;
  status(): Promise<string>;
  generate(promptText: string, imageUri: string | null, timeoutMs: number): Promise<string>;
}

/** 取原生模块：Web / 老安装包 / 未注册时返回 null（绝不能抛） */
function getNative(): GeminiNanoNative | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const native = NativeModules?.GeminiNano;
    if (!native || typeof native.isReady !== 'function' || typeof native.generate !== 'function') return null;
    return native as GeminiNanoNative;
  } catch {
    return null;
  }
}

/** 端侧模型是否已就绪（isReady 不会触发下载）。永不抛。 */
export async function isReceiptAiReady(): Promise<boolean> {
  const native = getNative();
  if (!native) return false;
  try {
    return (await native.isReady()) === true;
  } catch {
    return false;
  }
}

// ── 提示词：把带坐标的 OCR 行原样交给模型，要求只输出 JSON ──────────────────────

function formatOcrLine(line: OcrLine): string {
  const y = typeof line.top === 'number' ? Math.round(line.top) : null;
  const x = typeof line.left === 'number' ? Math.round(line.left) : null;
  const where = y !== null && x !== null ? `y=${y} x=${x}` : 'y=? x=?';
  return `${where} | ${String(line.text).trim()}`;
}

function buildPrompt(lines: OcrLine[]): string {
  return [
    '下面是一张收据/小票经过 OCR 得到的文字行。每行前缀是版面坐标（y=距图片顶部像素，x=距左侧像素）。',
    '请只根据这些文字找出「最终应付金额」。不要联想、不要补齐、不要自己计算。',
    '',
    '只认最终应付：Rounded Total / Rounding Total / Grand Total / Amount Due / Total Due / Balance Due / Total / Jumlah / 实付 / 应付 / 实收 / 合计 / 总计。',
    '以下绝对不是实付：Cash / Cash Change / Change / Tendered / Tunai / Baki / Sub Total（小计）/ 单号（Document No. / Invoice No. / Ref）/ 电话 / 日期 / 数量 / 单价 / 积分。',
    '',
    '只输出一个 JSON 对象，不要解释，不要 Markdown 代码块。没有证据的字段一律 null：',
    '{"amount":number|null,"currency":string|null,"merchant":string|null,"date":"YYYY-MM-DD"|null,',
    ' "evidence":{"lineText":string|null,"valueInLine":number|null}}',
    '',
    '要求：',
    '1) evidence.lineText 必须逐字复制上面某一行（去掉 y=/x= 前缀，保留原文标点与大小写）；',
    '2) evidence.valueInLine 必须是那一行里原样出现的数字（15.00 → 15，7,800 → 7800）；',
    '3) amount 必须等于 evidence.valueInLine；',
    '4) currency 只有在票面文字里确实出现时才能填（RM→MYR、S$→SGD、HK$→HKD）；',
    '5) merchant 用票面原文，不要补全、不要翻译；date 用 YYYY-MM-DD；',
    '6) 任何一项在票面上找不到证据就返回 null —— 宁可留空，也不要编造。',
    '',
    'OCR 行：',
    ...lines.map(formatOcrLine),
  ].join('\n');
}

// ── 解析模型输出：只接受能放进 JSON.parse 的对象 ───────────────────────────────

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    if (!cleaned) return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 模型可能把 JSON 包在说明文字或代码块里：截取第一个 { 到最后一个 } 再解析 */
function parseDraft(raw: string): AiDraft | null {
  const text = String(raw ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const evidenceRaw = record.evidence;
  const evidence = evidenceRaw && typeof evidenceRaw === 'object' ? (evidenceRaw as Record<string, unknown>) : {};
  return {
    amount: toNumber(record.amount),
    currency: toText(record.currency),
    merchant: toText(record.merchant),
    date: toText(record.date),
    evidence: {
      lineText: toText(evidence.lineText),
      valueInLine: toNumber(evidence.valueInLine),
    },
  };
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 问端侧模型要一份草稿。不可用/超时/输出不是 JSON → null。
 * 注意：**这里不做任何信任判断**，调用方必须再过 verifyAiDraft。
 */
export async function askReceiptAi(input: { lines: OcrLine[]; imageUri?: string | null }): Promise<AiDraft | null> {
  const native = getNative();
  if (!native) return null;
  const lines = (Array.isArray(input?.lines) ? input.lines : []).filter(
    (line) => line && typeof line.text === 'string' && line.text.trim() !== '',
  );
  if (lines.length === 0) return null;
  const imageUri = typeof input?.imageUri === 'string' && input.imageUri ? input.imageUri : null;
  try {
    const raw = await native.generate(buildPrompt(lines), imageUri, AI_TIMEOUT_MS);
    return parseDraft(raw);
  } catch {
    return null;
  }
}

/** 端侧 AI 的真实状态（给设置页展示）：AVAILABLE / DOWNLOADABLE / DOWNLOADING / UNAVAILABLE / …
 *  永不抛：模块缺失返回 module-missing，异常返回 error:<msg> */
export async function getReceiptAiStatus(): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const native = NativeModules?.GeminiNano;
    if (!native || typeof native.status !== 'function') return 'module-missing';
    const raw = await native.status();
    return typeof raw === 'string' && raw ? raw : 'unknown';
  } catch (e) {
    return 'error:' + String((e as Error)?.message ?? e).slice(0, 60);
  }
}
