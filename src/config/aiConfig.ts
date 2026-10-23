// aiConfig.ts —— AI（OpenRouter）接入配置
//
// ⚠ 安全基线（本次改造）：**这里不再保存任何明文密钥**。
//   密钥只从构建期环境变量读取，Expo 会把 EXPO_PUBLIC_ 前缀的变量内联进包：
//
//   本地开发：仓库根目录 .env（已被 .gitignore 忽略，禁止提交）
//     EXPO_PUBLIC_OPENROUTER_API_KEY=sk-or-...
//     EXPO_PUBLIC_AI_MODEL=anthropic/claude-sonnet-4.5   （可选，缺省用下面的值）
//   EAS / 发布构建：在项目 Secrets（或 eas.json 的环境段）里配置同名变量。
//
// 没有配置时：
//   - OPENROUTER_API_KEY === ''（既有的「未配置」判断继续成立，utils 层不会发请求）；
//   - isAiConfigured === false —— 界面（扫小票 / 语音记账）用它提前给出「不可用」提示，
//     不会打开相机、也不会抛出未捕获异常。降级路径 = 手动记账 + 小票拍照留档，业务不受影响。
//
// 正式上架前建议改成「经自己的服务器中转」，不要让 APP 直接带着密钥调用第三方。

declare const process: { env: Record<string, string | undefined> };

/** OpenRouter API Key（来自 EXPO_PUBLIC_OPENROUTER_API_KEY；未配置 = 空字符串） */
export const OPENROUTER_API_KEY: string = (process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '').trim();

/** 使用的模型名（来自 EXPO_PUBLIC_AI_MODEL；可在 OpenRouter 控制台确认最新可用名称） */
export const AI_MODEL: string = (process.env.EXPO_PUBLIC_AI_MODEL ?? 'anthropic/claude-sonnet-4.5').trim();

/** AI 能力是否可用（界面据此决定「直接给出不可用提示」还是「真的去识别」） */
export const isAiConfigured: boolean = OPENROUTER_API_KEY.length > 0;
