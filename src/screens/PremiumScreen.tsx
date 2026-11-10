import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card, ScreenHeader, Switch } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { usePremium } from '../context/PremiumContext';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { BasePlan, BillingConsole, BillingSettings, guestToken, premiumApi, PremiumSubscription, requestKey } from '../services/premiumApi';
import { buyStore, restoreStore, storePlans, StorePlan } from '../services/playBilling';

const PLAY_MANAGE_URL = 'https://play.google.com/store/account/subscriptions?sku=premium&package=com.kylim0103.jizhangapp';
const actions = [
  ['APPROVE', 'approve'], ['REJECT', 'reject'], ['RENEW', 'renew'], ['CANCEL', 'cancel'],
  ['GRACE', 'grace'], ['HOLD', 'hold'], ['PAUSE', 'pause'], ['RECOVER', 'recover'],
  ['EXPIRE', 'expire'], ['REFUND_ONLY', 'refundOnly'], ['REVOKE', 'revoke'],
] as const;
function allowedActions(p: PremiumSubscription): string[] {
  if (p.state === 'PENDING') return ['APPROVE', 'REJECT'];
  if (['REJECTED', 'REVOKED', 'EXPIRED'].includes(p.state)) return [];
  if (['ON_HOLD', 'PAUSED'].includes(p.state)) return ['RECOVER', 'EXPIRE', 'REVOKE'];
  if (p.state === 'CANCELED') return ['EXPIRE', 'REFUND_ONLY', 'REVOKE'];
  return ['RENEW', 'CANCEL', 'GRACE', 'HOLD', 'PAUSE', 'EXPIRE', 'REFUND_ONLY', 'REVOKE'];
}
export function PremiumScreenHost() {
  const premium = usePremium();
  // Unmount on close so pending management/confirmation UI cannot leak into the next account.
  return <Modal visible={premium.visible} onRequestClose={premium.close} animationType="slide" presentationStyle="fullScreen">
    {premium.visible ? <PremiumScreen /> : null}
  </Modal>;
}
function PremiumScreen() {
  const premium = usePremium();
  const { user } = useAuth();
  const { semantic, spacing } = useTheme();
  const { pagePadding, contentMaxWidth } = useLayout();
  const { langMode } = useLanguage();
  const t = useT();
  const [plan, setPlan] = useState<BasePlan>('monthly');
  const [plans, setPlans] = useState<StorePlan[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [admin, setAdmin] = useState<BillingConsole | null>(null);
  const [claimAvailable, setClaimAvailable] = useState(false);
  const [claimConfirm, setClaimConfirm] = useState(false);
  const [appKey, setAppKey] = useState(requestKey);
  const [eventKeys, setEventKeys] = useState<Record<string, string>>({});
  const s = premium.status;
  const sandbox = s?.mode === 'SANDBOX';
  const content = { gap: spacing.lg, padding: pagePadding, paddingBottom: spacing.huge,
    width: '100%' as const, maxWidth: contentMaxWidth, alignSelf: 'center' as const };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await action(); }
    catch (error) { premium.showError(error); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    void run(async () => { await premium.refresh(); });
    void guestToken(false).then(token => setClaimAvailable(Boolean(user && token))).catch(() => {});
  }, [user?.id]);
  useEffect(() => {
    let alive = true;
    setAdmin(null);
    if (s?.administrator) void premiumApi.console().then(value => { if (alive) setAdmin(value); }).catch(premium.showError);
    return () => { alive = false; };
  }, [s?.administrator, user?.id]);
  useEffect(() => {
    let alive = true;
    setPlans([]);
    if (s?.mode === 'GOOGLE_PLAY' && premium.storeReady) void storePlans().then(value => {
      if (alive) setPlans(value);
    }).catch(premium.showError);
    return () => { alive = false; };
  }, [s?.mode, premium.storeReady, user?.id]);
  const selected = plans.find(p => p.basePlan === plan);
  const unresolved = s?.subscriptions.some(p => ['PENDING', 'ON_HOLD', 'PAUSED'].includes(p.state));
  const canBuy = Boolean(s?.enrollmentOpen && !s.active && !unresolved
    && (sandbox ? s.sandboxAvailable : selected && premium.storeReady));
  const date = (value: string) => new Date(value).toLocaleString(langMode === 'zh' ? 'zh-CN' : 'en-MY');
  const stateText = (p: PremiumSubscription) => t('membership.states.' + p.state);
  const subscription = (p: PremiumSubscription) => <View style={{ gap: spacing.sm }}>
    <AppText variant="headline">{t('membership.' + p.basePlan)} · {stateText(p)}</AppText>
    <AppText variant="footnote" color={semantic.textSecondary}>{p.provider === 'SANDBOX' ? t('membership.notCharged') : 'Google Play'}</AppText>
    {p.expiresAt ? <AppText variant="footnote" color={semantic.textSecondary}>{t('membership.expiry')} · {date(p.expiresAt)}</AppText> : null}
  </View>;
  const changeSettings = (key: keyof BillingSettings, value: boolean) => {
    if (!admin) return;
    void run(async () => {
      setAdmin(await premiumApi.settings({ ...admin.settings, [key]: value }));
      await premium.refresh();
    });
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: semantic.bg }} edges={['top', 'bottom']}>
    <ScreenHeader title={t('membership.title')} onBack={premium.close} />
    <ScrollView contentContainerStyle={content} keyboardShouldPersistTaps="handled">
      {!s ? <ActivityIndicator color={semantic.accent} accessibilityLabel={t('membership.loading')} /> : null}
      {premium.error ? <Card><AppText color={semantic.danger}>{premium.error}</AppText>
        <Button title={t('membership.retry')} variant="ghost" loading={busy} onPress={() => { void run(async () => { await premium.refresh(); }); }} /></Card> : null}
      {notice ? <AppText variant="footnote" color={semantic.accentText}>{notice}</AppText> : null}
      {s ? <>
        <Card><View style={{ gap: spacing.md }}>
          <AppText variant="title2">{t(s.active ? 'membership.active' : 'membership.free')}</AppText>
          <AppText variant="footnote" color={semantic.textSecondary}>{sandbox ? t('membership.sandbox') : 'Google Play'}</AppText>
          <AppText variant="subhead">{t(sandbox ? 'membership.sandboxHint' : 'membership.realHint')}</AppText>
          {!user ? <AppText variant="footnote" color={semantic.textSecondary}>{t('membership.guestHint')}</AppText> : null}
        </View></Card>
        <Card><View style={{ gap: spacing.md }}>
          <AppText variant="headline">{t('membership.benefits')}</AppText>
          <AppText variant="subhead" color={semantic.textSecondary}>{t('membership.benefitsText')}</AppText>
        </View></Card>
        <Card><View style={{ gap: spacing.md }}>
          {(['monthly', 'yearly'] as const).map(id => <Button key={id} variant={plan === id ? 'secondary' : 'ghost'}
            title={t('membership.' + id) + ' · ' + (sandbox ? t(id === 'monthly' ? 'membership.monthPrice' : 'membership.yearPrice')
              : plans.find(p => p.basePlan === id)?.displayPrice ?? '—')}
            disabled={busy} onPress={() => setPlan(id)} />)}
          {!s.enrollmentOpen ? <AppText variant="footnote">{t('membership.closed')}</AppText> : null}
          <Button title={t(sandbox ? 'membership.apply' : 'membership.buy')} disabled={!canBuy} loading={busy} onPress={() => {
            void run(async () => {
              if (sandbox) { await premiumApi.apply(plan, appKey); setAppKey(requestKey()); setNotice(t('membership.applied')); await premium.refresh(); }
              else if (selected) await buyStore(selected, s.obfuscatedAccountId);
            });
          }} />
          <Button title={t('membership.refresh')} variant="ghost" loading={busy} onPress={() => { void run(async () => {
            await premium.refresh(); if (s.administrator) setAdmin(await premiumApi.console());
          }); }} />
          {!sandbox ? <>
            <Button title={t('membership.restore')} variant="secondary" disabled={!premium.storeReady} loading={busy} onPress={() => { void run(async () => {
              const count = await restoreStore(async token => { await premiumApi.verify(token, true); });
              await premium.refresh(); if (!count) setNotice(t('membership.restoreNone'));
            }); }} />
            <Button title={t('membership.manage')} variant="ghost" onPress={() => { void run(async () => { await Linking.openURL(PLAY_MANAGE_URL); }); }} />
          </> : null}
        </View></Card>
        {claimAvailable ? <Card><View style={{ gap: spacing.md }}>
          <AppText variant="subhead">{t('membership.claimHint')} {user?.email}</AppText>
          <Button title={t(claimConfirm ? 'membership.claimConfirm' : 'membership.claim')} variant="secondary" loading={busy} onPress={() => {
            if (!claimConfirm) { setClaimConfirm(true); return; }
            void run(async () => { await premiumApi.claimGuest(); setClaimAvailable(false); setClaimConfirm(false); await premium.refresh(); setNotice(t('membership.claimDone')); });
          }} />
        </View></Card> : null}
        <AppText variant="headline">{t('membership.history')}</AppText>
        {!s.subscriptions.length ? <AppText variant="subhead" color={semantic.textSecondary}>{t('membership.none')}</AppText> : null}
        {s.subscriptions.map(p => <Card key={p.id}><View style={{ gap: spacing.md }}>{subscription(p)}
          {p.provider === 'SANDBOX' && p.autoRenew && ['ACTIVE', 'IN_GRACE_PERIOD'].includes(p.state) ?
            <Button title={t('membership.cancelRenewal')} variant="ghost" loading={busy} onPress={() => { void run(async () => {
              await premiumApi.cancel(p, requestKey()); await premium.refresh();
            }); }} /> : null}
        </View></Card>)}
        {admin && s.administrator ? <>
          <AppText variant="title3">{t('membership.admin')}</AppText>
          <Card><View style={{ gap: spacing.md }}>
            <AppText variant="footnote" color={semantic.textSecondary}>{t('membership.adminHint')}</AppText>
            {sandbox && !admin.sandboxAllowed ? <AppText variant="footnote">{t('membership.sandboxDisabled')}</AppText> : null}
            {(['enrollmentOpen', 'sandboxOpen', 'gatesEnabled'] as const).map(key => <View key={key}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <AppText variant="subhead" style={{ flex: 1 }}>{t('membership.' + key)}</AppText>
              <Switch value={admin.settings[key]} disabled={busy || (key === 'sandboxOpen' && !admin.sandboxAllowed && !admin.settings.sandboxOpen)}
                accessibilityLabel={t('membership.' + key)} onValueChange={value => changeSettings(key, value)} />
            </View>)}
          </View></Card>
          <AppText variant="headline">{t('membership.applications')}</AppText>
          {admin.subscriptions.map(({ subscription: p, subjectId, identity }) => <Card key={p.id}>
            <View style={{ gap: spacing.md }}>
              <AppText variant="footnote">{identity === 'GUEST' ? t('membership.guest') : identity} · {subjectId.slice(0, 8)}</AppText>
              {subscription(p)}
              {p.provider === 'SANDBOX' && s.sandboxAvailable ? <View style={{ gap: spacing.sm }}>
                {actions.filter(([event]) => allowedActions(p).includes(event)).map(([event, label]) => <Button key={event}
                  title={t('membership.' + label)} variant="secondary" loading={busy} onPress={() => {
                    const localKey = p.id + ':' + p.revision + ':' + event;
                    const key = eventKeys[localKey] ?? requestKey();
                    setEventKeys(prev => ({ ...prev, [localKey]: key }));
                    void run(async () => { setAdmin(await premiumApi.event(p, event, key)); await premium.refresh(); });
                  }} />)}
              </View> : null}
            </View>
          </Card>)}
        </> : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}
