import { ApiError, api } from '../services/apiClient';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * 语音记账（录音 → 转写 → 记账字段）。
 *
 * 录音只发给**自家后端** POST /api/ai/voice-parse：转写与解析都由服务器完成，OpenRouter 的
 * 密钥留在服务器环境变量里，不再内联进 APP 包（旧实现由客户端直连第三方 STT 与 chat 端点，
 * 任何人解包都能盗用密钥）。
 */
export interface VoiceAccountingResult {
  amount: number | null;
  merchant: string | null;
  date: string | null;
  type: 'expense' | 'income';
  suggestedCategory: string | null;
  note: string | null;
  transcript: string;
}

/** 语音记账失败的稳定信号：界面按 message 提示，按 code 决定是「重试」还是「手动记账」。 */
export class VoiceAccountingError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VoiceAccountingError';
    this.code = code;
  }
}

/** 服务端没配密钥（503 AI_NOT_CONFIGURED）：界面据此降级为手动记账。 */
export function isVoiceAiUnavailable(e: unknown): boolean {
  return e instanceof VoiceAccountingError && e.code === 'AI_NOT_CONFIGURED';
}

function codeOf(e: unknown): string | null {
  if (e instanceof VoiceAccountingError) return e.code;
  if (e instanceof ApiError) return typeof e.code === 'string' ? e.code : null;
  return null;
}

/** 把后端错误码翻译成用户能读懂的一句话；不把任何第三方原始报错透给用户。 */
function toReadableMessage(e: unknown): string {
  switch (codeOf(e)) {
    case 'AI_NOT_CONFIGURED':
      return '服务端还没有配置语音记账服务，暂时无法自动解析。你仍可手动记账。';
    case 'PAYLOAD_TOO_LARGE':
      return '这段录音太长了，请说得短一些再试，或手动记账。';
    case 'VALIDATION_FAILED':
    case 'BAD_REQUEST':
      return '这段录音没能识别，请重新录一次，或手动记账。';
    case 'AI_UPSTREAM_TIMEOUT':
    case 'TIMEOUT':
      return '语音解析超时了，请检查网络后再试，或手动记账。';
    case 'AI_UPSTREAM_ERROR':
    case 'UPSTREAM_ERROR':
      return '语音解析服务暂时不可用，请稍后再试，或手动记账。';
    case 'NETWORK_ERROR':
      return '网络连接失败，请检查网络后再试，或手动记账。';
    case 'UNAUTHORIZED':
    case 'TOKEN_EXPIRED':
    case 'TOKEN_INVALID':
    case 'TOKEN_REVOKED':
      return '登录状态已失效，请重新登录后再试。';
    default:
      return e instanceof Error && e.message ? e.message : '语音记账失败，请重试或手动记账。';
  }
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function fileToBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

/** 录音容器：服务端有白名单，这里只报实际录到的格式。 */
function formatOf(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.wav')) return 'wav';
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.aac')) return 'aac';
  if (lower.endsWith('.flac')) return 'flac';
  if (lower.endsWith('.ogg')) return 'ogg';
  if (lower.endsWith('.webm')) return 'webm';
  return 'm4a';
}

async function parseVoice(uri: string): Promise<VoiceAccountingResult> {
  const base64Audio = await fileToBase64(uri);

  let dto;
  try {
    dto = await api.aiVoiceParse(base64Audio, formatOf(uri));
  } catch (e) {
    throw new VoiceAccountingError(codeOf(e) ?? 'INTERNAL_ERROR', toReadableMessage(e));
  }

  const transcript = textOrNull(dto?.transcript);
  if (!transcript) {
    throw new VoiceAccountingError('AI_UPSTREAM_ERROR', '没有识别到语音内容，请再说一次');
  }

  return {
    // 服务端用 BigDecimal 传金额，JSON 里是数字；其它类型一律当作「没识别到」
    amount: typeof dto?.amount === 'number' && Number.isFinite(dto.amount) ? dto.amount : null,
    merchant: textOrNull(dto?.merchant),
    date: textOrNull(dto?.date),
    type: dto?.type === 'income' ? 'income' : 'expense',
    suggestedCategory: textOrNull(dto?.suggestedCategory),
    note: textOrNull(dto?.note) ?? textOrNull(dto?.merchant),
    transcript,
  };
}

/** 语音 → 记账字段（服务端一次完成转写与解析）。 */
export async function voiceToAccounting(uri: string): Promise<VoiceAccountingResult> {
  return parseVoice(uri);
}

/**
 * 只取语音转写文本（云端 ASR），不改动记账解析的部分。
 * 与 voiceToAccounting 走**同一个**后端端点：转写是服务端两步里的第一步，
 * 这里只是把第一步的结果单独交给调用方（本地 AI 路径用文字再走端侧模型）。
 */
export async function transcribeAudioFile(uri: string): Promise<string> {
  return (await parseVoice(uri)).transcript;
}
