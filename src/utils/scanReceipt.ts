import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OcrLine, ParsedReceipt } from './receiptParse';
import { verifyAiDraft, type VerifiedDraft } from './receiptVerify';

export interface ScannedReceipt {
  amount: number | null;
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  type: 'expense' | 'income'; // 识别不准默认 expense
  suggestedCategory: string | null; // 中文分类名，例如"餐饮"或"工资"
  /** 商户名是否高置信（仅当票据里有明确 Merchant 标签）；只有高置信才作为备注建议 */
  merchantConfident?: boolean;
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
  /**
   * 这次结果来自哪条路径（诊断用，界面不展示）：
   * - 'local'：本地 ML Kit 解析（服务端兜底没试 —— 本地够用 / 开关关 / 无密钥 / 熔断冷却）
   * - 'server'：本地拿不准，服务端 OCR 的行解析出更好的金额，已采用
   * - 'local-after-server-failed'：试过服务端但没拿到更好的结果，最终仍是本地那份
   */
  ocrSource: 'local' | 'server' | 'local-after-server-failed';
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

interface RemoteAttempt {
  /** 采用的服务端解析结果；null 表示没有「比本地更好」的可用结果 */
  parsed: ParsedReceipt | null;
  /** 是否真的发出了上传请求（开关关闭 / 无密钥 / 熔断冷却 → false，等于一点等待都没付） */
  attempted: boolean;
  /** 诊断原因（写入本机诊断日志，界面不展示） */
  reason: string;
}

/**
 * 服务端 OCR 兜底：只在本地拿不准时才调用。
 *
 * 隐私与失败边界（按顺序判定，任何一条不满足就不上传）：
 * 1) 设置里开关打开 **且** 有密钥；2) 不在失败冷却期（10 分钟）；
 * 3) 上传一次（超时 6s），失败不重试、不排队。
 *
 * 采用规则：服务端那批行用**同一个** parseReceiptOcr 解析，只有「解析出金额且置信度比本地更高」
 * 才采用 —— 更差的结果绝不覆盖本地。任何异常都吞掉 → parsed=null，上层照旧用本地结果。
 */
async function tryReceiptRemote(
  imageUri: string,
  imageBase64: string | undefined,
  local: ParsedReceipt,
  learnedLabels: string[],
): Promise<RemoteAttempt> {
  try {
    const { hydrateServerOcrSettings, getServerOcrSettings, isServerOcrUsable } = await import('./scanSettings');
    await hydrateServerOcrSettings();
    const settings = getServerOcrSettings();
    if (!isServerOcrUsable(settings)) {
      return {
        parsed: null,
        attempted: false,
        reason: settings.enabled ? 'server-skip（没有密钥）' : 'server-off（设置里未开启）',
      };
    }
    const { recognizeReceiptLinesRemote, isRemoteOcrBlocked, getRemoteOcrBlockReason } = await import(
      './receiptOcrRemote'
    );
    if (isRemoteOcrBlocked()) {
      return {
        parsed: null,
        attempted: false,
        reason: 'server-cooldown（上次失败：' + getRemoteOcrBlockReason() + '）',
      };
    }
    const remoteLines = await recognizeReceiptLinesRemote(imageUri, imageBase64, settings);
    const { parseReceiptOcr } = await import('./receiptParse');
    const remoteParsed = parseReceiptOcr(remoteLines, { learnedLabels });
    if (remoteParsed.amount === null) {
      return { parsed: null, attempted: true, reason: 'server-no-amount（服务端行里也没找到应付金额）' };
    }
    if (remoteParsed.confidence <= local.confidence) {
      return {
        parsed: null,
        attempted: true,
        reason:
          'server-not-better（confidence ' +
          remoteParsed.confidence.toFixed(2) +
          ' ≤ 本地 ' +
          local.confidence.toFixed(2) +
          '）',
      };
    }
    return {
      parsed: remoteParsed,
      attempted: true,
      reason: 'server-used（amount=' + remoteParsed.amount + ' confidence=' + remoteParsed.confidence.toFixed(2) + '）',
    };
  } catch (e) {
    return {
      parsed: null,
      attempted: true,
      reason: 'server-error: ' + String((e as Error)?.message ?? e).slice(0, 120),
    };
  }
}

/**
 * 小票识别：图片在设备上用 ML Kit（中文模型）读字 → 本地规则解析金额/日期/分类。
 * 本地拿不准（没金额或置信度 < 0.6）时的兜底顺序：
 *   a) 设置里开了「服务端 OCR」并且填了密钥 → 上传原图，用同一套规则解析服务端返回的行；
 *      只有「金额非空且置信度更高」才采用（ocrSource='server'）；
 *   b) 端侧 Gemini Nano（现有逻辑不变），草稿必须通过程序校验；
 *   c) 都失败 → 保持本地结果（ocrSource='local-after-server-failed' / 'local'）。
 * 默认关闭、无密钥不上传、只在本地失败时才上传一次（超时 6s、失败即熔断 10 分钟、不重试不排队）。
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

    // 本地已经「有把握」（金额非空且置信度 ≥ 0.6）就不再打扰任何兜底
    let amount = parsed.amount;
    let currency = parsed.currency;
    let merchant = parsed.merchant;
    let merchantConfident = parsed.merchantConfident ?? false;
    let date = parsed.date;
    let type = parsed.type;
    let suggestedCategory = parsed.suggestedCategory;
    let amountLabel = parsed.amountLabel ?? null;
    let rawText = parsed.rawText;
    let confidence = parsed.confidence;
    let aiTried = false;
    let aiUsed = false;
    let aiReason = '';
    let ocrSource: 'local' | 'server' | 'local-after-server-failed' = 'local';

    const localIsConfident = parsed.amount !== null && parsed.confidence >= 0.6;
    if (localIsConfident) {
      aiReason = '本地解析已够用（amount ≠ null 且 confidence ≥ 0.6）';
    } else {
      // a) 服务端 OCR 兜底：开关打开 + 有密钥才会上传；熔断冷却期内直接跳过（不付任何等待）
      const remote = await tryReceiptRemote(imageUri, imageBase64, parsed, learnedLabels);
      const active = remote.parsed ?? parsed;
      if (remote.parsed) ocrSource = 'server';
      else if (remote.attempted) ocrSource = 'local-after-server-failed';
      // 采用「最终采用的那份解析」的字段（服务端更好时就是服务端那份，否则仍是本地那份）
      amount = active.amount;
      currency = active.currency;
      merchant = active.merchant;
      merchantConfident = active.merchantConfident ?? false;
      date = active.date;
      type = active.type;
      suggestedCategory = active.suggestedCategory;
      amountLabel = active.amountLabel ?? null;
      rawText = active.rawText;
      confidence = active.confidence;
      aiReason = remote.reason;

      // b) 端侧 AI 兜底（现有逻辑不变）：只有服务端也没给出可用金额时才打扰模型 ——
      //    否则 AI 会用固定 0.7 覆盖掉更好的服务端结果。
      const activeIsConfident = active.amount !== null && active.confidence >= 0.6;
      if (activeIsConfident) {
        aiReason += ' → 不再尝试端侧 AI';
      } else {
        aiTried = true;
        const attempt = await tryReceiptAi(lines, imageUri);
        aiReason += ' | AI: ' + attempt.reason;
        if (attempt.draft && attempt.draft.amount !== null) {
          // 校验通过的 AI 字段才允许覆盖本地结果；AI 给 null 的项沿用本地（本地也已各自过关）
          amount = attempt.draft.amount;
          currency = attempt.draft.currency ?? currency;
          if (attempt.draft.merchant) {
            // AI 的商户必须已通过 verify（出现在 OCR 文本里）→ 视为可核对，给备注建议
            merchant = attempt.draft.merchant;
            merchantConfident = true;
          }
          date = attempt.draft.date ?? date;
          confidence = 0.7;
          aiUsed = true;
        }
      }
      // c) 两条兜底都过完了：把这次走的路径落盘，识别不准时可到「关于应用」定位
      void AsyncStorage.setItem(
        LAST_AI_DIAG_KEY,
        'stage=scan ocrSource=' + ocrSource + ' server=' + remote.reason + ' ai=' + aiReason,
      ).catch(() => undefined);
    }

    // 查重（本地指纹，不联网）：只提示，不阻止用户记账
    let duplicate = false;
    let duplicateDaysAgo: number | undefined;
    try {
      const check = await checkReceiptDuplicate(rawText);
      duplicate = check.duplicate;
      duplicateDaysAgo = check.daysAgo;
    } catch {
      /* 查重失败不影响识别结果 */
    }
    // 留一份最近识别文字：识别不准时可在「关于应用」里查看原文，便于定位规则问题
    void AsyncStorage.setItem(LAST_SCAN_TEXT_KEY, rawText.slice(0, 1200)).catch(() => undefined);
    return {
      amount,
      merchant,
      merchantConfident,
      date,
      type,
      suggestedCategory,
      // 本机学到的「这个商户用这个分类」（分类 id），界面优先于 suggestedCategory
      learnedCategoryId: await getMerchantCategory(merchant).catch(() => null),
      currency,
      amountLabel,
      confidence,
      rawText,
      duplicate,
      duplicateDaysAgo,
      aiTried,
      aiUsed,
      aiReason,
      ocrSource,
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
