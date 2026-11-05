// googleAuth.web.ts —— 第一版 Web 不做 Google 登录（方案 §1：不给可点击的假入口）。
// 后续接入 Google Identity Services 时，同一后端接口可直接复用。
export type GoogleIdTokenResult =
  | { kind: 'ok'; idToken: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: string };

export async function getGoogleIdToken(): Promise<GoogleIdTokenResult> {
  return { kind: 'error', reason: 'unsupported-platform' };
}

export const GOOGLE_SIGN_IN_SUPPORTED = false;
