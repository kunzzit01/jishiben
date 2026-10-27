// AssetScreen.tsx —— 资产页（T19 / 计划 5.4 S1–S5）
//
// 本次只改展示与交互（功能冻结：数据、计算、导航入口全部照旧）：
//   S1 页头大标题（V2.2：顶部净资产汇总卡已删，页面只留币种分组列表）
//   S2 币种分组：V2.2 定稿 —— 表头（币种胶囊 + 「净资产」+ 合计）在玻璃卡**外**、卡片上方，
//      卡内只有账户行（立体图标 + 名称 + 类型 + 余额，行间 hairline）
//   S3 信用卡行主数字显示欠款（−402.29），副行还款日、值下方"可用 X"，行下 2pt 额度使用率细条
//   S4 账户详情从居中弹窗改 BottomSheet；删除走 danger 色按钮；"设为默认"改 Switch 行
//   S5 空状态 EmptyState + 添加账户按钮；排序模式显示拖动把手
//
// 另外删掉首页式的「minHeight: 视口高 + 130」撑高写法（计划 G4）：内容短时不再滚出大片空白。
//
// 信用卡账单口径（computeCreditStatement）与本月流水（computeAssetFlowStats）的计算一字未动，
// 与 creditCard.ts 的 getAssetDisplayBalance 一样原样复用。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  PanResponder,
  PixelRatio,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { BlinkingCursor } from '../components/BlinkingCursor';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useT } from '../i18n/LanguageContext';
import { useDialog } from '../components/AppDialog';
import { useApp } from '../context/AppContext';
import { ROUTES } from '../navigation/routes';
import { getAssetDisplayBalance } from '../utils/creditCard';
import { formatMoney } from '../utils/formatMoney';
import { AssetType } from '../types';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import SegmentedControl from '../components/SegmentedControl';
import { AccountTransactionList } from '../components/AccountTransactionList';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { hapticWarning } from '../utils/haptics';
import PressableScale from '../components/PressableScale';
import { LinearGradient } from 'expo-linear-gradient';
import type { Layout, Radius, SemanticColors, Spacing, Typography } from '../theme/theme';

import {
  AppText,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  GlassView,
  HeroGradient,
  IconCircle,
  ListRow,
  MoneyText,
  StatusBarGlass,
  Switch,
} from '../components/ui';
import { withAlpha } from '../components/ui/color';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * 账户类型 → i18n 键（与 AddAssetScreen 的 TYPE_OPTIONS.label 同源，六档齐全：
 * 投资 / 其他是 AssetType 本来就有的档，老数据里的这类账户列表照常显示）。
 * 账户行副行用「类型 · 默认」——UI V2 定稿每行都有副行，类型与是否默认都是现有数据。
 */
const TYPE_LABEL_KEYS: Record<AssetType, string> = {
  cash: 'asset.typeCash',
  bank: 'asset.typeBank',
  credit: 'asset.typeCredit',
  ewallet: 'asset.typeEwallet',
  investment: 'asset.typeInvestment',
  other: 'asset.typeOther',
};

type IconName = keyof typeof Ionicons.glyphMap;

const TYPE_OPTIONS: { type: AssetType; label: string; icon: IconName; color: string }[] = [
  { type: 'cash', label: '现金', icon: 'cash-outline', color: '#66BB6A' },
  { type: 'bank', label: '银行卡', icon: 'card-outline', color: '#4C9AFF' },
  { type: 'credit', label: '信用卡', icon: 'wallet-outline', color: '#EF5350' },
];

// 用户手动拖拽排出来的账户顺序，按币种分组各自记一份序号，存本地，不动 Asset 数据结构
const ASSET_ORDER_KEY = '@jizhang/assetOrder';

/** V2.2c 层级：账户名 16/500（令牌 body 17/400 → 覆盖字号 + 提字重）；类型行 13 secondary（footnote） */
const TITLE_FONT_SIZE = 16;

/** 信用卡额度使用率细条高度（计划 S3：2pt）—— 纯几何常量 */
/** 额度使用率细条高度（UI V2 定稿：3，与统计页占比细条同规格） */
const USAGE_BAR_HEIGHT = 3;
/** 细条的横向品牌渐变（accent 渐变的 start/end 是给方块用的对角；细条要横着走） */
const USAGE_BAR_GRADIENT = { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } } as const;
/** 额度使用率预警点（与预算条同一套语义：≥80% warning、≥100% danger） */
const USAGE_WARN_PCT = 80;
const USAGE_FULL_PCT = 100;
/** 已归档账户行的淡化透明度（仍可读，区别于活跃账户） */
const ARCHIVED_ROW_OPACITY = 0.7;

/* ─── 窄屏（320 视口）账户行宽度分配 ────────────────────────────────────────
 * 行的四块：图标 42 · 文字栏（弹性）· 金额栏（不可压）· 行尾 chevron。
 * 之前金额栏 flexShrink:0 且文字栏无下限 → 15 位金额把文字栏挤到「一行一个字」，
 * 副行没有 numberOfLines 就逐字竖排。现在反过来：先给文字栏留一个最小宽，
 * 剩下的才是金额栏的预算，金额按这个预算自己降档（MoneyText availableWidth），
 * 降到地板仍放不下才走它自带的紧凑格式（长按看全文 + 读屏读完整金额）。 */
/** 左侧文字栏最小宽：约 3–4 个中文字（16 号标题 / 13 号副行），再窄就只剩省略号 */
const ROW_TEXT_MIN_WIDTH = 52;
/** 金额栏预算下限：低于这个宽度连短金额都放不下，交给 MoneyText 的紧凑兜底 */
const ROW_AMOUNT_MIN_WIDTH = 64;
/** 行尾预留（chevron 进详情 14 + 余量 4） */
const ROW_TRAILING_RESERVE = 18;
/** 账户图标圆直径（与 AccountIcon 的 IconCircle size 同值） */
const ROW_ICON_SIZE = 42;
/** 分组头右侧展开/收起按钮的视觉直径（触控区是整条分组头 286×46，远大于 32×32 下限） */
const COLLAPSE_BUTTON_SIZE = 26;

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 账户图标方块（UI_RULES 第 7 节统一规格：40 方块、radius.md 圆角、账户色 12% 底 + 100% 图标）。
 * 账户色是资产自带的数据（与类别色同一套用法），不是写死的设计色。
 */
/**
 * 账户行图标（UI V2 第 1 节「形状」：账户图标改圆形）。
 * 42 圆 + 底色 = 账户色 15%（夜）/ 近白淡底（日）—— 全部由 IconCircle 按主题推导，
 * 圆色仍取账户自带的数据色（与类别色同一套用法），不是写死的设计色。
 */
function AccountIcon({ color, icon }: { color: string; icon: IconName }) {
  return <IconCircle size={42} color={color} icon={icon} />;
}

/**
 * 渐变上的玻璃胶囊按钮（UI V2 稿：资产页右上「+ 添加账户」/ 排序模式「完成」）。
 * 为什么不用共享 Button：Button 只有 primary / secondary / destructive / ghost 四档，
 * 都是「实底 / 描边」材质，没有玻璃档；这里要的是 GlassView 材质 + 胶囊，
 * 所以按 GlassView 的规格页内组合一次（颜色 / 圆角 / 字号全部取令牌，不写死）。
 * 文字 / 图标 = text.primary（UI V2.1 §3：玻璃上的文字一律主文字色，日间不再有白字压浅色）。
 * 材质与规格照稿：高 40、左右内衬 14、radius.full、15/500、图标 16、图标与文字间距 6。
 */
function GlassPillButton({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  testID?: string;
}) {
  const { semantic, radius } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.97}
      hitSlop={0}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <GlassView
        radius={radius.full}
        style={{
          height: 40,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 14,
        }}
      >
        {!!icon && <Ionicons name={icon} size={16} color={semantic.textPrimary} />}
        <AppText variant="subhead" weight="500" color={semantic.textPrimary}>
          {label}
        </AppText>
      </GlassView>
    </PressableScale>
  );
}

/**
 * 账户详情头部的动作胶囊（稿 08 屏：转账 / 编辑 / 更多，三等分横排）。
 * 为什么不用共享 Button：Button 的左右内衬 24，390 视口三等分每格约 110、320 只剩 90，
 * 图标 + 文字会被挤成两行；这里按胶囊规格组合「图标 18 + 间距 6 + 13/600 文字 + 内衬 8」，
 * 材质与 Button 的 secondary 档一致（accentSoft 底 + accentText 字），
 * 颜色 / 圆角 / 间距全部取令牌，触控高度 44（≥44 下限），文字单行不换行。
 */
function AccountActionPill({
  icon,
  label,
  onPress,
  active,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** 当前动作处于展开态（「更多」托盘打开时反色） */
  active?: boolean;
  testID?: string;
}) {
  const { semantic, radius, spacing } = useTheme();
  const foreground = active ? semantic.onAccent : semantic.accentText;
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.97}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      testID={testID}
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        columnGap: 6,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.full,
        backgroundColor: active ? semantic.accent : semantic.accentSoft,
      }}
    >
      <Ionicons name={icon} size={18} color={foreground} />
      <AppText variant="footnote" weight="600" color={foreground} numberOfLines={1}>
        {label}
      </AppText>
    </PressableScale>
  );
}

/**
 * 分组头右侧的展开 / 收起指示：圆形 chevron 按钮。
 * 材质与币种胶囊同一套（surfaceElevated 实底 + 7% accentText 叠层 + accentText 图标）——
 * 不新增颜色语言，浅色 / 深色都跟着令牌走；收起朝下、展开朝上，用 transform 旋转过渡
 * （Reanimated 是既有依赖，不引新包；系统「减弱动态效果」时时长归零，直接切到终态）。
 * 纯视觉：点击由整条分组头接管，理由见 CurrencySectionHeader 的注释。
 */
function CollapseChevron({ collapsed }: { collapsed: boolean }) {
  const { semantic, radius, motion } = useTheme();
  const progress = useSharedValue(collapsed ? 0 : 1);
  useEffect(() => {
    progress.value = withTiming(collapsed ? 0 : 1, {
      duration: motion.reduceMotion ? 0 : motion.timing.fade,
    });
  }, [collapsed, motion, progress]);
  const rotateStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.value * 180}deg` }],
  }));
  return (
    // 底色用 accentSoft（令牌里的「选中胶囊底 / 图标方块底」）：日间白卡上 surfaceElevated 是纯白，
    // 圆形按键会整个消失；accentSoft 是淡紫洗底，日夜两种主题在玻璃卡上都能看出「这是个按钮」。
    <View
      style={{
        width: COLLAPSE_BUTTON_SIZE,
        height: COLLAPSE_BUTTON_SIZE,
        borderRadius: radius.full,
        backgroundColor: semantic.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <Animated.View style={rotateStyle}>
        <Ionicons name="chevron-down" size={15} color={semantic.accentText} />
      </Animated.View>
    </View>
  );
}

/**
 * 币种小节头（V2.2c：放进玻璃卡**卡内**，一组一个节标题行）——
 *   左：币种代码小胶囊（accent 软底 + accent 字，如 MYR）；
 *   右：该币种合计（15/600，text.secondary，**完整两位小数千分位、不带货币符号** ——
 *       币种只靠左侧胶囊，否则 CNY / JPY 都是 ¥ 分不清）+ 展开/收起按钮；
 *   「净资产」字样与每个组各自的实白卡都已删（V2.2c：所有组共用同一张玻璃卡）。
 * 合计对所有组一律显示（V2.2c 曾按「> 1 个账户」隐藏，导致同一种分组头一半有数字、
 * 一半空白，被判定为「没有总计」的 bug —— 已统一）。
 * 为什么不用共享 Chip：稿里币种标记是「实心小胶囊（24 高 / 左右内衬 9 / 12-600）」，
 * 而 Chip 是描边胶囊 + 44 触控外框，当分组头会把这一行撑高一档。
 *
 * 可发现性（本次修）：原来「整行可收」这件事只存在于代码里 —— 屏上唯一能点的只有币种胶囊，
 * 而且它长得像标签，新用户不可能猜到那是开关。现在：
 *   1) 右侧多一枚 chevron 圆形按钮（收起朝下 / 展开朝上），把「这行能收起来」画出来；
 *   2) 整条分组头本身成为开关（≥44 高的整行触控），点胶囊 / 点合计 / 点按钮都切换；
 *   3) 读屏报 button + expanded 状态（accessibilityState；原生端直接生效 —— react-native-web 0.21
 *      已不再把 accessibilityState 映射成 aria-expanded，那是全 App 的既有写法，不在本期改）；
 *      不再用 selected 这种含糊表达。
 * 按钮不单独绑 onPress：嵌套 Pressable 的 click 会冒泡到整行，点一次会切两次（= 没反应）。
 * 收起时组内账户隐藏，但这一行的合计照常显示（合计在折叠块之外，未改动）。
 */
function CurrencySectionHeader({
  code,
  total,
  collapsed,
  onToggle,
  active,
  testID,
}: {
  code: string;
  total: number;
  collapsed: boolean;
  onToggle: () => void;
  /** 是否 = 顶部卡片当前选中的币种（高亮：底色微变 + 「当前」标记） */
  active?: boolean;
  testID?: string;
}) {
  const { semantic, spacing, radius, layout } = useTheme();
  const t = useT();
  return (
    <PressableScale
      onPress={onToggle}
      activeScale={0.99}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: spacing.sm,
        rowGap: spacing.xs,
        paddingHorizontal: layout.card,
        paddingTop: spacing.md,
        paddingBottom: spacing.sm,
        // 高亮组：accentText 7% 叠层（与币种胶囊 / 折叠按钮同一套令牌，不新造颜色）；
        // 不铺底时给 transparent，保持行高与普通组完全一致
        backgroundColor: active ? withAlpha(semantic.accentText, 0.07) : 'transparent',
      }}
      accessibilityRole="button"
      accessibilityLabel={code}
      accessibilityState={{ expanded: !collapsed }}
      testID={testID}
    >
      {/* 胶囊底：不透明软紫 —— 页面底是渐变，直接用 10% 的 accentSoft 会被渐变拉暗
          （实测 12pt 紫字只有 3.4:1，§4 要 4.5）；不透明底 + accent 7%（≈ accentSoft 浅一档）
          落在 4.6:1。底色由「surfaceElevated 实底 + 半透明紫叠层」合成，不手写色值 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs }}>
        <View
          style={{
            height: 24,
            borderRadius: radius.full,
            paddingHorizontal: 9,
            justifyContent: 'center',
            backgroundColor: semantic.surfaceElevated,
            overflow: 'hidden',
            opacity: collapsed ? 0.55 : 1,
          }}
        >
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: withAlpha(semantic.accentText, 0.07) }]}
          />
          <AppText variant="caption" weight="600" color={semantic.accentText}>
            {code}
          </AppText>
        </View>
        {/* 「当前」= 这张分组就是顶部卡片正在显示的那个币种（收起后也知道自己在看哪个币种） */}
        {active && (
          <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: 3 }}>
            <Ionicons name="ellipse" size={5} color={semantic.accent} />
            <AppText
              variant="caption"
              weight="600"
              color={semantic.accentText}
              testID={`asset-group-active-${code}`}
            >
              {t('asset.currentTag')}
            </AppText>
          </View>
        )}
      </View>
      {/* 合计一律显示（不再按账户数区分）：同一种分组头一半有数字一半空白，
          用户只会判定「坏了」。单账户组的合计虽然等于那行余额，但它是这一组唯一的
          「汇总读数」，且收起后是唯一还留在屏上的数字，位置一致性比省这点宽度重要。 */}
      <View style={{ flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm }}>
        <MoneyText value={total} variant="subhead" weight="600" color={semantic.textSecondary} />
        <CollapseChevron collapsed={collapsed} />
      </View>
    </PressableScale>
  );
}

/**
 * 账户行（验收退回第 1 条定版）。
 *
 * 为什么不用 ListRow：ListRow 的三块排布是「一行 flexWrap + space-between」——
 * 账户名一长，右侧金额整块会被挤到第二行；而这一行要求的是
 * 「金额永远留在第一行最右（flexShrink:0）、标题在自己那一栏里最多 2 行、
 * 副行与额度细条都对齐标题栏（不伸到图标下方）」，ListRow 表达不了，所以在页面内用
 * 令牌 + 同一套 40 图标方块规格实现（画风与 ListRow 一致：行高 ≥ useLayout().rowMinHeight）。
 */
function AssetRow({
  color,
  icon,
  title,
  subtitle,
  value,
  barFraction,
  barTone,
  trailing,
  onPress,
  onLongPress,
  style,
  testID,
}: {
  color: string;
  icon: IconName;
  title: string;
  /** 副行（信用卡：可用额度 · 还款日）；放不下时自己换行，不截断不缩略 */
  subtitle?: string;
  /**
   * 右侧金额（flexShrink:0，永远留在第一行最右）。
   * 也可以传函数：参数是本行实测后分给金额栏的可用宽（px）—— MoneyText 靠它自己降档，
   * 长金额就不会再靠挤压左侧文字栏来「让位」。
   */
  value?: React.ReactNode | ((availableWidth: number | undefined) => React.ReactNode);
  /** 行下细条（信用卡额度使用率；0–1） */
  barFraction?: number;
  /** 细条色调：accent（正常，走品牌渐变）/ warning（≥80%）/ danger（≥100%）—— 告警档沿用原来的语义色 */
  barTone?: 'accent' | 'warning' | 'danger';
  /** 行尾自定义内容（排序模式的拖动把手） */
  trailing?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { semantic, typography, spacing, radius, layout, gradients } = useTheme();
  const { rowMinHeight } = useLayout();

  // 标题是否占到了第二行（实测高度判定，与 ScreenHeader 同一套做法）：
  // 单行时三块垂直居中（和 ListRow 观感一致）；两行时文字块与金额一律靠上，
  // 金额因此永远停在第一行最右边，不会被顶到第二行去
  const [titleLines, setTitleLines] = useState(1);
  // 本行横向容器的实测宽（行宽由卡片给定，不随内容变化 → 不会和金额字宽互相追成反馈环）
  const [rowWidth, setRowWidth] = useState(0);
  /**
   * 分给金额栏的可用宽：先扣掉图标 / 行尾 / 间距，再给文字栏留一个最小宽，剩下的才是金额的。
   * 还没量到行宽时返回 undefined → MoneyText 退回「按自身盒宽判断」的老行为（单帧无副作用）。
   */
  const amountBudget =
    rowWidth > 0
      ? Math.max(
          ROW_AMOUNT_MIN_WIDTH,
          Math.round(
            rowWidth - ROW_ICON_SIZE - ROW_TEXT_MIN_WIDTH - ROW_TRAILING_RESERVE - spacing.md * 3
          )
        )
      : undefined;
  // V2.2c 层级：账户名 16/500（body 令牌 17/400，按稿覆盖字号 + 提半档字重）
  const singleLineHeight =
    TITLE_FONT_SIZE *
    Math.min(PixelRatio.getFontScale(), typography.body.maxFontSizeMultiplier);
  useEffect(() => {
    setTitleLines(1);
  }, [title]);
  const alignTop = titleLines > 1;

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      activeScale={0.98}
      hitSlop={0}
      style={[
        {
          minHeight: rowMinHeight,
          paddingHorizontal: layout.card,
          paddingVertical: spacing.md,
          justifyContent: 'center',
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: alignTop ? 'flex-start' : 'center',
          columnGap: spacing.md,
        }}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w > 0 && w !== rowWidth) setRowWidth(w);
        }}
      >
        <View style={{ alignSelf: 'center' }}>
          <AccountIcon color={color} icon={icon} />
        </View>
        {/* 文字栏：可以缩（minWidth:0），但金额栏的预算已经把它的下限保住了 */}
        <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
          <AppText
            variant="body"
            weight="500"
            style={{ fontSize: TITLE_FONT_SIZE }}
            numberOfLines={2}
            onLayout={(e) =>
              setTitleLines(Math.max(1, Math.round(e.nativeEvent.layout.height / singleLineHeight)))
            }
          >
            {title}
          </AppText>
          {!!subtitle && (
            // 副行最多两行（窄屏 + 巨额时曾经逐字竖排：中文可断行、又没有行数限制）。
            // 信用卡的副行里带着「可用额度 ……」这种真金额，只给一行时 320 视口会把它省略掉；
            // 两行是「可读」与「行高不失控」的折中，绝不会逐字竖排。
            <AppText
              variant="footnote"
              color={semantic.textSecondary}
              numberOfLines={2}
              ellipsizeMode="tail"
              style={{ marginTop: spacing.xs }}
            >
              {subtitle}
            </AppText>
          )}
          {barFraction != null && (
            <View
              style={{
                marginTop: spacing.sm,
                height: USAGE_BAR_HEIGHT,
                borderRadius: radius.full,
                backgroundColor: semantic.hairline,
                overflow: 'hidden',
              }}
            >
              {barTone === 'accent' ? (
                // 正常档（UI V2 稿）：品牌横向渐变；超 80% / 100% 仍退回语义告警色
                <LinearGradient
                  colors={gradients.accent.colors}
                  locations={gradients.accent.locations as [number, number, ...number[]]}
                  start={USAGE_BAR_GRADIENT.start}
                  end={USAGE_BAR_GRADIENT.end}
                  style={{
                    width: `${Math.min(Math.max(barFraction, 0), 1) * 100}%`,
                    height: USAGE_BAR_HEIGHT,
                    borderRadius: radius.full,
                  }}
                />
              ) : (
                <View
                  style={{
                    width: `${Math.min(Math.max(barFraction, 0), 1) * 100}%`,
                    height: USAGE_BAR_HEIGHT,
                    borderRadius: radius.full,
                    backgroundColor:
                      barTone === 'danger' ? semantic.danger : semantic.warning,
                  }}
                />
              )}
            </View>
          )}
        </View>
        {value != null && (
          <View
            style={{
              flexShrink: 0,
              // 不再额外加 marginLeft：行内已有 columnGap 统一隔开，
              // 再叠 8px 会让「文字↔金额」比「图标↔文字」宽一档，白占宽度还破坏节奏
              alignSelf: alignTop ? 'flex-start' : 'center',
            }}
          >
            {typeof value === 'function' ? value(amountBudget) : value}
          </View>
        )}
        {trailing}
      </View>
    </PressableScale>
  );
}

/**
 * 详情抽屉里的只读信息行（V2.2c B3）。
 * 为什么不用共享 ListRow：ListRow 的标题是 headline 17/600，而抽屉里的信息行按稿是
 * 「标签 15 常规 text.secondary / 值 15-600 text.primary」—— 字号窄一档、字重按语义分档；
 * 几何仍与 ListRow 一致（最小行高 rowMinHeight、行间 hairline、值列永不被挤压）。
 */
function SheetInfoRow({
  label,
  value,
  caption,
  separator,
  testID,
}: {
  label: string;
  value: React.ReactNode;
  /** 值下方小字（如「（3 笔）」） */
  caption?: string;
  /** 行底发丝线 */
  separator?: boolean;
  testID?: string;
}) {
  const { semantic, spacing } = useTheme();
  const { rowMinHeight } = useLayout();
  return (
    <View
      style={{
        minHeight: rowMinHeight,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        columnGap: spacing.md,
        paddingVertical: spacing.sm,
        borderBottomWidth: separator ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: semantic.hairline,
      }}
      testID={testID}
    >
      {/* minWidth 0：web 上 flex 子项默认 min-width:auto → 只有 flexShrink 1 是收不动的 */}
      <AppText variant="subhead" color={semantic.textSecondary} style={{ flexShrink: 1, minWidth: 0 }}>
        {label}
      </AppText>
      <View style={{ flexShrink: 0, alignItems: 'flex-end' }}>
        {value}
        {!!caption && (
          <AppText variant="caption" color={semantic.textTertiary} style={{ marginTop: 2 }}>
            {caption}
          </AppText>
        )}
      </View>
    </View>
  );
}

interface CreditStatement {
  currentCycleSpend: number; // 本期（还没结算）已刷金额：本月 1 号到今天
  lastStatementAmount: number; // 上一期已结算账单金额：上个自然月整月
  isOverdue: boolean;
  overdueDays: number;
  estimatedInterest: number;
  available: number; // 可用额度
}

// 信用卡账单的固定标准：每月 1 号结算，结算区间为上一个自然月（1 号到月末）。
// 不使用账户上的账单日/还款日字段；本期已刷 = 本月 1 号到今天（含今天）
function computeCreditStatement(
  asset: { creditLimit?: number; interestRate?: number },
  balance: number,
  spendInRange: (start: Date, end: Date) => number
): CreditStatement | null {
  const today = new Date();
  // 两个结算日：本月 1 号（最近一次）和上月 1 号（上一次）
  const closeDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const prevCloseDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  // 本期区间含今天：结束取到明天 0 点
  const cycleEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  const currentCycleSpend = spendInRange(closeDate, cycleEnd);
  const lastStatementAmount = spendInRange(prevCloseDate, closeDate);

  const totalOwed = Math.max(0, -balance); // balance 是负数代表欠款
  // 上期账单已出（已进入新月份）仍没还：欠款还覆盖着上期账单金额就视为逾期
  const isOverdue = lastStatementAmount > 0 && totalOwed >= lastStatementAmount;
  const overdueDays = isOverdue ? Math.floor((today.getTime() - closeDate.getTime()) / 86400000) : 0;
  const estimatedInterest =
    isOverdue && asset.interestRate ? lastStatementAmount * (asset.interestRate / 100 / 365) * overdueDays : 0;

  const available = (asset.creditLimit ?? 0) - totalOwed;

  return { currentCycleSpend, lastStatementAmount, isOverdue, overdueDays, estimatedInterest, available };
}

interface AssetFlowStats {
  inflowAmount: number; // 本月流入：收入 + 转入
  inflowCount: number;
  outflowAmount: number; // 本月流出：支出 + 转出（含手续费）
  outflowCount: number;
}

function computeAssetFlowStats(
  assetId: string,
  monthStart: string,
  transactions: {
    type: string;
    assetId?: string;
    fromAssetId?: string;
    toAssetId?: string;
    amount: number;
    fee?: number;
    convertedAmount?: number;
    date: string;
  }[]
): AssetFlowStats {
  let inflowAmount = 0;
  let inflowCount = 0;
  let outflowAmount = 0;
  let outflowCount = 0;
  transactions
    .filter((t) => t.date >= monthStart)
    .forEach((t) => {
      if (t.type === 'income' && t.assetId === assetId) {
        inflowAmount += t.amount;
        inflowCount += 1;
      } else if (t.type === 'expense' && t.assetId === assetId) {
        outflowAmount += t.amount;
        outflowCount += 1;
      } else if (t.type === 'transfer') {
        if (t.toAssetId === assetId) {
          inflowAmount += t.convertedAmount ?? t.amount;
          inflowCount += 1;
        }
        if (t.fromAssetId === assetId) {
          outflowAmount += t.amount + (t.fee ?? 0);
          outflowCount += 1;
        }
      }
    });
  return { inflowAmount, inflowCount, outflowAmount, outflowCount };
}

export default function AssetScreen() {
  const {
    assets,
    activeAssets,
    assetBelongsToActiveLedger,
    transactions,
    currency,
    categories,
    getAssetBalance,
    deleteAsset,
    archiveAsset,
    unarchiveAsset,
    assetRecordCount,
    setDefaultAsset,
    updateAsset,
  } = useApp();
  // 已归档账户（底部可折叠分组，默认收起）。
  // 归属判定与 activeAssets 共用同一个谓词（含孤儿兜底），否则归档区会把别的账本的归档账户也列出来。
  const archivedAssets = useMemo(
    () => assets.filter((a) => !!a.archivedAt && assetBelongsToActiveLedger(a)),
    [assets, assetBelongsToActiveLedger]
  );
  // 本账本是否有账户（含已归档）：决定空状态、类型筛选条、"添加"按钮是否出现。
  // 用账本口径而不是全局 assets —— 否则切到一本没有账户的账本时，列表分支全被跳过，页面只剩标题（空白页）。
  const hasLedgerAssets = useMemo(
    () => assets.some((a) => assetBelongsToActiveLedger(a)),
    [assets, assetBelongsToActiveLedger]
  );
  const [archivedOpen, setArchivedOpen] = useState(false);
  // 账户类型筛选（设计稿 02 屏分段 Tab）：只过滤展示，不动 assets / 余额口径
  const [accountFilter, setAccountFilter] = useState<'all' | 'cash' | 'bank' | 'ewallet'>('all');
  // 总资产卡的隐私开关（稿里的眼睛）：只切显示，不写数据
  const [balanceHidden, setBalanceHidden] = useState(false);
  // 卡上的币种切换器：null = 自动（全局币种所在分组，否则第一个分组）；
  // 用户选过币种后，卡片只显示那一种币种的合计（绝不跨币种相加）
  /* 大金额的「判档宽度」：取**父级实测宽**（定值），交给 MoneyText 自己降档。
     不能靠 MoneyText 自身盒宽 —— 普通金额的盒子是「宽 = 内容宽」（flexShrink 0），
     量回来的永远是内容宽，长金额永远判成「放得下」→ 直接画到渐变卡外面。 */
  const [totalAmountW, setTotalAmountW] = useState(0);
  const [detailAmountW, setDetailAmountW] = useState(0);
  type AssetItem = (typeof assets)[number];
  const { semantic, typography, spacing, radius, layout, gradients } = useTheme();
  const { pagePadding, contentMaxWidth } = useLayout();
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSystemInset();
  const navigation = useNavigation<any>();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const styles = useMemo(
    () => makeStyles(semantic, typography, spacing, radius, layout),
    [semantic, typography, spacing, radius, layout]
  );
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）

  // ---------- "我的账户"：编辑排列模式 / 币种分组折叠 / 自定义拖拽顺序 ----------
  // reorderMode：长按账户行进入，此时强制展开全部分组改成可拖拽的行，右上"完成"退出
  // collapsedCurrencies：浏览模式下收起（默认全展开，点币种 Chip 收起该组）
  // assetOrder：拖拽产生的顺序，只在同一币种分组内比较，不需要跨分组唯一，存本地不动账户数据结构
  const [reorderMode, setReorderMode] = useState(false);
  const [collapsedCurrencies, setCollapsedCurrencies] = useState<string[]>([]);
  const [assetOrder, setAssetOrder] = useState<Record<string, number>>({});
  const toggleCurrencyGroup = (code: string) => {
    setCollapsedCurrencies((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };

  // 启动时恢复上次保存的拖拽排序
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ASSET_ORDER_KEY);
        if (mounted && raw) setAssetOrder(JSON.parse(raw));
      } catch (e) {
        console.warn('读取账户排序失败', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const persistAssetOrder = (next: Record<string, number>) => {
    setAssetOrder(next);
    AsyncStorage.setItem(ASSET_ORDER_KEY, JSON.stringify(next)).catch((e) => console.warn('保存账户排序失败', e));
  };

  // 某个币种分组内拖拽结束：按新顺序把 0..n-1 写回该分组这几个账户的 order，
  // 不同分组的编号可以重叠，反正排序比较永远只发生在同一分组内部
  const handleGroupReorder = (groupItems: { id: string }[]) => {
    const next = { ...assetOrder };
    groupItems.forEach((item, index) => {
      next[item.id] = index;
    });
    persistAssetOrder(next);
  };

  // V2.2：顶部净资产汇总卡已删（各币种资产 / 负债汇总随之退役），页面只保留下面的币种分组列表

  // 有记录的账户不删除：归档（隐藏、不计净资产，历史保持不变，可随时恢复）
  const handleArchive = (id: string, assetName: string) => {
    const count = assetRecordCount(id);
    dialog.alert({
      title: t('asset.archiveTitle', { name: assetName }),
      message: t('asset.archiveMsg', { count }),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('asset.archive'),
          onPress: () => {
            closeDetail();
            archiveAsset(id);
          },
        },
      ],
    });
  };

  const handleDelete = (id: string, assetName: string) => {
    dialog.alert({
      title: t('asset.deleteAssetTitle', { name: assetName }),
      message: t('asset.deleteAssetMsg'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        // 删除后账户已不存在：连带关闭详情抽屉，避免留下空壳抽屉（删除入口在抽屉内）
        { text: t('common.delete'), style: 'destructive', onPress: () => { closeDetail(); hapticWarning(); deleteAsset(id); } },
      ],
    });
  };

  // ---------- 点击账户查看详情：信用卡看账单周期，银行卡/现金看本月收支流水 ----------
  // 抽屉打开即可直接改：名称是输入框、点金额数字调起计算器键盘，一个"保存"统一提交（无单独编辑模式）
  const [viewingAssetId, setViewingAssetId] = useState<string | null>(null);
  const [viewSetDefault, setViewSetDefault] = useState(false);
  const viewingAsset = assets.find((a) => a.id === viewingAssetId);
  // 抽屉出场动画播放期间父级已把 viewingAssetId 置空：留住最后一份数据，动画不会闪成空壳
  const lastViewingRef = useRef<AssetItem | undefined>(undefined);
  if (viewingAsset) lastViewingRef.current = viewingAsset;
  const sheetAsset = viewingAsset ?? lastViewingRef.current;
  // 同一次编辑会话（"放弃修改"对话框点取消后抽屉弹回）不重新预填，用户已输入的内容不丢
  const prefilledIdRef = useRef<string | null>(null);

  // 账户详情三段（稿 08 屏：交易记录 / 月度统计 / 账户设置）+ 头部「更多」托盘（归档 / 恢复 / 删除）
  type DetailTab = 'tx' | 'monthly' | 'settings';
  const [detailTab, setDetailTab] = useState<DetailTab>('tx');
  const [moreOpen, setMoreOpen] = useState(false);

  const [viewName, setViewName] = useState('');
  const [viewBalanceStr, setViewBalanceStr] = useState('');
  const [viewKeypadOpen, setViewKeypadOpen] = useState(false);
  const balanceExpr = useAmountExpression();

  // ---------- 当前余额/信用额度：自绘光标（长按拖动定位，按键在光标位置生效） ----------
  const [viewBalanceCursor, setViewBalanceCursor] = useState(0); // 光标距显示串尾部的偏移（0 = 最末尾）
  const viewNameInputRef = useRef<any>(null); // 名称框：切到金额时让它失焦（光标互斥）
  const amountTextRef = useRef<any>(null);
  const amountTextBoxRef = useRef<{ x: number; w: number } | null>(null);
  // 金额文字在窗口里的位置（长按/点按定位光标用）
  const refreshAmountTextBox = () => {
    amountTextRef.current?.measureInWindow((x: number, _y: number, w: number) => {
      amountTextBoxRef.current = { x, w };
    });
  };
  const amountCursorDragRef = useRef(false);
  // 抽屉内名称框的键盘避让：键盘弹出时垫高滚动区底部（spacer），并把名称框滚到顶部附近
  const [sheetKbHeight, setSheetKbHeight] = useState(0);
  const sheetScrollRef = useRef<ScrollView>(null);
  const nameBlockYRef = useRef(0);
  const nameFocusedRef = useRef(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      // 系统键盘（名称输入）弹出 → 自绘键盘收起（两套键盘互斥协调）
      setViewKeypadOpen(false);
      setSheetKbHeight(e.endCoordinates.height);
      if (nameFocusedRef.current) {
        sheetScrollRef.current?.scrollTo({ y: Math.max(0, nameBlockYRef.current - 16), animated: true });
      }
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      // 系统键盘收起 → 自绘键盘显示回来（含 Android 返回键收起键盘的情况）
      setViewKeypadOpen(true);
      setSheetKbHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const viewDisplayRef = useRef('');
  viewDisplayRef.current = viewKeypadOpen ? balanceExpr.displayValue : '';
  // 光标在显示串里的下标（渲染切片用）
  const viewCursorIdx = Math.max(
    0,
    Math.min(viewDisplayRef.current.length, viewDisplayRef.current.length - viewBalanceCursor)
  );
  const placeCursorFromTouch = (pageX: number) => {
    const box = amountTextBoxRef.current;
    const display = viewDisplayRef.current;
    if (!box || box.w <= 0 || !display) return;
    const idx = Math.max(0, Math.min(display.length, Math.round((pageX - box.x) / (box.w / display.length))));
    setViewBalanceCursor(display.length - idx);
  };
  const handleViewKeyPress = (key: string) => {
    setViewBalanceCursor(balanceExpr.pressKeyAt(key, viewBalanceCursor));
  };
  const handleAmountBoxPress = (e: any) => {
    if (!viewKeypadOpen) {
      openViewKeypad();
      return;
    }
    placeCursorFromTouch(e.nativeEvent.pageX);
  };
  const handleAmountBoxLongPress = (e: any) => {
    if (!viewKeypadOpen) return;
    amountCursorDragRef.current = true;
    placeCursorFromTouch(e.nativeEvent.pageX);
  };
  const amountCursorPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: () => amountCursorDragRef.current,
      onPanResponderMove: (_e, g) => placeCursorFromTouch(g.moveX),
      onPanResponderRelease: () => {
        amountCursorDragRef.current = false;
      },
      onPanResponderTerminate: () => {
        amountCursorDragRef.current = false;
      },
    })
  ).current;
  // PressableScale 的 onPress 类型不带事件参数，运行时事件照常透传（两个处理函数要 pageX 定位光标）
  const amountBoxPressProps = {
    onPress: handleAmountBoxPress as unknown as () => void,
    onLongPress: handleAmountBoxLongPress as unknown as () => void,
    delayLongPress: 300,
  };

  useEffect(() => {
    if (!viewingAssetId) return;
    // 每次打开（含"放弃修改"点取消后弹回）都回到第一段，动作托盘收起
    setDetailTab('tx');
    setMoreOpen(false);
    // 同一次编辑会话：不重新预填（"放弃修改"对话框点取消后抽屉弹回时保留已输入内容）
    if (prefilledIdRef.current === viewingAssetId) return;
    const asset = assets.find((a) => a.id === viewingAssetId);
    if (asset) {
      prefilledIdRef.current = viewingAssetId;
      setViewSetDefault(!!asset.isDefault);
      setViewName(asset.name);
      // 金额字段预填当前值：非信用卡是当前余额（输入"想让当前余额变成的数"），信用卡是信用额度
      setViewBalanceStr(
        String(asset.type === 'credit' ? asset.creditLimit ?? 0 : getAssetBalance(asset.id)),
      );
    }
    setViewKeypadOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingAssetId]);

  const openViewKeypad = () => {
    // 名称框的系统键盘/光标退场：一次只允许一个光标显示（点余额/额度 = 切换输入焦点）
    viewNameInputRef.current?.blur();
    // 预填当前数额：光标在末尾，退格逐位修改或长按定位；按 C（清除）才归零重新输入
    balanceExpr.reset(parseFloat(viewBalanceStr) || 0);
    setViewBalanceCursor(0); // 光标从最末尾开始
    setViewKeypadOpen(true);
  };
  // 计算器「完成」：求值落回金额行并直接保存（与"保存"按钮同一效果）
  const handleViewKeypadConfirm = () => {
    const typed = balanceExpr.confirm();
    setViewBalanceStr(String(typed));
    setViewKeypadOpen(false);
    saveViewChanges(typed);
  };

  // 未保存修改检测：名称、余额目标值、默认勾选任一变化即视为脏
  const viewEditDirty =
    !!viewingAsset &&
    (viewName.trim() !== viewingAsset.name ||
      viewSetDefault !== !!viewingAsset.isDefault ||
      (parseFloat(viewBalanceStr) || 0) !==
        (viewingAsset.type === 'credit'
          ? viewingAsset.creditLimit ?? 0
          : getAssetBalance(viewingAsset.id)));

  /** 真正关掉详情抽屉（清掉预填标记，下次打开同一账户重新读数据） */
  const closeDetail = () => {
    prefilledIdRef.current = null;
    setViewingAssetId(null);
  };

  // 关抽屉：有未保存修改先确认放弃，防误触。
  // ⚠ BottomSheet 收到 onClose 时已经播完出场动画把自己卸载了，所以这里只能"拦"在数据层：
  //   点取消 = 重新打开同一账户（预填标记还在，已输入内容原样保留），点放弃 = 真正关闭。
  const tryCloseDetail = () => {
    if (viewEditDirty) {
      const id = viewingAssetId;
      dialog.alert({
        title: t('asset.discardEditTitle'),
        buttons: [
          {
            text: t('common.cancel'),
            style: 'cancel',
            onPress: () => {
              // 先置空再置回：visible 变化才会触发 BottomSheet 重新挂载并播入场动画
              setViewingAssetId(null);
              setTimeout(() => setViewingAssetId(id), 0);
            },
          },
          { text: t('common.discard'), style: 'destructive', onPress: closeDetail },
        ],
      });
      return;
    }
    closeDetail();
  };

  /**
   * 「编辑」动作：落到「账户设置」段并把光标放进名称框 —— 编辑的就是原来那个输入框，
   * 没有新增编辑状态，也没有新增保存路径。
   */
  const handleDetailEdit = () => {
    setDetailTab('settings');
    setTimeout(() => viewNameInputRef.current?.focus(), 60);
  };

  /**
   * 「转账」动作：只开记账页的转账档（金额 / 账户 / 汇率 / 校验仍全由记账页决定，
   * 与 AI 专区跳记账页同一套 params 用法，不新增记账规则）。
   */
  const handleDetailTransfer = () => {
    // 记一笔带类型：跨 Tab 跳「首页」栈会 push 到首页那一份实例，返回就回首页了。
    // 资产栈里也注册了同一份「记一笔」（App.tsx 三注册），所以在本栈内 push：
    // 预设同样生效（新实例挂载时取 params），返回天然回这个账户详情。
    // 抽屉保持打开（不 closeDetail）：它挂在 AssetScreen 树内、被新的栈页整页盖住，
    // 返回时原样露出来 = 回到这个账户详情；遮着不等于关掉，未保存的名称 / 金额也不会被清掉，
    // 所以这条路径不需要再弹「放弃修改」确认（记住笔没有任何东西被丢弃）。
    navigation.navigate(ROUTES.ADD_TX, { presetType: 'transfer' });
  };

  const saveViewChanges = async (overrideBalance?: number) => {
    if (!viewingAsset || !viewName.trim()) return;
    // 自绘键盘还开着：先把屏幕上正在输入的表达式求值落回金额行再保存——
    // 否则这里读到的还是打开键盘前的旧值（"点保存金额不跟着变"的原因）
    let typed = overrideBalance;
    if (typed == null && viewKeypadOpen) {
      typed = balanceExpr.confirm();
      setViewBalanceStr(String(typed));
      setViewBalanceCursor(0);
      setViewKeypadOpen(false);
    }
    typed = typed ?? (parseFloat(viewBalanceStr) || 0);
    if (viewingAsset.type === 'credit') {
      await updateAsset(viewingAsset.id, { name: viewName.trim(), creditLimit: typed });
    } else {
      // 输入的是"想让当前余额变成的数"：差额写回起始余额，保存后当前余额即变为输入值
      const delta = getAssetBalance(viewingAsset.id) - viewingAsset.initialBalance;
      await updateAsset(viewingAsset.id, { name: viewName.trim(), initialBalance: typed - delta });
    }
    // 默认账户勾选随本次保存一并生效；保存后关闭抽屉（列表已是最新数据）
    if (viewSetDefault !== !!viewingAsset.isDefault) {
      await setDefaultAsset(viewSetDefault ? viewingAsset.id : null);
    }
    closeDetail();
  };

  const viewingCreditAsset = viewingAsset?.type === 'credit' ? viewingAsset : undefined;

  const viewingStatement = useMemo(() => {
    if (!viewingCreditAsset) return null;
    return computeCreditStatement(viewingCreditAsset, getAssetBalance(viewingCreditAsset.id), (start, end) =>
      transactions
        .filter(
          (t) =>
            t.assetId === viewingCreditAsset.id &&
            t.type === 'expense' &&
            t.date >= toDateStr(start) &&
            t.date < toDateStr(end)
        )
        .reduce((s, t) => s + t.amount, 0)
    );
  }, [viewingCreditAsset, transactions, getAssetBalance]);

  // V2.2c B1：还款日 / 账单日一行（账单日只在数据已有 statementDay 时出现，不新增字段；
  // 两个都没有 → 整行不渲染）
  const creditDayLine = useMemo(() => {
    if (!sheetAsset || sheetAsset.type !== 'credit') return '';
    return [
      sheetAsset.dueDay ? t('asset.creditDueDay', { day: sheetAsset.dueDay }) : null,
      sheetAsset.statementDay ? t('asset.creditStatementDay', { day: sheetAsset.statementDay }) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }, [sheetAsset, t]);

  // 头部大余额：信用卡按欠费口径（与原欠款块完全一致：欠款显示成绝对值 + 减号），其余显示当前余额
  const sheetHeroBalance = sheetAsset
    ? sheetAsset.type === 'credit'
      ? -Math.max(0, -getAssetBalance(sheetAsset.id))
      : getAssetBalance(sheetAsset.id)
    : 0;

  // 详情分段（稿 08 屏）：值只是展示层枚举，标签取 i18n
  const detailSegmentOptions = useMemo(
    () => [
      { label: t('asset.tabTransactions'), value: 'tx' },
      { label: t('asset.tabMonthly'), value: 'monthly' },
      { label: t('asset.tabSettings'), value: 'settings' },
    ],
    [t]
  );

  // 账户详情里的「该账户流水」：归属口径与 computeAssetFlowStats 一致
  // （expense/income 看 assetId，transfer 看 fromAssetId / toAssetId），新的在前。
  const accountTransactions = useMemo(() => {
    const id = sheetAsset?.id;
    if (!id) return [];
    return transactions
      .filter((t) =>
        t.type === 'transfer' ? t.fromAssetId === id || t.toAssetId === id : t.assetId === id
      )
      .slice()
      .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  }, [sheetAsset?.id, transactions]);

  // 银行卡/现金类：本月流入流出（含转账）金额与笔数
  const viewingFlowStats = useMemo(() => {
    if (!viewingAsset || viewingAsset.type === 'credit') return null;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return computeAssetFlowStats(viewingAsset.id, monthStart, transactions);
  }, [viewingAsset, transactions]);

  // ---------- 先按货币分大组，组内再按类型顺序（现金 / 银行卡 / 信用卡）排列 ----------
  const typeOrder = useMemo(() => {
    const order: Record<AssetType, number> = {} as Record<AssetType, number>;
    TYPE_OPTIONS.forEach((t, i) => {
      order[t.type] = i;
    });
    return order;
  }, []);

  const groupedAssets = useMemo(() => {
    const byCurrency: Record<string, typeof activeAssets> = {};
    activeAssets
      .filter((a) => accountFilter === 'all' || a.type === accountFilter)
      .forEach((a) => {
        if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
        byCurrency[a.currency].push(a);
      });
    return Object.entries(byCurrency)
      .sort(([codeA], [codeB]) => codeA.localeCompare(codeB))
      .map(([code, items]) => ({
        code,
        items: [...items].sort((a, b) => {
          const oa = assetOrder[a.id];
          const ob = assetOrder[b.id];
          // 两边都手动排过序：按拖拽顺序来
          if (oa != null && ob != null) return oa - ob;
          // 只有一边排过序：排过的排在前面，新账户/没拖过的账户排在后面
          if (oa != null) return -1;
          if (ob != null) return 1;
          // 都没排过序：沿用原来"现金/银行卡/信用卡"的默认顺序
          return (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
        }),
      }));
  }, [activeAssets, typeOrder, assetOrder, accountFilter]);

  // 筛选分段（稿：全部账户 / 现金 / 银行 / 电子钱包）—— 标签取现有 i18n 键（i18n 不在本次改动范围）
  const filterOptions = useMemo(
    () => [
      { label: t('common.all'), value: 'all' },
      { label: t('asset.typeCash'), value: 'cash' },
      { label: t('asset.typeBank'), value: 'bank' },
      { label: t('asset.typeCredit'), value: 'credit' },
      { label: t('asset.typeEwallet'), value: 'ewallet' },
    ],
    [t]
  );

  /** 浏览模式的一行：图标方块 + 名称 + 余额；信用卡换成"欠款 + 可用 / 还款日 + 使用率细条" */
  const renderAssetRow = (a: AssetItem) => {
    const balance = getAssetBalance(a.id);
    const isCredit = a.type === 'credit';
    const limit = a.creditLimit ?? 0;
    const owed = isCredit ? Math.max(0, -balance) : 0;
    const available = getAssetDisplayBalance(a, balance);
    const usedPct = isCredit && limit > 0 ? Math.min(USAGE_FULL_PCT, (owed / limit) * 100) : 0;
    // 告警分档原封不动（≥100% danger / ≥80% warning / 其余 accent 渐变）
    const barTone: 'accent' | 'warning' | 'danger' =
      usedPct >= USAGE_FULL_PCT ? 'danger' : usedPct >= USAGE_WARN_PCT ? 'warning' : 'accent';
    // 信用卡副行：可用额度 + 还款日（分组头已标币种）。放不下时副行自己换行，
    // 不挤金额、也不出省略号（UI_RULES 第 6 节 ③）。
    const creditSubtitle = isCredit
      ? [
          `${t('asset.creditAvailableShort')} ${formatMoney(available)}`,
          a.dueDay ? t('asset.creditDueDay', { day: a.dueDay }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined;
    // 其余账户的副行：账户类型 + 默认标记。
    // 不再带币种代码：分组头（MYR / USD）已经标了币种，行里重复一次只会占宽 ——
    // 320 视口上那一段恰好是唯一被省略号截断的部分（用户圈出「· MYR」要求删掉）。
    const accountSubtitle = [
      t(TYPE_LABEL_KEYS[a.type] ?? 'asset.typeOther'),
      a.isDefault ? t('asset.defaultTag') : null,
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <AssetRow
        key={a.id}
        color={a.color}
        icon={a.icon as IconName}
        title={a.name}
        subtitle={isCredit ? creditSubtitle : accountSubtitle}
        // 信用卡：主数字是欠款（分组头已标币种）；其余账户就是余额。
        // V2.2c：行余额 17/600（text.primary + tabular，AppText 统一给等宽数字）
        // 金额栏拿到的预算 → MoneyText 先按阶降字号；降到地板仍放不下才用紧凑格式
        // （长按看完整金额、读屏也读完整金额），绝不再去挤压左侧文字栏
        value={(amountWidth) => (
          <MoneyText
            value={isCredit ? -owed : balance}
            variant="body"
            weight="600"
            availableWidth={amountWidth}
            compactFallback
          />
        )}
        barFraction={isCredit && limit > 0 ? usedPct / 100 : undefined}
        barTone={barTone}
        // 稿 02 屏：金额右侧一枚 chevron（进入账户详情）
        trailing={<Ionicons name="chevron-forward" size={14} color={semantic.textTertiary} />}
        onPress={() => setViewingAssetId(a.id)}
        onLongPress={() => setReorderMode(true)}
        testID={`asset-row-${a.id}`}
      />
    );
  };

  return (
    // 全出血（同首页）：SafeAreaView 不让位，渐变一路通到屏幕顶；内容自己用 insets.top 让开状态栏
    <SafeAreaView style={styles.container} edges={[]}>
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        style={
          contentMaxWidth ? { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' } : undefined
        }
        contentContainerStyle={{ paddingBottom: tabClearance }}
      >
        {/* 页头（G5）：大标题 30/600（text.primary，§3：渐变上不再用白字）+ 右侧玻璃胶囊动作；
            排序模式换成「完成」（长按账户行进入）。空状态时页头不放按钮，动作只留空状态卡里那一个 */}
        <View style={{ paddingHorizontal: pagePadding, paddingTop: insets.top + 14 }}>
          <View style={styles.headerRow}>
            <AppText
              variant="title1"
              weight="600"
              color={semantic.textPrimary}
              style={styles.heroTitle}
              testID="asset-header"
            >
              {t('asset.title')}
            </AppText>
            {hasLedgerAssets &&
              (reorderMode ? (
                <GlassPillButton
                  label={t('common.done')}
                  onPress={() => setReorderMode(false)}
                  testID="asset-reorder-done"
                />
              ) : (
                <GlassPillButton
                  label={t('asset.addAccount')}
                  icon="add"
                  onPress={() => navigation.navigate(ROUTES.ADD_ASSET)}
                  testID="asset-add-button"
                />
              ))}
          </View>
        </View>


        {/* 分段筛选（稿 02 屏）：全部账户 / 现金 / 银行 / 电子钱包 —— 按 assets.type 过滤，纯展示层 */}
        {hasLedgerAssets && (
          <View style={[styles.filterWrap, { paddingHorizontal: pagePadding }]} testID="asset-filter">
            {/* 5 个筛选项在 390 下硬撑会截成「Bank …」「Credit…」——改成横向可滚、按内容宽度排，标签完整 */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexDirection: 'row', alignItems: 'center' }}
            >
              <SegmentedControl
                options={filterOptions}
                selected={accountFilter}
                onSelect={(v) => setAccountFilter(v as typeof accountFilter)}
                thumb="accent"
              />
            </ScrollView>
          </View>
        )}

        {!hasLedgerAssets ? (
          /* S5 空状态：图标 + 一句话 + 一个按钮（本账本没有账户也用这个空态，不留空白页） */
          <View style={{ paddingHorizontal: pagePadding, marginTop: spacing.xl }}>
            <Card>
              <EmptyState
                icon="wallet-outline"
                title={t('asset.emptyTitle')}
                description={t('asset.emptyHint')}
                actionLabel={t('asset.addAccount')}
                onAction={() => navigation.navigate(ROUTES.ADD_ASSET)}
                testID="asset-empty"
              />
            </Card>
          </View>
        ) : reorderMode ? (
          // ---------- 编辑排列模式：所有币种组共一张玻璃卡，组内各是一个可拖拽列表 ----------
          <View style={[styles.groupsCardWrap, { paddingHorizontal: pagePadding }]}>
            <GlassView radius={26} style={styles.groupsCard}>
              {groupedAssets.map((group, groupIndex) => (
                <View key={group.code}>
                  {groupIndex > 0 && <View style={styles.groupDivider} />}
                  {/* 排序模式不收起，合计与浏览模式一致（一律显示） */}
                  <CurrencySectionHeader
                    code={group.code}
                    total={group.items.reduce((sum, a) => sum + getAssetBalance(a.id), 0)}
                    collapsed={false}
                    onToggle={() => undefined}
                  />
                  <DraggableFlatList
                    data={group.items}
                    scrollEnabled={false}
                    keyExtractor={(item) => item.id}
                    onDragEnd={({ data }) => handleGroupReorder(data)}
                    renderItem={({ item: a, drag, isActive }: RenderItemParams<AssetItem>) => (
                      <ScaleDecorator>
                        <AssetRow
                          color={a.color}
                          icon={a.icon as IconName}
                          title={a.name}
                          // 排序模式：行尾是拖动把手（计划 S5）
                          trailing={
                            <Ionicons name="reorder-three-outline" size={20} color={semantic.textTertiary} />
                          }
                          onLongPress={drag}
                          style={isActive ? styles.draggingRow : undefined}
                          testID={`asset-drag-${a.id}`}
                        />
                      </ScaleDecorator>
                    )}
                  />
                </View>
              ))}
            </GlassView>
          </View>
        ) : activeAssets.length === 0 ? null : (
          // ---------- 浏览模式：所有币种组放进**同一张玻璃卡**（V2.2c），
          // 组之间用卡内小节标题（币种胶囊 + 合计）+ hairline 分隔 ----------
          <View style={[styles.groupsCardWrap, { paddingHorizontal: pagePadding }]}>
            <GlassView radius={26} style={styles.groupsCard}>
              {groupedAssets.map((group, groupIndex) => {
                const isCollapsed = collapsedCurrencies.includes(group.code);
                // 同一币种下所有账户的余额合并成组的合计（信用卡按负数计入，即"欠款"）
                const groupTotal = group.items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
                return (
                  <View key={group.code}>
                    {groupIndex > 0 && <View style={styles.groupDivider} />}
                    <CurrencySectionHeader
                      code={group.code}
                      total={groupTotal}
                      collapsed={isCollapsed}
                      onToggle={() => toggleCurrencyGroup(group.code)}
                      testID={`asset-group-${group.code}`}
                    />
                    {!isCollapsed &&
                      group.items.map((a, index) => (
                        <View key={a.id}>
                          {index > 0 && <View style={styles.groupSeparator} />}
                          {renderAssetRow(a)}
                        </View>
                      ))}
                  </View>
                );
              })}
            </GlassView>
          </View>
        )}

        {/* 已归档账户：折叠分组，行变淡；恢复按钮在行下方 */}
        {!reorderMode && archivedAssets.length > 0 && (
          <View style={[styles.groupsCardWrap, { paddingHorizontal: pagePadding, marginTop: spacing.lg }]}>
            <GlassView radius={26} style={styles.groupsCard}>
              <PressableScale
                onPress={() => setArchivedOpen((v) => !v)}
                activeScale={0.98}
                style={styles.archivedHeader}
                accessibilityRole="button"
                accessibilityState={{ expanded: archivedOpen }}
                testID="asset-archived-toggle"
              >
                <AppText variant="subhead" weight="600" color={semantic.textSecondary}>
                  {t('asset.archived')} · {archivedAssets.length}
                </AppText>
                <Ionicons
                  name={archivedOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={semantic.textTertiary}
                />
              </PressableScale>
              {archivedOpen &&
                archivedAssets.map((a) => (
                  <View key={a.id}>
                    <View style={styles.groupSeparator} />
                    <View style={{ opacity: ARCHIVED_ROW_OPACITY }}>{renderAssetRow(a)}</View>
                    <View style={styles.archivedActionRow}>
                      <PressableScale
                        onPress={() => unarchiveAsset(a.id)}
                        activeScale={0.95}
                        style={[styles.archivedUnarchiveBtn, { borderColor: semantic.hairline }]}
                        accessibilityRole="button"
                        accessibilityLabel={t('asset.unarchive')}
                        testID={`asset-unarchive-${a.id}`}
                      >
                        <AppText variant="footnote" weight="600" color={semantic.accentText}>
                          {t('asset.unarchive')}
                        </AppText>
                      </PressableScale>
                    </View>
                  </View>
                ))}
            </GlassView>
          </View>
        )}
      </ScrollView>

      {/* C1：顶部安全区挡板（玻璃 = 浮空 Tab 栏同款）—— 全出血页面滚起来内容不从状态栏文字下穿过 */}
      <StatusBarGlass />

      {/* S4 账户详情：底部抽屉（替换原来的居中弹窗）；删除走 danger 按钮，"设为默认"是 Switch 行。
          V2.2c：面板改高不透明磨砂（复用 tabBar 填充：夜 .88 / 日 .90），背后是全局 scrim 遮罩；
          标题带上币种（「账户详情 · MYR」）—— 抽屉里的金额因此不再带币种后缀 */}

      <BottomSheet
        visible={!!viewingAssetId}
        onClose={tryCloseDetail}
        title={sheetAsset ? `${t('asset.accountDetail')} · ${sheetAsset.currency}` : t('asset.accountDetail')}
        fill={semantic.homeCard}
        maxHeightRatio={viewKeypadOpen ? 0.92 : 0.9}
        accessibilityLabel={t('asset.accountDetail')}
        testID="asset-detail"
      >
        {sheetAsset && (
          <View style={styles.sheetColumn}>
            <ScrollView
              ref={sheetScrollRef}
              style={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[styles.sheetContent, { paddingHorizontal: layout.card }]}
            >
              {/* 头部 AccountDetailHero（稿 08 屏）：账户名 + 币种 + 大余额。
                  银行卡 / 现金 = 当前余额；信用卡两套口径同屏 —— 大字 = 欠费（原欠款块口径一字未动），
                  副行 = 可用额度（viewingStatement.available）+ 还款日 / 账单日。
                  材质 = 品牌 Hero 渐变（与资产页顶部卡同一套 gradients.hero 令牌，设计稿同款品牌卡）。 */}
              <LinearGradient
                colors={gradients.hero.colors}
                start={gradients.hero.start}
                end={gradients.hero.end}
                style={styles.heroCard}
                testID="asset-detail-hero"
              >
                <View style={styles.heroTopRow}>
                  <AppText
                    variant="headline"
                    weight="600"
                    color={semantic.textInverse}
                    numberOfLines={2}
                    style={styles.heroName}
                    testID="asset-detail-hero-name"
                  >
                    {sheetAsset.name}
                  </AppText>
                  <View style={[styles.heroCodeChip, { backgroundColor: withAlpha(semantic.textInverse, 0.16) }]}>
                    <AppText
                      variant="caption"
                      weight="600"
                      color={semantic.textInverse}
                      testID="asset-detail-hero-currency"
                    >
                      {sheetAsset.currency}
                    </AppText>
                  </View>
                </View>
                <AppText variant="footnote" color={withAlpha(semantic.textInverse, 0.86)} style={styles.heroLabel}>
                  {sheetAsset.type === 'credit' ? t('asset.creditDebt') : t('asset.currentBalance')}
                </AppText>
                <View
                  testID="asset-detail-hero-balance"
                  style={styles.heroAmountSlot}
                  onLayout={(e) => {
                    const w = Math.round(e.nativeEvent.layout.width);
                    setDetailAmountW((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
                  }}
                >
                  {/* 判档宽度 = 卡片内实测宽：320 视口上 12 位余额按 display 40 号约 390px，
                      卡片内只有 256px，不降档就会画到渐变卡外面去 */}
                  <MoneyText
                    value={sheetHeroBalance}
                    variant="display"
                    weight="600"
                    color={semantic.textInverse}
                    availableWidth={detailAmountW || undefined}
                    compactFallback
                  />
                </View>
                {sheetAsset.type === 'credit' && (
                  <>
                    {!!viewingStatement && (
                      <View style={styles.heroMetaItem} testID="asset-detail-available">
                        <AppText variant="caption" color={withAlpha(semantic.textInverse, 0.86)}>
                          {t('asset.availableLimit')}
                        </AppText>
                        <MoneyText
                          value={viewingStatement.available}
                          variant="subhead"
                          weight="600"
                          color={semantic.textInverse}
                        />
                      </View>
                    )}
                    {!!creditDayLine && (
                      <AppText
                        variant="caption"
                        color={withAlpha(semantic.textInverse, 0.86)}
                        style={styles.heroMetaLine}
                      >
                        {creditDayLine}
                      </AppText>
                    )}
                  </>
                )}
              </LinearGradient>

              {/* 三个动作（稿 08 屏）：转账 / 编辑 / 更多 —— flex 三等分，320 视口也不换行、不挤压 */}
              {/* 三等分靠外层 View 的 flex:1（PressableScale 的 Pressable 才是 flex 子项，
                  内层 Animated.View 上的 flex 不参与父容器分配宽度） */}
              <View style={styles.heroActions}>
                <View style={styles.heroActionSlot}>
                  <AccountActionPill
                    icon="swap-horizontal"
                    label={t('asset.actionTransfer')}
                    onPress={handleDetailTransfer}
                    testID="asset-detail-transfer"
                  />
                </View>
                <View style={styles.heroActionSlot}>
                  <AccountActionPill
                    icon="create-outline"
                    label={t('asset.actionEdit')}
                    onPress={handleDetailEdit}
                    testID="asset-detail-edit"
                  />
                </View>
                <View style={styles.heroActionSlot}>
                  <AccountActionPill
                    icon="ellipsis-horizontal"
                    label={t('asset.actionMore')}
                    onPress={() => setMoreOpen((v) => !v)}
                    active={moreOpen}
                    testID="asset-detail-more"
                  />
                </View>
              </View>

              {/* 更多：归档 / 恢复 / 删除 —— 三个既有动作原样保留，只是从面板底部收到这里 */}
              {moreOpen && (
                <View style={styles.moreTray} testID="asset-detail-more-tray">
                  {sheetAsset.archivedAt ? (
                    <Button
                      title={t('asset.unarchive')}
                      variant="secondary"
                      size="sm"
                      onPress={() => {
                        unarchiveAsset(sheetAsset.id);
                        closeDetail();
                      }}
                      testID="asset-detail-unarchive"
                    />
                  ) : assetRecordCount(sheetAsset.id) > 0 ? (
                    <Button
                      title={t('asset.archive')}
                      variant="secondary"
                      size="sm"
                      onPress={() => handleArchive(sheetAsset.id, sheetAsset.name)}
                      testID="asset-detail-archive"
                    />
                  ) : (
                    <Button
                      title={t('asset.deleteAccount')}
                      variant="destructive"
                      size="sm"
                      onPress={() => handleDelete(sheetAsset.id, sheetAsset.name)}
                      testID="asset-detail-delete"
                    />
                  )}
                </View>
              )}

              {/* 分段（稿 08 屏）：交易记录 / 月度统计 / 账户设置 —— 复用 SegmentedControl，外观全走令牌 */}
              <View style={styles.detailSegWrap} testID="asset-detail-segments">
                <SegmentedControl
                  options={detailSegmentOptions}
                  selected={detailTab}
                  onSelect={(v) => {
                    setDetailTab(v as DetailTab);
                    // 自绘键盘只服务「账户设置」里的金额行，切段时收起来
                    if (v !== 'settings') setViewKeypadOpen(false);
                  }}
                  stretch
                  thumb="accent"
                />
              </View>

              {detailTab === 'tx' && (
                <View style={styles.sheetSection} testID="asset-detail-seg-tx">
                  {/* 该账户的流水（缺口补齐）：抽屉里直接可查，不必回首页筛账户；
                      行规格 = ui/TransactionRow（图标块 + 类别·时间 + 右侧金额） */}
                  <AccountTransactionList
                    transactions={accountTransactions}
                    categories={categories}
                    hideHeader
                    testID="asset-detail-transactions"
                  />
                </View>
              )}

              {detailTab === 'monthly' && (
                <View style={styles.sheetSection} testID="asset-detail-seg-monthly">
                  {sheetAsset.type === 'credit' ? (
                    !viewingStatement ? (
                      <AppText variant="footnote" color={semantic.textTertiary} style={styles.sheetNote}>
                        {t('asset.noStatement')}
                      </AppText>
                    ) : (
                      <View style={styles.sheetList}>
                        <SheetInfoRow
                          label={t('asset.availableLimit')}
                          value={<MoneyText value={viewingStatement.available} variant="subhead" weight="600" />}
                          separator
                        />
                        <SheetInfoRow
                          label={t('asset.currentSpend')}
                          value={<MoneyText value={viewingStatement.currentCycleSpend} variant="subhead" weight="600" />}
                          separator
                        />
                        <SheetInfoRow
                          label={t('asset.lastStatement')}
                          value={
                            <MoneyText
                              value={viewingStatement.lastStatementAmount}
                              variant="subhead"
                              weight="600"
                            />
                          }
                          separator={viewingStatement.isOverdue && viewingStatement.estimatedInterest > 0}
                        />
                        {viewingStatement.isOverdue && viewingStatement.estimatedInterest > 0 && (
                          <SheetInfoRow
                            label={t('asset.estInterest')}
                            value={
                              <MoneyText
                                value={viewingStatement.estimatedInterest}
                                variant="subhead"
                                kind="expense"
                                weight="600"
                              />
                            }
                          />
                        )}
                      </View>
                    )
                  ) : (
                    viewingFlowStats && (
                      <View style={styles.sheetList}>
                        <SheetInfoRow
                          label={t('asset.inflow')}
                          value={<MoneyText value={viewingFlowStats.inflowAmount} variant="subhead" kind="income" weight="600" />}
                          caption={t('asset.inflowCount', { count: viewingFlowStats.inflowCount })}
                          separator
                        />
                        <SheetInfoRow
                          label={t('asset.outflow')}
                          value={<MoneyText value={viewingFlowStats.outflowAmount} variant="subhead" kind="expense" weight="600" />}
                          caption={t('asset.inflowCount', { count: viewingFlowStats.outflowCount })}
                          separator
                        />
                        <SheetInfoRow
                          label={t('asset.netChange')}
                          value={
                            <MoneyText
                              value={viewingFlowStats.inflowAmount - viewingFlowStats.outflowAmount}
                              variant="subhead"
                              weight="600"
                            />
                          }
                        />
                      </View>
                    )
                  )}
                </View>
              )}

              {detailTab === 'settings' && (
                <View testID="asset-detail-seg-settings">
                  {/* 名称：内联可改（为空时描边转 danger，"保存"变灰）；小标签在框上方、左边与框内文字对齐 */}
                  <View
                    onLayout={(e) => {
                      nameBlockYRef.current = e.nativeEvent.layout.y;
                    }}
                  >
                    <AppText variant="footnote" color={semantic.textSecondary} style={styles.fieldLabelInline}>
                      {t('addTx.accountName')}
                    </AppText>
                    <TextInput
                      ref={viewNameInputRef}
                      style={[
                        styles.nameInput,
                        { backgroundColor: semantic.bg, borderColor: semantic.hairline, color: semantic.textPrimary },
                        !viewName.trim() && { borderColor: semantic.danger },
                      ]}
                      value={viewName}
                      onChangeText={setViewName}
                      onFocus={() => {
                        nameFocusedRef.current = true;
                      }}
                      onBlur={() => {
                        nameFocusedRef.current = false;
                      }}
                      placeholder={t('addTx.accountNamePlaceholder')}
                      placeholderTextColor={semantic.textTertiary}
                      selectionColor={semantic.accent}
                      returnKeyType="done"
                      testID="asset-detail-name"
                    />
                  </View>

                  {/* 可编辑金额行（信用卡 = 信用额度，其余 = 当前余额）—— 胶囊框 + 框上小标签；
                      点整格调起计算器键盘，长按拖动可把光标放到任意字符处 */}
                  <AppText variant="footnote" color={semantic.textSecondary} style={styles.fieldLabelInline}>
                    {sheetAsset.type === 'credit' ? t('addTx.creditLimitLabel') : t('asset.currentBalance')}
                  </AppText>
                  <View {...amountCursorPan.panHandlers}>
                    <PressableScale
                      style={[styles.amountBox, { backgroundColor: semantic.bg, borderColor: semantic.hairline }]}
                      activeScale={0.98}
                      {...amountBoxPressProps}
                      accessibilityRole="button"
                      accessibilityLabel={
                        sheetAsset.type === 'credit' ? t('addTx.creditLimitLabel') : t('asset.currentBalance')
                      }
                      testID="asset-detail-amount"
                    >
                      <View style={styles.amountValueRow}>
                        {viewKeypadOpen ? (
                          <Text
                            ref={amountTextRef}
                            onLayout={refreshAmountTextBox}
                            style={[styles.amountText, { color: semantic.textPrimary }]}
                          >
                            <Text style={styles.amountText}>{viewDisplayRef.current.slice(0, viewCursorIdx)}</Text>
                            <BlinkingCursor style={[styles.amountText, { color: semantic.accentText }]} />
                            <Text style={styles.amountText}>{viewDisplayRef.current.slice(viewCursorIdx)}</Text>
                          </Text>
                        ) : (
                          <MoneyText value={parseFloat(viewBalanceStr) || 0} variant="title3" weight="600" />
                        )}
                      </View>
                      <Ionicons name="pencil" size={16} color={semantic.accentText} />
                    </PressableScale>
                  </View>

                  {/* 设为默认账户：Switch 行（随"保存"一并提交） */}
                  <View style={styles.sheetList}>
                    <ListRow
                      title={t('asset.setDefaultRow')}
                      trailing={
                        <Switch
                          value={viewSetDefault}
                          onValueChange={setViewSetDefault}
                          accessibilityLabel={t('asset.setDefaultRow')}
                        />
                      }
                    />
                  </View>

                  <Button
                    title={t('common.save')}
                    variant="gradient"
                    onPress={() => saveViewChanges()}
                    disabled={!viewName.trim()}
                    style={styles.sheetButton}
                    testID="asset-detail-save"
                  />
                </View>
              )}

              {/* 键盘高度的底部垫片：让滚动区能把名称框滚到键盘上方 */}
              {sheetKbHeight > 0 && <View style={{ height: sheetKbHeight }} />}
            </ScrollView>

            {/* 计算器键盘：抽屉内全宽呈现；「完成」＝求值并直接保存（与"保存"按钮同一效果） */}
            {viewKeypadOpen && (
              <View
                style={[
                  styles.keypadFooter,
                  { borderTopColor: semantic.hairline, paddingBottom: Math.max(bottomInset, spacing.lg) },
                ]}
              >
                <AmountCalculatorKeypad
                  onPressKey={handleViewKeyPress}
                  onPressToday={() => {}}
                  onClear={() => {
                    balanceExpr.reset(0);
                    setViewBalanceCursor(0);
                  }}
                  onConfirm={handleViewKeypadConfirm}
                />
              </View>
            )}
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距；几何常量只留纯图形尺寸） */
function makeStyles(
  semantic: SemanticColors,
  typography: Typography,
  spacing: Spacing,
  radius: Radius,
  layout: Layout
) {
  return StyleSheet.create({
    container: { flex: 1 },
    // 页头：大标题与右侧动作垂直居中对齐（同一行，动作跟着大标题中线走）；
    // 放不下时动作整块掉到第二行（UI_RULES 第 6 节 ②）
    headerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.md,
      rowGap: spacing.xs,
    },
    headerTitle: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    // 大标题（渐变上的白字）：稿为 30 / 600（token title1 是 28/700，字号按稿覆盖）
    heroTitle: { fontSize: 30, lineHeight: 36 },
    // 总资产卡（稿 02 屏）：20 圆角渐变卡，16 内衬，左边标签行、下方金额与变化行
    totalCard: {
      borderRadius: radius.lg,
      padding: layout.card,
      rowGap: spacing.sm,
    },
    totalCardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
    },
    totalCardHeadActions: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
    // 卡内大金额槽：吃满卡内宽（宽度与金额字号无关 → 不会和 MoneyText 的降档互相追成反馈环）
    totalAmountSlot: { alignSelf: 'stretch' },
    // 卡上的币种胶囊（与首页净资产卡的币种胶囊同规格：12.5/17 + 600；宽了就让文字先收，不挤压眼睛按钮）
    cardPillHit: { flexDirection: 'row', alignItems: 'center', columnGap: 4, flexShrink: 1, minWidth: 0 },
    cardPillText: { fontSize: 12.5, lineHeight: 17, flexShrink: 1 },
    // 币种抽屉：行 = 币种胶囊 + 右侧该币种合计（选中行 accentSoft 底，与首页币种抽屉同一套令牌）
    currencySheetScroll: { flexShrink: 1 },
    currencyOption: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.sm,
      minHeight: 52,
      paddingHorizontal: layout.card,
      borderRadius: radius.md,
      // 金额靠右：中间留白吃掉剩余宽度
      justifyContent: 'flex-start',
    },
    currencyOptionAmount: { marginLeft: 'auto' },
    currencyOptionCode: {
      height: 24,
      minWidth: 44,
      paddingHorizontal: 9,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: semantic.accentSoft,
    },
    // 分段筛选与总资产卡之间 12、与列表之间 24
    filterWrap: { marginTop: spacing.md },
    // V2.2c：所有币种组共用一张玻璃卡（卡内小节头 + hairline 分组），卡与页头之间 24
    groupsCardWrap: { marginTop: 24 },
    // overflow hidden：行 / 小节头的 hairline 与按压高光不越出 26 圆角
    groupsCard: { overflow: 'hidden' },
    archivedHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
    },
    archivedActionRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: layout.card,
      paddingBottom: spacing.sm,
    },
    archivedUnarchiveBtn: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 组与组之间的分组线：左右各缩进卡内衬 16（行内分割线则是 70 左缩进，见下）
    groupDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: semantic.hairline,
      marginHorizontal: layout.card,
    },
    // 分组卡内的行间分割线：左缩进 = 图标 42 + 间距 12 + 卡内衬 16 = 70（与稿一致，右侧通到卡边）
    groupSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: semantic.hairline,
      marginLeft: 70,
    },
    draggingRow: { opacity: 0.85 },
    // ---------- 详情抽屉 ----------
    sheetColumn: { flexShrink: 1 },
    sheetScroll: { flexShrink: 1 },
    sheetContent: { paddingBottom: spacing.md },
    // 头部 AccountDetailHero：品牌渐变卡（20 圆角 / 卡内衬 16）——名称与币种胶囊一行，大余额在下
    heroCard: { borderRadius: radius.lg, padding: layout.card, rowGap: spacing.xs },
    heroTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
    },
    // 长账户名先收窄（最多两行：320 视口上一行只会剩「银……」），币种胶囊不被挤出卡外
    heroName: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
    // 详情卡大金额槽：吃满卡内宽（判档宽度来源，同上）
    heroAmountSlot: { alignSelf: 'stretch' },
    heroCodeChip: {
      height: 22,
      minWidth: 44,
      paddingHorizontal: 9,
      borderRadius: radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroLabel: { marginTop: spacing.sm },
    // 信用卡副行：可用额度（标签 + 金额一行），还款日 / 账单日另起一行
    heroMetaItem: { flexDirection: 'row', alignItems: 'baseline', columnGap: spacing.xs },
    heroMetaLine: { marginTop: spacing.xs },
    // 三个动作：等宽三等分（每格 slot flex:1），间距 spacing.sm；320 视口由 flex 平摊，不换行
    heroActions: { flexDirection: 'row', columnGap: spacing.sm, marginTop: spacing.md },
    // 宽度三等分落在 slot 上：PressableScale 的 Pressable 才是 flex 子项
    heroActionSlot: { flex: 1, minWidth: 0 },
    // 「更多」托盘：归档 / 恢复 / 删除三个既有动作
    moreTray: { marginTop: spacing.sm, rowGap: spacing.sm },
    // 分段与头部动作区之间 16
    detailSegWrap: { marginTop: spacing.lg },
    // V2.2c B3：小标签在输入框上方，左边与框内文字对齐（内缩 = 输入框 paddingHorizontal）
    fieldLabelInline: { marginTop: spacing.lg, marginBottom: spacing.xs, marginLeft: spacing.lg },
    nameInput: {
      minHeight: 44,
      // 胶囊框（V2.2c）：与 radius.full 一致的圆角，不用矩形输入框
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      fontSize: typography.body.fontSize,
      lineHeight: typography.body.lineHeight,
    },
    amountBox: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
      rowGap: spacing.xs,
      minHeight: 44,
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    amountValueRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      flexShrink: 1,
      columnGap: spacing.xs,
    },
    amountText: {
      fontSize: typography.title3.fontSize,
      lineHeight: typography.title3.lineHeight,
      fontWeight: typography.title3.fontWeight,
      includeFontPadding: false,
      fontVariant: ['tabular-nums'],
    },
    sheetList: { marginTop: spacing.sm },
    sheetSection: { marginTop: spacing.lg },
    sheetNote: { marginTop: spacing.lg, paddingHorizontal: spacing.sm },
    sheetButton: { marginTop: spacing.md },
    keypadFooter: {
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
  });
}
