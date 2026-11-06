import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OcrLine } from './receiptParse';
import { verifyAiDraft, type VerifiedDraft } from './receiptVerify';

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
  /** 是否尝试过端侧 AI 兜底（诊断用，界面不展示） */
  aiTried?: boolean;
  /** AI 草稿是否通过程序校验并被采用（诊断用，界面不展示） */
  aiUsed?: boolean;
  /** AI 被用 / 被弃的原因，含逐项校验结论（诊断用，界面不展示） */
  aiReason?: string;
}

/** 识别失败的稳定信号：界面可以按 code 决定「提示后手动记账」还是「重试」。 */
const LAST_SCAN_TEXT_KEY = '@jizhang/lastScanText';
const LAST_AI_DIAG_KEY = '@jizhang/lastReceiptAi';

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

interface AiAttempt {
  /** 校验通过的草稿；null 表示没有任何可用的 AI 结果 */
  draft: VerifiedDraft | null;
  reason: string;
}

/**
 * 端侧 AI 兜底：只在本地解析拿不准时才来。
 * 就绪才调用；草稿必须先过 verifyAiDraft（AI 不能自证，必须落回 OCR 的某一行）。
 * 任何异常都吞掉 → 返回 null，界面照旧走本地结果。
 */
async function tryReceiptAi(lines: OcrLine[], imageUri: string): Promise<AiAttempt> {
  try {
    const { isReceiptAiReady, askReceiptAi } = await import('./receiptAi');
    if (!(await isReceiptAiReady())) return { draft: null, reason: 'ai-not-ready（端侧模型未就绪）' };
    const raw = await askReceiptAi({ lines, imageUri });
    if (!raw) return { draft: null, reason: 'ai-empty（模型没有给出可解析的 JSON）' };
    const verified = verifyAiDraft(raw, lines);
    return { draft: verified.amount === null ? null : verified, reason: verified.reason };
  } catch (e) {
    return { draft: null, reason: `ai-error: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
}

/**
 * 小票识别：图片在设备上用 ML Kit（中文模型）读字 → 本地规则解析金额/日期/分类；
 * 本地拿不准（没金额或置信度 < 0.6）时，再用端侧 Gemini Nano 兜一次，且结果必须通过程序校验。
 * 不上传图片、不调用服务端、无按次费用。
 */
export async function scanReceipt(imageUri: string, imageBase64?: string): Promise<ScannedReceipt> {
  const { recognizeReceiptLines, ReceiptOcrError } = await import('./receiptOcr');
  const { parseReceiptOcr } = await import('./receiptParse');
  const { getLearnedAmountLabels, getMerchantCategory } = await import('./receiptLearning');
  const { checkReceiptDuplicate } = await import('./receiptDedupe');
  try {
    const learnedLabels = await getLearnedAmountLabels().catch(() => []);
    // 识别只做一次：本地解析与 AI 兜底共用同一批带坐标的 OCR 行
    const lines = await recognizeReceiptLines(imageUri, imageBase64);
    // 诊断前置：识别一完成就把原文落盘，后续无论成功或失败都能在「关于应用」看到
    const rawTextPreview = lines.map((l) => l.text).join('\n').slice(0, 1200);
    void AsyncStorage.setItem(LAST_SCAN_TEXT_KEY, rawTextPreview).catch(() => undefined);
    void AsyncStorage.setItem(LAST_AI_DIAG_KEY, 'stage=recognized lines=' + lines.length).catch(() => undefined);
    const parsed = parseReceiptOcr(lines, { learnedLabels });

    // 本地已经「有把握」（金额非空且置信度 ≥ 0.6）就不打扰端侧模型：AI 只是难票兜底
    let amount = parsed.amount;
    let currency = parsed.currency;
    let merchant = parsed.merchant;
    let date = parsed.date;
    let confidence = parsed.confidence;
    let aiTried = false;
    let aiUsed = false;
    let aiReason = '';

    const localIsConfident = parsed.amount !== null && parsed.confidence >= 0.6;
    if (localIsConfident) {
      aiReason = '本地解析已够用（amount ≠ null 且 confidence ≥ 0.6）';
    } else {
      aiTried = true;
      const attempt = await tryReceiptAi(lines, imageUri);
      aiReason = attempt.reason;
      if (attempt.draft && attempt.draft.amount !== null) {
        // 校验通过的 AI 字段才允许覆盖本地结果；AI 给 null 的项沿用本地（本地也已各自过关）
        amount = attempt.draft.amount;
        currency = attempt.draft.currency ?? currency;
        merchant = attempt.draft.merchant ?? merchant;
        date = attempt.draft.date ?? date;
        confidence = 0.7;
        aiUsed = true;
      }
    }

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
      amount,
      merchant,
      date,
      type: parsed.type,
      suggestedCategory: parsed.suggestedCategory,
      // 本机学到的「这个商户用这个分类」（分类 id），界面优先于 suggestedCategory
      learnedCategoryId: await getMerchantCategory(merchant).catch(() => null),
      currency,
      amountLabel: parsed.amountLabel ?? null,
      confidence,
      rawText: parsed.rawText,
      duplicate,
      duplicateDaysAgo,
      aiTried,
      aiUsed,
      aiReason,
    };
  } catch (e) {
    const code = e instanceof ReceiptOcrError ? e.code : 'ocr-failed';
    // 失败也要留下证据：这次是「识别层失败」还是「解析后金额为空」
    void AsyncStorage.setItem(
      LAST_AI_DIAG_KEY,
      'stage=failed code=' + code + ' reason=' + String(e instanceof Error ? e.message : e).slice(0, 140),
    ).catch(() => undefined);
    throw new ReceiptScanError(code, toReadableMessage(code, e instanceof Error ? e.message : undefined));
  }
}

/** 保存成功后调用：把这张小票的指纹记入本地查重库 */
export async function rememberReceiptRawText(rawText?: string): Promise<void> {
  if (!rawText) return;
  const { rememberReceipt } = await import('./receiptDedupe');
  await rememberReceipt(rawText).catch(() => undefined);
}
