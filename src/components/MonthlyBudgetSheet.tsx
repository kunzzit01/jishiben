// MonthlyBudgetSheet.tsx
// 月度预算抽屉：本月总预算 + 分类预算进度条（设计稿「09 月度预算」，surface 卡 + 阈值进度条）。
//
// 数据来源（全部只读，不新增写入路径）
// - 额度：AppContext.budgets —— categoryId === 'total' 是总预算，其余是分类额度，
//   同一 categoryId 按币种各存一条（见 AppContext.setBudget 的实现）。
// - 已用：调用方按「本月 + 该币种 + type === 'expense'」聚合后的分类合计（HomeScreen 算好传入）。
//
// 交互
// - 点总预算行「编辑」→ 原预算计算器（onEditTotal，行为与改造前一致）。
// - 点分类行 → 同一计算器，目标换成该分类（onEditCategory）。
// - 长按分类行 → onClearCategory（= setBudget(categoryId, 0)）。
//
// 版式（design/jishiben-light.op 第 09 屏）：
//   总预算卡：左「已用 / 总预算」+ 右百分比 → 大金额 → 10 高轨道
//   分类行卡：28 图标块 + 名称 + 右百分比（22/600，涨跌不给色，色只给条）→ 8 高轨道 → 金额行
// 颜色一律取语义 token：条色 = status.success / status.warning / status.danger（阈值 65% / 90%）。
//
// 超支（用超过额度）的展示语义：百分比一旦 > 100% 就不再是「进度」而是「超支幅度」——
// 标签显示 −N%（N = 超支幅度的百分点），条固定满格且固定 danger；读屏改用「超支 N%」
// （负号会被念成「负七十三」）。总预算与分类预算共用 utils/budgetPct.ts 的 formatBudgetPct
// （首页净资产卡的预算槽用的是同一份），别处不要再写百分比三元表达式。

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { formatBudgetPct } from '../utils/budgetPct';
import AppText from './ui/AppText';
import BottomSheet from './ui/BottomSheet';
import MoneyText from './ui/MoneyText';
import ProgressBar from './ui/ProgressBar';
import PressableScale from './PressableScale';
import { withAlpha } from './ui/color';

export type BudgetCategoryRow = {
  categoryId: string;
  name: string;
  /** Ionicons 图标名（分类没给图标时用价签兜底） */
  icon?: string;
  /** 分类色（hex）；缺省用 semantic.accent */
  color?: string;
  /** 已设额度（> 0） */
  limit: number;
  /** 本月该分类支出合计（正数） */
  used: number;
};

export type BudgetUnsetCategory = {
  categoryId: string;
  name: string;
  icon?: string;
  color?: string;
  used: number;
};

export interface MonthlyBudgetSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 当前币种（额度按币种各存一条） */
  currency: string;
  /** 总预算额度（0 = 未设） */
  totalLimit: number;
  /** 本月支出合计（总预算已用） */
  totalUsed: number;
  /** 已设额度的分类 */
  rows: BudgetCategoryRow[];
  /** 未设额度但有本月支出的分类（可一键加额度） */
  unsetRows: BudgetUnsetCategory[];
  /** 隐私模式 */
  hidden?: boolean;
  onEditTotal: () => void;
  onEditCategory: (categoryId: string) => void;
  onClearCategory: (categoryId: string) => void;
  testID?: string;
}

const FALLBACK_ICON: React.ComponentProps<typeof Ionicons>['name'] = 'pricetag-outline';

export function MonthlyBudgetSheet({
  visible,
  onClose,
  currency,
  totalLimit,
  totalUsed,
  rows,
  unsetRows,
  hidden,
  onEditTotal,
  onEditCategory,
  onClearCategory,
  testID,
}: MonthlyBudgetSheetProps) {
  const { semantic, spacing, radius, layout } = useTheme();
  const t = useT();

  const styles = useMemo(
    () =>
      StyleSheet.create({
        scroll: { maxHeight: '100%' },
        content: { paddingHorizontal: layout.card, paddingBottom: spacing.xxl, gap: spacing.lg },
        // 卡面：稿里 12 圆角、16 内衬、surface 实底（页面底比它深一档分层）
        card: {
          borderRadius: radius.md,
          backgroundColor: semantic.surface,
          padding: layout.card,
          gap: spacing.sm,
        },
        totalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        totalAmountRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, flexWrap: 'wrap' },
        editChip: {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          borderRadius: radius.full,
          backgroundColor: semantic.accentSoft,
        },
        // 分类行
        sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
        rowList: { gap: spacing.md },
        rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
        // 稿：28 方块（不是圆），内嵌 16 图标
        iconBox: {
          width: 28,
          height: 28,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
        },
        rowTitleWrap: { flex: 1, minWidth: 0 },
        pctText: { marginLeft: spacing.sm },
        rowAmountText: { marginTop: 2 },
        emptyHint: { paddingVertical: spacing.sm },
        unsetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
      }),
    [semantic, spacing, radius, layout]
  );

  const totalPct = formatBudgetPct(totalUsed, totalLimit, t);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`${t('home.budgetSheetTitle')} · ${currency}`}
      fill={semantic.bg}
      maxHeightRatio={0.9}
      testID={testID}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 总预算卡：左标签 + 右百分比 → 大金额 → 10 高轨道（稿） */}
        <View style={styles.card} testID="budget-total-block">
          <View style={styles.totalHead}>
            <AppText variant="caption" color={semantic.textTertiary}>
              {t('home.budgetTotalRow')}
            </AppText>
            {totalLimit > 0 ? (
              <AppText
                variant="title2"
                weight="600"
                color={semantic.accent}
                accessibilityLabel={totalPct.a11y}
                testID="budget-total-pct"
              >
                {totalPct.text}
              </AppText>
            ) : (
              <PressableScale
                activeScale={0.94}
                onPress={onEditTotal}
                accessibilityRole="button"
                accessibilityLabel={t('home.budgetEdit')}
                style={styles.editChip}
                testID="budget-total-edit"
              >
                <AppText variant="caption" weight="600" color={semantic.accentText}>
                  {t('home.budgetEdit')}
                </AppText>
              </PressableScale>
            )}
          </View>
          {totalLimit > 0 ? (
            <>
              <View style={styles.totalAmountRow}>
                <MoneyText value={totalUsed} kind="plain" variant="title2" color={semantic.textPrimary} hidden={hidden} />
                <AppText variant="subhead" color={semantic.textTertiary}>
                  {' / '}
                </AppText>
                <MoneyText value={totalLimit} kind="plain" variant="subhead" color={semantic.textSecondary} hidden={hidden} />
              </View>
              <ProgressBar ratio={totalPct.fillRatio} tone={totalPct.tone} height={10} testID="budget-total-bar" />
            </>
          ) : (
            <AppText variant="subhead" color={semantic.textTertiary}>
              {t('home.budgetEmpty')}
            </AppText>
          )}
        </View>

        {/* 分类预算 */}
        <View style={styles.sectionHead}>
          <AppText variant="caption" weight="600" color={semantic.textSecondary}>
            {t('home.budgetCategorySection')}
          </AppText>
          <AppText variant="caption" color={semantic.textTertiary}>
            {rows.length}
          </AppText>
        </View>

        {rows.length === 0 && (
          <AppText variant="footnote" color={semantic.textTertiary} style={styles.emptyHint}>
            {t('home.budgetCategoryEmpty')}
          </AppText>
        )}

        <View style={styles.rowList}>
          {rows.map((row) => {
            const pct = formatBudgetPct(row.used, row.limit, t);
            const iconName = (row.icon ?? FALLBACK_ICON) as React.ComponentProps<typeof Ionicons>['name'];
            const tint = row.color ?? semantic.accent;
            return (
              <PressableScale
                key={row.categoryId}
                activeScale={0.98}
                onPress={() => onEditCategory(row.categoryId)}
                onLongPress={() => onClearCategory(row.categoryId)}
                accessibilityRole="button"
                accessibilityLabel={`${row.name} ${pct.a11y}`}
                style={styles.card}
                testID={`budget-cat-${row.categoryId}`}
              >
                <View style={styles.rowHead}>
                  <View style={[styles.iconBox, { backgroundColor: withAlpha(tint, 0.12) }]}>
                    <Ionicons name={iconName} size={16} color={tint} />
                  </View>
                  <View style={styles.rowTitleWrap}>
                    <AppText variant="subhead" weight="500" color={semantic.textPrimary} numberOfLines={1}>
                      {row.name}
                    </AppText>
                  </View>
                  {/* 稿：百分比 22/600 主文字色 —— 是否超支只由条色表达，数字不重复上色 */}
                  <AppText
                    variant="title2"
                    weight="600"
                    color={semantic.textPrimary}
                    style={styles.pctText}
                    accessibilityLabel={pct.a11y}
                    testID={`budget-cat-pct-${row.categoryId}`}
                  >
                    {pct.text}
                  </AppText>
                </View>
                <ProgressBar ratio={pct.fillRatio} tone={pct.tone} height={8} testID={`budget-cat-bar-${row.categoryId}`} />
                <View style={styles.totalAmountRow}>
                  <MoneyText value={row.used} kind="plain" variant="caption" color={semantic.textTertiary} hidden={hidden} />
                  <AppText variant="caption" color={semantic.textTertiary}>
                    {' / '}
                  </AppText>
                  <MoneyText value={row.limit} kind="plain" variant="caption" color={semantic.textTertiary} hidden={hidden} />
                </View>
              </PressableScale>
            );
          })}
        </View>

        {/* 未设额度的分类：一键加额度 */}
        {unsetRows.length > 0 && (
          <>
            <AppText variant="footnote" color={semantic.textSecondary} style={styles.emptyHint}>
              {t('home.budgetAddCategory')}
            </AppText>
            {unsetRows.map((row) => {
              const iconName = (row.icon ?? FALLBACK_ICON) as React.ComponentProps<typeof Ionicons>['name'];
              const tint = row.color ?? semantic.accent;
              return (
                <PressableScale
                  key={row.categoryId}
                  activeScale={0.98}
                  onPress={() => onEditCategory(row.categoryId)}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.name} ${t('home.budgetNoLimit')}`}
                  style={styles.unsetRow}
                  testID={`budget-unset-${row.categoryId}`}
                >
                  <View style={[styles.iconBox, { backgroundColor: withAlpha(tint, 0.12) }]}>
                    <Ionicons name={iconName} size={16} color={tint} />
                  </View>
                  <View style={styles.rowTitleWrap}>
                    <AppText variant="subhead" color={semantic.textSecondary} numberOfLines={1}>
                      {row.name}
                    </AppText>
                  </View>
                  <AppText variant="caption" color={semantic.textTertiary}>
                    {t('home.budgetNoLimit')}
                  </AppText>
                  <Ionicons name="chevron-forward" size={16} color={semantic.textTertiary} />
                </PressableScale>
              );
            })}
          </>
        )}
      </ScrollView>
    </BottomSheet>
  );
}

export default MonthlyBudgetSheet;
