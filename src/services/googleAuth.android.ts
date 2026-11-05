// googleAuth.native.ts —— Android/iOS 原生 Google 登录，唯一职责是「拿到 Google ID Token」。
// 业务登录一律走自家 /api/auth/google，Google SDK 是否还有账号缓存与本系统是否登录无关。
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';

/** 结果三分：拿到 token / 用户主动取消 / 其他失败（附可读原因） */
export type GoogleIdTokenResult =
  | { kind: 'ok'; idToken: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: string };

let configured = false;

function configure() {
  if (configured) return;
  const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  // webClientId 必须填 Web application 的 Client ID：Android 端拿 ID Token 时的受众就是它，
  // 后端用同一个值做 audience 校验。填 Android Client ID 会导致后端校验必失败。
  GoogleSignin.configure({ webClientId, offlineAccess: false });
  configured = true;
}

export async function getGoogleIdToken(): Promise<GoogleIdTokenResult> {
  const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  if (!webClientId) return { kind: 'error', reason: 'missing-web-client-id' };
  try {
    configure();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    // v13+ 返回 { type: 'success'|'cancelled', data }；老版本直接返回 user 字段
    const anyResult = result as unknown as { type?: string; data?: { idToken?: string | null }; idToken?: string | null };
    if (anyResult.type === 'cancelled') return { kind: 'cancelled' };
    const idToken = anyResult.data?.idToken ?? anyResult.idToken ?? null;
    if (!idToken) return { kind: 'error', reason: 'no-id-token' };
    return { kind: 'ok', idToken };
  } catch (e) {
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) {
      return { kind: 'cancelled' };
    }
    if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return { kind: 'error', reason: 'play-services-unavailable' };
    }
    // 把 Play Services 的错误码带出来：10=DEVELOPER_ERROR / 12500=需登录 / 12501=取消 / 12502=进行中
    const code = isErrorWithCode(e) ? String(e.code) : 'n/a';
    return { kind: 'error', reason: `code=${code} ${String((e as Error)?.message ?? e)}` };
  }
}

export const GOOGLE_SIGN_IN_SUPPORTED = true;
