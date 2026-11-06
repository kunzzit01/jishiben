import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ScannedReceipt {
  amount: number | null;
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  type: 'expense' | 'income'; // 识别不准默认 expense
  suggestedCategory: string | null; // 中文分类名，例如"餐饮"或"工资"
  /** 产生金额的那一行原文（保存成功后写入本机学习库） */
  amountLabel?: string | null;
  /** 本机学到的商户→分类（分类 id）；界面优先用它 */
  learnedCategoryId?: string | null;
  /** 识别到的币种（RM→MYR 等）；界面需与账户币种比对 */
  currency?: string | null;
  /** 0–1 规则置信度：偏低时界面提示用户核对金额 */
  confidence?: number;
  /** OCR 全文（查重用，界面不要展示） */
  rawText?: string;
  /** 这张小票最近扫过（订阅式提示，不阻止记账） */
  duplicate?: boolean;
  duplicateDaysAgo?: number;
}

/** 识别失败的稳定信号：界面可以按 code 决定「提示后手动记账」还是「重试」。 */
const LAST_SCAN_TEXT_KEY = '@jizhang/lastScanText';

export class ReceiptScanError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReceiptScanError';
    this.code = code;
  }
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
      return detail ? `识别失败：${detail}` : '识别失败，请重试或手动填写';
    default:
      return detail || '识别失败，请手动填写';
  }
}

/**
 * 小票识别（离线）：图片在设备上用 ML Kit（中文模型）读字，再用本地规则解析金额/日期/分类。
 * 不上传图片、不调用第三方、无按次费用 —— 取代了原来的 AI(OpenRouter) 方案。
 */
export async function scanReceipt(imageUri: string, imageBase64?: string): Promise<ScannedReceipt> {
  const { scanReceiptLocally, ReceiptOcrError } = await import('./receiptOcr');
  const { getLearnedAmountLabels, getMerchantCategory } = await import('./receiptLearning');
  const { checkReceiptDuplicate } = await import('./receiptDedupe');
  try {
    const learnedLabels = await getLearnedAmountLabels().catch(() => []);
    const parsed = await scanReceiptLocally(imageUri, imageBase64, learnedLabels);
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
    // 留一份最近识别文字：识别不准时可在「关于应用」里查看原文，便于定位规则问题
    void AsyncStorage.setItem(LAST_SCAN_TEXT_KEY, parsed.rawText.slice(0, 1200)).catch(() => undefined);
    return {
      amount: parsed.amount,
      merchant: parsed.merchant,
      date: parsed.date,
      type: parsed.type,
      suggestedCategory: parsed.suggestedCategory,
      // 本机学到的「这个商户用这个分类」（分类 id），界面优先于 suggestedCategory
      learnedCategoryId: await getMerchantCategory(parsed.merchant).catch(() => null),
      currency: parsed.currency,
      amountLabel: parsed.amountLabel ?? null,
      confidence: parsed.confidence,
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
