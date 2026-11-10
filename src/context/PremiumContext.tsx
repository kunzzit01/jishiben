import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { useT } from '../i18n/LanguageContext';
import { premiumApi, PremiumFeature, PremiumStatus } from '../services/premiumApi';
import { connectStore, restoreStore } from '../services/playBilling';
import { getSession } from '../services/sessionStore';

export class PremiumRequired extends Error { constructor() { super('PREMIUM_REQUIRED'); } }
interface PremiumContextValue {
  status: PremiumStatus | null; error: string | null; visible: boolean; storeReady: boolean;
  open: () => void; close: () => void; refresh: () => Promise<PremiumStatus>;
  requireFeature: (feature: PremiumFeature) => Promise<void>;
  showError: (error: unknown) => void;
}
const Context = createContext<PremiumContextValue | null>(null);
export function PremiumProvider({ children }: { children: React.ReactNode }) {
  const { user, authInitializing } = useAuth();
  const t = useT();
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [storeReady, setStoreReady] = useState(false);
  const requestVersion = useRef(0);
  const generation = useRef(0);
  const freshRef = useRef<{ status: PremiumStatus; receivedAt: number; userId?: number } | null>(null);
  const showError = useCallback((e: unknown) => {
    if (e instanceof PremiumRequired) return;
    const code = e instanceof Error ? e.message : String(e);
    if (/user.cancel|user_cancel|E_USER_CANCELLED/i.test(code)) { setError(null); return; }
    setError(t(code === 'PAYMENT_PENDING' ? 'membership.pendingPayment' : code === 'RESTORE_FIRST'
      ? 'membership.restoreFirst' : code === 'STORE_UNAVAILABLE' ? 'membership.storeUnavailable' : 'membership.retryError'));
  }, [t]);
  const refresh = useCallback(async () => {
    const id = ++requestVersion.current;
    const owner = getSession()?.user.id;
    const result = await premiumApi.status();
    if (owner !== getSession()?.user.id) throw new Error('IDENTITY_CHANGED');
    if (id === requestVersion.current) { freshRef.current = { status: result, receivedAt: Date.now(), userId: owner }; setStatus(result); setError(null); }
    return result;
  }, []);
  useEffect(() => {
    generation.current++;
    requestVersion.current++;
    freshRef.current = null;
    setStatus(null);
    setStoreReady(false);
    if (authInitializing) return;
    let alive = true;
    void refresh().catch(e => { if (alive) showError(e); });
    const active = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh().catch(() => {});
    });
    // Refresh server changes while the app is open, including administrator approvals and expiry.
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 60000);
    return () => { alive = false; requestVersion.current++; clearInterval(timer); active.remove(); };
  }, [user?.id, authInitializing, refresh]);
  useEffect(() => {
    if (status?.mode !== 'GOOGLE_PLAY') return;
    let alive = true;
    let disconnect: (() => void) | undefined;
    const ownerGeneration = generation.current;
    void connectStore(async token => {
      if (!alive || ownerGeneration !== generation.current) return;
      await premiumApi.verify(token);
      if (alive) await refresh();
    }, code => { if (alive) showError(new Error(code)); }).then(async cleanup => {
      if (!alive) { cleanup(); return; }
      disconnect = cleanup;
      setStoreReady(true);
      // Catch completed purchases whose callback was lost while the app was terminated.
      await restoreStore(async token => { await premiumApi.verify(token, true); });
      if (alive) await refresh();
    }).catch(e => { if (alive) showError(e); });
    return () => { alive = false; disconnect?.(); setStoreReady(false); };
  }, [status?.mode, user?.id, refresh]);
  useEffect(() => {
    if (status?.mode !== 'GOOGLE_PLAY' || !storeReady) return;
    const ownerGeneration = generation.current;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      void restoreStore(async token => {
        if (ownerGeneration !== generation.current) return;
        await premiumApi.verify(token, true);
      }).then(() => refresh()).catch(() => {});
    });
    return () => subscription.remove();
  }, [status?.mode, storeReady, user?.id, refresh]);
  const requireFeature = useCallback(async (feature: PremiumFeature) => {
    try {
      const cached = freshRef.current;
      const age = cached ? Math.max(0, Date.now() - cached.receivedAt) : Infinity;
      const expiryOkay = cached && (!cached.status.gatesEnabled || (cached.status.expiresAt
        && Date.parse(cached.status.expiresAt) > Date.parse(cached.status.serverTime) + age));
      const fresh = cached && cached.userId === getSession()?.user.id && age < 15000 && expiryOkay
        ? cached.status : await refresh();
      if (fresh.capabilities[feature]) return;
      setVisible(true);
      throw new PremiumRequired();
    } catch (e) {
      if (!(e instanceof PremiumRequired)) { showError(e); setVisible(true); }
      throw e;
    }
  }, [refresh, showError]);
  return <Context.Provider value={{ status, error, visible, storeReady, open: () => setVisible(true),
    close: () => { setVisible(false); setError(null); }, refresh, requireFeature, showError }}>{children}</Context.Provider>;
}
export function usePremium() {
  const value = useContext(Context);
  if (!value) throw new Error('PremiumProvider required');
  return value;
}
