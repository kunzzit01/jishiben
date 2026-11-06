// receiptOcr.ts —— 用设备本地的 ML Kit 文本识别（中文模型）读小票，再交给纯规则解析。
// 完全离线：不调用任何 AI API、不需要 key、不产生费用、不把图片上传到服务器。
import { Platform } from 'react-native';
import { parseReceiptLines, type ParsedReceipt } from './receiptParse';

export class ReceiptOcrError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReceiptOcrError';
    this.code = code;
  }
}

type Recognizer = (uri: string) => Promise<string[]>;

/** 当前安装包是否带本地识别模块（老 APK 走 OTA 拿到新 JS 时会是 false）。 */
export function isLocalOcrAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-ml-kit/text-recognition');
    return !!((mod?.default ?? mod)?.recognize);
  } catch {
    return false;
  }
}

let recognizer: Recognizer | null = null;

/** 惰性加载原生模块：Web/未安装原生模块时给出可读错误，而不是崩溃 */
function getRecognizer(): Recognizer {
  if (recognizer) return recognizer;
  if (Platform.OS === 'web') {
    throw new ReceiptOcrError('unsupported-platform', 'Web 端不支持本地 OCR');
  }
  let mod: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('@react-native-ml-kit/text-recognition');
  } catch {
    throw new ReceiptOcrError('ocr-unavailable', '当前安装包不含 OCR 模块，请更新 App');
  }
  const TextRecognition = mod?.default ?? mod;
  const Script = mod?.TextRecognitionScript;
  if (!TextRecognition?.recognize) {
    throw new ReceiptOcrError('ocr-unavailable', 'OCR 模块加载失败');
  }
  recognizer = async (uri: string) => {
    const result = await TextRecognition.recognize(uri, Script?.CHINESE);
    const lines: string[] = [];
    for (const block of result?.blocks ?? []) {
      for (const line of block?.lines ?? []) {
        if (line?.text) lines.push(String(line.text));
      }
    }
    if (lines.length === 0 && result?.text) lines.push(...String(result.text).split('\n'));
    return lines;
  };
  return recognizer;
}

/** 识别一张本地图片 → 记账字段。失败抛 ReceiptOcrError（界面据此提示或让用户手填）。 */
export async function scanReceiptLocally(uri: string): Promise<ParsedReceipt> {
  const recognize = getRecognizer();
  let lines: string[];
  try {
    lines = await recognize(uri);
  } catch (e) {
    if (e instanceof ReceiptOcrError) throw e;
    throw new ReceiptOcrError('ocr-failed', String((e as Error)?.message ?? e));
  }
  if (lines.length === 0) {
    throw new ReceiptOcrError('no-text', '这张图里没有识别到文字');
  }
  return parseReceiptLines(lines);
}
