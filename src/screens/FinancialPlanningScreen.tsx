// FinancialPlanningScreen.tsx —— 财务规划页（T23 / 计划 5.7 F1–F3）
//
// 本次只改展示与交互反馈（功能冻结）：
//   F1 计划行图标改用该计划类别的图标方块（无类别时用通用图标），不再全是 ↑/↓
//   F2 行副标题改「11月1日 · 还有 23 天」（日期 formatDate、天数由现有下次扣账日算出，纯展示）；
//      徽章（提醒 / 自动 / 已暂停）改 Badge（11pt 起）；暂停行整体变灰
//   F3 左滑删除（iOS 方向：往左滑，删除底在右侧）、删除底 danger 色、高度与行一致；
//      删除确认仍走原来的 AppDialog 流程
//   F4 空状态改 EmptyState +「添加规划」按钮；页头改二级页 ScreenHeader（返回 + 右侧动作）
//   F5 版式统一（本批）：删掉自绘页头 + 品牌紫渐变横带，改 <ScreenHeader variant="compact">
//      + semantic.bg 页底 + ui/Button 右侧动作；汇总卡 / 列表卡圆角一律走 radius 令牌
//
// ⚠ 计算逻辑一字未动：两张汇总卡（月度支出 / 月度收入）仍按原来的
//   plans.filter(type).reduce(amount) 求和 —— 暂停的计划也计入合计，这是已知的功能问题
//   （用户已确认只告知、本批不修）。订阅通知、入账引擎（utils/paymentPlans）也不碰。

import React, { useEffect, useMemo, useRef } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { ROUTES } from '../navigation/routes';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { useTabBarForceHide } from '../context/TabBarAutoHideContext';
import type { Layout, Radius, SemanticColors, Spacing } from '../theme/theme';
import { Category, PaymentPlan } from '../types';
import { nextDueDate } from '../utils/paymentPlans';
import { formatDate } from '../utils/formatDate';
import { hapticWarning } from '../utils/haptics';
import PressableScale from '../components/PressableScale';
import {
  AppText,
  Badge,
  type BadgeTone,
  Button,
  Card,
  EmptyState,
  HeroGradient,
  IconCircle,
  ListSection,
  MoneyText,
  ScreenHeader,
} from '../components/ui';

type IconName = keyof typeof Ionicons.glyphMap;

/** 行内圆形图标直径（UI V2 第 1 节：账户 / 类别 / 列表图标统一圆形，列表行 42） */
const ICON_BOX_SIZE = 42;
/** 圆内图标尺寸（图标只有 20 / 24 两档，行内取小档）—— 纯图形常量 */
const ICON_SIZE = 20;
/** 类别色淡底透明度（UI_RULES 第 1 节：类别色 12% 底 + 100% 图标） */
const CATEGORY_TINT_ALPHA = 0.12;
/** 左滑露出的删除底宽度（iOS 习惯：一个方块宽）—— 纯几何常量 */
const SWIPE_DELETE_WIDTH = 88;
/** 已暂停行图标的淡化透明度（文字不淡化，保证对比度；仍可点进编辑） */
const PAUSED_OPACITY = 0.55;
/** 一天的毫秒数（算「还有 N 天」用，纯展示） */
const DAY_MS = 24 * 60 * 60 * 1000;
/** 左滑松手后忽略行 press 的时间窗（见 lastSwipeAtRef 注释） */
const SWIPE_PRESS_GUARD_MS = 400;

export default function FinancialPlanningScreen({ navigation }: any) {
  const { paymentPlans, deletePaymentPlan, activeLedgerId, categories } = useApp();
  const { semantic, spacing, layout, radius } = useTheme();
  const { pagePadding, contentMaxWidth, rowMinHeight } = useLayout();
  const tr = useT();
  const { langMode } = useLanguage();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, radius, rowMinHeight),
    [semantic, spacing, layout, radius, rowMinHeight]
  );
  const isFocused = useIsFocused();
  const setTabBarForceHidden = useTabBarForceHide();
  // 左滑是「行跟手一起平移」：在 Web（react-native-web）上松手时指针仍落在行内，
  // RN Pressable 会补发一次 onPress → 误进编辑页（真机由 RNGH 的手势系统取消，不会发生）。
  // 这里记下每次滑开的时间戳，在行 press 里用时间窗挡掉这次补发，保证 Web 预览与真机行为一致。
  const lastSwipeAtRef = useRef(0);
  const markSwipeOpen = () => {
    lastSwipeAtRef.current = Date.now();
  };
  // 本页面（财务规划）**永远不显示底部导航栏**：与添加/编辑计划页同一语义——
  // 从设置项 push 进来的二级页不该有 Tab 栏。只要前台就一直强制隐藏，卸载时才交还。
  // 失焦时【不放栏】：从添加计划 goBack 回本页的转场里，本页的"聚焦隐藏"先执行、
  // 添加计划的失焦 cleanup 后执行——若这里在失焦分支放栏会互相覆盖（同上根源）
  useEffect(() => {
    if (isFocused) setTabBarForceHidden(true);
  }, [isFocused, setTabBarForceHidden]);
  useEffect(() => {
    return () => setTabBarForceHidden(false);
  }, []);

  const plans = paymentPlans.filter((p) => p.ledgerId === activeLedgerId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 结算规则一句话（周/年计划显示对应结算日；月计划在拿不到下次日期时兜底「每月 N 号结算」）
  function settleDayLabel(p: PaymentPlan): string {
    if (p.cycle === 'weekly') {
      const dow = p.dayOfWeek ?? 1;
      const weekShort = tr('finance.weekShort') as unknown as string[];
      const short = Array.isArray(weekShort) ? weekShort[dow === 0 ? 6 : dow - 1] : String(dow);
      return `${tr('finance.weeklyLabel')}·${short}`;
    }
    if (p.cycle === 'yearly') return `${tr('finance.yearlyLabel')}·${p.month ?? 1}/${p.day ?? 1}`;
    return tr('finance.settleDayLabel', { day: p.dayOfMonth ?? 1 });
  }

  // 行副标题（F2）：下次扣账日的「月日 · 还有 N 天」。
  // 已暂停 / 已结束的计划没有下次日期（nextDueDate 返回 null）→ 退回原来的结算规则文案。
  function planSubtitle(p: PaymentPlan): string {
    const next = nextDueDate(p, today);
    if (!next) return settleDayLabel(p);
    const dateText = formatDate(next, langMode, { style: 'monthDay', relative: false });
    const days = Math.round((next.getTime() - today.getTime()) / DAY_MS);
    const daysText = days <= 0 ? tr('finance.todayDue') : tr('finance.dueInDays', { n: days });
    return `${dateText} · ${daysText}`;
  }

  // 状态徽章（F2）：已暂停（灰 + 圆点）/ 自动（紫）/ 提醒（灰）。
  // 语义与原来一致：未暂停时按 autoDeduct 分「自动 / 提醒」两种
  function planBadge(p: PaymentPlan): { label: string; tone: BadgeTone; dot?: boolean } {
    if (!p.active) return { label: tr('finance.pausedBadge'), tone: 'neutral', dot: true };
    if (p.autoDeduct) return { label: tr('finance.autoBadge'), tone: 'accent' };
    return { label: tr('finance.remindBadge'), tone: 'neutral' };
  }

  const handleDelete = (p: PaymentPlan) => {
    dialog.alert({
      title: tr('finance.deletePlan'),
      message: tr('finance.deletePlanMsg'),
      buttons: [
        { text: tr('finance.cancel'), style: 'cancel' },
        { text: tr('finance.delete'), style: 'destructive', onPress: () => { hapticWarning(); void deletePaymentPlan(p.id); } },
      ],
    });
  };

  return (
    // 版式：与设置页同一代 —— 页底 semantic.bg + 品牌渐变铺满整页；
    // 页头统一 ScreenHeader（返回键 + 居中标题 + 右侧动作），安全区由 SafeAreaView 的 top 边负责
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      {/* 页头：ui/ScreenHeader（compact）+ ui/Button 右侧动作；入口与跳转一字未动 */}
      <ScreenHeader
        variant="compact"
        title={tr('finance.title')}
        onBack={() => navigation.goBack()}
        right={
          <Button
            title={tr('finance.addPlan')}
            variant="secondary"
            size="sm"
            fullWidth={false}
            onPress={() => navigation.navigate(ROUTES.FINANCE_PLAN_EDIT)}
            accessibilityLabel={tr('finance.addPlan')}
            testID="finance-add-button"
          />
        }
      />

      <ScrollView
        style={[
          { flex: 1 },
          contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : null,
        ]}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ paddingHorizontal: pagePadding }}>
          {/* TASK-020②（用户纠偏版）：左右对齐的固定支出/固定收入——加在「添加规划」按钮之后、
              列表之前，两卡并排各半，显示各自类型计划金额合计（纯展示，不做筛选、不加交互）。
              ⚠ 合计算法与原来完全一致（含暂停的计划），只换 Card + MoneyText 展示 */}
          <View style={styles.summaryRow}>
            {(['expense', 'income'] as const).map((tp) => {
              const tpTotal = plans
                .filter((p) => p.type === tp)
                .reduce((sum, p) => sum + p.amount, 0);
              return (
                <Card key={tp} style={styles.summaryCard}>
                  <AppText variant="footnote" color={semantic.textSecondary}>
                    {tp === 'expense' ? tr('finance.typeExpense') : tr('finance.typeIncome')}
                  </AppText>
                  {/* 支出 = 中性色 + 真减号、收入 = 绿 + 加号（MoneyText 语义色），不再手写 ± 前缀 */}
                  <MoneyText value={tpTotal} kind={tp} variant="title2" style={styles.summaryAmount} />
                </Card>
              );
            })}
          </View>

          {plans.length === 0 ? (
            // 空状态（计划 10.1 / F4）：统一 EmptyState（大图标 + 一句话 + 一个按钮）
            // 版式：空状态只用一张 Card（semantic.surface + radius.lg），不再包紫底
            <Card padded={false}>
              <EmptyState
                style={styles.emptyState}
                icon="calendar-outline"
                title={tr('finance.noPlans')}
                description={tr('finance.noPlansHint')}
                actionLabel={tr('finance.addPlan')}
                onAction={() => navigation.navigate(ROUTES.FINANCE_PLAN_EDIT)}
                testID="finance-empty"
              />
            </Card>
          ) : (
            /* 计划列表：一张卡里的分组行（ListSection 插发丝分割线），
               cardStyle.overflow:hidden 把左滑时的行与删除底裁在卡内（圆角不外漏） */
            <ListSection cardStyle={styles.plansCard}>
              {plans.map((p) => (
                <Swipeable
                  key={p.id}
                  overshootRight={false}
                  // 滑开（松手那一刻）与滑开动画结束都记一次时间戳：挡住松手补发的行 press
                  onSwipeableWillOpen={markSwipeOpen}
                  onSwipeableOpen={markSwipeOpen}
                  /* 左滑（往左滑 = iOS 方向）露出右侧删除底：danger 色、高度随行（alignSelf stretch） */
                  renderRightActions={() => (
                    <TouchableOpacity
                      style={styles.swipeDelete}
                      activeOpacity={0.8}
                      onPress={() => handleDelete(p)}
                      accessibilityRole="button"
                      accessibilityLabel={`${tr('finance.delete')} ${p.name}`}
                      testID={`finance-swipe-delete-${p.id}`}
                    >
                      <Ionicons name="trash-outline" size={ICON_SIZE} color={semantic.onAccent} />
                      <AppText variant="caption" color={semantic.onAccent} weight="600">
                        {tr('finance.delete')}
                      </AppText>
                    </TouchableOpacity>
                  )}
                >
                  <PlanRow
                    plan={p}
                    subtitle={planSubtitle(p)}
                    badge={planBadge(p)}
                    category={categories.find((c) => c.id === p.categoryId)}
                    onPress={() => {
                      // 刚左滑松手：忽略这次补发的 press（见 lastSwipeAtRef 注释）
                      if (Date.now() - lastSwipeAtRef.current < SWIPE_PRESS_GUARD_MS) return;
                      navigation.navigate(ROUTES.FINANCE_PLAN_EDIT, { planId: p.id });
                    }}
                  />
                </Swipeable>
              ))}
            </ListSection>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * 计划行（计划 5.7 F1–F3；页面内自建 —— 验收口径第 1 条：ListRow 表达不了布局时允许页内用令牌自建）。
 *
 * 为什么不用 ListRow / TransactionRow：
 *   - 标题右侧要并排一枚状态徽章（提醒 / 自动 / 已暂停），两件组件的「标题 + 副标题」竖排结构放不下徽章；
 *   - TransactionRow 的副标题写死「类别 · 账户」，这里要显示「11月1日 · 还有 23 天」；
 *   - 暂停行要整体变灰（连徽章与金额），而 ListRow 的 disabled 还会同时禁掉点击（暂停行仍要能点进编辑）。
 * 其余全部沿用 TransactionRow 的规格：40 图标方块（类别色 12% 底 + 100% 图标）、
 * headline 标题最多 2 行、footnote 副标题、金额 MoneyText 贴右且 flexShrink:0、行高 ≥ useLayout().rowMinHeight。
 */
function PlanRow({
  plan,
  subtitle,
  badge,
  category,
  onPress,
}: {
  plan: PaymentPlan;
  subtitle: string;
  badge: { label: string; tone: BadgeTone; dot?: boolean };
  category?: Category;
  onPress: () => void;
}) {
  const { semantic, spacing, layout, radius } = useTheme();
  const { rowMinHeight } = useLayout();
  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, radius, rowMinHeight),
    [semantic, spacing, layout, radius, rowMinHeight]
  );

  // 类别色是数据自带的颜色（与类别管理页同一套），没类别时退回通用图标 + 主题紫（同 TransactionRow 兜底）
  const tint = category?.color ?? semantic.accent;
  const icon = (category?.icon as IconName) ?? ('pricetag-outline' as IconName);

  return (
    <PressableScale
      style={styles.planRow}
      activeScale={0.98}
      onPress={onPress}
      testID={`finance-plan-row-${plan.id}`}
    >
      {/* 左：类别圆形图标（UI V2：42 圆，底色由 IconCircle 按主题从类别色推导）。
          已暂停只把图标变淡；文字不降透明度（整行 opacity 会把 .76 白字压到 ≈3.7:1，不达 4.5:1） */}
      <View style={!plan.active ? styles.iconPaused : null}>
        <IconCircle size={ICON_BOX_SIZE} color={tint} icon={icon} />
      </View>

      {/* 中：标题 + 徽章一行，副标题一行；文字块 flex:1 吃掉剩余宽度，把金额顶到行尾 */}
      <View style={styles.textBlock}>
        <View style={styles.titleRow}>
          <AppText variant="headline" numberOfLines={2} color={semantic.textPrimary} style={styles.title}>
            {plan.name}
          </AppText>
          {plan.active ? (
            <Badge label={badge.label} tone={badge.tone} dot={badge.dot} />
          ) : (
            // 已暂停徽章：Badge 的 neutral 字色是 textSecondary（夜间 ≈3.7:1），这里直接用 textPrimary（≥4.5:1）
            <View style={styles.pausedBadge}>
              <View style={styles.pausedDot} />
              <AppText variant="caption2" color={semantic.textPrimary}>
                {badge.label}
              </AppText>
            </View>
          )}
        </View>
        {/* 暂停行副标题用 textPrimary：「每月 N 号结算」在夜间 textSecondary 只有 ≈3.7:1 */}
        <AppText
          variant="footnote"
          color={plan.active ? semantic.textSecondary : semantic.textPrimary}
          numberOfLines={1}
        >
          {subtitle}
        </AppText>
      </View>

      {/* 右：金额（MoneyText 自带 flexShrink:0；支出的中性色 + 真减号 / 收入绿 + 加号） */}
      <MoneyText value={plan.amount} kind={plan.type} variant="body" />
    </PressableScale>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距；几何常量只留纯图形尺寸） */
function makeStyles(
  semantic: SemanticColors,
  spacing: Spacing,
  layout: Layout,
  radius: Radius,
  rowMinHeight: number
) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: semantic.bg },

    // 两张汇总卡并排各半（间距用 spacing.md，窄屏英文也不换行）
    // 卡面规格与资产页 / 首页一致：Card 自带 semantic.surface + radius.lg + elevation.level1
    summaryRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
    summaryCard: { flex: 1, minWidth: 0 },
    summaryAmount: { marginTop: spacing.xs },

    // 空状态：卡片内左右留白走令牌（320 窄屏下说明文字不贴边）
    emptyState: { paddingHorizontal: spacing.xl },

    // 计划列表卡：裁掉左滑时滑出的内容（圆角不外漏）
    plansCard: { overflow: 'hidden' },

    // 左滑删除底：danger 实底 + 白图标白字；alignSelf stretch = 高度与行完全一致
    swipeDelete: {
      width: SWIPE_DELETE_WIDTH,
      alignSelf: 'stretch',
      backgroundColor: semantic.danger,
      alignItems: 'center',
      justifyContent: 'center',
      rowGap: spacing.xs,
    },

    // 计划行：与 TransactionRow 同规格（minHeight + 内边距，不写死高度）
    planRow: {
      minHeight: rowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
      backgroundColor: semantic.surface,
    },
    // 已暂停：仅图标变淡（仍可点进编辑，所以不用 ListRow 的 disabled）
    iconPaused: { opacity: PAUSED_OPACITY },
    textBlock: { flex: 1, minWidth: 0 },
    // 标题与徽章并排：标题可换行可被挤窄，徽章不许被压
    titleRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
    title: { flexShrink: 1 },
    // 已暂停徽章（与 Badge 同规格，字色 textPrimary）
    pausedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.xs,
      alignSelf: 'flex-start',
      backgroundColor: semantic.hairline,
    },
    pausedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: semantic.textPrimary },
  });
}