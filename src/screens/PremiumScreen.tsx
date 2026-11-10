// 会员中心（游客与已登录账号共用）+ 管理员订阅管理。
// 模拟模式只出现在 staging 部署，页面顶部常驻「开发测试，不会扣款」标注；正式购买走 Google Play。
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Badge, Button, Card, ScreenHeader, Switch } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { usePremium } from '../context/PremiumContext';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import {
  BasePlan, BillingConsole, BillingSettings, premiumApi, PremiumStatus, PremiumSubscription, requestKey,
} from '../services/premiumApi';
import { buyStore, restoreStore, storePlans, StorePlan } from '../services/playBilling';
import { openSignIn } from '../navigation/navigationRef';

const PACKAGE = 'com.kylim0103.jizhangapp';
const PLAY_MANAGE_URL = 'https://play.google.com/store/account/subscriptions?sku=premium&package=' + PACKAGE;

const ACTIONS = [
  ['APPROVE', 'approve'], ['REJECT', 'reject'], ['RENEW', 'renew'], ['CANCEL', 'cancel'],
  ['GRACE', 'grace'], ['HOLD', 'hold'], ['PAUSE', 'pause'], ['RECOVER', 'recover'],
  ['EXPIRE', 'expire'], ['REFUND_ONLY', 'refundOnly'], ['REVOKE', 'revoke'],
] as const;

/** 与服务端 SubscriptionPolicy 一致：只显示当前状态可执行的模拟事件 */
function allowedActions(p: PremiumSubscription): string[] {
  if (p.state === 'PENDING') return ['APPROVE', 'REJECT', 'CANCEL'];
  if (['REJECTED', 'REVOKED', 'EXPIRED', 'PENDING_PURCHASE_CANCELED'].includes(p.state)) return [];
  if (['ON_HOLD', 'PAUSED'].includes(p.state)) return ['RECOVER', 'EXPIRE', 'REVOKE'];
  if (p.state === 'CANCELED') return ['EXPIRE', 'REFUND_ONLY', 'REVOKE'];
  if (p.state === 'IN_GRACE_PERIOD') return ['RENEW', 'CANCEL', 'HOLD', 'EXPIRE', 'REFUND_ONLY', 'REVOKE'];
  return ['RENEW', 'CANCEL', 'GRACE', 'HOLD', 'PAUSE', 'EXPIRE', 'REFUND_ONLY', 'REVOKE'];
}

export function PremiumScreenHost() {
  const premium = usePremium();
  // 关闭即卸载：避免确认态 / 管理数据串到下一个账号
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
  const [claimConfirm, setClaimConfirm] = useState(false);
  const [appKey, setAppKey] = useState(requestKey);
  const [eventKeys, setEventKeys] = useState<Record<string, string>>({});
  const s = premium.status;
  const sandbox = s?.mode === 'SANDBOX';
  const google = s?.mode === 'GOOGLE_PLAY';
  const content = { gap: spacing.lg, padding: pagePadding, paddingBottom: spacing.huge,
    width: '100%' as const, maxWidth: contentMaxWidth, alignSelf: 'center' as const };

  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await action(); } catch (error) { premium.showError(error); } finally { setBusy(false); }
  }, [busy, premium]);

  const loadConsole = useCallback(async () => { setAdmin(await premiumApi.console()); }, []);

  useEffect(() => { void premium.refresh().catch(premium.showError); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setAdmin(null);
    if (s?.administrator) void premiumApi.console().then(v => { if (alive) setAdmin(v); }).catch(premium.showError);
    return () => { alive = false; };
  }, [s?.administrator, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let alive = true;
    setPlans([]);
    if (google && premium.storeReady) void storePlans().then(v => { if (alive) setPlans(v); }).catch(premium.showError);
    return () => { alive = false; };
  }, [google, premium.storeReady, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = plans.find(p => p.basePlan === plan);
  const unresolved = s?.subscriptions.some(p => ['PENDING', 'ON_HOLD', 'PAUSED'].includes(p.state));
  const canBuy = Boolean(s?.enrollmentOpen && !s.active && !unresolved
    && (sandbox ? s.sandboxAvailable : google && selected && premium.storeReady));
  const date = (value: string) => new Date(value).toLocaleString(langMode === 'zh' ? 'zh-CN' : 'en-MY');

  const subscriptionCard = (p: PremiumSubscription) => <View style={{ gap: spacing.sm }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm }}>
      <AppText variant="headline">{t('membership.' + p.basePlan)} · {t('membership.states.' + p.state)}</AppText>
      {p.provider === 'SANDBOX' ? <Badge label={t('membership.simulatedBadge')} tone="warning" /> : null}
      {p.testPurchase ? <Badge label={t('membership.testPurchase')} tone="warning" /> : null}
      {p.refundType ? <Badge label={t('membership.refunded')} tone="danger" /> : null}
    </View>
    <AppText variant="footnote" color={semantic.textSecondary}>
      {p.provider === 'SANDBOX' ? t('membership.notCharged') : 'Google Play'}
      {p.autoRenew ? ' · ' + t('membership.autoRenew') : ''}
    </AppText>
    {p.expiresAt ? <AppText variant="footnote" color={semantic.textSecondary}>{t('membership.expiry')} · {date(p.expiresAt)}</AppText> : null}
  </View>;

  const changeSettings = (key: keyof BillingSettings, value: boolean) => {
    if (!admin) return;
    void run(async () => {
      setAdmin(await premiumApi.settings({ ...admin.settings, [key]: value }));
      await premium.refresh();
    });
  };

  const acceptGuestOffer = () => {
    if (!claimConfirm) { setClaimConfirm(true); return; }
    void run(async () => {
      await premiumApi.claimGuest();
      setClaimConfirm(false);
      premium.dismissGuestOffer();
      await premium.refresh();
      setNotice(t('membership.claimDone'));
    });
  };

  const restore = () => void run(async () => {
    const count = await restoreStore(token => premium.verifyPurchase(token, true));
    await premium.refresh();
    if (!count) setNotice(t('membership.restoreNone'));
  });

  const buy = () => void run(async () => {
    if (sandbox) {
      await premiumApi.apply(plan, appKey);
      setAppKey(requestKey());
      setNotice(t('membership.applied'));
      await premium.refresh();
      return;
    }
    if (!selected) return;
    // 游客首次购买：先建立订阅身份（obfuscatedAccountId 用它的摘要）
    const identity: PremiumStatus = s?.obfuscatedAccountId ? s : await premiumApi.ensureIdentity();
    await buyStore(selected, identity.obfuscatedAccountId ?? '');
  });

  return <SafeAreaView style={{ flex: 1, backgroundColor: semantic.bg }} edges={['top', 'bottom']}>
    <ScreenHeader title={t('membership.title')} onBack={premium.close} />
    <ScrollView contentContainerStyle={content} keyboardShouldPersistTaps="handled">
      {sandbox ? <Card style={{ borderWidth: 1, borderColor: semantic.warning }}>
        <View style={{ gap: spacing.xs }}>
          <AppText variant="headline" color={semantic.warning}>{t('membership.sandboxBanner')}</AppText>
          <AppText variant="footnote" color={semantic.textSecondary}>{t('membership.sandboxHint')}</AppText>
        </View>
      </Card> : null}
      {!s ? <ActivityIndicator color={semantic.accent} accessibilityLabel={t('membership.loading')} /> : null}
      {premium.error ? <Card><View style={{ gap: spacing.sm }}>
        <AppText color={semantic.danger}>{premium.error}</AppText>
        <Button title={t('membership.retry')} variant="ghost" loading={busy} onPress={() => void run(async () => { await premium.refresh(); })} />
      </View></Card> : null}
      {notice ? <AppText variant="footnote" color={semantic.accentText}>{notice}</AppText> : null}

      {premium.guestOffer && user ? <Card><View style={{ gap: spacing.md }}>
        <AppText variant="headline">{t('membership.claimTitle')}</AppText>
        <AppText variant="subhead">{t('membership.claimHint')} {user.email}</AppText>
        <Button title={t(claimConfirm ? 'membership.claimConfirm' : 'membership.claim')} variant="secondary" loading={busy} onPress={acceptGuestOffer} />
        <Button title={t('membership.notNow')} variant="ghost" onPress={() => { setClaimConfirm(false); premium.dismissGuestOffer(); }} />
      </View></Card> : null}

      {premium.pendingClaim && user ? <Card><View style={{ gap: spacing.md }}>
        <AppText variant="headline">{t('membership.restoreClaimTitle')}</AppText>
        <AppText variant="subhead">{t('membership.restoreClaimHint')} {user.email}</AppText>
        <Button title={t('membership.claimConfirm')} variant="secondary" loading={busy}
          onPress={() => void run(async () => { await premium.verifyPurchase(premium.pendingClaim as string, true, true); setNotice(t('membership.claimDone')); })} />
        <Button title={t('membership.notNow')} variant="ghost" onPress={premium.dismissClaim} />
      </View></Card> : null}

      {s ? <>
        <Card><View style={{ gap: spacing.md }}>
          <AppText variant="title2">{t(s.active ? 'membership.active' : 'membership.free')}</AppText>
          {s.expiresAt && s.active ? <AppText variant="footnote" color={semantic.textSecondary}>{t('membership.expiry')} · {date(s.expiresAt)}</AppText> : null}
          {!sandbox ? <AppText variant="subhead">{t(google ? 'membership.realHint' : 'membership.unavailable')}</AppText> : null}
          {!user ? <AppText variant="footnote" color={semantic.textSecondary}>{t(sandbox ? 'membership.guestHintSandbox' : 'membership.guestHint')}</AppText> : null}
        </View></Card>
        <Card><View style={{ gap: spacing.md }}>
          <AppText variant="headline">{t('membership.benefits')}</AppText>
          <AppText variant="subhead" color={semantic.textSecondary}>{t('membership.benefitsText')}</AppText>
        </View></Card>

        {(sandbox || google) && !user ? <Card><View style={{ gap: spacing.md }}>
          <AppText variant="headline">{t('membership.signInTitle')}</AppText>
          <AppText variant="subhead" color={semantic.textSecondary}>{t('membership.signInHint')}</AppText>
          <Button title={t('membership.signInButton')} onPress={() => { premium.close(); openSignIn(); }} />
        </View></Card> : null}

        {(sandbox || google) && user ? <Card><View style={{ gap: spacing.md }}>
          {(['monthly', 'yearly'] as const).map(id => <Button key={id} variant={plan === id ? 'secondary' : 'ghost'}
            title={t('membership.' + id) + ' · ' + (sandbox ? t(id === 'monthly' ? 'membership.monthPrice' : 'membership.yearPrice')
              : plans.find(p => p.basePlan === id)?.displayPrice ?? '—')}
            disabled={busy} onPress={() => setPlan(id)} />)}
          {!s.enrollmentOpen ? <AppText variant="footnote">{t('membership.closed')}</AppText> : null}
          {unresolved ? <AppText variant="footnote">{t('membership.unresolved')}</AppText> : null}
          <Button title={t(sandbox ? 'membership.apply' : 'membership.buy')} disabled={!canBuy} loading={busy} onPress={buy} />
          <Button title={t('membership.refresh')} variant="ghost" loading={busy} onPress={() => void run(async () => {
            await premium.refresh(); if (s.administrator) await loadConsole();
          })} />
          {google ? <>
            <Button title={t('membership.restore')} variant="secondary" disabled={!premium.storeReady} loading={busy} onPress={restore} />
            <Button title={t('membership.manage')} variant="ghost" onPress={() => void run(async () => { await Linking.openURL(PLAY_MANAGE_URL); })} />
          </> : null}
        </View></Card> : null}

        <AppText variant="headline">{t('membership.history')}</AppText>
        {!s.subscriptions.length ? <AppText variant="subhead" color={semantic.textSecondary}>{t('membership.none')}</AppText> : null}
        {s.subscriptions.map(p => <Card key={p.id}><View style={{ gap: spacing.md }}>{subscriptionCard(p)}
          {p.provider === 'SANDBOX' && s.sandboxAvailable && (p.state === 'PENDING' || (p.autoRenew && ['ACTIVE', 'IN_GRACE_PERIOD'].includes(p.state))) ?
            <Button title={t(p.state === 'PENDING' ? 'membership.withdraw' : 'membership.cancelRenewal')} variant="ghost" loading={busy}
              onPress={() => void run(async () => { await premiumApi.cancel(p, requestKey()); await premium.refresh(); })} /> : null}
        </View></Card>)}

        {admin && s.administrator ? <>
          <AppText variant="title3">{t('membership.admin')}</AppText>
          <Card><View style={{ gap: spacing.md }}>
            <AppText variant="footnote" color={semantic.textSecondary}>
              {t('membership.adminHint')} · {admin.environment === 'staging' ? t('membership.envStaging') : t('membership.envProduction')}
            </AppText>
            {admin.alerts.map(a => <AppText key={a} variant="footnote" color={semantic.danger}>{t('membership.alert')} · {a}</AppText>)}
            {!admin.sandboxAllowed ? <AppText variant="footnote">{t('membership.sandboxDisabled')}</AppText> : null}
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
              {subscriptionCard(p)}
              {p.provider === 'SANDBOX' && s.sandboxAvailable ? <View style={{ gap: spacing.sm }}>
                {ACTIONS.filter(([event]) => allowedActions(p).includes(event)).map(([event, label]) => <Button key={event}
                  title={t('membership.' + label)} variant="secondary" loading={busy} onPress={() => {
                    const localKey = p.id + ':' + p.revision + ':' + event;
                    const key = eventKeys[localKey] ?? requestKey();
                    setEventKeys(prev => ({ ...prev, [localKey]: key }));
                    void run(async () => { setAdmin(await premiumApi.event(p, event, key)); await premium.refresh(); });
                  }} />)}
              </View> : null}
            </View>
          </Card>)}

          <AppText variant="headline">{t('membership.auditLog')}</AppText>
          <Card><View style={{ gap: spacing.sm }}>
            {!admin.events.length ? <AppText variant="footnote" color={semantic.textSecondary}>{t('membership.none')}</AppText> : null}
            {admin.events.map((e, i) => <AppText key={i} variant="footnote" color={semantic.textSecondary}>
              {date(e.at)} · {e.type}{e.fromState || e.toState ? ' · ' + (e.fromState ?? '—') + ' → ' + (e.toState ?? '—') : ''}
              {e.detail ? ' · ' + e.detail : ''}
            </AppText>)}
          </View></Card>
        </> : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}
