// formFilePart.ts —— 把本地图片文件变成能放进 FormData 的「文件部件」。
//
// 为什么需要它：Expo SDK 52+ 起全局 fetch / FormData 换成了 expo 自己的实现（expo/src/winter），
// 它**不再支持** React Native 老式的 { uri, name, type } 文件写法，上传时直接抛
// 「Unsupported FormDataPart implementation」（源码注释：`uri` is not supported）。
// 症状：所有 multipart 上传（扫票的 /ocr/*、凭证 /api/receipts）在发出请求之前就失败，
// 服务器上看不到任何请求。必须改用 expo-file-system 的 File（实现了 Blob 接口，带 bytes()）。
import { File } from 'expo-file-system';

/** 本地 uri → FormData 文件部件。接受 file:// uri 或绝对路径。 */
export function makeFilePart(localUri: string): Blob {
  const uri = /^[a-z][a-z0-9+.-]*:/i.test(localUri) ? localUri : 'file://' + localUri;
  return new File(uri) as unknown as Blob;
}
