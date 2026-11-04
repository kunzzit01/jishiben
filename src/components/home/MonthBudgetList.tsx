// 首页「分类预算」卡：一行一条，最多 3 条 —— 图标 / 名称 / 进度条 / 状态胶囊（不显示金额）。
// 金额与「已用 / 预算」的完整排布只在月度预算面板里出现（那里才有宽度放得下）。
// 标题右侧「查看更多 ›」→ 打开面板看全部预算；点某一行 → 进入该分类预算编辑。
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { AppText } from '../ui';
import PressableScale from '../PressableScale';
import { useTheme } from '../../theme/useTheme';
import { radius, spacing } from '../../theme/theme';
import { formatBudgetPct } from '../../utils/budgetPct';
import type { HomePalette } from '../../theme/homePalette';
import { useT } from '../../i18n/LanguageContext';

export type BudgetListItem = {
  categoryId: string;
  name: string;
  color?: string;
  limit: number;
  used: number;
};

type Props = {
  items: BudgetListItem[];
  palette: HomePalette;
  hidden: boolean;
  /** 首页不展示金额，此参数仅为接口兼容保留 */
  currency?: string;
  /** 标题行「查看更多」：打开月度预算面板（不传则回落到 onPressItem('total')） */
  onPressSeeAll?: () => void;
  onPressItem: (categoryId: string) => void;
};

const MAX_ROWS = 3;

export default function MonthBudgetList({ items, palette, onPressSeeAll, onPressItem }: Props) {
  const { semantic } = useTheme();
  const t = useT();
  if (items.length === 0) return null;

  const rows = items.slice(0, MAX_ROWS);

  return (
    <View style={styles.wrap} testID="home-month-budgets">
      <View style={[styles.card, { backgroundColor: semantic.surface, borderColor: semantic.hairline }]}>
        {/* 标题行：整行可点 → 面板看全部 */}
        <PressableScale
          style={styles.head}
          activeScale={0.99}
          onPress={() => (onPressSeeAll ? onPressSeeAll() : onPressItem('total'))}
          accessibilityRole="button"
          accessibilityLabel={t('home.seeAllBudgets')}
          testID="home-budgets-open"
        >
          <AppText variant="subhead" weight="600" color={semantic.textPrimary}>
            {t('home.categoryBudgets')}
          </AppText>
          <View style={styles.headRight}>
            <AppText variant="caption" weight="600" color={semantic.accentText}>
              {t('home.seeAllBudgets')}
            </AppText>
            <Ionicons name="chevron-forward" size={14} color={semantic.accentText} />
          </View>
        </PressableScale>

        {rows.map((it, i) => {
          const pct = formatBudgetPct(it.used, it.limit, t);
          const over = it.limit > 0 && it.used > it.limit;
          const ratio = it.limit > 0 ? Math.min(1, it.used / it.limit) : 0;
          const tone = it.color ?? palette.progressFrom;

          return (
            <PressableScale
              key={it.categoryId}
              style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: semantic.hairline }]}
              activeScale={0.98}
              onPress={() => onPressItem(it.categoryId)}
              accessibilityRole="button"
              accessibilityLabel={`${it.name} ${pct.a11y}`}
              testID={`home-budget-row-${it.categoryId}`}
            >
              <View style={[styles.icon, { backgroundColor: tone + '1F' }]}>
                <Ionicons name="pricetag-outline" size={13} color={tone} />
              </View>

              <AppText variant="subhead" weight="500" color={semantic.textPrimary} numberOfLines={1} style={styles.name}>
                {it.name}
              </AppText>

              <View style={[styles.track, { backgroundColor: palette.trackBg }]}>
                {over ? (
                  <View style={[styles.fill, { backgroundColor: palette.expense, width: '100%' }]} />
                ) : (
                  <LinearGradient
                    colors={[palette.progressFrom, palette.progressTo] as const}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.fill, { width: `${ratio * 100}%` }]}
                  />
                )}
              </View>

              <View
                style={[
                  styles.pill,
                  over ? { backgroundColor: palette.expense + '1A' } : { backgroundColor: semantic.hairline },
                ]}
              >
                <AppText
                  variant="caption2"
                  weight="600"
                  color={over ? palette.expense : semantic.textSecondary}
                  numberOfLines={1}
                >
                  {over ? t('home.budgetOverBadge') : pct.text}
                </AppText>
              </View>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm, paddingHorizontal: 16 },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  headRight: { flexDirection: 'row', alignItems: 'center', columnGap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    minHeight: 44,
  },
  icon: { width: 24, height: 24, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  name: { width: 64 },
  track: { flex: 1, minWidth: 24, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  pill: { minWidth: 46, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 3, borderRadius: radius.full },
});
