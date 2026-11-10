// 会员状态（服务端为准）+ 付费功能入口校验。
//
// 离线规则（记账 App 必须离线可用）：
// - 联网时以服务端最新状态为准；
// - 断网 / 服务暂不可用时用本机缓存的最后一次状态：锁定未开启 → 放行；会员且缓存的有效期未过 → 放行；
//   从没拿到过状态 → 放行（服务端在同步时仍会校验，离线创建的记录到期 7 天内可补传）。
// - 被拦下时只弹出会员页，调用方保留草稿（抛 PremiumRequired，不清空表单）。
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { useT } from '../i18n/LanguageContext';
import { ApiError } from '../services/apiClient';
import { forgetGuestToken, premiumApi, PremiumFeature, PremiumStatus } from '../services/premiumApi';
import { connectStore, restoreStore } from '../services/playBilling';
import { getSession } from '../services/sessionStore';
import { clearPremiumBlocked } from '../services/syncService';

export class PremiumRequired extends Error {
  constructor() { super('PREMIUM_REQUIRED'); this.name = 'PremiumRequired'; }
}

interface PremiumContextValue {
  status: PremiumStatus | null;
  error: string | null;
  visible: boolean;
  storeReady: boolean;
  /** 本机游客身份有会员 / 待付款，登录后提示绑定到当前账号 */
  guestOffer: PremiumStatus | null;
  /** Play 恢复时发现属于本机旧游客身份的购买，等待用户确认绑定 */
  pendingClaim: string | null;
  open: () => void;
  close: () => void;
  refresh: () => Promise<PremiumStatus>;
  requireFeature: (feature: PremiumFeature) => Promise<void>;
  showError: (error: unknown) => void;
  verifyPurchase: (token: string, restore: boolean, claim?: boolean) => Promise<void>;
  dismissGuestOffer: () => void;
  dismissClaim: () => void;
}

const Context = createContext<PremiumContextValue | null>(null);
const CACHE_KEY = '@jizhang/premiumStatusCache';
const FRESH_MS = 15000;
const GATE_TIMEOUT_MS = 4000;

interface Cached { owner: string; status: PremiumStatus; receivedAt: number }

const ownerKey = () => (getSession()?.user.id != null ? 'user:' + getSession()?.user.id : 'guest');

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError('TIMEOUT', 0, 'timeout')), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

function isTransient(e: unknown): boolean {
  if (e instanceof ApiError) return e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT' || e.status >= 500 || e.status === 0;
  return true;
}

/** 缓存状态在离线时能否放行该功能（时间按服务端时间 + 本地经过时长推算） */
function cachedAllows(cached: Cached | null, feature: PremiumFeature): boolean {
  if (!cached) return true;
  const s = cached.status;
  if (!s.gatesEnabled) return true;
  if (!s.capabilities[feature] || !s.expiresAt) return false;
  const elapsed = Math.max(0, Date.now() - cached.receivedAt);
  return Date.parse(s.expiresAt) > Date.parse(s.serverTime) + elapsed;
}

export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const { user, authInitializing } = useAuth();
  const t = useT();
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [storeReady, setStoreReady] = useState(false);
  const [guestOffer, setGuestOffer] = useState<PremiumStatus | null>(null);
  const [pendingClaim, setPendingClaim] = useState<string | null>(null);
  const cacheRef = useRef<Cached | null>(null);
  const requestVersion = useRef(0);
  const generation = useRef(0);
  const lastUnlocked = useRef<boolean | null>(null);

  const message = useCallback((e: unknown): string | null => {
    if (e instanceof PremiumRequired) return null;
    const code = e instanceof ApiError ? e.code : e instanceof Error ? e.message : String(e);
    if (/user.cancel|user_cancel|E_USER_CANCELLED/i.test(code)) return null;
    switch (code) {
      case 'PAYMENT_PENDING': return t('membership.pendingPayment');
      case 'RESTORE_FIRST': return t('membership.restoreFirst');
      case 'STORE_UNAVAILABLE': return t('membership.storeUnavailable');
      case 'BILLING_OWNED_BY_OTHER': return t('membership.ownedByOther');
      case 'CONFLICT': return t('membership.conflict');
      case 'FORBIDDEN': return t('membership.notAllowed');
      default: return t('membership.retryError');
    }
  }, [t]);

  // PremiumRequired 已由 requireFeature 自己处理（打开会员页 / 写好提示），这里不覆盖
  const showError = useCallback((e: unknown) => {
    if (e instanceof PremiumRequired) return;
    setError(message(e));
  }, [message]);

  const remember = useCallback((result: PremiumStatus) => {
    const entry = { owner: ownerKey(), status: result, receivedAt: Date.now() };
    cacheRef.current = entry;
    setStatus(result);
    setError(null);
    void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(entry)).catch(() => {});
    const unlocked = !result.gatesEnabled || result.active;
    // 开通 / 关闭锁定后，之前因会员被拒的离线记录补传一次
    if (unlocked && lastUnlocked.current !== true) clearPremiumBlocked();
    lastUnlocked.current = unlocked;
  }, []);

  const refresh = useCallback(async () => {
    const id = ++requestVersion.current;
    const owner = ownerKey();
    let result: PremiumStatus;
    try {
      result = await premiumApi.status();
    } catch (e) {
      // 本机游客凭证已失效（已绑定到账号 / 被恢复到另一台设备）：丢弃它，按匿名查询
      if (!getSession() && e instanceof ApiError && e.code === 'UNAUTHORIZED') {
        await forgetGuestToken();
        result = await premiumApi.status();
      } else {
        throw e;
      }
    }
    if (owner !== ownerKey()) throw new Error('IDENTITY_CHANGED');
    if (id === requestVersion.current) remember(result);
    return result;
  }, [remember]);

  // 换身份（登录 / 退出 / 切换账号）：清空内存状态，恢复该身份的本机缓存，再向服务端刷新
  useEffect(() => {
    generation.current++;
    requestVersion.current++;
    cacheRef.current = null;
    lastUnlocked.current = null;
    setStatus(null);
    setStoreReady(false);
    setPendingClaim(null);
    if (authInitializing) return;
    let alive = true;
    void AsyncStorage.getItem(CACHE_KEY).then(raw => {
      if (!alive || !raw) return;
      try {
        const cached = JSON.parse(raw) as Cached;
        if (cached.owner === ownerKey() && !cacheRef.current) { cacheRef.current = cached; setStatus(cached.status); }
      } catch { /* 缓存损坏：忽略，等服务端结果 */ }
    }).catch(() => {});
    void refresh().catch(() => { /* 离线：沿用缓存 */ });
    const active = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh().catch(() => {});
    });
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 60000);
    return () => { alive = false; requestVersion.current++; clearInterval(timer); active.remove(); };
  }, [user?.id, authInitializing, refresh]);

  // 登录后：本机游客身份如有会员或待付款，提示主动绑定（不会自动转移）
  useEffect(() => {
    if (authInitializing || !user) { setGuestOffer(null); return; }
    let alive = true;
    void premiumApi.guestStatus().then(guest => {
      if (!alive || !guest) return;
      const relevant = guest.active || guest.subscriptions.some(s => ['PENDING', 'ON_HOLD', 'PAUSED'].includes(s.state));
      if (relevant) { setGuestOffer(guest); setVisible(true); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [user?.id, authInitializing]);

  const verifyPurchase = useCallback(async (token: string, restore: boolean, claim = false) => {
    try {
      remember(await premiumApi.verify(token, restore, claim));
      setPendingClaim(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'BILLING_CLAIM_REQUIRED') {
        setPendingClaim(token);
        setVisible(true);
        return;
      }
      throw e;
    }
  }, [remember]);

  // 正式模式（Android）：连接 Play，补查 App 被杀时丢失回调的购买
  useEffect(() => {
    if (status?.mode !== 'GOOGLE_PLAY' || Platform.OS !== 'android') return;
    let alive = true;
    let disconnect: (() => void) | undefined;
    const ownerGeneration = generation.current;
    void connectStore(async token => {
      if (!alive || ownerGeneration !== generation.current) return;
      await verifyPurchase(token, false);
    }, code => { if (alive) showError(new Error(code)); }).then(async cleanup => {
      if (!alive) { cleanup(); return; }
      disconnect = cleanup;
      setStoreReady(true);
      await restoreStore(token => verifyPurchase(token, true));
    }).catch(e => { if (alive) showError(e); });
    return () => { alive = false; disconnect?.(); setStoreReady(false); };
  }, [status?.mode, user?.id, verifyPurchase, showError]);

  useEffect(() => {
    if (status?.mode !== 'GOOGLE_PLAY' || !storeReady) return;
    const ownerGeneration = generation.current;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' || ownerGeneration !== generation.current) return;
      void restoreStore(token => verifyPurchase(token, true)).catch(() => {});
    });
    return () => subscription.remove();
  }, [status?.mode, storeReady, user?.id, verifyPurchase]);

  const requireFeature = useCallback(async (feature: PremiumFeature) => {
    const cached = cacheRef.current && cacheRef.current.owner === ownerKey() ? cacheRef.current : null;
    let current: PremiumStatus | null = cached && Date.now() - cached.receivedAt < FRESH_MS ? cached.status : null;
    if (!current) {
      try {
        current = await withTimeout(refresh(), GATE_TIMEOUT_MS);
      } catch (e) {
        if (!isTransient(e)) { showError(e); setVisible(true); throw e; }
        if (cachedAllows(cached, feature)) return;
        setError(t('membership.offlineBlocked'));
        setVisible(true);
        throw new PremiumRequired();
      }
    }
    if (current.capabilities[feature]) return;
    setVisible(true);
    throw new PremiumRequired();
  }, [refresh, showError, t]);

  const value = useMemo<PremiumContextValue>(() => ({
    status, error, visible, storeReady, guestOffer, pendingClaim,
    open: () => setVisible(true),
    close: () => { setVisible(false); setError(null); },
    refresh, requireFeature, showError, verifyPurchase,
    dismissGuestOffer: () => setGuestOffer(null),
    dismissClaim: () => setPendingClaim(null),
  }), [status, error, visible, storeReady, guestOffer, pendingClaim, refresh, requireFeature, showError, verifyPurchase]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePremium() {
  const value = useContext(Context);
  if (!value) throw new Error('PremiumProvider required');
  return value;
}
