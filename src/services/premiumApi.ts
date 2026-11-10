import AsyncStorage from '@react-native-async-storage/async-storage';
import { authorizedRequest } from './apiClient';
import { getSession } from './sessionStore';

export type PremiumFeature = 'scan' | 'financialPlan' | 'addLedger' | 'exchange';
export type BasePlan = 'monthly' | 'yearly';
export interface PremiumSubscription {
  id: string; provider: 'SANDBOX' | 'GOOGLE_PLAY'; basePlan: BasePlan; state: string;
  expiresAt?: string; autoRenew: boolean; revision: number; acknowledged: boolean;
}
export interface PremiumStatus {
  implemented: boolean; active: boolean; administrator: boolean; subjectId: string;
  obfuscatedAccountId: string; mode: 'SANDBOX' | 'GOOGLE_PLAY'; enrollmentOpen: boolean;
  sandboxAvailable: boolean; gatesEnabled: boolean; serverTime: string; expiresAt?: string;
  capabilities: Record<PremiumFeature | 'reminders', boolean>; subscriptions: PremiumSubscription[];
}
export interface BillingSettings { enrollmentOpen: boolean; sandboxOpen: boolean; gatesEnabled: boolean }
export interface BillingConsole {
  settings: BillingSettings; sandboxAllowed: boolean;
  subscriptions: { subscription: PremiumSubscription; subjectId: string; identity: string }[];
}
const GUEST_KEY = '@jizhang/premiumGuest';
let guestFlight: Promise<string> | undefined;
// No billing secrets or purchase tokens are written to logs or URLs.
export async function guestToken(create = true): Promise<string | null> {
  const saved = await AsyncStorage.getItem(GUEST_KEY);
  if (saved || !create) return saved;
  if (!guestFlight) guestFlight = authorizedRequest<{ token: string }>('POST', '/api/premium/guest', { auth: false })
    .then(async ({ token }) => { await AsyncStorage.setItem(GUEST_KEY, token); return token; })
    .finally(() => { guestFlight = undefined; });
  return guestFlight;
}
async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const signedIn = Boolean(getSession());
  const token = signedIn ? null : await guestToken();
  return authorizedRequest<T>(method, '/api' + path, {
    auth: signedIn, body, headers: token ? { 'X-Premium-Guest-Token': token } : {},
  });
}
export const requestKey = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
export const premiumApi = {
  status: () => call<PremiumStatus>('GET', '/premium/status'),
  apply: (basePlan: BasePlan, key: string) => call<PremiumStatus>('POST', '/premium/sandbox/apply', { basePlan, requestKey: key }),
  cancel: (subscription: PremiumSubscription, key: string) => call<PremiumStatus>('POST', '/premium/sandbox/' + subscription.id + '/cancel', {
    event: 'CANCEL', requestKey: key, expectedRevision: subscription.revision,
  }),
  verify: (purchaseToken: string, restore = false) => call<PremiumStatus>('POST', '/premium/google/' + (restore ? 'restore' : 'verify'), { purchaseToken }),
  console: () => call<BillingConsole>('GET', '/admin/premium'),
  settings: (settings: BillingSettings) => call<BillingConsole>('PUT', '/admin/premium/settings', settings),
  event: (subscription: PremiumSubscription, event: string, key: string) => call<BillingConsole>('POST', '/admin/premium/' + subscription.id + '/events', {
    event, requestKey: key, expectedRevision: subscription.revision,
  }),
  claimGuest: async () => {
    const token = await guestToken(false);
    if (!token || !getSession()) return;
    await call<void>('POST', '/premium/claim', { token });
    await AsyncStorage.removeItem(GUEST_KEY);
  },
};
