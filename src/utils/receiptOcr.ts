// receiptOcr.ts —— 用设备本地的 ML Kit 文本识别（中文模型）读小票，再交给纯规则解析。
// 完全离线：不调用任何 AI API、不需要 key、不产生费用、不把图片上传到服务器。
import { Platform } from 'react-native';
import { parseReceiptOcr, type OcrLine, type ParsedReceipt } from './receiptParse';

export class ReceiptOcrError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReceiptOcrError';
    this.code = code;
  }
}

type Recognizer = (uri: string) => Promise<OcrLine[]>;

/** 当前安装包是否带本地识别模块（老 APK 走 OTA 拿到新 JS 时会是 false）。 */
export function isLocalOcrAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    // 关键：JS 侧的 recognize 永远是函数（它只是转调原生），所以必须看**原生模块有没有注册**。
    // 只看 JS 导出会在「原生没链接/R8 裁掉」时误判为可用，然后在识别时报错。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    const native = NativeModules?.TextRecognition;
    return !!(native && typeof native.recognize === 'function');
  } catch {
    return false;
  }
}

/** 诊断用：把「JS 包是否存在 / 原生模块是否注册 / 错误原文」合成一行，显示在关于页 */
export function describeLocalOcr(): string {
  if (Platform.OS === 'web') return 'web-unsupported';
  let jsOk = false;
  let jsErr = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-ml-kit/text-recognition');
    jsOk = !!((mod?.default ?? mod)?.recognize);
  } catch (e) {
    jsErr = String((e as Error)?.message ?? e).slice(0, 40);
  }
  let native = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NativeModules } = require('react-native');
    native = typeof NativeModules?.TextRecognition?.recognize === 'function';
  } catch {
    native = false;
  }
  return 'js=' + (jsOk ? '1' : '0') + ' native=' + (native ? '1' : '0') + (jsErr ? ' err=' + jsErr : '');
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
    const lines: OcrLine[] = [];
    for (const block of result?.blocks ?? []) {
      for (const line of block?.lines ?? []) {
        if (!line?.text) continue;
        // 保留版面坐标：解析时要靠它把「标签」和右侧「金额」配成一行
        const frame = line.frame ?? line.cornerPoints?.[0];
        lines.push({
          text: String(line.text),
          top: typeof frame?.top === 'number' ? frame.top : undefined,
          left: typeof frame?.left === 'number' ? frame.left : undefined,
          width: typeof frame?.width === 'number' ? frame.width : undefined,
          height: typeof frame?.height === 'number' ? frame.height : undefined,
        });
      }
    }
    if (lines.length === 0 && result?.text) {
      lines.push(...String(result.text).split('\n').map((text) => ({ text })));
    }
    return lines;
  };
  return recognizer;
}

/** 识别一张本地图片 → 记账字段。失败抛 ReceiptOcrError（界面据此提示或让用户手填）。 */
export async function scanReceiptLocally(uri: string, base64?: string): Promise<ParsedReceipt> {
  const recognize = getRecognizer();
  let lines: OcrLine[] = [];
  const errors: string[] = [];

  // 依次尝试：原 URI → 去掉 file:// 的路径 → 用 base64 写临时文件
  const attempts: string[] = [];
  if (uri) {
    attempts.push(uri);
    if (uri.startsWith('file://')) attempts.push(uri.replace('file://', ''));
  }
  for (const candidate of attempts) {
    try {
      lines = await recognize(candidate);
      break;
    } catch (e) {
      errors.push(String((e as Error)?.message ?? e));
    }
  }

  if (lines.length === 0 && base64) {
    try {
      const FileSystem = require('expo-file-system');
      const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      const tmp = dir + 'receipt-' + Date.now() + '.jpg';
      await FileSystem.writeAsStringAsync(tmp, base64, { encoding: 'base64' });
      lines = await recognize(tmp);
    } catch (e) {
      errors.push(String((e as Error)?.message ?? e));
    }
  }

  if (lines.length === 0 && errors.length > 0) {
    // 把原生错误原文带出去一层，便于界面/反馈里定位（截断避免刷屏）
    throw new ReceiptOcrError('ocr-failed', errors[0].slice(0, 160));
  }
  if (lines.length === 0) {
    throw new ReceiptOcrError('no-text', '这张图里没有识别到文字');
  }
  return parseReceiptOcr(lines);
}
