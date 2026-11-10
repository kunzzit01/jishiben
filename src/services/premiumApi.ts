// 会员订阅接口。身份规则：
// - 已登录：只用账号身份（Bearer），不带游客凭证；
// - 未登录：带本机游客凭证；查询状态时没有凭证就匿名查询，不会为此创建游客身份；
//   只有申请、购买、恢复购买、会员扫描等动作才按需创建游客身份。
// 游客凭证存 SecureStore（Android Keystore 加密）；Web 没有 SecureStore 才退回 AsyncStorage。
// 凭证和购买 token 不写日志、不放 URL。
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { authorizedRequest } from './apiClient';
import { getSession } from './sessionStore';

export type PremiumFeature = 'scan' | 'financialPlan' | 'addLedger' | 'exchange';
export type BasePlan = 'monthly' | 'yearly';
export type BillingMode = 'SANDBOX' | 'GOOGLE_PLAY' | 'NONE';

export interface PremiumSubscription {
  id: string;
  provider: 'SANDBOX' | 'GOOGLE_PLAY';
  basePlan: BasePlan;
  state: string;
  expiresAt?: string | null;
  autoRenew: boolean;
  revision: number;
  acknowledged: boolean;
  testPurchase: boolean;
  refundedAt?: string | null;
  refundType?: string | null;
}

export interface PremiumStatus {
  implemented: boolean;
  active: boolean;
  administrator: boolean;
  /** null：匿名（还没有任何订阅身份） */
  subjectId: string | null;
  obfuscatedAccountId: string | null;
  mode: BillingMode;
  environment: 'staging' | 'production';
  googleEnabled: boolean;
  enrollmentOpen: boolean;
  sandboxAvailable: boolean;
  gatesEnabled: boolean;
  serverTime: string;
  expiresAt?: string | null;
  capabilities: Record<PremiumFeature | 'reminders', boolean>;
  subscriptions: PremiumSubscription[];
}

export interface BillingSettings { enrollmentOpen: boolean; sandboxOpen: boolean; gatesEnabled: boolean }
export interface BillingEvent {
  at: string; type: string; subscriptionId?: string | null; fromState?: string | null; toState?: string | null;
  actorId?: number | null; detail?: string | null;
}
export interface BillingConsole {
  settings: BillingSettings;
  environment: 'staging' | 'production';
  sandboxAllowed: boolean;
  googleEnabled: boolean;
  subscriptions: { subscription: PremiumSubscription; subjectId: string; identity: string }[];
  events: BillingEvent[];
  alerts: string[];
}

const GUEST_KEY = 'jizhang.premiumGuest';
const LEGACY_GUEST_KEY = '@jizhang/premiumGuest';
const secure = Platform.OS !== 'web';

async function readStored(): Promise<string | null> {
  if (secure) {
    const value = await SecureStore.getItemAsync(GUEST_KEY);
    if (value) return value;
    // 旧版本（未发布的首版补丁）写在 AsyncStorage：搬进 SecureStore 后删除明文副本
    const legacy = await AsyncStorage.getItem(LEGACY_GUEST_KEY);
    if (legacy) {
      await SecureStore.setItemAsync(GUEST_KEY, legacy);
      await AsyncStorage.removeItem(LEGACY_GUEST_KEY);
    }
    return legacy;
  }
  return AsyncStorage.getItem(LEGACY_GUEST_KEY);
}

async function writeStored(token: string | null): Promise<void> {
  if (secure) {
    if (token) await SecureStore.setItemAsync(GUEST_KEY, token);
    else await SecureStore.deleteItemAsync(GUEST_KEY);
    await AsyncStorage.removeItem(LEGACY_GUEST_KEY);
    return;
  }
  if (token) await AsyncStorage.setItem(LEGACY_GUEST_KEY, token);
  else await AsyncStorage.removeItem(LEGACY_GUEST_KEY);
}

let guestFlight: Promise<string> | undefined;

/** 本机游客凭证；create=true 时没有就向服务端申请一个（只在需要订阅身份的动作里用）。 */
export async function guestToken(create = false): Promise<string | null> {
  const saved = await readStored();
  if (saved || !create) return saved;
  if (!guestFlight) {
    guestFlight = authorizedRequest<{ token: string }>('POST', '/api/premium/guest', { auth: false })
      .then(async ({ token }) => { await writeStored(token); return token; })
      .finally(() => { guestFlight = undefined; });
  }
  return guestFlight;
}

export async function forgetGuestToken(): Promise<void> {
  await writeStored(null);
}

async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, createGuest = false): Promise<T> {
  const signedIn = Boolean(getSession());
  const token = signedIn ? null : await guestToken(createGuest);
  return authorizedRequest<T>(method, '/api' + path, {
    auth: signedIn, body, headers: token ? { 'X-Premium-Guest-Token': token } : {},
  });
}

export const requestKey = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);

export const premiumApi = {
  status: () => call<PremiumStatus>('GET', '/premium/status'),
  /** 本机游客身份的状态（登录后判断要不要提示绑定）；没有游客凭证返回 null。 */
  guestStatus: async (): Promise<PremiumStatus | null> => {
    const token = await guestToken(false);
    if (!token) return null;
    return authorizedRequest<PremiumStatus>('GET', '/api/premium/status', {
      auth: false, headers: { 'X-Premium-Guest-Token': token },
    });
  },
  apply: (basePlan: BasePlan, key: string) =>
    call<PremiumStatus>('POST', '/premium/sandbox/apply', { basePlan, requestKey: key }, true),
  cancel: (subscription: PremiumSubscription, key: string) =>
    call<PremiumStatus>('POST', '/premium/sandbox/' + encodeURIComponent(subscription.id) + '/cancel', {
      event: 'CANCEL', requestKey: key, expectedRevision: subscription.revision,
    }),
  /** 买之前确保有订阅身份（obfuscatedAccountId 要用它）。 */
  ensureIdentity: () => call<PremiumStatus>('GET', '/premium/status', undefined, true),
  verify: (purchaseToken: string, restore = false, claim = false) =>
    call<PremiumStatus>('POST', '/premium/google/' + (restore ? 'restore' : 'verify'), { purchaseToken, claim }, true),
  console: () => call<BillingConsole>('GET', '/admin/premium'),
  settings: (settings: BillingSettings) => call<BillingConsole>('PUT', '/admin/premium/settings', settings),
  event: (subscription: PremiumSubscription, event: string, key: string) =>
    call<BillingConsole>('POST', '/admin/premium/' + encodeURIComponent(subscription.id) + '/events', {
      event, requestKey: key, expectedRevision: subscription.revision,
    }),
  /** 主动把本机游客订阅绑定到当前账号；成功后本机游客凭证作废。 */
  claimGuest: async (): Promise<PremiumStatus | null> => {
    const token = await guestToken(false);
    if (!token || !getSession()) return null;
    const status = await call<PremiumStatus>('POST', '/premium/claim', { token });
    await forgetGuestToken();
    return status;
  },
};
