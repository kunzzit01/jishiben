import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useLanguage, useT } from '../i18n/LanguageContext';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import {
  buildCreditCardReminderNodes,
  cancelCreditCardReminderNode,
  creditCardReminderMessage,
  reconcileCreditCardReminders,
} from '../hooks/useCreditCardReminders';
import { loadMutedKeys, muteReminderKey, unmuteAllReminders } from '../utils/reminderMute';
import { AppText, Card, EmptyState, HeroGradient, ListRow, ListSection, ScreenHeader } from '../components/ui';
import { formatDate } from '../utils/formatDate';

/**
 * 提醒中心：先用一张卡给"下一次会提醒什么"的一句话，下面才是可展开的全量排期。
 *
 * 为什么列表是现算的：它复用排期的纯函数（buildCreditCardReminderNodes），所以列出来的
 * 一定就是真会排上的那几条——不需要读通知记录（App 关闭期间收到的通知原生回调抓不到）。
 *
 * 为什么删除要记进 storage：排期每轮按当前数据全量重算，不记住"用户删过这条"的话，
 * 删掉的提醒下一轮就会原样排回来，删除按钮就成了假的。
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
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  // 已删除集合：进页面读一次（内部顺手剪掉日期已过的条目）
  useEffect(() => {
    let alive = true;
    void loadMutedKeys().then((keys) => {
      if (alive) setMuted(keys);
    });
    return () => {
      alive = false;
    };
  }, []);

  const nodes = useMemo(() => {
    if (!userId) return [];
    return buildCreditCardReminderNodes(userId, assets, new Date())
      .filter((node) => !muted.has(node.key))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [userId, assets, muted]);

  const next = nodes[0];
  const nextMessage = next ? creditCardReminderMessage(t, next) : null;

  const handleDelete = useCallback(async (key: string) => {
    // 先撤系统通知，再记住这条不再排；顺序反了的话中途失败会留下一条已忘记录但仍会弹的通知
    await cancelCreditCardReminderNode(key);
    await muteReminderKey(key);
    setMuted((prev) => new Set(prev).add(key));
  }, []);

  const handleRestore = useCallback(async () => {
    await unmuteAllReminders();
    setMuted(new Set());
    // 恢复后要立刻把通知重排回来，否则要等下一次资产变化
    if (userId) await reconcileCreditCardReminders({ userId, assets, t });
  }, [userId, assets, t]);

  const renderRow = (node: (typeof nodes)[number]) => {
    const time = `${String(node.at.getHours()).padStart(2, '0')}:${String(node.at.getMinutes()).padStart(2, '0')}`;
    const isStatement = node.kind === 'statement';
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
        trailing={
          <Pressable
            onPress={() => void handleDelete(node.key)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('reminder.deleteRow')}
            testID={`reminder-delete-${node.key}`}
            style={styles.deleteButton}
          >
            <Ionicons name="trash-outline" size={18} color={semantic.textTertiary} />
          </Pressable>
        }
        testID={`reminder-row-${isStatement ? 'statement' : `payday-${node.leadDays}`}-${node.at.getTime()}`}
      />
    );
  };

  const header = (
    <ScreenHeader variant="compact" title={t('reminder.title')} onBack={() => navigation.goBack()} />
  );

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
        {!next ? (
          <EmptyState
            icon="notifications-off-outline"
            title={t('reminder.emptyTitle')}
            description={t('reminder.emptyDesc')}
            testID="reminder-empty"
          />
        ) : (
          <>
            {/* 先一句温馨提醒：用户点铃铛想知道的就是"我最近一次要做什么" */}
            <Card testID="reminder-next-card">
              <AppText variant="footnote" color={semantic.textSecondary}>
                {t('reminder.nextTitle')}
              </AppText>
              <View style={styles.nextWhenRow}>
                <AppText variant="title3" weight="600">
                  {formatDate(next.at, langMode, { style: 'monthDay' })}
                </AppText>
                <AppText variant="headline" color={semantic.textSecondary}>
                  {String(next.at.getHours()).padStart(2, '0')}:
                  {String(next.at.getMinutes()).padStart(2, '0')}
                </AppText>
              </View>
              {nextMessage ? (
                <AppText variant="subhead" color={semantic.textPrimary} style={styles.nextMessage}>
                  {nextMessage.title}
                </AppText>
              ) : null}
            </Card>

            {/* 折叠按钮：默认收起，避免一屏几十行把"下次提醒"顶走 */}
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={t('reminder.expandTitle', { count: nodes.length })}
              testID="reminder-expand"
              style={styles.expandRow}
            >
              <AppText variant="footnote" color={semantic.textSecondary}>
                {t('reminder.expandTitle', { count: nodes.length })}
              </AppText>
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={semantic.textSecondary}
              />
            </Pressable>

            {expanded ? (
              <ListSection footer={t('reminder.sectionFooter')} testID="reminder-list">
                {nodes.map(renderRow)}
              </ListSection>
            ) : null}

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
          </>
        )}
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
