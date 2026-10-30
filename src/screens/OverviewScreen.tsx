// OverviewScreen.tsx —— 「概览模式」独立页（设计稿 design/jishiben-light.op / dark.op 第 11 屏）
//
// 稿内结构（节点名逐条对应，见下方各区块注释）：
//   概览头部       头像（40 圆 + user 图标）+ 用户名 + 概览更多（⋯）
//   [退化]净资产卡  金额标签「净资产 (MYR)」+ 可见性（eye）/ 更多（⋯）+ 主金额 + 副信息行（趋势 + 本月变化）+ 迷你柱状图
//   收支结余三栏    本月支出 / 本月收入 / 本月结余（两条竖向分隔）
//   预算进度卡      %{m}整体预算 + 百分比 + 进度条
//   快捷操作        支出 / 收入 / 转账 / 扫描（40 圆角图标块 + 11pt 标签）
//
// 口径（一律复用既有实现，页面不新造业务算法）：
//   · 净资产按币种分开合计：activeAssets ⋈ activeLedgerId，逐账户 getAssetBalance（与 HomeScreen 的
//     totalsByCurrency 完全相同的一段逻辑，绝不跨币种相加）；
//   · 本月支出 / 收入：ledgerTransactions 里 type=expense|income 且 date 以当前 YYYY-MM 开头，
//     币种按「交易所属账户的币种，查不到退回全局货币」（与 HomeScreen / ReportScreen 同一口径）；
//   · 本月结余 = 本月收入 − 本月支出（同一币种内相减）；
//   · 预算：budgets 里 categoryId='total' 且币种匹配的那一条；百分比走 utils/budgetPct（唯一口径）。
//
// 空态：该账本没有资产账户、也没有任何流水时给 EmptyState（有资产没流水仍显示净资产）。
// 加载态：与首页一致 —— 启动早期由 App 的 StartupGate 挡在骨架屏，页面自身不另加 spinner。
//
// 颜色 / 圆角 / 间距 / 字号全部来自 useTheme() 令牌，本文件不含任何裸 hex。

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { Asset, Transaction } from '../types';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { ROUTES } from '../navigation/routes';
import { useT } from '../i18n/LanguageContext';
import { formatBudgetPct } from '../utils/budgetPct';
import PressableScale from '../components/PressableScale';
import {
  AppText,
  BottomSheet,
  EmptyState,
  HeroGradient,
  IconButton,
  ListRow,
  MoneyText,
  ScreenHeader,
} from '../components/ui';
// ProgressBar 未走 ui/index.ts 的统一出口（历史原因）：直接按文件路径引，组件本身仍是设计系统件
import ProgressBar from '../components/ui/ProgressBar';

/** 头像直径（稿：40） */
const AVATAR_SIZE = 40;
/** 头像内图标尺寸（20：UI_RULES 的图标两档之一） */
const AVATAR_ICON_SIZE = 20;
/** 快捷操作图标块边长（稿：40） */
const QUICK_TILE_SIZE = 40;
/** 快捷操作图标尺寸（稿：20） */
const QUICK_ICON_SIZE = 20;
/** 迷你柱状图：单柱宽 / 柱间距（稿：8 / 4） */
const SPARK_BAR_WIDTH = 8;
const SPARK_BAR_GAP = 4;
/** 迷你柱状图高度（稿里的装饰性柱形几何，不代表某个月份的真实数据） */
const SPARK_BAR_HEIGHTS = [20, 34, 26, 44, 36, 52];
/** 迷你柱状图交替透明度（稿：0.6 / 0.9） */
const SPARK_BAR_DIM = 0.6;
const SPARK_BAR_STRONG = 0.9;
/** 三栏之间的竖向分隔线高度（稿：44） */
const METRIC_DIVIDER_HEIGHT = 44;
/** 预算进度条高度（稿：8） */
const BUDGET_BAR_HEIGHT = 8;
/** 快捷操作四档（与首页同一套跳转参数：routes.ts 的 AddTxPresetType / autoScan） */
type QuickKey = 'expense' | 'income' | 'transfer' | 'scan';

export default function OverviewScreen({ navigation }: any) {
  const {
    transactions,
    budgets,
    activeAssets,
    activeLedgerId,
    currency,
    getAssetBalance,
    getAssetById,
  } = useApp();
  const { user } = useAuth();
  const { semantic, radius, spacing, layout } = useTheme();
  const { pagePadding, width: windowWidth, contentMaxWidth } = useLayout();
  const tabClearance = useTabClearance();
  const tr = useT();
  const styles = useMemo(
    () => makeStyles(semantic, radius, spacing, layout),
    [semantic, radius, spacing, layout]
  );

  // 隐藏金额（稿里「可见性」眼睛）：仅本页展示态，不写任何存储
  const [hidden, setHidden] = useState(false);
  // 币种：null = 未手选过，跟随「本账本第一个账户的币种（兜底全局货币）」，与首页同一默认
  const [currencyOverride, setCurrencyOverride] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const ledgerAssets = useMemo(
    () => activeAssets.filter((a) => a.ledgerId === activeLedgerId),
    [activeAssets, activeLedgerId]
  );

  const ledgerTransactions = useMemo(
    () => transactions.filter((t) => t.ledgerId === activeLedgerId),
    [transactions, activeLedgerId]
  );

  // 净资产按币种分组（getAssetBalance 每次渲染都是新函数 → 经 ref 读，memo 只依赖真实数据）
  const getAssetBalanceRef = useRef(getAssetBalance);
  getAssetBalanceRef.current = getAssetBalance;
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    ledgerAssets.forEach((a: Asset) => {
      totals[a.currency] = (totals[a.currency] || 0) + getAssetBalanceRef.current(a.id);
    });
    return Object.entries(totals).sort(([c1], [c2]) => c1.localeCompare(c2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerAssets, transactions]);

  const defaultCurrency = ledgerAssets[0]?.currency ?? currency;
  const activeCurrency =
    (currencyOverride && totalsByCurrency.some(([code]) => code === currencyOverride)
      ? currencyOverride
      : totalsByCurrency.some(([code]) => code === defaultCurrency)
        ? defaultCurrency
        : totalsByCurrency[0]?.[0]) ?? currency;
  const netWorth = totalsByCurrency.find(([code]) => code === activeCurrency)?.[1] ?? 0;

  // 交易所属币种（按账户币种；账户缺失时跟随全局货币）——与首页 / 统计页同一句
  const txCurrencyOf = useCallback(
    (t: Pick<Transaction, 'assetId'>) =>
      (t.assetId ? getAssetById(t.assetId)?.currency : undefined) ?? currency,
    [getAssetById, currency]
  );

  // 本月收入 / 支出按币种一次算完（同一 predicate：本月 + 类型 + 该笔所属币种）
  const monthTotals = useMemo(() => {
    const m = new Map<string, { income: number; expense: number }>();
    ledgerTransactions.forEach((t) => {
      if (t.type !== 'income' && t.type !== 'expense') return;
      if (!t.date.startsWith(thisMonthKey)) return;
      const code = txCurrencyOf(t);
      const row = m.get(code) ?? { income: 0, expense: 0 };
      if (t.type === 'income') row.income += t.amount;
      else row.expense += t.amount;
      m.set(code, row);
    });
    return m;
  }, [ledgerTransactions, thisMonthKey, txCurrencyOf]);

  const monthExpense = monthTotals.get(activeCurrency)?.expense ?? 0;
  const monthIncome = monthTotals.get(activeCurrency)?.income ?? 0;
  const monthBalance = monthIncome - monthExpense;

  // 某币种的整体预算（每个币种各存一条；老数据没有 currency 字段的条目跟随全局货币）
  const totalBudget =
    budgets.find((b) => b.categoryId === 'total' && (b.currency ?? currency) === activeCurrency)?.amount ?? 0;
  const budgetPct = formatBudgetPct(monthExpense, totalBudget, tr);
  const monthLabel = tr(`date.months.${now.getMonth()}`);

  const userName = user?.displayName?.trim() || user?.email?.split('@')[0] || tr('overview.guestName');

  // 卡片内可用宽（传给 MoneyText，断开「内容宽 ↔ 档位」反馈环：窄屏自动降档、绝不溢出）。
  // 按真实布局算：页边距 + 卡片内衬（净资产卡 = layout.card，三栏/预算卡 = spacing.md），
  // 三栏还要扣掉两条分隔线（1pt + 左右各 spacing.sm 外边距）。
  const cardWidth = Math.max(0, Math.min(windowWidth, contentMaxWidth ?? windowWidth) - pagePadding * 2);
  const sparkWidth = SPARK_BAR_HEIGHTS.length * SPARK_BAR_WIDTH + (SPARK_BAR_HEIGHTS.length - 1) * SPARK_BAR_GAP;
  const netWorthAmountWidth = Math.max(0, cardWidth - layout.card * 2 - sparkWidth - spacing.md);
  const dividerWidth = 1 + spacing.sm * 2;
  const metricColumnWidth = Math.max(
    0,
    Math.floor((cardWidth - spacing.md * 2 - dividerWidth * 2) / 3)
  );

  const quickActions = useMemo(
    () =>
      [
        {
          key: 'expense' as QuickKey,
          label: tr('addTx.expense'),
          icon: 'arrow-up-outline' as const,
          tileBg: semantic.brandSoft,
          tint: semantic.accent,
          onPress: () => navigation.navigate(ROUTES.ADD_TX, { presetType: 'expense' }),
        },
        {
          key: 'income' as QuickKey,
          label: tr('addTx.income'),
          icon: 'arrow-down-outline' as const,
          tileBg: semantic.tileMint,
          tint: semantic.textPrimary,
          onPress: () => navigation.navigate(ROUTES.ADD_TX, { presetType: 'income' }),
        },
        {
          key: 'transfer' as QuickKey,
          label: tr('addTx.transfer'),
          icon: 'swap-horizontal-outline' as const,
          tileBg: semantic.surfaceSunken,
          tint: semantic.accent,
          onPress: () => navigation.navigate(ROUTES.ADD_TX, { presetType: 'transfer' }),
        },
        {
          key: 'scan' as QuickKey,
          label: tr('addTx.scanReceipt'),
          icon: 'scan-outline' as const,
          tileBg: semantic.surfaceSunken,
          tint: semantic.accent,
          onPress: () => navigation.navigate(ROUTES.ADD_TX, { autoScan: true }),
        },
      ],
    [navigation, semantic, tr]
  );

  const isEmpty = ledgerAssets.length === 0 && ledgerTransactions.length === 0;
  const balanceIcon = monthBalance >= 0 ? 'trending-up' : 'trending-down';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      {/* 二级页统一页头：返回 + 居中标题（稿里没有返回键，但本页是从设置项 push 进来的二级页，
          返回必须可达；页面自身的信息结构仍按稿从「概览头部」开始） */}
      <ScreenHeader
        variant="compact"
        title={tr('overview.title')}
        onBack={() => navigation.goBack()}
        testID="overview-header"
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: pagePadding, paddingBottom: tabClearance + spacing.xl },
        ]}
      >
        {/* 概览头部：头像 + 用户名 + 概览更多 */}
        <View style={styles.profileRow}>
          <View style={styles.profileLeft}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={AVATAR_ICON_SIZE} color={semantic.accent} />
            </View>
            <AppText variant="title3" numberOfLines={1} style={styles.userName}>
              {userName}
            </AppText>
          </View>
          <IconButton
            icon="ellipsis-horizontal"
            accessibilityLabel={tr('overview.more')}
            size={20}
            color={semantic.textPrimary}
            onPress={() => setMoreOpen(true)}
            testID="overview-more"
          />
        </View>

        {isEmpty ? (
          <EmptyState
            icon="stats-chart-outline"
            title={tr('overview.emptyTitle')}
            description={tr('overview.emptyHint')}
            actionLabel={tr('overview.emptyAction')}
            onAction={() => navigation.navigate(ROUTES.ADD_TX, { presetType: 'expense' })}
            testID="overview-empty"
          />
        ) : (
          <>
            {/* 净资产卡（稿：[退化]净资产卡，accent 实底 / radius.lg / pad 16） */}
            <View style={styles.netWorthCard} testID="overview-networth-card">
              <View style={styles.cardHeadRow}>
                <AppText variant="footnote" weight="500" color={semantic.onAccent} numberOfLines={1} style={styles.flexText}>
                  {tr('overview.netWorthLabel', { cur: activeCurrency })}
                </AppText>
                <View style={styles.headActions}>
                  <IconButton
                    icon={hidden ? 'eye-off-outline' : 'eye-outline'}
                    accessibilityLabel={hidden ? tr('overview.showAmount') : tr('overview.hideAmount')}
                    size={20}
                    color={semantic.onAccent}
                    onPress={() => setHidden((v) => !v)}
                    testID="overview-eye"
                  />
                  <IconButton
                    icon="ellipsis-horizontal"
                    accessibilityLabel={tr('overview.more')}
                    size={20}
                    color={semantic.onAccent}
                    onPress={() => setMoreOpen(true)}
                    testID="overview-card-more"
                  />
                </View>
              </View>

              <View style={styles.amountRow}>
                <View style={styles.amountCol}>
                  <View testID="overview-networth" style={styles.amountWrap}>
                    <MoneyText
                      value={netWorth}
                      variant="display"
                      weight="700"
                      color={semantic.onAccent}
                      hidden={hidden}
                      availableWidth={netWorthAmountWidth}
                    />
                  </View>
                  <View style={styles.deltaRow}>
                    <Ionicons name={balanceIcon} size={14} color={semantic.onAccent} />
                    <View testID="overview-month-delta">
                      <MoneyText
                        value={Math.abs(monthBalance)}
                        kind={monthBalance >= 0 ? 'income' : 'expense'}
                        variant="footnote"
                        weight="500"
                        color={semantic.onAccent}
                        hidden={hidden}
                      />
                    </View>
                    <AppText variant="footnote" weight="500" color={semantic.onAccent} numberOfLines={1}>
                      {tr('overview.monthDelta')}
                    </AppText>
                  </View>
                </View>

                {/* 迷你柱状图（稿中为装饰性柱形几何，未绑定数据） */}
                <View style={styles.spark} accessible={false}>
                  {SPARK_BAR_HEIGHTS.map((h, i) => (
                    <View
                      key={i}
                      style={[
                        styles.sparkBar,
                        {
                          height: h,
                          backgroundColor: semantic.onAccent,
                          opacity: i % 2 === 0 ? SPARK_BAR_DIM : SPARK_BAR_STRONG,
                        },
                      ]}
                    />
                  ))}
                </View>
              </View>
            </View>

            {/* 收支结余三栏 */}
            <View style={[styles.panel, styles.metricPanel]} testID="overview-month-card">
              <View style={styles.metric} testID="overview-month-expense">
                <AppText variant="caption2" weight="500" color={semantic.textTertiary} align="center">
                  {tr('overview.monthExpense')}
                </AppText>
                <MoneyText
                  value={monthExpense}
                  kind="expense"
                  variant={windowWidth < 360 ? 'headline' : 'title2'}
                  color={semantic.textPrimary}
                  hidden={hidden}
                  availableWidth={metricColumnWidth}
                />
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metric} testID="overview-month-income">
                <AppText variant="caption2" weight="500" color={semantic.textTertiary} align="center">
                  {tr('overview.monthIncome')}
                </AppText>
                <MoneyText
                  value={monthIncome}
                  kind="income"
                  variant={windowWidth < 360 ? 'headline' : 'title2'}
                  color={semantic.textPrimary}
                  hidden={hidden}
                  availableWidth={metricColumnWidth}
                />
              </View>
              <View style={styles.metricDivider} />
              <View style={styles.metric} testID="overview-month-balance">
                <AppText variant="caption2" weight="500" color={semantic.textTertiary} align="center">
                  {tr('overview.monthBalance')}
                </AppText>
                <MoneyText
                  value={monthBalance}
                  kind={monthBalance >= 0 ? 'income' : 'expense'}
                  variant={windowWidth < 360 ? 'headline' : 'title2'}
                  color={semantic.accent}
                  hidden={hidden}
                  availableWidth={metricColumnWidth}
                />
              </View>
            </View>

            {/* 预算进度卡 */}
            <View style={styles.panel} testID="overview-budget-card">
              <View style={styles.budgetHead}>
                <AppText
                  variant="footnote"
                  weight="500"
                  color={semantic.textSecondary}
                  numberOfLines={1}
                  style={styles.flexText}
                >
                  {tr('overview.budgetLabel', { m: monthLabel })}
                </AppText>
                {totalBudget > 0 ? (
                  <AppText
                    variant="title2"
                    color={
                      budgetPct.tone === 'danger'
                        ? semantic.danger
                        : budgetPct.tone === 'warning'
                          ? semantic.warning
                          : budgetPct.tone === 'success'
                            ? semantic.success
                            : semantic.accent
                    }
                    numberOfLines={1}
                    testID="overview-budget-pct"
                  >
                    {budgetPct.text}
                  </AppText>
                ) : (
                  <AppText variant="footnote" color={semantic.textTertiary} numberOfLines={1} testID="overview-budget-empty">
                    {tr('home.budgetEmpty')}
                  </AppText>
                )}
              </View>
              <ProgressBar
                ratio={budgetPct.fillRatio}
                tone={budgetPct.over ? 'danger' : 'accent'}
                height={BUDGET_BAR_HEIGHT}
                testID="overview-budget-bar"
              />
            </View>

            {/* 快捷操作（支出 / 收入 / 转账 / 扫描） */}
            <View style={styles.quickRow}>
              {quickActions.map((action) => (
                <PressableScale
                  key={action.key}
                  onPress={action.onPress}
                  accessibilityRole="button"
                  accessibilityLabel={action.label}
                  style={styles.quickItem}
                  testID={`overview-quick-${action.key}`}
                >
                  <View style={[styles.quickTile, { backgroundColor: action.tileBg }]}>
                    <Ionicons name={action.icon} size={QUICK_ICON_SIZE} color={action.tint} />
                  </View>
                  <AppText variant="caption2" weight="500" color={semantic.textSecondary} numberOfLines={1} align="center">
                    {action.label}
                  </AppText>
                </PressableScale>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* 概览更多：隐藏金额 + 币种切换（多币种时） */}
      <BottomSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={tr('overview.more')}
        testID="overview-more-sheet"
      >
        <View style={{ paddingHorizontal: pagePadding, paddingBottom: spacing.xl }}>
          <ListRow
            icon={hidden ? 'eye-off-outline' : 'eye-outline'}
            title={hidden ? tr('overview.showAmount') : tr('overview.hideAmount')}
            onPress={() => {
              setHidden((v) => !v);
              setMoreOpen(false);
            }}
            testID="overview-sheet-eye"
          />
          {totalsByCurrency.length > 1 &&
            totalsByCurrency.map(([code, total]) => (
              <ListRow
                key={code}
                icon="cash-outline"
                title={code}
                value={
                  <MoneyText
                    value={total}
                    hidden={hidden}
                    color={code === activeCurrency ? semantic.accent : semantic.textSecondary}
                  />
                }
                trailing={
                  code === activeCurrency ? (
                    <Ionicons name="checkmark" size={20} color={semantic.accent} />
                  ) : undefined
                }
                onPress={() => {
                  setCurrencyOverride(code);
                  setMoreOpen(false);
                }}
                testID={`overview-currency-${code}`}
              />
            ))}
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(
  semantic: ReturnType<typeof useTheme>['semantic'],
  radius: ReturnType<typeof useTheme>['radius'],
  spacing: ReturnType<typeof useTheme>['spacing'],
  layout: ReturnType<typeof useTheme>['layout']
) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: semantic.bg },
    scroll: { flex: 1 },
    content: { gap: spacing.md, paddingTop: spacing.xs },

    // 概览头部
    profileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    profileLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1, minWidth: 0 },
    avatar: {
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: radius.full,
      backgroundColor: semantic.brandSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    userName: { flexShrink: 1 },

    // 净资产卡
    netWorthCard: {
      backgroundColor: semantic.accent,
      borderRadius: radius.lg,
      padding: layout.card,
      gap: spacing.sm,
    },
    cardHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    flexText: { flexShrink: 1 },
    headActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 0 },
    amountRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
    amountCol: { flexShrink: 1, minWidth: 0, gap: spacing.xs },
    amountWrap: { flexShrink: 1, minWidth: 0, alignItems: 'flex-start' },
    deltaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
    spark: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: SPARK_BAR_GAP,
      flexShrink: 0,
    },
    sparkBar: { width: SPARK_BAR_WIDTH },

    // 三栏 / 预算卡共用面板
    panel: {
      backgroundColor: semantic.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: semantic.hairline,
      padding: spacing.md,
      gap: spacing.sm,
    },
    metricPanel: { flexDirection: 'row', alignItems: 'center', gap: 0 },
    metric: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs },
    metricDivider: { width: 1, height: METRIC_DIVIDER_HEIGHT, backgroundColor: semantic.hairline, marginHorizontal: spacing.sm },

    // 预算卡
    budgetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },

    // 快捷操作
    quickRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    quickItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: spacing.xs },
    quickTile: { width: QUICK_TILE_SIZE, height: QUICK_TILE_SIZE, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  });
}
