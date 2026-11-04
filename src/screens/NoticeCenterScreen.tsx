import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { useApp } from '../context/AppContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { useReminderItems } from '../reminders/useReminderItems';
import { useBudgetAlerts } from '../reminders/useBudgetAlerts';
import type { ReminderItem } from '../reminders/types';
import type { BudgetAlert } from '../reminders/budget';
import { AppText, EmptyState, HeroGradient, ListRow, ListSection, ScreenHeader } from '../components/ui';
import { formatDate } from '../utils/formatDate';
import { formatMoney } from '../utils/formatMoney';

/**
 * 通知中心（首页铃铛 / 通知栏进入）：只有通知，没有开关、没有删除、没有说明段落。
 * 设置项（规则开关 / 预算提醒管理）全部在 设置 → 提醒设置。
 */
export default function NoticeCenterScreen({ navigation }: any) {
  const { semantic } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  const { decimalPlaces } = useApp();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const { items } = useReminderItems();
  const { alerts } = useBudgetAlerts();

  // 只列「今天」该收到的通知：at 落在今天 00:00–24:00 之间；之后的排期不进这个页面
  const today = useMemo(() => {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    return items
      .filter((it) => it.at.getTime() >= dayStart && it.at.getTime() < dayEnd)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [items]);

  const alertRow = (alert: BudgetAlert) => {
    const name = alert.label === 'total' ? t('reminder.budgetTotal') : alert.label;
    const over = alert.level === 'over';
    return (
      <ListRow
        key={alert.key}
        icon={over ? 'alert-circle-outline' : 'warning-outline'}
        iconColor={over ? semantic.danger : semantic.textSecondary}
        title={
          over
            ? `${name} ${t('home.budgetOver', {
                amount: formatMoney(alert.spent - alert.limit, { decimals: decimalPlaces }),
              })}`
            : t('reminder.budgetNearTitle', { name, percent: alert.percent })
        }
        subtitle={t('reminder.budgetBody', {
          spent: formatMoney(alert.spent, { decimals: decimalPlaces }),
          limit: formatMoney(alert.limit, { decimals: decimalPlaces }),
        })}
        testID={`notice-budget-${alert.key}`}
      />
    );
  };

  const reminderRow = (item: ReminderItem) => (
    <ListRow
      key={item.key}
      icon={item.source === 'credit' ? 'card-outline' : item.source === 'plan' ? 'repeat-outline' : item.source === 'daily' ? 'create-outline' : 'calendar-outline'}
      iconColor={semantic.accentText}
      title={t(item.titleKey, item.titleParams)}
      subtitle={`${formatDate(item.at, langMode, { style: 'monthDay' })} ${String(item.at.getHours()).padStart(2, '0')}:${String(item.at.getMinutes()).padStart(2, '0')}`}
      testID={`notice-item-${item.key}`}
    />
  );

  const hasAny = alerts.length > 0 || today.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}>
      <HeroGradient fill />
      <ScreenHeader variant="compact" title={t('notification.title')} onBack={() => navigation?.goBack?.()} />
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingBottom: tabClearance }]}
      >
        {!hasAny ? (
          <EmptyState
            icon="notifications-off-outline"
            title={t('notification.emptyTitle')}
            description={t('notification.emptyDesc')}
            testID="notice-empty"
          />
        ) : null}

        {alerts.length > 0 ? (
          <ListSection title={t('reminder.budgetSectionTitle')} testID="notice-budget">
            {alerts.map(alertRow)}
          </ListSection>
        ) : null}

        {today.length > 0 ? (
          <ListSection title={t('notification.today')} testID="notice-today">
            {today.map(reminderRow)}
          </ListSection>
        ) : null}

        {hasAny ? (
          <AppText variant="caption2" color={semantic.textTertiary} style={styles.footer}>
            {t('notification.manageHint')}
          </AppText>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  footer: { textAlign: 'center', paddingHorizontal: 8 },
});
