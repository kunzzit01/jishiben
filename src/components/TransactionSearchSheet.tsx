// TransactionSearchSheet.tsx
// 首页「搜索」/「查看全部」的落地面板（设计稿 01 屏头部动作 + 最近交易区块标题行）。
//
// 一个组件、两种模式（共用同一份行数据与同一条「点结果 → 编辑账单」行为）：
//   · mode='search'（顶栏放大镜）：按 备注 / 分类 / 账户 / 金额 / 日期 过滤；
//   · mode='all'（最近交易标题行的「查看全部」）：无查询词时**展示全部**流水，标题改「全部交易」。
// 两种模式都不截断：行数可能上百，渲染交给 FlatList（首屏一批、之后按窗口补），
// 不做 rows.slice(0, N) —— 原来写死的 20 条上限就是「滚不到底」的根因。
//
// 不新增写入路径：点一行进既有「编辑账单」页。颜色 / 圆角 / 间距一律取语义 token，无裸 hex。

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, ListRenderItemInfo, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import AppText from './ui/AppText';
import BottomSheet from './ui/BottomSheet';
import MoneyText from './ui/MoneyText';
import IconCircle from './ui/IconCircle';
import PressableScale from './PressableScale';

export type SearchRow = {
  id: string;
  /** 主标题：备注优先，没有备注用分类名 */
  title: string;
  /** 副标题：分类 · 账户 */
  subtitle: string;
  amount: number;
  kind: 'income' | 'expense';
  /** 已格式化的日期文本（YYYY-MM-DD） */
  dateText: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

/** 抽屉模式：'search' = 顶栏搜索；'all' = 「查看全部」（无查询词时列全部） */
export type TransactionSheetMode = 'search' | 'all';

export interface TransactionSearchSheetProps {
  visible: boolean;
  onClose: () => void;
  rows: SearchRow[];
  onPick: (id: string) => void;
  /** 隐私模式：金额显示为隐藏态 */
  hideAmounts?: boolean;
  /** 默认 'search'（既有顶栏搜索行为不变） */
  mode?: TransactionSheetMode;
  testID?: string;
}

/** 首屏一批渲染多少行（大于验收下限 20；之后按窗口继续补，不是一次性全渲染） */
const INITIAL_ROWS = 24;
const MAX_BATCH = 12;
const WINDOW_SIZE = 7;

export function TransactionSearchSheet({
  visible,
  onClose,
  rows,
  onPick,
  hideAmounts,
  mode = 'search',
  testID,
}: TransactionSearchSheetProps) {
  const { semantic, spacing, radius, layout } = useTheme();
  const t = useT();
  const [query, setQuery] = useState('');

  const styles = useMemo(
    () =>
      StyleSheet.create({
        searchBox: {
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: spacing.sm,
          marginHorizontal: layout.card,
          marginBottom: spacing.md,
          paddingHorizontal: spacing.md,
          minHeight: 44,
          borderRadius: radius.sm,
          backgroundColor: semantic.surfaceSunken,
        },
        input: {
          flexGrow: 1,
          flexShrink: 1,
          minWidth: 0,
          paddingVertical: spacing.sm,
          color: semantic.textPrimary,
          fontSize: 15,
        },
        // FlatList = RNW 的 ScrollView：与旧写法同款（抽屉高度由 BottomSheet 的 maxHeight 定，
        // 这里只负责「占满剩余空间并自己滚」）
        scroll: { maxHeight: '100%', flexShrink: 1 },
        content: { paddingBottom: spacing.xxl },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: spacing.md,
          minHeight: layout.rowMinHeight,
          paddingHorizontal: layout.card,
          paddingVertical: spacing.sm,
        },
        rowText: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
        empty: { paddingHorizontal: layout.card, paddingVertical: spacing.lg },
      }),
    [semantic, spacing, radius, layout]
  );

  const q = query.trim().toLowerCase();
  // 无查询词 = 全部（不再 slice）；有查询词 = 命中的全部（同样不再截断）
  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.subtitle.toLowerCase().includes(q) ||
        r.dateText.includes(q) ||
        String(r.amount).includes(q)
    );
  }, [rows, q]);

  const renderRow = useCallback(
    ({ item: r }: ListRenderItemInfo<SearchRow>) => (
      <PressableScale
        activeScale={0.98}
        onPress={() => onPick(r.id)}
        accessibilityRole="button"
        accessibilityLabel={`${r.title} ${r.amount}`}
        style={styles.row}
        testID={`search-row-${r.id}`}
      >
        <IconCircle size={38} color={r.color} icon={r.icon} shape="tile" />
        <View style={styles.rowText}>
          <AppText variant="subhead" weight="500" color={semantic.textPrimary} numberOfLines={1}>
            {r.title}
          </AppText>
          <AppText variant="caption2" color={semantic.textTertiary} numberOfLines={1}>
            {`${r.dateText} · ${r.subtitle}`}
          </AppText>
        </View>
        <MoneyText value={r.amount} kind={r.kind} variant="body" weight="600" hidden={hideAmounts} />
      </PressableScale>
    ),
    [onPick, styles, semantic, hideAmounts]
  );

  // 行高是固定的（标题 / 副标题都 numberOfLines={1}，行高由 minHeight 决定）→ 交给 FlatList 解析式布局：
  // 内容总高一步到位（n × 行高），滚动位置 / 窗口范围不依赖测量推断，上百条也不会算错。
  const rowHeight = Math.max(52, layout.rowMinHeight);
  const getItemLayout = useCallback(
    (_data: ArrayLike<SearchRow> | null | undefined, index: number) => ({
      length: rowHeight,
      offset: rowHeight * index,
      index,
    }),
    [rowHeight]
  );

  const renderEmpty = useCallback(
    () => (
      <AppText variant="footnote" color={semantic.textTertiary} style={styles.empty}>
        {q ? t('common.noResult') : t('home.noTx')}
      </AppText>
    ),
    [q, t, semantic, styles]
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      // 「查看全部」模式标题 = 全部交易；搜索模式沿用既有「搜索」
      title={mode === 'all' ? t('home.allTxTitle') : t('common.search')}
      fill={semantic.bg}
      maxHeightRatio={0.85}
      testID={testID}
    >
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color={semantic.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('common.searchPlaceholder')}
          placeholderTextColor={semantic.textTertiary}
          style={styles.input}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('common.search')}
        />
        {query.length > 0 && (
          <PressableScale
            activeScale={0.92}
            hitSlop={8}
            onPress={() => setQuery('')}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close-circle" size={18} color={semantic.textTertiary} />
          </PressableScale>
        )}
      </View>

      <FlatList
        data={filtered}
        renderItem={renderRow}
        keyExtractor={keyExtractor}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        ListEmptyComponent={renderEmpty}
        getItemLayout={getItemLayout}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // 虚拟化：首屏一批、每批补 12 条、保留 7 屏窗口 —— 上百条也不会一次渲染全部
        initialNumToRender={INITIAL_ROWS}
        maxToRenderPerBatch={MAX_BATCH}
        windowSize={WINDOW_SIZE}
        removeClippedSubviews={false}
        testID={testID ? `${testID}-list` : undefined}
      />
    </BottomSheet>
  );
}

const keyExtractor = (r: SearchRow) => r.id;

export default TransactionSearchSheet;
