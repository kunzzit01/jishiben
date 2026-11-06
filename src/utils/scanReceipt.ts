export interface ScannedReceipt {
  amount: number | null;
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  type: 'expense' | 'income'; // 识别不准默认 expense
  suggestedCategory: string | null; // 中文分类名，例如"餐饮"或"工资"
  /** OCR 全文（查重用，界面不要展示） */
  rawText?: string;
  /** 这张小票最近扫过（订阅式提示，不阻止记账） */
  duplicate?: boolean;
  duplicateDaysAgo?: number;
}

/** 识别失败的稳定信号：界面可以按 code 决定「提示后手动记账」还是「重试」。 */
export class ReceiptScanError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReceiptScanError';
    this.code = code;
  }
}

/** 现在扫票是完全离线的本地 OCR + 规则解析：不调用 AI API，也没有「未配置密钥」状态。 */
export function isAiUnavailable(_e: unknown): boolean {
  return false;
}

/** 把 OCR/解析的错误码翻译成用户能读懂的一句话 */
function toReadableMessage(code: string, detail?: string): string {
  switch (code) {
    case 'ocr-unavailable':
      return '当前安装包不含本地识别模块，请更新 App 后再试';
    case 'no-text':
      return '这张图里没有识别到文字，换一张清晰的小票试试';
    case 'unsupported-platform':
      return '网页版不支持小票识别，请在 App 内使用';
    case 'ocr-failed':
      return '识别失败，请重试或手动填写';
    default:
      return detail || '识别失败，请手动填写';
  }
}

/**
 * 小票识别（离线）：图片在设备上用 ML Kit（中文模型）读字，再用本地规则解析金额/日期/分类。
 * 不上传图片、不调用第三方、无按次费用 —— 取代了原来的 AI(OpenRouter) 方案。
 */
export async function scanReceipt(imageUri: string): Promise<ScannedReceipt> {
  const { scanReceiptLocally, ReceiptOcrError } = await import('./receiptOcr');
  const { checkReceiptDuplicate } = await import('./receiptDedupe');
  try {
    const parsed = await scanReceiptLocally(imageUri);
    // 查重（本地指纹，不联网）：只提示，不阻止用户记账
    let duplicate = false;
    let duplicateDaysAgo: number | undefined;
    try {
      const check = await checkReceiptDuplicate(parsed.rawText);
      duplicate = check.duplicate;
      duplicateDaysAgo = check.daysAgo;
    } catch {
      /* 查重失败不影响识别结果 */
    }
    return {
      amount: parsed.amount,
      merchant: parsed.merchant,
      date: parsed.date,
      type: parsed.type,
      suggestedCategory: parsed.suggestedCategory,
      rawText: parsed.rawText,
      duplicate,
      duplicateDaysAgo,
    };
  } catch (e) {
    const code = e instanceof ReceiptOcrError ? e.code : 'ocr-failed';
    throw new ReceiptScanError(code, toReadableMessage(code, e instanceof Error ? e.message : undefined));
  }
}

/** 保存成功后调用：把这张小票的指纹记入本地查重库 */
export async function rememberReceiptRawText(rawText?: string): Promise<void> {
  if (!rawText) return;
  const { rememberReceipt } = await import('./receiptDedupe');
  await rememberReceipt(rawText).catch(() => undefined);
}
