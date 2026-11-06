// 端侧 Gemini Nano（ML Kit GenAI Prompt API）的 JS 封装。
// 只做薄封装：真正的判断（是否可用 / 是否允许下载）都在原生侧，JS 不做任何兜底造假。
const { NativeModules } = require('react-native');

const Native = NativeModules.GeminiNano;

// 原生模块缺失（如 web / 旧安装包）时统一返回"不可用"，避免调用方 try/catch 满天飞。
const MISSING = 'GeminiNano native module 未注册';

function isReady() {
  if (!Native) return Promise.resolve(false);
  return Native.isReady();
}

// 诊断用：返回 AVAILABLE / DOWNLOADABLE / DOWNLOADING / UNAVAILABLE / 错误串
function status() {
  if (!Native) return Promise.resolve('MISSING: ' + MISSING);
  return Native.status();
}

// promptText: 文本提示；imageUri: 图片 URI（可为 null）；timeoutMs: 超时（毫秒，可为 null 走默认值）
// 失败时 reject 的 error.code 稳定为 AI_UNAVAILABLE / AI_TIMEOUT / AI_ERROR
function generate(promptText, imageUri = null, timeoutMs = 0) {
  if (!Native) {
    const err = new Error(MISSING);
    err.code = 'AI_UNAVAILABLE';
    return Promise.reject(err);
  }
  return Native.generate(promptText, imageUri, timeoutMs);
}

module.exports = { isReady, status, generate };
