// aiConfig.ts —— AI（小票识别）客户端开关
//
// 安全基线：APP 包里**不再有任何第三方密钥**。
//   小票识别走自家后端 POST /api/ai/receipt-scan，OpenRouter 密钥只存在于服务器环境变量
//   （OPENROUTER_API_KEY），永远不会被 Expo 内联进 bundle。
//
// isAiConfigured 仍保持同步 boolean：界面（扫小票 / 语音记账）在打开相机前用它做一次
// 「不可用」判断，而界面文件不在本次改动范围内。语义已改为：
//   true  = 允许尝试识别。真正的可用性只有后端知道（服务器是否配了密钥）；
//           未配置时后端返回 503 AI_NOT_CONFIGURED，utils/scanReceipt.ts 会把它翻译成
//           可读提示并降级为手动记账，不会崩。
//   不要再根据 EXPO_PUBLIC_ 密钥判断可用性 —— 那等于把密钥重新塞回包里。

declare const process: { env: Record<string, string | undefined> };

/**
 * 旧版直连 OpenRouter 用的构建期变量。**小票识别已完全不再读它**。
 *
 * 目前只剩 utils/voiceAccounting.ts（语音记账）还在直连 OpenRouter，属于已知的待迁移项，
 * 不在本次范围内；一旦语音也迁到后端，这两个常量就可以整段删除。
 * 发布构建不要再设置 EXPO_PUBLIC_OPENROUTER_API_KEY。
 */
export const OPENROUTER_API_KEY: string = (process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '').trim();

/** @deprecated 同上，仅为 voiceAccounting.ts 保留。 */
export const AI_MODEL: string = (process.env.EXPO_PUBLIC_AI_MODEL ?? 'anthropic/claude-sonnet-4.5').trim();

/**
 * AI 能力是否可用（界面据此决定「直接给出不可用提示」还是「真的去识别」）。
 * 现在由后端决定：客户端一律允许尝试，未配置时以 503 AI_NOT_CONFIGURED 降级。
 */
export const isAiConfigured: boolean = true;
