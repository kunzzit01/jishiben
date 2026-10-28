import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
  Modal,
  Switch,
  Platform,
  Keyboard,
  BackHandler,
  PanResponder,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSharedValue } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useApp } from '../context/AppContext';
import { ROUTES, AddTxPresetType } from '../navigation/routes';
import DateRangePickerSheet from '../components/DateRangePickerSheet';
import { TransactionType, Transaction, Category } from '../types';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { getCategoryLabel, getGroupLabel, findCategoryIdByChineseName } from '../i18n/categories';
import { EXPENSE_CATEGORY_GROUPS, INCOME_CATEGORY_GROUPS } from '../utils/defaultCategories';
import { scanReceipt } from '../utils/scanReceipt';
import { isAiConfigured } from '../config/aiConfig';

/** 大组排序的存储键：与「管理类别」页共用同一个键，两页顺序保持一致 */
const GROUP_ORDER_KEY = '@jizhang/categoryGroupOrder';
import { getCurrencySymbol } from '../utils/currencies';
import { CATEGORY_ICON_OPTIONS, CATEGORY_COLOR_OPTIONS, CategoryIconName } from '../constants/categoryAddOptions';
// 分类网格编辑器（虚线占位框 / 长按 200ms 拖拽 / 虚线＋新增磁贴 / 删除角标）——与管理类别页同一个组件
import { CategoryGridEditor, sortByOrder } from '../components/CategoryGridEditor';
import { hapticLight, hapticSelection, hapticSuccess, hapticWarning } from '../utils/haptics';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance } from '../hooks/useTabClearance';
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';
import { useTabBarScrollHandler, useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors, SemanticColors, Spacing, Layout, Radius, categoryRing } from '../theme/theme';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { getExpressionTotal } from '../utils/amountExpression';
import { formatMoney } from '../utils/formatMoney';
import { formatDate as formatDateLabel } from '../utils/formatDate';
import { AmountCalculatorKeypad, keypadPanelHeight } from '../components/AmountCalculatorKeypad';
import { CursorAmountText } from '../components/CursorAmountText';
import { ReceiptCameraModal } from '../components/ReceiptCameraModal';
import AppText from '../components/ui/AppText';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import IconButton from '../components/ui/IconButton';
import ScreenHeader from '../components/ui/ScreenHeader';
import GlassView from '../components/ui/GlassView';
import { withAlpha } from '../components/ui/color';
import HeroGradient from '../components/ui/HeroGradient';
import IconCircle from '../components/ui/IconCircle';
import PressableScale from '../components/PressableScale';
import { TransactionTypeHeader } from '../components/transaction/TransactionTypeHeader';
import { TransactionChip } from '../components/transaction/TransactionChip';
import { AccountPickerSheet } from '../components/transaction/AccountPickerSheet';
import { CategoryPickerSheet } from '../components/transaction/CategoryPickerSheet';
import { ReceiptPreviewModal } from '../components/transaction/ReceiptPreviewModal';
import { useDialog } from '../components/AppDialog';


type IconName = keyof typeof Ionicons.glyphMap;


// iOS 风格"左侧边缘右滑返回"：从屏幕左边缘(40px内)横向右滑超过阈值就返回。
// manualActivation 手动接管：只有"起点贴近左边缘且横向位移占主导"才激活手势，
// 纵向滚动、分类横滑条等都不受影响。
// 左滑删除包装器：向左拖动露出右侧"删除"按钮，点删除回调确认
function EdgeBackSwipe({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  const startPos = useRef({ x: 0, y: 0 });
  const gesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      if (t) startPos.current = { x: t.absoluteX, y: t.absoluteY };
    })
    .onTouchesMove((e, stateManager) => {
      const t = e.allTouches[0];
      if (!t) return;
      const dx = t.absoluteX - startPos.current.x;
      const dy = t.absoluteY - startPos.current.y;
      if (startPos.current.x < 40 && dx > 24 && Math.abs(dy) < 24) stateManager.activate();
      else if (Math.abs(dy) > 24 || dx < -10) stateManager.fail();
    })
    .onEnd((e) => {
      if (e.translationX > 80) onBack();
    });
  return <GestureDetector gesture={gesture}>{children}</GestureDetector>;
}

// UI 层的四个入口："兑换" 在数据层复用 'transfer' 类型（types.ts 中 TransactionType 只有
// expense/income/transfer 三个值），仅在界面文案和是否强制显示汇率上做区分。
type UiType = 'expense' | 'income' | 'transfer' | 'exchange';

// D-3.2（2026-09-24）：账户名全展示——原「最多 4 字+省略号」的 truncateAccName 预截断退役
// （名字超宽由 Text 在框内两行折行兜底，见 heroCurrencyAccName numberOfLines 2）

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 日历选择器回调给的是 Date 对象，转成表单里统一用的 YYYY-MM-DD 字符串
function formatDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 英文短语在窄框里的按词换行：安卓端默认断行策略是 highQuality（均衡断行），为对齐两行
// 长度允许从单词中间切开——"Not selected" 会被断成 "Not sel/ected"。容器放不下整句时在这里
// 显式于空格处换行（"Not\nselected"），够宽则保持原样单行；中文标签无空格，原样返回不受影响
function twoLineLabel(label: string, boxW: number, fullW: number) {
  return boxW < fullW && label.indexOf(' ') > 0 ? label.replace(' ', '\n') : label;
}

// T14：把 getExpressionDisplay() 的输出（"5.00" / "5.00 + 2.00"）还原成求和函数要吃的最小结构，
// 交给共享的 getExpressionTotal 求和——只为「算式在上、合计在下」的展示，不改任何计算逻辑
// （保存时的金额仍由 amountExpr.confirm() 出，这里是纯展示值）
function expressionTotal(display: string): number {
  const tokens = display.split(/\s+([+-])\s+/); // 值 / 运算符交替
  const terms = tokens
    .filter((_, i) => i % 2 === 0)
    .map((tok, i) => ({
      op: (i === 0 ? '+' : (tokens[i * 2 - 1] as '+' | '-')),
      raw: String(Math.round((parseFloat(tok) || 0) * 100)),
    }));
  return getExpressionTotal({ terms });
}

/** 金额字号档位（UI_RULES 第 5 节：按档位降级、不做连续压缩）。
 *  V2 稿基准档 64（矮屏 58）；长串按 44 → 34 两档降级，保证 14 位大数字也不溢出 */
function amountFontTier(display: string, base: number): number {
  if (display.length <= 9) return base;
  if (display.length <= 12) return 44;
  return 34;
}

// ---------- UI V2 记一笔：Hero 金额（稿）----------
// 整数段 = 基准 64/500 白（字距 −2.5、行高 66）；「.小数」段 = 34/300 白 70%（稿的降透明度）。
// 键盘开着时把闪烁光标画在「光标所在的那一段」里：复用 CursorAmountText 的点按/拖动定位，
// 只做 cursorFromEnd 的全串 ↔ 分段换算（整段：Li − si；小段：Li + Ld − si）。
// 为什么不是 MoneyText / CursorAmountText 单独搞定：MoneyText hero 没有光标，
// CursorAmountText 不拆整数/小数（组件都在别处、本车道不改），两个片段各自渲染是唯一不损功能的组合。
const HERO_INT_RATIO_DEC = 34 / 64; // 小数段 ÷ 整数段（稿 34/64）
const HERO_LINE_RATIO = 66 / 64; // 行高 ÷ 字号（稿 line-height 66）
const HERO_LETTER_RATIO = -2.5 / 64; // 字距 ÷ 字号（稿 letter-spacing −2.5）

/** Hero 金额 / 成功勾选徽章的静态样式（颜色全在组件内取稿的字面白档，与主题无关） */
const v2Styles = StyleSheet.create({
  heroAmountRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center' },
  saveFlashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  saveFlashBadge: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

function HeroAmountText({
  display,
  fontSize,
  cursorFromEnd,
  cursorActive,
  onCursorChange,
}: {
  display: string;
  fontSize: number;
  cursorFromEnd: number;
  /** 光标是否可见（键盘开着且不是多项算式的合计态） */
  cursorActive: boolean;
  onCursorChange: (cursorFromEnd: number) => void;
}) {
  const dotIdx = display.indexOf('.');
  const intPart = dotIdx < 0 ? display : display.slice(0, dotIdx);
  const decPart = dotIdx < 0 ? '' : display.slice(dotIdx);
  const intLen = intPart.length;
  const decLen = decPart.length;
  // 光标在整串中的「前面有几个字符」位置（0 = 最前）
  const cursorIdx = Math.max(0, Math.min(display.length, display.length - cursorFromEnd));
  const cursorInInt = cursorIdx <= intLen;
  // UI V2.1 §3：渐变上的金额 / 小数 / 光标统一 text.primary（日间不能再有白字压浅色渐变）；
  // 小数与光标沿用稿里的降透明度（本就是大字档，§4 按 3:1 口径）
  const { semantic } = useTheme();
  const onHero = semantic.textPrimary;
  const onHeroDim = withAlpha(semantic.textPrimary, 0.7);
  const onHeroCursor = withAlpha(semantic.textPrimary, 0.9);

  const intSize = fontSize;
  const decSize = Math.round(fontSize * HERO_INT_RATIO_DEC);
  const intStyle = {
    fontSize: intSize,
    lineHeight: Math.round(intSize * HERO_LINE_RATIO),
    fontWeight: '500' as const,
    letterSpacing: Math.round(fontSize * HERO_LETTER_RATIO * 10) / 10,
    color: onHero,
  };
  const decStyle = {
    fontSize: decSize,
    lineHeight: Math.round(decSize * HERO_LINE_RATIO),
    fontWeight: '300' as const,
    // 稿：小数部分降透明度
    color: onHeroDim,
  };
  // 光标：白色细竖条（稿里是 2×44 渐变条；这里沿用文字光标字形，尺寸跟着片段字号）
  const cursorStyle = {
    fontSize: Math.round(intSize * 0.68),
    fontWeight: '300' as const,
    color: onHeroCursor,
    marginLeft: 2,
  };

  const showCursor = cursorActive && display.length > 0;
  const intWithCursor = showCursor && cursorInInt;
  const decWithCursor = showCursor && !cursorInInt && decLen > 0;

  return (
    <View style={v2Styles.heroAmountRow}>
      {intWithCursor ? (
        <CursorAmountText
          display={intPart}
          cursorFromEnd={intLen - cursorIdx}
          onCursorChange={(segFromEnd) => onCursorChange(display.length - (intLen - segFromEnd))}
          style={intStyle}
          cursorStyle={cursorStyle}
          numberOfLines={1}
        />
      ) : (
        <Text style={intStyle} numberOfLines={1}>
          {intPart}
        </Text>
      )}
      {decLen > 0 &&
        (decWithCursor ? (
          <CursorAmountText
            display={decPart}
            cursorFromEnd={decLen - (cursorIdx - intLen)}
            onCursorChange={(segFromEnd) => onCursorChange(display.length - (intLen + decLen - segFromEnd))}
            style={decStyle}
            cursorStyle={cursorStyle}
            numberOfLines={1}
          />
        ) : (
          <Text style={decStyle} numberOfLines={1}>
            {decPart}
          </Text>
        ))}
    </View>
  );
}

// ---------- UI V2 T17：保存成功的 300ms 勾选动画 ----------
// 保存成功 = success 震动（调用方发）+ 中央勾选徽章 120ms 弹入，300ms 后由调用方照原逻辑返回/留页。
// 徽章用 accent 渐变（与「完成」键同一档），纯装饰、不接触摸。
function SaveSuccessFlash() {
  const scale = useRef(new Animated.Value(0.6)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 110, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 180, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { gradients, semantic } = useTheme();
  return (
    <View style={v2Styles.saveFlashOverlay} pointerEvents="none">
      <Animated.View style={[v2Styles.saveFlashBadge, { opacity, transform: [{ scale }] }]}>
        <LinearGradient
          colors={gradients.accent.colors}
          locations={gradients.accent.locations as [number, number, ...number[]]}
          start={gradients.accent.start}
          end={gradients.accent.end}
          style={StyleSheet.absoluteFill}
        />
        <Ionicons name="checkmark" size={34} color={semantic.onAccent} />
      </Animated.View>
    </View>
  );
}

type Step = 'category' | 'detail' | 'transferDetail';

// 类别横排"最近用过"快捷选择：本地存一份最近选过的类别 id（新的插最前面，去重），
// 跟 AssetScreen 里"最近用过的货币"是一个思路，只是这里存的是类别 id 顺序
const RECENT_CATEGORY_KEY = '@jizhang/recentCategories';
// TASK-022：每个类型的"最后选中类别"持久化（杀进程重启后自动恢复）——
// 值形如 { expense?: string, income?: string }；transfer/exchange 页无类别网格不参与
const LAST_CATEGORY_KEY = '@jizhang/lastCategory';
// TASK-022：每个类型的网格固定格（本次选过的类别置顶格）持久化，重启后网格原样恢复
// 值形如 { expense?: string[], income?: string[] }
const SESSION_PICKED_KEY = '@jizhang/sessionPickedCategories';
// 编辑模式拖动排序的持久化键：Record<分类id, 序号>，只在大组内部比较（资产页 assetOrder 同款）
const CATEGORY_ORDER_KEY = '@jizhang/categoryOrder';
// TASK-009：不设上限——历史里有多少就往网格铺多少，直到"全部"按钮碰到自绘计算器为止
const RECENT_CATEGORY_HISTORY_LIMIT = Infinity;

export default function AddTransactionScreen({ navigation, route }: any) {
  const { categories, categoryGroups, addCategory, addCategoryGroup, deleteCategoryGroup, addTransaction, updateTransaction, addTransfer, updateCategory, deleteCategory, deleteTransaction, assets, activeAssets, getAssetBalance, currencySymbol, currency, activeLedgerId, paymentPlans, addPaymentPlan } =
    useApp();
  const insets = useSafeAreaInsets();
  const { colors, isDark, semantic, spacing, layout, radius } = useTheme();
  // 矮屏（可用高 < 700）：金额卡内边距 / 行距再收紧一档，保证「金额 + 至少 2 行类别 + 键盘」一屏可见
  // height / width = useLayout 的窗口尺寸（内部就是 useWindowDimensions），
  // 旋转 / 分屏 / RN Web 改窗口时自动重算 —— 不再用 Dimensions.get（只在启动时取一次）。
  const { isShort, categoryColumns, keypadKeyHeight, height: windowHeight, width: windowWidth } = useLayout();
  // 设计稿 03 屏：类别九宫格固定四列（36 方块 + 11pt 标签）。窄/矮屏也不再收成 5 列 ——
  // useLayout().categoryColumns 是全局版型参数（theme/** 不在本次改动范围），所以在本页覆写
  const gridColumns = 4;
  // 自绘计算器面板总高（备注行 + 4 行分格键 + 缝，随键高档位变化；不含底部安全区补白）。
  // 遮挡高度与类别网格停止线都用它，和键盘真实渲染高度保持一致
  const keypadPanelH = keypadPanelHeight(keypadKeyHeight, isShort, true);
  const t = useT();
  const { langMode } = useLanguage();
  // 主题化弹窗（替代系统 Alert）
  const dialog = useDialog();
  const tabClearance = useTabClearance();
  // 底部系统栏（手势条 / 三键导航）实际高度：键盘面板、底部弹层都要让出它，见 keypadBottomPad
  const bottomInset = useBottomSystemInset();
  // 计算器键盘底部让位：iOS 保持原来的紧凑留白（home 指示条在安全区内）；
  // 安卓必须整条让出系统导航栏——旧的 insets - 40 会让导航条盖住键盘底行（C 0 . 与「完成」）
  const keypadBottomPad = Platform.OS === 'ios' ? Math.max(insets.bottom - 40, isShort ? 4 : 8) : bottomInset + (isShort ? 4 : 8);
  const onTabScroll = useTabBarScrollHandler(); // 不传参数！
  const setTabBarForceHidden = useTabBarForceHide();
  const isFocused = useIsFocused();
  const styles = useMemo(() => makeStyles(colors, isDark, semantic, spacing, layout, radius), [colors, isDark, semantic, spacing, layout, radius]);

  const editTransaction: Transaction | undefined = route?.params?.editTransaction;
  const isEditing = !!editTransaction;

  // 入口预设（首页四个快捷方块：支出 / 收入 / 转账）。presetType 是本次新增的字段，
  // initialType 是既有入口（资产页"转账"、AI 专区）一直在用的同义字段，二者合并成一条优先级链。
  const presetType: AddTxPresetType | undefined = route?.params?.presetType ?? route?.params?.initialType;
  // 初始类型优先级：编辑已有账单（保持原类型，绝不能被入口预设覆盖）> 入口预设 > 默认支出。
  // 只决定挂载时的那一档，挂载后用户仍可用顶部切换自由改（setUiType 不动）。
  const initialUiType: UiType = editTransaction
    ? (editTransaction.type as UiType)
    : presetType ?? 'expense';
  const presetCategoryId: string | undefined = route?.params?.presetCategoryId;
  const autoScan: boolean = !!route?.params?.autoScan;

  const [uiType, setUiType] = useState<UiType>(initialUiType);
  // 数据层类型：兑换在存储上就是一笔转账
  const type: TransactionType = uiType === 'exchange' ? 'transfer' : uiType;
  const isExchange = uiType === 'exchange';

  // 长按在"资产"页勾选过的默认账户，新增记录时自动带出来（编辑已有记录时不覆盖，还是用那笔记录本来的账户）
  const defaultAsset = activeAssets.find((a) => a.isDefault);

  // 所有类型都直接进入主表单；转账/兑换的账户改为页面内弹层选择，不再增加独立选择步骤。
  const stepForType = (t: UiType): Step => (t === 'transfer' || t === 'exchange' ? 'transferDetail' : 'detail');

  const [step, setStep] = useState<Step>(() => {
    if (isEditing) return editTransaction?.type === 'transfer' ? 'transferDetail' : 'detail';
    return stepForType(initialUiType);
  });
  const [categoryId, setCategoryId] = useState<string | null>(editTransaction?.categoryId ?? null);
  const [amount, setAmount] = useState(editTransaction ? String(editTransaction.amount) : '');
  // 自绘计算器键盘：amount 字符串仍然是提交表单时用的最终值（跟以前一样），
  // amountExpr 只在键盘面板打开时管理当前正在输入/拆分的表达式，
  // 按"完成"时把算好的结果写回 amount，这样 saveTransaction 等原有逻辑完全不用改
  const amountExpr = useAmountExpression(editTransaction ? editTransaction.amount : undefined);
  const [amountKeypadOpen, setAmountKeypadOpen] = useState(true);
  // 各金额格的自绘光标位置（距显示串尾部的偏移，0=最末尾）：
  // 键盘按键在光标处插入/删除（pressKeyAt），点按/长按拖动金额文字可移动光标
  const [amountCursor, setAmountCursor] = useState(0);
  const [rateCursor, setRateCursor] = useState(0);
  const [feeCursor, setFeeCursor] = useState(0);
  // 支出/收入计算器的输入目标：金额（大看板）或规划期数。点期数格子切到期数目标，
  // "完成"键在期数格只负责把算出的值写回 state 并切回金额，不会误存整笔（参照转账页三格的做法）
  const [date, setDate] = useState(editTransaction?.date ?? todayStr());
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // 自动月结开关（Hero 卡内，仅新增模式）：默认关闭，手动点击才开启——
  // 打开后保存这笔账时，会在财务规划自动生成一条「每月同日自动入账」的计划付款
  const [autoMonthly, setAutoMonthly] = useState(false);
  const [note, setNote] = useState(editTransaction?.note ?? '');
  const [scanning, setScanning] = useState(false);
  // 凭证：支出/收入详情页里附加的真实单据照片（拍照或从相册选）
  const [receiptUri, setReceiptUri] = useState<string | null>(editTransaction?.receiptUri ?? null);
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);

  // 普通收支专用：可选的资产账户（这笔钱从/到哪个账户）——没有编辑数据时，用"资产"页设的默认账户
  const [assetId, setAssetId] = useState<string | null>(editTransaction?.assetId ?? defaultAsset?.id ?? null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  // 「全部」类别抽屉（T15）：打开完整列表；管理与排序入口在里面 →（管理类别）→ 选择类别页
  const [catSheetOpen, setCatSheetOpen] = useState(false);

  // 用户手动选过账户后就不再自动跟随"默认账户"变化；保存后重置（resetAll）恢复自动跟随。
  // 编辑已有账单时初始值来自账单本身，视为已手动确定
  const userPickedAssetRef = useRef(!!editTransaction?.assetId);
  const userPickedFromRef = useRef(false);

  // "默认账户"实时联动：在资产页勾选/取消"设为默认账户"后，只要用户没在本页手动选过账户，
  // 这里的预选账户立刻跟着变（取消勾选→回到未选择；勾选别的→换成新的默认账户）。
  // 账户变了，金额显示币种自动跟着变——金额币种只认所选账户
  useEffect(() => {
    if (userPickedAssetRef.current) return;
    setAssetId(defaultAsset?.id ?? null);
  }, [defaultAsset?.id]);

  useEffect(() => {
    if (userPickedFromRef.current) return;
    setFromAssetId(defaultAsset?.id ?? null);
  }, [defaultAsset?.id]);

  // 转账/兑换专用状态——"转出"账户也带默认值（通常就是平时最常用那张），"转入"留给用户自己选
  const [fromAssetId, setFromAssetId] = useState<string | null>(defaultAsset?.id ?? null);
  const [toAssetId, setToAssetId] = useState<string | null>(null);
  const [exchangeRate, setExchangeRate] = useState('');
  const [fee, setFee] = useState('');
  // 转账/兑换的所有金额字段统一使用自绘计算器：金额、汇率、手续费。
  // 汇率跟手续费一样默认空（显示 0.00），不预填 1.00——不然每次都要先删掉默认值才能输入
  const rateExpr = useAmountExpression(undefined);
  const feeExpr = useAmountExpression(undefined);
  const [calculatorTarget, setCalculatorTarget] = useState<'amount' | 'rate' | 'fee'>('amount');

  // 当前键盘目标格的光标分发：按键在光标处生效（pressKeyAt 返回新光标偏移写回 state）。
  // reset 打开键盘（空态起输）时光标一律回到末尾
  const handleExprKey = (key: string) => {
    if (calculatorTarget === 'amount') setAmountCursor(amountExpr.pressKeyAt(key, amountCursor));
    else if (calculatorTarget === 'rate') setRateCursor(rateExpr.pressKeyAt(key, rateCursor));
    else setFeeCursor(feeExpr.pressKeyAt(key, feeCursor));
  };

  // 转账/兑换账户选择：不再经过独立的“选择步骤”，直接在当前页面通过弹层菜单切换账户
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountPickerRole, setAccountPickerRole] = useState<'from' | 'to'>('from');


  // Enter/下一步跳到"备注"这个真实输入框——详情页和转账页的备注框不会同时挂载，共用一个 ref 就够
  const noteInputRef = useRef<TextInput>(null);

  // 让"当前正在输入的那一块"自动滚到屏幕居中位置，不用自己找它在哪——
  // 详情页和转账页各自有独立的 ScrollView，但不会同时挂载，共用一套记录就够。
  // fieldY 记的是每个字段块在滚动内容里的 y 坐标（这些字段块都是 ScrollView 的直接子节点，
  // onLayout 给的 y 天然就是"相对滚动内容"的坐标，不用再额外做坐标换算）。
  const scrollViewRef = useRef<ScrollView>(null);
  const fieldY = useRef<Record<string, number>>({});
  const registerFieldY = (key: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
    fieldY.current[key] = e.nativeEvent.layout.y;
  };
  const scrollToField = (key: string) => {
    const y = fieldY.current[key];
    if (y == null) return;
    // 键盘（自绘计算器面板，或者系统输入法）常驻在底部会占掉一截屏幕，真正"看得见"的
    // 区域没有整个屏幕那么高，用"可视区域高度的一半"当作目标位置的偏移量，而不是死算像素中点。
    // 遮挡高度分两种：自绘计算器面板用 keypadPanelH（按键高算出的实际面板高，与
    // 类别网格停止线共用同一个值，不会再估矮越线）；系统键盘（备注框聚焦弹出来的那个）
    // 用 keyboardDidShow 事件给的真实高度，不能套用面板的常量——两个高度并不一样。
    // 自绘面板整体（含 iOS 键盘上抬量）都算遮挡；系统键盘用事件给的真实高度。
    const occludedHeight = amountKeypadOpen
      ? keypadPanelH + keypadBottomPad + keypadKeyboardLift
      : keyboardVisible
        ? keyboardHeight
        : 0;
    const visibleH = windowHeight - insets.top - occludedHeight;
    const targetOffset = Math.max(y - visibleH / 2, 0);
    // 延迟一帧再滚：紧跟在 setAmountKeypadOpen(true) 之后调用时，键盘面板刚出现，
    // 布局还没稳定，不等一下滚动目标位置会算得不准
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: targetOffset, animated: true });
    });
  };

  // 左边缘右滑返回：优先走返回栈（编辑流回列表/首页），Tab 版本直接切回"首页"
  const edgeBackHome = () => {
    hapticLight();
    if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) navigation.goBack();
    else navigation?.navigate(ROUTES.TAB_HOME);
  };

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.type === (type === 'transfer' ? 'expense' : type)),
    [categories, type]
  );

  // 选择类别页：支出按大类分组分节（组序=EXPENSE_CATEGORY_GROUPS，无组分类落尾部"其他"节）；
  // 折叠状态只在本页用，保存后重置。搜索时全部强制展开并按名字过滤。
  // 编辑模式（长按任一图标进入，iOS 风格）：图标抖动 + 删除角标，把分类拖到目标大组卡片标题上即换组
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // 组内联添加（TASK-004：从类别分类页并入——能力补齐后选择类别页自成一页，不再跳转）
  const [addingGroupName, setAddingGroupName] = useState<string | null>(null);
  const [inlineName, setInlineName] = useState('');
  const [inlineIcon, setInlineIcon] = useState<CategoryIconName>(CATEGORY_ICON_OPTIONS[0]);
  const [inlineColor, setInlineColor] = useState(CATEGORY_COLOR_OPTIONS[0]);
  // TASK-012④：名称输入框跟随焦点——聚焦时若被键盘挡住，滚动到输入框可见
  const inlineInputRef = useRef<TextInput | null>(null);
  const categoryScrollRef = useRef<ScrollView | null>(null);
  // 网格拖拽用：页面滚动量（内容坐标换算）+ 内容高度（贴边自动滚动夹取）
  const categoryScrollYSV = useSharedValue(0);
  const categoryContentHRef = useRef(0);
  const keyboardHeightRef = useRef(0);
  // TASK-016⑥：聚焦时把输入框滚到键盘上方。
  // measureLayout 在新架构(Fabric)下要求原生 ref，getInnerViewNode() 直接报
  // "must be called with a ref to a native component"——放弃测量输入框本身，
  // 改用分节卡片 onLayout 记录各组在 ScrollView 内容里的 y（卡片是 ScrollView
  // 直接子节点，layout.y 就是内容坐标，零测量歧义），聚焦时按组名查表滚动。
  const groupContentYRef = useRef<Record<string, number>>({});
  // 内联小卡在组卡内的 y 偏移（网格可能占多行，只滚到卡顶可能还盖不住/露不出输入框）
  const inlineCardOffsetRef = useRef<Record<string, number>>({});
  // 正在编辑内联小卡的组名：键盘弹出（keyboardDidShow）时补滚一次——
  // autoFocus 聚焦发生在键盘高度还未知的时候，先按 0 滚一版，键盘弹起后校正
  const inlineFocusGroupRef = useRef<string | null>(null);
  const scrollInlineInputIntoView = (groupName: string, keyboardH?: number) => {
    requestAnimationFrame(() => {
      const scroll = categoryScrollRef.current;
      if (!scroll) return;
      const cardY = groupContentYRef.current[groupName];
      if (cardY === undefined) return;
      const inlineY = inlineCardOffsetRef.current[groupName] ?? 0;
      // 头部留白 = 键盘高度的一半再减 60：键盘矮时输入框大致露在视口中部，
      // 键盘高时相应多滚。keyboardH 不传按当前 ref 值（键盘未弹时为 0，先滚一版）
      const kb = keyboardH ?? keyboardHeightRef.current;
      scroll.scrollTo({ y: Math.max(0, cardY + inlineY - Math.max(60, kb / 2)), animated: true });
    });
  };
  // 提交：加进目标组、轻震反馈、收起表单（不用弹窗打断——展开处立即可见新增结果）
  const handleInlineAdd = async (groupName: string) => {
    const name = inlineName.trim();
    if (!name) return;
    await addCategory({ name, icon: inlineIcon, color: inlineColor, type: type as 'expense' | 'income', group: groupName });
    hapticSuccess();
    setInlineName('');
    setInlineIcon(CATEGORY_ICON_OPTIONS[0]);
    setInlineColor(CATEGORY_COLOR_OPTIONS[0]);
    setAddingGroupName(null);
  };
  const [newGroupFormOpen, setNewGroupFormOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  // 编辑模式拖动排序（TASK-016：资产页三条横线式，只在大组内部排序、不跨组）
  const [categoryOrder, setCategoryOrder] = useState<Record<string, number>>({});
  useEffect(() => {
    AsyncStorage.getItem(CATEGORY_ORDER_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setCategoryOrder(parsed);
      })
      .catch(() => {});
  }, []);
  const persistCategoryOrder = (next: Record<string, number>) => {
    setCategoryOrder(next);
    AsyncStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(next)).catch(() => {});
  };
  // 某个大组内拖拽结束：把 0..n-1 写回该组这几个分类的序号；缺序号的分类排在其原本位置之后
  const handleCatReorder = (groupItems: Category[]) => {
    const next = { ...categoryOrder };
    groupItems.forEach((item, index) => {
      next[item.id] = index;
    });
    persistCategoryOrder(next);
    hapticSelection();
  };
  // 图标选择底部弹层（TASK-016 两步小卡：点预览方块打开，119 个图标 6 列）
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const confirmDeleteCategory = (c: Category) => {
    // 防呆：删的是大组里最后一个分类时提示"大组将一并移除"（组删除的既有级联行为不变，只加文案）
    const groupSize = filteredCategories.filter((x) => x.group === c.group).length;
    const isLastInGroup = !!c.group && groupSize <= 1;
    dialog.alert({
      title: t('addTx.deleteCategoryTitle'),
      message: isLastInGroup
        ? t('addTx.deleteLastInGroupMsg', { name: c.name, group: getGroupLabel(c.group as string, t) })
        : t('addTx.deleteCategoryMsg', { name: c.name }),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => deleteCategory(c.id) },
      ],
    });
  };

  // 确认删除大组：自定义组删除组记录；默认组把组内分类移到"其他"（组空了自动隐藏）
  const confirmDeleteGroup = (groupName: string, itemCount: number) => {
    const members = filteredCategories.filter((c) => c.group === groupName);
    const isCustom = categoryGroups.some((g) => g.name === groupName);
    dialog.alert({
      title: t('addTx.deleteGroupTitle', { name: groupName }),
      message: itemCount > 0 ? t('addTx.deleteGroupMsg', { count: itemCount }) : t('addTx.emptyGroup'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            if (isCustom) {
              deleteCategoryGroup(groupName);
            } else {
              members.forEach((c) => updateCategory(c.id, { group: undefined }));
            }
          },
        },
      ],
    });
  };
  // 离开本页/切换类型时重置编辑与搜索状态（分组默认全部展开，点卡片空白处可收起）
  useEffect(() => {
    setCollapsedGroups(new Set<string>());
    setNewGroupFormOpen(false);
    setNewGroupName('');
  }, [type, step, categoryGroups]);
  // 收入/支出各自的大组分组（默认组 + 自定义组 + 其他），支出与收入流程完全一致
  // ── 大组排序（本页与「管理类别」页共用 @jizhang/categoryGroupOrder）──
  // 为什么不用 RNGH：本页组头里的 Pressable 在按下那刻就自封 responder，RNGH 的 DOM 监听收不到
  // 后续 move（实测 onStart 从未触发）。PanResponder 走 React 的 responder 协商，
  // 且在 capture 阶段接管 → 长按满 250ms 后纵向移动即抬起整组，短按仍落到组头自己的 onPress。
  const [groupOrder, setGroupOrder] = useState<Record<string, number>>({});
  /** 拖动中的整组：from=起始位、hover=当前落点、dy=跟手位移 */
  const [gDrag, setGDrag] = useState<{ group: string; from: number; dy: number; hover: number } | null>(null);
  const groupPanCache = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});
  /** 图标拖拽进行中（CategoryGridEditor 通告）—— 组排序必须让位，两者互斥 */
  const iconDraggingRef = useRef(false);
  /** 组拖拽期间 + 结束后 350ms 内，屏蔽组头点击（否则松手会被当成折叠） */
  const groupTapBlockUntilRef = useRef(0);
  const handleIconDragging = (v: boolean) => {
    iconDraggingRef.current = v;
  };
  const groupPressAtRef = useRef(0);
  /** 每张组卡的布局（相对滚动内容）：拖动时算落点、算其它卡让位、画虚线占位都靠它 */
  const gBoxRef = useRef<Record<string, { y: number; h: number }>>({});
  const GROUP_HOLD_MS = 250;
  const GROUP_START_DY = 8;

  useEffect(() => {
    AsyncStorage.getItem(GROUP_ORDER_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') setGroupOrder(parsed);
        } catch {}
      })
      .catch(() => {});
  }, []);

  const applyGroupOrder = (next: Record<string, number>) => {
    setGroupOrder(next);
    AsyncStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(next)).catch(() => {});
  };

  const groupList = () => orderedExpenseSectionsRef.current.map((s) => s.group);

  /** 落点判定：手指所在整卡的中心越过谁的"中线"，就排到谁后面（自然支持拖到最底）。
   *  dy 传"有效位移"= 手指位移 + 拖动期间自动滚动产生的滚动量，否则贴边滚动时落点算不对。 */
  const computeHover = (group: string, dy: number) => {
    const list = groupList();
    const box = gBoxRef.current[group];
    if (!box) return Math.max(0, list.indexOf(group));
    const center = box.y + dy + box.h / 2;
    let idx = 0;
    list.forEach((g, i) => {
      const b = gBoxRef.current[g];
      if (b && center >= b.y + b.h / 2) idx = i;
    });
    return Math.min(list.length - 1, Math.max(0, idx));
  };

  /** 其它组卡的让位位移：被拖组跨过谁，谁就往相反方向挪一个"被拖组高度" */
  const shiftForGroup = (group: string) => {
    if (!gDrag) return 0;
    const list = groupList();
    const i = list.indexOf(group);
    const draggedH = gBoxRef.current[gDrag.group]?.h ?? 0;
    if (group === gDrag.group) return 0;
    if (gDrag.from < gDrag.hover && i > gDrag.from && i <= gDrag.hover) return -draggedH;
    if (gDrag.from > gDrag.hover && i >= gDrag.hover && i < gDrag.from) return draggedH;
    return 0;
  };

  /** 拖动期间持续采样：手指停在边缘带里就滚动列表，让用户能拖到看不见的位置（含最底部） */
  const gScroll0Ref = useRef(0);
  const gFingerYRef = useRef(-1);
  const gLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopGroupScrollLoop = () => {
    if (gLoopRef.current) {
      clearInterval(gLoopRef.current);
      gLoopRef.current = null;
    }
  };
  const startGroupScrollLoop = () => {
    stopGroupScrollLoop();
    gLoopRef.current = setInterval(() => {
      const fingerY = gFingerYRef.current;
      if (fingerY < 0) return;
      const winH = windowHeight;
      const EDGE = 140;
      let delta = 0;
      if (fingerY < EDGE) delta = -12;
      else if (fingerY > winH - EDGE) delta = 12;
      if (!delta) return;
      const next = Math.max(0, categoryScrollYSV.value + delta);
      categoryScrollRef.current?.scrollTo({ y: next, animated: false });
    }, 16);
  };

  const getGroupPanHandlers = (group: string) => {
    const cached = groupPanCache.current[group];
    if (cached) return cached.panHandlers;
    const responder = PanResponder.create({
      // 按下只记时刻，不接管：短按照旧走组头 onPress（折叠/展开、垃圾桶）
      onStartShouldSetPanResponderCapture: () => {
        groupPressAtRef.current = Date.now();
        return false;
      },
      onStartShouldSetPanResponder: () => !iconDraggingRef.current,
      // 长按满 250ms 后纵向移动 ≥8px → 在 capture 阶段接管（子节点此时抢不走）
      // 把手是独立小热区：按下即接管（原生 responder 下最可靠；不需要长按闸门）
      onMoveShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_e, g) => {
        hapticLight();
        groupTapBlockUntilRef.current = Date.now() + 60000;
        const from = Math.max(0, groupList().indexOf(group));
        gScroll0Ref.current = categoryScrollYSV.value;
        gFingerYRef.current = g.y0;
        startGroupScrollLoop();
        setGDrag({ group, from, dy: 0, hover: from });
      },
      onPanResponderMove: (_e, g) => {
        const from = Math.max(0, groupList().indexOf(group));
        gFingerYRef.current = g.moveY;
        // 有效位移 = 手指位移 + 自动滚动产生的滚动量（贴边滚动时卡片仍跟手）
        const eff = g.dy + (categoryScrollYSV.value - gScroll0Ref.current);
        const hover = computeHover(group, eff);
        setGDrag({ group, from, dy: eff, hover });
      },
      onPanResponderRelease: () => {
        stopGroupScrollLoop();
        groupTapBlockUntilRef.current = Date.now() + 350;
        gFingerYRef.current = -1;
        setGDrag((cur) => {
          if (cur) {
            const list = groupList();
            const next = [...list];
            const [moved] = next.splice(cur.from, 1);
            next.splice(Math.min(next.length, cur.hover), 0, moved);
            const order: Record<string, number> = {};
            next.forEach((g, i) => (order[g] = i));
            applyGroupOrder(order);
          }
          return null;
        });
      },
      onPanResponderTerminate: () => {
        stopGroupScrollLoop();
        groupTapBlockUntilRef.current = Date.now() + 350;
        gFingerYRef.current = -1;
        setGDrag(null);
      },
    });
    groupPanCache.current[group] = responder;
    return responder.panHandlers;
  };

  const groupedExpenseSections = useMemo(() => {
    const customGroups = categoryGroups.filter((g) => g.type === type);
    const customNames = customGroups.map((g) => g.name);
    const defaultGroups: string[] = type === 'expense' ? [...EXPENSE_CATEGORY_GROUPS] : [...INCOME_CATEGORY_GROUPS];
    const inOrder: { group: string; items: Category[]; custom?: boolean }[] = defaultGroups.map((group) => ({
      group,
      items: filteredCategories.filter((c) => c.group === group),
    }));
    // 自定义大类：空组也保留（编辑模式下可以拖分类进去）
    categoryGroups.forEach((cg) => {
      inOrder.push({
        group: cg.name,
        items: filteredCategories.filter((c) => c.group === cg.name),
        custom: true,
      });
    });
    const rest = filteredCategories.filter(
      (c) => !defaultGroups.includes(c.group as any) && !customNames.includes(c.group as any)
    );
    if (rest.length) {
      inOrder.push({ group: t('group.other'), items: rest });
    }
    // 默认组无内容时隐藏；自定义组即使为空也显示
    return inOrder.filter((s) => s.items.length > 0 || (s.custom && s.items.length === 0));
  }, [filteredCategories, categoryGroups, type]);

  /** 按用户排好的大组顺序渲染（未排过的保持原顺序殿后） */
  const orderedExpenseSections = useMemo(() => {
    const copy = [...groupedExpenseSections];
    return copy.sort(
      (a, b) => (groupOrder[a.group] ?? Number.MAX_SAFE_INTEGER) - (groupOrder[b.group] ?? Number.MAX_SAFE_INTEGER)
    );
  }, [groupedExpenseSections, groupOrder]);
  const orderedExpenseSectionsRef = useRef<{ group: string }[]>([]);
  orderedExpenseSectionsRef.current = orderedExpenseSections;

  // ---------- 类别横排"最近用过"：外面直接显示4个，点了就直接选中，不用进选择页 ----------
  const [recentCategoryIds, setRecentCategoryIds] = useState<string[]>([]);
  /** 网格顺序重建代号：列表数据（最近用过 / 固定格）落地、类型切换、重进页面（resetAll）时 +1 */
  const [catListsGen, setCatListsGen] = useState(0);
  useEffect(() => {
    AsyncStorage.getItem(RECENT_CATEGORY_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRecentCategoryIds(parsed);
        setCatListsGen((g) => g + 1); // 最近用过落地 → 重建网格顺序
      })
      .catch(() => {});
  }, []);
  // TASK-022：按类型恢复"最后选中类别 + 网格固定格"（杀进程重启后回来还是上次选好的）。
  // 只对 expense/income 恢复（transfer/exchange 无类别网格）。
  // 编辑模式也要恢复【网格固定格】——编辑页和记一笔必须铺出同一份格子（用户反馈：两页不一样）；
  // 但【选中类别】不恢复：编辑中的账单保持它自己的 categoryId，不被新增流的默认值覆盖。
  // 恢复的 id 若已被删除：selectedCategory 为 undefined（无高亮）、gridPinned 的 byId 查不到自动跳过，无副作用
  useEffect(() => {
    if (uiType !== 'expense' && uiType !== 'income') return;
    const savedType = uiType as 'expense' | 'income';
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(LAST_CATEGORY_KEY),
      AsyncStorage.getItem(SESSION_PICKED_KEY),
    ])
      .then(([lastRaw, pickedRaw]) => {
        if (cancelled) return;
        if (pickedRaw) {
          try {
            const picked = JSON.parse(pickedRaw);
            // 固定格两个模式共用：编辑页与记一笔铺出同一份网格
            if (picked && Array.isArray(picked[savedType])) setSessionPickedIds(picked[savedType]);
          } catch {}
        }
        // 编辑模式：网格照铺，但选中类别保持账单自己的，不读"最后选中"默认值
        if (isEditing) return;
        if (lastRaw) {
          try {
            const last = JSON.parse(lastRaw);
            if (last && typeof last[savedType] === 'string') setCategoryId(last[savedType]);
          } catch {}
        }
      })
      .then(() => {
        // 固定格数据落地（或已无更多读取）→ 重建网格顺序
        if (!cancelled) setCatListsGen((g) => g + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // 仅挂载/类型确定时恢复一次：依赖空数组会拿不到 route 参数，这里跟着 uiType/isEditing 走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiType, isEditing]);
  const bumpRecentCategory = (id: string) => {
    setRecentCategoryIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, RECENT_CATEGORY_HISTORY_LIMIT);
      AsyncStorage.setItem(RECENT_CATEGORY_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  // 最近用过的排前面，不够4个就用当前类型下的其他类别补齐，保证横排始终有得选
  // ---------- 类别网格（T15）：列数取 useLayout().categoryColumns（窄屏 4 / 常规·大屏 5，"全部"占一格） ----------

  // ---------- 类别网格内容：固定格 + 首行补齐 ----------
  // - 固定格：本次会话新选过的类别（新的在最前）+ 本地"最近用过"（记账成功时写入），顺序固定；
  // - 固定格不满第一行时按默认顺序补满（首屏永远是一整行 3/4 个类别）；
  // - 选了网格里没有的新类别：置顶插入并 +1 格（"全部"随流式布局下移一行，可无限开行）；
  // - 选已在网格里的旧类别：格位完全不动（保持现状），只切换高亮。
  // TASK-007：网格不限行数，历史类别累积越多铺得越远（最近用过历史上限 20）。
  const [sessionPickedIds, setSessionPickedIds] = useState<string[]>([]);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  // ---------- T15：类别网格容量（实测，不再按字符估宽）----------
  // 网格区是可滚动的 flex:1 区域：实测到多少高度就铺多少格（至少 2 行 —— 计划 8.2 第 7 条
  // 「金额 + 至少 2 行类别 + 键盘」一屏可见）；历史用过的类别超出可见容量时靠网格滚动查看，不再裁剪
  const [gridH, setGridH] = useState<number | null>(null);
  /** 类别格图标直径：与设置页 / 资产页同一套立体球的默认尺寸（42），4 列在 320 / 390 下都留得下 */
  const CAT_ICON_SIZE = 42;
  /** 一格行距 = 8 顶距 + 42 球 + 4 标签间距 + 16 单行标签预留 + 4 行距 = 74
   *  （顶距 8 = 选中两层外圈向外溢出的 8，外圈不占布局但必须有地方露出来；
   *   与 catCell / catCellLabel / catGridContent 样式同步；两行标签的格子自然变高，网格可滚动） */
  const CAT_CELL_ROW_HEIGHT = 74;
  const gridVisibleRows = gridH == null ? null : Math.max(2, Math.floor(gridH / CAT_CELL_ROW_HEIGHT));
  const gridMaxCount = gridVisibleRows == null ? null : gridVisibleRows * gridColumns - 1;
  // ---------- 网格顺序冻结（T15 修正）----------
  // 进入页面 / 切换支出·收入 / 列表数据落地（catListsGen）/ 保存后重进页面（resetAll）时重建一次；
  // 本次会话里「点网格格子」只高亮、不重排 —— 修「手指下的格子弹到第 1 格」；
  // 只有从「全部」抽屉选了「网格里没有」的类别才插到第 1 格（见抽屉 onPickCategory）；
  // 下次进页面仍按最近使用排序（点选照旧写 sessionPicked / recent，只是不改本次的顺序）
  const [gridOrder, setGridOrder] = useState<string[]>([]);
  useEffect(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    };
    sessionPickedIds.forEach(push);
    recentCategoryIds.forEach(push);
    setGridOrder(ids);
    // 有意不把 sessionPickedIds / recentCategoryIds 放进依赖：点选会改它们，但顺序要冻结
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiType, isEditing, catListsGen]);
  const gridPinned = useMemo(() => {
    const byId = new Map(filteredCategories.map((c) => [c.id, c] as const));
    const pinned: Category[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (seen.has(id)) return;
      const c = byId.get(id);
      if (c) {
        pinned.push(c);
        seen.add(id);
      }
    };
    gridOrder.forEach(push);
    // TASK-024 / T15：补齐目标 = 可见容量（gridMaxCount 已为「全部」预留 -1 格），
    // 首帧容量未知时至少补 2 行；冻结顺序（本次选过 + 最近用过）永远排在补齐类别前面
    const fillTarget = gridMaxCount ?? gridColumns * 2;
    for (const c of filteredCategories) {
      if (pinned.length >= fillTarget) break;
      push(c.id);
    }
    return pinned;
    // 补齐目标跟随可见容量（键盘弹出/收起、Hero 压缩都会改变 gridMaxCount）
  }, [gridOrder, filteredCategories, gridColumns, gridMaxCount]);
  // 金额币种只认所选账户（2026-09-24 用户定版）：选什么账户显示什么货币，没选账户用全局设置货币；
  // 弹层里的币种项只做账户筛选，不再改金额币种（displayCurrencyCode 直选机制已移除）
  const selectedAsset = assets.find((a) => a.id === assetId);
  const amountCurrencyCode = selectedAsset?.currency ?? currency;
  // Hero 账户选择框宽度 = 转账页账户块的实测宽度（transferBlockW，onLayout 从转账块同步来，
  // 两页切换零跑位）；首次渲染还没量到时用几何公式兜底（转账卡内 flex:1 均分 = (屏宽−116)/2）
  const [transferBlockW, setTransferBlockW] = useState(() => (windowWidth - 116) / 2);
  // T14：金额显示串——键盘打开时，单项 = 正在输入的金额串（带光标），
  // 多项（有 +/− 运算符）= 算式移到金额上方 15pt、金额行显示合计（expressionTotal 复用共享求和函数）；
  // 键盘关着时 = 已保存的金额（与保存语义一致，不改任何计算逻辑）
  const heroAmountDisplay = amountKeypadOpen
    ? amountExpr.isMulti
      ? formatMoney(expressionTotal(amountExpr.displayValue))
      : amountExpr.displayValue
    : amount || '0.00';
  // 金额字号档位（V2 稿基准 64；矮屏按 T15 惯例再收一档 44，给类别网格腾「至少 2 行」）
  const heroAmountFontSize = amountFontTier(heroAmountDisplay, isShort ? 44 : 64);
  const fromAsset = assets.find((a) => a.id === fromAssetId);
  const toAsset = assets.find((a) => a.id === toAssetId);
  const isCrossCurrency = !!fromAsset && !!toAsset && fromAsset.currency !== toAsset.currency;
  // 兑换页始终显示汇率输入；普通转账只在跨币种时才显示
  const showRateField = isExchange || isCrossCurrency;

  useEffect(() => {
    if (isEditing && editTransaction?.type === 'transfer') {
      dialog.alert({ title: t('addTx.transferEditUnsupported'), message: t('addTx.transferEditUnsupportedMsg') });
      navigation?.goBack();
    }
    if (presetCategoryId) {
      setCategoryId(presetCategoryId);
      setStep('detail');
    }
    if (autoScan) {
      handleScanPress();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- T17：保存成功的 300ms 勾选动画 ----------
  // 四个保存路径（完成 / 长按完成 / 转账完成 / 转账长按）统一走 playSaveFlashThen：
  // success 震动由各调用点先发，这里只负责「中央徽章弹入 → 300ms 后执行原本的返回/留页逻辑」
  const [saveFlash, setSaveFlash] = useState(false);
  const saveFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current);
    },
    []
  );
  const playSaveFlashThen = (next: () => void) => {
    setSaveFlash(true);
    if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current);
    saveFlashTimerRef.current = setTimeout(() => {
      saveFlashTimerRef.current = null;
      setSaveFlash(false);
      next();
    }, 300);
  };

  // ---------- UI V2：类别选中的外圈 ----------
  // 由页面侧画（IconCircle 的 boxShadow / style 两个入口在 react-native-web 下都不落地）：
  // 真圆 = 58 圆 + borderWidth 2（夜：类别色 60% / 日 #9B5BD6），与 48 实心圆之间留 3 的页面底间隙；
  // 绝对定位在 48 盒子上 → 不影响网格行高、选中前后图标不位移。等 ui 侧修好可移除。

  const resetAll = () => {
    // 类型也要重置回支出：底部Tab的"记一笔"切走不会卸载，uiType 留着的话，
    // 上次停在转账/兑换，回来就还是转账/兑换，而不是用户期望的全新支出表单
    setUiType('expense');
    setStep(stepForType('expense'));
    // 重进页面：网格顺序按"最近用过"重建一次（本次会话里的点选只写存储、不改已冻结的顺序）
    setCatListsGen((g) => g + 1);
    // TASK-009：退出返回不清类别——sessionPickedIds（本次选过的）/recentCategoryIds（本地历史）
    // /categoryId（当前选中）全部保留，回来网格和选中态原样恢复；只清表单内容
    setAmount('');
    amountExpr.reset();
    setAmountKeypadOpen(true);
    setNote('');
    setDate(todayStr());
    // 重置后恢复"自动跟随默认账户"（金额币种只认所选账户，无需复位手动币种）
    userPickedAssetRef.current = false;
    userPickedFromRef.current = false;
    setAssetId(defaultAsset?.id ?? null);
    setAssetPickerOpen(false);
    setFromAssetId(defaultAsset?.id ?? null);
    setToAssetId(null);
    setExchangeRate('');
    setFee('');
    rateExpr.reset();
    feeExpr.reset();
    setAmountCursor(0);
    setRateCursor(0);
    setFeeCursor(0);
    setCalculatorTarget('amount');
    setReceiptUri(null);
    // 自动月结开关复位为关：默认关闭，每次回来都要手动开启
    setAutoMonthly(false);
    // 离开页面时可能还开着的弹层一并关掉，回来才是干净的初始状态
    setAccountPickerOpen(false);
    setDateSheetOpen(false);
    setDatePickerOpen(false);
    setReceiptPreviewOpen(false);
  };

  // 底部Tab导航默认会把没聚焦的页面状态一直留着（不会卸载重建），
  // 所以"切走再切回来表单清空"这个效果得主动做：监听"离开这个页面"（blur），
  // 一旦离开就立刻重置——这样不管用户是切到别的Tab、还是从"记一笔"跳去创建资产账户，
  // 只要真的离开过这个页面，回来看到的都是干净的新表单。
  // 编辑已有账单（isEditing）时不重置，避免正常编辑流程里出现的跳转（比如点"类别"、"资产"字段）把编辑中的内容清掉。
  // 另外正在"选择类别"步骤（step === 'category'）时也不重置：此时点「＋ 添加」会 push 类别分类页，
  // push 会触发本页 blur——如果这里重置了 step，goBack 弹回来就变成记账表单而不是选择类别页。
  useEffect(() => {
    if (!navigation?.addListener) return;
    const unsubscribe = navigation.addListener('blur', () => {
      if (!isEditing && step !== 'category') {
        resetAll();
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, isEditing]);

  // 备注框是真实 TextInput，聚焦时弹出的是系统键盘——这跟 amountKeypadOpen（自绘计算器面板）
  // 是两码事，之前只盯着 amountKeypadOpen 一个条件，备注聚焦、系统键盘弹起来的时候
  // Tab bar 完全没被强制隐藏。转账/兑换这个页面内容本来就不长，可滚动的距离经常不够
  // 60px（滚动隐藏逻辑触发的最小距离），所以单靠"滚动去触发隐藏"这条路常常根本走不通——
  // 真正该盯的信号是"系统键盘是不是弹出来了"，而不是"滚了多少像素"。
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // 备注框聚焦标记：系统键盘此刻是"面板内备注框"弹的——这是唯一允许系统键盘与
  // 自绘面板共存的场景，keyboardDidShow 时不能把面板收掉（否则备注框随面板卸载、
  // 系统键盘跟着掉下来、面板又被 keyboardDidHide 弹回来，两套键盘互相卡死）
  const noteFocusRef = useRef(false);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardVisible(true);
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
      keyboardHeightRef.current = e?.endCoordinates?.height ?? 0;
      // TASK-016⑥：内联小卡输入框聚焦中 → 键盘弹起后按真实高度校正滚动位置
      if (isFocused && inlineFocusGroupRef.current) {
        scrollInlineInputIntoView(inlineFocusGroupRef.current, keyboardHeightRef.current);
      }
      // 系统键盘弹出 → 自绘面板收起让位；但备注框聚焦的共存场景例外
      if (isFocused && !noteFocusRef.current) setAmountKeypadOpen(false);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      keyboardHeightRef.current = 0;
      // 系统键盘收起 → 自绘面板重新出现（含 Android 返回键收起键盘的情况）
      if (isFocused && !noteFocusRef.current) setAmountKeypadOpen(true);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [isFocused]);

  // 键盘区实际占掉的高度 = 面板本身 + 底部让位（类别网格的停止线、字段滚动居中都用这一个值，不再各处各算）
  const keypadAreaH = keypadPanelH + keypadBottomPad;
  // iOS 键盘避让：iOS 的系统键盘弹出时窗口高度不变（安卓 adjustResize 会自动缩小窗口，
  // 底部面板天然停在键盘上沿），而备注框聚焦时系统键盘与自绘面板是共存的（noteFocusRef），
  // 不抬起来「备注输入框 + 完成键」就整块压在键盘底下。
  // 上抬量夹在「面板仍完整留在顶部安全区内」：320×568 这种矮屏 + 高键盘不会把面板顶出屏幕。
  const keypadKeyboardLift =
    Platform.OS === 'ios' && keyboardVisible
      ? Math.max(0, Math.min(keyboardHeight, windowHeight - insets.top - keypadAreaH))
      : 0;
  // 图标选择弹层（Modal）最大高度 = min(屏高 × 0.72, 视口高 − 顶部安全区)；
  // 底部安全区由它自己的 paddingBottom（bottomInset + 16）让出，不重复扣。
  const iconPickerMaxHeight = Math.round(Math.max(0, Math.min(windowHeight * 0.72, windowHeight - insets.top)));


  // 最终网格内容：固定在前的（本次选过 + 最近用过）、按默认顺序补齐到可见容量；
  // 多出来的（历史用过的）不再按字符估宽裁剪丢弃 —— 网格区可滚动（T15），「全部」永远殿后
  const displayCategories = useMemo(() => {
    if (!selectedCategory || gridPinned.some((c) => c.id === selectedCategory.id)) return gridPinned;
    return [selectedCategory, ...gridPinned];
  }, [gridPinned, selectedCategory]);

  // 计算器键盘和浮空 Tab bar 在同一块屏幕区域，键盘展开时强制把 Tab bar 收起，
  // 键盘收起（按完成、或者切到别的表单）时恢复——避免两者叠在一起互相挡住点击
  //
  // 关键：一定要判断 isFocused。"记一笔"这个屏幕在 App.tsx 里注册了两次
  // （底部Tab中间按钮 + HomeStack 里编辑用的那个），底部Tab那个默认不会因为
  // 切走就卸载，会一直挂在内存里。如果不判断 isFocused，这个"看不见"的实例
  // 光是初始 amountKeypadOpen=true 就会在App启动时偷偷把全局 forced 设成 true，
  // 之后不管你在哪个页面，Tab bar 的滚动隐藏逻辑全都会被这个跟当前画面无关的
  // 状态卡住——这正是"进页面弹计算器Tab bar还在"/"完成后Tab bar消失不回来"这类
  // 看起来随机、其实是两个实例互相抢状态的根源。
  //
  // 三个来源都会挡住底部：自绘计算器面板（amountKeypadOpen）、系统键盘（keyboardVisible）、
  // 键盘日期键弹出的 DateRangePickerSheet（datePickerOpen——之前它开/关时会把 Tab 栏放出来，
  // 选完日期正好挡住计算器面板）。任一开着就强制隐藏，全部关了才交还控制权。
  // 强制隐藏的合并条件：任何覆盖本页的面板 / 键盘 / 弹层开着，栏都必须藏住。
  // 子组件（BottomSheet）关闭时会自行放栏，所以这里每次渲染都重新断言一次（true），
  // 保证「计算器仍开着」时栏不会在子弹层关闭的那一刻跳出来。
  const forceHideWanted =
    amountKeypadOpen ||
    keyboardVisible ||
    datePickerOpen ||
    dateSheetOpen ||
    assetPickerOpen ||
    catSheetOpen ||
    accountPickerOpen ||
    receiptPreviewOpen ||
    newGroupFormOpen ||
    iconPickerOpen;
  // 释放防抖：条件持续为假 250ms 后才放栏，任何过渡帧都不闪现
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isFocused) return; // 没在前台的实例，不该去动全局 Tab bar 状态
    if (forceHideWanted) {
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      setTabBarForceHidden(true);
      return;
    }
    if (!releaseTimerRef.current) {
      releaseTimerRef.current = setTimeout(() => {
        releaseTimerRef.current = null;
        setTabBarForceHidden(false);
      }, 250);
    }
  });

  // 弹层（账户 / 类别 / 日期 / 小票 / 新建分组 / 图标）关闭后还原计算器面板：
  // 弹层里的搜索框会弹系统键盘 → keyboardDidShow 把 amountKeypadOpen 清掉；弹层随即卸载时
  // Android 不一定再发 keyboardDidHide，面板就丢了、Tab 栏随之失去隐藏理由。所以弹层打开时记下
  // 打开前的面板状态，最后一个弹层关闭时若打开前是开着的就还原（备注框聚焦的共存场景不动）。
  const overlayOpen =
    datePickerOpen ||
    dateSheetOpen ||
    assetPickerOpen ||
    catSheetOpen ||
    accountPickerOpen ||
    receiptPreviewOpen ||
    newGroupFormOpen ||
    iconPickerOpen;
  const keypadBeforeOverlayRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!isFocused) return;
    if (overlayOpen) {
      if (keypadBeforeOverlayRef.current === null) keypadBeforeOverlayRef.current = amountKeypadOpen;
      return;
    }
    const prior = keypadBeforeOverlayRef.current;
    keypadBeforeOverlayRef.current = null;
    if (prior === true && !noteFocusRef.current) setAmountKeypadOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOpen, isFocused]);

  // 安卓硬件返回键（页面级）：只关闭「浮层」，永不收起计算器键盘（键盘上有「完成」保存键，
  // 收起了就存不了）。有浮层开着 → 关掉最上面那一层并拦截；没有 → 返回 false，走正常的返回上一页。
  // 底部抽屉 / 日期面板 / 弹窗自己注册的 BackHandler 是后注册的，先处理，走不到这里。
  // 只在本页聚焦时处理。用 ref 转发最新闭包，监听只挂一次。
  const closeTopOverlayRef = useRef<() => boolean>(() => false);
  closeTopOverlayRef.current = () => {
    if (!isFocused) return false;
    if (iconPickerOpen) {
      setIconPickerOpen(false);
      return true;
    }
    if (newGroupFormOpen) {
      setNewGroupFormOpen(false);
      return true;
    }
    if (receiptPreviewOpen) {
      setReceiptPreviewOpen(false);
      return true;
    }
    if (datePickerOpen) {
      setDatePickerOpen(false);
      return true;
    }
    if (dateSheetOpen) {
      setDateSheetOpen(false);
      return true;
    }
    if (assetPickerOpen) {
      setAssetPickerOpen(false);
      return true;
    }
    if (accountPickerOpen) {
      setAccountPickerOpen(false);
      return true;
    }
    if (catSheetOpen) {
      setCatSheetOpen(false);
      return true;
    }
    return false;
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => closeTopOverlayRef.current());
    return () => sub.remove();
  }, []);

  // 失焦（切走/卸载）时才把强制隐藏交还回去
  useEffect(() => {
    if (!isFocused) {
      setTabBarForceHidden(false);
    }
    return () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
      setTabBarForceHidden(false);
    };
  }, [isFocused]);

  const handlePickCategory = (id: string) => {
    // 选类别 = selection 震动（UI_RULES 4.3；网格格与「全部」抽屉共用这一套）
    hapticSelection();
    setCategoryId(id);
    // TASK-022 补充：编辑账单时点类别只改这一笔，绝不写持久化键——
    // 否则会污染"记一笔（新增）"记住的默认类别（编辑模式自己又不读这个键，表现为两边不同步）
    if (!isEditing) {
      // 按类型持久化"最后选中"（杀进程重启后自动恢复）；transfer/exchange 不记
      if (uiType === 'expense' || uiType === 'income') {
        AsyncStorage.getItem(LAST_CATEGORY_KEY)
          .then((raw) => {
            const last = raw ? JSON.parse(raw) : {};
            last[uiType] = id;
            AsyncStorage.setItem(LAST_CATEGORY_KEY, JSON.stringify(last)).catch(() => {});
          })
          .catch(() => {});
      }
      // 新选的类别进入网格固定格（置顶、自动 +1 格）；已在网格里的旧类别不动格位。
      // 固定格同步持久化（SESSION_PICKED_KEY），重启后网格原样恢复
      setSessionPickedIds((prev) => {
        const next = [id, ...prev.filter((x) => x !== id)];
        if (uiType === 'expense' || uiType === 'income') {
          AsyncStorage.getItem(SESSION_PICKED_KEY)
            .then((raw) => {
              const saved = raw ? JSON.parse(raw) : {};
              saved[uiType] = next;
              AsyncStorage.setItem(SESSION_PICKED_KEY, JSON.stringify(saved)).catch(() => {});
            })
            .catch(() => {});
        }
        return next;
      });
    }
    setStep('detail');
  };

  // 支出/收入保存的公共逻辑，返回是否保存成功（校验不过时不弹走）
  // amountOverride：计算器键盘刚算完结果、还没来得及走完 setAmount 的下一次渲染就要保存时，
  // 直接把算出来的数传进来，不依赖 state 更新时序，避免"刚打完字点完成，存的却是上一笔的金额"
  const saveTransaction = async (amountOverride?: number) => {
    const value = amountOverride ?? parseFloat(amount);
    if (!value || value <= 0) {
      dialog.alert({ title: t('addTx.enterValidAmount') });
      return false;
    }
    if (!categoryId) {
      dialog.alert({ title: t('addTx.selectCategoryAlert') });
      return false;
    }
    // 账户必选：没选账户不允许保存（转账/兑换走各自的 from/to 校验，不经过这里）
    if (!isEditing && !assetId) {
      dialog.alert({ title: t('addTx.selectAssetAlert') });
      return false;
    }
    if (isEditing && editTransaction) {
      await updateTransaction(editTransaction.id, {
        amount: value,
        categoryId,
        type: type as 'expense' | 'income',
        date,
        note,
        assetId: assetId ?? undefined,
        receiptUri: receiptUri ?? undefined,
      });
    } else {
      await addTransaction({
        amount: value,
        categoryId,
        type: type as 'expense' | 'income',
        date,
        note,
        assetId: assetId ?? undefined,
        receiptUri: receiptUri ?? undefined,
      });
    }
    // "最近用过"只在这一笔真的记完账之后才更新，点击/切换类别选择本身不算——
    // 这样横排那4个分类在你填表的过程中不会因为点了别的类别就跳位置
    bumpRecentCategory(categoryId);

    // 自动月结：开关打开（默认关，手动开）时，把这笔账同步建成一条「每月同日自动入账」的
    // 财务规划——之后每个月由补账引擎自动 ±账目。防重复：同名称+同金额+同周期+同账户的计划已存在则跳过
    if (!isEditing && autoMonthly) {
      const planName = note.trim() || (selectedCategory ? getCategoryLabel(selectedCategory, t) : (type === 'income' ? t('finance.typeIncome') : t('finance.typeExpense')));
      const alreadyPlanned = paymentPlans.some(
        (p) => p.cycle === 'monthly' && p.amount === value && p.name === planName && p.assetId === (assetId ?? undefined)
      );
      if (!alreadyPlanned) {
        void addPaymentPlan({
          ledgerId: activeLedgerId,
          name: planName,
          amount: value,
          type: type as 'expense' | 'income',
          cycle: 'monthly',
          dayOfMonth: Math.min(31, Math.max(1, Number(date.slice(8, 10)) || 1)),
          startDate: date,
          // 这一期已由本轮手工账覆盖：游标钉到本期，补账引擎从「下个月同日」才开始自动入账。
          // 不钉游标时首期=保存当天，引擎会当场再补一笔——同一天出两条记录（2026-10-04 修复）
          lastProcessedDate: date,
          autoDeduct: true,
          categoryId: categoryId,
          assetId: assetId ?? undefined,
          active: true,
        } as any);
      }
    }

    return true;
  };

  // 编辑页右上角垃圾桶：确认后删除这笔账并返回列表
  const handleDeleteTransaction = () => {
    if (!isEditing || !editTransaction) return;
    dialog.alert({
      title: t('addTx.deleteTxTitle'),
      message: t('addTx.deleteTxMsg'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            hapticWarning();
            deleteTransaction(editTransaction.id);
            navigation?.goBack();
          },
        },
      ],
    });
  };

  // 把计算器表达式算出来的结果写回 amount。键盘现在是常驻的（保存键一直露在外面），
  // 点"完成"/长按"完成"/点键盘以外的地方都只是"把这个数定下来"，不会再把键盘收起去
  const commitAmount = () => {
    const total = amountExpr.confirm();
    setAmount(total.toFixed(2));
    return total;
  };

  // 计算器键盘的"完成"键现在就是保存键：点一下＝算出金额、保存这一笔（键盘不用收起，保存键一直都在）
  // 加 try/catch 是因为：这是个 async 函数，如果内部（amountExpr.confirm / addTransaction 等）
  // 抛出异常又没人接住，Promise 会变成"未处理的 rejection"——不会崩溃，也不会有任何提示，
  // 表现出来就是点了"完成"完全没反应。这里统一兜底，出问题至少能看到是哪里错了。
  const handleKeypadConfirm = async () => {
    try {
      const total = commitAmount();
      const ok = await saveTransaction(total);
      if (ok) {
        hapticSuccess();
        // T17：勾选动画 300ms 后照原逻辑返回（编辑 → 返回；新增 → 清表单回首页）
        playSaveFlashThen(() => {
          if (isEditing) {
            navigation?.goBack();
          } else {
            resetAll();
            navigation?.navigate(ROUTES.TAB_HOME);
          }
        });
      }
    } catch (err) {
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // 长按"完成"＝保存这一笔之后不退出，留在本页直接记下一笔
  // （原来"保存并继续记一笔"按钮做的事，现在挪到这个长按手势上；编辑模式下不会用到）
  const handleKeypadConfirmAndContinue = async () => {
    try {
      const total = commitAmount();
      const ok = await saveTransaction(total);
      if (ok) {
        hapticSuccess();
        // T17：同样先播勾选动画，300ms 后清表单、留在本页记下一笔
        playSaveFlashThen(() => {
          resetAll();
        });
      }
    } catch (err) {
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // Enter/下一步箭头已由小数点键取代（标准金额录入）；备注框常驻在计算器面板里可随时点

  // 转账/兑换字段统一走同一个计算器。只有编辑“转出金额”时，完成键才会保存整笔记录；
  // 汇率/手续费完成键只负责把计算结果写回对应字段，不会提前保存。
  const openTransferCalculator = (target: 'amount' | 'rate' | 'fee') => {
    // 备注框的系统键盘/光标退场：一次只允许一个光标显示（点自绘字段 = 切换输入焦点）
    noteInputRef.current?.blur();
    // 切换到另一个字段之前，先把当前正在编辑、还没确认的算式定下来——
    // 不然直接点别的格子（比如输入了500转出金额，手滑点了汇率格子）会导致
    // 刚输入的值从没写回 amount/exchangeRate/fee 这几个 state，显示直接跳回 0
    if (amountKeypadOpen && calculatorTarget !== target) {
      commitTransferField();
    }
    setCalculatorTarget(target);
    // 打开键盘即从空态起输：按 5 就是 5 元，新输入直接替换旧值（不再从尾部续接）
    if (target === 'amount') { amountExpr.reset(); setAmountCursor(0); }
    if (target === 'rate') { rateExpr.reset(); setRateCursor(0); }
    if (target === 'fee') { feeExpr.reset(); setFeeCursor(0); }
    setAmountKeypadOpen(true);
    scrollToField(target);
  };

  // 转账/兑换计算器统一的"定下当前这一格的值"，不负责收起键盘——理由同上，键盘常驻
  const commitTransferField = () => {
    if (calculatorTarget === 'amount') {
      const total = amountExpr.confirm();
      setAmount(total.toFixed(2));
      return total;
    }
    if (calculatorTarget === 'rate') {
      const value = rateExpr.confirm();
      setExchangeRate(value.toString());
      return value;
    }
    const value = feeExpr.confirm();
    setFee(value.toString());
    return value;
  };

  // 同样的道理：这是 async 函数，内部任何一步抛错都可能悄无声息地失败，这里统一兜底弹出来
  //
  // 之前这里写死成"只有停在金额这一格，完成才会保存"——但兑换默认要经过
  // 金额→汇率→手续费三格，用户打完汇率或手续费之后顺手点"完成"（并没有特意跳回金额格）
  // 是最常见的操作路径，这种情况以前会直接掉进 commitTransferField() 就 return 了，
  // 界面上什么反应都没有，跟没点一样。现在改成：不管停在哪一格，"完成"都先把这一格定下来，
  // 再拿着这个刚算出来的值去尝试保存整笔——跟支出/收入那边"完成＝保存"保持一致语义。
  const handleTransferCalculatorConfirm = async () => {
    try {
      const committed = commitTransferField();
      const ok = await handleSaveTransferWithAmount(
        calculatorTarget === 'amount' ? committed : undefined,
        {
          rateOverride: calculatorTarget === 'rate' ? committed : undefined,
          feeOverride: calculatorTarget === 'fee' ? committed : undefined,
        }
      );
      // 校验没过（比如还没选转入账户）时 ok 是 undefined：commitTransferField 已经把这一格的值
      // 写回 state 了，保留着不用回滚，用户能看到刚打的数字，去把没填的部分填完再点一次就行
      void ok;
    } catch (err) {
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // 长按"完成"＝保存后留在本页继续记下一笔转账/兑换，跟支出/收入那边是同一个概念；
  // 跟上面单击"完成"一样，不再局限于"必须停在金额格"才生效
  const handleTransferCalculatorConfirmAndContinue = async () => {
    try {
      const committed = commitTransferField();
      await handleSaveTransferWithAmount(
        calculatorTarget === 'amount' ? committed : undefined,
        {
          continueRecording: true,
          rateOverride: calculatorTarget === 'rate' ? committed : undefined,
          feeOverride: calculatorTarget === 'fee' ? committed : undefined,
        }
      );
    } catch (err) {
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // amountOverride/rateOverride/feeOverride：三个都是可选的"这一格刚算出来、
  // 还没等 state 更新生效"的即时值——跟原来只有 amount 有这个保护是一个道理，
  // 现在汇率/手续费格点"完成"也要能直接保存，一样会撞上同样的时序坑，所以一起补上
  const handleSaveTransferWithAmount = async (
    amountOverride?: number,
    options?: { continueRecording?: boolean; rateOverride?: number; feeOverride?: number }
  ) => {
    const value = amountOverride ?? parseFloat(amount);
    if (!value || value <= 0) {
      dialog.alert({ title: t('addTx.transferAmountInvalid') });
      return;
    }
    if (!fromAssetId || !toAssetId) {
      dialog.alert({ title: t('addTx.selectBothAccounts') });
      return;
    }
    if (fromAssetId === toAssetId) {
      dialog.alert({ title: t('addTx.sameAccount') });
      return;
    }
    const rate = showRateField ? (options?.rateOverride ?? parseFloat(exchangeRate)) : 1;
    if (showRateField && (!rate || rate <= 0)) {
      dialog.alert({ title: t('addTx.rateInvalid') });
      return;
    }
    const feeValue = options?.feeOverride ?? (parseFloat(fee) || 0);
    // 备注同下面这行一起搬进了键盘面板，小票(收据)现在转账/兑换也能附了——
    // 如果 addTransfer 的类型定义里还没有 receiptUri 字段，需要先在那边补上
    await addTransfer({
      fromAssetId,
      toAssetId,
      amount: value,
      exchangeRate: rate,
      fee: feeValue,
      date,
      note,
      receiptUri: receiptUri ?? undefined,
    });
    // T17：success 震动 + 300ms 勾选动画，然后照原逻辑（清表单；非长按再回首页）
    hapticSuccess();
    playSaveFlashThen(() => {
      resetAll();
      // 长按"完成"＝保存后继续记下一笔，留在本页；普通点击才退出到首页
      if (!options?.continueRecording) {
        navigation?.navigate(ROUTES.TAB_HOME);
      }
    });
    return true;
  };

  const handleSaveTransfer = () => handleSaveTransferWithAmount();

  // ---------- 扫描小票 ----------
  // 纯云端模式：统一走云端 OCR 解析（本地 AICore 模块已移除，ML Kit GenAI 依赖在
  // EAS 上无法解析——公开仓库不含该 artifact，恢复本地模式时从 Zcode 备份取回）
  const runScan = async (base64: string, uri: string) => {
    // 未配置 AI 密钥（环境变量缺失）→ 优雅降级：不请求、不崩，提示后让用户手动记账
    if (!isAiConfigured) {
      dialog.alert({ title: t('addTx.scanUnavailableTitle'), message: t('addTx.scanUnavailableMsg') });
      return;
    }
    setScanning(true);
    try {
      const result = await scanReceipt(base64);

      setUiType(result.type);

      if (result.suggestedCategory) {
        // AI 提示词固定中文，返回的是中文分类名 → 先映射成内置分类 id 再按 id 匹配，
        // 与界面语言（中文/英文）无关；AI 不会建议用户自建分类，不再按存储名兜底
        const suggestedId = findCategoryIdByChineseName(result.suggestedCategory);
        const matched = suggestedId
          ? categories.find((c) => c.type === result.type && c.id === suggestedId)
          : undefined;
        if (matched) setCategoryId(matched.id);
      }
      if (result.amount != null) {
        setAmount(String(result.amount));
        amountExpr.reset(result.amount);
      }
      if (result.date) setDate(result.date);
      if (result.merchant) setNote(result.merchant);
      // 扫描用的这张照片本身就是单据，顺手存成凭证，不用用户再拍一次
      setReceiptUri(uri);

      setStep('detail');

      if (result.amount == null) {
        dialog.alert({ title: t('common.confirm'), message: t('addTx.scanNoAmount') });
      }
    } catch (e: any) {
      dialog.alert({ title: t('addTx.scanFailed'), message: e?.message ?? t('addTx.scanFailed') });
    } finally {
      setScanning(false);
    }
  };

  // 拍小票用自绘相机（ReceiptCameraModal），不再调系统相机 App。
  // 'scan' = 扫描小票走 OCR 识别；'receipt' = 单纯留档附凭证，不识别。
  // 两个入口共用同一个相机页面，用这个字段区分拍完之后要干嘛
  const [cameraMode, setCameraMode] = useState<'scan' | 'receipt' | null>(null);

  const handleScanPress = () => {
    // 没有 AI 密钥时不必开相机（拍了也解析不了）——直接给不可用提示
    if (!isAiConfigured) {
      dialog.alert({ title: t('addTx.scanUnavailableTitle'), message: t('addTx.scanUnavailableMsg') });
      return;
    }
    setCameraMode('scan');
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('addTx.photoPermissionTitle'), message: t('addTx.photoPermissionMsg') });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, base64: true });
    if (!result.canceled && result.assets?.[0]?.base64 && result.assets?.[0]?.uri) {
      runScan(result.assets[0].base64, result.assets[0].uri);
    }
  };

  // ---------- 凭证附件：单纯留档用的原始单据照片，不走AI识别 ----------
  const handleAttachReceipt = () => {
    setCameraMode('receipt');
  };

  const pickReceiptFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      dialog.alert({ title: t('addTx.photoPermissionTitle'), message: t('addTx.photoPermissionMsg') });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
    if (!result.canceled && result.assets?.[0]?.uri) setReceiptUri(result.assets[0].uri);
  };

  if (scanning) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}>
        <View style={styles.scanningWrap}>
          <ActivityIndicator size="large" color={colors.icon} />
          <Text style={styles.scanningText}>{t('addTx.aiScanning')}</Text>
        </View>
      </SafeAreaView>
    );
  }


  const TYPE_TABS: { key: UiType; label: string }[] = [
    { key: 'expense', label: t('addTx.expense') },
    { key: 'income', label: t('addTx.income') },
    { key: 'transfer', label: t('addTx.transfer') },
    { key: 'exchange', label: t('addTx.exchange') },
  ];

  // 转账/兑换账户选择已改为当前页面内的弹层菜单，直接进入金额表单。

  // ---------- 转账/兑换：填金额/汇率/手续费 ----------
  if (type === 'transfer' && step === 'transferDetail') {
    const fromSymbol = getCurrencySymbol(fromAsset?.currency ?? currency);
    const toSymbol = getCurrencySymbol(toAsset?.currency ?? currency);    const rateNum = parseFloat(exchangeRate) || 0;
    const amountNum = parseFloat(amount) || 0;
    const feeNum = parseFloat(fee) || 0;
    // 正在哪个格子上打字，到账金额就实时用那个格子键盘上当前的数字算，不用等按"完成"——
    // parseFloat 遇到还没打完的算式（比如"12+"）只会取到已经能解析的那一段，
    // 这是能不依赖 useAmountExpression 内部状态、又不用等 confirm() 的前提下能做到的最好效果
    const liveAmountNum = calculatorTarget === 'amount' && amountKeypadOpen ? parseFloat(amountExpr.displayValue) || 0 : amountNum;
    const liveRateNum = calculatorTarget === 'rate' && amountKeypadOpen ? parseFloat(rateExpr.displayValue) || 0 : rateNum;
    const liveFeeNum = calculatorTarget === 'fee' && amountKeypadOpen ? parseFloat(feeExpr.displayValue) || 0 : feeNum;
    // 手续费从转出金额里先扣掉，剩下的部分才拿去换算成到账金额（普通转账没有汇率，等于 rate=1）
    const netAmount = Math.max(0, liveAmountNum - liveFeeNum);
    const converted = formatMoney(showRateField ? netAmount * liveRateNum : netAmount, { decimals: 2 });

    return (
      <EdgeBackSwipe onBack={edgeBackHome}>
      <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}>
        <View style={{ flex: 1 }}>
        {/* UI V2：最底层品牌渐变（与支出/收入同一档：400 / 矮屏 ×0.9） */}
        <HeroGradient fill />
        {/* 页头两行（T14）：返回 + 标题 + 扫票 / 类型分段独占一行；转账·兑换不做扫票识别 */}
        <TransactionTypeHeader
          uiType={uiType}
          onBack={() => navigation?.goBack()}
          onSelectType={(nextType) => {
            setUiType(nextType);
            setCategoryId(null);
            setStep(stepForType(nextType));
          }}
          title={t('nav.add')}
        />

        <ScrollView
          ref={scrollViewRef}
          style={{ flex: 1 }}
          onScroll={onTabScroll ?? undefined}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.exchangePageContent,
            // 键盘面板是常驻底部 footer，页面内容现在正好一屏放下：
            // 键盘开着时只留一点点底部空隙让内容紧贴键盘上方，不再撑出多余的滚动空间；
            // 键盘没开（极端情况）才回退到悬浮 Tab 栏的让位留白
            { paddingBottom: amountKeypadOpen ? 16 : tabClearance + 36 },
          ]}
        >
          {/* 资金流卡（T16 / A6）：转出账户 → 转入账户，中间方向 IconButton 互换两边；
              点账户块开账户抽屉；账户名放不下换行、不截断；标签 ≥12pt */}
          <Card style={styles.flowCard}>
            <View style={styles.flowHeader}>
              <AppText variant="caption" color={semantic.textSecondary}>
                {t('addTx.fundFlow')}
              </AppText>
              <Badge label={t('addTx.instantRecord')} tone="success" dot />
            </View>

            <View style={styles.flowRow}>
              {/* 转出账户块（外层 View 承载 flex —— PressableScale 的样式落在内层，flex 必须给直接子项） */}
              <View style={styles.flowBlockWrap}>
              <PressableScale
                style={styles.flowBlock}
                activeScale={0.98}
                hitSlop={0}
                onPress={() => {
                  setAccountPickerRole('from');
                  setAccountPickerOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${t('addTx.outAccount')} ${fromAsset?.name ?? t('common.notSelected')}`}
              >
                <View style={styles.flowBlockLabelRow}>
                  <AppText variant="caption" color={semantic.textSecondary}>
                    {t('addTx.outAccount')}
                  </AppText>
                  <Ionicons name="chevron-down" size={16} color={semantic.textTertiary} />
                </View>
                <View style={styles.flowBlockMain}>
                  {/* UI V2：圆形账户图标（42 圆，取代旧 40 圆角方块） */}
                  <IconCircle
                    size={42}
                    color={fromAsset?.color ?? semantic.accent}
                    icon={(fromAsset?.icon as IconName) ?? 'wallet-outline'}
                  />
                  <AppText variant="headline" numberOfLines={2} style={styles.flowBlockName}>
                    {fromAsset?.name ?? t('common.notSelected')}
                  </AppText>
                </View>
              </PressableScale>
              </View>

              {/* 中间方向按钮：互换转出/转入两个账户（原逻辑不变）；同样用外层 View 承载外边距 */}
              <View style={styles.flowSwapWrap}>
                <IconButton
                  icon="swap-horizontal"
                  variant="soft"
                  accessibilityLabel={t('addTx.swapAccounts')}
                  onPress={() => {
                    hapticLight();
                    // 互换是显式操作，之后转出账户不再自动跟随默认账户变化
                    userPickedFromRef.current = true;
                    setFromAssetId(toAssetId);
                    setToAssetId(fromAssetId);
                  }}
                />
              </View>

              {/* 转入账户块（外层 View 承载 flex） */}
              <View style={styles.flowBlockWrap}>
              <PressableScale
                style={styles.flowBlock}
                activeScale={0.98}
                hitSlop={0}
                onPress={() => {
                  setAccountPickerRole('to');
                  setAccountPickerOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${t('addTx.inAccount')} ${toAsset?.name ?? t('common.notSelected')}`}
              >
                <View style={styles.flowBlockLabelRow}>
                  <AppText variant="caption" color={semantic.textSecondary}>
                    {t('addTx.inAccount')}
                  </AppText>
                  <Ionicons name="chevron-down" size={16} color={semantic.textTertiary} />
                </View>
                <View style={styles.flowBlockMain}>
                  {/* UI V2：圆形账户图标（42 圆，取代旧 40 圆角方块） */}
                  <IconCircle
                    size={42}
                    color={toAsset?.color ?? semantic.accent}
                    icon={(toAsset?.icon as IconName) ?? 'wallet-outline'}
                  />
                  <AppText variant="headline" numberOfLines={2} style={styles.flowBlockName}>
                    {toAsset?.name ?? t('common.notSelected')}
                  </AppText>
                </View>
              </PressableScale>
              </View>
            </View>
          </Card>

          {/* 转账和兑换/跨币种转账统一用同一套网格排版（T16 令牌化）：
              第一行左边永远是可编辑的"转出金额"，右边是根据 converted 算出来的只读金额
              （兑换叫"到账"、普通转账叫"转入金额"，本质是同一个数——普通转账走 !showRateField
              时 converted 就是 amount 本身，天然 1:1，不用额外分支处理数值）。
              第二行：手续费独占一整行（有汇率时汇率在中间格）；金额等宽数字、标签 ≥12pt；
              手续费空态 = 灰色 0.00 占位（原来写"选填"） */}
          <View
            onLayout={(e) => {
              fieldY.current['cardTop'] = e.nativeEvent.layout.y;
            }}
          >
            <Card style={styles.rateCard}>
              <AppText variant="subhead" weight="600" align="center" style={styles.rateCardTitle}>
                {showRateField ? t('addTx.exchangeRate') : t('addTx.transfer')}
              </AppText>

              {/* 第一行：左边转出金额输入框，右边到账/转入金额（只读展示） */}
              <View style={styles.rateGridRow}>
                {/* onLayout 挂外层 View（PressableScale 不收 onLayout；T16 wip 的 7 个 tsc 错） */}
                <View
                  style={styles.rateGridCellWrapLeft}
                  onLayout={(e) => {
                    const cardY = fieldY.current['cardTop'] ?? 0;
                    fieldY.current['amount'] = cardY + e.nativeEvent.layout.y;
                  }}
                >
                  <PressableScale
                    style={styles.rateGridCellLeft}
                    activeScale={0.98}
                    hitSlop={0}
                    onPress={() => openTransferCalculator('amount')}
                    accessibilityRole="button"
                    accessibilityLabel={t('addTx.outAmount')}
                  >
                    <View style={styles.rateGridLabelRow}>
                      <AppText variant="caption" color={semantic.textSecondary}>
                        {t('addTx.outAmount')}
                      </AppText>
                      {/* 后置货币提示贴在"转出金额"标签右侧：选了转出账户才显示，不与金额数字碰撞 */}
                      {fromAsset && (
                        <AppText variant="footnote" color={semantic.textTertiary} style={styles.rateGridLabelSuffix}>
                          ({fromAsset.currency})
                        </AppText>
                      )}
                    </View>
                    <View style={styles.rateGridValueRow}>
                      <CursorAmountText
                        display={calculatorTarget === 'amount' && amountKeypadOpen ? amountExpr.displayValue : amount || '0.00'}
                        enabled={calculatorTarget === 'amount' && amountKeypadOpen}
                        cursorFromEnd={amountCursor}
                        onCursorChange={setAmountCursor}
                        style={styles.rateGridValue}
                        cursorStyle={styles.rateCursor}
                      />
                    </View>
                  </PressableScale>
                </View>

                {/* 分隔竖线：兑换/普通转账都渲染——转账没有汇率时这条线就是转出与转入的分界；
                    大金额换行时线跟随格子布局，两种货币不会撞在一起 */}
                <View style={styles.rateGridDividerVertical} />

                {showRateField ? (
                  <>
                    <View
                      style={styles.rateCenterCellWrap}
                      onLayout={(e) => {
                        const cardY = fieldY.current['cardTop'] ?? 0;
                        fieldY.current['rate'] = cardY + e.nativeEvent.layout.y;
                      }}
                    >
                      <PressableScale
                        style={styles.rateCenterCell}
                        activeScale={0.96}
                        hitSlop={0}
                        onPress={() => openTransferCalculator('rate')}
                        accessibilityRole="button"
                        accessibilityLabel={t('addTx.rate')}
                      >
                        <AppText variant="caption" color={semantic.textSecondary} style={styles.rateCenterLabel}>
                          {t('addTx.rate')}
                        </AppText>
                        <View style={styles.rateGridValueRow}>
                          <Text style={styles.rateFieldValue}>×</Text>
                          <CursorAmountText
                            display={calculatorTarget === 'rate' && amountKeypadOpen ? rateExpr.displayValue : exchangeRate || '0.00'}
                            enabled={calculatorTarget === 'rate' && amountKeypadOpen}
                            cursorFromEnd={rateCursor}
                            onCursorChange={setRateCursor}
                            style={styles.rateFieldValue}
                            cursorStyle={styles.rateCursor}
                          />
                          <Ionicons name="calculator-outline" size={16} color={semantic.accentText} style={styles.rateGridCalcIcon} />
                        </View>
                      </PressableScale>
                    </View>
                    <View style={styles.rateGridDividerVertical} />
                  </>
                ) : null}

                <View style={styles.rateGridCellRight}>
                  <View style={styles.rateGridLabelRow}>
                    <AppText variant="caption" color={semantic.textSecondary}>
                      {showRateField ? t('addTx.receivedLabel') : t('addTx.inAmountLabel')}
                    </AppText>
                    {/* 后置货币提示贴在标签右侧：选了转入账户才显示，不与金额数字碰撞 */}
                    {toAsset && (
                      <AppText variant="footnote" color={semantic.textTertiary} style={styles.rateGridLabelSuffix}>
                        ({toAsset.currency})
                      </AppText>
                    )}
                  </View>
                  <View style={styles.rateGridValueRow}>
                    <Text
                      style={[
                        styles.rateGridValue,
                        styles.rateGridValueTo,
                        { fontVariant: ['tabular-nums'] },
                      ]}
                    >
                      {converted}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.exchangeRateDivider} />

              {/* 第二行：手续费独占一整行——兑换和普通转账统一用同一套整行布局，大小完全一致 */}
              <View
                style={styles.transferMetaNoteRow}
                onLayout={(e) => {
                  const cardY = fieldY.current['cardTop'] ?? 0;
                  fieldY.current['fee'] = cardY + e.nativeEvent.layout.y;
                }}
              >
                <View style={styles.transferMetaLeft}>
                  <Ionicons name="receipt-outline" size={16} color={semantic.textSecondary} />
                  <AppText variant="caption" color={semantic.textSecondary} style={styles.transferMetaLabel}>
                    {t('addTx.fee')}
                  </AppText>
                </View>
                <PressableScale
                  style={styles.transferFeeValueButton}
                  activeScale={0.97}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  onPress={() => openTransferCalculator('fee')}
                  accessibilityRole="button"
                  accessibilityLabel={t('addTx.fee')}
                >
                  <CursorAmountText
                    display={
                      calculatorTarget === 'fee' && amountKeypadOpen
                        ? feeExpr.displayValue
                        : feeNum > 0
                          ? `${fromSymbol}${formatMoney(feeNum, { decimals: 2 })}`
                          : '0.00'
                    }
                    enabled={calculatorTarget === 'fee' && amountKeypadOpen}
                    cursorFromEnd={feeCursor}
                    onCursorChange={setFeeCursor}
                    style={[styles.transferFeeValue, ...(feeNum > 0 ? [styles.transferFeeValueActive] : [])]}
                    cursorStyle={styles.feeCursor}
                  />
                  <Ionicons name="calculator-outline" size={16} color={semantic.textTertiary} />
                </PressableScale>
              </View>

              {/* 填了手续费就提示：手续费先从转出金额里扣掉——兑换的到账是"扣完再按汇率换算"，
                  普通转账则直接按扣完的金额到账 */}
              {liveFeeNum > 0 && (
                <View style={styles.exchangeFeeHintRow}>
                  <Ionicons name="information-circle-outline" size={16} color={semantic.textSecondary} />
                  <AppText variant="caption" color={semantic.textSecondary} numberOfLines={2} style={styles.exchangeFeeHintText}>
                    {showRateField
                      ? t('addTx.feeDeductExchange', { fee: `${fromSymbol}${formatMoney(liveFeeNum, { decimals: 2 })}`, net: `${fromSymbol}${formatMoney(netAmount, { decimals: 2 })}` })
                      : t('addTx.feeDeductTransfer', { fee: `${fromSymbol}${formatMoney(liveFeeNum, { decimals: 2 })}`, net: `${toSymbol}${formatMoney(netAmount, { decimals: 2 })}` })}
                  </AppText>
                </View>
              )}
            </Card>
          </View>
        </ScrollView>
        </View>

        {/* 转账/兑换也使用同一套计算器；金额/汇率/手续费点击后进入这里。
            底部留白收紧(insets-32)：edge-to-edge 下根视图已延伸到导航条后面，
            再垫满 insets 会在键盘下方多出一条空位——键盘整体下移填补它 */}
        {amountKeypadOpen && (
          <View style={[styles.stickyFooter, isShort && styles.stickyFooterShort, { paddingBottom: keypadBottomPad + (forceHideWanted ? 0 : tabClearance), paddingHorizontal: 0, marginBottom: keypadKeyboardLift }]}>
            <AmountCalculatorKeypad
              onPressKey={handleExprKey}
              onPressToday={() => setDatePickerOpen(true)}
              selectedDate={date}
              onConfirm={handleTransferCalculatorConfirm}
              onClear={() => {
                if (calculatorTarget === 'amount') { amountExpr.reset(); setAmountCursor(0); }
                else if (calculatorTarget === 'rate') { rateExpr.reset(); setRateCursor(0); }
                else { feeExpr.reset(); setFeeCursor(0); }
              }}
              onConfirmLongPress={handleTransferCalculatorConfirmAndContinue}
              note={note}
              onNoteChange={setNote}
              receiptUri={receiptUri}
              onAttachReceipt={handleAttachReceipt}
              onRemoveReceipt={() => setReceiptUri(null)}
              onPreviewReceipt={() => setReceiptPreviewOpen(true)}
              noteInputRef={noteInputRef}
              onNoteFocus={() => { noteFocusRef.current = true; }}
              onNoteBlur={() => { noteFocusRef.current = false; }}
            />
          </View>
        )}

        {/* 选择账户（转账/兑换）：AccountPickerSheet（T13 抽取）——树内覆盖层 + 下滑收起手势 +
            头部货币直选按钮；列表逻辑保留转账特有：排除对方账户、按 from/to 角色写回选择 */}
        {accountPickerOpen && (
          <AccountPickerSheet
            title={accountPickerRole === 'from' ? t('addTx.selectOut') : t('addTx.selectIn')}
            selectedId={accountPickerRole === 'from' ? fromAssetId : toAssetId}
            excludeId={accountPickerRole === 'from' ? toAssetId : fromAssetId}
            currencyCode={amountCurrencyCode}
            onPickAsset={(id) => {
              // 手动选择/取消，之后不再自动跟随"默认账户"变化；再点一次已选＝取消选择
              userPickedFromRef.current = true;
              if (accountPickerRole === 'from') {
                setFromAssetId((prev) => (prev === id ? null : id));
              } else {
                setToAssetId((prev) => (prev === id ? null : id));
              }
              setAccountPickerOpen(false);
            }}
            onClose={() => setAccountPickerOpen(false)}
            onAddAccount={() => {
              setAccountPickerOpen(false);
              navigation?.navigate(ROUTES.ADD_ASSET);
            }}
          />
        )}

        <DateRangePickerSheet
          visible={datePickerOpen}
          start={date}
          end={date}
          mode="single"
          onApply={(picked) => setDate(picked)}
          onClose={() => setDatePickerOpen(false)}
        />

        {/* 转账/兑换的收据上传：相机 + 凭证预览弹窗也要挂在本分支里，点"收据"才能拍照/选图 */}
        <ReceiptCameraModal
          visible={cameraMode !== null}
          withBase64={cameraMode === 'scan'}
          onClose={() => setCameraMode(null)}
          onCapture={(photo) => {
            if (cameraMode === 'receipt') {
              setReceiptUri(photo.uri);
            }
            setCameraMode(null);
          }}
          onPickFromLibrary={() => {
            const mode = cameraMode;
            setCameraMode(null);
            if (mode === 'receipt') pickReceiptFromLibrary();
          }}
        />

        <ReceiptPreviewModal
          visible={receiptPreviewOpen}
          uri={receiptUri}
          onClose={() => setReceiptPreviewOpen(false)}
        />

        {/* T17：保存成功的勾选动画（转账/兑换同一套） */}
        {saveFlash && <SaveSuccessFlash />}
      </SafeAreaView>
      </EdgeBackSwipe>
    );
  }

  // ---------- 支出/收入：选分类 ----------
  if (step === 'category') {
    return (
      <EdgeBackSwipe onBack={edgeBackHome}>
      <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}>
        {/* 二级页标准页头（T15 换 ScreenHeader）：返回 + 居中标题；本页进入即编辑态，没有编辑/完成开关 */}
        <ScreenHeader
          title={t('addTx.selectCategory')}
          onBack={() => setStep('detail')}
        />

        {/* 类别选择页不再显示 支出/收入/转账/兑换 切换栏：进来是什么类型就只显示该类型的类别 */}

        <ScrollView
          ref={categoryScrollRef}
          onScroll={(e) => {
            // 网格拖拽要把绝对坐标换算成内容坐标：顺手记下滚动量，再喂给浮空 Tab 栏
            categoryScrollYSV.value = e.nativeEvent.contentOffset.y;
            onTabScroll?.(e);
          }}
          onContentSizeChange={(_w, h) => {
            categoryContentHRef.current = h;
          }}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: tabClearance }}
        >
          {/* 按大类分节（每节一张圆角卡片、可折叠）；本页进入即编辑态（没有「编辑 / 完成」开关）：
              点磁贴 = 选中该分类并返回 · 长按 200ms 抬起可拖动组内排序 · 图标右上角红色角标删除 ·
              网格最后一项是虚线「＋」磁贴，复用组内两步小卡的新增流程 */}
          {/* 原槽位不再画虚线占位（用户定版：虚线隐藏）：
              被拖的那张卡跟手走、其它卡让位后，原位自然留白，不再额外画框。 */}
          {orderedExpenseSections.map(({ group, items, custom }) => {
              const expanded = !collapsedGroups.has(group);
              const themeColor = colors.link;
              const toggleGroup = () => {
                if (Date.now() < groupTapBlockUntilRef.current) return; // 拖拽刚结束的补发点击不算
                setCollapsedGroups((prev) => {
                  const next = new Set(prev);
                  if (next.has(group)) next.delete(group);
                  else next.add(group);
                  return next;
                });
              };
              // 新增入口的开关：组头药丸与网格末尾的虚线＋磁贴共用同一份状态
              const toggleInlineAdd = () => {
                hapticLight();
                if (addingGroupName === group) {
                  setAddingGroupName(null);
                  setInlineName('');
                } else {
                  setInlineName('');
                  setInlineIcon(CATEGORY_ICON_OPTIONS[0]);
                  setInlineColor(CATEGORY_COLOR_OPTIONS[0]);
                  setAddingGroupName(group);
                }
              };
              // 组内按持久化序号排（与「管理类别」页共用 @jizhang/categoryOrder）：
              // 拖过的顺序 reload 后仍然保持，没序号的按原数组顺序殿后
              const orderedItems = sortByOrder(items, categoryOrder);
              const card = (
                <View
                  key={group}
                  style={[
                    styles.catGroupCard,
                    // 让位：被拖组跨过谁，谁就朝相反方向挪一个"被拖组高度"（与图标磁贴同一手感）
                    shiftForGroup(group) ? { transform: [{ translateY: shiftForGroup(group) }] } : null,
                    // 被拖的那张：跟手位移 + 抬到最上层 + 轻微透明
                    gDrag?.group === group
                      ? { transform: [{ translateY: gDrag.dy }], zIndex: 20, opacity: 0.97 }
                      : null,
                  ]}
                  /* TASK-016⑥：卡片是 ScrollView 直接子节点，layout.y 即内容坐标——
                     聚焦滚动按组名查这张表，绕开 Fabric 不支持的 measureLayout */
                  onLayout={(e) => {
                    const { y, height } = e.nativeEvent.layout;
                    groupContentYRef.current[group] = y;
                    gBoxRef.current[group] = { y, h: height };
                  }}
                >
                  {/* TASK-012②：收起大列表只点头部行（箭头所在行）；点卡片其余区域/空白不收 */}
                  {/* 组头行 = 折叠区（Pressable） + 排序把手（独立 View） + 删除（TouchableOpacity）。
                      把手必须是 Pressable 的兄弟节点：嵌套时 Pressable 先成为 responder，
                      PanResponder 拿不到 grant，表现为「拖不动」并把拖动误判成点按（折叠） */}
                  <View style={styles.catGroupHeader}>
                  <View style={styles.catGroupHeaderMain}>
                  <Pressable
                    style={styles.catGroupHeaderTap}
                    onPress={toggleGroup}
                    hitSlop={{ top: 6, bottom: 6 }}
                  >
                    <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={themeColor} />
                    <Text style={[styles.catGroupTitle, { color: themeColor }]}>{getGroupLabel(group, t)}</Text>
                    {/* 新增入口只在网格末尾的虚线＋磁贴上（分组头不再挂「＋ 新增」药丸） */}
                    <View style={styles.catGroupCountWrap}>
                      <Text style={styles.catGroupCount}>{t('addTx.itemsCount', { count: items.length })}</Text>
                    </View>
                  </Pressable>
                    {/* 组排序把手（≡）：唯一入口 */}
                    <View
                      {...getGroupPanHandlers(group)}
                      style={styles.catGroupDragHandle}
                      accessibilityRole="adjustable"
                      accessibilityLabel={`${getGroupLabel(group, t)} reorder`}
                      testID={`group-drag-handle-${group}`}
                    >
                      <Ionicons name="reorder-three-outline" size={17} color={semantic.textTertiary} />
                    </View>
                  </View>
                    {/* TASK-016①：整组删除入口（原左滑删除改这里）：垃圾桶贴数量胶囊右侧 */}
                    <TouchableOpacity
                      style={styles.catHeaderDeleteBtn}
                      onPress={() => confirmDeleteGroup(group, items.length)}
                      hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.delete')}
                    >
                      <Ionicons name="trash-outline" size={15} color={colors.expense} />
                    </TouchableOpacity>
                  </View>
                  {/* 分类网格（与管理类别页同一个组件）：虚线占位框 + 长按 200ms 拖拽排序 +
                      虚线＋磁贴；点磁贴仍是"选中并返回"，拖完那一下松手不会被当成点击 */}
                  {expanded && (
                    <CategoryGridEditor
                      items={orderedItems}
                      columns={4}
                      isAdding={addingGroupName === group}
                      scrollRef={categoryScrollRef}
                      contentH={categoryContentHRef}
                      scrollY={categoryScrollYSV}
                      onDraggingChange={handleIconDragging}
                      onPick={handlePickCategory}
                      onDelete={(id) => {
                        const target = filteredCategories.find((c) => c.id === id);
                        if (target) confirmDeleteCategory(target);
                      }}
                      onReorder={handleCatReorder}
                      onToggleAdd={toggleInlineAdd}
                    />
                  )}
                  {expanded && addingGroupName === group && (
                    /* TASK-016②：两步小卡——一行（图标预览 + 名称 + ✓）+ 单行色条；
                       图标在弹层里选（点预览方块打开底部弹层） */
                    <View
                      style={styles.catInlineCard}
                      /* TASK-016⑥：记小卡在组卡内的 y 偏移，聚焦滚动 = 组卡 y + 小卡偏移 */
                      onLayout={(e) => {
                        inlineCardOffsetRef.current[group] = e.nativeEvent.layout.y;
                      }}
                    >
                      <View style={styles.catInlineNameRow}>
                        <TouchableOpacity
                          style={styles.catIconPreviewBtn}
                          onPress={() => {
                            hapticLight();
                            setIconPickerOpen(true);
                          }}
                        >
                          <Ionicons name={inlineIcon} size={22} color={colors.textPrimary} />
                        </TouchableOpacity>
                        <TextInput
                          ref={inlineInputRef}
                          style={styles.catInlineInput}
                          value={inlineName}
                          onChangeText={setInlineName}
                          placeholder={t('addTx.inlineAddPlaceholder', { group })}
                          placeholderTextColor={colors.textTertiary}
                          maxLength={10}
                          autoFocus
                          onFocus={() => {
                            inlineFocusGroupRef.current = group;
                            scrollInlineInputIntoView(group);
                          }}
                          onBlur={() => {
                            if (inlineFocusGroupRef.current === group) inlineFocusGroupRef.current = null;
                          }}
                        />
                        <TouchableOpacity
                          style={[styles.catInlineSaveSquare, !inlineName.trim() && { opacity: 0.35 }]}
                          disabled={!inlineName.trim()}
                          onPress={() => handleInlineAdd(group)}
                        >
                          <Ionicons name="checkmark" size={20} color={colors.fabIcon} />
                        </TouchableOpacity>
                      </View>
                      {/* TASK-016⑥：16 色直接铺 2 排（每排 8 个），不再横向滑动 */}
                      <View style={styles.catMiniColorsGrid}>
                        {CATEGORY_COLOR_OPTIONS.map((color) => (
                          <TouchableOpacity
                            key={color}
                            style={[
                              styles.catMiniColorDot,
                              { backgroundColor: color },
                              inlineColor === color && styles.catMiniColorDotActive,
                            ]}
                            onPress={() => setInlineColor(color)}
                            // 26 圆点 + 9×2 热区 = 44pt 最小触控区
                            hitSlop={{ top: 9, bottom: 9, left: 9, right: 9 }}
                            accessibilityRole="button"
                            accessibilityLabel={t('ledger.colorLabel')}
                            accessibilityState={{ selected: inlineColor === color }}
                          />
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              );
              // TASK-016①：整组删除入口已移入标题行垃圾桶，左滑删除退役——分节直接返回卡片
              return card;
            })}

          {/* 新增大分类：点击展开表单，填写名字+主题色后创建（空组也会显示） */}
          <View style={[styles.catGroupCard, styles.newGroupCard]}>
            {newGroupFormOpen ? (
              <>
                <View style={styles.newCatTitleRow}>
                  <Text style={styles.newCatTitle}>{t('addTx.addGroup')}</Text>
                  <TouchableOpacity
                    onPress={() => setNewGroupFormOpen(false)}
                    hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                  >
                    <Ionicons name="close" size={16} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.newCatInput}
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  placeholder={t('addTx.groupNamePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  maxLength={10}
                />
                <TouchableOpacity
                  style={[styles.newCatBtnFull, !newGroupName.trim() && { opacity: 0.4 }]}
                  disabled={!newGroupName.trim()}
                  onPress={() => {
                    const name = newGroupName.trim();
                    if (!name) return;
                    hapticSuccess();
                    addCategoryGroup({ name, icon: 'folder-outline', type: type as 'expense' | 'income' });
                    setNewGroupName('');
                    setNewGroupFormOpen(false);
                  }}
                >
                  <Text style={styles.newCatBtnFullText}>{t('addTx.createGroup')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.newGroupEntry} onPress={() => setNewGroupFormOpen(true)}>
                <Ionicons name="add-circle-outline" size={18} color={colors.link} />
                <Text style={styles.newGroupEntryText}>{t('addTx.addGroup')}</Text>
              </TouchableOpacity>
            )}
          </View>

        </ScrollView>

        {/* TASK-016③：图标选择底部弹层（两步小卡的第二步）——119 个图标 6 列网格，
            点选回填小卡预览方块；挂在选择类别页自己的 return 分支内（详情分支的 Modal 在这里渲染不到） */}
        <Modal
          visible={iconPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIconPickerOpen(false)}
        >
          <TouchableOpacity style={[styles.iconPickerOverlay, { backgroundColor: semantic.scrim }]} activeOpacity={1} onPress={() => setIconPickerOpen(false)}>
            <Pressable
              style={[styles.iconPickerSheet, { paddingBottom: bottomInset + 16, maxHeight: iconPickerMaxHeight }]}
              onPress={() => {}}
            >
              <View style={styles.iconPickerHeader}>
                <Text style={styles.iconPickerTitle}>{t('addTx.pickIconTitle')}</Text>
                <TouchableOpacity
                  style={styles.iconPickerClose}
                  onPress={() => setIconPickerOpen(false)}
                  hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.iconPickerGrid} keyboardShouldPersistTaps="handled">
                <View style={styles.iconPickerGridInner}>
                  {CATEGORY_ICON_OPTIONS.map((icon) => (
                    <TouchableOpacity
                      key={icon}
                      accessibilityRole="button"
                      accessibilityLabel={icon}
                      accessibilityState={{ selected: inlineIcon === icon }}
                      style={[styles.iconPickerCell, inlineIcon === icon && styles.iconPickerCellActive]}
                      onPress={() => {
                        hapticSelection();
                        setInlineIcon(icon);
                        setIconPickerOpen(false);
                      }}
                    >
                      <Ionicons name={icon} size={22} color={inlineIcon === icon ? colors.link : colors.textPrimary} />
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </Pressable>
          </TouchableOpacity>
        </Modal>
      </SafeAreaView>
      </EdgeBackSwipe>
    );
  }

  // ---------- 支出/收入：填详情（金额为主视觉的新版排版） ----------
  return (
    <EdgeBackSwipe onBack={edgeBackHome}>
    <SafeAreaView style={styles.container} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}>
      <View style={{ flex: 1 }}>
      {/* UI V2：最底层品牌渐变（400 / 矮屏 ×0.9，底部自动淡出到 bg）；内容全部压在它上面 */}
      <HeroGradient fill />
      {/* TASK-011 五轮（用户定版尝试）：外层不再可滚——普通 View 替代 ScrollView。
          页面不能滚 → 内容不可能被滚到键盘底下；T15 起类别网格自己可滚（catGridScroll），
          flex 布局把键盘面板高度从容器里扣除，网格天然停在键盘上沿。
          scrollViewRef 不再挂在本页（scrollToField 的 ?. 兜底安全跳过）；转账/兑换分支不动 */}
      <View style={{ flex: 1 }}>
        {/* 头部两行（T14）：返回 + 标题 + 右侧动作（编辑模式 = 删除键）/ 类型分段单独一行 */}
        {isEditing ? (
          <TransactionTypeHeader
            uiType={uiType}
            onBack={() => navigation?.goBack()}
            onSelectType={() => {}}
            title={t('addTx.editTitle')}
            onDeletePress={handleDeleteTransaction}
            showTypeSwitch={false}
          />
        ) : (
          <TransactionTypeHeader
            uiType={uiType}
            onBack={() => navigation?.goBack()}
            onSelectType={(nextType) => {
              setUiType(nextType);
              setCategoryId(null);
              setStep(stepForType(nextType));
            }}
            title={t('nav.add')}
            onScanPress={handleScanPress}
          />
        )}

        {/* 金额 Hero（UI V2 / 稿）：币种小胶囊 → 算式（多项时才出现，14pt 降透明）→ 64pt 金额，
            全部居中直接落在渐变上（不再是卡片）；金额点按打开自绘键盘 / 定位光标 */}
        <View style={[styles.heroArea, isShort && styles.heroAreaShort]}>
          {/* 金额那一行：左＝币种胶囊，右＝「每月」开关。
              日期不再单独占一行 —— 键盘上的日期键（今天 / 10月28日）已经覆盖同一功能，
              两枚胶囊单独排一行会和上下两块边缘都对不齐（用户 2026-10-28 反馈）。 */}
          <View style={styles.heroTopRow}>
          <PressableScale
            activeScale={0.96}
            hitSlop={0}
            onPress={() => setAssetPickerOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t('addTx.selectCurrency')}
          >
            <GlassView radius={999} style={styles.currencyPill}>
              <AppText variant="caption2" weight="500" color={semantic.textPrimary}>
                {amountCurrencyCode}
              </AppText>
              <Ionicons name="chevron-down" size={12} color={semantic.textPrimary} />
            </GlassView>
          </PressableScale>

          {!isEditing && (
            <PressableScale
              activeScale={0.94}
              hitSlop={6}
              onPress={() => {
                hapticLight();
                setAutoMonthly((v) => !v);
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: autoMonthly }}
              accessibilityLabel={t('finance.monthlyLabel')}
              testID="addtx-monthly-toggle"
            >
              <View
                style={[
                  styles.monthlyToggle,
                  autoMonthly && { backgroundColor: semantic.accent, borderColor: semantic.accent },
                ]}
              >
                <Ionicons
                  name="repeat-outline"
                  size={13}
                  color={autoMonthly ? semantic.onAccent : semantic.textSecondary}
                />
                <AppText
                  variant="caption2"
                  weight="600"
                  color={autoMonthly ? semantic.onAccent : semantic.textSecondary}
                >
                  {t('finance.monthlyLabel')}
                </AppText>
              </View>
            </PressableScale>
          )}
          </View>

          {/* 算式行：多项（有 +/− 运算符）时才出现；稿里是降透明白 →
              UI V2.1 §3 改 text.primary（13pt 小字需 4.5:1，降透明浅字在浅色渐变上不达标） */}
          {amountExpr.isMulti && (
            <AppText
              variant="footnote"
              color={semantic.textPrimary}
              align="center"
              numberOfLines={1}
              style={styles.heroExpr}
            >
              {amountExpr.displayValue}
            </AppText>
          )}

          <View onLayout={registerFieldY('amount')} style={styles.heroAmountBox}>
            <PressableScale
              style={styles.heroAmountTouch}
              activeScale={0.98}
              hitSlop={0}
              onPress={() => {
                // 备注框的系统键盘/光标退场：一次只允许一个光标显示
                noteInputRef.current?.blur();
                // 打开键盘即从空态起输：按 5 就是 5 元，新输入直接替换旧值（不再从尾部续接）
                amountExpr.reset();
                setAmountCursor(0);
                setAmountKeypadOpen(true);
                scrollToField('amount');
              }}
              accessibilityRole="button"
              accessibilityLabel={`${amountCurrencyCode} ${heroAmountDisplay}`}
            >
              {/* 整数 64/500 白 + .小数 34/300 降透明；光标随键盘开关（多项算式合计态无光标） */}
              <HeroAmountText
                display={heroAmountDisplay}
                fontSize={heroAmountFontSize}
                cursorFromEnd={amountCursor}
                cursorActive={amountKeypadOpen && !amountExpr.isMulti}
                onCursorChange={setAmountCursor}
              />
            </PressableScale>
          </View>
        </View>

        {/* 币种行（设计稿 03 屏）：账户 + 币种 / 可用余额 + chevron —— 点按仍是原「选择账户」抽屉，
            数据与行为不变，只是把账户从一行胶囊换成一张 surface 卡 */}
        <PressableScale
          activeScale={0.98}
          hitSlop={0}
          onPress={() => setAssetPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('addTx.selectAccount')}
          style={styles.currencyRow}
          testID="addtx-currency-row"
        >
          <View
            style={[
              styles.currencyBadge,
              { backgroundColor: withAlpha(selectedAsset?.color ?? semantic.accent, 0.12) },
            ]}
          >
            <AppText variant="caption2" weight="600" color={semantic.textPrimary}>
              {amountCurrencyCode}
            </AppText>
          </View>
          <View style={styles.currencyInfo}>
            <AppText variant="subhead" weight="500" color={semantic.textPrimary} numberOfLines={1}>
              {selectedAsset ? `${selectedAsset.name} · ${amountCurrencyCode}` : t('common.notSelected')}
            </AppText>
            {assetId != null && (
              <AppText variant="caption2" color={semantic.textTertiary} numberOfLines={1}>
                {`${t('addTx.availableBalance')} ${formatMoney(getAssetBalance(assetId))}`}
              </AppText>
            )}
          </View>
          <Ionicons name="chevron-down" size={16} color={semantic.textTertiary} />
        </PressableScale>

        {/* 类别（T15 / V2）：列数取版型；格 = 42 立体球图标 + 12pt 标签；网格区可滚动，「全部」永远殿后。
            定稿里没有「类别：xxx」提示行（选中态由外圈表达）→ 整行删掉，高度让给网格：
            390×844 露出 3 行（15 格，与稿一致），360×640 至少 2 行 */}
        <ScrollView
          style={styles.catGridScroll}
          contentContainerStyle={[styles.catGridContent, isShort && styles.catGridContentShort]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onLayout={(e) => {
            // 实测网格区可见高度 → 决定铺多少格（至少 2 行）；超出的历史类别靠网格自身滚动
            const h = e.nativeEvent.layout.height;
            setGridH((prev) => (prev == null || Math.abs(prev - h) > 0.5 ? h : prev));
          }}
        >
          {/* 每格外包一层 View 承载百分比宽度 —— RN Web 里百分比宽度必须落在 flex 直接子项上
              （PressableScale 的 Pressable 宽度是内容自适应，百分比给不到它内部那层） */}
          {displayCategories.map((c) => {
            const active = categoryId === c.id;
            // 用户定版：不要"其它图标发蒙"的压暗方案 —— 选中感全部交给选中项自己的
            // 贴边描边 + 光晕（见 IconCircle 的 selected）。未选中项保持原样不透明。
            return (
              <View key={c.id} style={[styles.catCellWrap, { width: `${100 / gridColumns}%` as unknown as `${number}%` }]}>
                <PressableScale
                  style={[styles.catCell, isShort && styles.catCellShort]}
                  activeScale={0.94}
                  onPress={() => handlePickCategory(c.id)}
                  accessibilityRole="button"
                  accessibilityLabel={getCategoryLabel(c, t)}
                  accessibilityState={{ selected: active }}
                >
                  {/* 用户定版（取代设计稿 03 屏的 36 圆角方块）：与设置页 / 资产页 / 类别管理页
                      同一套立体光泽球 = IconCircle 默认 shape="circle"；
                      选中 = 球面不变色，只叠两层外圈（selected，颜色走 categoryRing 令牌）
                      + 标签提成 accentText/600 */}
                  <IconCircle
                    size={CAT_ICON_SIZE}
                    color={c.color}
                    icon={c.icon as IconName}
                    selected={active}
                  />
                  <AppText
                    variant="caption2"
                    align="center"
                    numberOfLines={2}
                    weight={active ? '600' : undefined}
                    color={active ? semantic.accentText : semantic.textSecondary}
                    style={styles.catCellLabel}
                  >
                    {getCategoryLabel(c, t)}
                  </AppText>
                </PressableScale>
              </View>
            );
          })}

          {/* 「全部」殿后格：与类别格同尺寸，打开完整列表抽屉（组内新增 / 排序 / 删除都在「管理类别」页）；
              中性立体球（IconCircle 不传 color = ICON_BALL_NEUTRAL 灰球 + 白九宫格），不抢类别色 */}
          <View style={[styles.catCellWrap, { width: `${100 / gridColumns}%` as unknown as `${number}%` }]}>
            <PressableScale
              style={[styles.catCell, isShort && styles.catCellShort]}
              activeScale={0.94}
              onPress={() => setCatSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('common.all')}
            >
              <IconCircle size={CAT_ICON_SIZE} icon="grid-outline" />
              <AppText variant="caption2" align="center" color={semantic.textSecondary} style={styles.catCellLabel}>
                {t('common.all')}
              </AppText>
            </PressableScale>
          </View>
        </ScrollView>
      </View>
      </View>

      {/* 自绘计算器键盘：点金额区域出现，"完成"＝保存，长按"完成"＝保存后继续记下一笔。
          底部留白收紧(insets-32)：edge-to-edge 下根视图已延伸到导航条后面，
          再垫满 insets 会在键盘下方多出一条空位——键盘整体下移填补它 */}
      {amountKeypadOpen && (
        <View
          style={[styles.stickyFooter, isShort && styles.stickyFooterShort, { paddingBottom: keypadBottomPad + (forceHideWanted ? 0 : tabClearance), paddingHorizontal: 0, marginBottom: keypadKeyboardLift }]}
        >
          <AmountCalculatorKeypad
            onPressKey={(key) => setAmountCursor(amountExpr.pressKeyAt(key, amountCursor))}
            onPressToday={() => setDatePickerOpen(true)}
            selectedDate={date}
            onConfirm={handleKeypadConfirm}
            onClear={() => { amountExpr.reset(); setAmountCursor(0); }}
            onConfirmLongPress={isEditing ? undefined : handleKeypadConfirmAndContinue}
            note={note}
            onNoteChange={setNote}
            receiptUri={receiptUri}
            onAttachReceipt={handleAttachReceipt}
            onRemoveReceipt={() => setReceiptUri(null)}
            onPreviewReceipt={() => setReceiptPreviewOpen(true)}
            noteInputRef={noteInputRef}
            onNoteFocus={() => { noteFocusRef.current = true; }}
            onNoteBlur={() => { noteFocusRef.current = false; }}
          />
        </View>
      )}

      {/* 日期选择：点键盘上的日期键打开，逻辑没变 */}
      <DateRangePickerSheet
        visible={datePickerOpen}
        start={date}
        end={date}
        mode="single"
        onApply={(picked) => setDate(picked)}
        onClose={() => setDatePickerOpen(false)}
      />

      {/* 自绘拍小票相机：cameraMode 区分是"扫描识别"还是"单纯附凭证"，
          拍完之后各自接回原来的处理逻辑（runScan 走OCR / 直接setReceiptUri留档） */}
      <ReceiptCameraModal
        visible={cameraMode !== null}
        withBase64={cameraMode === 'scan'}
        onClose={() => setCameraMode(null)}
        onCapture={(photo) => {
          if (cameraMode === 'scan' && photo.base64) {
            runScan(photo.base64, photo.uri);
          } else if (cameraMode === 'receipt') {
            setReceiptUri(photo.uri);
          }
          setCameraMode(null);
        }}
        onPickFromLibrary={() => {
          const mode = cameraMode;
          setCameraMode(null);
          if (mode === 'scan') pickFromLibrary();
          else if (mode === 'receipt') pickReceiptFromLibrary();
        }}
      />

      {/* 凭证大图预览：挂在 ReceiptPreviewModal（T13 抽取）里，点缩略图放大查看整体 */}
      <ReceiptPreviewModal
        visible={receiptPreviewOpen}
        uri={receiptUri}
        onClose={() => setReceiptPreviewOpen(false)}
      />
      {/* 选择账户：AccountPickerSheet（T13 抽取）——树内覆盖层（不用 RN Modal——Modal 是独立原生窗口，
          和 Reanimated 在安卓上会出重影、也接不了下滑手势；外壳与日期选择面板完全同款） */}
      {assetPickerOpen && (
        <AccountPickerSheet
          title={t('addTx.selectAccount')}
          selectedId={assetId}
          currencyCode={amountCurrencyCode}
          onPickAsset={(id) => {
            userPickedAssetRef.current = true;
            setAssetId(id);
            // 金额币种自动跟随新账户（只认所选账户）
            setAssetPickerOpen(false);
          }}
          onClose={() => setAssetPickerOpen(false)}
          onAddAccount={() => {
            setAssetPickerOpen(false);
            navigation?.navigate(ROUTES.ADD_ASSET);
          }}
        />
      )}

      {/* 「全部」类别抽屉（T15）：完整列表 + 行内打勾；管理与排序入口在「管理类别」页 */}
      {catSheetOpen && (
        <CategoryPickerSheet
          sections={orderedExpenseSections}
          selectedId={categoryId}
          onPickCategory={(id) => {
            // 「全部」抽屉选了「网格里没有」的类别 → 插到第 1 格（原行为）；
            // 已在网格里的只高亮、不重排（T15 修正：格子不在手指下乱跑）
            const visible = displayCategories.some((c) => c.id === id);
            if (!visible) setGridOrder((prev) => [id, ...prev.filter((x) => x !== id)]);
            handlePickCategory(id);
            setCatSheetOpen(false);
          }}
          onManage={() => {
            setCatSheetOpen(false);
            setStep('category');
          }}
          onClose={() => setCatSheetOpen(false)}
        />
      )}

      {/* T17：保存成功的勾选动画（300ms 后由 playSaveFlashThen 收尾返回 / 留页） */}
      {saveFlash && <SaveSuccessFlash />}
    </SafeAreaView>
    </EdgeBackSwipe>
  );
}

// 关键：样式表要写成函数，接收 colors，返回 StyleSheet
function makeStyles(colors: ThemeColors, isDark: boolean, semantic: SemanticColors, spacing: Spacing, layout: Layout, radius: Radius) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: semantic.bg },
  scanningWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanningText: { marginTop: 16, color: colors.textSecondary, fontSize: 14 },
  // 组内联添加（TASK-004 自类别分类页并入；TASK-016 两步小卡：图标预览 + 名称 + ✓ 一行 + 单行色条）
  catInlineCard: { paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2 },
  catInlineInput: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  // 图标预览方块：显示当前选中图标，点它打开底部弹层选 119 图标
  catIconPreviewBtn: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  // ✓ 确认方钮：名称+图标齐了就能点（替代原「添加到 X」文字钮）
  catInlineSaveSquare: {
    marginLeft: 8,
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.fabBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  catInlineNameRow: { flexDirection: 'row', alignItems: 'center' },
  // 单行 16 色横条（横向可滑）→ TASK-016⑥：2 排网格（每排 8 个）
  catMiniColorsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    paddingHorizontal: 2,
  },
  catMiniColorDot: { width: 26, height: 26, borderRadius: 13, marginRight: 10, marginBottom: 8 },
  catMiniColorDotActive: { borderWidth: 2, borderColor: colors.textPrimary },
  // 大组分节：每节一张圆角卡片（图1 样式：外框 boarder + 卡片内标题行 + 九宫格）
  catGroupCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    marginHorizontal: 12,
    marginTop: 10,
    paddingBottom: 6,
    overflow: 'hidden',
  },
  // 搜索框：与卡片同宽同风格
  // 组标题行：紫色小标题 + 右侧数量胶囊 + 折叠箭头
  catGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  // 组头左右两槽：整行左侧是「折叠区 + ≡」，右侧是删除
  catGroupHeaderMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  catGroupHeaderTap: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  // 组排序把手：34 视觉 + hitSlop 撑到 44 触控（组长按 ≡ 上下拖 = 整组换位）
  catGroupDragHandle: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
    marginRight: 2,
  },
  catGroupTitle: { fontSize: 13, fontWeight: '700', color: colors.link, marginLeft: 6 },
  catGroupCountWrap: { marginLeft: 'auto', backgroundColor: colors.bg, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2 },
  catGroupCount: { fontSize: 10, color: colors.textTertiary },
  // 标题行只剩垃圾桶（新增入口已收敛到网格末尾的虚线＋磁贴）
  catHeaderDeleteBtn: { marginLeft: 8, padding: 2 },
  // 新增大分类：底部入口 + 表单 + 主题色板
  newGroupCard: { marginTop: 14, padding: 14 },
  newGroupEntry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  newGroupEntryText: { color: colors.link, fontSize: 14, fontWeight: '700', marginLeft: 6 },
  newCatTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  newCatTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  newCatBtnFull: {
    marginTop: 12,
    backgroundColor: colors.fabBg,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  newCatBtnFullText: { color: colors.fabIcon, fontWeight: '700', fontSize: 14 },
  newCatInput: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.dividerHair,
    backgroundColor: colors.bg,
    paddingHorizontal: 10,
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 0,
  },

  // ---------- 键盘停靠区（V2）：面板自身画 keypadPanel 底 + 顶部 30 圆角，这里只留底部安全区补白 ----------
  stickyFooter: {
    paddingHorizontal: 20,
    paddingTop: 0,
  },
  // 矮屏：键盘面板上沿留白 6→0（键盘本身高度由 useLayout 键高决定）
  stickyFooterShort: { paddingTop: 0 },

  // ---------- 支出/收入卡片式表单新增样式 ----------
  // 与转账/兑换页头部(txHeaderRow)对齐：同样的水平边距和更高的上下留白，
  // 让选择类别/编辑页的返回按钮和标题与主页面保持在同一层
  // TASK-016③：图标选择底部弹层（fade 遮罩 + 顶部圆角面板 + 6 列图标网格）
  iconPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  iconPickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 16,
  },
  iconPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  iconPickerTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  iconPickerClose: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPickerGrid: { paddingHorizontal: 10 },
  iconPickerGridInner: { flexDirection: 'row', flexWrap: 'wrap' },
  iconPickerCell: {
    width: `${100 / 6}%` as unknown as `${number}%`,
    aspectRatio: 1.15,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  iconPickerCellActive: { backgroundColor: colors.link + '1A' },

  // ---------- 记一笔的编辑 / 选择类别页头部（返回键、删除键；主表单头部已抽成 TransactionTypeHeader 组件） ----------
  // 返回按钮：更大(40)、紫色外环（与"全部"Pill 同色）、加粗箭头，让返回入口足够明显
  // 编辑页右上角的删除按钮：与返回键同款圆环，用红色警示色

  // ---------- UI V2：金额 Hero 区（不再包卡片，直接落在渐变上；币种胶囊 → 算式 → 64 金额） ----------
  heroArea: {
    alignItems: 'center',
    paddingTop: spacing.xs,
    paddingHorizontal: layout.page,
  },
  // 矮屏：上留白 4→0（一档收紧）
  heroAreaShort: { paddingTop: 0 },
  // 币种小胶囊（稿：高 28 / 内 10 / 12.5 文字 + 12 chevron）
  currencyPill: {
    height: 28,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
  },
  // 算式行（稿：14pt 降透明白、居中）：只在多项算式时出现
  heroExpr: { marginTop: 6 },
  // 金额点按热区：整行居中；14 位大数字也绝不换行（档位降级由 JS 选）
  heroAmountBox: { alignSelf: 'stretch', marginTop: 2 },
  heroAmountTouch: { alignSelf: 'stretch', minWidth: 0, alignItems: 'center', justifyContent: 'center' },
  // 账户 / 日期 / 月度结转 Chip 行（稿）：整行居中、放不下整块掉第二行，不截断、不缩字
  // 币种行（设计稿 03 屏）：surface 实底 12 圆角卡 —— 币种徽标 + 账户·币种 + 余额 + chevron
  currencyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.md,
    marginHorizontal: layout.page,
    marginTop: spacing.sm,
    paddingHorizontal: layout.card,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: semantic.surface,
  },
  currencyBadge: {
    minWidth: 42,
    height: 24,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencyInfo: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  // 金额那一行：币种贴左、每月开关贴右（与账户卡 / 类别网格同一条左右边界）
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // 父容器 heroArea 是居中列，不给 stretch 这行就只占内容宽，space-between 等于没生效
    alignSelf: 'stretch',
    paddingHorizontal: spacing.sm,
  },
  // 「每月」开关：中性态描边胶囊；打开后填充品牌色（与分段控件的选中态同一套语言）
  monthlyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: semantic.hairline,
  },
  // 矮屏：与金额区的间距 4→0、Chip 间距 8→6（三个 Chip 保持一行）
  heroChipsRowShort: { marginTop: 0, columnGap: 6 },

  // ---------- T15/V2：类别网格（列数按版型；格 = 42 立体球 + 12pt 标签，标签预留 2 行高度） ----------
  // 网格区可滚动：吃掉剩余高度（flex:1），历史类别超出可见容量时滚下去看，「全部」永远殿后
  // minHeight: 0 —— flex:1 的滚动容器在 RN Web / 安卓上默认按内容撑高（min-height auto），
  // 不写 0 时键盘把剩余高度压到很小时网格会和键盘互相压住；写 0 才会老老实实缩到剩余高度并内部滚动
  catGridScroll: { flex: 1, minHeight: 0 },
  catGridContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: layout.page,
    paddingBottom: spacing.xs,
    rowGap: spacing.xs,
  },
  // 矮屏：底部留白 4→0（「至少 2 行完整可见」的最后 4px）
  catGridContentShort: { paddingBottom: 0 },
  // 一格：顶距 8 + 42 球 + 标签间距 4 + 单行标签 16 = 70（+4 行距 = 74，与 CAT_CELL_ROW_HEIGHT 同步）
  // 顶距 8 = 选中态两层外圈（categoryRing：3 打底 + 5 外环）向外溢出的量，外圈不占布局但要有地方露出来
  catCellWrap: {},
  catCell: { alignItems: 'center', paddingTop: spacing.sm },
  // 矮屏：顶距收到 4（让「至少 2 行」稳落在一屏内；外圈正好吃掉行距，不与上一行标签重叠）
  catCellShort: { paddingTop: spacing.xs },
  // （图标与选中外圈全部交给共享 IconCircle：默认立体球 + selected 两层外圈，本页不再自己画框）
  // 标签：12pt 居中、最多 2 行；minHeight 16（单行）+ alignSelf stretch 让整格宽度对齐
  // （stretch 而不是 width:'100%'：百分比在 RN Web 的嵌套 flex 里解析不到父级实测宽）
  catCellLabel: { marginTop: spacing.xs, minHeight: 16, alignSelf: 'stretch' },

  rateCursor: { fontSize: 17, fontWeight: '300', color: colors.link, marginLeft: 2 },
  feeCursor: { fontSize: 15, fontWeight: '400', color: colors.link, marginLeft: 3 },

  // 矮屏：整行再收 4（标签行不占多余高度，给类别格留位置）

  // ---------- 转账/兑换（T16 / A6）：资金流卡 + 汇率卡，全部令牌化 ----------
  exchangePageContent: { paddingHorizontal: layout.page, paddingBottom: 26 },

  // 资金流卡：普通卡 + 两张账户块 + 中间方向 IconButton；V2 内容卡统一 26 圆角（页面内覆盖共享 Card 的 20）
  flowCard: { marginBottom: spacing.md, borderRadius: 26 },
  flowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  flowRow: { flexDirection: 'row', alignItems: 'center' },
  // 账户块的外层（flex 直接子项）：PressableScale 把 style 放内层，flex 必须落在这一层
  flowBlockWrap: { flex: 1, minWidth: 0 },
  // 账户块：描边 + bg 底撑起"可选"的观感（与抽屉搜索框同一档）
  flowBlock: {
    minHeight: 56,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: semantic.hairline,
  },
  flowBlockLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  flowBlockMain: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
  // （V2：账户图标改用共享 IconCircle 42 圆，旧 flowIconSquare 已删）
  // 账户名：最多 2 行、放不下换行不截断（flexShrink 让长名在块内折行）
  flowBlockName: { flexShrink: 1 },
  // 互换钮的外层：外边距必须落在 flex 直接子项上（同上）
  flowSwapWrap: { marginHorizontal: spacing.sm },

  // 金额卡：V2 内容卡统一 26 圆角（页面内覆盖共享 Card 的 20）
  rateCard: { paddingVertical: spacing.md, borderRadius: 26 },
  rateCardTitle: { marginBottom: spacing.sm },
  rateGridRow: { flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap' },
  rateGridDividerVertical: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: semantic.hairline,
    marginHorizontal: spacing.md,
    alignSelf: 'stretch',
  },
  // onLayout 挂外层（fieldY 记账用），格子本体仍是 PressableScale
  rateGridCellWrapLeft: { flex: 1, minWidth: 0 },
  rateCenterCellWrap: { alignItems: 'center' },
  // 数值行：数字与「×」/计算器图标同一基线
  rateGridValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  rateGridCellLeft: { flex: 1, alignItems: 'flex-start', paddingVertical: spacing.xs },
  rateGridCellRight: { flex: 1, alignItems: 'flex-end', paddingVertical: spacing.xs },
  rateGridLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  // 后置货币提示「(MYR)」：footnote（13pt，textTertiary 的下限）贴在标签右侧
  rateGridLabelSuffix: { marginLeft: spacing.xs },
  // 金额：等宽数字（tabular-nums）+ 令牌字重 700；到账/转入用收入绿区分"要付出的钱"
  rateGridValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'], color: semantic.textPrimary },
  rateGridValueTo: { color: semantic.amountIncome },
  rateGridCalcIcon: { marginLeft: spacing.xs },
  rateCenterCell: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  rateCenterLabel: { marginBottom: spacing.xs },
  // 汇率数值：accentText 强调色，保持"这里能点"的视觉权重
  rateFieldValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'], color: semantic.accentText },
  exchangeRateDivider: { height: StyleSheet.hairlineWidth, backgroundColor: semantic.hairline, marginTop: spacing.md },
  transferMetaNoteRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  transferMetaLeft: { flexDirection: 'row', alignItems: 'center' },
  transferMetaLabel: { marginLeft: spacing.sm },
  transferFeeValueButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: semantic.bg,
  },
  // 空态 = 灰色占位（原来写"选填"）：与汇率格 0.00 的惯例一致
  transferFeeValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'], color: semantic.textTertiary },
  transferFeeValueActive: { color: semantic.textPrimary },
  exchangeFeeHintRow: { flexDirection: 'row', alignItems: 'flex-start', columnGap: spacing.xs, marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  exchangeFeeHintText: { flex: 1 },

  });
}
