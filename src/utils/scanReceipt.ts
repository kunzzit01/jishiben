import { ApiError, api } from '../services/apiClient';

/**
 * 小票识别（扫票 → 预填金额/分类）。
 *
 * 图片只发给**自家后端** POST /api/ai/receipt-scan：OpenRouter 的密钥留在服务器环境变量里，
 * 不再内联进 APP 包（旧实现由客户端直连第三方 AI 服务，任何人解包都能盗用密钥）。
 */
export interface ScannedReceipt {
  amount: number | null;
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  type: 'expense' | 'income'; // 识别不准默认 expense
  suggestedCategory: string | null; // 中文分类名，例如"餐饮"或"工资"
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

/** AI 在小票识别上是否可用：后端未配置密钥时返回 503 AI_NOT_CONFIGURED，据此降级。 */
export function isAiUnavailable(e: unknown): boolean {
  return e instanceof ReceiptScanError && e.code === 'AI_NOT_CONFIGURED';
}

function codeOf(e: unknown): string | null {
  if (e instanceof ReceiptScanError) return e.code;
  if (e instanceof ApiError) return typeof e.code === 'string' ? e.code : null;
  return null;
}

/** 把后端的错误码翻译成用户能读懂的一句话；不把任何第三方原始报错透给用户。 */
function toReadableMessage(e: unknown): string {
  switch (codeOf(e)) {
    case 'AI_NOT_CONFIGURED':
      return '服务端还没有配置小票识别服务，暂时无法自动识别。你仍可手动记账，或给小票拍照留档。';
    case 'PAYLOAD_TOO_LARGE':
      return '这张照片太大了，请压缩后再试，或手动记账。';
    case 'VALIDATION_FAILED':
    case 'BAD_REQUEST':
      return '这张照片没能识别成图片，请重新拍一张，或手动记账。';
    case 'AI_UPSTREAM_TIMEOUT':
    case 'TIMEOUT':
      return '识别超时了，请检查网络后再试，或手动记账。';
    case 'AI_UPSTREAM_ERROR':
    case 'AI_UNAVAILABLE':
    case 'UPSTREAM_ERROR':
      return '识别服务暂时不可用，请稍后再试，或手动记账。';
    case 'NETWORK_ERROR':
      return '网络连接失败，请检查网络后再试，或手动记账。';
    case 'UNAUTHORIZED':
    case 'TOKEN_EXPIRED':
    case 'TOKEN_INVALID':
    case 'TOKEN_REVOKED':
      return '登录状态已失效，请重新登录后再试。';
    default:
      return e instanceof Error && e.message ? e.message : '小票识别失败，请重试或手动记账。';
  }
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function scanReceipt(base64Image: string): Promise<ScannedReceipt> {
  if (!base64Image || !base64Image.trim()) {
    throw new ReceiptScanError('VALIDATION_FAILED', '没有拿到照片内容，请重新拍一张。');
  }

  let dto;
  try {
    dto = await api.aiScanReceipt(base64Image);
  } catch (e) {
    throw new ReceiptScanError(codeOf(e) ?? 'INTERNAL_ERROR', toReadableMessage(e));
  }

  return {
    // 服务端用 BigDecimal 传金额，JSON 里是数字；其它类型一律当作「没识别到」
    amount: typeof dto?.amount === 'number' && Number.isFinite(dto.amount) ? dto.amount : null,
    merchant: textOrNull(dto?.merchant),
    date: textOrNull(dto?.date),
    type: dto?.type === 'income' ? 'income' : 'expense',
    suggestedCategory: textOrNull(dto?.suggestedCategory),
  };
}
