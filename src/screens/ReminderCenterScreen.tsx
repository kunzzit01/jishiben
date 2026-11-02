import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { useReminderItems } from '../reminders/useReminderItems';
import type { ReminderItem } from '../reminders/types';
import { cancelReminderItem, reconcileReminders } from '../hooks/useReminders';
import { muteReminderKey, unmuteAllReminders } from '../utils/reminderMute';
import { AppText, Card, EmptyState, HeroGradient, ListRow, ListSection, ScreenHeader, Switch } from '../components/ui';
import { formatDate } from '../utils/formatDate';

/**
 * 统一提醒中心：信用卡（还款日 + 账单日）、计划付款、每日记账、月末总结。
 *
 * 条目来自 src/reminders/build.ts 的纯函数 —— 页面显示与通知排期共用同一份计算，
 * 所以"页面上有这条"和"系统里排了这条"不会分叉。
 *
 * 删除语义：撤掉这条通知 + 记住"这条不再提醒"。不记住的话排期每轮全量重算，
 * 删掉的下一轮就会原样排回来（见 utils/reminderMute.ts）。
 */
export default function ReminderCenterScreen({ navigation }: any) {
  const { semantic, spacing } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  const { user } = useAuth();
  const { decimalPlaces } = useApp();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const { items, allItems, prefs, setPrefs, muted, reloadMuted, loading } = useReminderItems();
  const [expanded, setExpanded] = useState(false);

  const next = items[0];
  const userId = user ? String(user.id) : null;

  /** 列表短标题：信用卡的提前量编码在文案键里（reminderOn3/2/1），这里翻译成天数 */
  const rowTitle = useCallback(
    (item: ReminderItem): string => {
      if (item.source === 'credit') {
        if (item.titleKey === 'asset.reminderOn3') return t('reminder.kindPayday', { days: 3 });
        if (item.titleKey === 'asset.reminderOn2') return t('reminder.kindPayday', { days: 2 });
        if (item.titleKey === 'asset.reminderOn1') return t('reminder.kindPayday', { days: 1 });
        return t('reminder.kindStatement');
      }
      if (item.source === 'plan') {
        return item.titleKey === 'reminder.planToday'
          ? t('reminder.rowPlanToday')
          : t('reminder.rowPlanLead', { days: item.titleParams.days ?? '' });
      }
      if (item.source === 'daily') return t('reminder.rowDaily');
      return t('reminder.rowMonthEnd');
    },
    [t]
  );

  const sourceIcon = (item: ReminderItem) => {
    switch (item.source) {
      case 'credit':
        return item.titleKey === 'asset.reminderOnStatement' ? 'document-text-outline' : 'card-outline';
      case 'plan':
        return 'repeat-outline';
      case 'daily':
        return 'create-outline';
      default:
        return 'calendar-outline';
    }
  };

  const handleDelete = useCallback(
    async (key: string) => {
      await cancelReminderItem(key);
      await muteReminderKey(key);
      await reloadMuted();
    },
    [reloadMuted]
  );

  const handleRestore = useCallback(async () => {
    await unmuteAllReminders();
    await reloadMuted();
    // 恢复后立刻重排，否则要等下一次条目变化
    await reconcileReminders({ items: allItems, t, decimals: decimalPlaces });
  }, [allItems, decimalPlaces, reloadMuted, t]);

  const renderRow = (item: ReminderItem) => {
    const time = `${String(item.at.getHours()).padStart(2, '0')}:${String(item.at.getMinutes()).padStart(2, '0')}`;
    const subtitle = item.label
      ? t('reminder.rowSubtitle', {
          date: formatDate(item.at, langMode, { style: 'monthDay', relative: false }),
          time,
          name: item.label,
        })
      : `${formatDate(item.at, langMode, { style: 'monthDay', relative: false })} ${time}`;
    return (
      <ListRow
        key={item.key}
        icon={sourceIcon(item)}
        title={rowTitle(item)}
        subtitle={subtitle}
        trailing={
          <Pressable
            onPress={() => void handleDelete(item.key)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('reminder.deleteRow')}
            testID={`reminder-delete-${item.key}`}
            style={styles.deleteButton}
          >
            <Ionicons name="trash-outline" size={18} color={semantic.textTertiary} />
          </Pressable>
        }
        testID={`reminder-row-${item.source}-${item.at.getTime()}`}
      />
    );
  };

  const header = <ScreenHeader variant="compact" title={t('reminder.title')} onBack={() => navigation.goBack()} />;

  if (!userId) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}>
        <HeroGradient fill />
        {header}
        <EmptyState
          icon="person-circle-outline"
          title={t('reminder.signInTitle')}
          description={t('reminder.signInDesc')}
          testID="reminder-signed-out"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}>
      <HeroGradient fill />
      {header}
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingBottom: tabClearance, paddingHorizontal: spacing.xl }]}
      >
        {!loading && !next ? (
          <EmptyState
            icon="notifications-off-outline"
            title={t('reminder.emptyTitle')}
            description={t('reminder.emptyDesc')}
            testID="reminder-empty"
          />
        ) : null}

        {next ? (
          <>
            <Card testID="reminder-next-card">
              <AppText variant="footnote" color={semantic.textSecondary}>
                {t('reminder.nextTitle')}
              </AppText>
              <View style={styles.nextWhenRow}>
                <AppText variant="title3" weight="600">
                  {formatDate(next.at, langMode, { style: 'monthDay' })}
                </AppText>
                <AppText variant="headline" color={semantic.textSecondary}>
                  {String(next.at.getHours()).padStart(2, '0')}:{String(next.at.getMinutes()).padStart(2, '0')}
                </AppText>
              </View>
              <AppText variant="subhead" color={semantic.textPrimary} style={styles.nextMessage}>
                {t(next.titleKey, next.titleParams)}
              </AppText>
            </Card>

            <Pressable
              onPress={() => setExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={t('reminder.expandTitle', { count: items.length })}
              testID="reminder-expand"
              style={styles.expandRow}
            >
              <AppText variant="footnote" color={semantic.textSecondary}>
                {t('reminder.expandTitle', { count: items.length })}
              </AppText>
              <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={semantic.textSecondary} />
            </Pressable>

            {expanded ? (
              <ListSection footer={t('reminder.sectionFooter')} testID="reminder-list">
                {items.map(renderRow)}
              </ListSection>
            ) : null}
          </>
        ) : null}

        {/* 每日记账：开关就放在中心里，不必再翻设置 */}
        <ListSection>
          <ListRow
            icon="create-outline"
            title={t('reminder.dailyRow')}
            subtitle={t('reminder.dailyRowHint', { hour: prefs.dailyHour })}
            trailing={
              <Switch
                value={prefs.dailyEnabled}
                onValueChange={(v) => void setPrefs({ ...prefs, dailyEnabled: v })}
                accessibilityLabel={t('reminder.dailyRow')}
                testID="reminder-daily-switch"
              />
            }
          />
        </ListSection>

        {muted.size > 0 ? (
          <Pressable
            onPress={() => void handleRestore()}
            accessibilityRole="button"
            testID="reminder-restore"
            style={styles.restoreRow}
          >
            <AppText variant="footnote" color={semantic.accentText}>
              {t('reminder.restoreAll')}
            </AppText>
          </Pressable>
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
  expandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  deleteButton: { padding: 6 },
  restoreRow: { alignItems: 'center', paddingVertical: 10 },
});
