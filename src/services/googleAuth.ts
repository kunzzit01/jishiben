// googleAuth.ts —— 默认（Web）实现：第一版 Web 不做 Google 登录。
// Metro 在 Android/iOS 会优先解析 googleAuth.native.ts，因此这里只是给 TS 与 Web 兜底，
// 保证不会把不支持的原生模块打进 Web 包。
export type GoogleIdTokenResult =
  | { kind: 'ok'; idToken: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: string };

export const GOOGLE_SIGN_IN_SUPPORTED = false;

export async function getGoogleIdToken(): Promise<GoogleIdTokenResult> {
  return { kind: 'error', reason: 'unsupported-platform' };
}

/** Web 第一版没有 Google 会话需要清理 */
export async function signOutGoogle(): Promise<void> {
  /* no-op */
}
