import React, { useMemo } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { buildCreditCardReminderNodes } from '../hooks/useCreditCardReminders';
import { EmptyState, HeroGradient, ListRow, ListSection, ScreenHeader } from '../components/ui';
import { formatDate } from '../utils/formatDate';

/**
 * 提醒中心：把"未来 3 个月会提醒什么"直接摊开。
 *
 * 为什么要单独一页：信用卡提醒交给系统通知后，用户在 App 里看不到任何痕迹——
 * 通知被划掉、被系统拦掉、或干脆还没到点，都无从确认。这里复用排期的纯函数
 * （buildCreditCardReminderNodes）现算，所以列出来的一定就是"真的会排上的那几条"，
 * 不需要读通知记录、也不依赖后端。
 *
 * 不显示"已经提醒过什么"：通知在原生的监听器里只在该进程活着时回调，App 关闭期间
 * 收到的通知抓不到，做出来会让人以为漏了提醒。
 */
export default function ReminderCenterScreen({ navigation }: any) {
  const { semantic, spacing } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  const { assets } = useApp();
  const { user } = useAuth();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();

  const userId = user ? String(user.id) : null;

  // 未登录时排期本身就不会发生（hook 需要 userId），这里同样不列
  const nodes = useMemo(() => {
    if (!userId) return [];
    return buildCreditCardReminderNodes(userId, assets, new Date()).sort(
      (a, b) => a.at.getTime() - b.at.getTime()
    );
  }, [userId, assets]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}>
      <HeroGradient fill />
      <ScreenHeader variant="compact" title={t('reminder.title')} onBack={() => navigation.goBack()} />

      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingBottom: tabClearance, paddingHorizontal: spacing.xl }]}
      >
        {!userId ? (
          <EmptyState
            icon="person-circle-outline"
            title={t('reminder.signInTitle')}
            description={t('reminder.signInDesc')}
            testID="reminder-signed-out"
          />
        ) : nodes.length === 0 ? (
          <EmptyState
            icon="notifications-off-outline"
            title={t('reminder.emptyTitle')}
            description={t('reminder.emptyDesc')}
            testID="reminder-empty"
          />
        ) : (
          <ListSection title={t('reminder.sectionTitle')} footer={t('reminder.sectionFooter')} testID="reminder-list">
            {nodes.map((node) => {
              const time = `${String(node.at.getHours()).padStart(2, '0')}:${String(node.at.getMinutes()).padStart(2, '0')}`;
              const isStatement = node.kind === 'statement';
              const testKey = isStatement ? 'statement' : `payday-${node.leadDays}`;
              return (
                <ListRow
                  key={node.key}
                  icon={isStatement ? 'document-text-outline' : 'time-outline'}
                  title={isStatement ? t('reminder.kindStatement') : t('reminder.kindPayday', { days: node.leadDays })}
                  subtitle={t('reminder.rowSubtitle', {
                    date: formatDate(node.at, langMode, { style: 'monthDay', relative: false }),
                    time,
                    name: node.assetName,
                  })}
                  testID={`reminder-row-${testKey}-${node.at.getTime()}`}
                />
              );
            })}
          </ListSection>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingTop: 8, gap: 12 },
});
