import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SectionList, Modal, TextInput, Platform, Keyboard, InteractionManager, useWindowDimensions } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, TextStyle, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useFocusEffect } from '@react-navigation/native';
import Reanimated, { useSharedValue, useAnimatedStyle, useDerivedValue, withTiming, withSpring, withSequence, cancelAnimation, runOnJS, runOnUI, useAnimatedReaction, Easing } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { HeroRollMoney } from '../components/ui/ColdStartMotion';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useApp } from '../context/AppContext';
import { CURRENCY_OPTIONS, getEnglishCurrencyName } from '../utils/currencies';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import { useLanguage } from '../i18n/LanguageContext';
import type { LangMode } from '../i18n';
import { useTheme } from '../theme/useTheme';
import type { HomePalette } from '../theme/homePalette';
import { useHomePalette } from '../theme/homePalette';
import { useThemeMode } from '../context/ThemeModeContext';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler, useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors, Elevation, Layout, Radius, SemanticColors, Spacing, layout as pageLayout } from '../theme/theme';
import { formatMoney as fmtMoney, HIDDEN_AMOUNT } from '../utils/formatMoney';
import { formatBudgetPct } from '../utils/budgetPct';
import { formatDate } from '../utils/formatDate';
import type { Ledger, Transaction } from '../types';
import { UNCATEGORIZED_ICON, UNCATEGORIZED_NAME, UNCATEGORIZED_COLOR } from '../constants/uncategorized';
import PressableScale from '../components/PressableScale';
import { AppText, BottomSheet, Button, EmptyState, GlassView, HeroGradient, IconButton, IconCircle, ListSection, MoneyText, StatusBarGlass } from '../components/ui';
import { MonthlyBudgetSheet } from '../components/MonthlyBudgetSheet';
import { TransactionSearchSheet, type SearchRow } from '../components/TransactionSearchSheet';
import { withAlpha } from '../components/ui/color';
import { FolderAssetCard } from '../components/home/FolderAssetCard';
import { HomeHeroBackdrop } from '../components/home/HomeHeroBackdrop';
import { AccountChip, RoundIconButton } from '../components/home/HomeHeaderControls';
import { QuickActions } from '../components/home/QuickActions';
import type { QuickActionKey } from '../components/home/QuickActions';
import { IconChevronDown, IconChevronRight, IconEye, IconEyeOff } from '../components/home/HomeIcons';
// HeroMetalSheen / AuroraFlowShader 文件与色 token 原样保留（可恢复）；V2 定稿里没有
// 紫色金属卡与流光，所以这里不再 import —— 陀螺仪（useHeroSheen）也就不会启动，省电。
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { useAmountExpression } from '../hooks/useAmountExpression';
import PinSheet from '../components/PinSheet';
import MonthCalendarCard, { CalendarDayTotals } from '../components/MonthCalendarCard';
import type { SegKey } from '../components/MonthCalendarCard';
import { useAppLock } from '../context/AppLockContext';
import { useDialog } from '../components/AppDialog';
import { ROUTES } from '../navigation/routes';
import { hapticLight, hapticSuccess } from '../utils/haptics';

// 首页三张卡片的入场：240ms、60ms 间隔的 stagger（30-80ms 区间内）。
// 构建器放模块作用域——写在 JSX 里会在每次渲染时重建。
// 不传自定义 easing：FadeInDown 的默认曲线就是 ease-out 族，且原生/web 都支持
// （自定义贝塞尔在布局动画里原生端会报 invalid、web 端被降级成 linear）。

/** 账本图标兜底色（旧数据无 color 时显示蓝，与 addLedger / 默认账本一致） */
const DEFAULT_LEDGER_COLOR = '#4C9AFF';
/** 从记一笔返回后，新增行「闪一下」的时长（T09 / H8：500ms 淡紫底） */
const FLASH_ROW_MS = 500;

// ── UI V2 首页版型常量（数值取自 .zcode/design/mockups/G_HomeDark|Light.dc.html 的内联样式）──
/** Hero 净资产整数段字号（V2 稿：58 / 500；RM 24 / 小数 28 由 MoneyText 按比例派生） */
const HERO_AMOUNT_SIZE = 43;
/** 大金额行盒高（V2 稿 line-height 64；隐藏态的 •••••• 也用它，显隐切换时行高不跳） */
const HERO_AMOUNT_LINE = 64;
/** Hero 金额行的最小行盒高（= MoneyText hero 行高比 1.103 × 40 取整）：降档时行高不再变，页面高度恒定 */
const HERO_AMOUNT_MIN_H = 47;
/** 预算槽定高（页内第二行）：标签 20 + 明细 16 + 间距 4 + 条 6 = 46，已设 / 未设两态等高 */
const HERO_BUDGET_SLOT_H = 46;
/** 金额行的「眼睛」占位宽（眼睛 36 + 间距 10，V2 稿 1:1）：金额盒子的宽度上限 = 行宽 − 它 */
const HERO_EYE_RESERVE = 46;
/** 金额行与眼睛的间距（V2 稿 10；比 spacing.sm 大 2，按稿 1:1） */
const HERO_EYE_GAP = 10;
/** 「最近交易」统一面板的圆角 = radius.lg（不再单独开一档，与 MonthSummary 同一张卡） */
const LIST_CARD_RADIUS = 20;
/** 交易行分类图标圆底直径 / 圈内图标尺寸（参考图 38 / 18） */
const TX_ICON_SIZE = 38;
const TX_ICON_GLYPH = 18;
/** 金额列固定宽度：右对齐 + 定宽，金额长短变化时列宽不跳动（tabular-nums 对齐） */
const TX_AMOUNT_COL_WIDTH = 92;
/** 面板描边宽度（1px 描边，不用 shadow 撑轮廓） */
const PANEL_BORDER = 1;
/** 顶部柔和光场：只铺顶部这段高度（dp）—— 光场本身在到达下边缘前就淡到 0，不靠高度裁切 */
const TOP_GLOW_HEIGHT = 420;
/** 光场整体透明度：交给渐变自身的 alpha 表达强度，外层不再二次衰减（否则顶部永远偏白） */
const TOP_GLOW_OPACITY = 1;
// ── 币种分页（手势）：一次滑动只翻相邻的一页，不管甩得多快 ──
/** 位移超过页宽的这个比例 → 翻一页（3%，很灵敏） */
const PAGER_DIST_FRAC = 0.03;
/** 沿滑动方向的速度超过它 → 翻一页（px/s） */
const PAGER_FLICK_V = 80;
/** 翻页 / 回弹动画：300ms 缓出，无回弹（只有两端有橡皮筋） */
const PAGER_SETTLE_MS = 300;
const PAGER_SETTLE_EASE = Easing.bezier(0.22, 1, 0.36, 1);
/** 与 Gesture.Pan().activeOffsetX 一致：激活时的 4px 要扣掉，否则第一帧会跳 4px（手指从按下起就带着条走，没有死区也没有跳变） */
const PAGER_ACTIVATE_OFFSET = 4;
/** 停稳在某一页多久（毫秒）才提交币种并把真列表接回：期间可以继续连续翻页，不被任何东西挡住 */
const PAGER_COMMIT_DEBOUNCE_MS = 150;
/** 真列表被「冻结」时的位移（挪到屏幕外；邻页预览顶上） */
const LIST_OFFSCREEN_X = 100000;
// 账单卡左右外边距 = 页面边距令牌 layout.page（与预算卡同一条左右边线；QA 发现 12 与预算卡错位）
const LIST_CARD_MARGIN = pageLayout.page;
/** 行间分割线左缩进（V2 稿 70 = 行内边距 16 + 图标圆 42 + 行间距 12，正好与文字左缘对齐） */
const TX_SEP_INSET = 70;
/** 列表卡上下露出的卡边（V2 稿 4px） */
const LIST_CARD_EDGE = 4;

type IconName = keyof typeof Ionicons.glyphMap;

/** 账单 SectionList 的一组（T09 / H6）：data = 该日账单行（SectionList 认这个键），
 *  label = formatDate 的日期头、dateSub = 今天/昨天时补在后面的「10月10日 周六」、
 *  monthSep = 跨月时插的月份分隔、expense/income = 当日合计 */
type TxDaySection = {
  date: string;
  label: string;
  dateSub: string | null;
  /** 只到「月日」的日期（「10月19日」）：设计稿 01 屏分组条左段 = 日期 · 相对词 */
  monthDay: string;
  monthSep: string | null;
  expense: number;
  income: number;
  currency: string;
  items: Transaction[];
  data: Transaction[];
  /** 首组：日期头承担列表卡的 26 上圆角 */
  isFirst: boolean;
  /** 末组：组内最后一行承担列表卡的 26 下圆角 */
  isLast: boolean;
};

function monthKeyOf(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 账本创建时间戳 → 'YYYY-MM-DD'（本地时区；账本行的日期展示用） */
function formatDateTs(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 账本抽屉的单行（T10 / H11，UI V2 换圆图标）──
// 结构：42 圆图标（IconCircle）+ 中间列（名称 +（默认那本）小胶囊徽标 / 分币种结余 / 创建于）+ 右侧「设为默认 / 铅笔改名 / 垃圾桶删除」。
// ⚠ 改名与删除两个 IconButton 必须放在可点主区 **外面**（同级的动作列）：主区是 Pressable
//   （Web 上是 <button>），按钮放进去会变成 button 套 button（读屏重复 + 控制台 hydration 报错，
//   此前日历药丸踩过一次）。动作列固定宽 88（两个 44 触控区），各行铅笔左缘对齐；
//   中间列 minWidth 0 —— 长名字 / 长余额从这一列压缩，任何元素的右边界都不会越过 344（360 宽屏）。
// ⚠ 删除键对**每一本**账本都渲染（含默认那本）：默认只是一枚身份徽标，不是删除的例外。
type LedgerRowProps = {
  ledger: Ledger;
  active: boolean;
  /** 是否是当前默认账本（只影响徽标与「设为默认」动作，不影响可删性） */
  isDefault: boolean;
  /** 该账本的分币种结余（[币种代码, 金额]） */
  totals: [string, number][];
  renaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<TextInput | null>;
  onRenameValueChange: (v: string) => void;
  onCommitRename: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  /** 设为默认账本（已是默认时这一行不渲染该动作） */
  onSetDefault: () => void;
  onSelect: () => void;
};

function LedgerRow({
  ledger,
  active,
  isDefault,
  totals,
  renaming,
  renameValue,
  renameInputRef,
  onRenameValueChange,
  onCommitRename,
  onStartRename,
  onDelete,
  onSetDefault,
  onSelect,
}: LedgerRowProps) {
  const { semantic, spacing, layout } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  const baseColor = ledger.color ?? DEFAULT_LEDGER_COLOR;
  const styles2 = useMemo(() => makeLedgerRowStyles(semantic, spacing, layout), [semantic, spacing, layout]);

  // 改名态：这一行换成行内输入（与旧交互一致：点铅笔 → 名字变输入框，失焦 / 回车提交）
  if (renaming) {
    return (
      <View style={styles2.renameRow}>
        <TextInput
          ref={renameInputRef}
          style={[
            styles2.renameInput,
            { color: semantic.textPrimary, borderColor: semantic.accent, backgroundColor: semantic.bg },
          ]}
          value={renameValue}
          onChangeText={onRenameValueChange}
          onBlur={onCommitRename}
          onSubmitEditing={onCommitRename}
          selectTextOnFocus
          returnKeyType="done"
          autoFocus
          accessibilityLabel={t('home.editLedger')}
        />
        <Button title={t('common.save')} size="sm" fullWidth={false} onPress={onCommitRename} />
      </View>
    );
  }

  return (
    <View style={[styles2.row, active && { backgroundColor: semantic.accentSoft }]}>
      {/* 主区（整块可点 = 切换账本）：左 42 圆图标 + 中间三行（名称 / 余额 / 预设或创建于）。
          ⚠ 外层 mainWrap 才是被 flex 约束的那一层：PressableScale 的 style 落**内层** Animated.View 上，
            直接给它 flex:1 不会让外层 Pressable 收窄 —— 长账本名会把动作列顶出 344（360 宽屏自检抓到过）。
            做成「有界外层 + 内层铺满」后：中间列 minWidth 0 先压缩文字，动作列永远贴在 344 以内 */}
      <View style={styles2.mainWrap}>
        <PressableScale
          onPress={onSelect}
          activeScale={0.98}
          hitSlop={0}
          style={styles2.main}
          accessibilityRole="button"
          accessibilityLabel={active ? `${ledger.name}，${t('home.selected')}` : ledger.name}
          testID={`ledger-row-${ledger.id}`}
        >
          {/* 账本图标：42 圆（V2：列表图标一律圆形；底色/图标色由 IconCircle 从账本色派生） */}
          <IconCircle color={baseColor} icon={ledger.icon as IconName} />
          <View style={styles2.col}>
            {/* 名称行：名称 + （默认账本才有）右侧小胶囊徽标。
                ⚠ 名称 flexShrink 1 + minWidth 0：长名字先在这一行收（≤2 行），徽标 flexShrink 0
                  永远留在卡片内，不会被名字顶出去（与下面余额列同一套「先压中间」的规矩）。 */}
            <View style={styles2.nameRow}>
              <AppText variant="headline" numberOfLines={2} style={styles2.nameText}>
                {ledger.name}
              </AppText>
              {isDefault && (
                <View style={styles2.defaultBadge}>
                  <AppText variant="caption2" numberOfLines={1} color={semantic.textPrimary}>
                    {t('home.defaultLedger')}
                  </AppText>
                </View>
              )}
            </View>
            {totals.length === 0 ? (
              <AppText variant="subhead" color={semantic.textSecondary}>
                {t('home.noAssets')}
              </AppText>
            ) : (
              totals.slice(0, 3).map(([code, amount]) => (
                // 抽屉是「看不出是什么钱」的地方 → 带币种代码（计划 4.4）；金额走 MoneyText（flexShrink 1：
                // 长余额在窄屏/长币种下压缩换紧凑格式，绝不把右侧动作列挤出 344）
                <View key={code} style={styles2.balanceLine}>
                  <AppText variant="subhead" color={semantic.textSecondary}>
                    {code}
                  </AppText>
                  <MoneyText value={amount} variant="subhead" color={semantic.textPrimary} style={styles2.balanceAmount} />
                </View>
              ))
            )}
            {totals.length > 3 && (
              <AppText variant="caption" color={semantic.textTertiary} numberOfLines={1}>
                {'+'}
                {totals.length - 3}
              </AppText>
            )}
            {/* 副标题只剩「创建于」：默认身份已经上移到名称旁的胶囊，不再与 +N 挤成两小行 */}
            {!isDefault && (
              <AppText variant="caption" color={semantic.textSecondary} numberOfLines={1}>
                {t('home.createdOn', { date: ledgerCreatedLabel(ledger.createdAt, langMode) })}
              </AppText>
            )}
          </View>
        </PressableScale>
      </View>
      {/* 动作列放在可点区之外（整行是 button，按钮放进去会 button 套 button）。
          固定宽 132（三个 44 触控区）：设为默认 / 重命名 / 删除。三格常驻（默认那本的第一格
          留空占位），各行铅笔与垃圾桶左缘永远对齐，不会因为身份变化而左右跳。
          删除键对每一本账本都渲染——身份由副标题徽标说明，而不是靠藏掉删除键 */}
      <View style={styles2.actions}>
        {isDefault ? (
          <View style={styles2.actionSlot} />
        ) : (
          <IconButton
            icon="star-outline"
            size={20}
            color={semantic.textSecondary}
            accessibilityLabel={t('home.setDefaultLedger')}
            onPress={onSetDefault}
            testID={`ledger-setdefault-${ledger.id}`}
          />
        )}
        <IconButton
          icon="pencil"
          size={20}
          color={semantic.textSecondary}
          accessibilityLabel={t('home.editLedger')}
          onPress={onStartRename}
          testID={`ledger-rename-${ledger.id}`}
        />
        <IconButton
          icon="trash-outline"
          size={20}
          color={semantic.danger}
          accessibilityLabel={t('home.deleteLedger')}
          onPress={onDelete}
          testID={`ledger-delete-${ledger.id}`}
        />
      </View>
    </View>
  );

}

/** 账本抽屉单行的样式（令牌进、StyleSheet 出；LedgerRow 自己 useMemo 一份）。
 *  规格与 ui/ListRow 同族（minHeight / 内边距 / 按压），中间列多一行（预设·创建于），
 *  图标托换成 V2 的 42 圆（ui/IconCircle）—— 行内没有第二种画风。 */
function makeLedgerRowStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout) {
  return StyleSheet.create({
    // 一行 = 可点主区 + 动作列；选中底色铺满整行
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: layout.rowMinHeight,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.sm,
    },
    // 被 flex 约束的外层：flex 1 + minWidth 0（内层 Pressable 铺满它，见 JSX 注释）
    mainWrap: { flex: 1, minWidth: 0 },
    main: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
    },
    // 中间列：名称（≤2 行）→ 余额（逐币种一行）→ 创建于。
    // minWidth 0：长名字 / 长余额先压缩这一列，绝不把右侧动作列挤出屏
    col: { flex: 1, minWidth: 0, rowGap: 2 },
    // 名称行 = 名称 + 默认徽标（横向）。名称先收（flexShrink 1 + minWidth 0），徽标不收（默认 flexShrink 0）
    nameRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs },
    nameText: { flexShrink: 1, minWidth: 0 },
    // 默认账本身份徽标：小胶囊。底色 accentSoft + 描边 accent —— 选中行的行底本身就是 accentSoft，
    // 只有加一圈 accent 描边才能让「深色/浅色 × 选中/未选中」四种组合下都还看得出这是个胶囊。
    // 字色 textPrimary（11pt 的 accentText 落在淡蓝底上不足 4.5:1；品牌色由描边承担）
    defaultBadge: {
      flexShrink: 0,
      // minHeight + paddingVertical 而不是死高 20：caption2 的 lineHeight 日间 13 / 中文模式 15，
      // 再叠加 maxFontSizeMultiplier 1.3 也不会被裁字，视觉高度仍是 18~19
      minHeight: 18,
      paddingVertical: 2,
      paddingHorizontal: 7,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: semantic.accent,
      backgroundColor: semantic.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    balanceLine: { flexDirection: 'row', alignItems: 'baseline', columnGap: spacing.xs },
    // 余额数字可压缩（放不下自动换紧凑格式），保证行右缘 ≤ 页面边距内的 344
    // minWidth 0：账本抽屉里「分币种结余」与币种代码同一行，长金额要能真的收
    balanceAmount: { flexShrink: 1, minWidth: 0 },
    // 动作列：设为默认 + 铅笔 + 垃圾桶（各 44 触控区），固定宽 132 保证各行按钮左缘对齐；
    // 默认那本不显示「设为默认」，用同宽空槽占位而不是省掉一格
    actions: {
      width: 132,
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 0,
    },
    actionSlot: { width: 44, height: 44 },
    // 改名态：行内输入 + 保存按钮（与旧交互一致：失焦 / 回车提交）
    renameRow: {
      minHeight: layout.rowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.sm,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.sm,
    },
    renameInput: {
      flex: 1,
      flexShrink: 1,
      minHeight: 40,
      fontSize: 15,
      fontWeight: '600',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
      borderRadius: 10,
    },
  });
}

/** 账本创建时间：今年的只写月日（10月8日 周四），跨年带上年份（2025年10月8日 周三）——
 *  两种都走 formatDate 的既有档位，不自己拼字符串 */
function ledgerCreatedLabel(createdAt: number, lang: LangMode): string {
  const d = new Date(createdAt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return formatDate(d, lang, { style: sameYear ? 'full' : 'fullWithYear' });
}

/** 账单行的 key：交易 id（稳定函数，放模块作用域避免每次渲染换身份） */
function txKeyExtractor(item: Transaction) {
  return item.id;
}

// 切币种列表过渡：旧列表淡出 140ms → 换数据（先在透明状态下完成布局）→ 下一帧起 420ms 缓出上升（无错峰）
const LIST_FADE_MS = 140;
const LIST_RISE_MS = 420;
const LIST_RISE_LIFT = 28;
const LIST_RISE_EASE = Easing.bezier(0.22, 1, 0.36, 1);
// 日历抽屉打开时列表下沉 / 变淡的幅度（C3 使用）
// 离场的那一层（日历或列表）下沉 36 并完全淡出（opacity 精确到 0）
const CAL_LIST_LIFT = 36;
// 日历底部弹层：进入 420ms 缓出（快起慢落）；退出 280ms 加速离场；遮罩 = 0.25 × 进度（× 遮罩色自带透明度）
const CAL_ENTER_MS = 420;
const CAL_EXIT_MS = 260;
const CAL_ENTER_EASE = Easing.bezier(0.22, 1, 0.36, 1);
const CAL_EXIT_EASE = Easing.bezier(0.5, 0, 0.75, 0);
const CAL_LIFT_MAX = 480;
const CAL_DIM_MAX = 0.25;
// 开发期日历切换计时（只在 __DEV__ 打印；发布包里 devCalLog 是空操作）
const devCal = { tapAt: 0 };
function devCalLog(label: string) {
  if (!__DEV__) return;
  console.log(`[cal] ${label} (+${(performance.now() - devCal.tapAt).toFixed(0)}ms since tap)`);
}

/** 列表格子统一的过渡包装：淡出 × 上升 × 日历下沉。所有格子共用同一份计算，没有逐行错峰。
 *  纯 UI 线程 useAnimatedStyle，不用 entering / exiting 属性（Fabric 下会 addViewAt 崩） */
function ListFx({ outP, rise, listY, listO, shiftX, children }: { outP: SharedValue<number>; rise: SharedValue<number>; listY: SharedValue<number>; listO: SharedValue<number>; shiftX: SharedValue<number>; children: React.ReactNode }) {
  const style = useAnimatedStyle(() => {
    const r = rise.value;
    return {
      // listO / listY = 列表这一层（整体）的进出场：进场从下方升上来 + 0.6→1，离场下沉 36 + 淡到 0
      opacity: listO.value * outP.value * r,
      // shiftX = 币种横滑时账单列表跟着 hero 横移的距离（不横滑时恒为 0）
      transform: [{ translateX: shiftX.value }, { translateY: (1 - r) * LIST_RISE_LIFT + listY.value }],
    };
  });
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
}

/** 净资产胶囊里的一个币种文字：按「当前页距离」淡入淡出，纯 UI 线程（拖动中不 setState） */
const PILL_LABEL_LAYER = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center' as const, justifyContent: 'center' as const };
function PillStackLabel({ index, pos, text, color, textStyle }: { index: number; pos: SharedValue<number>; text: string; color: string; textStyle: TextStyle }) {
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, 1 - Math.abs(pos.value - index) * 2)) }));
  return (
    <Reanimated.View style={[PILL_LABEL_LAYER, style]} pointerEvents="none">
      <AppText variant="caption" weight="600" color={color} style={textStyle} numberOfLines={1} ellipsizeMode="clip">
        {text}
      </AppText>
    </Reanimated.View>
  );
}

/** 页指示点：宽度与透明度按「当前页距离」插值（当前 14 宽、其余 5 宽），纯 UI 线程 */
// 分页点几何（按 V2 包）：底点 5 / 选中 11，每个点自带 16 宽的命中盒，点间距 0、贴着卡底
const dotStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', marginTop: 2 },
  hit: { marginHorizontal: 2.5 },
});

function HeroDotFx({ index, pos, color, testID }: { index: number; pos: SharedValue<number>; color: string; testID?: string }) {
  const style = useAnimatedStyle(() => {
    const k = Math.max(0, 1 - Math.abs(pos.value - index));
    return { width: 5 + 6 * k, opacity: 0.45 + 0.55 * k };
  });
  return (
    <Reanimated.View
      testID={testID}
      style={[{ height: 5, borderRadius: 3, backgroundColor: color }, dotStyles.hit, style]}
    />
  );
}

// 行间发丝分割线（T09 / H4）：与 ListSection 的分割线同款（左右缩进 = 卡内边距，与行文字对齐）。
// ⚠ 必须放在模块作用域：写成组件体内的箭头函数会在每次渲染时变成新的组件类型 →
//   ItemSeparatorComponent 每次渲染都卸载重挂，VirtualizedList 的测量（frames / 平均行高）
//   反复失效，滚动时不再补渲染后面的行（T09 自检实测：45 笔只出前 5 行、滚到底没内容）。
function TxSeparator() {
  const palette = useHomePalette();
  return (
    // 外层 = 面板底色 + 面板左右两道描边（行与分隔线同宽，1px 竖线在整根面板上连续不断缝）
    <View
      style={[
        txPanelStyles.separatorShell,
        { backgroundColor: palette.panel, borderColor: palette.border },
      ]}
    >
      <View style={{ height: 1, backgroundColor: palette.hairline, marginLeft: TX_SEP_INSET }} />
    </View>
  );
}

/** TxSeparator 的面板几何（模块作用域：ItemSeparatorComponent 必须是稳定组件） */
const txPanelStyles = StyleSheet.create({
  separatorShell: {
    marginHorizontal: LIST_CARD_MARGIN,
  },
});

// ── 账单行（参考图）：左 38 圆下沉底 + 类别线条图标 → 标题（备注）+ 副标题（类别 · 账户）→ 右金额列。
// 行属于「最近交易」那一根统一面板：面板底 + 左右 1px 描边、零圆角、零阴影（圆角只在面板首尾两处）；
// 行与行之间由 TxSeparator 画 1px 发丝线。类别图标 / 颜色仍是数据驱动（cat.icon / cat.color），
// 只是不再走 ui/IconCircle 的立体球面 —— ui/TransactionRow 是其它车道的共享文件，这里按首页规格自绘。
type TxRowProps = {
  /** 标题（有备注用备注，没有则调用方传类别名） */
  title: string;
  /** 副标题第一段（标题已经是类别名时传空串） */
  categoryName: string;
  categoryIcon: IconName;
  categoryColor: string;
  accountName?: string;
  /** 该笔的日期标签（分组头去掉后，日期回到行副标题） */
  dateLabel?: string;
  /** 行顶发丝线：分组头去掉后，跨天相邻的行也要有分隔（整列表第一行除外） */
  showDivider?: boolean;
  amount: number;
  kind: 'expense' | 'income';
  /** 命中「新增后闪一下」：淡紫底 */
  flash?: boolean;
  /** 列表卡的最后一行：26 下圆角 + 4pt 卡底边 */
  isCardBottom?: boolean;
  onPress: () => void;
  testID?: string;
};

function TxRow({
  title,
  categoryName,
  categoryIcon,
  categoryColor,
  accountName,
  /** 该笔的日期标签（分组头去掉后，日期回到行里：今天 / 昨天 / 10月7日 周三） */
  dateLabel,
  showDivider,
  amount,
  kind,
  flash,
  isCardBottom,
  onPress,
  testID,
}: TxRowProps) {
  const palette = useHomePalette();
  const { spacing, radius } = useTheme();
  const rowStyles = useMemo(
    () => makeTxRowStyles(palette, spacing, radius),
    [palette, spacing, radius]
  );
  // 副标题：类别 · 账户 · 日期（任一缺失都不留下孤零零的分隔点）
  const subtitle = [categoryName, accountName, dateLabel]
    .filter((part): part is string => !!part)
    .join(' · ');
  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onPress}
      activeScale={0.98}
      // 行本身 ≥60 高，外扩 hitSlop 会抢到相邻行的手势
      hitSlop={0}
      style={[
        rowStyles.row,
        // 命中「新增后闪一下」：面板底 → 品牌淡底（按压态由 activeScale 承担，不叠底色）
        flash && { backgroundColor: palette.brandSoft },
        isCardBottom && rowStyles.rowCardBottom,
      ]}
      testID={testID}
    >
      {/* 行顶发丝线（跨天相邻的行也要分得开）：与文字左缘对齐 */}
      {showDivider ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: TX_SEP_INSET,
            right: 0,
            top: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: palette.hairline,
          }}
        />
      ) : null}
      {/* 类别图标：38 圆下沉底 + 18 类别线条图标（分类图标 / 颜色仍是数据驱动的 cat.icon / cat.color） */}
      <View style={rowStyles.iconCircle}>
        <Ionicons name={categoryIcon} size={TX_ICON_GLYPH} color={categoryColor} />
      </View>
      {/* 中：flex:1 吃掉剩余宽度，把金额顶到行尾 */}
      <View style={rowStyles.textBlock}>
        <AppText variant="subhead" weight="600" color={palette.textPrimary} style={rowStyles.rowTitleText} numberOfLines={2}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="caption" weight="400" color={palette.textSecondary} style={rowStyles.rowSubText} numberOfLines={1}>
            {subtitle}
          </AppText>
        )}
      </View>
      {/* 右：金额列 —— 定宽 + 右对齐 + 等宽数字（金额长短变化时列宽不动）；
          带正负号（收入 + / 支出 −），走 utilities/formatMoney 的唯一格式化入口 */}
      <View style={rowStyles.amountCol}>
        <AppText
          variant="body"
          weight="700"
          color={kind === 'income' ? palette.income : palette.expense}
          numberOfLines={1}
          ellipsizeMode="clip"
          style={rowStyles.amountText}
        >
          {fmtMoney(amount, { kind, showCurrency: false })}
        </AppText>
      </View>
    </PressableScale>
  );
}

// TxRow 的 props 全是原始值 + 稳定回调：包一层 memo，避免整页重渲染（点眼睛 / 吸顶 / 滚动状态变化）
// 时把已挂载的每一行重算一遍；行内容真的变化时 props 变，memo 仍会更新。
const TxRowMemo = React.memo(TxRow);

/**
 * TxRow 的样式（调色板进、StyleSheet 出）。
 * 行不是独立卡片：面板底 + 左右两道 1px 描边 + 零圆角 + 零阴影，
 * 圆角只挂在整根面板的首段（RecentHeader 顶两角）与末行（底两角）上。
 */
function makeTxRowStyles(palette: HomePalette, spacing: Spacing, radius: Radius) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      minHeight: 60,
      paddingHorizontal: pageLayout.card,
      paddingVertical: 9,
      backgroundColor: palette.panel,
      // 面板不再画左右边线：每一段各带一条 1px 蓝边，叠起来就是两条显眼的竖条（用户实测）
      // 面板靠「白底 vs 冰蓝页面」的对比成形，比描边干净
      marginHorizontal: LIST_CARD_MARGIN,
    },
    // 末行 = 面板底边：只圆下两角（行高 60 足够撑出真圆角）+ 面板下描边
    rowCardBottom: {
      borderBottomLeftRadius: LIST_CARD_RADIUS,
      borderBottomRightRadius: LIST_CARD_RADIUS,
      borderBottomWidth: PANEL_BORDER,
      paddingBottom: spacing.sm + LIST_CARD_EDGE,
    },
    // 分类图标：38 圆下沉底（参考图：浅蓝圆 + 类别色线条图标）
    iconCircle: {
      width: TX_ICON_SIZE,
      height: TX_ICON_SIZE,
      borderRadius: radius.full,
      backgroundColor: palette.surfaceSunken,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    textBlock: { flex: 1, minWidth: 0, rowGap: 2 },
    // 交易行：标题 15/600（中文字形要 ≥1.30 行高 → 20）
    rowTitleText: { fontSize: 15, lineHeight: 20 },
    rowSubText: { fontSize: 12, lineHeight: 16 },
    // 金额列：定宽 + 右对齐（列宽不随金额长短变化）
    amountCol: { width: TX_AMOUNT_COL_WIDTH, alignItems: 'flex-end', flexShrink: 0 },
    amountText: { fontSize: 16, lineHeight: 22, fontVariant: ['tabular-nums'], textAlign: 'right' },
  });
}

/** 「最近交易」区块标题行（设计稿 01 屏）：左标题 17/700、右「查看全部 ›」12/600 主色。
 *  真列表与横滑邻页共用同一个组件 —— 横滑交接时标题行逐像素一致；点按只走 activeSheet 单源 */
function RecentHeader({
  label,
  action,
  onPress,
  testID,
}: {
  label: string;
  action: string;
  onPress: () => void;
  testID?: string;
}) {
  const palette = useHomePalette();
  const { spacing } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        // 标题行 = 统一面板的首段：面板底 + 上两角圆角 + 上/左/右描边（下边交给第一条分隔线）
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: spacing.sm,
          marginHorizontal: LIST_CARD_MARGIN,
          paddingHorizontal: pageLayout.card,
          // 快捷入口 → 最近交易面板 = heroBlock 底 16 + 这里 8 = spacing.xxl(24) 收口
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm,
          backgroundColor: palette.panel,
          borderTopLeftRadius: LIST_CARD_RADIUS,
          borderTopRightRadius: LIST_CARD_RADIUS,
          borderWidth: PANEL_BORDER,
          borderColor: palette.border,
          borderBottomWidth: 0,
        },
        spacer: { flexGrow: 1, flexShrink: 1 },
        action: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs },
      }),
    [spacing, palette]
  );
  return (
    <View style={styles.row}>
      <AppText variant="headline" weight="700" color={palette.textPrimary} numberOfLines={1}>
        {label}
      </AppText>
      <View style={styles.spacer} />
      <PressableScale
        onPress={onPress}
        activeScale={0.94}
        // 文字行本身不到 44：外扩 hitSlop 补足触控区（不抢相邻行手势 —— 它右侧没有可点元素）
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={action}
        testID={testID}
      >
        <AppText variant="caption" weight="600" color={palette.brand}>
          {action}
        </AppText>
        <IconChevronRight size={16} color={palette.brand} />
      </PressableScale>
    </View>
  );
}

// ── V2 渐变上的 44 玻璃圆钮（铃铛 / 日历）：GlassView 玻璃材质 + text.primary 图标
//    （UI V2.1 §3：日间不再有白图标压在浅色玻璃上）；
//    按压反馈挂在**外层** PressableScale 上（玻璃整块缩才看得见）。
//    44 = V2 稿的 .gb 规格（也是全 App 最小触控区），图标 20 与 IconButton 同档。
const GLASS_ROUND = 44;
/** 44 圆键底面的「微透明」程度：与顶部 RoundIconButton / AccountChip 同一档（透出顶部光场） */
const ROUND_SURFACE_OPACITY = 0.72;

function GlassRoundButton({
  icon,
  accessibilityLabel,
  accessibilityState,
  onPress,
  testID,
}: {
  icon: IconName;
  accessibilityLabel: string;
  accessibilityState?: React.ComponentProps<typeof PressableScale>['accessibilityState'];
  onPress: () => void;
  testID?: string;
}) {
  const { semantic } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.9}
      hitSlop={0}
      style={glassRoundStyles.touch}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
    >
      <GlassView radius="full" style={glassRoundStyles.glass}>
        <Ionicons name={icon} size={20} color={semantic.textPrimary} />
      </GlassView>
    </PressableScale>
  );
}

/** 44 玻璃圆钮的「UI 线程点按」版（日历 ⇄ 列表开关用）：
 *  点按由 Gesture.Tap 在原生线程识别、onEnd 直接在 UI 线程执行 onTapUI（worklet）—— 不经过 JS 线程，
 *  JS 再忙也不会「点了要停一下才动」；按压缩放也在 UI 线程（共享值 + 弹簧）。
 *  读屏的「激活」动作走 onActivateJS（JS 线程，只在无障碍场景用）。 */
function GlassRoundTapButton({
  iconOff,
  iconOn,
  onProgress,
  accessibilityLabel,
  selectedSV,
  onTapUI,
  onActivateJS,
  pressSpring,
  testID,
}: {
  /** 关闭态（列表模式）图标 / 开启态（日历模式）图标：UI 线程按 onProgress（0 → 1）交叉淡入淡出，不靠 state */
  iconOff: IconName;
  iconOn: IconName;
  onProgress: SharedValue<number>;
  accessibilityLabel: string;
  /** 日历模式的目标（1 = 日历）：按钮据此维护无障碍的选中状态（只重渲按钮自己） */
  selectedSV: SharedValue<number>;
  onTapUI: () => void;
  onActivateJS: () => void;
  pressSpring: { dampingRatio: number; duration: number };
  testID?: string;
}) {
  const palette = useHomePalette();
  const { radius } = useTheme();
  const scale = useSharedValue(1);
  const [selected, setSelected] = useState(false);
  useAnimatedReaction(
    () => selectedSV.value === 1,
    (now, prev) => {
      if (now !== prev) runOnJS(setSelected)(now);
    },
    [selectedSV]
  );
  const gesture = useMemo(
    () =>
      Gesture.Tap()
        .onBegin(() => {
          scale.value = withSpring(0.9, pressSpring);
        })
        .onFinalize(() => {
          scale.value = withSpring(1, pressSpring);
        })
        .onEnd((_e, success) => {
          if (success) onTapUI();
        }),
    [onTapUI, pressSpring, scale]
  );
  const scaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const offStyle = useAnimatedStyle(() => ({ opacity: 1 - onProgress.value }));
  const onStyle = useAnimatedStyle(() => ({ opacity: onProgress.value }));
  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View
        style={[glassRoundStyles.touch, scaleStyle, { boxShadow: '0px 2px 8px 0px rgba(3,16,48,0.18)' }]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ selected }}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={onActivateJS}
        testID={testID}
      >
        {/* 44 圆键（与顶部搜索 / 通知同款）：surface 半透明底 + 1px 描边 + textPrimary 图标。
            底色用「叠一层 opacity」而不是 rgba 字面量 —— 调色板换色时这里不用跟着改 */}
        <View
          style={[
            glassRoundStyles.glass,
            { borderRadius: radius.full, borderColor: withAlpha(palette.fabIcon, 0.72), borderWidth: 1 },
          ]}
        >
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: palette.fabIcon,
                opacity: 0.3,
                borderRadius: radius.full,
              },
            ]}
          />
          <Reanimated.View style={[glassRoundStyles.iconLayer, offStyle]} pointerEvents="none">
            <Ionicons name={iconOff} size={20} color={palette.fabIcon} />
          </Reanimated.View>
          <Reanimated.View style={[glassRoundStyles.iconLayer, onStyle]} pointerEvents="none">
            <Ionicons name={iconOn} size={20} color={palette.fabIcon} />
          </Reanimated.View>
        </View>
      </Reanimated.View>
    </GestureDetector>
  );
}

/**
 * 日历弹层的指针外壳：open 状态只存在这个小组件里（只重渲它自己，不重渲页面）。
 * 打开 = 接收触摸；关闭 = pointerEvents none。children 由页面传入，引用不变，不会被重渲。
 */
function CalPointerGate({
  openSV,
  fadeSV,
  style,
  children,
}: {
  openSV: SharedValue<number>;
  /** 这一层的不透明度（关闭态由动画淡到 0）：淡出走完才把整层从绘制里摘掉 */
  fadeSV: SharedValue<number>;
  style: React.ComponentProps<typeof Reanimated.View>['style'];
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useAnimatedReaction(
    () => openSV.value === 1,
    (now, prev) => {
      if (now !== prev) runOnJS(setOpen)(now);
    },
    [openSV]
  );
  // 「还画得出来」= 打开中 / 已打开 / 淡出没走完；三者都不是 → display:none。
  // ⚠ 关闭态只留 opacity 0 不够：日历卡是一整块玻璃（半透明填充 + backdrop-filter + 投影），
  //   opacity:0 的子树在 GPU 上仍是一个 358×513 的合成图层。首页常驻挂载时切到资产/统计页，
  //   它就跟过去参与合成 —— 真实浏览器（软 GPU）里表现为资产页那道软边「阴影竖带」，
  //   --disable-gpu 的无头截图看不出来。关掉后进/退场动画不受影响（淡出结束才摘层）。
  const [painted, setPainted] = useState(false);
  useAnimatedReaction(
    () => openSV.value === 1 || fadeSV.value > 0.004,
    (now, prev) => {
      if (now !== prev) runOnJS(setPainted)(now);
    },
    [openSV, fadeSV]
  );
  return (
    <Reanimated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={[style, painted ? null : calGateStyles.hidden]}
    >
      {children}
    </Reanimated.View>
  );
}

/** 日历弹层的「不绘制」档：关闭且淡出走完 → 整层摘出布局与合成（见 CalPointerGate） */
const calGateStyles = StyleSheet.create({ hidden: { display: 'none' } });

/** 44 圆钮的纯图形几何（尺寸来自 V2 稿，不进间距体系） */
const glassRoundStyles = StyleSheet.create({
  touch: { width: GLASS_ROUND, height: GLASS_ROUND, borderRadius: GLASS_ROUND / 2 },
  glass: { width: GLASS_ROUND, height: GLASS_ROUND, alignItems: 'center', justifyContent: 'center' },
  // 双图标交叉淡入淡出：两层叠在同一格里
  iconLayer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});

// ── accent 渐变主按钮（UI V2：与「记一笔」完成键 / 中央「+」同一条渐变）──
// ui/Button 只有平涂档（那是全 App 共享文件、不在本车道可改范围），所以按同规格自绘一层：
// 几何与 ui/Button 的 md/primary 一致（高 50 / radius.md / 内边距 xl·md / 图标 20 + 间距 sm）。
const GRADIENT_BTN_HEIGHT = 50;

function GradientButton({
  title,
  icon,
  onPress,
  testID,
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  testID?: string;
}) {
  const { semantic, spacing, radius, gradients } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      activeScale={0.97}
      style={[
        gradientButtonStyles.button,
        {
          minHeight: GRADIENT_BTN_HEIGHT,
          borderRadius: radius.md,
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.md,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
    >
      {/* 渐变填充铺满按钮底（白字压在上面）：135° accent 渐变，色值只从令牌取 */}
      <LinearGradient
        colors={gradients.accent.colors}
        locations={gradients.accent.locations as [number, number, ...number[]]}
        start={gradients.accent.start}
        end={gradients.accent.end}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={gradientButtonStyles.content} pointerEvents="none">
        {icon && <Ionicons name={icon} size={20} color={semantic.onAccent} style={{ marginRight: spacing.sm }} />}
        <AppText variant="headline" color={semantic.onAccent} align="center" style={gradientButtonStyles.label}>
          {title}
        </AppText>
      </View>
    </PressableScale>
  );
}

/** 渐变主按钮的静态几何（尺寸/内边距在渲染期从令牌取；这里只留与令牌无关的排布） */
const gradientButtonStyles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 1 },
});

// ── 币种横滑时，账单列表 / 日历 / 预算卡跟着 hero 一起走 ──
/** 邻页预览的行数上限：只渲染第一屏够用的几行（轻量静态渲染），真列表交接后再接管全部 */
const NEIGHBOUR_ROWS = 12;
const NO_GROUPS: TxDaySection[] = [];

/** 一个邻页预览面板：绝对定位在「列表区」起点（头部区正下方），按 (自己的页下标 − 基准页) × 页距
 *  + 真列表的横向位移 摆放。平时（swipeActive = 0）透明，横滑接管期间显示。
 *  纯 UI 线程 useAnimatedStyle，不用 entering / exiting；pointerEvents none —— 预览只看不点。 */
function SwipePanel({
  index,
  listIdx,
  swipeActive,
  frozen,
  shiftX,
  pitch,
  top,
  width,
  sheetY,
  sheetO,
  children,
}: {
  index: number;
  listIdx: SharedValue<number>;
  swipeActive: SharedValue<number>;
  /** 1 = 币种提交交接中：真列表在屏幕外，所有页（含基准页）都显示预览 */
  frozen: SharedValue<number>;
  shiftX: SharedValue<number>;
  pitch: SharedValue<number>;
  top: number;
  width: number;
  /** 日历邻页：跟真日历弹层同一个竖向位移 / 不透明度（横滑时与真日历逐帧一致） */
  sheetY?: SharedValue<number>;
  sheetO?: SharedValue<number>;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const base = listIdx.value;
    // 有 sheetO 的预览（列表邻页 / 日历邻页）：所在层关闭时整张不参与点按（绝对定位，不影响布局）
    const sheetOn = sheetO ? sheetO.value > 0.01 : true;
    // 「真上屏」= 手势接管期里该显示的那几页（基准页只在冻结交接期显示）。判定与 opacity 完全同源，
    // 所以关掉 display 的那一帧本来就不可见 —— 但图层必须真的消失：
    // ⚠ 只把 opacity 压到 0 是不够的。预览里是 GlassView（半透明填充 + backdrop-filter + 投影），
    //   opacity:0 的子树在 GPU 上仍是一个合成图层；首页常驻挂载时切到别的 tab，
    //   这些「看不见的玻璃卡」照样参与合成，真实浏览器里就是资产页那道软边阴影竖带
    //   （无头 --disable-gpu 截图复现不出来，必须 swiftshader 软 GPU）。
    const shown = swipeActive.value === 1 && (index !== base || frozen.value === 1) && sheetOn;
    return {
      opacity: shown ? (sheetO ? sheetO.value : 1) : 0,
      display: shown ? ('flex' as const) : ('none' as const),
      transform: [
        { translateX: (index - base) * pitch.value + shiftX.value },
        { translateY: sheetY ? sheetY.value : 0 },
      ],
    };
  });
  return (
    <Reanimated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top, width }, style]}>
      {children}
    </Reanimated.View>
  );
}

/** 邻页的账单列表预览：日期头 + 前 NEIGHBOUR_ROWS 行（行 / 日期头 / 分割线与真列表同一批组件）。
 *  memo：只有该币种的分组真变了才重渲染，头部区 / 真列表的更新碰不到它 */
const NeighbourList = React.memo(function NeighbourList({
  groups,
  buildRow,
  renderHeader,
  renderEmpty,
  headerLabel,
  actionLabel,
  onAction,
}: {
  groups: TxDaySection[];
  buildRow: (item: Transaction, index: number, section: TxDaySection, flash: boolean) => React.ReactNode;
  renderHeader: (info: { section: TxDaySection }) => React.ReactElement;
  renderEmpty: () => React.ReactNode;
  /** 「最近交易」标题行（与真列表同款，横滑交接时逐像素一致） */
  headerLabel: string;
  actionLabel: string;
  onAction: () => void;
}) {
  if (groups.length === 0) return <>{renderEmpty()}</>;
  const out: React.ReactNode[] = [
    <RecentHeader key="recent-header" label={headerLabel} action={actionLabel} onPress={onAction} />,
  ];
  let used = 0;
  for (const section of groups) {
    if (used >= NEIGHBOUR_ROWS) break;
    out.push(<React.Fragment key={`h-${section.date}`}>{renderHeader({ section })}</React.Fragment>);
    section.data.forEach((item, index) => {
      if (used >= NEIGHBOUR_ROWS) return;
      if (index > 0) out.push(<TxSeparator key={`s-${item.id}`} />);
      out.push(<React.Fragment key={item.id}>{buildRow(item, index, section, false)}</React.Fragment>);
      used += 1;
    });
  }
  return <>{out}</>;
});

const NOOP = () => {};
/** 日历卡外壳（真日历与邻页预览共用，memo）：玻璃卡 + 内衬，日历本体是 MonthCalendarCard
 *  （同月份、同指标分段、该币种自己的逐日数据与热力）。props 全部是稳定引用 ——
 *  数据不变就不重渲，横滑 / 翻页动画期间 JS 线程不碰它。debugName 只给开发日志数挂载次数。 */
const CalendarShell = React.memo(function CalendarShell({
  year,
  month,
  days,
  monthExpense,
  monthIncome,
  segKey,
  styles,
  onPrevMonth = NOOP,
  onNextMonth = NOOP,
  onPressItem,
  onSegKeyChange,
  selectionKey,
  onLayoutH,
  debugName,
  blur,
}: {
  year: number;
  month: number;
  days: Map<string, CalendarDayTotals>;
  monthExpense: number;
  monthIncome: number;
  segKey: SegKey;
  styles: ReturnType<typeof makeStyles>;
  onPrevMonth?: () => void;
  onNextMonth?: () => void;
  onPressItem?: (id: string) => void;
  onSegKeyChange?: (key: SegKey) => void;
  selectionKey?: string;
  onLayoutH?: (h: number) => void;
  debugName?: string;
  /** 是否让玻璃卡输出模糊层（默认开）。邻页预览传 false：
   *  它只是横滑时的临时替身，不该在隐藏/动画子树里再挂一层 backdrop-filter（见 GlassView 的 blur） */
  blur?: boolean;
}) {
  useEffect(() => {
    if (!__DEV__) return;
    console.log(`[cal] mount ${debugName ?? '?'}`);
    return () => console.log(`[cal] unmount ${debugName ?? '?'}`);
  }, [debugName]);
  return (
    <View style={styles.calendarWrap} onLayout={onLayoutH ? (e) => onLayoutH(e.nativeEvent.layout.height) : undefined}>
      <GlassView radius={26} blur={blur} style={styles.calendarCard}>
        <MonthCalendarCard
          year={year}
          month={month}
          days={days}
          monthExpense={monthExpense}
          monthIncome={monthIncome}
          onPrevMonth={onPrevMonth}
          onNextMonth={onNextMonth}
          onPressItem={onPressItem}
          segKey={segKey}
          onSegKeyChange={onSegKeyChange}
          selectionKey={selectionKey}
        />
      </GlassView>
    </View>
  );
});

/** 净资产卡的一页（每个币种一页，memo）：大金额 + 该币种本月预算。
 *  整卡横滑 = 一条 strip，页宽 = 卡内实测宽；金额与预算同页一起切（数据各按币种取，绝不跨币种相加）。
 *  MoneyText hero：整数 40/700、小数 22/600，挂载即定格、只在数据真变时才逐位滚动；页宽 = 行实测宽。 */
const HeroCardPage = React.memo(function HeroCardPage({
  code,
  total,
  hidden,
  width,
  cardW,
  cardH,
  textColor,
  mutedColor,
  decimalColor,
  shadow,
  styles,
  budget,
  expense,
  onPressBudget,
  onPressAmount,
  testID,
}: {
  code: string;
  total: number;
  hidden: boolean;
  /** 页宽 = 卡宽（strip 每页正好一张卡的宽） */
  width: number;
  /** V2 卡画布实测尺寸：内部按包里的百分比定位 */
  cardW: number;
  cardH: number;
  textColor: string;
  mutedColor: string;
  decimalColor: string;
  shadow: TextStyle;
  styles: ReturnType<typeof makeStyles>;
  /** 该页币种的本月总预算（0 = 未设 → 一可点 CTA） */
  budget: number;
  /** 该页币种的本月支出（进度分子，口径同 expenseByCurrency） */
  expense: number;
  onPressBudget: () => void;
  /** 金额区点按（打开币种面板） */
  onPressAmount: () => void;
  testID?: string;
}) {
  const palette = useHomePalette();
  const t = useT();
  // 金额区自己的 tap：**只包金额槽，不含预算槽**。以前这颗 tap 挂在整条金额行上，
  // 预算槽（RN Pressable）和它同时响应 → 点预算槽会开两个抽屉（币种 + 月度预算）
  const amountTap = useMemo(
    () =>
      Gesture.Tap()
        .maxDistance(10)
        .maxDuration(500)
        .onEnd((_e, success) => {
          if (success) runOnJS(onPressAmount)();
        }),
    [onPressAmount]
  );
  // 百分比口径与月度预算抽屉同源（utils/budgetPct）：未超支 "130%"，超支 "−30%"，
  // 条 ratio 固定满格 + tone 固定 danger；读屏走 a11y（不含负号）
  const pct = formatBudgetPct(expense, budget, t);
  return (
    <View style={{ width, height: cardH }}>
      {/* 金额槽：判档宽度 = 父级页宽（定值）—— MoneyText 自身盒宽恒等于内容宽，
          用它判档会形成逐帧反馈环（长金额时整页上下抖动）；minHeight 保住降档时的行高 */}
      <GestureDetector gesture={amountTap}>
        <View
          style={{
            position: 'absolute',
            left: cardW * 0.088,
            right: cardW * 0.088,
            top: cardH * 0.3,
          }}
        >
          {hidden ? (
            /* 隐藏态占位：字号 / 行高与真实金额完全一致（40 / 44）+ 固定 6 点，
               显隐切换时金额槽一像素都不变（此前 lineHeight 64 会把整张卡撑高 20dp） */
            <AppText
              variant="display"
              color={mutedColor}
              style={[styles.heroHiddenAmount, shadow]}
              numberOfLines={1}
              ellipsizeMode="clip"
            >
              {HIDDEN_AMOUNT}
            </AppText>
          ) : (
            <HeroRollMoney
              code={code}
              value={total}
              kind="plain"
              currency={code}
              /* 判档宽度 = 父级页宽（定值）：MoneyText 自身盒宽恒等于内容宽，用它判档会形成
                 逐帧反馈环（长金额时整页上下抖动） */
              availableWidth={width}
              // V2.2：大数字不再带 RM 前缀（上方胶囊已表示币种）——
              // 小数点后两位照常保留，读屏标签仍带币种
              variant="display"
              hero
              heroSize={cardW * 0.126}
              weight="700"
              heroDecimalSize={cardW * 0.063}
              heroDecimalWeight="600"
              heroDecimalColor={decimalColor}
              heroLetterRatio={-0.03}
              color={textColor}
              /* 地板档仍放不下（320 视口 + 15 位金额）→ 紧凑格式（100.1T）+ 长按看全文，
                 同资产页资产行；不靠裁切掩盖溢出 */
              compactFallback
              accessibilityLabel={fmtMoney(total, { currency: code, showCurrency: true })}
              style={shadow}
            />
          )}
        </View>
      </GestureDetector>
      {/* 预算槽：已设 → 标题 + 已用 / 额度 + 百分比 + 状态色进度条；未设 → 一行「＋ 设置本月预算」。
          两态同高（minHeight）→ 各币种页等高，横滑落定整卡不跳 */}
      <View
        style={{
          position: 'absolute',
          left: cardW * 0.088,
          right: cardW * 0.088,
          top: cardH * 0.635,
          bottom: cardH * 0.172,
          justifyContent: 'space-between',
        }}
      >
        <PressableScale
          onPress={onPressBudget}
          activeScale={budget > 0 ? 0.98 : 0.96}
          hitSlop={0}
          style={budget > 0 ? styles.heroBudgetPress : styles.heroBudgetCta}
          accessibilityRole="button"
          accessibilityLabel={budget > 0 ? t('home.budgetLabel') : t('home.setBudget')}
          testID={testID}
        >
          {budget > 0 ? (
            <>
              {/* 第一行（参考图）：左「本月预算」+ 其下 12 号弱化色金额明细，右「67%」。
                  百分比用卡上主文字色，**只有超支**才换 palette.expense */}
              <View style={styles.heroBudgetHead}>
                <View style={styles.heroBudgetHeadCol}>
                  <AppText variant="caption" weight="500" color={mutedColor} numberOfLines={1} style={[styles.budgetText, styles.heroBudgetHeadLabel, { fontSize: cardW * 0.0365 }]}>
                    {t('home.budgetLabel')}
                  </AppText>
                  <AppText variant="caption" weight="500" color={mutedColor} numberOfLines={1} style={[styles.heroBudgetDetail, { fontSize: cardW * 0.0296 }]}>
                    {hidden
                      ? HIDDEN_AMOUNT
                      : `${fmtMoney(expense, { showCurrency: false })} / ${fmtMoney(budget, { showCurrency: false })}`}
                  </AppText>
                </View>
                <AppText
                  variant="caption"
                  weight="600"
                  color={pct.over ? palette.expense : textColor}
                  style={[styles.budgetText, styles.heroBudgetPct, { fontSize: cardW * 0.032 }]}
                  accessibilityLabel={pct.a11y}
                  testID={testID ? `${testID}-pct` : undefined}
                >
                  {pct.text}
                </AppText>
              </View>
              {/* 第二行（参考图）：进度条独占整行、左对齐、整行宽度（不再与百分比抢同一行）。
                  自绘，palette 两套值：轨道 trackBg / 填充 progressFrom→progressTo；
                  宽度口径与原来 ProgressBar 完全一致（pct.fillRatio 封顶 100%），超支只靠颜色与文案表达 */}
              <View
                style={[styles.heroBudgetTrack, { backgroundColor: palette.trackBg, height: cardH * 0.042 }]}
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round(Math.min(Math.max(pct.fillRatio, 0), 1) * 100),
                }}
                testID={testID ? `${testID}-bar` : undefined}
              >
                <LinearGradient
                  colors={[palette.progressFrom, palette.progressTo] as const}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[
                    styles.heroBudgetFill,
                    { width: `${Math.min(Math.max(pct.fillRatio, 0), 1) * 100}%` },
                  ]}
                />
              </View>
            </>
          ) : (
            <>
              <Ionicons name="add" size={16} color={textColor} />
              <AppText variant="caption" weight="600" color={textColor} numberOfLines={1}>
                {t('home.setBudget')}
              </AppText>
            </>
          )}
        </PressableScale>
      </View>
    </View>
  );
});
/** 首页浮层抽屉的键：同一时刻只允许开一个（activeSheet 单源，见下）。
 *  allTx = 「最近交易」标题行「查看全部」打开的全量交易抽屉（与 search 共用 TransactionSearchSheet，
 *  只是 mode='all'），同样并入这一个单源，不许另开 state */
type HomeSheetKey = 'ledger' | 'currency' | 'budget' | 'search' | 'allTx';

export default function HomeScreen({ navigation }: any) {
  const {
    transactions,
    loading: dataLoading,
    deleteTransaction,
    categories,
    currencySymbol,
    currency,
    activeLedgerId,
    setActiveLedgerId,
    defaultLedgerId,
    setDefaultLedger,
    ledgers,
    renameLedger,
    deleteLedger,
    budgets,
    setBudget,
    assets,
    activeAssets,
    paymentPlans,
    getAssetBalance,
  } = useApp();
  // 查表函数：context 里的 getCategoryById / getAssetById 每次渲染都是新函数（只是 find 一下），
  // 拿它们进依赖数组会让 dayGroups / 列表渲染器在每次 context 更新时整体失效（切币种卡顿的一个来源）。
  // 这里按数据本身（categories / assets）做稳定版本：数据不变，身份就不变。
  const getCategoryById = useCallback((id: string) => categories.find((c) => c.id === id), [categories]);
  const getAssetById = useCallback((id: string) => assets.find((a) => a.id === id), [assets]);

  const { colors, isDark, semantic, spacing, layout, radius, elevation, glass, gradients, motion } = useTheme();
  // 顶部「日夜切换」键：写回既有的主题偏好（与设置项里的开关同一个 source of truth）
  const { setThemeMode } = useThemeMode();
  const t = useT();
  const { langMode: homeLang } = useLanguage();
  const insets = useSafeAreaInsets();
  const { width: winW, height: screenH } = useWindowDimensions();
  // 头部区行宽的「首帧默认值」= 窗口宽 − 左右页边距：首帧就能按它排版，不等 onLayout 量到（量到后再校正）
  const initialRowW = Math.max(0, Math.round(winW - 2 * pageLayout.page));
  // 版型分级（计划 8.2 第 2 条）：矮屏 / 平板等内容收窄仍用它，不再用 Dimensions
  const layoutTokens = useLayout();

  const tabClearance = useTabClearance();

  const onTabScroll = useTabBarScrollHandler();
  // 首页正文配色（2026-10 视觉改版）：唯一来源 useHomePalette()，日夜两套值已在调色板里定好。
  // styles 走 makeStyles 也接这份 palette —— 页面正文不再自己挑 semantic（弹层仍用 semantic）。
  const palette = useHomePalette();
  const styles = useMemo(
    () => makeStyles(colors, isDark, semantic, spacing, radius, layout, elevation, palette),
    [colors, isDark, semantic, spacing, radius, layout, elevation, palette]
  );
  // 资产卡上的文字：卡面日夜两套（日近白 / 夜深蓝），文字色也两套 —— 主文字 cardText、
  // 次要文字 cardTextMuted。层级靠字号 / 字重承担（金额 display、标签 caption）。
  const onGradientText = palette.cardText;
  const onGradientMuted = palette.cardTextMuted;
  // 卡上文字投影只在夜间给（浅字压深蓝卡）；颜色取调色板的 cardShadow，不写死色值
  const heroShadow = useMemo<TextStyle>(
    () =>
      isDark
        ? { textShadowColor: palette.cardShadow, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 20 }
        : {},
    [isDark, palette.cardShadow]
  );
  // 吸顶日期头的判据仍是「头部区实测高度」（heroHeightRef，见 onLayout）；
  // 渐变高度不再参与计算 —— UI V2.1 §1 的 fill 模式铺满整页
  const [balanceHidden, setBalanceHidden] = useState(false);
  // 隐藏净资产持久化：退出 App 下次进来仍保留隐藏，点眼睛才恢复
  const BALANCE_HIDDEN_KEY = '@jizhang/balanceHidden';
  useEffect(() => {
    AsyncStorage.getItem(BALANCE_HIDDEN_KEY)
      .then((v) => {
        if (v === '1') setBalanceHidden(true);
      })
      .catch(() => {});
  }, []);
  const toggleBalanceHidden = () => {
    setBalanceHidden((prev) => {
      AsyncStorage.setItem(BALANCE_HIDDEN_KEY, prev ? '0' : '1').catch(() => {});
      return !prev;
    });
  };

  // ── 日夜切换：圆心扩散换肤 + 三合一胶囊里的「日/夜」段已按 T08 删除 ──
  // 主题改为跟随系统（T01e，设置页可手动指定），首页不再放切换按钮，也不再需要那套遮罩动画。
  // 首页四个浮层抽屉（币种 / 月度预算 / 账本 / 搜索）共用这一个 activeSheet：
  // 任一时刻只允许开一个，后开的自动关掉先开的 —— 双抽屉叠层（遮罩互相打架）在状态层面不再可能
  const [activeSheet, setActiveSheet] = useState<HomeSheetKey | null>(null);
  const openSheet = useCallback((key: HomeSheetKey) => setActiveSheet(key), []);
  const closeSheet = useCallback(() => setActiveSheet(null), []);
  // 账本抽屉（T10 / H11）：改用 ui/BottomSheet —— 拖动把手下拉关闭、点遮罩关闭、安全区、
  // 打开期间强制收起浮空 Tab 栏都由它内部处理，原来这套自绘（scrim / pan / 入场位移动画 /
  // manualActivation 手势 / Reanimated.ScrollView + 滚动偏移判定）整体退役。
  // 行改用 ui/ListRow（图标方块 + 名称/副标题 + 结余 + 铅笔/垃圾桶），默认账本不再显示删除键。
  const ledgerPickerOpen = activeSheet === 'ledger';
  const closeLedgerPicker = closeSheet;
  // 账本改名：点击账本名字变成输入框（重命名中的账本 id），失焦/确认时保存
  const [renamingLedgerId, setRenamingLedgerId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<TextInput>(null);
  const startRenameLedger = (id: string, name: string) => {
    setRenamingLedgerId(id);
    setRenameValue(name);
    requestAnimationFrame(() => renameInputRef.current?.focus());
  };
  const commitRenameLedger = () => {
    if (renamingLedgerId && renameValue.trim()) {
      renameLedger(renamingLedgerId, renameValue.trim());
    }
    setRenamingLedgerId(null);
  };
  // MRU 排序：最近使用的账本排最上面（lastUsedAt 降序）；没用过的保持原数组顺序。
  // Array.prototype.sort 在现代 JS 引擎里是稳定排序，比较函数返回 0 时原顺序保留。
  const sortedLedgers = useMemo(
    () =>
      [...ledgers].sort((a, b) => {
        const at = a.lastUsedAt ?? 0;
        const bt = b.lastUsedAt ?? 0;
        if (at === bt) return 0;
        return bt - at;
      }),
    [ledgers]
  );
  const activeLedger = ledgers.find((l) => l.id === activeLedgerId);

  const now = new Date();
  const thisMonthKey = monthKeyOf(now.getFullYear(), now.getMonth());
  const todayString = todayStr();

  const ledgerTransactions = useMemo(
    () => transactions.filter((t) => t.ledgerId === activeLedgerId),
    [transactions, activeLedgerId]
  );

  // 净资产只算当前账本名下的资产——账本之间互不连通，切到"公司账本"就只看公司账本自己的钱
  // 币种列表按 ABC 字母序排列（2026-09-24 用户定版）
  // getAssetBalance 每次渲染都是新函数：经 ref 读取，memo 只依赖真正的数据（资产 / 交易 / 账本）
  const getAssetBalanceRef = useRef(getAssetBalance);
  getAssetBalanceRef.current = getAssetBalance;
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, number> = {};
    activeAssets
      .filter((a) => a.ledgerId === activeLedgerId)
      .forEach((a) => {
        totals[a.currency] = (totals[a.currency] || 0) + getAssetBalanceRef.current(a.id);
      });
    return Object.entries(totals).sort(([c1], [c2]) => c1.localeCompare(c2));
  }, [activeAssets, activeLedgerId, transactions]);

  // 净资产卡显示的币种：多币种时点行调出货币下拉菜单；默认=资产数组第一个账户的币种（兜底全局货币）
  const defaultNetWorthCurrency = useMemo(() => {
    const first = activeAssets.find((a) => a.ledgerId === activeLedgerId);
    return first?.currency ?? currency;
  }, [activeAssets, activeLedgerId, currency]);
  // 用户手选的币种代码（null=未手选过，跟随默认）——列表已按 ABC 排序，不能再用下标，否则默认币种会跟着排序漂移
  const [netWorthCurrency, setNetWorthCurrency] = useState<string | null>(null);
  const currencyMenuOpen = activeSheet === 'currency';
  // V3：币种面板 = ui/BottomSheet（切换币种），搜索词仅在 >6 个币种时出现
  const [currencyQuery, setCurrencyQuery] = useState('');
  // 金额行实测宽（Δ>0.5 才更新）：只给金额盒子当 maxWidth 用（短金额盒子贴合内容，眼睛紧贴金额；
  // 超长金额被夹住 → MoneyText 内部按档降级）。行宽由页面 flex 决定、与金额字号无关 —— 单向数据流
  const [amountRowW, setAmountRowW] = useState(initialRowW);
  const openCurrencyMenu = () => {
    if (totalsByCurrency.length <= 1) return;
    openSheet('currency');
  };
  const displayTotal =
    totalsByCurrency.find(([c]) => c === (netWorthCurrency ?? defaultNetWorthCurrency)) ?? totalsByCurrency[0];
  // 净资产当前选中的币种：本月支出合计、预算都跟随它（每个币种各设各的预算）
  const activeCurrency = displayTotal?.[0] ?? currency;
  // 头部区（顶栏 / 净资产 / 金额 / 预算）首帧就是完全可见的 —— 不再有「挂载淡入」：可见性不依赖任何动画有没有跑过
  // 列表 remount 锁存：数据第一次非空后永远是 'ready'（左右滑到空币种不再整表重挂）
  const hasEverHadDataRef = useRef(false);
  // V3：当前币种在列表中的下标（底部小圆点）
  const curIdx = totalsByCurrency.findIndex(([c]) => c === activeCurrency);
  // ── 净资产横移 = UI 线程手势分页（替换旧的横向 ScrollView 分页：安卓惯性被截断、拖动中 setState 打断甩动）──
  // 页条 = 一个 translateX 的横向 strip，页宽 = 行实测宽 pagerW；拖动实时跟手，越界橡皮筋；
  // 松手只翻相邻一页（位移 > 3% 页宽或速度 > 80px/s），动画结束才把 netWorthCurrency 提交一次；
  // 胶囊文字 / 小圆点不 setState：它们直接从共享值 pagerX 读页位置（pagerPos），拖动中零重渲染。
  // 每页 MoneyText 挂载即定格、只在数据真变时才逐位滚动。
  // 初始值 = 首帧就正确的位置（页宽取默认行宽、页下标取当前币种）：胶囊文字 / 圆点 / 页条不依赖「量到宽度」或任何动画
  const pagerX = useSharedValue(-Math.max(0, curIdx) * initialRowW);
  const pagerStart = useSharedValue(0);
  const pagerW = useSharedValue(initialRowW);
  const pagerN = useSharedValue(Math.max(1, totalsByCurrency.length));
  /** 1 = 正在拖动或翻页动画中（布局同步不许碰 pagerX） */
  const pagerBusy = useSharedValue(0);
  // ── 横滑时账单列表 / 日历 / 预算卡跟着 hero 一起走（轮播感）──
  // 一条连续的页条：hero 金额、预算卡条、列表预览（每币种前 12 行静态渲染，预挂载）、日历（预挂载）
  // 全是同一条 pagerX 驱动的页。手势任何时候都不会被挡：新的一拖可以在动画途中开始（cancelAnimation，
  // 从当前位置继续），每次只从「逻辑页」pagerTargetIdx 翻相邻一页。
  // swipeActive：1 = 手势接管期；期间真列表按位移横移、预览显示；0 = 平时，真列表原位、预览隐藏。
  //   它由手势 onStart 置 1，由下面的 reaction 在「停稳 + 真列表已装好这一页 + 没有冻结」时置 0（UI 线程，原子）。
  // listFrozen：1 = 币种提交进行中（setNetWorthCurrency → 真列表换数据 → 等上屏），真列表被挪到屏幕外、
  //   所有预览（含基准页）显示，用户此刻继续翻页也只看到预览，不会看到换数据的中间态。
  // listIdxSV：真列表此刻装的是第几个币种；pagerTargetIdx：逻辑页（动画目标页，没有动画时 = 当前页）。
  // listPitch：列表一页的间距 = 窗口宽（hero 的页宽是行宽 = 窗口宽 − 32，位移按比例放大）。
  const swipeActive = useSharedValue(0);
  const listFrozen = useSharedValue(0);
  const listIdxSV = useSharedValue(Math.max(0, curIdx));
  const pagerTargetIdx = useSharedValue(Math.max(0, curIdx));
  const listPitch = useSharedValue(winW);
  /** 邻页预览 / 日历邻页的横向位移基准：(pagerX + 基准页×页宽) × 列表页距 / hero 页宽；不横滑时为 0 */
  const swipeShiftX = useDerivedValue(() =>
    swipeActive.value === 1 && pagerW.value > 0
      ? ((pagerX.value + listIdxSV.value * pagerW.value) * listPitch.value) / pagerW.value
      : 0
  );
  /** 真列表 / 真日历的横向位移：同上；冻结期间挪到屏幕外 */
  const listShiftX = useDerivedValue(() => (listFrozen.value === 1 ? LIST_OFFSCREEN_X : swipeShiftX.value));
  useAnimatedReaction(
    () =>
      pagerBusy.value === 0 &&
      listFrozen.value === 0 &&
      pagerW.value > 0 &&
      Math.abs(pagerX.value + listIdxSV.value * pagerW.value) < 0.5,
    (atRest) => {
      if (atRest) swipeActive.value = 0;
    }
  );
  const pagerStripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pagerX.value }] }));
  /** 当前页位置（浮点下标，0 = 第一个币种）：胶囊与圆点都从它读，拖动中不 setState */
  const pagerPos = useDerivedValue(() => (pagerW.value > 0 ? -pagerX.value / pagerW.value : 0));
  /** 已提交的当前币种（拖动中不变，提交后才变） */
  const curRow = totalsByCurrency[curIdx];
  const curCode = curRow?.[0] ?? activeCurrency;
  /** 币种胶囊上的文字：只放币种代码（标题已单独在左侧，不重复文案） */
  const pillLabelOf = (code: string) => code;
  /** 分页点的窗口：≤ 7 个币种全画；更多时以当前页为中心开一个 7 格窗口（卡内宽固定，绝不溢出） */
  const DOT_WINDOW = 7;
  const dotWindow = useMemo(() => {
    const n = totalsByCurrency.length;
    if (n <= DOT_WINDOW) return Array.from({ length: n }, (_, i) => i);
    const start = Math.min(Math.max(Math.max(0, curIdx) - 3, 0), n - DOT_WINDOW);
    return Array.from({ length: DOT_WINDOW }, (_, k) => start + k);
  }, [totalsByCurrency.length, curIdx]);

  // 手势回调里要读最新的 totals / activeCurrency：走 ref，手势对象只在「多页 / 减弱动效」变化时重建
  const swipeCommitRef = useRef<string | null>(null);
  /** 横滑提交的交接是否还在途中（提交 → 新列表上屏 → 解冻）：期间不再发起下一次提交 */
  const commitInFlightRef = useRef(false);
  const swipeT0Ref = useRef(0);
  const curIdxRef = useRef(0);
  curIdxRef.current = curIdx;
  /** 头部区（hero + 预算）实测高度：邻页预览 / 日历弹层都贴在它正下方 */
  const [heroH, setHeroH] = useState(0);
  const pagerRestRef = useRef<(idx: number) => void>(() => {});
  const pagerOpenRef = useRef<() => void>(() => {});
  const activeCurrencyRef = useRef(activeCurrency);
  activeCurrencyRef.current = activeCurrency;
  const totalsRef = useRef(totalsByCurrency);
  totalsRef.current = totalsByCurrency;
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 翻页动画落定（UI 线程回调进来）：不立刻提交，停稳 PAGER_COMMIT_DEBOUNCE_MS 且没有新手势才提交一次。
  // 提交 = 冻结真列表（预览顶上）→ setNetWorthCurrency → 新列表画上屏（两帧）→ 解冻交接（见币种变化 effect）。
  // 期间新手势照常进来；它结束后会再次走到这里重新计时。
  pagerRestRef.current = (idx: number) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    const attempt = () => {
      commitTimerRef.current = null;
      // 又在拖 / 逻辑页已经不是 idx：放弃（那次手势结束后会重新计时）
      if (pagerBusy.value === 1 || pagerTargetIdx.value !== idx) return;
      // 上一次提交还在交接中：稍后再试
      if (commitInFlightRef.current) {
        commitTimerRef.current = setTimeout(attempt, 60);
        return;
      }
      const row = totalsRef.current[idx];
      if (!row || row[0] === activeCurrencyRef.current) return;
      commitInFlightRef.current = true;
      listFrozen.value = 1;
      // 记下「这次是横滑提交」：币种变化的 effect 据此跳过淡出换表，直接换数据并等上屏后无缝交接
      swipeCommitRef.current = row[0];
      if (__DEV__) {
        swipeT0Ref.current = Date.now();
        console.log(`[swipe] --- commit start ${row[0]}`);
      }
      setNetWorthCurrency(row[0]);
    };
    commitTimerRef.current = setTimeout(attempt, PAGER_COMMIT_DEBOUNCE_MS);
  };
  pagerOpenRef.current = openCurrencyMenu;
  const pagerRest = useCallback((idx: number) => pagerRestRef.current(idx), []);
  const pagerOpen = useCallback(() => pagerOpenRef.current(), []);

  const multiPage = totalsByCurrency.length > 1;
  const reduceMotion = motion.reduceMotion;
  /** 整卡横向手势分页：Pan 挂在渐变卡外层，命中区域 = 整张卡（金额 + 预算一起跟手） */
  const pagerPanGesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(multiPage)
      .activeOffsetX([-PAGER_ACTIVATE_OFFSET, PAGER_ACTIVATE_OFFSET])
      // 竖向超过 14 就放弃 → 竖向滚动交给外层列表
      .failOffsetY([-12, 12])
      .onStart(() => {
        // 任何时候都可以开始新的一拖（包括翻页动画途中、提交交接途中）：先停在途动画，从停下的位置继续
        cancelAnimation(pagerX);
        pagerBusy.value = 1;
        swipeActive.value = 1;
        pagerStart.value = pagerX.value;
      })
      .onUpdate((e) => {
        const w = pagerW.value;
        // translationX 从手指按下算起，含激活前的 4px → 扣掉，保证拖动连续
        const tx = e.translationX - (e.translationX > 0 ? PAGER_ACTIVATE_OFFSET : -PAGER_ACTIVATE_OFFSET);
        const min = -(pagerN.value - 1) * w;
        let nx = pagerStart.value + tx;
        // 两端橡皮筋：越界部分只跟 35%
        if (nx > 0) nx = nx * 0.35;
        else if (nx < min) nx = min + (nx - min) * 0.35;
        pagerX.value = nx;
      })
      .onEnd((e) => {
        const w = pagerW.value;
        if (w <= 0) {
          pagerBusy.value = 0;
          return;
        }
        const n = pagerN.value;
        const v = e.velocityX;
        const tx = e.translationX - (e.translationX > 0 ? PAGER_ACTIVATE_OFFSET : -PAGER_ACTIVATE_OFFSET);
        // 从「逻辑页」（动画目标页；没有动画就是当前页）±1：位移过 3% 页宽，或沿滑动方向的速度 > 80 → 翻到相邻页；
        // 否则回到逻辑页。无论甩得多快都只翻一页（经典分页轮播），连续快速翻页每次也只前进一页
        const startIdx = pagerTargetIdx.value;
        const dir = tx !== 0 ? (tx < 0 ? 1 : -1) : v < 0 ? 1 : -1;
        const flick = (dir === 1 && v < -PAGER_FLICK_V) || (dir === -1 && v > PAGER_FLICK_V);
        const flip = Math.abs(tx) > PAGER_DIST_FRAC * w || flick;
        let idx = flip ? startIdx + dir : startIdx;
        if (idx < 0) idx = 0;
        if (idx > n - 1) idx = n - 1;
        pagerTargetIdx.value = idx;
        const target = -idx * w;
        if (reduceMotion) {
          pagerX.value = target;
          pagerBusy.value = 0;
          runOnJS(pagerRest)(idx);
          return;
        }
        // 只有动画自然结束才通知 JS 计时提交；被新手势打断（finished=false）不通知
        pagerX.value = withTiming(target, { duration: PAGER_SETTLE_MS, easing: PAGER_SETTLE_EASE }, (finished) => {
          pagerBusy.value = 0;
          if (finished) runOnJS(pagerRest)(idx);
        });
      });
    return pan;
  }, [multiPage, reduceMotion, pagerRest]);

  /** 金额区那颗 tap（打开币种面板）现在挂在 HeroCardPage 的**金额槽**上（见 HeroCardPage 的 amountTap）：
   *  挂到整条金额行会把预算槽一起罩住 —— 点预算槽同时触发预算槽自己的 Pressable 和这颗 Tap，
   *  两个抽屉一起开、遮罩互相打架（根因）。tap 必须是金额槽的子节点，不进预算槽 */

  // 页宽 / 页数变化（首次测量、增减币种）：瞬时对准当前页，不播动画
  useEffect(() => {
    if (amountRowW <= 0) return;
    // 拖动 / 翻页中只更新宽度，不动 pagerX（否则在途动画会被砍掉）
    if (pagerBusy.value) {
      pagerW.value = amountRowW;
      return;
    }
    const wanted = netWorthCurrency ?? defaultNetWorthCurrency;
    const idx = Math.max(0, totalsByCurrency.findIndex(([c]) => c === wanted));
    cancelAnimation(pagerX);
    pagerN.value = Math.max(1, totalsByCurrency.length);
    pagerTargetIdx.value = idx;
    pagerX.value = -idx * amountRowW;
    // 先写 X 再写宽：reaction 读到 w>0 时 X 已经是目标位置
    pagerW.value = amountRowW;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountRowW, totalsByCurrency.length]);

  // 外部换页（币种面板选币 / 默认币种变化）：短动画滑到目标页；拖动提交后的同位调用是 no-op
  useEffect(() => {
    // 横滑提交引起的币种变化：页条已经在用户停的位置（甚至已经翻到下一页），不能再把它拉回来
    if (swipeCommitRef.current) return;
    if (amountRowW <= 0 || totalsByCurrency.length === 0) return;
    const wanted = netWorthCurrency ?? defaultNetWorthCurrency;
    const idx = Math.max(0, totalsByCurrency.findIndex(([c]) => c === wanted));
    const target = -idx * amountRowW;
    // 已经在目标页（拖动提交后的同位调用）：不再动画
    if (Math.abs(pagerX.value - target) < 0.5) return;
    cancelAnimation(pagerX);
    pagerTargetIdx.value = idx;
    pagerX.value = reduceMotion ? target : withTiming(target, { duration: 200, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netWorthCurrency, defaultNetWorthCurrency]);
  // 币种面板行：默认币种（账本基础货币）排第一，其余保持原顺序；搜索按代码 / 中英文名过滤
  const currencySheetRows = useMemo(() => {
    const q = currencyQuery.trim().toLowerCase();
    const rows = totalsByCurrency.filter(([code]) => {
      if (!q) return true;
      const zhName = CURRENCY_OPTIONS.find((c) => c.code === code)?.name ?? '';
      const enName = getEnglishCurrencyName(code) ?? '';
      return code.toLowerCase().includes(q) || zhName.toLowerCase().includes(q) || enName.toLowerCase().includes(q);
    });
    const baseIdx = rows.findIndex(([c]) => c === currency);
    if (baseIdx > 0) {
      const [base] = rows.splice(baseIdx, 1);
      if (base) rows.unshift(base);
    }
    return rows;
  }, [totalsByCurrency, currencyQuery, currency]);
  // 交易所属币种（按账户币种；账户缺失时跟随全局货币）。getAssetById 已按 assets 稳定（见上），
  // 所以这个回调只在资产 / 全局货币真变时才换身份 —— 它进 dayGroups 的依赖数组，
  // 身份乱换会让 sections 重建、列表整表重渲染（验收退回的性能项：切 Tab / 切币种卡）
  const txCurrencyOf = useCallback(
    (t: { assetId?: string }) => (t.assetId ? getAssetById(t.assetId)?.currency : undefined) ?? currency,
    [getAssetById, currency]
  );
  // 本月支出按币种一次算出（真列表头、预算卡各页、邻页预览共用；每笔账单只走一遍）
  const expenseByCurrency = useMemo(() => {
    const m = new Map<string, number>();
    ledgerTransactions.forEach((t) => {
      if (t.type !== 'expense' || !t.date.startsWith(thisMonthKey)) return;
      const c = txCurrencyOf(t);
      m.set(c, (m.get(c) ?? 0) + t.amount);
    });
    return m;
  }, [ledgerTransactions, thisMonthKey, txCurrencyOf]);
  const thisExpense = expenseByCurrency.get(activeCurrency) ?? 0;
  // 本月收入按币种一次算出（与 expenseByCurrency 对称的口径：本月 + type === 'income' + 该笔所属币种）。
  // 转账单拿不到这两档类型，天然不进收支口径；已删除的账单在 context 里是真删（filter 掉，不在 transactions 里），
  // 所以这里不需要再过滤一次。
  const incomeByCurrency = useMemo(() => {
    const m = new Map<string, number>();
    ledgerTransactions.forEach((t) => {
      if (t.type !== 'income' || !t.date.startsWith(thisMonthKey)) return;
      const c = txCurrencyOf(t);
      m.set(c, (m.get(c) ?? 0) + t.amount);
    });
    return m;
  }, [ledgerTransactions, thisMonthKey, txCurrencyOf]);
  // 4 个快捷入口（参考图）：支出 / 收入 / 转账 / 扫描 —— 文案沿用 addTx.* 现有 i18n key。
  // 前三档用 ROUTES.ADD_TX 的 presetType 带出各自的初始类型（routes.ts 已声明该参数），
  // 扫描走既有的 autoScan（不带 presetType，落到默认支出档后自动开相机）。
  const quickLabels = useMemo<Record<QuickActionKey, string>>(
    () => ({
      expense: t('addTx.expense'),
      income: t('addTx.income'),
      transfer: t('addTx.transfer'),
      scan: t('addTx.scanReceipt'),
    }),
    [t]
  );
  // 动作分档保留原来的 switch 语义：一个入口 → 一条既有的「记一笔」路径，不新增路由
  const handleQuickAction = useCallback(
    (key: QuickActionKey) => {
      switch (key) {
        case 'expense':
          navigation.navigate(ROUTES.ADD_TX, { presetType: 'expense' });
          break;
        case 'income':
          navigation.navigate(ROUTES.ADD_TX, { presetType: 'income' });
          break;
        case 'transfer':
          navigation.navigate(ROUTES.ADD_TX, { presetType: 'transfer' });
          break;
        case 'scan':
          navigation.navigate(ROUTES.ADD_TX, { autoScan: true });
          break;
      }
    },
    [navigation]
  );
  // 搜索 / 全部交易抽屉的行（只读）：备注 / 分类 · 账户 / 金额 / 日期 —— 点击进既有「编辑账单」页。
  // 顺序按日期倒序（= 首页列表的顺序）：接口返回的是写入序，「全部交易」铺开上百条时那个顺序是乱的；
  // 同一天内保持原顺序（Array#sort 稳定）
  const searchRows = useMemo<SearchRow[]>(
    () =>
      [...ledgerTransactions]
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
        .map((tx) => {
          const cat = getCategoryById(tx.categoryId);
          const asset = tx.assetId ? getAssetById(tx.assetId) : undefined;
          const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
          return {
            id: tx.id,
            title: tx.note?.trim() || catName,
            subtitle: [catName, asset?.name].filter(Boolean).join(' · '),
            amount: tx.amount,
            kind: (tx.type === 'income' ? 'income' : 'expense') as 'income' | 'expense',
            dateText: tx.date,
            icon: (cat?.icon ?? UNCATEGORIZED_ICON) as IconName,
            color: cat?.color ?? UNCATEGORIZED_COLOR,
          };
        }),
    [ledgerTransactions, getCategoryById, getAssetById, t]
  );
  // 某币种的预算：每个币种各存一条；老数据没有 currency 字段的条目跟随全局设置货币
  const budgetOf = useCallback(
    (code: string) => budgets.find((b) => b.categoryId === 'total' && (b.currency ?? currency) === code)?.amount ?? 0,
    [budgets, currency]
  );
  const totalBudget = budgetOf(activeCurrency);

  // ---------- 月度预算 · 分类额度（只读派生，不改任何写入路径）----------
  // 本月该币种「每个分类」的支出合计：口径与上面的 expenseByCurrency 完全一致
  // （本月 + type === 'expense' + 该笔所属币种 = 当前币种），只是再按 categoryId 分组。
  const expenseByCategory = useMemo(() => {
    const m = new Map<string, number>();
    ledgerTransactions.forEach((t) => {
      if (t.type !== 'expense' || !t.date.startsWith(thisMonthKey)) return;
      if (txCurrencyOf(t) !== activeCurrency) return;
      const key = t.categoryId || 'uncategorized';
      m.set(key, (m.get(key) ?? 0) + t.amount);
    });
    return m;
  }, [ledgerTransactions, thisMonthKey, txCurrencyOf, activeCurrency]);

  // 已设额度的分类（budgets 里 categoryId !== 'total' 的条目；额度按币种各存一条）。
  // 排序：使用率高的在前（超支的最先看到）。
  const categoryBudgetRows = useMemo(
    () =>
      budgets
        .filter((b) => b.categoryId !== 'total' && (b.currency ?? currency) === activeCurrency && b.amount > 0)
        .map((b) => {
          const cat = categories.find((c) => c.id === b.categoryId);
          return {
            categoryId: b.categoryId,
            name: cat ? getCategoryLabel(cat, t) : b.categoryId,
            icon: cat?.icon,
            color: cat?.color,
            limit: b.amount,
            used: expenseByCategory.get(b.categoryId) ?? 0,
          };
        })
        .sort((a, b) => b.used / (b.limit || 1) - a.used / (a.limit || 1)),
    [budgets, categories, currency, activeCurrency, expenseByCategory, t]
  );

  // 未设额度但本月有支出的支出分类（抽屉里一键加额度，最多 8 条）
  const unsetCategoryRows = useMemo(() => {
    const withLimit = new Set(categoryBudgetRows.map((r) => r.categoryId));
    return categories
      .filter((c) => c.type === 'expense' && !withLimit.has(c.id) && (expenseByCategory.get(c.id) ?? 0) > 0)
      .map((c) => ({
        categoryId: c.id,
        name: getCategoryLabel(c, t),
        icon: c.icon,
        color: c.color,
        used: expenseByCategory.get(c.id) ?? 0,
      }))
      .sort((a, b) => b.used - a.used)
      .slice(0, 8);
  }, [categories, categoryBudgetRows, expenseByCategory, t]);

  // 账单：按天分组（倒序）→ SectionList 的 sections（T09 / H4 / H6）。
  // 头部合计只算净资产卡当前选中币种；条目本身也只保留该币种（既有行为不变）。
  // 日期标签一律走 formatDate（今天 / 昨天 / 10月7日 周三）；跨月再插一条月份分隔（本月首次出现时给）
  // 先按天分好（倒序、剔转账），各币种只在这上面再过滤，不再每个币种重扫全部账单。
  const txByDate = useMemo(() => {
    const byDate = new Map<string, typeof ledgerTransactions>();
    ledgerTransactions.forEach((t) => {
      if (t.type === 'transfer') return;
      const list = byDate.get(t.date) ?? [];
      list.push(t);
      byDate.set(t.date, list);
    });
    return Array.from(byDate.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [ledgerTransactions]);
  const buildDayGroups = useCallback((activeCode: string): TxDaySection[] => {
    // 先分组求合计，再剔掉「该币种当天没有任何交易」的日子，最后才排「跨月月份分隔」——
    // 否则被剔掉的那天会白白吃掉 prevMonth 的更新，导致后面同月的组拿不到分隔标签
    const groups = txByDate
      .map(([date, allItems]) => {
        const items = allItems.filter((t) => txCurrencyOf(t) === activeCode);
        const expense = items
          .filter((t) => t.type === 'expense')
          .reduce((s, t) => s + t.amount, 0);
        const income = items
          .filter((t) => t.type === 'income')
          .reduce((s, t) => s + t.amount, 0);
        return { date, expense, income, currency: activeCode, items };
      })
      .filter((g) => g.items.length > 0);

    let prevMonth = '';
    return groups.map((g, index) => {
      const month = g.date.slice(0, 7);
      let monthSep: string | null = null;
      if (month !== prevMonth) {
        prevMonth = month;
        // %{m} 取 date.months（中文「10月」/ 英文「Oct」），模板在本页 home 块里
        monthSep = t('home.monthSep', { y: g.date.slice(0, 4), m: t(`date.months.${Number(g.date.slice(5, 7)) - 1}`) });
      }
      // 日期头两段式（V2 稿「今天 10月10日 周六」）：相对词（今天/昨天）当主标，
      // 具体日期补在后面；非相对日期时 formatDate 本身就带全，副段留空不重复
      const label = formatDate(g.date, homeLang);
      const fullLabel = formatDate(g.date, homeLang, { relative: false });
      // 设计稿 01 屏的分组条左段读作「10月19日 · 今天」：日期在前、相对词在后（旧版是「今天 · 10月19日 周六」）
      const monthDay = formatDate(g.date, homeLang, { style: 'monthDay', relative: false });
      // 首/末组标记：列表卡的上下 26 圆角挂在首组日期头与末组最后一行的**自己身上**
      //（SectionList 的每一格都是独立节点，卡壳只能这样拼）—— 见 renderDayHeader / TxRow
      return {
        ...g,
        label,
        dateSub: label === fullLabel ? null : fullLabel,
        monthDay,
        monthSep,
        data: g.items,
        isFirst: index === 0,
        isLast: index === groups.length - 1,
      };
    });
    // ⚠ t 是全局稳定引用：依赖数组必须带 homeLang，切语言后日期与月份分隔才会重算
  }, [txByDate, txCurrencyOf, homeLang, t]);
  // 每个币种的分组一次算好（邻页预览直接取用；真列表用的就是其中当前币种那份）
  const dayGroupsMap = useMemo(() => {
    const m = new Map<string, TxDaySection[]>();
    totalsByCurrency.forEach(([code]) => m.set(code, buildDayGroups(code)));
    return m;
  }, [totalsByCurrency, buildDayGroups]);
  const dayGroups = useMemo(
    () => dayGroupsMap.get(activeCurrency) ?? buildDayGroups(activeCurrency),
    [dayGroupsMap, activeCurrency, buildDayGroups]
  );

  // ── 切币种列表过渡：旧列表淡出 → 换数据 → 下一帧起上升入场（只动列表格子，头部 / 预算卡不动）──
  // 列表真正显示的分组（listSections，见下）直接在渲染期推导：平时 = 当前 dayGroups（数据变化同一次渲染就上屏，
  // 不再靠 effect 里 setState 多渲染一轮）；切币种的淡出过渡期间（holdOldRef）冻结在上一次显示的分组上，换数据时才放开。
  const holdOldRef = useRef(false);
  const listOutP = useSharedValue(1); // 旧列表淡出 1→0；新列表上升前保持 0（布局在透明状态下完成）
  const listInT = useSharedValue(1); // 新列表上升 0→1（1 = 静止）
  // 日历 ⇄ 列表 = 两张对称的「弹层」：各自有竖向位移（Y）与不透明度（O）两个共享值，
  // 进场（谁进来谁用）：从下方 min(480, 屏高×0.6) 升到 0、不透明度 0.6→1（420ms 缓出）；
  // 离场（谁离开谁用）：下沉 36、不透明度精确淡到 0（260ms 加速）。每个值都从「当前值」出发，连点不会跳。
  // calP 只给遮罩用（0.25 × 日历进度）；viewP（0 = 列表 / 1 = 日历）给开关图标做 UI 线程交叉淡入淡出。
  const calP = useSharedValue(0);
  const calY = useSharedValue(CAL_LIST_LIFT);
  const calO = useSharedValue(0);
  const listY = useSharedValue(0);
  const listO = useSharedValue(1);
  const viewP = useSharedValue(0);
  const calLiftSV = useSharedValue(CAL_LIFT_MAX);
  const calTarget = useSharedValue(0); // 开关的目标状态（1 = 日历）：UI 线程点按据此决定开 / 关
  const calReady = useSharedValue(0); // 1 = 日历卡已挂载好，可以直接在 UI 线程起动画
  const listTransitionRef = useRef(false);
  const pendingRiseRef = useRef(false);
  const riseGenRef = useRef(0);
  const [riseTick, setRiseTick] = useState(0);
  const dayGroupsRef = useRef(dayGroups);
  dayGroupsRef.current = dayGroups;
  const prevListCurrencyRef = useRef(activeCurrency);
  // 淡出结束：只换数据，不在这一帧起动画（换数据会重渲染整张列表，不能和动画起点撞在一起）
  const swapInList = useCallback(() => {
    pendingRiseRef.current = true;
    holdOldRef.current = false;
    setRiseTick((n) => n + 1);
  }, []);
  // 新数据已经提交渲染后，等两帧（确保画上屏）再起上升动画
  useEffect(() => {
    if (!pendingRiseRef.current) return;
    pendingRiseRef.current = false;
    const gen = riseGenRef.current;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (gen !== riseGenRef.current) return;
        listTransitionRef.current = false;
        listOutP.value = 1;
        listInT.value = 0;
        listInT.value = withTiming(1, { duration: LIST_RISE_MS, easing: LIST_RISE_EASE });
      })
    );
  }, [riseTick, listOutP, listInT]);
  // 非横滑换币种（币种面板 / 账本切换 / 数据变化）：邻页预览与 UI 线程基准页跟着换。
  // 必须排在下面「币种变化」effect 之前：横滑提交时 swipeCommitRef 还没被消费，这里就跳过，
  // 等新列表上屏后由 endSwipe 统一交接（否则基准页提前变，真列表会错位一页）
  useEffect(() => {
    if (swipeCommitRef.current) return;
    const idx = Math.max(0, curIdx);
    listIdxSV.value = idx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curIdx, totalsByCurrency.length]);
  // 币种变化（挂载时不播）：旧列表淡出；二次切换会取消上一段（riseGen 让未执行的上升作废）
  useEffect(() => {
    if (prevListCurrencyRef.current === activeCurrency) return;
    prevListCurrencyRef.current = activeCurrency;
    if (swipeCommitRef.current === activeCurrency) {
      // 横滑提交：真列表此刻在屏幕外（位移 = 一页），邻页预览正显示着同一份内容 ——
      // 这里不淡出、不上升，直接换数据；等新列表真的画上屏（两帧）再把真列表移回原位、隐藏预览
      swipeCommitRef.current = null;
      if (__DEV__) console.log(`[swipe] react commit→effects ${Date.now() - swipeT0Ref.current}ms (target ${activeCurrency}, ${dayGroups.length} day groups)`);
      riseGenRef.current += 1;
      pendingRiseRef.current = false;
      cancelAnimation(listOutP);
      cancelAnimation(listInT);
      listTransitionRef.current = false;
      listOutP.value = 1;
      listInT.value = 1;
      holdOldRef.current = false;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          // 交接：先告诉 UI 线程真列表装的是哪一页，再解冻 —— 真列表回到它自己那一页的位置（用户若已翻走，它就在屏幕外）
          listIdxSV.value = Math.max(0, curIdxRef.current);
          listFrozen.value = 0;
          commitInFlightRef.current = false;
          if (__DEV__) console.log(`[swipe] commit→handoff ${Date.now() - swipeT0Ref.current}ms`);
        })
      );
      return;
    }
    riseGenRef.current += 1;
    pendingRiseRef.current = false;
    cancelAnimation(listOutP);
    cancelAnimation(listInT);
    if (motion.reduceMotion) {
      listTransitionRef.current = false;
      listOutP.value = 1;
      listInT.value = 1;
      holdOldRef.current = false;
      setRiseTick((n) => n + 1); // 触发一次渲染，让列表换成新币种的分组
      return;
    }
    listTransitionRef.current = true;
    holdOldRef.current = true;
    listOutP.value = withTiming(0, { duration: LIST_FADE_MS, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(swapInList)();
    });
  }, [activeCurrency, listOutP, listInT, swapInList, motion.reduceMotion]);
  // 列表分组：币种刚变（本次渲染还没来得及起淡出）或淡出过渡中 → 停在上一次显示的分组；其余时候 = 当前 dayGroups。
  // 横滑提交（swipeCommitRef === activeCurrency）不走淡出，直接用新分组。
  const currencyJustChanged = prevListCurrencyRef.current !== activeCurrency && swipeCommitRef.current !== activeCurrency;
  const lastListGroupsRef = useRef(dayGroups);
  const listSections = holdOldRef.current || currencyJustChanged ? lastListGroupsRef.current : dayGroups;
  lastListGroupsRef.current = listSections;
  const TxSeparatorFaded = useMemo(
    () =>
      function TxSeparatorFadedItem() {
        return (
          <ListFx outP={listOutP} rise={listInT} listY={listY} listO={listO} shiftX={listShiftX}>
            <TxSeparator />
          </ListFx>
        );
      },
    [listOutP, listInT, listY, listO, listShiftX]
  );

  // 视图切换时把列表滚回顶部用（只读调用 scrollToOffset，不影响既有滚动行为）
  const listRef = useRef<SectionList<Transaction, TxDaySection>>(null);

  // ── H8：从记一笔返回后，新增的那一行闪一下（500ms 淡紫底）──
  // 判定用「离开首页前记下的 id 集合」比对：只在首页失焦期间新增的账单会闪，
  // 首次载入 / 切 Tab 回来 / 编辑已有账单都不闪（编辑后 id 不变）。
  const knownTxIdsRef = useRef<Set<string> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flashTxId, setFlashTxId] = useState<string | null>(null);
  const rememberTxIds = useCallback(() => {
    knownTxIdsRef.current = new Set(transactions.map((t) => t.id));
  }, [transactions]);
  useEffect(() => {
    // 本地数据读完先建一次基线（首屏不闪任何行）
    if (!dataLoading && knownTxIdsRef.current === null) rememberTxIds();
  }, [dataLoading, rememberTxIds]);
  useFocusEffect(
    useCallback(() => {
      const known = knownTxIdsRef.current;
      if (known && !dataLoading) {
        const added = transactions.filter((t) => !known.has(t.id));
        if (added.length > 0) {
          // 连记多笔时只闪最新的一笔（createdAt 降序取首）
          const newest = added.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
          setFlashTxId(newest.id);
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => setFlashTxId(null), FLASH_ROW_MS);
        }
      }
      if (!dataLoading) rememberTxIds();
      return () => {
        // 离开首页：清闪 + 记下当前 id 集合，供下次回来比对
        if (flashTimerRef.current) {
          clearTimeout(flashTimerRef.current);
          flashTimerRef.current = null;
        }
        setFlashTxId(null);
        rememberTxIds();
      };
    }, [transactions, dataLoading, rememberTxIds])
  );

  // ── 账单行（V2）：TxRow —— 标题 = 备注（无备注用类别名）、副标题 = 类别 · 账户、
  //    支出中性色「−」/ 收入绿「+」；单击即编辑（与长按同一入口），长按保留；命中闪行时加淡紫底 ──
  // 行本体（真列表与两侧「邻页」预览共用同一份，保证横滑落定时首屏几行逐像素一致）
  const buildTxRow = useCallback((item: Transaction, index: number, section: TxDaySection, flash: boolean) => {
    const cat = getCategoryById(item.categoryId);
    const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
    const catIcon = (cat?.icon ?? UNCATEGORIZED_ICON) as IconName;
    const catColor = cat?.color ?? UNCATEGORIZED_COLOR;
    const assetName = item.assetId ? getAssetById(item.assetId)?.name : undefined;
    const openEdit = () => navigation.navigate(ROUTES.ADD_TX, { editTransaction: item });
    // 标题 = 备注（计划付款的 displayName 也当备注用）；两者都没有时标题落到类别名，
    // 这时副标题只显示账户、不再把类别写第二遍（验收小修：原来是「Dining / Dining · Maybank 储蓄」）。
    // 副标题固定是「类别 · 账户」拼接，把 categoryName 传空串即只剩账户
    const ownTitle = item.note?.trim() || item.displayName?.trim() || '';
    const hasOwnTitle = ownTitle.length > 0;
    // 列表卡底边 = 末组最后一行：26 下圆角 + 4pt 卡底边（稿里卡内 padding 下 4）
    const isCardBottom = !!section.isLast && index === (section.data?.length ?? 0) - 1;
    return (
      <TxRowMemo
        title={hasOwnTitle ? ownTitle : catName}
        categoryName={hasOwnTitle ? catName : ''}
        categoryIcon={catIcon}
        categoryColor={catColor}
        accountName={assetName}
        showDivider={index !== 0}
        amount={item.amount}
        kind={item.type === 'income' ? 'income' : 'expense'}
        flash={flash}
        isCardBottom={isCardBottom}
        onPress={openEdit}
        testID={`tx-row-${item.id}`}
      />
    );
  }, [t, getCategoryById, getAssetById, navigation]);

  const renderTxRow = useCallback(({ item, index, section }: { item: Transaction; index: number; section: TxDaySection }) => (
    <ListFx outP={listOutP} rise={listInT} listY={listY} listO={listO} shiftX={listShiftX}>
      {buildTxRow(item, index, section, item.id === flashTxId)}
    </ListFx>
    // 依赖：渲染期读到的都列进来；stable 的 renderItem 让 VirtualizedList 的 CellRenderer
    //（PureComponent，比较 renderItem 身份 + item 身份）在滚动 / 切 Tab 时跳过重渲染
  ), [buildTxRow, flashTxId, listOutP, listInT, listY, listO, listShiftX]);

  // 日期头（V2 稿）：左「今天」（15/500）+ 紧跟的「10月10日 周六」（caption 弱化色），
  // 右侧「支出 43.60」（caption 次要色，收入仍用收入绿）—— wrap 行：放不下自动换行，不缩字不省略；
  // 跨月时在日期头之上再插一条月份分隔
  const renderDayHeader = useCallback(({ section }: { section: TxDaySection }) => (
    // 日期头属于「最近交易」这根统一面板的一段（面板底 + 左右 1px 描边 + 零圆角）：
    // 面板的上圆角在 RecentHeader 那一格、下圆角在末组最后一行，日期头只做卡身
    <View style={styles.dayHeaderWrap}>
      {!!section.monthSep && (
        <AppText variant="caption" color={palette.textSecondary} style={styles.monthSepText}>
          {section.monthSep}
        </AppText>
      )}
      {/* 轻量分组头（参考图没有填充色块）：左「10月19日 · 今天」12/500 弱化色；
          右「支出 6.20」12/500 同一弱化色（合计口径一字未改），同一行两端分开 */}
      <View style={styles.dayGroupPill}>
        <AppText
          variant="caption"
          weight="500"
          color={palette.textTertiary}
          style={styles.dayHeaderLabelText}
          numberOfLines={1}
        >
          {section.dateSub ? `${section.monthDay} · ${section.label}` : section.label}
        </AppText>
        <AppText variant="caption" weight="500" color={palette.textTertiary} numberOfLines={1} style={styles.daySumText}>
          {`${t(section.expense > 0 ? 'home.expenseShort' : 'home.incomeShort')}${fmtMoney(
            section.expense > 0 ? section.expense : section.income,
            { showCurrency: false }
          )}`}
        </AppText>
      </View>
    </View>
  ), [palette, styles, t]);

  // 列表内的日期头：切币种过渡时跟着列表淡出 / 上滑（吸顶条 / pinnedHeader 仍直接用 renderDayHeader，不动）
  const renderSectionHeaderEntering = useCallback(
    ({ section }: { section: TxDaySection }) => (
      <ListFx outP={listOutP} rise={listInT} listY={listY} listO={listO} shiftX={listShiftX}>
        {renderDayHeader({ section })}
      </ListFx>
    ),
    [renderDayHeader, listOutP, listInT, listY, listO, listShiftX]
  );

  // 行间发丝分割线 = 模块作用域的 TxSeparator（稳定组件标识，见其定义处注释）

  // ── 吸顶日期头（T09 / H4）──
  // 不用 SectionList 自带的 stickySectionHeadersEnabled：react-native-web 的 position:sticky 包在
  // 虚拟化列表里会错位（自检实测：两条日期头叠着钉在顶部）。改成自己画一条「吸顶条」——
  // onViewableItemsChanged 给出「当前可见的第一项」，它属于哪一组就钉哪一组的日期头：
  //   · 第一项是 Hero（section 为空）→ 不显示（首屏顶部还给 Hero 卡）
  //   · 否则钉住那一组的日期头（含跨月月份分隔）—— web / 原生行为一致，且不是每帧 setState
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1, minimumViewTime: 0 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ section?: TxDaySection | null }> }) => {
      const next = viewableItems[0]?.section?.date ?? null;
      setPinnedDate((prev) => (prev === next ? prev : next));
    }
  ).current;
  const pinnedSection = pinnedDate ? dayGroups.find((g) => g.date === pinnedDate) ?? null : null;
  // Hero 卡实测高度 + 「列表已滚过 Hero」判定：吸顶条只在 Hero 完全滚出顶部后才显示。
  // ⚠ 不能只看 viewability：数据量大（1000 笔）时视图化时序会让「第一可见项」在首帧就报成某一组，
  //    吸顶条会叠在 Hero 上（自检抓到）。这里用滚动位置 vs Hero 高度显式判定，跨数据量都确定。
  const heroHeightRef = useRef(0);
  const [heroPassed, setHeroPassed] = useState(false);
  // 日历视图（详情 ⇄ 日历切换，HTML 原型拍板形态）──
  // 只在日历模式消费 dayGroups 派生数据，账单列表及其全部逻辑零改动。
  // viewMonth 独立记忆：切回详情再进来月份不重置
  // 日历底部弹层（见上面 calY / calO / listY / listO 的说明）：
  //  · 日历卡与列表都常驻挂载、数据原样保留（不清 sections、不挂载 / 卸载），关闭的那一层 opacity 精确为 0；
  //  · 点按在 UI 线程直接起动画（共享值），触感 fire-and-forget。切换路径上不写任何 React state：
  //    按钮的无障碍选中态在按钮自己里维护（selectedSV），弹层的 pointerEvents 在 CalPointerGate 里维护，
  //    列表顶部日期头跟 listO 淡出，日历邻页常驻挂载（只随 listO / calO 淡入淡出）——所以一次切换不会重渲整个首页。
  //  · 日历卡是绝对定位（贴在列表起点），不占布局，列表区不会跳动。
  const [calMounted, setCalMounted] = useState(false);
  // 日历是否已完全打开（列表区高度夹取用）：只在动画结束后变化，不参与动画过程
  const [calClamp, setCalClamp] = useState(false);
  // 日历模式「列表不吃点击」开关：进场动画还没走完时（calClamp 仍为 false）列表内容 opacity 0，
  // 却仍排在日历卡之上，命中测试会把翻转月份 / 药丸 / 合计行的点击吃掉（CDP 实测：进场 200ms 内
  // 点上个月按钮，命中的是下面那行 tx-row）。所以在点按那一刻就把列表置为不吃点击，
  // 不用等动画结束的 calClamp —— 两条一起保证「日历模式下列表永不接点击」。
  const [calHitInert, setCalHitInert] = useState(false);
  const [calH, setCalH] = useState(0);
  const onCalLayoutH = useCallback((h: number) => setCalH((prev) => (Math.abs(prev - h) >= 1 ? h : prev)), []);
  const calMountedRef = useRef(false);
  calMountedRef.current = calMounted;
  useEffect(() => {
    calReady.value = calMounted ? 1 : 0;
  }, [calMounted, calReady]);
  // 列表一页的间距 = 窗口宽（UI 线程读）
  useEffect(() => {
    listPitch.value = winW;
  }, [winW, listPitch]);
  // 空闲时预热日历卡（首次点开也不用现挂）
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => setCalMounted(true), 300);
    });
    return () => {
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, []);
  // 邻页日历（其余币种的日历卡）比真日历更重：在真日历预热之后再错开 1.5 秒挂载，不和首屏抢同一帧
  const [calNbMounted, setCalNbMounted] = useState(false);
  useEffect(() => {
    if (!calMounted) return;
    const t = setTimeout(() => setCalNbMounted(true), 1500);
    return () => clearTimeout(t);
  }, [calMounted]);
  const calLift = Math.min(CAL_LIFT_MAX, screenH * 0.6);
  useEffect(() => {
    calLiftSV.value = calLift;
  }, [calLift, calLiftSV]);
  const calTop = heroH;
  const calEnterStyle = useAnimatedStyle(() => ({
    // 关闭态 opacity 精确为 0（藏在屏幕下方、不画）
    opacity: calO.value,
    // translateX = 横滑换币种时日历跟着 hero 横移（平时为 0）
    transform: [{ translateX: listShiftX.value }, { translateY: calY.value }],
  }));
  const calDimStyle = useAnimatedStyle(() => ({ opacity: CAL_DIM_MAX * calP.value }));
  // 列表顶部的吸顶日期头：跟列表一起淡出（日历打开时隐藏），不再靠 React 状态条件挂载
  const pinnedFadeStyle = useAnimatedStyle(() => ({ opacity: listO.value }));
  // 列表始终挂着（日历模式下它 opacity 0）；日历打开后（calClamp 为真，只在动画结束时变一次）把列表内容高度夹成「头部 + 日历」，
  // 不会滚进一大片空白，也不会让头部被滚走。切换过程只有两次 React 更新（见 afterCalTap / finishToggle）：
  // 点按那一刻翻 calHitInert（命中测试），动画结束才翻 calClamp（高度夹取）。
  const calContentH = calH > 0 ? heroH + calH + tabClearance + 12 : 0;
  const listContentStyle = useMemo(() => {
    const clamped = calClamp && calContentH > 0;
    return {
      paddingBottom: tabClearance,
      ...(clamped
        ? {
            minHeight: calContentH,
            maxHeight: calContentH,
            overflow: 'hidden' as const,
            // 日历模式下列表内容（账单行 / 日期头 / 空状态）虽然 opacity 0，却仍盖在日历卡上层：
            // 它们是同一滚动内容里排在头部之后的兄弟块，各自又因 RNW 的 View 默认样式自成层叠上下文，
            // 日历卡里的 z-index 跳不出去 —— 命中测试会把这些「看不见的格子」排在日历前面，
            // 把分段药丸下半颗 / 合计行 / 月格的点击吃掉（CDP 实测：药丸 y 363..393，
            // 从 382 起就被 opacity 0 的日期头接走，所以点文字时不灵敏、下半颗完全点不动）。
          }
        : null),
      // 这里把整层关掉命中测试；头部层（含日历卡、hero、开关按钮）用 JSX 的 pointerEvents="auto"
      // 显式打开 —— pointer-events:none 的祖先不会连带禁掉显式声明 auto 的子树。
      // ⚠ 条件里必须带 calHitInert：夹取（calClamp）要等动画结束，而命中测试从点击那一刻就得关掉，
      //   否则进场动画期间点日历卡的按钮会掉到下面 opacity 0 的账单行上（「点了没反应」）。
      ...(calHitInert || clamped ? { pointerEvents: 'none' as const } : null),
    };
  }, [calClamp, calContentH, tabClearance, calHitInert]);
  // JS 兜底：预热没到就点了 —— 先挂上日历卡（藏着），两帧后在 UI 线程起动画
  const startSheetsRef = useRef<(open: boolean) => void>(() => {});
  const toggleCalendarJS = useCallback(
    (open: boolean) => {
      hapticLight();
      if (!calMountedRef.current) setCalMounted(true);
      // 点按那一刻就把列表置为不吃点击（进场动画期间列表 opacity 0，却仍盖在日历卡上层）
      setCalHitInert(open);
      requestAnimationFrame(() => requestAnimationFrame(() => startSheetsRef.current(open)));
    },
    []
  );
  // 动画结束之后才更新 state（可被第二次点按取消）
  // 动画结束后（JS）：只在这里碰一次 React 状态（列表高度夹取），整个切换过程本身没有重渲染
  const finishHandleRef = useRef<{ cancel: () => void } | null>(null);
  const finishToggle = useCallback(
    (open: boolean) => {
      // 动画结束的回调进来时目标已经被再次点按改掉了：这次收尾作废
      if ((calTarget.value === 1) !== open) return;
      if (finishHandleRef.current) finishHandleRef.current.cancel();
      finishHandleRef.current = InteractionManager.runAfterInteractions(() => {
        finishHandleRef.current = null;
        if ((calTarget.value === 1) !== open) return;
        React.startTransition(() => {
          setCalClamp(open);
          // 收尾同时对齐「列表不吃点击」：打开=保持关；关闭=动画走完再把点击还给列表
          setCalHitInert(open);
        });
      });
    },
    [calTarget]
  );
  // 点按后 JS 线程做的事：触感（fire-and-forget）、取消上一次还没执行的收尾
  const afterCalTap = useCallback((open: boolean) => {
    // 日历模式（含进场动画期间）列表必须不吃点击，否则点日历卡上的按钮会掉到下面的账单行
    setCalHitInert(open);
    if (__DEV__) {
      devCal.tapAt = performance.now();
      devCalLog('tap (JS)');
    }
    if (finishHandleRef.current) {
      finishHandleRef.current.cancel();
      finishHandleRef.current = null;
    }
    hapticLight();
  }, []);
  // 起动两张弹层的动画（UI 线程 worklet）：从各值当前位置出发
  const reduceMotionUI = motion.reduceMotion;
  const startSheets = useCallback(
    (open: boolean) => {
      'worklet';
      cancelAnimation(calY);
      cancelAnimation(calO);
      cancelAnimation(calP);
      cancelAnimation(listY);
      cancelAnimation(listO);
      cancelAnimation(viewP);
      const enterIn = { duration: CAL_ENTER_MS, easing: CAL_ENTER_EASE };
      const exitOut = { duration: CAL_EXIT_MS, easing: CAL_EXIT_EASE };
      const lift = calLiftSV.value;
      if (reduceMotionUI) {
        calY.value = open ? 0 : CAL_LIST_LIFT;
        calO.value = open ? 1 : 0;
        calP.value = open ? 1 : 0;
        listY.value = open ? CAL_LIST_LIFT : 0;
        listO.value = open ? 0 : 1;
        viewP.value = open ? 1 : 0;
        // ⚠ 无动画档也要走收尾：calClamp 只在 finishToggle 里翻转，漏掉它 = 列表区高度永不夹取、
        //   列表内容层永远接点击 —— 在「减弱动态效果」下点日历的翻月键/药丸会全被下面
        //   opacity 0 的账单行吃掉（用户实测「点左右翻月键切换不了月份」就是这条路）。
        runOnJS(finishToggle)(open);
        return;
      }
      viewP.value = withTiming(open ? 1 : 0, { duration: 180 });
      if (open) {
        // 日历进场：本来是藏着的才从下方起跳；还在离场途中就从当前位置接着进
        if (calO.value < 0.01) {
          calY.value = lift;
          calO.value = 0.6;
        }
        calY.value = withTiming(0, enterIn);
        calO.value = withTiming(1, enterIn);
        calP.value = withTiming(1, enterIn, (finished) => {
          if (finished) runOnJS(finishToggle)(true);
        });
        // 列表离场：下沉 36 并淡到 0
        listY.value = withTiming(CAL_LIST_LIFT, exitOut);
        listO.value = withTiming(0, exitOut);
      } else {
        // 列表进场：与日历进场同一套动作（从下方升上来）
        if (listO.value < 0.01) {
          listY.value = lift;
          listO.value = 0.6;
        }
        listY.value = withTiming(0, enterIn);
        listO.value = withTiming(1, enterIn, (finished) => {
          if (finished) runOnJS(finishToggle)(false);
        });
        // 日历离场
        calY.value = withTiming(CAL_LIST_LIFT, exitOut);
        calO.value = withTiming(0, exitOut);
        calP.value = withTiming(0, exitOut);
      }
    },
    [calY, calO, calP, listY, listO, viewP, calLiftSV, reduceMotionUI, finishToggle]
  );
  startSheetsRef.current = (open: boolean) => {
    runOnUI(startSheets)(open);
  };
  // 点按入口（UI 线程 worklet）：先起动画，再 runOnJS 做后续
  const toggleCalUI = useCallback(() => {
    'worklet';
    const open = calTarget.value !== 1;
    calTarget.value = open ? 1 : 0;
    if (calReady.value === 0) {
      // 日历卡还没预热好（极少见）：先在 JS 线程挂上，画出来再起动画
      runOnJS(toggleCalendarJS)(open);
      return;
    }
    startSheets(open);
    runOnJS(afterCalTap)(open);
  }, [calTarget, calReady, startSheets, afterCalTap, toggleCalendarJS]);
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });
  // 日历数据源：dayGroups 已按日聚合好（同币种过滤、排除转账），摊平成 Map 给日历卡
  const buildCalendarDays = useCallback(
    (groups: TxDaySection[]) => {
      const map = new Map<string, CalendarDayTotals>();
      groups.forEach((g) =>
        map.set(g.date, {
          expense: g.expense,
          income: g.income,
          // 逐笔明细（点日期展开）：字段与首页列表行一一对应，回落规则也一致——
          // 标题 = 备注（计划名也当备注用），无备注时标题落到类别名、副标题只留账户（与 T09 小修同款）
          items: g.items.map((item) => {
            const cat = getCategoryById(item.categoryId);
            const catName = cat ? getCategoryLabel(cat, t) : UNCATEGORIZED_NAME;
            const ownTitle = item.note?.trim() || item.displayName?.trim() || '';
            return {
              id: item.id,
              note: ownTitle.length > 0 ? ownTitle : catName,
              categoryName: ownTitle.length > 0 ? catName : '',
              categoryIcon: (cat?.icon ?? UNCATEGORIZED_ICON) as IconName,
              categoryColor: cat?.color ?? UNCATEGORIZED_COLOR,
              accountName: item.assetId ? getAssetById(item.assetId)?.name : undefined,
              amount: item.amount,
              type: item.type as 'expense' | 'income',
            };
          }),
        })
      );
      return map;
    },
    // ⚠ t 是全局稳定引用，依赖必须带 langMode，切语言明细标题才会重算
    [getCategoryById, getAssetById, t, homeLang]
  );
  const calendarDays = useMemo(() => buildCalendarDays(dayGroups), [dayGroups, buildCalendarDays]);
  // 当月合计：只加总 viewMonth 当月的日子（dayGroups 含跨月历史，需按月份前缀过滤）
  const monthTotalsOf = useCallback(
    (groups: TxDaySection[]) => {
      const prefix = `${viewMonth.year}-${String(viewMonth.month).padStart(2, '0')}-`;
      let expense = 0;
      let income = 0;
      groups.forEach((g) => {
        if (!g.date.startsWith(prefix)) return;
        expense += g.expense;
        income += g.income;
      });
      return { expense, income };
    },
    [viewMonth]
  );
  const calendarMonthTotals = useMemo(() => monthTotalsOf(dayGroups), [dayGroups, monthTotalsOf]);
  // 日历指标分段（支出 / 收入 / 总额）提到页面里：真日历与邻页预览显示同一个指标
  const [calSeg, setCalSeg] = useState<SegKey>('expense');
  // 日历邻页的数据：落定后（calPanelsReady）一次算好每个币种的逐日 Map 与当月合计，
  // 只在账单 / 月份 / 语言变化时重算 —— 横滑提交（换当前币种）不会让它们换身份，邻页不重渲
  const calPanelsReady = calNbMounted && totalsByCurrency.length > 1;
  const calDaysMap = useMemo(() => {
    const m = new Map<string, Map<string, CalendarDayTotals>>();
    if (!calPanelsReady) return m;
    totalsByCurrency.forEach(([code]) => m.set(code, buildCalendarDays(dayGroupsMap.get(code) ?? NO_GROUPS)));
    return m;
  }, [calPanelsReady, totalsByCurrency, dayGroupsMap, buildCalendarDays]);
  const calTotalsMap = useMemo(() => {
    const m = new Map<string, { expense: number; income: number }>();
    if (!calPanelsReady) return m;
    totalsByCurrency.forEach(([code]) => m.set(code, monthTotalsOf(dayGroupsMap.get(code) ?? NO_GROUPS)));
    return m;
  }, [calPanelsReady, totalsByCurrency, dayGroupsMap, monthTotalsOf]);
  // 真日历的稳定回调（CalendarShell 是 memo：回调身份不变，才不会在无关更新时重渲）
  const ledgerTransactionsRef = useRef(ledgerTransactions);
  ledgerTransactionsRef.current = ledgerTransactions;
  const onCalPrevMonth = useCallback(() => shiftCalendarMonthRef.current(-1), []);
  const onCalNextMonth = useCallback(() => shiftCalendarMonthRef.current(1), []);
  const onCalPressItem = useCallback(
    (id: string) => {
      // 日历明细点一行 = 进编辑（与首页列表行同一个现有入口）
      const tx = ledgerTransactionsRef.current.find((x) => x.id === id);
      if (tx) navigation.navigate(ROUTES.ADD_TX, { editTransaction: tx });
    },
    [navigation]
  );
  const shiftCalendarMonthRef = useRef<(dir: number) => void>(() => {});
  const shiftCalendarMonth = (dir: number) => {
    setViewMonth((vm) => {
      let month = vm.month + dir;
      let year = vm.year;
      if (month > 12) { month = 1; year++; }
      if (month < 1) { month = 12; year--; }
      return { year, month };
    });
  };
  shiftCalendarMonthRef.current = shiftCalendarMonth;

  // 每个账本各自的资产合计（按币种），给快速切换账本弹窗用——同一套逻辑，跟 LedgerScreen 的账本列表保持一致
  const ledgerTotals = useMemo(() => {
    const map: Record<string, [string, number][]> = {};
    ledgers.forEach((l) => {
      const totals: Record<string, number> = {};
      activeAssets
        .filter((a) => a.ledgerId === l.id)
        .forEach((a) => {
          totals[a.currency] = (totals[a.currency] || 0) + getAssetBalance(a.id);
        });
      map[l.id] = Object.entries(totals);
    });
    return map;
  }, [ledgers, activeAssets, getAssetBalance]);

  // ── 删除账本（二级密码确认）──
  // 待删除账本（点了删除并确认后进入 PIN 验证；PIN 通过才真正删除）
  const { hasPin } = useAppLock();
  const dialog = useDialog();
  const [pendingDeleteLedgerId, setPendingDeleteLedgerId] = useState<string | null>(null);
  const [pinSheetOpen, setPinSheetOpen] = useState(false);
  const pendingDeleteLedger = ledgers.find((l) => l.id === pendingDeleteLedgerId);
  // PIN 弹层模式：已设 PIN → verify 验证一次即删；未设 → create 设置（两遍输入）后
  // 切到 verify 再输一次刚设置的 PIN（确认是本人在操作），通过才删——用户定版：
  // 删除流程 PIN 只需要「输入一次验证」；首次设置的两遍输入属于"设置确认"不算验证
  const [pinSheetMode, setPinSheetMode] = useState<'verify' | 'create'>('verify');
  // create 完成后是否要接着做一次 verify（首次删除引导设置 PIN 的场景）
  const [pinVerifyAfterCreate, setPinVerifyAfterCreate] = useState(false);
  // 抑制标记：create→verify 切换时 PinSheet 内部 finishCreate 会尾随调 onClose()，
  // 这里消费掉这次"程序性关闭"，让弹层保持打开进入 verify 阶段（Verify Agent P0-1）
  const pinCreateSwitchingRef = useRef(false);
  // 删除入口：主题化弹窗展示级联范围（用户定版：连同数据一律删除），确认后弹 PIN 键盘。
  // 注意：不调生物识别——删除只认 6 位 PIN（用户定版规则）。默认账本同样可删；
  // 最后一本也能删：删完 context 会立刻补一本新的空账本，所以这里不再拦截。
  const requestDeleteLedger = (l: { id: string; name: string }) => {
    const txCount = transactions.filter((x) => x.ledgerId === l.id).length;
    const assetCount = assets.filter((x) => x.ledgerId === l.id).length;
    const planCount = paymentPlans.filter((x) => x.ledgerId === l.id).length;
    const hasData = txCount > 0 || assetCount > 0 || planCount > 0;
    const counts = { name: l.name, tx: txCount, assets: assetCount, plans: planCount };
    // 最后一本的文案要说明「删完会新建一本空白账本」，而不是假装不能删
    const msg =
      ledgers.length <= 1
        ? t('home.deleteLedgerRecreateMsg', counts)
        : hasData
          ? t('home.deleteLedgerMsg', counts)
          : t('home.deleteLedgerEmptyMsg', { name: l.name });
    dialog.alert({
      title: t('home.deleteLedger'),
      message: msg,
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('home.deleteLedgerConfirm'),
          style: 'destructive',
          onPress: () => {
            setPendingDeleteLedgerId(l.id);
            if (hasPin) {
              // 已设 PIN：验证一次即删
              setPinVerifyAfterCreate(false);
              setPinSheetMode('verify');
            } else {
              // 未设 PIN：先引导设置（两遍输入），完成后再验证一次才删
              setPinVerifyAfterCreate(true);
              setPinSheetMode('create');
            }
            setPinSheetOpen(true);
          },
        },
      ],
    });
  };
  // 二级密码验证通过：执行级联删除（context 内同时清交易/资产/计划并回落 activeLedgerId）
  // 成功震动已在 PinSheet verify 通过时触发，这里不再重复
  const performLedgerDelete = async () => {
    if (!pendingDeleteLedgerId) return;
    const name = pendingDeleteLedger?.name ?? '';
    await deleteLedger(pendingDeleteLedgerId);
    setPendingDeleteLedgerId(null);
    if (name) dialog.alert({ title: t('home.deleteLedger'), message: t('home.deleteLedgerDone') });
  };
  // PinSheet create 模式完成（PIN 已设置）：若本轮是"未设 PIN 首次删除"流程，
  // 切到 verify 再输一次刚设置的 PIN；否则（不会发生在这里，设置入口在 ProfileScreen）直接关
  const handlePinCreateDone = () => {
    if (pinVerifyAfterCreate) {
      setPinVerifyAfterCreate(false);
      // 消费 PinSheet finishCreate 尾随触发的 onClose：这次关闭是程序性的，跳过
      pinCreateSwitchingRef.current = true;
      setPinSheetMode('verify');
      // PinSheet 的 [visible, mode] 重置 effect 会清空输入状态，弹层保持打开
    } else {
      setPinSheetOpen(false);
      setPendingDeleteLedgerId(null);
    }
  };

  // ---------- 预算：常驻细长条，整块可点，弹窗用自绘计算器键盘（与资产页编辑同款）----------
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  // 算式状态：预填当前预算值（退格逐位改 / C 归零重输 / 可直接按算式），「完成」求值落库
  const budgetExpr = useAmountExpression();

  // 月度预算抽屉（总预算 + 分类额度进度条）：预算卡的整卡点按入口
  const budgetPlanOpen = activeSheet === 'budget';
  // 顶栏「搜索」抽屉（设计稿 01 屏头部动作）：只读检索，点结果进既有编辑页
  const searchOpen = activeSheet === 'search';
  // 「最近交易」标题行「查看全部」→ 全量交易抽屉（与搜索共用组件、mode='all'）。
  // ⚠ 同一个 activeSheet 单源：开它就自动关掉账本 / 币种 / 预算 / 搜索，不另开 state
  const allTxOpen = activeSheet === 'allTx';
  const openAllTx = useCallback(() => openSheet('allTx'), [openSheet]);
  // 计算器当前编辑的目标：'total' = 总预算，其余 = 该分类的额度
  const [budgetTarget, setBudgetTarget] = useState<string>('total');

  const openBudgetModalRef = useRef<(target?: string) => void>(() => {});
  const openBudgetModalStable = useCallback(() => openBudgetModalRef.current(), []);
  const openBudgetModal = (target: string = 'total') => {
    setBudgetTarget(target);
    const preset =
      target === 'total' ? totalBudget || 0 : categoryBudgetRows.find((r) => r.categoryId === target)?.limit ?? 0;
    budgetExpr.reset(preset);
    setBudgetModalOpen(true);
  };
  openBudgetModalRef.current = openBudgetModal;
  // 计算器「完成」= 求值保存：0/空 = 清掉这个币种（该分类）的预算（与旧弹窗语义一致）
  const handleBudgetConfirm = () => {
    const value = budgetExpr.confirm();
    setBudget(budgetTarget, !isNaN(value) && value > 0 ? value : 0, activeCurrency);
    setBudgetModalOpen(false);
    hapticSuccess();
  };
  // 分类额度「清除」= setBudget(categoryId, 0)（与总预算同一个写入函数，不新增写入路径）
  const handleClearCategoryBudget = useCallback(
    (categoryId: string) => {
      setBudget(categoryId, 0, activeCurrency);
      hapticSuccess();
    },
    [setBudget, activeCurrency]
  );
  // 预算槽点按 = 开月度预算抽屉；走 openSheet → 之前开着的（币种 / 账本 / 搜索）自动先关掉
  // 预算槽点按 = 开月度预算抽屉；走 openSheet → 之前开着的（币种 / 账本 / 搜索）自动先关掉
  const openBudgetPlan = useCallback(() => openSheet('budget'), [openSheet]);
  // 抽屉里点「编辑总预算」/分类行 → 先收起抽屉再开计算器（两个浮层不叠）
  const editTotalBudgetFromPlan = useCallback(() => {
    closeSheet();
    openBudgetModalStable();
  }, [openBudgetModalStable, closeSheet]);
  const editCategoryBudgetFromPlan = useCallback((categoryId: string) => {
    closeSheet();
    openBudgetModalRef.current(categoryId);
  }, [closeSheet]);

  // 未读消息数（用户定版 2026-10-06：铃铛=有消息才出现的红点条件位）。
  // 当前 App 还没有消息系统 → 恒 0（红点不渲染）；消息系统接入后把这里接到真实未读数即可
  const unreadCount: number = 0;

  // 滚动：透传给 Tab 栏自动隐藏处理器（滚动期间缓动暂停），并维护吸顶条的显示条件
  // （V2 去掉了卡下辉光呼吸 —— 那张卡不存在了，相关定时器 / Animated 循环一并删除）
  const handleHomeScroll = useCallback(
    (e: any) => {
      // 吸顶条显示条件之一：列表已经滚过头部区（值只在边界翻转一次，不会每帧 setState）
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      const passed = y >= heroHeightRef.current - 6;
      setHeroPassed((prev) => (prev === passed ? prev : passed));
      onTabScroll?.(e);
    },
    [onTabScroll]
  );

  // 无账单空状态：真列表与邻页预览共用同一份（交接时逐像素一致）
  const renderEmptyState = useCallback(
    () => (
      <EmptyState
        icon="receipt-outline"
        title={t('home.noTx')}
        description={t('home.noTxHint')}
        actionLabel={t('home.addFirst')}
        onAction={() => navigation.navigate(ROUTES.ADD_TX)}
        style={styles.listEmpty}
      />
    ),
    [t, navigation, styles]
  );
  // 各币种的账单预览（列表模式；每页只画前几行，memo 住，头部区更新不会重渲它们）：按币种代码做 key 一直挂着，
  // 提交（换当前币种）后实例原样保留。首屏只挂当前币种的左右邻居，Home 空闲后补齐其余币种
  const [previewsAll, setPreviewsAll] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setPreviewsAll(true));
    return () => task.cancel();
  }, []);
  const neighbourPanels =
    totalsByCurrency.length > 1 && amountRowW > 0
      ? totalsByCurrency.map(([code], i) => {
          if (!previewsAll && Math.abs(i - Math.max(0, curIdx)) > 1) return null;
          return (
            <SwipePanel
              key={code}
              index={i}
              listIdx={listIdxSV}
              swipeActive={swipeActive}
              frozen={listFrozen}
              shiftX={swipeShiftX}
              pitch={listPitch}
              top={heroH}
              width={winW}
              sheetO={listO}
            >
              <NeighbourList
                groups={dayGroupsMap.get(code) ?? NO_GROUPS}
                buildRow={buildTxRow}
                renderHeader={renderDayHeader}
                renderEmpty={renderEmptyState}
                headerLabel={t('home.recentTitle')}
                actionLabel={t('home.viewAll')}
                onAction={openAllTx}
              />
            </SwipePanel>
          );
        })
      : null;
  // 日历模式的邻页：其余每个币种各一张日历卡（同月份 / 同指标），按币种代码做 key 一直挂着，
  // 提交（换当前币种）后实例原样保留、没有新挂载；它们在屏幕外，随真日历一起横移
  const calNeighbourPanels =
    amountRowW > 0 && calPanelsReady
      ? totalsByCurrency.map(([code], i) => {
          const days = calDaysMap.get(code);
          const totals = calTotalsMap.get(code);
          if (!days || !totals) return null;
          return (
            <SwipePanel
              key={code}
              index={i}
              listIdx={listIdxSV}
              swipeActive={swipeActive}
              frozen={listFrozen}
              shiftX={swipeShiftX}
              pitch={listPitch}
              top={heroH}
              width={winW}
              sheetY={calY}
              sheetO={calO}
            >
              <CalendarShell
                year={viewMonth.year}
                month={viewMonth.month}
                days={days}
                monthExpense={totals.expense}
                monthIncome={totals.income}
                segKey={calSeg}
                styles={styles}
                debugName={`nb-${code}`}
                blur={false}
              />
            </SwipePanel>
          );
        })
      : null;
  if (dayGroups.length > 0) hasEverHadDataRef.current = true;
  return (
    <>
    {/* 顶部安全区不由 SafeAreaView 让位（全出血）：V2 的品牌渐变通顶连屏、状态栏压在渐变上
        （状态栏=透明，见 android styles.xml）；内容让位由头部区自身 paddingTop=insets.top 承担
        （见样式 heroTopRow 的 paddingTop 用 insets.top + 14 —— 与稿里「顶部 14」对齐） */}
    <SafeAreaView style={[styles.container, { backgroundColor: palette.pageBg }]} edges={[]}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      {/* 页面底 = palette.pageBg（日夜两值：日间冰蓝白、夜间深午夜蓝）。
          紫色全屏渐变 / 极光 shader / 玻璃 ribbons 只服务旧的紫色净资产卡，已不再渲染（文件保留可恢复） */}
      {/* 顶部光场：从左下**完全透明**斜升到右上 glowStrong（参考图右上最亮）。
          ⚠ 起点必须是透明而不是 pageBg：以前的 [pageBg → glowStrong] 在下边缘 alpha 仍为正，
            320dp 处断成一条水平硬边（夜间最明显）。现在渐变带下缘 alpha 精确为 0，接缝消失。
          绝对定位 + pointerEvents none：不吃布局、不挡点按；日夜两套值由 palette 给 */}
      {/* 顶部氛围背景（照片观感）：深蓝 → 亮蓝 → 渐隐到页面底色，另含右上暖光与两条幕墙反光带。
          它取代了原来那条纯渐变光场 —— 现在深度由背景提供，卡片本身不需要再造层次。 */}
      <HomeHeroBackdrop height={insets.top + 316} testID="home-hero-backdrop" />
      {/* 日历抽屉的浅遮罩（过渡提示）：压在页面背景之上、列表 / 卡片之下；pointerEvents none，不挡点按 */}
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: palette.scrim }, calDimStyle]} />
      {/* 顶部安全区挡板（C1）：滚动时内容不从状态栏文字下穿过。
          不用 ui/StatusBarGlass —— 它的填充取 semantic.homeBg（紫系），会在这层蓝光上糊一条灰带；
          这里用同一套「遮罩 + 渐隐」做法，颜色换成 palette.pageBg，行为（高度 / 层级 / 不吃触摸）完全一致 */}
      {insets.top > 0 ? (
        <View pointerEvents="none" style={[styles.statusGuard, { height: insets.top + 6 }]}>
          <LinearGradient
            colors={[withAlpha(palette.pageBg, 0.55), withAlpha(palette.pageBg, 0)] as const}
            locations={[0, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>
      ) : null}
      {/* 首页主体 = 一个 SectionList（T09 / H4 / H6）：
          头部（Hero 区 + 日历卡）走 ListHeaderComponent，账单按天分组渲染（吸顶日期头 + 圆形图标行）；
          滚动事件继续透传给 Tab 栏自动隐藏（T07 联动）。
          底部悬空区由 App.tsx 的 TabShell 统一预留（68+18+安全区），这里只留一点呼吸感 */}
      <SectionList<Transaction, TxDaySection>
        ref={listRef}
        // ⚠ 数据「空 → 非空」时强制重挂列表 —— 验收退回「只出前几行」的真根因：
        //   VirtualizedList 的窗口状态在挂载那一刻按当时的数据算；AppContext 读本地数据是异步的，
        //   首页首帧 sections=[] → 它的 cellsAroundViewport 被钉成 { first: 0, last: -1 }，
        //   而源码里 _scheduleCellsToRenderUpdate 要求 last >= 0 才允许扩窗口 →
        //   数据随后到达窗口也不会恢复（表现：只有首批几行、滚到底没内容；数据碰巧先到就正常，
        //   所以小数据量时像偶发 bug）。让它在有真实 sections 时用新 key 重挂一次即可解决。
        key={hasEverHadDataRef.current ? 'ready' : 'empty'}
        // 虚拟化参数（验收要求的性能档）：一屏多一点首批、8 屏窗口、每批 10 条
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={8}
        // 安卓开视图裁剪（省内存 / 提升滚动性能）；Web 上无意义且会和 RNW 的测量打架
        removeClippedSubviews={false}
        // 日历模式下 sections 为空：列表不渲染（与旧的 display:none 等价），只剩头部卡
        sections={listSections}
        keyExtractor={txKeyExtractor}
        renderItem={renderTxRow}
        renderSectionHeader={renderSectionHeaderEntering}
        /* 分隔线只由每行顶部的发丝线负责（见 TxRow 的 showDivider）：
           再挂 ItemSeparator 会和它在同一天内的行上叠成两条，看起来忽厚忽薄 */
        // 吸顶（验收定版）：原生用系统吸顶；Web 关掉系统吸顶、改由下面自绘的「吸顶条」承担
        //   —— react-native-web 给每个日期头都套 position:sticky;top:0，包含块是整个内容容器，
        //      所有日期头会永久钉在顶部互相叠着（自检抓到过双头叠影）
        stickySectionHeadersEnabled={Platform.OS !== 'web'}
        // 吸顶条只在 web 用（原生用系统吸顶）：原生不订阅可见项变化，列表换数据时少一次 setState 重渲染
        onViewableItemsChanged={Platform.OS === 'web' ? onViewableItemsChanged : undefined}
        viewabilityConfig={Platform.OS === 'web' ? viewabilityConfig : undefined}
        onScroll={handleHomeScroll}
        scrollEventThrottle={16}
        contentContainerStyle={listContentStyle}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          // 日历模式不显示空状态（列表为空是刻意的）；真没账单时才给「记第一笔」
          <ListFx outP={listOutP} rise={listInT} listY={listY} listO={listO} shiftX={listShiftX}>
            {renderEmptyState()}
          </ListFx>
        }
        ListHeaderComponent={
      <View style={styles.listHeaderLayer} pointerEvents="auto">
        {/* pointerEvents="auto"：日历模式下列表内容层被关掉命中测试（见 listContentStyle），
            头部这一层（hero / 开关按钮 / 邻页预览 / 日历弹层）必须显式打开，
            否则日历自己也点不动。列表模式下这里是 no-op（本来就能点） */}
        {/* ── 头部区（参考图，不套卡）：顶部柔和光场铺在页面最底层（见根节点 LinearGradient），
            顶部一行（账本名药丸 + 搜索/通知/日历 44 圆键）→ 文件夹资产卡（金额 + 预算 + 币种分页）
            → 4 个快捷入口 → 本月收支汇总。
            实测高度写进 heroHeightRef：吸顶日期头据此判断头部区是否已滚出屏幕 */}
        <Reanimated.View
          style={[styles.heroBlock, { paddingTop: insets.top + 8 }]}
          onLayout={(e) => {
            heroHeightRef.current = e.nativeEvent.layout.height;
            const h = e.nativeEvent.layout.height;
            setHeroH((prev) => (Math.abs(prev - h) >= 1 ? h : prev));
          }}
        >
          {/* 顶部用户区：左 = 账本名药丸（打开账本抽屉，原行为），右 = 搜索 / 通知 / 日历切换三枚 44 圆键。
              日历切换是既有功能，动作与无障碍标签一字未改 */}
          <View style={[styles.userRow, styles.heroGutter]}>
            {/* 左：账本名药丸（AccountChip）—— 与原「用户名 + 展开箭头」同一行为（打开账本抽屉） */}
            <AccountChip
              label={activeLedger?.name ?? t('home.ledgerName')}
              onPress={() => openSheet('ledger')}
              tone="glass"
              testID="home-ledger-pill"
            />
            {/* 通知：挪到账本名右手边（用户要求），与胶囊同排同高 */}
            <RoundIconButton
              kind="bell"
              tone="glass"
              onPress={() =>
                dialog.alert({ title: t('home.notificationTitle'), message: t('home.notificationMsg') })
              }
              badge={unreadCount > 0}
              accessibilityLabel={t('home.notificationTitle')}
              testID="home-notification"
            />
            <View style={styles.userRowSpacer} />
            <View style={styles.heroTopActions}>
              {/* 右：搜索 / 通知 44 圆键（surface 半透明底 + 描边 + textPrimary 图标） */}
              {/* 日夜切换（原来的搜索位）：日间显示月亮、夜间显示太阳，点一下切换并写入既有主题偏好 */}
              <RoundIconButton
                kind="theme"
                themeIcon={isDark ? 'sun' : 'moon'}
                tone="glass"
                onPress={() => setThemeMode(isDark ? 'light' : 'dark')}
                accessibilityLabel={isDark ? t('theme.light') : t('theme.dark')}
                testID="home-theme-toggle"
              />
              <GlassRoundTapButton
                iconOff="calendar-outline"
                iconOn="list-outline"
                onProgress={viewP}
                accessibilityLabel={t('home.toggleView')}
                selectedSV={calTarget}
                onTapUI={toggleCalUI}
                onActivateJS={() => {
                  hapticLight();
                  runOnUI(toggleCalUI)();
                }}
                pressSpring={motion.spring.press}
                testID="home-toggle-view"
              />
            </View>
          </View>

          {/* 资产卡（参考图）：标签行（净资产 · 币种 ⌄ + 眼睛）→ 大金额 + 该币种本月预算 + 分页圆点。
              多币种时**整卡内容**（金额 + 预算）一起跟手分页 —— Pan 挂在卡片外层，命中区域 = 整张卡。
              外壳换成「文件夹」造型（FolderAssetCard）：卡内的手势分页 / 金额 / 预算 / 币种胶囊 / 眼睛
              全部原样保留，只把颜色换成 palette 两套值；圆点也由外壳的 pager prop 画。
              左右留 8 —— 外壳内部各让 3.5% 给后方底卡，390 屏上主卡净宽约 348dp（参考图 350） */}
          <GestureDetector gesture={pagerPanGesture}>
            <View
              style={styles.heroCardGutter}
              onLayout={(e) => {
                // 拖动 / 翻页动画期间不理会宽度变化（中途改页宽会让金额盒被重新量、挤出省略号）
                if (pagerBusy.value) return;
                const w = e.nativeEvent.layout.width;
                setAmountRowW((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
              }}
            >
              <FolderAssetCard testID="home-net-worth-card">
                {(cardSize) => (
                  <>
                {displayTotal && (
                  /* 第一行（参考图）：左 = 单一币种标题；右 = 「币种 ⌄ + 眼睛」一个紧凑组。
                     币种胶囊从左侧搬到右组里 —— 眼睛不再孤零零顶到卡片最右缘，而是紧挨币种 */
                  <View
                    style={[
                      styles.heroCardHead,
                      {
                        position: 'absolute',
                        zIndex: 2,
                        left: cardSize.width * 0.088,
                        right: cardSize.width * 0.088,
                        top: cardSize.height * 0.179,
                        height: cardSize.height * 0.12,
                      },
                    ]}
                  >
                    <AppText
                      variant="caption"
                      weight="500"
                      color={onGradientMuted}
                      numberOfLines={1}
                      style={styles.heroCardHeadTitle}
                    >
                      {t('home.netWorth')}
                    </AppText>
                    <View style={styles.heroCardHeadActions}>
                      <PressableScale
                        onPress={openCurrencyMenu}
                        disabled={totalsByCurrency.length <= 1}
                        activeScale={0.94}
                        hitSlop={0}
                        accessibilityRole="button"
                        accessibilityLabel={t('home.selectCurrency')}
                        accessibilityState={{ disabled: totalsByCurrency.length <= 1 }}
                        testID="home-currency-pill"
                        // 胶囊可被挤窄：极端情况下（超长币种代码）先收标签，绝不把右侧眼睛顶出卡片
                        style={styles.heroCardHeadPill}
                      >
                        <View style={styles.pillStack}>
                          {/* 不可见占位：把**所有**币种的代码叠在一格里（高度夹成一行、溢出裁掉），
                              格子宽 = 最宽那条的真实像素宽；真正的文字是下面按页距离淡入淡出的几层 */}
                          <View style={styles.pillSpacer} pointerEvents="none">
                            {totalsByCurrency.map(([code]) => (
                              <AppText key={code} variant="caption" weight="600" color={onGradientText} style={styles.pillText} numberOfLines={1} ellipsizeMode="clip">
                                {pillLabelOf(code)}
                              </AppText>
                            ))}
                          </View>
                          {totalsByCurrency.map(([code], i) => (
                            <PillStackLabel
                              key={code}
                              index={i}
                              pos={pagerPos}
                              text={pillLabelOf(code)}
                              color={onGradientText}
                              textStyle={styles.pillText}
                            />
                          ))}
                        </View>
                        {/* 币种下拉箭头：换成首页图标集（IconChevronDown），卡上弱化色 */}
                        <IconChevronDown size={16} color={onGradientMuted} />
                      </PressableScale>
                      {/* 眼睛：IconEye / IconEyeOff —— 紧挨币种组（间距 spacing.xs）；
                          hitSlop 6 → 32 + 12 = 44 触控区，视觉盒子不变 */ }
                      <PressableScale
                        onPress={toggleBalanceHidden}
                        activeScale={0.9}
                        hitSlop={6}
                        style={[
                          styles.heroEyeBtn,
                          { alignItems: 'center', justifyContent: 'center' },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={t('home.toggleAmount')}
                        accessibilityState={{ checked: !balanceHidden }}
                        testID="home-toggle-amount"
                      >
                        {balanceHidden ? (
                          <IconEyeOff size={20} color={onGradientText} />
                        ) : (
                          <IconEye size={20} color={onGradientText} />
                        )}
                      </PressableScale>
                    </View>
                  </View>
                )}

                {totalsByCurrency.length === 0 ? (
                  /* 无账户：卡内**紧凑**空状态（图标 / 标题 / 文字按钮三件，全部定尺）。
                     旧版把共享 EmptyState 塞进绝对容器 —— 它有 56 圈图标 + 两行标题 + 44 高按钮，
                     在固定 2:1 画布里必然溢出卡外，压到下面的快捷入口上（用户实测截图）。
                     这里用 0.26H~0.10H 的盒兜住、每行 numberOfLines=1，任何宽度都不溢出。 */
                  <PressableScale
                    onPress={() => navigation.navigate(ROUTES.ADD_ASSET)}
                    activeScale={0.98}
                    hitSlop={0}
                    accessibilityRole="button"
                    accessibilityLabel={t('home.addAccount')}
                    testID="home-no-assets"
                    style={{
                      position: 'absolute',
                      left: cardSize.width * 0.088,
                      right: cardSize.width * 0.088,
                      top: cardSize.height * 0.16,
                      height: cardSize.height * 0.7,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 19,
                        flexShrink: 0,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: palette.brandSoft,
                      }}
                    >
                      <Ionicons name="wallet" size={19} color={palette.brand} />
                    </View>
                    <AppText
                      variant="subhead"
                      weight="700"
                      color={palette.textPrimary}
                      numberOfLines={1}
                      style={{ marginTop: 8, flexShrink: 0 }}
                    >
                      {t('home.noAssetsTitle')}
                    </AppText>
                    <AppText
                      variant="caption2"
                      color={palette.textSecondary}
                      numberOfLines={1}
                      style={{ marginTop: 3, flexShrink: 0 }}
                    >
                      {t('home.noAssetsHint')}
                    </AppText>
                    {/* 行动按钮：实心胶囊（40 高以内），不再用裸文字链接 —— 空状态需要一个明确的落点 */}
                    <View
                      style={{
                        marginTop: 9,
                        height: 30,
                        paddingHorizontal: 15,
                        borderRadius: 15,
                        flexShrink: 0,
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: palette.brand,
                      }}
                    >
                      <AppText variant="caption2" weight="600" color={palette.fabIcon} numberOfLines={1}>
                        {t('home.addAccount')}
                      </AppText>
                      <IconChevronRight size={13} color={palette.fabIcon} />
                    </View>
                  </PressableScale>
                ) : (
                  displayTotal && (
                    /* 一币种一页的手势分页：拖动实时跟随、按页吸附。页 = 金额 + 该币种本月预算，
                       页宽 = 行实测宽（超长金额按档降级，不溢出）；首尾相邻页由 strip 裁掉 */
                    <View
                      style={[
                        styles.heroAmountRow,
                        { position: 'absolute', zIndex: 0, left: 0, top: 0, width: cardSize.width, height: cardSize.height },
                      ]}
                      onLayout={(e) => {
                        // 拖动 / 翻页动画期间不理会行宽变化（中途改页宽会让金额盒被重新量、挤出省略号）
                        if (pagerBusy.value) return;
                        const w = e.nativeEvent.layout.width;
                        setAmountRowW((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
                      }}
                    >
                      {amountRowW > 0 && (
                        /* 「点金额开币种面板」的 tap 现在在 HeroCardPage 的金额槽里（按页挂）。
                           这里只留裁剪层：整条的 tap 会把预算槽一起罩住 → 点预算槽开两个抽屉 */
                        <Reanimated.View
                          style={[styles.heroPagerClip, { width: amountRowW }]}
                          accessible
                          accessibilityRole="button"
                          accessibilityLabel={`${t('home.netWorth')}：${
                            curRow
                              ? balanceHidden
                                ? HIDDEN_AMOUNT
                                : fmtMoney(curRow[1], { currency: curRow[0], showCurrency: true })
                              : ''
                          }`}
                          testID="home-amount"
                        >
                          <Reanimated.View
                            style={[
                              styles.heroPagerStrip,
                              { width: amountRowW * totalsByCurrency.length, minWidth: amountRowW * totalsByCurrency.length },
                              pagerStripStyle,
                            ]}
                          >
                            {totalsByCurrency.map(([code, total]) => (
                              <HeroCardPage
                                key={code}
                                code={code}
                                total={total}
                                hidden={balanceHidden}
                                width={amountRowW}
                                cardW={cardSize.width}
                                cardH={cardSize.height}
                                textColor={onGradientText}
                                mutedColor={onGradientMuted}
                                decimalColor={onGradientMuted}
                                shadow={heroShadow}
                                styles={styles}
                                budget={budgetOf(code)}
                                expense={expenseByCurrency.get(code) ?? 0}
                                onPressBudget={openBudgetPlan}
                                onPressAmount={pagerOpen}
                                testID={code === activeCurrency ? 'home-budget-card' : undefined}
                              />
                            ))}
                          </Reanimated.View>
                        </Reanimated.View>
                      )}
                    </View>
                  )
                )}
                  </>
                )}
              </FolderAssetCard>

              {/* 分页指示器：卡片**外**的独立布局区（位于所有叠层可见底边下方 12px），
                  不再画在卡内容里。复用 HeroDotFx：宽度 5→14 / 透明度随 pagerPos 连续插值，
                  手指拖动过程中就跟着走；> 7 个币种时只渲染当前窗口，不溢出。 */}
              {totalsByCurrency.length > 1 && (
                <View style={dotStyles.row} pointerEvents="none" testID="home-pager-dots">
                  {dotWindow.map((i) => (
                    <HeroDotFx key={i} index={i} pos={pagerPos} color={palette.brand} testID={`home-dot-${i}`} />
                  ))}
                </View>
              )}
            </View>
          </GestureDetector>

          {/* 4 个快捷入口（参考图）：支出 / 收入 / 转账 / 扫描 —— 视觉走 QuickActions
              （双色自绘图标 + 圆形底），动作分发仍是原来的 switch（扫描带 autoScan），
              数据入口全部走既有「记一笔」，不新增路由 */}
          <View style={[styles.quickLayer, styles.heroGutter]}>
            <QuickActions
              labels={quickLabels}
              onPress={(key) => {
                hapticLight();
                handleQuickAction(key);
              }}
            />
          </View>

        </Reanimated.View>
        {/* 「最近交易」区块标题行（设计稿 01 屏）：左标题 + 右「查看全部 ›」→ 全量交易抽屉。
            包在 ListFx 里 = 与账单行同一套进退场（日历模式跟着列表淡出、横滑时跟手）；
            没有账单时不渲染（空状态里没什么可「查看全部」的） */}
        {listSections.length > 0 && (
          <ListFx outP={listOutP} rise={listInT} listY={listY} listO={listO} shiftX={listShiftX}>
            <RecentHeader
              label={t('home.recentTitle')}
              action={t('home.viewAll')}
              onPress={openAllTx}
              testID="home-view-all"
            />
          </ListFx>
        )}
        {neighbourPanels}
        {calNeighbourPanels}
        {/* 日历弹层（常驻挂载：空闲时预热，关闭态透明 + 藏在下方 + pointerEvents none，开关只动 calP）；
            卡面 = GlassView（UI V2.1 §2：全 App 唯一毛玻璃材质，P_Calendar 稿整张日历就是一块玻璃）
            + 圆角 26 / 内衬 12·10·10（与账单列表卡同一张卡的观感） */}
        {calMounted && (
          <CalPointerGate openSV={calTarget} fadeSV={calO} style={[styles.calendarAbs, { top: calTop }, calEnterStyle]}>
            <CalendarShell
              year={viewMonth.year}
              month={viewMonth.month}
              days={calendarDays}
              monthExpense={calendarMonthTotals.expense}
              monthIncome={calendarMonthTotals.income}
              segKey={calSeg}
              styles={styles}
              onPrevMonth={onCalPrevMonth}
              onNextMonth={onCalNextMonth}
              onPressItem={onCalPressItem}
              onSegKeyChange={setCalSeg}
              selectionKey={activeCurrency}
              debugName="real"
              onLayoutH={onCalLayoutH}
            />
          </CalPointerGate>
        )}
          </View>
        }
      />
      {/* 吸顶日期头已随分组头一起去掉：列表现在是连续行，日期在每行的副标题里 */}

      {/* 账本抽屉（T10 / H11）：改用 ui/BottomSheet —— 拖动把手下拉 / 点遮罩 / 关闭键三条路径
          都先播出场动画再卸载，安全区与「打开期间强制收起浮空 Tab 栏」都由组件内部处理；
          行 = 本文件的 LedgerRow（图标圆 + 名称/结余/预设行 + 右动作列）；列表滚动交给抽屉内的 ScrollView。
          改名 / 新建 / 删除（含二级密码）/ 切换 的行为与旧版一致，一行没改 */}
      <BottomSheet
        visible={ledgerPickerOpen}
        onClose={closeLedgerPicker}
        title={t('home.selectLedger')}
        testID="ledger-sheet"
      >
        <ScrollView
          style={styles.ledgerSheetScroll}
          contentContainerStyle={styles.ledgerSheetListContent}
          showsVerticalScrollIndicator={false}
        >
          <ListSection cardStyle={styles.ledgerSheetSection}>
            {sortedLedgers.map((l) => (
              <LedgerRow
                key={l.id}
                ledger={l}
                active={l.id === activeLedgerId}
                isDefault={l.id === defaultLedgerId}
                totals={ledgerTotals[l.id] ?? []}
                renaming={renamingLedgerId === l.id}
                renameValue={renameValue}
                renameInputRef={renameInputRef}
                onRenameValueChange={setRenameValue}
                onCommitRename={commitRenameLedger}
                onStartRename={() => startRenameLedger(l.id, l.name)}
                onDelete={() => requestDeleteLedger(l)}
                onSetDefault={() => {
                  hapticLight();
                  void setDefaultLedger(l.id);
                }}
                onSelect={() => {
                  hapticLight();
                  setActiveLedgerId(l.id);
                  closeLedgerPicker();
                }}
              />
            ))}
          </ListSection>
        </ScrollView>
        {/* 新增账本：accent 渐变主按钮（与完成键 / 中央「+」同款；旧平涂紫退役）；
            逻辑不变 = 关抽屉 + 进「开设账本」页 */}
        <View style={styles.ledgerSheetFooter}>
          <GradientButton
            title={t('home.addLedger')}
            icon="add"
            onPress={() => {
              closeLedgerPicker();
              navigation.navigate(ROUTES.LEDGER);
            }}
            testID="ledger-add"
          />
        </View>
      </BottomSheet>

      {/* 预算调整弹窗：自绘计算器键盘常驻（资产页编辑同款「我的计算机」）——
          预填当前预算值，可直接按算式（如 500+300），「完成」求值保存，点遮罩取消不保存；
          无系统键盘参与，也就没有键盘互斥/收起时序问题 */}
      <Modal
        visible={budgetModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBudgetModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.ledgerModalOverlay}
          activeOpacity={1}
          onPress={() => setBudgetModalOpen(false)}
        >
          <View style={styles.ledgerModalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.ledgerModalTitle}>
              {budgetTarget === 'total'
                ? t('home.budgetModalTitle', { cur: activeCurrency })
                : t('home.budgetCategoryModalTitle', {
                    name: categoryBudgetRows.find((r) => r.categoryId === budgetTarget)?.name ??
                      categories.find((c) => c.id === budgetTarget)?.name ??
                      '',
                    cur: activeCurrency,
                  })}
            </Text>
            {/* 算式显示行：右对齐大字，键盘按键实时回显 */}
            <Text style={styles.budgetExprText} numberOfLines={1}>
              {budgetExpr.displayValue || '0'}
            </Text>
            {/* 键盘通铺到卡片边缘：卡片 padding 16 会把网格边线（末行底线/右列边线）
                悬在离圆角边框 16px 的位置——负 margin 抵消内边距，边线正好落在卡片边框上
                （与记一笔/资产页贴底键盘通铺同款）；配合卡片 overflow hidden 裁进圆角 */}
            <View style={styles.budgetKeypadBleed}>
              <AmountCalculatorKeypad
                onPressKey={(key) => budgetExpr.pressKeyAt(key, 0)}
                onPressToday={() => {}}
                onClear={() => budgetExpr.reset(0)}
                onConfirm={handleBudgetConfirm}
              />
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
      {/* 月度预算抽屉（缺口补齐）：总预算 + 各分类 已用/额度 与百分比条。
          点预算卡整卡进入；「编辑」再开上面的计算器（两个浮层不叠） */}
      <MonthlyBudgetSheet
        visible={budgetPlanOpen}
        onClose={closeSheet}
        currency={activeCurrency}
        totalLimit={totalBudget}
        totalUsed={thisExpense}
        rows={categoryBudgetRows}
        unsetRows={unsetCategoryRows}
        hidden={balanceHidden}
        onEditTotal={editTotalBudgetFromPlan}
        onEditCategory={editCategoryBudgetFromPlan}
        onClearCategory={handleClearCategoryBudget}
        testID="home-budget-plan"
      />
      {/* 搜索抽屉（设计稿 01 屏头部动作）：点结果 → 既有「编辑账单」页，不新增写入路径 */}
      <TransactionSearchSheet
        visible={searchOpen}
        onClose={closeSheet}
        rows={searchRows}
        hideAmounts={balanceHidden}
        onPick={(id) => {
          closeSheet();
          const tx = transactions.find((item) => item.id === id);
          if (tx) navigation.navigate(ROUTES.ADD_TX, { editTransaction: tx });
        }}
        testID="home-search-sheet"
      />
      {/* 同一组件、mode='all'：「查看全部」打开的全量交易抽屉（无查询词时列全部，标题「全部交易」）。
          与上一个抽屉互斥 —— 两者都由 activeSheet 派生 */}
      <TransactionSearchSheet
        visible={allTxOpen}
        onClose={closeSheet}
        rows={searchRows}
        hideAmounts={balanceHidden}
        mode="all"
        onPick={(id) => {
          closeSheet();
          const tx = transactions.find((item) => item.id === id);
          if (tx) navigation.navigate(ROUTES.ADD_TX, { editTransaction: tx });
        }}
        testID="home-all-tx-sheet"
      />
      {/* 货币直选下拉（T08 验收退回后重做）：锚在「⇅」钮下方，**不透明** semantic.surfaceElevated 底
          + elevation.level2（不再用半透明玻璃，后面的净资产数字不会透上来）；
          行结构（验收定版）= 左：币种代码小方块（accentSoft 底 + radius.sm）· 中：币种名（当前语言，
          副行放另一语言名，信息保留不混排）· 右：选中勾；
          选中行 = accentSoft 底 + accentText 字 + accent 勾，未选中 = textPrimary / textSecondary；
          标题只走 i18n（按当前语言显示一种）。⚠ 不用国旗 emoji（Windows / 网页会退化成字母） */}
      {/* V3：切换币种 = ui/BottomSheet（原下拉面板下线，入口只剩一个） */}
      <BottomSheet
        visible={currencyMenuOpen}
        onClose={() => {
          closeSheet();
          setCurrencyQuery('');
        }}
        title={t('home.currencySheetTitle')}
        maxHeightRatio={0.7}
        testID="home-currency-sheet"
      >
        {totalsByCurrency.length > 6 && (
          <TextInput
            value={currencyQuery}
            onChangeText={setCurrencyQuery}
            placeholder={t('home.currencySearch')}
            placeholderTextColor={semantic.textTertiary}
            style={[styles.currencySearch, { color: semantic.textPrimary, backgroundColor: semantic.surfaceSunken }]}
            autoCorrect={false}
            autoCapitalize="characters"
            testID="home-currency-search"
          />
        )}
        <ScrollView style={styles.currencyMenuScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {currencySheetRows.map(([code, total]) => {
            const active = code === displayTotal?.[0];
            const option = CURRENCY_OPTIONS.find((c) => c.code === code);
            const zhName = option?.name ?? code;
            const enName = getEnglishCurrencyName(code) ?? zhName;
            const isZh = homeLang !== 'en';
            const name = isZh ? zhName : enName;
            return (
              <PressableScale
                key={code}
                style={[styles.currencyMenuItem, active && { backgroundColor: semantic.selectedRow }]}
                activeScale={0.98}
                onPress={() => {
                  setNetWorthCurrency(code);
                  closeSheet();
                  setCurrencyQuery('');
                }}
                accessibilityRole="button"
                accessibilityLabel={`${code} ${name}`}
                accessibilityState={{ selected: active }}
              >
                <View style={styles.currencyMenuCodeBox}>
                  <AppText variant="caption" color={semantic.accentText} numberOfLines={1}>
                    {code}
                  </AppText>
                </View>
                <View style={styles.currencyMenuTextCol}>
                  <AppText variant="body" color={active ? semantic.accentText : semantic.textPrimary} numberOfLines={1}>
                    {name}
                  </AppText>
                  <AppText variant="footnote" color={semantic.textSecondary} numberOfLines={1}>
                    {isZh ? enName : zhName}
                  </AppText>
                </View>
                <MoneyText value={total} kind="plain" currency={code} variant="footnote" color={semantic.textSecondary} />
                {active && <Ionicons name="checkmark" size={20} color={semantic.accent} style={styles.currencyCheck} />}
              </PressableScale>
            );
          })}
        </ScrollView>
      </BottomSheet>

      {/* 删除账本的二级密码验证：只认 6 位 PIN（用户定版：指纹/扫脸不参与删除验证）。
          已设 PIN → verify 验证一次即删；未设 → create 设置完再 verify 一次（确认本人）。
          放在账本弹层之外——验证时账本弹层可能已被关闭 */}
      <PinSheet
        visible={pinSheetOpen}
        mode={pinSheetMode}
        onClose={() => {
          // create→verify 切换瞬间 PinSheet 会尾随触发一次程序性 onClose，跳过它
          if (pinCreateSwitchingRef.current) {
            pinCreateSwitchingRef.current = false;
            return;
          }
          setPinSheetOpen(false);
          setPendingDeleteLedgerId(null);
        }}
        onSuccess={() => {
          if (pinSheetMode === 'create') {
            handlePinCreateDone();
          } else {
            setPinSheetOpen(false);
            void performLedgerDelete();
          }
        }}
      />
    </SafeAreaView>
    </>
  );
}

function makeStyles(
  colors: ThemeColors,
  isDark: boolean,
  semantic: SemanticColors,
  spacing: Spacing,
  radius: Radius,
  layout: Layout,
  elevation: Elevation,
  palette: HomePalette
) {
  return StyleSheet.create({
    container: { flex: 1 },
    // ── 头部区：内容不套卡；左右边距按区块给（heroGutter / heroCardGutter），
    //    顶部 14 + 状态栏让位（JSX 内联给，与全出血口径一致）──
    heroBlock: { paddingHorizontal: 0, paddingBottom: spacing.lg },
    // 顶部柔和光场（只铺顶部 420dp，从左下透明到右上 glowStrong）
    topGlow: { position: 'absolute', left: 0, right: 0, top: 0, height: TOP_GLOW_HEIGHT, opacity: TOP_GLOW_OPACITY },
    // 顶部安全区挡板（替代 ui/StatusBarGlass 的紫系填充，层级与高度沿用 C1：40 / insets.top + 6）
    statusGuard: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40 },
    // 常规区块的左右页边距（顶部用户区 / 快捷入口 / 收支汇总 / 列表标题都吃它）
    heroGutter: { paddingHorizontal: layout.page },
    // 资产卡区块：左右只留 8 —— 文件夹外壳左右各 3.5% 让给后方底卡，
    // 8 的父边距能让主卡净宽在 390 屏约 348dp（参考图 350dp）
    heroCardGutter: { paddingHorizontal: spacing.sm, marginTop: spacing.sm },
    // 卡内两行（金额 / 预算）之间与外壳的间距（原 heroCard 的 rowGap 搬进来）
    heroCardBody: { rowGap: spacing.sm },
    // ── 用户区 / 资产卡 / 快捷入口 ──
    userRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
    userRowSpacer: { flexGrow: 1 },
    heroCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', columnGap: spacing.sm },
    // 头部左标题（参考图 14~15 号弱化色）：可被挤窄，绝不把右侧币种组顶出卡片
    heroCardHeadTitle: { flexShrink: 1, minWidth: 0, fontSize: 16, lineHeight: 22 },
    // 右组 = 币种胶囊 + 下拉箭头 + 眼睛（三件紧挨，眼睛不贴卡片最右缘）
    heroCardHeadPill: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs },
    heroCardHeadActions: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs },
    // 金额槽（页内第一行）：minHeight 保住金额降档时的行高（HERO_AMOUNT_MIN_H）→ 页高不随字号档变化
    heroAmountSlot: {
      alignSelf: 'stretch',
      // 参考图：金额左对齐，与第一行标题左缘同一竖线。定高（= 真实金额的行盒高）
      // 而不是跟着内容走 —— 显隐切换 / 各币种页之间行高恒定，卡片高度一像素不动
      alignItems: 'flex-start',
      justifyContent: 'center',
      height: HERO_AMOUNT_MIN_H,
    },
    // 预算槽（页内第二行）：已设 / 未设两种态等高 → 各币种页等高，横滑落定整卡不跳
    heroBudgetSlot: { alignSelf: 'stretch', justifyContent: 'center', height: HERO_BUDGET_SLOT_H, marginTop: spacing.sm },
    heroBudgetPress: { alignSelf: 'stretch' },
    // 第一行：左「本月预算」+ 金额明细，右「67%」（顶部对齐、两端分开）
    heroBudgetHead: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
    },
    // 左列：标签 + 其下 12 号金额明细（明细不与进度条抢同一行）
    heroBudgetHeadCol: { flexShrink: 1, minWidth: 0 },
    heroBudgetHeadLabel: { flexShrink: 1, minWidth: 0 },
    heroBudgetDetail: { fontSize: 12, lineHeight: 16 },
    // 预算条：独占整行、左对齐；轨道 palette.trackBg、填充 progressFrom→progressTo
    heroBudgetTrack: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: spacing.xs },
    heroBudgetFill: { height: '100%', borderRadius: 3 },
    heroBudgetPct: { minWidth: 34, textAlign: 'right' },
    // 未设预算：一行「＋ 设置本月预算」CTA（卡文色的半透明底 pill，两套主题都成立；整行可点）
    heroBudgetCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      columnGap: spacing.xs,
      alignSelf: 'stretch',
      minHeight: 32,
      borderRadius: radius.full,
      backgroundColor: withAlpha(palette.cardText, 0.12),
    },
    // 快捷入口与上方资产卡的间距（四列的排布在 QuickActions 内，父级只给上下留白）
    quickLayer: { marginTop: spacing.md },
    heroTopRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },

    // 右侧两枚 44 玻璃圆钮（铃铛 / 日历）靠 marginLeft auto 顶到行尾
    heroTopActions: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm, marginLeft: 'auto' },
    // 账本胶囊（V2 稿：高 44 · 内边距 16 · 全圆角 · 白字 15/500 + 下拉箭头；名字长时省略号收尾）
    heroLedgerPill: {
      height: 44,
      maxWidth: 200,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      paddingHorizontal: layout.card,
    },
    heroPillText: { flexShrink: 1 },
    // 胶囊按压缩小（长账本名交给文字省略号），不能被内容撑破顶行
    heroPillPress: { flexShrink: 1 },
    // 未读红点由 RoundIconButton 自己画（badge prop），这里不再需要定位锚与数字角标
    // 币种小胶囊（V2 稿：高 26 · 内边距 8 · 白字 12/500 + 12 图标）
    heroCurrencyPill: {
      height: 26,
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    // 净资产标签行（V2 稿 margin-top 34，1:1）
    heroNetWorthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      columnGap: spacing.sm,
      marginTop: 34,
    },
    // 金额行（V2 稿 margin-top 4）：横向分页容器；间距 = 稿的 10（HERO_EYE_GAP）
    heroAmountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.xs,
    },
    // V3 跟手分页的一页：页宽 = 行实测宽（JSX 给），金额在页内水平居中
    // flexShrink 0 + 固定宽：页永远不会被压窄（金额盒的可用宽 = 页宽，不随横移变化）
    // 最小行高 = 最大档（HERO_AMOUNT_SIZE）的行盒高：金额降档时行高不变，页面高度不跳
    heroPagerPage: {
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      minHeight: HERO_AMOUNT_MIN_H,
    },
    // 手势分页：clip 盒裁掉相邻页；strip 横排、页宽 = 行宽
    heroPagerClip: { overflow: 'hidden' },
    heroPagerStrip: { flexDirection: 'row', flexShrink: 0 },
    heroAmountPress: { flexShrink: 1, minWidth: 0 },
    // 隐藏金额（••••••）：行高 = hero 整数段真实行盒（round(40 × 1.103) = 44），
    // 与显示态完全同高 —— 显隐切换时卡片不许长高
    heroHiddenAmount: { fontSize: HERO_AMOUNT_SIZE, lineHeight: HERO_AMOUNT_MIN_H },
    // 眼睛（空心无底）：36 见方的视觉盒，外加 hitSlop 4 补回 44 以上的触控区；
    // 换掉 IconButton 只为用首页图标集（IconEye / IconEyeOff），位置与卡片高度都没变
    heroEyeBtn: { width: 32, height: 32, minHeight: 32, borderRadius: 16 },
    // 无账户空状态：EmptyState 的文字是深色令牌，垫一张玻璃卡才在渐变上读得清
    heroEmptyCard: { marginTop: spacing.xl, paddingHorizontal: spacing.md },
    // 吸顶日期头（自绘）：钉在列表视口顶部（浮层允许绝对定位）。本体自带面板底 + 16 边距
    // （见 dayHeaderWrap），这里只补一条通栏发丝线；钉住时它是面板被切开的截面，所以不留圆角
    pinnedHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 5,
      overflow: 'hidden',
      // 吸顶时必须实底：分组头已经去掉填充色块，钉住时下面是滚动的账单行
      backgroundColor: palette.panel,
      borderBottomWidth: 1,
      borderBottomColor: palette.hairline,
    },
    // ── 「最近交易」统一面板：日期头 = 面板内的一段（12 上 / 4 下 + 16 边距，无底线）。
    //    面板的圆角只在首段（RecentHeader 上两角）与末行（下两角），中间各段一律直角 ──
    dayHeaderWrap: {
      backgroundColor: palette.panel,
      marginHorizontal: LIST_CARD_MARGIN,
    },
    // 跨月月份分隔（只在当月第一次出现时渲染）：caption（12pt，≥ 令牌最小档）
    monthSepText: {
      paddingHorizontal: layout.card,
      paddingTop: spacing.md,
      paddingBottom: spacing.xs,
    },
    // 轻量分组头（参考图：列表里没有填充色块）：只留一行 12 号弱化日期 + 右对齐当日合计，
    // 上下留 spacing.sm~md；文字左缘与账单行图标左缘对齐（= 卡片内边距）
    dayGroupPill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
      marginHorizontal: layout.card,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
    },
    daySumText: { flexShrink: 0 },
    // 日期标签（今天 / 昨天 / 10月7日 周三）：可被挤窄，合计整块不被挤
    // minWidth 0：web 上 flex 子项默认 min-width:auto，没有它「flexShrink 1」形同虚设 → 药丸会被撑破
    dayHeaderDate: { flexShrink: 1, minWidth: 0 },
    heroFadeOverlay: { position: 'absolute', left: 0, right: 0, top: 330 * 0.6, height: 330 * 0.4 },
    // V3 字号（设计稿逐值）：行标题 14/600、副标题 12/400、日期头 12、预算文字 12.5
    dayHeaderLabelText: { fontSize: 12, lineHeight: 16 },
    budgetText: { fontSize: 12.5, lineHeight: 17 },
    // 无账单空状态（EmptyState 自带内边距，这里只补与头部区的间距）
    listEmpty: { paddingTop: spacing.lg },
    // 货币下拉（T08 退回定版）：全 App 唯一遮罩色 + 不透明浮层底（surfaceElevated）+ level2 阴影
    currencySearch: {
      marginHorizontal: layout.page,
      marginBottom: spacing.sm,
      height: 40,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      fontSize: 15,
    },
    currencyCheck: { marginLeft: spacing.xs },
    // 卡内底部分页点：居中一行，点与点之间 spacing.sm（与 FolderAssetCard 原来的静态点同尺寸/同间距）
    // 分页点（按 V2 包）：底点 5、选中 11、点与点之间 0 间距（每个点自带 16 宽的命中盒），贴近卡底
    heroDot: { height: 5, width: 5, borderRadius: 3 },
    // 胶囊：所有币种文字叠在同一格里；占位文字不可见
    pillStack: { alignItems: 'center', justifyContent: 'center', flexShrink: 1, minWidth: 0 },
    pillSpacer: { opacity: 0, height: 20, overflow: 'hidden' },
    // 胶囊文字 = 币种代码（参考图 14 号，与左侧标题同档）
    pillText: { fontSize: 14, lineHeight: 20 },
    heroDotActive: { width: 14, opacity: 1 },
    heroDotIdle: { opacity: 0.3 },
    currencyMenuScroll: { flexGrow: 0, flexShrink: 1 },
    // 行结构（验收定版）：左币种代码方块 · 中币种名 · 右选中勾
    currencyMenuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      minHeight: layout.rowMinHeight,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.sm,
    },
    // 选中行：accentSoft 底（字色 / 勾色在渲染期给）
    currencyMenuItemActive: { backgroundColor: semantic.accentSoft },
    // 币种代码方块（radius.sm + accentSoft 底）：含文字所以只给 minWidth/minHeight + padding
    currencyMenuCodeBox: {
      minWidth: 44,
      minHeight: 36,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
      backgroundColor: semantic.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    // minWidth 0：币种名太长时先收名字列，右端金额 / 勾选不会被顶出抽屉
    currencyMenuTextCol: { flex: 1, flexShrink: 1, minWidth: 0 },
    // 卡片右上角的"+ 新增 / 查看全部"：做成胶囊，比裸文字有更大的可点区域和更明确的按钮感
    addLinkBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      backgroundColor: colors.link + '14',
      borderRadius: 13,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    // 日历卡外层：页面左右边距（与头部区的间距由 heroBlock 的 paddingBottom 给，见其注释）
    calendarWrap: { paddingHorizontal: layout.page },
    // 日历底部弹层：绝对定位贴在列表起点（top 在 JSX 里按 hero 高度给）。
    // ⚠ 日历盖不住列表格子这件事不是 z-index 能解决的：账单行 / 日期头 / 空状态是同一滚动内容里
    //   排在 ListHeaderComponent 之后的兄弟块，每个 RNW View 都自成一层（position:relative + z-index:0
    //   的层叠上下文），日历卡里的 z-index 只能在自己的头部层内排序，跳不出头部那格。
    //   真正的修法在列表内容层与头部层：日历模式下把列表内容的命中测试关掉、把头部层打开
    //   （见 listContentStyle 的 pointerEvents 与下面 listHeaderLayer 的 JSX 注释）。
    calendarAbs: { position: 'absolute', left: 0, right: 0 },
    listHeaderLayer: { zIndex: 2 },
    // 玻璃卡：圆角 26 由 GlassView 的 radius 给（与资产页 groupsCard 同一张 26 圆角玻璃卡），
    // 内衬走间距令牌（12 / 8 / 8）
    calendarCard: { paddingTop: spacing.md, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
    // ── 以下旧的「账单卡 / 空状态 / 账单行（图标托 + 类别(备注)）」样式已按 T09 删除 ──
    // （H4：连续分组列表；H5：行统一走 ui/TransactionRow；H7：空状态统一走 ui/EmptyState）
    ledgerModalOverlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    ledgerModalCard: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      // 键盘通铺到卡缘后其方角背景会顶到卡片下缘——裁进圆角内，避免圆角外露出方角
      overflow: 'hidden',
    },
    planModalCard: {
      width: '100%',
      maxHeight: '92%',
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
    },
    ledgerModalTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
    // 预算弹窗的算式显示行：右对齐大字、等宽数字；minHeight 防算式清空时高度塌陷
    budgetExprText: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'right',
      fontVariant: ['tabular-nums'],
      minHeight: 40,
      marginBottom: 10,
    },
    // 预算键盘通铺：负 margin 抵消卡片 padding 16，网格边线（末行底线/侧线端头）正好落在卡片圆角边框上
    budgetKeypadBleed: { marginHorizontal: -16, marginBottom: -16 },
    modalFieldLabel: { fontSize: 12, color: colors.textSecondary, marginTop: 12, marginBottom: 6 },
    requiredMark: { color: colors.expense, fontWeight: '700' },
    // 账本抽屉（T10 / H11）：BottomSheet 内的内容 —— 贴边列表（不套四角圆角卡，避免「抽屉里浮一张卡」）
    // + 底部通栏「新增账本」主按钮；列表需要滚动时在抽屉内滚动（flexShrink 让它在 maxHeight 内收缩）
    ledgerSheetScroll: { flexGrow: 0, flexShrink: 1 },
    ledgerSheetListContent: { paddingVertical: spacing.md },
    ledgerSheetSection: { borderRadius: 0, borderWidth: 0 },
    ledgerSheetFooter: {
      paddingHorizontal: layout.card,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: semantic.hairline,
    },
    modalInput: {
      backgroundColor: colors.bg,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      padding: 12,
      fontSize: 14,
      color: colors.textPrimary,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginRight: 8,
      marginBottom: 8,
    },
    chipActive: { backgroundColor: colors.fabBg, borderColor: colors.textPrimary },
    chipText: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
    chipTextActive: { color: colors.bg },
    // 付款计划的类别选择器：跟"记一笔"里选类别的网格样式保持一致（点一下直接选中，不用滑动）
    catGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    catItem: { width: '25%', alignItems: 'center', marginBottom: 16 },
    catIconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    catLabel: { fontSize: 11, color: colors.textPrimary, marginTop: 6, textAlign: 'center' },
    assetPickerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 12,
    },
    // 类别/账户没选时：框格描红边 + 下面配一行提醒文字，不用弹窗打断填表
    assetPickerBtnError: { borderColor: colors.expense },
    // 名称/金额没填时同样描红边，跟类别/账户保持一致，不用弹窗打断
    modalInputError: { borderColor: colors.expense },
    fieldErrorText: { fontSize: 11, color: colors.expense, marginTop: 4 },
    assetPickerPlaceholder: { fontSize: 14, color: colors.textTertiary },
    assetPickerChosenRow: { flexDirection: 'row', alignItems: 'center' },
    assetPickerChosenText: { fontSize: 14, color: colors.textPrimary, fontWeight: '600' },
    assetPickerChosenCurrency: { fontSize: 12, color: colors.textTertiary },
    assetDropdown: {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 10,
      marginTop: 6,
      paddingVertical: 4,
    },
    assetDropdownDivider: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.summaryCard,
    },
    assetDropdownDividerText: { fontSize: 11, color: colors.textTertiary, fontWeight: '700' },
    assetDropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    assetDropdownItemLeft: { flexDirection: 'row', alignItems: 'center' },
    assetDropdownItemText: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
    assetDropdownItemType: { fontSize: 11, color: colors.textTertiary },
    autoDeductRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingVertical: 4 },
    planTypeSegRow: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 10, padding: 2, marginBottom: 12 },
    planTypeSegBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
    planTypeSegBtnActive: { backgroundColor: colors.fabBg },
    planTypeSegText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
    planTypeSegTextActive: { color: colors.fabIcon, fontWeight: '700' },
    incomePlanHint: { fontSize: 11, color: colors.textTertiary, marginTop: -6, marginBottom: 10 },
    autoDeductText: { fontSize: 13, color: colors.textPrimary, marginLeft: 8, fontWeight: '600' },
    modalSaveBtn: {
      backgroundColor: colors.fabBg,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    // 付款计划弹窗专用：跟正上方的"到期自动扣账"复选框拉开更大间距，减少误触
    planModalSaveBtn: { marginTop: 28 },
    modalSaveBtnText: { color: colors.bg, fontWeight: '700', fontSize: 14 },
  });
}
