import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { useApp } from '../context/AppContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { useReminderItems } from '../reminders/useReminderItems';
import { useBudgetAlerts } from '../reminders/useBudgetAlerts';
import { reconcileReminders } from '../hooks/useReminders';
import type { ReminderRule } from '../reminders/rules';
import { AppText, Card, EmptyState, HeroGradient, ListRow, ListSection, ScreenHeader, Switch } from '../components/ui';
import { formatDate } from '../utils/formatDate';
import { formatMoney } from '../utils/formatMoney';
import * as NotificationsModule from 'expo-notifications';
import { sendTestReminder } from '../utils/notifications';
import { broadcastPush } from '../services/apiClient';
import { useAuth } from '../context/AuthContext';

/**
 * 提醒设置（设置 → 功能）：提醒规则开关 + 预算提醒管理。展示的是"规则"，不是排期实例。
 *
 * 为什么：每月 5 号的还款日提醒是一条规则；系统里为了不漏，会把它物化成未来 3 个月、
 * 每次提前 3/2/1 天的十几条通知。把实例铺给用户看，屏幕上就是"还有 3 天／还有 2 天…"
 * 刷屏，谁都不想读。所以这里一条规则一行，右边一个开关；具体时刻只在"下次提醒"里出现。
 */
export default function ReminderSettingsScreen({ navigation }: any) {
  const { semantic, spacing } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  // 提醒与账号无关：本地通知在未登录时也排（原先这里的 user 只用于"没登录就只显示空态"）

  const { decimalPlaces } = useApp();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const { items, allItems, rules, disabledRules, toggleRule, loading } = useReminderItems();
  const { alerts: budgetAlerts, dismiss: dismissBudgetAlert } = useBudgetAlerts();

  // 通知状态诊断：权限 / 已排期条数 / 下一条触发时间 —— 用户「为什么没弹」时一眼能看出来
  const [testResult, setTestResult] = useState<string>('');
  // 管理员广播：只有 ADMIN 角色或配置里的管理员邮箱能看到这一行
  const { user } = useAuth();
  const isBroadcastAdmin =
    user?.role === 'ADMIN' || (user?.email ?? '').toLowerCase() === 'mingsoon249@gmail.com';
  const [broadcastResult, setBroadcastResult] = useState<string>('');
  const runBroadcast = useCallback(async () => {
    setBroadcastResult(t('reminder.broadcastRunning'));
    try {
      const res = await broadcastPush(t('reminder.dailyTitle'), t('reminder.dailyBody'));
      setBroadcastResult(
        t('reminder.broadcastResult', { sent: res.sent, total: res.total, failed: res.failed })
      );
    } catch (e) {
      setBroadcastResult(t('reminder.broadcastFail', { reason: String((e as Error)?.message ?? e) }));
    }
  }, [t]);
  const runTest = useCallback(async (delay: number) => {
    const r = await sendTestReminder(delay, t('reminder.dailyTitle'), t('reminder.dailyBody'));
    setTestResult(r.ok ? `已排期（${delay}s）id=${r.id}` : `失败：${r.reason}`);
  }, [t]);
  const [notifState, setNotifState] = useState<{ perm: string; scheduled: number; nextAt: Date | null }>({
    perm: 'unknown',
    scheduled: 0,
    nextAt: null,
  });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const perm = (await NotificationsModule.getPermissionsAsync()).status;
        const scheduled = await NotificationsModule.getAllScheduledNotificationsAsync();
        const dates = scheduled
          .map((s) => {
            const tr: any = s.trigger;
            const t = tr?.date ?? tr?.value ?? null;
            return t ? new Date(t as any) : null;
          })
          .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
          .sort((a, b) => a.getTime() - b.getTime());
        if (alive) setNotifState({ perm, scheduled: scheduled.length, nextAt: dates[0] ?? null });
      } catch {
        /* 读不到就保持 unknown，不影响页面其它部分 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** 关掉/打开某条规则后要立刻重排，否则要等下一次数据变化 */
  const handleToggle = useCallback(
    async (rule: ReminderRule, enabled: boolean) => {
      await toggleRule(rule.id, enabled);
      await reconcileReminders({ items: allItems, t, decimals: decimalPlaces });
    },
    [allItems, decimalPlaces, t, toggleRule]
  );

  const sourceIcon = useCallback((rule: ReminderRule) => {
    switch (rule.source) {
      case 'credit':
        return rule.detailKey === 'reminder.ruleCreditStatement' ? 'document-text-outline' : 'card-outline';
      case 'plan':
        return 'repeat-outline';
      case 'daily':
        return 'create-outline';
      default:
        return 'calendar-outline';
    }
  }, []);

  const ruleTitle = useCallback(
    (rule: ReminderRule): string => {
      const name = t(rule.titleKey);
      return rule.label ? `${rule.label} · ${name}` : name;
    },
    [t]
  );

  const ruleSubtitle = useCallback(
    (rule: ReminderRule): string => {
      const detail = t(rule.detailKey, rule.detailParams);
      if (!rule.nextAt) return detail;
      return `${detail} · ${t('reminder.ruleNext', {
        date: formatDate(rule.nextAt, langMode, { style: 'monthDay' }),
      })}`;
    },
    [langMode, t]
  );

  const header = <ScreenHeader variant="compact" title={t('reminder.settingsTitle')} onBack={() => navigation.goBack()} />;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}>
      <HeroGradient fill />
      {header}
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingBottom: tabClearance, paddingHorizontal: spacing.xl }]}
      >

        {!loading && rules.length === 0 ? (
          <EmptyState
            icon="notifications-off-outline"
            title={t('reminder.emptyTitle')}
            description={t('reminder.emptyDesc')}
            testID="reminder-empty"
          />
        ) : null}

        {rules.length > 0 ? (
          <ListSection
            title={t('reminder.rulesSectionTitle')}
            footer={t('reminder.sectionFooter')}
            testID="reminder-rules"
          >
            {rules.map((rule) => (
              <ListRow
                key={rule.id}
                icon={sourceIcon(rule)}
                iconColor={disabledRules.has(rule.id) ? semantic.textTertiary : undefined}
                title={ruleTitle(rule)}
                subtitle={ruleSubtitle(rule)}
                trailing={
                  <Switch
                    value={!disabledRules.has(rule.id)}
                    onValueChange={(v) => void handleToggle(rule, v)}
                    accessibilityLabel={ruleTitle(rule)}
                    testID={`reminder-rule-${rule.id}`}
                  />
                }
              />
            ))}
          </ListSection>
        ) : null}

        {/* 通知状态：为什么没弹，一眼可见（权限 / 已排期条数 / 下一条触发时间） */}
        <ListSection title={t('reminder.statusSection')} testID="reminder-notif-state">
          <ListRow
            icon={notifState.perm === 'granted' ? 'checkmark-circle-outline' : 'alert-circle-outline'}
            iconColor={notifState.perm === 'granted' ? semantic.accentText : semantic.danger}
            title={t('reminder.statusPerm')}
            subtitle={notifState.perm === 'granted' ? t('reminder.statusPermOn') : t('reminder.statusPermOff')}
          />
          <ListRow
            icon="alarm-outline"
            title={t('reminder.statusScheduled')}
            subtitle={notifState.scheduled > 0 ? `${notifState.scheduled} 条` : t('reminder.statusScheduledNone')}
          />
          <ListRow
            icon="time-outline"
            title={t('reminder.statusNext')}
            subtitle={
              notifState.nextAt
                ? `${formatDate(notifState.nextAt, langMode, { style: 'monthDay' })} ${String(notifState.nextAt.getHours()).padStart(2, '0')}:${String(notifState.nextAt.getMinutes()).padStart(2, '0')}`
                : t('reminder.statusNextNone')
            }
          />
        </ListSection>

        {/* 测试：当场验证权限/渠道/排期这条链通不通（真机排查用） */}
        <ListSection title={t('reminder.testSection')} testID="reminder-notif-test">
          <ListRow icon="notifications-outline" title={t('reminder.testNow')} onPress={() => void runTest(1)} />
          <ListRow icon="timer-outline" title={t('reminder.testIn10s')} onPress={() => void runTest(10)} />
          {testResult ? <ListRow icon="information-circle-outline" title={t('reminder.testResult')} subtitle={testResult} /> : null}
        </ListSection>

        {/* 管理员广播：给所有已注册设备发一条（服务端还会再校验一次身份） */}
        {isBroadcastAdmin ? (
          <ListSection title={t('reminder.broadcastSection')} testID="reminder-broadcast">
            <ListRow
              icon="megaphone-outline"
              title={t('reminder.broadcastRow')}
              onPress={() => void runBroadcast()}
            />
            {broadcastResult ? (
              <ListRow icon="information-circle-outline" title={t('reminder.testResult')} subtitle={broadcastResult} />
            ) : null}
          </ListSection>
        ) : null}

        {/* 预算超支：本月已经触发的阈值，删掉 = 这个月不再为它提醒 */}
        {budgetAlerts.length > 0 ? (
          <ListSection title={t('reminder.budgetSectionTitle')} testID="reminder-budget-section">
            {budgetAlerts.map((alert) => {
              const name = alert.label === 'total' ? t('reminder.budgetTotal') : alert.label;
              return (
                <ListRow
                  key={alert.key}
                  icon={alert.level === 'over' ? 'alert-circle-outline' : 'warning-outline'}
                  iconColor={alert.level === 'over' ? semantic.danger : semantic.textSecondary}
                  title={
                    alert.level === 'over'
                      ? `${name} ${t('home.budgetOver', {
                          amount: formatMoney(alert.spent - alert.limit, { decimals: decimalPlaces }),
                        })}`
                      : t('reminder.budgetNearTitle', { name, percent: alert.percent })
                  }
                  subtitle={t('reminder.budgetBody', {
                    spent: formatMoney(alert.spent, { decimals: decimalPlaces }),
                    limit: formatMoney(alert.limit, { decimals: decimalPlaces }),
                  })}
                  trailing={
                    <Pressable
                      onPress={() => void dismissBudgetAlert(alert.key)}
                      hitSlop={12}
                      accessibilityRole="button"
                      accessibilityLabel={t('reminder.deleteRow')}
                      testID={`reminder-budget-dismiss-${alert.key}`}
                      style={styles.deleteButton}
                    >
                      <Ionicons name="trash-outline" size={18} color={semantic.textTertiary} />
                    </Pressable>
                  }
                />
              );
            })}
          </ListSection>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingTop: 8, gap: 12 },
  nextWhenRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6 },
  nextMessage: { marginTop: 8 },
  deleteButton: { padding: 6 },
});
