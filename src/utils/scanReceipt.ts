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
  /**
   * 服务端 OCR 的原始行（诊断/证据核对用，界面不展示）。
   * 只有真正拿到服务端结果时才填充；注意 /ocr/lines 只回 lines（没有 crop 信息），
   * 所以这里没有 cropBox/cropLines —— 不凭空造字段。
   */
  remoteLines?: OcrLine[];
  /** 本次扫票走通的服务端 OCR 轮数（0 = 没上传 / 没拿到行；当前实现每次扫票最多 1 轮） */
  serverPasses?: number;
  /** 备注建议的判定理由（诊断用，界面不展示） */
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
  /** 服务端返回的原始行（诊断/证据核对用）；null 表示这次没拿到行 */
  lines: OcrLine[] | null;
  /** 是否真的发出了上传请求（开关关闭 / 无密钥 / 熔断冷却 → false，等于一点等待都没付） */
  attempted: boolean;
  /** 诊断原因（写入本机诊断日志，界面不展示） */
  reason: string;
}

interface RemoteLinesAttempt {
  /** 服务端行；null 表示这次没有可用结果 */
  lines: OcrLine[] | null;
  /** 是否真的发出了上传请求 */
  attempted: boolean;
  reason: string;
}

/**
 * 唯一的上传入口：发一次请求、拿回服务端行（不做任何采用判断）。
 *
 * 隐私与失败边界（按顺序判定，任何一条不满足就不上传）：
 * 1) 设置里开关打开 **且** 有密钥；2) 不在失败冷却期（10 分钟）；
 * 3) 上传一次（超时 6s），失败不重试、不排队。
 * 任何异常都吞掉 → lines=null，由调用方决定怎么退。
 */
async function fetchRemoteLines(
  imageUri: string,
  imageBase64: string | undefined,
): Promise<RemoteLinesAttempt> {
  try {
    // 先把图复制到 App 私有目录再上传：相册返回的 content:// 在 RN 的 FormData 里并不可靠
    const { persistReceiptImage } = await import('./receiptStore');
    const uploadUri = await persistReceiptImage(imageUri).catch(() => imageUri);
    const { hydrateServerOcrSettings, getServerOcrSettings, isServerOcrUsable } = await import('./scanSettings');
    await hydrateServerOcrSettings();
    const settings = getServerOcrSettings();
    if (!isServerOcrUsable(settings)) {
      return {
        lines: null,
        attempted: false,
        reason: settings.enabled ? 'server-skip（没有密钥）' : 'server-off（设置里未开启）',
      };
    }
    const { recognizeReceiptLinesRemote, isRemoteOcrBlocked, getRemoteOcrBlockReason } = await import(
      './receiptOcrRemote'
    );
    if (isRemoteOcrBlocked()) {
      return {
        lines: null,
        attempted: false,
        reason: 'server-cooldown（上次失败：' + getRemoteOcrBlockReason() + '）',
      };
    }
    const lines = await recognizeReceiptLinesRemote(uploadUri, imageBase64, settings);
    return { lines, attempted: true, reason: 'server-lines=' + lines.length };
  } catch (e) {
    return {
      lines: null,
      attempted: true,
      reason: 'server-error: ' + String((e as Error)?.message ?? e).slice(0, 120),
    };
  }
}

/**
 * 服务端 OCR 兜底：只在本地拿不准时才调用。
 *
 * 采用规则：服务端那批行用**同一个** parseReceiptOcr 解析，只有「解析出金额且置信度比本地更高」
 * 才采用 —— 更差的结果绝不覆盖本地。任何异常都吞掉 → parsed=null，上层照旧用本地结果。
 * 拿到的原始行无论采用与否都带回去（服务端确有结果时才有值，供诊断/证据核对）。
 */
async function tryReceiptRemote(
  imageUri: string,
  imageBase64: string | undefined,
  local: ParsedReceipt,
  learnedLabels: string[],
): Promise<RemoteAttempt> {
  const got = await fetchRemoteLines(imageUri, imageBase64);
  if (!got.lines) return { parsed: null, lines: null, attempted: got.attempted, reason: got.reason };
  const { parseReceiptOcr } = await import('./receiptParse');
  const remoteParsed = parseReceiptOcr(got.lines, { learnedLabels });
  if (remoteParsed.amount === null) {
    return {
      parsed: null,
      lines: got.lines,
      attempted: true,
      reason: 'server-no-amount（服务端行里也没找到应付金额）',
    };
  }
  if (remoteParsed.confidence <= local.confidence) {
    return {
      parsed: null,
      lines: got.lines,
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
    lines: got.lines,
    attempted: true,
    reason: 'server-used（amount=' + remoteParsed.amount + ' confidence=' + remoteParsed.confidence.toFixed(2) + '）',
  };
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
  // 服务端证据：拿到行就留在这两个变量里，最后原样带回返回值（诊断/核对用）
  let serverLines: OcrLine[] | null = null;
  let serverPasses = 0;
  try {
    const learnedLabels = await getLearnedAmountLabels().catch(() => []);
    // 识别只做一次：本地解析与 AI 兜底共用同一批带坐标的 OCR 行
    let lines: OcrLine[];
    let localRecognitionFailed = false;
    let localFailCode = '';
    try {
      lines = await recognizeReceiptLines(imageUri, imageBase64);
    } catch (e) {
      const code = e instanceof ReceiptOcrError ? e.code : 'ocr-failed';
      const detail = e instanceof Error ? e.message : undefined;
      // 本机根本没有识别能力（老安装包 / 网页版）：补传也解析不出东西，按原样报错
      if (code === 'unsupported-platform') {
        throw new ReceiptScanError(code, toReadableMessage(code, detail));
      }
      // 本地一行都没读到（no-text / ocr-failed），但**图片本身还在本地磁盘** ——
      // 上传不依赖本地识别结果，所以让服务端再读一次；服务端也拿不到行，才把本地这条错误抛给用户。
      const got = await fetchRemoteLines(imageUri, imageBase64);
      if (!got.lines) {
        throw new ReceiptScanError(code, toReadableMessage(code, detail));
      }
      lines = got.lines;
      serverLines = got.lines;
      serverPasses = 1;
      localRecognitionFailed = true;
      localFailCode = code;
    }
    // 诊断前置：识别一完成就把原文落盘，后续无论成功或失败都能在「关于应用」看到
    const rawTextPreview = lines.map((l) => l.text).join('\n').slice(0, 1200);
    void AsyncStorage.setItem(LAST_SCAN_TEXT_KEY, rawTextPreview).catch(() => undefined);
    void AsyncStorage.setItem(
      LAST_AI_DIAG_KEY,
      'stage=recognized lines=' + lines.length + ' serverLines=' + (serverLines?.length ?? 0) + ' passes=' + serverPasses,
    ).catch(() => undefined);
    const parsed = parseReceiptOcr(lines, { learnedLabels });
    const { isWeakAmountTier } = await import('./receiptParse');

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
    // 本地识别整体失败时，解析结果本来就来自服务端行 → 路径直接记 server
    let ocrSource: 'local' | 'server' | 'local-after-server-failed' = localRecognitionFailed ? 'server' : 'local';
    let serverReason = '';
    // 本地识别失败时服务端行已经在上面拿到 → 复用它，不为同一份结果再上传第二次
    const prefetched: RemoteAttempt | null = localRecognitionFailed
      ? {
          parsed: parsed.amount !== null ? parsed : null,
          lines,
          attempted: true,
          reason:
            parsed.amount !== null
              ? 'server-used（本地识别失败：' + localFailCode + '，改用服务端行）'
              : 'server-no-amount（本地识别失败：' + localFailCode + '，服务端行里也没找到金额）',
        }
      : null;

    // 弱档（金额列/唯一金额/付款行/无符号大字）即使 confidence 看起来不低也要送服务端复核
    const localIsConfident =
      parsed.amount !== null && parsed.confidence >= 0.6 && !isWeakAmountTier(parsed.amountTier);
    if (localIsConfident) {
      aiReason = localRecognitionFailed
        ? '本地识别失败，改用服务端行；解析已够用（amount ≠ null 且 confidence ≥ 0.6）'
        : '本地解析已够用（amount ≠ null 且 confidence ≥ 0.6）';
      serverReason = localRecognitionFailed ? 'server-lines（本地识别失败，已用服务端行）' : 'server-skip（已够用）';
    } else {
      // a) 服务端 OCR 兜底：开关打开 + 有密钥才会上传；熔断冷却期内直接跳过（不付任何等待）。
      //    本地识别失败时这里用上面的预取结果 —— 一次扫票最多上传一次。
      const remote = prefetched ?? (await tryReceiptRemote(imageUri, imageBase64, parsed, learnedLabels));
      if (remote.lines) {
        serverLines = remote.lines;
        serverPasses = 1;
      }
      serverReason = remote.reason;
      // 先算采用与否，再决定用哪份数据（避免「服务端更差也覆盖本地」）
      const adoptPre = !!remote.parsed && remote.parsed.amount !== null && true;
      // 采用规则：服务端更自信，或本地本来就来自弱档 → 用服务端结果
      const localWeak = isWeakAmountTier(parsed.amountTier);
      const adoptServer = adoptPre && (remote.parsed!.confidence > parsed.confidence || localWeak);
      // 金额没救回来，但服务端读到了日期/分类/商户时，这些字段仍然有价值（不影响金额可信度）
      if (!adoptServer && remote.parsed) {
        if (!date && remote.parsed.date) date = remote.parsed.date;
        if (!merchant && remote.parsed.merchant) { merchant = remote.parsed.merchant; merchantConfident = remote.parsed.merchantConfident ?? false; }
        if (!suggestedCategory && remote.parsed.suggestedCategory) suggestedCategory = remote.parsed.suggestedCategory;
      }
      const active = adoptServer ? remote.parsed! : parsed;
      // 本地识别失败时数据一律来自服务端行；否则只有「真的采用了服务端那份」才记 server
      if (localRecognitionFailed || (remote.parsed && adoptServer)) ocrSource = 'server';
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
    }

    // c) 两条兜底都过完了：把这次走的路径落盘，识别不准时可到「关于应用」定位。
    //    这里同时带上服务端真正给了多少行 / 走过几轮（单行、不换行 —— 关于页那行直接展示）
    void AsyncStorage.setItem(
      LAST_AI_DIAG_KEY,
      'stage=scan ocrSource=' + ocrSource + ' server=' + serverReason + ' ai=' + aiReason +
        ' serverLines=' + (serverLines?.length ?? 0) + ' passes=' + serverPasses,
    ).catch(() => undefined);

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
    // 备注建议（纯函数、只出文案）：界面做成「点击填入」占位提示，绝不自动写进备注
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
      // 服务端证据：只有真有服务端结果时才有值
      remoteLines: serverLines ?? undefined,
      serverPasses,
    };
  } catch (e) {
    // 已经翻译过的错误（含「本地识别失败且服务端也没拿到行」）原样抛出，不再二次包装成 ocr-failed
    if (e instanceof ReceiptScanError) {
      void AsyncStorage.setItem(
        LAST_AI_DIAG_KEY,
        'stage=failed code=' + e.code + ' reason=' + String(e.message).slice(0, 140) +
          ' serverLines=' + (serverLines?.length ?? 0) + ' passes=' + serverPasses,
      ).catch(() => undefined);
      throw e;
    }
    const code = e instanceof ReceiptOcrError ? e.code : 'ocr-failed';
    // 失败也要留下证据：这次是「识别层失败」还是「解析后金额为空」
    void AsyncStorage.setItem(
      LAST_AI_DIAG_KEY,
      'stage=failed code=' + code + ' reason=' + String(e instanceof Error ? e.message : e).slice(0, 140) +
        ' serverLines=' + (serverLines?.length ?? 0) + ' passes=' + serverPasses,
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
