// MonthCalendarCard.tsx
// 首页「日历视图」的月历卡内容（版式统一到 UI V2.1 设计系统）：
// - 顶部：[支出|收入|总额] 分段 + 当月合计行（支出 danger / 收入 success / 总额中性，全部 MoneyText）
// - 月份导航：‹ 标题 ›（36 视觉圆钮 + chip 淡底，触控区 44）
// - 星期表头（周日排首）+ 42 格月格 + 点日期在下方展开当日明细 / 空态
//
// 三态日期（可辨识，不靠颜色深浅猜）：
//   有数据 = 日期下方金额药丸（当前指标无值时退化成 4dp 圆点，形状恒定有存在的证据）
//   今天   = sel.fill 实心圆 + 加粗（与"选中"是两种不同形状）
//   选中   = 日格外圈 1.5 描边环 + 整格 accentSoft 底（可与"今天"同时成立）
// ⚠ 三态里"选中"与"有无交易"解耦：本月内每一天都能选中，没有交易的那天在下方显示空态文案。
//   跨月的灰显日期（dateKey = null）仍不可点 —— 它们属于别的月份，点了没有意义。
//
// 配色统一走 useTheme().semantic 令牌层、字号统一走 AppText / MoneyText 档位（UI_RULES 第 1/2/7 节）。
// 本组件只负责渲染；月份状态与数据聚合都在 HomeScreen（dayGroups 单一数据源，
// 保证日历数字与账单列表逐日一致，天然继承币种过滤与转账排除）。
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import PressableScale from './PressableScale';
import SegmentedControl from './SegmentedControl';
import AppText from './ui/AppText';
import MoneyText from './ui/MoneyText';
import TransactionRow from './ui/TransactionRow';
import { Ionicons } from '@expo/vector-icons';
import { withAlpha } from './ui/color';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { useLanguage } from '../i18n/LanguageContext';
import type { MoneyKind } from '../utils/formatMoney';
import { formatDate } from '../utils/formatDate';
import type { Radius, SemanticColors, Spacing } from '../theme/theme';

/** 当日逐笔账单（点日期在下方展开的明细行）：字段与首页列表的 TransactionRow 一一对应
 *  —— 明细行要求和首页列表行一模一样（验收退回第 3 条）。
 *  ⚠ note 由调用方做和首页列表相同的回落：有备注/计划名时 = 该文本、无则 = 类别名，
 *    同时 categoryName 传空串，这样副标题只剩账户（不把类别写两遍）。 */
export interface CalendarDayItem {
  id: string;
  /** 标题（备注；无备注时为类别名） */
  note?: string;
  /** 类别名（副标题第一段；与 note 同为类别名时传空串） */
  categoryName: string;
  categoryIcon?: React.ComponentProps<typeof Ionicons>['name'];
  categoryColor?: string;
  accountName?: string;
  amount: number;
  type: 'expense' | 'income';
}

export interface CalendarDayTotals {
  expense: number;
  income: number;
  /** 当日逐笔账单（点日期在下方展示明细用）；与账单列表同源，顺序=列表顺序 */
  items?: CalendarDayItem[];
}

export type SegKey = 'expense' | 'income' | 'net';

interface Props {
  year: number;
  /** 1-12 */
  month: number;
  /** 当月有账的日期 → 当日收支（YYYY-MM-DD 键，与账单列表同源） */
  days: Map<string, CalendarDayTotals>;
  monthExpense: number;
  monthIncome: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** 点明细行 → 交给页面走「进入编辑」的现有入口（与首页列表行同一入口） */
  onPressItem?: (id: string) => void;
  /** 受控的指标分段（可选）：首页横滑换币种时，邻页预览要和真日历显示同一个指标 */
  segKey?: SegKey;
  onSegKeyChange?: (key: SegKey) => void;
  /** 换了它就清掉「点选的日期」（可选）：首页横滑换币种后复位展开的那一天 */
  selectionKey?: string;
}

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** chip 淡底（P_Calendar 稿 --chip）：夜 = textPrimary 12%，日 = accent 10%（令牌 + withAlpha 派生） */
function chipFillOf(semantic: SemanticColors, isDark: boolean) {
  return isDark ? withAlpha(semantic.textPrimary, 0.12) : withAlpha(semantic.accent, 0.1);
}

/** 月份翻页圆钮：36 视觉圆 + chip 淡底 + 16 图标；触控区 44（外层兜住）。
 *  为什么不用 ui/IconButton：稿里这两颗是「chip 淡底圆钮」，IconButton 只有 plain/soft/solid
 *  三档平涂，所以按稿的规格页内组合一次，颜色全取令牌。 */
function MonthNavButton({
  icon,
  accessibilityLabel,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { semantic, isDark } = useTheme();
  const chipFill = chipFillOf(semantic, isDark);
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.9}
      hitSlop={0}
      style={navStyles.touch}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={[navStyles.circle, { backgroundColor: chipFill }]}>
        <Ionicons name={icon} size={16} color={semantic.textPrimary} />
      </View>
    </PressableScale>
  );
}

/** 翻页圆钮的纯图形几何（36 视觉 / 44 触控，来自 P_Calendar 稿与 UI_RULES 第 4 节） */
const navStyles = StyleSheet.create({
  touch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});

export default function MonthCalendarCard({ year, month, days, monthExpense, monthIncome, onPrevMonth, onNextMonth, onPressItem, segKey: segKeyProp, onSegKeyChange, selectionKey }: Props) {
  const { semantic, spacing, radius, isDark, glassPill } = useTheme();
  // 翻月淡入：不用 Reanimated entering/exiting（Android Fabric 上挂载动画会 addViewAt 崩溃），
  // 改用 shared value 驱动 opacity；首帧不播，之后每次月份变化重新淡入 150ms
  const monthOpacity = useSharedValue(1);
  const monthFirstRun = React.useRef(true);
  useEffect(() => {
    if (monthFirstRun.current) {
      monthFirstRun.current = false;
      return;
    }
    monthOpacity.value = 0;
    monthOpacity.value = withTiming(1, { duration: 150 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month]);
  const monthFadeStyle = useAnimatedStyle(() => ({ opacity: monthOpacity.value }));
  const t = useT();
  const { langMode } = useLanguage();
  // 「今天 / 选中」的实心色档（P_Calendar 稿 --sel / --selt）：夜 = 白圆 + 深字，
  // 日 = 紫圆 + 白字 —— 直接复用分段控件选中块的令牌（useTheme 已按主题解析好），不另造色
  const sel = glassPill;
  // 金额小胶囊 / 月份翻页圆钮的淡底（稿 --chip）：夜 = textPrimary 12%，日 = accent 10%
  const chipFill = chipFillOf(semantic, isDark);
  const styles = useMemo(
    () => makeStyles(semantic, spacing, radius, chipFill, sel.fill),
    [semantic, spacing, radius, chipFill, sel.fill]
  );
  const [segKeyState, setSegKeyState] = useState<SegKey>('expense');
  const segKey = segKeyProp ?? segKeyState;
  const setSegKey = (k: SegKey) => {
    setSegKeyState(k);
    onSegKeyChange?.(k);
  };
  // 点选的日期（YYYY-MM-DD）：再点一次同日收起；翻月自动清空（月格 key 重挂不清 state，需显式清）
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDate(null);
  }, [year, month, selectionKey]);
  const selectedDay = selectedDate ? days.get(selectedDate) : undefined;
  const selectedItems = selectedDay?.items ?? [];
  const isEn = langMode === 'en';
  // 明细区标头：与首页列表的日期头同一写法（今天 / 昨天 / 10月8日 周四 · Today / Oct 8, Thu）
  const selectedDateLabel = useMemo(
    () => (selectedDate ? formatDate(selectedDate, langMode) : ''),
    [selectedDate, langMode]
  );

  // 标题：中文 2026年9月 / 英文 September 2026（英文月份名单独维护，
  // report.monthLabel 的英文格式 %{m}/%{y} 不适合日历标题）
  const title = isEn ? `${MONTH_EN[month - 1]} ${year}` : `${year}年${month}月`;

  // 同上：t 是稳定引用，依赖数组必须带 langMode，切语言才会重算星期表头
  const weekdayLabels = useMemo(() => t('home.weekdays').split(','), [t, langMode]);

  // 42 格月格：周日排首（getDay() 周日=0，与 weekdays 键顺序一致），
  // 前后补上月/下月的灰显日期（只显示数字、不可点、不带药丸）
  const cells = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const offset = first.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysPrev = new Date(year, month - 1, 0).getDate();
    const out: { day: number; muted: boolean; dateKey: string | null }[] = [];
    for (let i = 0; i < 42; i++) {
      if (i < offset) {
        out.push({ day: daysPrev - offset + 1 + i, muted: true, dateKey: null });
      } else if (i < offset + daysInMonth) {
        const day = i - offset + 1;
        out.push({
          day,
          muted: false,
          dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        });
      } else {
        out.push({ day: i - offset - daysInMonth + 1, muted: true, dateKey: null });
      }
    }
    return out;
  }, [year, month]);

  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  // ⚠ useT 返回的 t 是全局稳定引用（applyLangMode 改实例 locale，不换函数），
  // useMemo 依赖数组里只写 [t] 在切语言时不会重算 → 文案冻在旧语言。所有带文案的 memo 都必须加 langMode。
  const segOptions = useMemo(
    () => [
      { label: t('report.expense'), value: 'expense' as const },
      { label: t('report.income'), value: 'income' as const },
      { label: t('home.calNet'), value: 'net' as const },
    ],
    [t, langMode]
  );

  const netTotal = monthIncome - monthExpense;

  return (
    <View>
      {/* 支出/收入/总额 分段：药丸显示哪个指标。
          SegmentedControl 轨道是 alignSelf:'flex-start'（设置页三颗开关依赖，公共组件不能动）。
      ⚠ Yoga 里子元素显式 alignSelf 优先级高于父容器 alignItems——用 alignItems:center 抵消无效（真机已验证仍靠左）。
      正确做法：居中层做成行容器，主轴 justifyContent:center 控制轨道水平位置 */}
      <View style={styles.segWrap}>
        <View style={styles.segCenter}>
          <SegmentedControl options={segOptions as { label: string; value: string }[]} selected={segKey} onSelect={(v) => setSegKey(v as SegKey)} />
        </View>
      </View>

      {/* 当月合计行：支出 · 收入 · 总额（与上面分段控件同顺序；数值与计算逻辑不变 —— 验收退回第 5 条）
          金额走 MoneyText：支出 danger / 收入 success / 总额中性；完整金额放不下时按档位降级 */}
      <View style={styles.totalsRow}>
        <View style={styles.totalsCol}>
          <MoneyText value={monthExpense} variant="headline" color={semantic.danger} />
          <AppText
            variant="caption2"
            weight={segKey === 'expense' ? '700' : undefined}
            color={segKey === 'expense' ? semantic.textPrimary : semantic.textSecondary}
            style={styles.totalsLabel}
          >
            {t('report.expense')}
          </AppText>
        </View>
        <View style={styles.totalsCol}>
          <MoneyText value={monthIncome} variant="headline" color={semantic.success} />
          <AppText
            variant="caption2"
            weight={segKey === 'income' ? '700' : undefined}
            color={segKey === 'income' ? semantic.textPrimary : semantic.textSecondary}
            style={styles.totalsLabel}
          >
            {t('report.income')}
          </AppText>
        </View>
        <View style={styles.totalsCol}>
          <MoneyText value={netTotal} variant="headline" />
          <AppText
            variant="caption2"
            weight={segKey === 'net' ? '700' : undefined}
            color={segKey === 'net' ? semantic.textPrimary : semantic.textSecondary}
            style={styles.totalsLabel}
          >
            {t('home.calNet')}
          </AppText>
        </View>
      </View>

      {/* 月份导航：36 圆钮 + chip 淡底 + textPrimary 图标 16；触控区 44 */}
      <View style={styles.calHeader}>
        <MonthNavButton
          icon="chevron-back"
          accessibilityLabel={t('home.prevMonth')}
          onPress={onPrevMonth}
        />
        <AppText variant="headline" style={styles.calTitle} numberOfLines={1}>
          {title}
        </AppText>
        <MonthNavButton
          icon="chevron-forward"
          accessibilityLabel={t('home.nextMonth')}
          onPress={onNextMonth}
        />
      </View>

      {/* 星期表头（周日排首）：7 列统一 textSecondary，
          且 11pt 不许用 textTertiary（UI_RULES 第 1 节：textTertiary 只给 ≥13pt） */}
      <View style={styles.weekRow}>
        {weekdayLabels.map((w, i) => (
          <AppText key={i} variant="caption2" color={semantic.textSecondary} style={styles.weekLabel}>
            {w}
          </AppText>
        ))}
      </View>

      {/* 月格：翻月时 opacity 淡入 150ms（shared value，见组件顶部注释） */}
      <Reanimated.View style={[styles.grid, monthFadeStyle]}>
        {cells.map((cell, idx) => {
          const isToday = cell.dateKey === todayKey;
          const dayTotals = cell.dateKey ? days.get(cell.dateKey) : undefined;
          const hasData = !!dayTotals;
          // ⚠ 选中判定必须先排除空 dateKey：灰显格 dateKey=null，未选择时
          // selectedDate 也是 null，直接 === 会 null===null 恒成立，把所有
          // 跨月格误标成选中（真机截图 bug：跨月日期全被框住）
          const isSelected = !!cell.dateKey && cell.dateKey === selectedDate;
          // 药丸内容随分段切换；当日无该类收支则不显示。
          // 金额交给 MoneyText（全 App 唯一金额组件）：紧凑格式（1.5k/1.2M）在
          // 7 列窄格（360dp 屏每格约 51dp）里永不换行、不溢出
          let pill: { value: number; kind: MoneyKind } | null = null;
          if (dayTotals) {
            if (segKey === 'expense' && dayTotals.expense > 0) {
              pill = { value: dayTotals.expense, kind: 'expense' };
            } else if (segKey === 'income' && dayTotals.income > 0) {
              pill = { value: dayTotals.income, kind: 'income' };
            } else if (segKey === 'net') {
              const net = dayTotals.income - dayTotals.expense;
              if (net > 0) pill = { value: net, kind: 'income' };
              else if (net < 0) pill = { value: net, kind: 'expense' };
            }
          }
          // 药丸里显示的数值：46dp 的日格放不下完整小数，也放不下 6 个字符的 `−12.1k`：
          //   万元档 → 取整到千（12k）、千元档 → 紧凑一位小数（1.4k）、千元以下 → 取整（−171）。
          // 屏上只是"这一天大概多少钱"，精确金额点开当天的明细行看。
          const pillAbs = pill ? Math.abs(pill.value) : 0;
          const pillText = pill
            ? pillAbs >= 10000
              ? Math.round(pill.value / 1000) * 1000
              : pillAbs >= 1000
                ? pill.value
                : Math.round(pill.value)
            : 0;
          // 「有数据」的形状标记：当前指标下没有数值可显示时（如只看支出、这天只有收入），
          // 退化成一颗 4dp 圆点 —— 任何一天有账都留下形状证据，不靠底色深浅猜
          const dotColor = dayTotals
            ? dayTotals.income > 0 && dayTotals.expense === 0
              ? semantic.success
              : dayTotals.expense > 0 && dayTotals.income === 0
                ? semantic.danger
                : semantic.textSecondary
            : null;
          return (
            // 外层 View 托管 14.28% 列宽——⚠ 不能把百分比宽度直接挂 PressableScale：
            // 它的 style 在内层 Animated.View 上，外层 Pressable 无宽度约束时
            // 百分比失效，7 列会挤成 ~10 列（真机截图 bug）。 hitSlop 0：默认 12
            // 会让相邻日期格触摸区互相重叠
            <View key={idx} style={styles.cell}>
              <PressableScale
                style={styles.cellInner}
                // ⚠ 本月内每一天都可点（有账进明细、无账进空态）；跨月灰格 dateKey = null 仍不可点
                onPress={cell.dateKey ? () => setSelectedDate((d) => (d === cell.dateKey ? null : cell.dateKey)) : undefined}
                activeScale={cell.dateKey ? 0.9 : 1}
                disabled={!cell.dateKey}
                hitSlop={0}
                accessibilityRole={cell.dateKey ? 'button' : undefined}
                accessibilityLabel={cell.dateKey ?? undefined}
                // 读屏读出「已选中」与「今天」（UI_RULES 第 8 节：选中态必须可读）
                accessibilityState={isSelected ? { selected: true } : undefined}
              >
                {/* 选中底：常驻挂载、只换 backgroundColor（不新建 View、不换圆角 —— 真机铁律） */}
                <View
                  pointerEvents="none"
                  style={[styles.cellSelectFill, isSelected && { backgroundColor: semantic.accentSoft }]}
                />
                {/* 日期数字的圆标：26 圆、描边 1.5 常驻，三态只「换色」——
                    ⚠ 沿用真机铁律（Fabric Android）：几何从挂载起不变、边框常驻，绝不出现
                    「无填充 View 翻入 border/bg」（重建背景 drawable 丢圆角 → 方形）。
                      普通    = 描边透明 + 底透明（隐形）
                      今天    = sel.fill 实心圆（夜白字深字 / 日紫字白字）
                      选中    = sel.fill 描边圈 + textPrimary 字
                      今天+选中 = 实心圆 + 1.5 描边（外圈再套一圈同色描边圈做区分） */}
                <View style={[styles.dayOuter, isToday && isSelected && styles.dayOuterBoth]}>
                  <View
                    style={[
                      styles.dayCircle,
                      isToday && { backgroundColor: sel.fill, borderColor: sel.fill },
                      isSelected && !isToday && styles.dayCircleSelected,
                    ]}
                  >
                    <AppText
                      variant="footnote"
                      // 今天 / 选中加粗走 AppText 的 weight 分流（不能写 style.fontWeight：
                      // Inter 按字重分家族，合成加粗会双重加粗）
                      weight={isToday || isSelected ? '700' : undefined}
                      style={[
                        styles.dayText,
                        cell.muted && styles.dayTextMuted,
                        isToday && { color: sel.text },
                      ]}
                    >
                      {cell.day}
                    </AppText>
                  </View>
                </View>
                {pill ? (
                  // 药丸：chip 淡底胶囊 + 11pt 等宽数字，字色按收入 / 支出语义（与当月合计行同一套色）
                  // roll 关掉：一次切段 42 个药丸同时滚数字是白烧性能。
                  // ⚠ compactFallback={false} 必须关：日期格本身是 button，MoneyText 的
                  // 「放不下 → 包 Pressable 长按看全文」会在里面再套一个 button（读屏重复播报）；
                  // 药丸已有 maxWidth 100% + overflow hidden，11pt 紧凑文本不会溢出
                  <View style={styles.pill}>
                    {/* 46dp 的日格里完整小数必然被裁成「−17…」。千元以下取整（−171）、
                        千元以上走紧凑格式（−1.8k）—— 每格都完整显示；具体金额点开当天看明细。
                        ⚠ compact 路径不使用 decimals（formatMoney 的紧凑分支自带两位有效数字规则），
                        所以两档二选一，不能同时传 */}
                    <MoneyText
                      value={pillText}
                      kind={pill.kind}
                      variant="caption2"
                      compact={pillAbs >= 1000}
                      decimals={pillAbs >= 1000 ? undefined : 0}
                      compactFallback={false}
                      roll={false}
                    />
                  </View>
                ) : hasData && dotColor ? (
                  <View pointerEvents="none" style={[styles.dayDot, { backgroundColor: dotColor }]} />
                ) : null}
              </PressableScale>
            </View>
          );
        })}
      </Reanimated.View>

      {/* 当日明细：点日期展开/收起，再点同日收起。
          有账 → 首页同款行（ui/TransactionRow）；没账 → 轻量空态文案（不留空白一片） */}
      {!!selectedDate && (
        <View style={styles.dayDetailWrap}>
          <AppText variant="caption" color={semantic.accentText} weight="700" style={styles.dayDetailDate} numberOfLines={1}>
            {selectedDateLabel}
          </AppText>
          {selectedItems.length > 0 ? (
            selectedItems.map((it) => (
              // 明细行 = 首页列表同一个组件（图标 + 标题 + 类别 · 账户 + MoneyText），
              // 只把行内左右内衬去掉（卡片自身已有内衬，避免双重缩进）
              <TransactionRow
                key={it.id}
                note={it.note}
                categoryName={it.categoryName}
                categoryIcon={it.categoryIcon}
                categoryColor={it.categoryColor}
                accountName={it.accountName}
                amount={it.amount}
                kind={it.type}
                style={styles.dayDetailRow}
                onPress={onPressItem ? () => onPressItem(it.id) : undefined}
              />
            ))
          ) : (
            <View style={styles.dayEmpty} testID="cal-day-empty">
              <Ionicons name="receipt-outline" size={16} color={semantic.textSecondary} />
              <AppText variant="caption" color={semantic.textSecondary}>
                {t('home.calDayEmpty')}
              </AppText>
            </View>
          )}
        </View>
      )}

    </View>
  );
}

/** 令牌进、StyleSheet 出（UI_RULES 第 1/3/7 节：禁止写死色值 / 字号 / 圆角 / 间距） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, radius: Radius, chipFill: string, selFill: string) {
  return StyleSheet.create({
    calHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: spacing.xs,
    },
    // 标题只管居中与占位；字号 / 字重 / 颜色全走 AppText headline 档
    calTitle: { flex: 1, textAlign: 'center' },
    weekRow: { flexDirection: 'row', marginBottom: spacing.xs },
    // 7 列统一上色；caption2 = 11pt 最小档，11pt 不许 textTertiary
    weekLabel: { flex: 1, textAlign: 'center', paddingVertical: spacing.xs },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cell: {
      width: '14.28%',
      minHeight: 54,
      paddingTop: spacing.xs,
      // 1px 列间隙：相邻药丸之间的视觉缝（纯图形常量，非布局间距）
      paddingHorizontal: 1,
    },
    // 内层可按压区：铺满外层列宽
    cellInner: {
      width: '100%',
      minHeight: 50,
      alignItems: 'center',
    },
    // 选中底：始终挂载（只换底色），圆角来自令牌
    cellSelectFill: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      borderRadius: radius.md,
    },
    dayDetailWrap: {
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: semantic.hairline,
    },
    dayDetailDate: { marginBottom: spacing.xs },
    // 明细行：与 ui/TransactionRow 同规格，只去掉行内左右内衬（卡片已有内衬）
    dayDetailRow: { paddingHorizontal: 0 },
    // 当日无交易的轻量空态（不铺 96 圆大空态：日历卡里高度敏感）
    dayEmpty: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.sm,
      paddingVertical: spacing.md,
    },
    // 日期圆标：外托 32（今天+选中时给一圈同色描边，做区分）+ 内圆 26。
    // ⚠ 描边宽度 1.5 从挂载起常驻、几何不变，三态只换色（见 JSX 注释的真机铁律）
    dayOuter: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1.5,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayOuterBoth: { borderColor: selFill },
    dayCircle: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1.5,
      borderColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayCircleSelected: { borderColor: selFill },
    // 日期数字（footnote 档，加粗由 JSX 的 weight 给）：普通 textPrimary，灰显整档压暗
    dayText: { color: semantic.textPrimary },
    dayTextMuted: { opacity: 0.35 },
    // 金额药丸：内衬 1×5 / 全圆角 / chip 淡底；maxWidth 100% + overflow hidden：再长也只裁尾不溢出格
    pill: {
      marginTop: 3,
      maxWidth: '100%',
      overflow: 'hidden',
      // 内衬 2：320dp 视口下日格只剩 ~38dp，`−1.6k` 这种 5 字符已到边，
      // 再宽就会被裁成省略号（纯图形常量，不进间距体系）
      paddingHorizontal: 2,
      paddingVertical: 1,
      borderRadius: radius.full,
      backgroundColor: chipFill,
      alignItems: 'center',
    },
    // 「有数据」圆点（当前指标无数值时）：4dp 纯图形常量
    dayDot: { width: 4, height: 4, borderRadius: radius.full, marginTop: 6 },
    segWrap: { paddingVertical: spacing.sm },
    // 抵消 SegmentedControl 轨道 alignSelf:'flex-start' 的居中层：
    // ⚠ Yoga 里子元素显式 alignSelf 优先级高于父容器 alignItems，alignItems:center 抵消无效
    // （真机已验证仍靠左）。必须做成行容器，用主轴 justifyContent:center 让轨道水平居中
    segCenter: { flexDirection: 'row', justifyContent: 'center' },
    // 合计行在顶部：分隔线在下沿（与下方月历隔开）
    totalsRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      borderBottomWidth: 1,
      borderBottomColor: semantic.hairline,
      paddingTop: spacing.xs,
      paddingBottom: spacing.md,
    },
    totalsCol: { flex: 1, alignItems: 'center' },
    // 合计标签：caption2（11pt 最小档）+ textSecondary
    totalsLabel: { marginTop: spacing.xs },
  });
}
