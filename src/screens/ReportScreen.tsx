// ReportScreen.tsx —— 统计页（T21 / 计划 5.5 R1–R6）
//
// 本次只改展示与交互反馈（功能冻结：数据口径、计算、导航入口、左右滑换期手势全部照旧）：
//   R1 页头 ScreenHeader 大标题「统计」+ 日历按钮（入口不变，仍开原有 DateRangePickerSheet）；
//      周期控件改一行 ‹ 2026年10月 ›（左右箭头 + 保留滑动），周/月/年改 SegmentedControl
//   R2 饼图去掉引线百分比标签；扇区间留 2pt 缝；环心用 MoneyText 显示总额；
//      点扇区 / 点列表行 = 高亮该类（其余扇区变淡，环心换成类名 + 金额 + 占比 + selection 震动）
//   R3 排行列表每行：图标方块 + 名称 + 占比细条（2pt，进场增长）+ 金额（中性色）+ 百分比 1 位小数
//   R4 进场动画：扇区 600ms 顺序绘制（在 DonutChart 内）、细条按实测轨道宽增长；尊重「减弱动态效果」
//   R5 空状态 EmptyState（图标 + 一句话 + 记一笔按钮），不再渲染灰圈 + 0.00
//   R6 支出 / 收入切换改标准 SegmentedControl
//
// ⚠ 已知功能问题（本次明确不改，属功能逻辑不在 UI 范围内，见汇报）：
//   availableCurrencies / selectedReportCurrency 的币种回退 useEffect（下面的原注释保留）。

import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateRangePickerSheet from '../components/DateRangePickerSheet';
import SegmentedControl from '../components/SegmentedControl';
import PressableScale from '../components/PressableScale';
import DonutChart from '../components/DonutChart';
import { useApp } from '../context/AppContext';
import { ROUTES } from '../navigation/routes';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import type { Layout, Radius, SemanticColors, Spacing } from '../theme/theme';
import {
  AppText,
  Card,
  Chip,
  EmptyState,
  GlassView,
  HeroGradient,
  IconCircle,
  MoneyText,
  StatusBarGlass,
} from '../components/ui';
import { TransactionType, Transaction } from '../types';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import { formatDate } from '../utils/formatDate';
import { formatMoney } from '../utils/formatMoney';
import { hapticSelection } from '../utils/haptics';

type IconName = keyof typeof Ionicons.glyphMap;
type RangeType = 'year' | 'month' | 'week' | 'custom';

// 环的几何：DonutChart 的绘制与「点扇区命中判定」共用这三个数，改一处必须两处一起改
// 直径 240（原 200，2026-10-29 按「白卡内左右各空 90」的空旷感放大）；环带 24（仍约 10% 直径，
// 保持细环性格）；圆孔 = 240 − 2×24 = 192pt；
// 渲染角度微调 -15° 让扇区边界错开最挤的正上方。
const DONUT_SIZE = 240;
const DONUT_STROKE = 24;
const DONUT_ROTATION_DEG = -15;

/**
 * 环心金额的档位（UI V2 定稿：30 → 26 → 22）。
 *
 * 为什么在页面里定档、而不是交给 MoneyText 自己的 shrinkLadder：
 * MoneyText 的「放不下就降档」判定用的是**组件当帧自己的盒宽**；圆孔这里是「内容居中、
 * 盒子 = 内容宽」的容器，加上它内置的估算表比 Inter 实测宽约 10%，首档永远会被自己判成放不下
 * ——实测三档阶梯会一路停到第二档（T21 的 22/18 同样停在 18，用户看到的「约 18 号」就是这个）。
 * 圆孔是固定 192pt（环 240 − 2×24），与屏幕宽无关，所以按「字号 → 192pt 能放几个字符」直接定档：
 * 30 号每字约 14.5pt（Inter 数字 + 千分位 + 负字距）→ 12 字以内；26 号约 12.6pt → 14 字以内；再多给 22。
 */
const DONUT_CENTER_SIZES = [30, 26, 22] as const;

function donutCenterSize(text: string): number {
  if (text.length <= 12) return DONUT_CENTER_SIZES[0];
  if (text.length <= 14) return DONUT_CENTER_SIZES[1];
  return DONUT_CENTER_SIZES[2];
}

/** 占比细条高度（UI V2 定稿 4pt）—— 纯几何常量（与资产页额度使用率细条同一规格） */
const SHARE_BAR_HEIGHT = 4;
/** 排行行圆形图标直径（IconCircle 默认 42，与资产页账户行同规格） */
const CATEGORY_ICON_BOX = 42;

// 周期类型标签：在组件内用 t() 翻译（zh/en 字典 report.range*）
const RANGE_TYPE_KEYS: Record<RangeType, string> = {
  year: 'report.rangeYear',
  month: 'report.rangeMonth',
  week: 'report.rangeWeek',
  custom: 'report.rangeCustom',
};

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 周视图 / 自定义区间用：只要"月/日"，不带年份，避免跨月区间("2026-09-28 ~ 2026-10-04")
// 在滑动条中间这种窄空间里被截断成"2026-09-..."
function fmtShort(d: Date) {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// 自定义区间存的是 fmt() 出来的 "YYYY-MM-DD" 字符串，直接摘掉年份部分即可，不用重新解析成 Date
function shortFromIso(s: string) {
  return s.slice(5).replace('-', '/');
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function buildRange(type: Exclude<RangeType, 'custom'>, anchor: Date, tr: (k: string, p?: Record<string, string | number>) => string): { start: string; end: string; label: string } {
  if (type === 'week') {
    const mon = startOfWeek(anchor);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: fmt(mon), end: fmt(sun), label: `${fmtShort(mon)}~${fmtShort(sun)}` };
  }
  if (type === 'year') {
    return {
      start: `${anchor.getFullYear()}-01-01`,
      end: `${anchor.getFullYear()}-12-31`,
      label: `${anchor.getFullYear()}`,
    };
  }
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return {
    start: fmt(first),
    end: fmt(last),
    label: tr('report.monthLabel', { y: anchor.getFullYear(), m: anchor.getMonth() + 1 }),
  };
}

/**
 * 类别图标（UI V2 第 1 节「形状」：类别图标改圆形）。
 * 42 圆 + 底色 = 类别色 15%（夜）/ 近白淡底（日）—— 由 IconCircle 按主题推导；
 * 圆色取类别自带的数据色（与扇区同色，饼图去标签后列表就是图例），不是写死的设计色。
 */
function CategoryIcon({ color, icon }: { color: string; icon: IconName }) {
  return <IconCircle size={CATEGORY_ICON_BOX} color={color} icon={icon} />;
}

/**
 * 渐变上的玻璃圆钮（UI V2 稿：统计页周期行「‹ ›」/ 日历钮，36 圆 + 16 图标）。
 * 为什么不用共享 IconButton：IconButton 是「透明触控区 + 语义色图标」——落在渐变上就没有
 * 承托材质了；稿里这三颗都是玻璃圆钮（.gl + 36 圆），所以按 GlassView 的规格页内组合一次
 * （材质 / 圆角 / 尺寸取 GlassView 与令牌，图标色取 textPrimary（§3），不写死）。
 */
function GlassRoundButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled,
  testID,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const { semantic, radius } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      activeScale={0.94}
      hitSlop={0}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
    >
      <GlassView
        radius={radius.full}
        style={{
          width: 36,
          height: 36,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Ionicons name={icon} size={16} color={semantic.textPrimary} />
      </GlassView>
    </PressableScale>
  );
}

/**
 * 占比细条（R3 / 验收退回第 4 条）：4pt 高（UI V2 稿）、hairline 底 + **类别自己的颜色**填充
 * —— 饼图去掉引线标签后，下面这份列表就是图例，颜色必须和扇区一一对上。
 * 宽度 = onLayout 实测的轨道宽 × 占比（不写死像素）；进场按 motion.timing.numberRoll（600ms）
 * 「长」出来，与扇区绘制同一档时长；系统「减弱动态效果」时直接落终态。
 */
function ShareBar({ fraction, color, style }: { fraction: number; color: string; style?: StyleProp<ViewStyle> }) {
  const { semantic, radius, spacing, motion } = useTheme();
  const [trackW, setTrackW] = useState(0);

  const skipAnim = motion.reduceMotion || motion.timing.numberRoll === 0;
  const progress = useSharedValue(skipAnim ? 1 : 0);

  useEffect(() => {
    if (skipAnim) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: motion.timing.numberRoll, easing: motion.easing.out });
  }, [skipAnim, progress, motion]);

  const fillStyle = useAnimatedStyle(() => ({ width: trackW * fraction * progress.value }));

  return (
    <View
      style={[
        {
          marginTop: spacing.sm,
          height: SHARE_BAR_HEIGHT,
          borderRadius: radius.full,
          backgroundColor: semantic.hairline,
          overflow: 'hidden',
        },
        style,
      ]}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          { height: SHARE_BAR_HEIGHT, borderRadius: radius.full, backgroundColor: color },
          fillStyle,
        ]}
      />
    </View>
  );
}

/**
 * 排行行（验收退回第 4/5 条定版）。
 *
 * 为什么不用 ListRow：这一行需要「图标方块 + 名称 + 占比细条 + 金额 + 百分比」五件套，
 * 且选中时整行要 accentSoft 底 + 标题加粗（ListRow 的标题字重是固定的 headline 档，改不了），
 * 所以在页面内用令牌 + 同一套 40 图标方块规格实现（行高 ≥ useLayout().rowMinHeight，与 ListRow 同规格）。
 */
function RankRow({
  color,
  icon,
  title,
  amount,
  fraction,
  pctText,
  selected,
  onPress,
  testID,
}: {
  color: string;
  icon: IconName;
  title: string;
  amount: number;
  /** 占比（0–1） */
  fraction: number;
  pctText: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { semantic, spacing, layout } = useTheme();
  const { rowMinHeight } = useLayout();

  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.98}
      hitSlop={0}
      style={{
        minHeight: rowMinHeight,
        paddingHorizontal: layout.card,
        paddingVertical: spacing.md,
        justifyContent: 'center',
        // 选中：整行 accentSoft 底（与 Chip / 分段控件的选中态同一档紫）
        backgroundColor: selected ? semantic.accentSoft : 'transparent',
      }}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
      testID={testID}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <CategoryIcon color={color} icon={icon} />
        <View style={{ flexGrow: 1, flexShrink: 1, marginLeft: spacing.md }}>
          <AppText variant="headline" weight={selected ? '700' : undefined} numberOfLines={2}>
            {title}
          </AppText>
        </View>
        {/* 金额（中性色、不带正负号）+ 百分比统一 1 位小数，同一行右对齐（baseline 对齐 17/12 两种字号）；
            flexShrink:0，永不被标题挤走 */}
        <View style={{ flexShrink: 0, marginLeft: spacing.sm, flexDirection: 'row', alignItems: 'baseline' }}>
          <MoneyText value={amount} variant="body" />
          {/* 百分比 12pt（稿）→ caption 档；次要色（稿 #82829A）→ textSecondary */}
          <AppText variant="caption" color={semantic.textSecondary} align="right" style={{ marginLeft: spacing.xs }}>
            {pctText}
          </AppText>
        </View>
      </View>
      {/* 占比细条单独占一行（左对齐标题栏、右到卡内边距）：长度与右边金额宽度无关，
          所以所有行的轨道等长，横向可以直接比长短（验收小修） */}
      <ShareBar fraction={fraction} color={color} style={{ marginLeft: CATEGORY_ICON_BOX + spacing.md }} />
    </PressableScale>
  );
}

export default function ReportScreen() {
  const { transactions, categories, getAssetById, currency, activeLedgerId } = useApp();
  const { semantic, spacing, layout, radius, isDark, glass } = useTheme();
  const { pagePadding, contentMaxWidth } = useLayout();
  const insets = useSafeAreaInsets();
  const tr = useT();
  const { langMode } = useLanguage();
  const navigation = useNavigation<any>();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, radius),
    [semantic, spacing, layout, radius]
  );

  const [type, setType] = useState<TransactionType>('expense');

  const now = new Date();

  const [rangeType, setRangeType] = useState<RangeType>('month');
  const [anchor, setAnchor] = useState(now);
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null);
  const [rangeSheetOpen, setRangeSheetOpen] = useState(false);

  const range = useMemo(() => {
    if (rangeType === 'custom' && customRange) {
      return { start: customRange.start, end: customRange.end, label: `${shortFromIso(customRange.start)}~${shortFromIso(customRange.end)}` };
    }
    return buildRange(rangeType === 'custom' ? 'month' : rangeType, anchor, tr);
  }, [rangeType, anchor, customRange]);

  const shiftRange = (dir: 1 | -1) => {
    if (rangeType === 'custom') return;
    hapticSelection();
    if (rangeType === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1));
    } else if (rangeType === 'year') {
      setAnchor(new Date(anchor.getFullYear() + dir, 0, 1));
    } else {
      const next = new Date(anchor);
      next.setDate(next.getDate() + dir * 7);
      setAnchor(next);
    }
  };

  // 分段控件选周/月/年：直接切周期类型（与原来的下拉行为一致）。
  // 「自定义」这一档只在自定义区间时出现（用来把选中态摆正），点它不做切换。
  const handleRangeSelect = (value: string) => {
    if (value === 'custom') return;
    setRangeType(value as RangeType);
  };

  // 中间周期视图的跟手滑动：拖动时内容实时跟随（带阻尼），松手按距离/速度决定
  // 滑出换页（从另一侧滑入）还是弹回原位。Donut 区和下方滑动条共用同一组共享值。
  const DRAG_ROOM = 240;
  const dragX = useSharedValue(0);

  const makeDragGesture = () => Gesture.Pan()
    .activeOffsetX([-20, 20])
    .failOffsetY([-14, 14])
    .onUpdate((e) => {
      dragX.value = e.translationX;
    })
    .onEnd((e) => {
      'worklet';
      const dx = e.translationX;
      const commit = Math.abs(dx) > 60 || Math.abs(e.velocityX) > 500;
      if (!commit || rangeType === 'custom') {
        dragX.value = withTiming(0, { duration: 180 });
        return;
      }
      const dir = dx < 0 || e.velocityX < -400 ? 1 : -1;
      dragX.value = withTiming(dir * -DRAG_ROOM, { duration: 140 }, (fin) => {
        if (fin) {
          scheduleOnRN(shiftRange, dir);
          dragX.value = dir * DRAG_ROOM;
          dragX.value = withTiming(0, { duration: 200 });
        }
      });
    });

  const openDatePicker = () => {
    setRangeSheetOpen(true);
  };

  const ledgerTransactions = useMemo(
    () => transactions.filter((t) => t.ledgerId === activeLedgerId),
    [transactions, activeLedgerId]
  );

  const rangeTransactions = useMemo(
    () => ledgerTransactions.filter((t) => t.date >= range.start && t.date <= range.end),
    [ledgerTransactions, range]
  );

  // 这笔交易实际用的是哪个货币：优先看关联资产的货币，查不到就退回账本默认货币，不做汇率换算
  const getTransactionCurrency = (t: Transaction): string =>
    (t.assetId ? getAssetById(t.assetId)?.currency : undefined) ?? currency;

  // 按货币分开汇总收入/支出，避免不同货币的金额被直接相加
  const currencyBreakdown = useMemo(() => {
    const totals: Record<string, { income: number; expense: number }> = {};
    rangeTransactions.forEach((t) => {
      if (t.type !== 'income' && t.type !== 'expense') return;
      const code = getTransactionCurrency(t);
      if (!totals[code]) totals[code] = { income: 0, expense: 0 };
      if (t.type === 'income') totals[code].income += t.amount;
      else totals[code].expense += t.amount;
    });
    return totals;
  }, [rangeTransactions, currency]);

  // 币种 Chip 按 ABC 字母序排列（2026-09-24 用户定版，不再默认货币置顶/按活跃度排序）
  const availableCurrencies = useMemo(() => {
    const codes = Object.keys(currencyBreakdown);
    return codes.sort((c1, c2) => c1.localeCompare(c2));
  }, [currencyBreakdown]);

  const [selectedReportCurrency, setSelectedReportCurrency] = useState(currency);

  // ⚠ 币种回退逻辑：本次改造明确不动（属于功能逻辑，由用户决定是否修）
  useEffect(() => {
    if (!availableCurrencies.includes(selectedReportCurrency)) {
      setSelectedReportCurrency(currency);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCurrencies]);

  const categoryBreakdown = useMemo(() => {
    const totals: Record<string, number> = {};
    rangeTransactions
      .filter((t) => t.type === type && getTransactionCurrency(t) === selectedReportCurrency)
      .forEach((t) => {
        totals[t.categoryId] = (totals[t.categoryId] || 0) + t.amount;
      });
    return Object.entries(totals)
      .map(([categoryId, value]) => {
        const cat = categories.find((c) => c.id === categoryId);
        return {
          categoryId,
          value,
          name: cat ? getCategoryLabel(cat, tr) : UNCATEGORIZED_NAME,
          color: cat?.color ?? UNCATEGORIZED_COLOR,
          icon: (cat?.icon ?? UNCATEGORIZED_ICON) as IconName,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [rangeTransactions, categories, type, selectedReportCurrency, langMode]);

  // 真实总额（包含占比很小的分类），百分比数字始终按这个算，保证是真实占比
  const periodTotal = categoryBreakdown.reduce((s, c) => s + c.value, 0);

  // R5：这段时间没有可统计的分类（或总额为 0）→ 空状态，不再画灰圈 + 0.00
  const isEmpty = categoryBreakdown.length === 0 || periodTotal <= 0;

  // 相较上期的环比展示已下载（2026-10-29 用户指令）：原 prevRange / prevPeriodTotal /
  // momDelta / momPct / momGood 一并删除，不做「上一周期」的额外扫描。

  // R2 高亮：点扇区 / 点列表行选中的分类（null = 默认态，环心显示总支出/总收入）
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  // 环上高亮的下标（与 DonutChart 的 data 顺序一致 —— 环上渲染全部分类，不做「其他」合并）
  const selectedRingIndex = useMemo(() => {
    if (!selectedCategoryId) return null;
    const idx = categoryBreakdown.findIndex((c) => c.categoryId === selectedCategoryId);
    return idx >= 0 ? idx : null;
  }, [categoryBreakdown, selectedCategoryId]);
  const selectedCategory = selectedRingIndex === null ? null : categoryBreakdown[selectedRingIndex] ?? null;
  const selectedSharePct =
    selectedCategory && periodTotal > 0 ? (selectedCategory.value / periodTotal) * 100 : 0;

  // 分类展开：点某个分类，显示这段时间里这个分类下的每一笔明细（以 note 为主要展示信息）
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  const categoryItems = (categoryId: string): Transaction[] =>
    rangeTransactions
      .filter(
        (t) => t.type === type && t.categoryId === categoryId && getTransactionCurrency(t) === selectedReportCurrency
      )
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));

  // 列表行点击（R2 + 原展开功能联动）：点开 → 高亮 + 展开；再点 → 收起 + 取消高亮
  const toggleCategoryFromList = (categoryId: string) => {
    const expanding = expandedCategoryId !== categoryId;
    setExpandedCategoryId(expanding ? categoryId : null);
    setSelectedCategoryId(expanding ? categoryId : null);
    // 震动只在「选中」这一刻给（与 SegmentedControl 同规则：取消选中不震）
    if (expanding) hapticSelection();
  };

  // R2 扇区点击命中：把触点坐标换算成「沿环的占比」，与 DonutChart 的绘制几何严格对齐。
  // 角度公式（与 DonutChart 的 <G rotate(-90 + rotation)> 同一套约定，见 DonutChart 头注释）：
  //   θ = atan2(dy, dx) —— 屏幕角度（度，y 轴向下、顺时针为正）
  //   第 0 个扇区起点 θ0 = -90 + DONUT_ROTATION_DEG
  //   沿环位置 s = ((θ - θ0) mod 360) / 360 ∈ [0,1)，再按各分类真实占比的累积区间找落点
  // 圆孔内 = 取消选中（中心回到总额）；环外一律不处理（验收退回第 5 条）
  const handleDonutTap = (x: number, y: number) => {
    if (isEmpty) return;
    const r = DONUT_SIZE / 2;
    const dx = x - r;
    const dy = y - r;
    const dist = Math.hypot(dx, dy);
    if (dist < r - DONUT_STROKE) {
      // 点圆孔：有选中就取消（中心恢复总额）；本来没选中则什么都不做
      if (selectedCategoryId) setSelectedCategoryId(null);
      return;
    }
    if (dist > r) return;
    const theta = (Math.atan2(dy, dx) * 180) / Math.PI;
    const s = ((((theta - (-90 + DONUT_ROTATION_DEG)) % 360) + 360) % 360) / 360;
    let acc = 0;
    let hitId: string | null = null;
    for (const c of categoryBreakdown) {
      const frac = c.value / periodTotal;
      if (s < acc + frac) {
        hitId = c.categoryId;
        break;
      }
      acc += frac;
    }
    if (!hitId) return;
    const willSelect = selectedCategoryId !== hitId;
    setSelectedCategoryId(willSelect ? hitId : null);
    // 震动只在「选中」这一刻给（与列表行同规则）
    if (willSelect) hapticSelection();
  };

  // 点扇区与左右滑必须共存：Race 先激活者赢 —— 水平拖过 20pt 由 Pan 接管（换期），
  // 没怎么动的点按在抬手时交给 Tap 判命中（拖动超过 Tap 的位移上限后它自然失败，不挡手势）。
  // ⚠ success=false（被 Pan 抢走 / 位移过大 / 超时）一律不判命中，免得滑一下换期顺手选中某个分类
  const donutTapGesture = Gesture.Tap()
    // 慢一点的点按（看着环想一下再点）也算点按；上限 700ms，仍远短于拖动判定
    .maxDuration(700)
    .onEnd((e, success) => {
      'worklet';
      if (!success) return;
      // 命中判定跑在 JS 线程（要用 React state 与 haptic，见 handleDonutTap）
      scheduleOnRN(handleDonutTap, e.x, e.y);
    });
  const donutAreaGesture = Gesture.Race(donutTapGesture, makeDragGesture());
  const stripGesture = makeDragGesture();

  const donutDragStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value * 0.35 }],
    opacity: interpolate(Math.abs(dragX.value), [0, DRAG_ROOM], [1, 0.3]),
  }));

  // 周 / 月 / 年分段（R1）：自定义区间不在三档里 —— 补一个只显示选中态的「自定义」段，
  // 否则分段控件会把「月」错误地显示成选中（实际看的是自定义区间）
  const rangeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = (['year', 'month', 'week'] as const).map((v) => ({
      value: v,
      label: tr(RANGE_TYPE_KEYS[v]),
    }));
    if (rangeType === 'custom') opts.push({ value: 'custom', label: tr(RANGE_TYPE_KEYS.custom) });
    return opts;
  }, [rangeType, tr]);

  // 日历面板选完后的落地：优先匹配内置周期（保留滑动/箭头切换），否则记为自定义范围
  const applySheetRange = (s: string, e: string) => {
    const monday = new Date();
    const day = monday.getDay();
    monday.setDate(monday.getDate() + ((day === 0 ? -6 : 1) - day));
    const lastWeekMon = new Date(monday);
    lastWeekMon.setDate(monday.getDate() - 7);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYear = new Date(now.getFullYear() - 1, 0, 1);
    const trySet = (t: 'week' | 'month' | 'year', a: Date) => {
      const r = buildRange(t, a, tr);
      if (r.start === s && r.end === e) {
        setRangeType(t);
        setAnchor(a);
        return true;
      }
      return false;
    };
    if (trySet('month', now)) return;
    if (trySet('month', lastMonth)) return;
    if (trySet('year', now)) return;
    if (trySet('year', lastYear)) return;
    if (trySet('week', monday)) return;
    if (trySet('week', lastWeekMon)) return;
    setCustomRange({ start: s, end: e });
    setRangeType('custom');
  };

  // 饼图卡内容（夜间玻璃卡 / 日间白卡共用同一份内容，只是外层材质不同）
  const donutCardBody = (
    <>
      <GestureDetector gesture={donutAreaGesture}>
        <Animated.View style={[styles.donutArea, donutDragStyle]} testID="report-donut">
          <DonutChart
            data={categoryBreakdown.map((c) => ({ value: c.value, color: c.color }))}
            size={DONUT_SIZE}
            strokeWidth={DONUT_STROKE}
            rotation={DONUT_ROTATION_DEG}
            selectedIndex={selectedRingIndex}
            // 底环（稿）：夜间 = 半透明白档 / 日间 = hairline（白卡上就是那圈浅灰）
            trackColor={isDark ? glass.fill : semantic.hairline}
          />
          {/* 环心：默认 = 「总支出 · 币种」+ 总额（UI V2 稿）；
              选中 = 类名 + 该类金额 + 该类占比 */}
          <View style={styles.donutCenter} pointerEvents="none">
            {selectedCategory ? (
              <>
                {/* 小标签：稿 12.5 号次要色（caption 档 12 + 字号微调） */}
                <AppText
                  variant="caption"
                  color={semantic.textSecondary}
                  align="center"
                  numberOfLines={2}
                  style={styles.donutCenterLabel}
                >
                  {selectedCategory.name}
                </AppText>
                <View style={styles.donutCenterAmountWrap}>
                  <MoneyText
                    value={selectedCategory.value}
                    // 同总额档位：600 字重（display）+ 字号 30 → 26 → 22（按孔径定档，见 donutCenterSize）
                    variant="display"
                    // 汇总数字中性色、不带正负号（方向由上面的支出/收入分段说明）；
                    // 不用 12.3k 紧凑格式（看不出具体钱数）；读屏仍读完整金额
                    shrinkLadder={[donutCenterSize(formatMoney(selectedCategory.value))]}
                    compactFallback={false}
                    // 金额语义色（tokens: amount.expense / amount.income）：支出红、收入绿
                    color={type === 'expense' ? semantic.amountExpense : semantic.amountIncome}
                    style={styles.donutCenterValue}
                  />
                </View>
                <AppText variant="caption2" color={semantic.textSecondary} align="center">
                  {selectedSharePct.toFixed(1)}%
                </AppText>
              </>
            ) : (
              <>
                {/* 币种与标题同一行（稿里就是「总支出 · MYR」），不再单独占第三行 */}
                <AppText
                  variant="caption"
                  color={semantic.textSecondary}
                  align="center"
                  numberOfLines={2}
                  style={styles.donutCenterLabel}
                >
                  {`${
                    type === 'expense' ? tr('report.totalExpense') : tr('report.totalIncome')
                  } · ${selectedReportCurrency}`}
                </AppText>
                <View style={styles.donutCenterAmountWrap}>
                  <MoneyText
                    value={periodTotal}
                    // 字重取 display 档（600，稿要的档），字号按孔径定档（30 → 26 → 22，见 donutCenterSize）
                    variant="display"
                    shrinkLadder={[donutCenterSize(formatMoney(periodTotal))]}
                    compactFallback={false}
                    color={type === 'expense' ? semantic.amountExpense : semantic.amountIncome}
                    style={styles.donutCenterValue}
                  />
                </View>
              </>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
      <GestureDetector gesture={stripGesture}>
        <View style={styles.swipeStrip} />
      </GestureDetector>
    </>
  );

  return (
    // 全出血（同首页 / 资产页）：渐变通到屏幕顶，内容自己用 insets.top 让开状态栏
    <SafeAreaView style={styles.container} edges={[]}>
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      {/* C1：顶部安全区挡板 —— 滚动时内容不从状态栏文字下穿过 */}
      <StatusBarGlass />
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        style={
          contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : undefined
        }
        contentContainerStyle={{ paddingBottom: tabClearance }}
      >
        {/* R1 页头（UI V2 稿）：大标题 30/600（text.primary，§3：渐变上不再用白字）
            + 右侧周期行「‹ 2026年10月 ›」玻璃圆钮；日历入口保持在周期钮右侧 —— 入口 / 行为不变 */}
        <View style={[styles.headerRow, { paddingHorizontal: pagePadding, paddingTop: insets.top + 14 }]}>
          <AppText
            variant="title1"
            weight="600"
            color={semantic.textPrimary}
            style={styles.heroTitle}
            testID="report-header"
          >
            {tr('report.title')}
          </AppText>
          <View style={styles.periodNav}>
            <GlassRoundButton
              icon="chevron-back"
              accessibilityLabel={tr('report.prevPeriod')}
              onPress={() => shiftRange(-1)}
              disabled={rangeType === 'custom'}
              testID="report-prev"
            />
            <AppText variant="subhead" weight="500" color={semantic.textPrimary} style={styles.periodLabel}>
              {range.label}
            </AppText>
            <GlassRoundButton
              icon="chevron-forward"
              accessibilityLabel={tr('report.nextPeriod')}
              onPress={() => shiftRange(1)}
              disabled={rangeType === 'custom'}
              testID="report-next"
            />
            <GlassRoundButton
              icon="calendar-outline"
              accessibilityLabel={tr('addTx.dateSheetTitle')}
              onPress={openDatePicker}
              testID="report-calendar"
            />
          </View>
        </View>

        {/* 设计稿 04 屏顺序：先「支出 / 收入」，再周期（周/月/年）—— 两个分段控件同一行，
            V2 玻璃槽（落在渐变上）；窄屏一行放不下时右侧整块掉到第二行（UI_RULES 第 6 节 ②） */}
        <View style={[styles.segRow, { paddingHorizontal: pagePadding }]}>
          <View style={styles.segTray}>
            <SegmentedControl
              stretch
              appearance="glass"
              options={[
                { value: 'expense', label: tr('report.expense') },
                { value: 'income', label: tr('report.income') },
              ]}
              selected={type}
              onSelect={(v) => setType(v as TransactionType)}
            />
          </View>
          <View style={styles.segTray}>
            <SegmentedControl
              stretch
              appearance="glass"
              options={rangeOptions}
              selected={rangeType}
              onSelect={handleRangeSelect}
            />
          </View>
        </View>

        {/* 多币种切换：这段时间里出现不止一种货币时才显示（排序与行为照旧，只换成标准 Chip） */}
        {availableCurrencies.length > 1 && (
          <View style={[styles.chipRow, { paddingHorizontal: pagePadding }]}>
            {availableCurrencies.map((code) => (
              <Chip
                key={code}
                label={code}
                selected={selectedReportCurrency === code}
                onPress={() => setSelectedReportCurrency(code)}
                accessibilityLabel={code}
              />
            ))}
          </View>
        )}

        {/* 总支出 / 总收入 + 环比（设计稿 04 屏）：左大数字，右环比徽章 + 差额金额；
            上一周期没有数据（或自定义区间）时不显示徽章，只留总额 */}
        {!isEmpty && (
          <View style={[styles.summaryRow, { paddingHorizontal: pagePadding }]} testID="report-summary">
            <View style={styles.summaryLeft}>
              <AppText variant="caption" color={semantic.textTertiary}>
                {tr(type === 'expense' ? 'report.totalExpense' : 'report.totalIncome')}
              </AppText>
              <MoneyText
                value={periodTotal}
                kind="plain"
                currency={selectedReportCurrency}
                showCurrency
                variant="title2"
                color={semantic.textPrimary}
              />
            </View>
          </View>
        )}

        {isEmpty ? (
          /* R5 空状态：图标 + 一句话 + 「记一笔」按钮（不再渲染灰圈 + 0.00 的饼图，也不渲染排行） */
          <View style={{ paddingHorizontal: pagePadding, marginTop: spacing.xl }}>
            <Card>
              <EmptyState
                icon="pie-chart-outline"
                title={tr(type === 'expense' ? 'report.emptyExpenseTitle' : 'report.emptyIncomeTitle')}
                description={tr('report.emptyHint')}
                actionLabel={tr('report.recordOne')}
                onAction={() => navigation.navigate(ROUTES.TAB_ADD_TX)}
                testID="report-empty"
              />
            </Card>
          </View>
        ) : (
          <>
            {/* R2 饼图卡（UI V2 稿）：夜间 = 玻璃卡（radius 28 / 内衬 18）；日间 = 白卡 + 轻投影。
                环区上挂 Race(点按命中, 左右滑)，卡底保留 strip 的滑动换期 */}
            {isDark ? (
              <GlassView
                radius={26}
                style={[styles.donutCard, { marginHorizontal: pagePadding }]}
              >
                {donutCardBody}
              </GlassView>
            ) : (
              <Card
                padded={false}
                style={[styles.donutCard, styles.donutCardLight, { marginHorizontal: pagePadding }]}
              >
                {donutCardBody}
              </Card>
            )}

            {/* R3 排行列表：图标方块 + 名称 + 占比细条（类别色，图例）+ 金额（中性色）+ 百分比 1 位小数；
                选中行整行 accentSoft 底 + 标题加粗（验收退回第 4/5 条） */}
            <View style={[styles.rankList, { marginHorizontal: pagePadding }]}>
              {/* 排行卡圆角按稿 26（Card 默认 radius.lg 20） */}
              <Card padded={false} style={{ borderRadius: 26 }}>
                {categoryBreakdown.map((c, index) => {
                  const pct = periodTotal > 0 ? (c.value / periodTotal) * 100 : 0;
                  const expanded = expandedCategoryId === c.categoryId;
                  const items = expanded ? categoryItems(c.categoryId) : [];
                  return (
                    <View key={c.categoryId}>
                      <RankRow
                        color={c.color}
                        icon={c.icon}
                        title={c.name}
                        amount={c.value}
                        fraction={pct / 100}
                        pctText={`${pct.toFixed(1)}%`}
                        selected={selectedCategoryId === c.categoryId}
                        onPress={() => toggleCategoryFromList(c.categoryId)}
                        testID={`report-row-${c.categoryId}`}
                      />
                      {/* 组内分割线由页面插（选中行的 accentSoft 底要压住整行，所以不用 ListSection 的插线） */}
                      {index < categoryBreakdown.length - 1 && !expanded && (
                        <View style={[styles.rowSeparator, { marginHorizontal: layout.card }]} />
                      )}

                    {/* 展开明细：note 优先，其次 displayName，都没有才是占位文案（行为照旧） */}
                    {expanded && (
                      <View style={styles.detailBlock}>
                        {items.length === 0 ? (
                          <AppText variant="footnote" color={semantic.textTertiary} style={styles.detailEmpty}>
                            {tr('report.noItems')}
                          </AppText>
                        ) : (
                          items.map((t, idx) => {
                            const asset = t.assetId ? getAssetById(t.assetId) : undefined;
                            const hasNote = !!t.note?.trim();
                            const hasDisplayName = !hasNote && !!t.displayName?.trim();
                            const primaryText = hasNote
                              ? t.note!.trim()
                              : hasDisplayName
                              ? t.displayName!.trim()
                              : tr('report.noNote');
                            const isPlaceholder = !hasNote && !hasDisplayName;
                            return (
                              <View
                                key={t.id}
                                style={[styles.detailRow, idx < items.length - 1 && styles.detailRowDivider]}
                              >
                                <View style={styles.detailTextBlock}>
                                  <AppText
                                    variant="body"
                                    numberOfLines={2}
                                    color={isPlaceholder ? semantic.textTertiary : undefined}
                                    style={[styles.detailNote, isPlaceholder && styles.detailNotePlaceholder]}
                                  >
                                    {primaryText}
                                  </AppText>
                                  {/* 次要信息：日期 + 资产 */}
                                  <AppText variant="footnote" color={semantic.textSecondary} numberOfLines={1}>
                                    {formatDate(t.date, langMode)}
                                    {asset ? `  ·  ${asset.name}` : ''}
                                  </AppText>
                                </View>
                                <MoneyText
                                  value={t.amount}
                                  kind={type}
                                  variant="subhead"
                                  style={styles.detailAmount}
                                />
                              </View>
                            );
                          })
                        )}
                      </View>
                    )}
                  </View>
                );
                })}
              </Card>
            </View>
          </>
        )}
      </ScrollView>

      <DateRangePickerSheet
        visible={rangeSheetOpen}
        start={range.start}
        end={range.end}
        onClose={() => setRangeSheetOpen(false)}
        onApply={applySheetRange}
      />
    </SafeAreaView>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距；几何常量只留纯图形尺寸，见文件头） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout, radius: Radius) {
  return StyleSheet.create({
    container: { flex: 1 },
    // 两个分段控件同一行：周期在左、类型在右。行间距取 spacing.sm —— 实测英文最宽组合
    // （Year/Month/Week 173 + Expense/Income 145 + 8 = 326）在 360 宽的内容区（328）里正好放得下；
    // 系统大字 / 更窄的屏幕放不下时，右侧那块整行掉到第二行（UI_RULES 第 6 节 ②）
    // 总支出汇总行（稿 04 屏）：左标签 + 22/600 总额，右环比徽章（薄荷绿底圆角 10）+ 差额
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      columnGap: spacing.md,
      marginTop: spacing.lg,
    },
    summaryLeft: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    segRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
      rowGap: spacing.sm,
      marginTop: spacing.sm,
    },
    // 分段控件的槽底托盘（UI V2.1 §4）：玻璃槽里的未选中标签是 13pt 小字（要 4.5:1），
    // 单层玻璃压在渐变最亮的一段上只有 3.8-4.1:1。托盘必须是**实底**（surfaceSunken，全 App
    // 「凹底」档）—— 半透明 scrim 会被玻璃槽自己的 backdrop 模糊从上下的亮渐变里回拉，压不下去。
    // 与槽同圆角、零内衬（视觉上就是「槽更深一档」，不再多一层描边）
    // 两块等分整行：托盘 flex:1 撑满 + 分段控件 stretch（窄屏放不下时年/月/周 整块换行）
    segTray: { flex: 1, minWidth: 0, borderRadius: radius.full, backgroundColor: semantic.surfaceSunken },
    periodNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
    // 日期标签允许换行变高（不截断、不用省略号）；宽度由内容决定，挤不到就整行换下去
    periodLabel: { flexShrink: 1, textAlign: 'center', marginHorizontal: spacing.xs },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: spacing.sm,
      rowGap: spacing.xs,
      marginTop: spacing.sm,
    },
    // 页头（UI V2 稿）：大标题 + 右侧周期行「‹ 日期 ›」玻璃圆钮组
    headerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.md,
      rowGap: spacing.xs,
      marginBottom: spacing.md,
    },
    // 大标题（渐变上的白字）：稿为 30 / 600（token title1 是 28/700，字号按稿覆盖）
    heroTitle: { fontSize: 30, lineHeight: 36 },
    // 饼图卡：内衬 20（夜间是 GlassView、日间是白卡，两者都在这里给同样的内衬）
    donutCard: { marginTop: spacing.md, padding: 20 },
    // 日间白卡：与列表卡统一 26（阴影 / 白底由 Card 自己给）
    donutCardLight: { borderRadius: 26 },
    // 环区必须与 DonutChart 同尺寸（240×240）：绘制坐标与点击命中的坐标系都从这里起算。
    // 用 minHeight（不用固定 height）：高度实际由环本身撑出，文字容器不写死高度（UI_RULES 第 4 节）
    donutArea: {
      width: DONUT_SIZE,
      minHeight: DONUT_SIZE,
      alignSelf: 'center',
    },
    // 环心内容严格限制在圆孔内：孔径 = DONUT_SIZE − 2×DONUT_STROKE，
    // 于是左右内边距取环宽，MoneyText 实测到的可用宽就是孔径（超长金额才会按档位降级）
    donutCenter: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: DONUT_STROKE,
    },
    // 环心小标签（稿）：12.5 号次要色（字号按稿微调，行高沿用 caption 档）
    donutCenterLabel: { fontSize: 12.5, lineHeight: 16 },
    // 环心金额（稿）：30 / 600 —— 字重与字距由 display 档给（600 / −0.8，见 JSX 注释），
    // 字号由 shrinkLadder 给（30 → 26 → 22），这里只补上边距
    donutCenterValue: { marginTop: spacing.xs },
    // 金额要一层「占满圆孔宽 + 内容居中」的壳：MoneyText 的档位判定用的是它自己当帧的盒宽，
    // 直接放进居中列里盒宽 = 内容宽 → 首档会被自己的宽度判成放不下（实测一直停在 26）；
    // 这层壳撑满圆孔宽（156），金额按内容宽居中，档位判定才拿到真正可用的宽度
    donutCenterAmountWrap: {
      alignSelf: 'stretch',
      flexDirection: 'row',
      justifyContent: 'center',
    },
    rankList: { marginTop: layout.section },
    // 排行列表行间发丝线（由页面插：选中行要压住整行底色）
    rowSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: semantic.hairline },
    swipeStrip: { height: 1 },
    // 展开明细：与卡片左右留白对齐；行与行之间发丝线，最后一行不画（下面是分组分割线）
    detailBlock: { paddingHorizontal: layout.card, paddingBottom: spacing.sm },
    detailEmpty: { paddingVertical: spacing.sm },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      columnGap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    detailRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: semantic.hairline },
    detailTextBlock: { flexGrow: 1, flexShrink: 1 },
    detailNote: { marginBottom: spacing.xs },
    // 没有备注时的占位样式：斜体 + 浅色，明确区分"真实备注"和"占位提示"
    detailNotePlaceholder: { fontStyle: 'italic' },
    detailAmount: { marginLeft: spacing.sm },
  });
}
