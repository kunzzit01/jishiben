import { Platform } from 'react-native';
import type { Purchase } from 'expo-iap';
import type { BasePlan } from './premiumApi';
export interface StorePlan { basePlan: BasePlan; displayPrice: string; offerToken: string }
const PRODUCT = 'premium';
let moduleFlight: Promise<typeof import('expo-iap')> | undefined;
async function sdk() {
  if (Platform.OS !== 'android') throw new Error('STORE_UNAVAILABLE');
  // Lazy load: old binaries and Expo Go can still run the explicitly separate sandbox.
  if (!moduleFlight) moduleFlight = import('expo-iap').catch(() => { moduleFlight = undefined; throw new Error('STORE_UNAVAILABLE'); });
  return moduleFlight;
}
export async function connectStore(onPurchase: (token: string) => Promise<void>, onError: (code: string) => void) {
  const iap = await sdk();
  const purchases = iap.purchaseUpdatedListener((purchase: Purchase) => {
    if (purchase.productId !== PRODUCT) return;
    if (purchase.purchaseState === 'pending') {
      if (purchase.purchaseToken) void onPurchase(purchase.purchaseToken)
        .then(() => onError('PAYMENT_PENDING')).catch(() => onError('PAYMENT_PENDING'));
      else onError('PAYMENT_PENDING');
      return;
    }
    if (purchase.purchaseState !== 'purchased' || !purchase.purchaseToken) return;
    // Backend acknowledgment is retried durably, even if the app is closed here.
    void onPurchase(purchase.purchaseToken).catch(() => onError('VERIFY_RETRY'));
  });
  const errors = iap.purchaseErrorListener(error => onError(error.code ?? 'STORE_ERROR'));
  try { await iap.initConnection(); }
  catch (error) { purchases.remove(); errors.remove(); throw error; }
  return () => { purchases.remove(); errors.remove(); void iap.endConnection().catch(() => {}); };
}
export async function storePlans(): Promise<StorePlan[]> {
  const iap = await sdk();
  const products = await iap.fetchProducts({ skus: [PRODUCT], type: 'subs' });
  const result: StorePlan[] = [];
  for (const product of products ?? []) {
    if (product.platform !== 'android' || product.type !== 'subs') continue;
    for (const offer of product.subscriptionOffers ?? []) {
      const phase = offer.pricingPhasesAndroid?.pricingPhaseList;
      // The first release sells ordinary auto-renewing base plans, with no trial/installment offers.
      if (!['monthly', 'yearly'].includes(offer.basePlanIdAndroid ?? '') || !offer.offerTokenAndroid
          || offer.installmentPlanDetailsAndroid || phase?.length !== 1 || phase[0].recurrenceMode !== 1) continue;
      if (result.some(p => p.basePlan === offer.basePlanIdAndroid)) continue;
      result.push({ basePlan: offer.basePlanIdAndroid as BasePlan, displayPrice: phase[0].formattedPrice, offerToken: offer.offerTokenAndroid });
    }
  }
  return result;
}
export async function buyStore(plan: StorePlan, account: string): Promise<void> {
  // obfuscatedAccountId 只能是服务端给的 64 位摘要（不含个人信息）；缺失时不发起购买
  if (!/^[0-9a-f]{64}$/.test(account)) throw new Error('STORE_UNAVAILABLE');
  const iap = await sdk();
  // Query the account's existing purchases before purchase; avoid duplicate subscriptions.
  const existing = await iap.getAvailablePurchases();
  if (existing.some(p => p.productId === PRODUCT)) throw new Error('RESTORE_FIRST');
  await iap.requestPurchase({ type: 'subs', request: { google: {
    skus: [PRODUCT], obfuscatedAccountId: account,
    subscriptionOffers: [{ sku: PRODUCT, offerToken: plan.offerToken }],
  } } });
}
export async function restoreStore(verify: (token: string) => Promise<void>): Promise<number> {
  const iap = await sdk();
  const purchases = await iap.getAvailablePurchases();
  let restored = 0;
  for (const purchase of purchases) {
    // 待付款也交给服务端记录（不会开通）；付款完成后服务端补查会自动开通并确认
    if (purchase.productId === PRODUCT && purchase.purchaseToken
        && (purchase.purchaseState === 'purchased' || purchase.purchaseState === 'pending')) {
      await verify(purchase.purchaseToken); restored++;
    }
  }
  return restored;
}
