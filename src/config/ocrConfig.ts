// ocrConfig.ts —— 服务端 OCR 的**内置**配置（用户无需开开关、无需填密钥）。
//
// 产品决定（2026-11-06）：扫票要「自动」，不把开关和密钥暴露给用户。
// 上传行为：只有本地识别拿不准时才上传，最多 6 秒超时，失败 10 分钟内不再尝试。
// 密钥来自我们自己的 OCR 服务（POST /ocr/lines 的 X-OCR-Key）。
// 构建时可用 EXPO_PUBLIC_OCR_KEY 覆盖；换密钥无需改代码即可重新打包。
export const SERVER_OCR_ENABLED = true;
export const SERVER_OCR_KEY: string =
  process.env.EXPO_PUBLIC_OCR_KEY ?? '13e669f1a256bdcf9b5037b60d04fb55';
