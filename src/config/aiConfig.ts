// aiConfig.ts —— AI 客户端开关
//
// 安全基线：APP 包里**不再有任何第三方密钥，也不再直连任何第三方 AI 域名**。
//   小票识别 → POST /api/ai/receipt-scan
//   语音记账 → POST /api/ai/voice-parse
//   两条线都由自家后端中转，OpenRouter 密钥只存在于服务器环境变量（OPENROUTER_API_KEY），
//   永远不会被 Expo 内联进 bundle —— 解包也拿不到可盗用的东西。
//
// isAiConfigured 仍保持同步 boolean：界面（扫小票 / 语音记账）在打开相机或录音前用它做一次
// 「不可用」判断，而界面文件不在本次改动范围内。语义已改为：
//   true  = 允许尝试识别。真正的可用性只有后端知道（服务器是否配了密钥）；
//           未配置时后端返回 503 AI_NOT_CONFIGURED，utils/scanReceipt.ts 与
//           utils/voiceAccounting.ts 会把它翻译成可读提示并降级为手动记账，不会崩。
//   不要再根据 EXPO_PUBLIC_ 密钥判断可用性 —— 那等于把密钥重新塞回包里。

/**
 * AI 能力是否可用（界面据此决定「直接给出不可用提示」还是「真的去识别」）。
 * 现在由后端决定：客户端一律允许尝试，未配置时以 503 AI_NOT_CONFIGURED 降级。
 */
export const isAiConfigured: boolean = true;
