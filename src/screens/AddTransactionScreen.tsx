import { usePremium, PremiumRequired } from '../context/PremiumContext';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Keyboard,
  BackHandler,
  Linking,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Circle, Defs, Mask, Path, Rect } from 'react-native-svg';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useApp } from '../context/AppContext';
import { getAssetDisplayBalance } from '../utils/creditCard';
import { ROUTES, AddTxPresetType } from '../navigation/routes';
import DateRangePickerSheet from '../components/DateRangePickerSheet';
import { TransactionType, Transaction, Category } from '../types';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { getCategoryLabel, findCategoryIdByChineseName } from '../i18n/categories';
import { EXPENSE_CATEGORY_GROUPS, INCOME_CATEGORY_GROUPS } from '../utils/defaultCategories';
import { scanReceipt, rememberReceiptRawText } from '../utils/scanReceipt';
import { rememberAmountLabel, rememberMerchantCategory } from '../utils/receiptLearning';
import { isLocalOcrAvailable } from '../utils/receiptOcr';
import { persistReceiptImage } from '../utils/receiptStore';

/** 大组排序的存储键：与「管理类别」页共用同一个键，两页顺序保持一致 */
const GROUP_ORDER_KEY = '@jizhang/categoryGroupOrder';
import { getCurrencySymbol } from '../utils/currencies';
// 选类别整页 = 与「财务规划 → 类别分类」共用的同一份 CategoryPage（玻璃组卡 / 3 列 / 可拖可删可增）
import CategoryPage from '../components/category/CategoryPage';
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
import { formatRateEquation } from '../utils/formatRate';
import { formatDate as formatDateLabel } from '../utils/formatDate';
import { getRecentAssetsSnapshot, rememberRecentAsset, useRecentAssets } from '../utils/recentAssets';
import {
  getAmountCategoryVersion,
  hydrateAmountCategory,
  lookupCategoryForAmount,
  rebuildAmountCategory,
  rememberAmountCategory,
  subscribeAmountCategory,
} from '../utils/amountCategory';
import { AmountCalculatorKeypad, keypadPanelHeight } from '../components/AmountCalculatorKeypad';
import { CursorAmountText } from '../components/CursorAmountText';
import { ReceiptCameraModal } from '../components/ReceiptCameraModal';
import AppText from '../components/ui/AppText';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import IconButton from '../components/ui/IconButton';
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

// 汇率写进输入框：先去掉浮点尾巴（1/0.625 = 1.6000000000000004 → 1.6），
// 再收到 6 位小数（与编辑转账回填汇率的精度同一档，输入框里也放得下）
function formatRateField(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '';
  return String(Number(rate.toFixed(6)));
}

// 后端给的 asOf 只保证「能表示一个时刻」：ISO 串与毫秒数都接住，其余一律当没有
function parseFxAsOf(asOf: unknown): Date | null {
  if (typeof asOf === 'number') {
    const d = new Date(asOf);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof asOf !== 'string' || !asOf) return null;
  const d = /^\d+$/.test(asOf) ? new Date(Number(asOf)) : new Date(asOf);
  return Number.isNaN(d.getTime()) ? null : d;
}

// 汇率状态行里的时刻：实时只给 HH:mm，离线带上「M月d日」（英文 M/D）。
// 解析不出来给 '—'：宁可少一段信息，也不能把旧汇率标成「刚刚」
function formatFxMoment(asOf: unknown, opts: { withDate: boolean; zh: boolean }): string {
  const d = parseFxAsOf(asOf);
  if (!d) return '—';
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (!opts.withDate) return hm;
  const md = opts.zh ? d.getMonth() + 1 + '月' + d.getDate() + '日' : d.getMonth() + 1 + '/' + d.getDate();
  return md + ' ' + hm;
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
// 整数段 = 基准 64/500（字距 −2.5、行高 66）；「.小数」段与整数段同大、同字重、同色。
// 2026-10-29 用户要求尾数与前面的数字一样大（原稿 34/300 + 70% 透明度会让尾数看着小一号）。
// 键盘开着时把闪烁光标画在「光标所在的那一段」里：复用 CursorAmountText 的点按/拖动定位，
// 只做 cursorFromEnd 的全串 ↔ 分段换算（整段：Li − si；小段：Li + Ld − si）。
// 为什么不是 MoneyText / CursorAmountText 单独搞定：MoneyText hero 没有光标，
// CursorAmountText 不拆整数/小数（组件都在别处、本车道不改），两个片段各自渲染是唯一不损功能的组合。
// 小数段与整数段同大小（2026-10-29 用户要求「尾数的大小要和前面的数字一样」，原稿 34/64）
const HERO_INT_RATIO_DEC = 1;
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
  onPress,
}: {
  display: string;
  fontSize: number;
  cursorFromEnd: number;
  /** 光标是否可见（键盘开着且不是多项算式的合计态） */
  cursorActive: boolean;
  onCursorChange: (cursorFromEnd: number) => void;
  /** 未在编辑该格时点按的回落：打开计算器键盘（CursorAmountText 的 fallback） */
  onPress?: () => void;
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
    // 与整数段同字重同色：只保留「同号同大」一个视觉层级（原稿 300 + 70% 透明度）
    fontWeight: '500' as const,
    color: onHero,
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
// 更新入口：扫票依赖原生模块，老安装包拿到新 JS 时引导用户去下载最新 APK
const APP_UPDATE_URL = 'https://187.127.125.136/downloads/latest.apk';
// TASK-022：每个类型的网格固定格（本次选过的类别置顶格）持久化，重启后网格原样恢复
// 值形如 { expense?: string[], income?: string[] }
const SESSION_PICKED_KEY = '@jizhang/sessionPickedCategories';
// 编辑模式拖动排序的持久化键：Record<分类id, 序号>，只在大组内部比较（资产页 assetOrder 同款）
const CATEGORY_ORDER_KEY = '@jizhang/categoryOrder';
// TASK-009：不设上限——历史里有多少就往网格铺多少，直到"全部"按钮碰到自绘计算器为止
const RECENT_CATEGORY_HISTORY_LIMIT = Infinity;

export default function AddTransactionScreen({ navigation, route }: any) {
  const { categories, categoryGroups, addCategory, addCategoryGroup, deleteCategoryGroup, addTransaction, updateTransaction, addTransfer, updateTransfer, updateCategory, deleteCategory, deleteTransaction, assets, activeAssets, getAssetBalance, currencySymbol, currency, activeLedgerId, paymentPlans, addPaymentPlan, loading: dataLoading, transactions: allTransactions } =
    useApp();
  const insets = useSafeAreaInsets();
  const { colors, isDark, semantic, spacing, layout, radius, elevation } = useTheme();
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
  const premium = usePremium();
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

  // 「上一次用的钱包」（用户 2026-11-03）：默认账户只是兜底，真正优先的是上次记同类账用过的账户。
  // 记忆里的 id 必须仍然可用（存在 / 未归档 / 属当前账本），否则回落默认账户，再回落「未选择」。
  const recentAssets = useRecentAssets();
  // 记忆里的 id 必须仍然可用：优先本账本活跃账户，其次全部账户（未归档），最后才回落默认
  const pickUsableAsset = (id?: string) => {
    if (!id) return null;
    if (activeAssets.some((a) => a.id === id)) return id;
    // 账本归属规则可能把「上次用的钱包」过滤掉（例如刚切过账本）→ 只要账户还在且未归档就认它，
    // 否则用户会觉得「上次选的钱包没被记住」。
    const anyAsset = assets.find((a) => a.id === id);
    return anyAsset && !anyAsset.archivedAt ? id : null;
  };
  const preferredAssetId =
    pickUsableAsset(recentAssets[uiType === 'income' ? 'income' : 'expense']) ?? defaultAsset?.id ?? null;
  // 转账只让「转出」跟随记忆：转入是资金去向，仍让用户自己点一次（避免手滑转到上次那个账户）
  const preferredFromAssetId = pickUsableAsset(recentAssets.transferFrom) ?? defaultAsset?.id ?? null;

  // 所有类型都直接进入主表单；转账/兑换的账户改为页面内弹层选择，不再增加独立选择步骤。
  const stepForType = (t: UiType): Step => (t === 'transfer' || t === 'exchange' ? 'transferDetail' : 'detail');

  const [step, setStep] = useState<Step>(() => {
    if (isEditing) return editTransaction?.type === 'transfer' ? 'transferDetail' : 'detail';
    return stepForType(initialUiType);
  });
  const [categoryId, setCategoryId] = useState<string | null>(editTransaction?.categoryId ?? null);
  // 用户在这一笔里手动选过类别后，金额联想就不再覆盖它（编辑既有账单时初始即为 true）
  const userPickedCategoryRef = useRef(!!editTransaction?.categoryId);
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
  // 扫票后的**备注建议**（receiptNoteSuggestion：购买明细 / 采购类别）：同样只是建议，
  // 用户点备注框且备注为空时才填入，可改可删
  // 用户手动改过备注 → 本次票据内不再自动填入/覆盖（重新扫票才复位）
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);
  // 本次扫票的 OCR 原文：保存成功后写进本地查重库
  const lastScanRawTextRef = useRef<string | undefined>(undefined);
  // 本次扫描的商户与「产生金额的标签行」：保存成功后写入本机学习库
  const lastScanMetaRef = useRef<{ merchant?: string | null; merchantConfident?: boolean; amountLabel?: string | null }>({});

  // 普通收支专用：可选的资产账户（这笔钱从/到哪个账户）——没有编辑数据时，用"资产"页设的默认账户
  const [assetId, setAssetId] = useState<string | null>(editTransaction?.assetId ?? preferredAssetId);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  // 「全部」类别抽屉（T15）：打开完整列表；管理与排序入口在里面 →（管理类别）→ 选择类别页
  const [catSheetOpen, setCatSheetOpen] = useState(false);

  // 用户手动选过账户后就不再自动跟随"默认账户"变化；保存后重置（resetAll）恢复自动跟随。
  // 编辑已有账单时初始值来自账单本身，视为已手动确定
  const userPickedAssetRef = useRef(!!editTransaction?.assetId);
  // 编辑既有转账时，「转出账户」已经是确定的：必须一开始就当作“用户已选”，
  // 否则下面那个「跟随默认账户」的 effect 会在数据落地前把回填的转出账户冲成 null
  // （表现：编辑页转出显示 Not selected、汇率格整块消失、到账额算成等于转出额 —— 用户 2026-10-28 截图）。
  const userPickedFromRef = useRef(editTransaction?.type === 'transfer');

  // "默认账户"实时联动：在资产页勾选/取消"设为默认账户"后，只要用户没在本页手动选过账户，
  // 这里的预选账户立刻跟着变（取消勾选→回到未选择；勾选别的→换成新的默认账户）。
  // 账户变了，金额显示币种自动跟着变——金额币种只认所选账户
  useEffect(() => {
    if (userPickedAssetRef.current) return;
    // 依赖里放 recentAssets（快照对象）而不是派生出来的 id：只比 id 会漏掉「值不变但要复位」的场景
    setAssetId(
      pickUsableAsset(getRecentAssetsSnapshot()[uiType === 'income' ? 'income' : 'expense']) ?? defaultAsset?.id ?? null
    );
  }, [recentAssets, defaultAsset?.id, uiType]);

  useEffect(() => {
    if (userPickedFromRef.current) return;
    setFromAssetId(pickUsableAsset(getRecentAssetsSnapshot().transferFrom) ?? defaultAsset?.id ?? null);
  }, [recentAssets, defaultAsset?.id]);

  // 转账/兑换专用状态——"转出"账户也带默认值（通常就是平时最常用那张），"转入"留给用户自己选
  // 转账编辑：账户 / 汇率 / 手续费从这笔记录回填（用户 2026-10-28：转账也要能编辑，不再「删了重记」）
  const editTransfer = editTransaction?.type === 'transfer' ? editTransaction : undefined;
  const [fromAssetId, setFromAssetId] = useState<string | null>(editTransfer?.fromAssetId ?? preferredFromAssetId);
  const [toAssetId, setToAssetId] = useState<string | null>(editTransfer?.toAssetId ?? null);
  const [exchangeRate, setExchangeRate] = useState(() => {
    const f = editTransfer?.exchangeRate ?? 0;
    if (!f) return '';
    // 与上面的方向保持一致：÷ 档显示倒数（0.625 → 1.6）
    return String(f > 0 && f < 1 ? Number((1 / f).toFixed(6)) : f);
  });
  // 汇率方向：'mul' = 1 转出币 = rate 转入币（转出 × rate）；'div' = rate 转出币 = 1 转入币（转出 ÷ rate）。
  // 用户 2026-10-28：人民币换马币，输入 1.60 意思通常是「1 MYR = 1.60 CNY」，到账要除，不能乘。
  /**
   * 汇率方向 + 输入框里的数字：
   * - 新建：默认 ÷（用户输 1.6 一般指「1 MYR = 1.6 CNY」）
   * - 编辑：库里存的是「相乘系数」。系数 < 1（如 0.625）时用 ÷ 并把数字取倒数（1.6）——
   *   这正是用户当初输入的那个数，改起来不用心算；系数 ≥ 1 时用 × 原样显示。
   * 两种写法数学等价，保存时都折算回同一个系数，不改任何既有数据。
   */
  const editRateFactor = editTransfer?.exchangeRate ?? 0;
  const [rateMode, setRateMode] = useState<'mul' | 'div'>(
    editTransfer ? (editRateFactor > 0 && editRateFactor < 1 ? 'div' : 'mul') : 'div'
  );
  const [fee, setFee] = useState(editTransfer?.fee ? String(editTransfer.fee) : '');
  // 转账/兑换的所有金额字段统一使用自绘计算器：金额、汇率、手续费。
  // 汇率跟手续费一样默认空（显示 0.00），不预填 1.00——不然每次都要先删掉默认值才能输入
  // 兑换 / 跨币种转账：用户在 money changer 柜台**实际收到**的金额（转入币种）。
  // 用户 2026-11-03：流程是「先去实体店换钱，再回来记账」——两侧金额都是已知输入，
  // 汇率是算出来的结果，不该反过来由实时汇率去推。
  const [receivedAmount, setReceivedAmount] = useState(() => {
    const factor = editTransfer?.exchangeRate ?? 0;
    if (!factor) return '';
    return String(Number(((editTransfer?.amount ?? 0) * factor).toFixed(2)));
  });
  const receivedExpr = useAmountExpression(undefined);
  const [receivedCursor, setReceivedCursor] = useState(0);
  const rateExpr = useAmountExpression(undefined);
  const feeExpr = useAmountExpression(undefined);
  const [calculatorTarget, setCalculatorTarget] = useState<'amount' | 'rate' | 'fee' | 'received'>('amount');

  // 用户手动改过汇率（在计算器里定过「汇率」那一格）→ 自动流程不再覆盖他输入的数字；resetAll 复位
  const rateManuallySetRef = useRef(false);
  // 转账 / 兑换 各自的表单草稿：两页互不覆盖，切走再切回能恢复（钱包、金额、实收、汇率、手续费、乘除档）
  type FxDraft = {
    fromAssetId: string | null;
    toAssetId: string | null;
    amount: string;
    receivedAmount: string;
    exchangeRate: string;
    fee: string;
    rateMode: 'mul' | 'div';
    rateManual: boolean;
  };
  const fxDraftsRef = useRef<{ transfer?: FxDraft; exchange?: FxDraft }>({});
  // 自动流程是在 await 之后才写字段的，那时闭包里的 rateMode 可能已经过期 → 用 ref 拿当前档位
  const rateModeRef = useRef(rateMode);
  useEffect(() => {
    rateModeRef.current = rateMode;
  }, [rateMode]);

  // 当前键盘目标格的光标分发：按键在光标处生效（pressKeyAt 返回新光标偏移写回 state）。
  // reset 打开键盘（空态起输）时光标一律回到末尾
  const handleExprKey = (key: string) => {
    if (calculatorTarget === 'amount') setAmountCursor(amountExpr.pressKeyAt(key, amountCursor));
    else if (calculatorTarget === 'rate') setRateCursor(rateExpr.pressKeyAt(key, rateCursor));
  else if (calculatorTarget === 'received') setReceivedCursor(receivedExpr.pressKeyAt(key, receivedCursor));
    else setFeeCursor(feeExpr.pressKeyAt(key, feeCursor));
  };

  // 转账/兑换账户选择：不再经过独立的“选择步骤”，直接在当前页面通过弹层菜单切换账户
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accountPickerRole, setAccountPickerRole] = useState<'from' | 'to'>('from');
  // 咬合接缝：共同父容器实测宽度（不假设等于 windowWidth-32）+ 每个实例稳定的 mask id
  const [fxMeasuredW, setFxMeasuredW] = useState(0);
  const fxMaskIdRef = useRef(`fxm-${Math.random().toString(36).slice(2, 8)}`);
  // 互换按钮：箭头只绕自身中心顺时针累计旋转（每次 +180°，不回零、不倒转）
  const fxArrowRot = useSharedValue(0);
  const fxArrowStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${fxArrowRot.value}deg` }],
  }));


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
      ? keypadPanelH + keypadBottomPad + keypadKeyboardLift + androidKbLift
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

  // 新建分组已随选类别页搬进共享 CategoryPage：本页这个开关恒为 false，
  // 但仍被浮层守卫（forceHideWanted / overlayOpen / 安卓返回键）引用，故保留声明
  const [newGroupFormOpen, setNewGroupFormOpen] = useState(false);

  // 类别顺序 = 共享页落库后的镜像（本页不再自己排序、不再写 @jizhang/categoryOrder）；
  // 首屏仍从同一对存储键读一次，拖完返回后快捷格与「全部」抽屉按同一份顺序
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

  // 图标选择弹层随选类别页搬进共享 CategoryPage：本页恒为 false，仅供浮层守卫引用
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  // 大组顺序的镜像：与共享 CategoryPage 共用 @jizhang/categoryGroupOrder ——
  // 本页只保留首屏读取 + 共享页落库后的回调镜像，不再自己写这个键
  const [groupOrder, setGroupOrder] = useState<Record<string, number>>({});

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

  // ---------- 类别横排"最近用过"：外面直接显示4个，点了就直接选中，不用进选择页 ----------
  const [recentCategoryIds, setRecentCategoryIds] = useState<string[]>([]);
  /** 兑换页金额展示：输入中给原始串（保住光标），空输入仍显示 0.00 —— 与支出页同一口径 */
function fxAmountText(raw: string, live: string | null): string {
  if (live !== null) return live === '' ? '0.00' : live;
  return formatMoney(parseFloat(raw) || 0, { decimals: 2 });
}


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
  // 记一笔页挂载时把「金额 → 类别」记忆读一次；读盘完成前不能参与联想，
  // 否则慢设备上「用户先输金额、记忆后到」就会表现为「没反应」。
  const [amountMemoryReady, setAmountMemoryReady] = useState(false);
  const seededRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void hydrateAmountCategory().then(() => {
      if (!alive) return;
      setAmountMemoryReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);


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
  // 只铺「完整放得下」的行数：以前 Math.max(2, …) 在小屏/矮屏上会强行塞两行，
  // 那两行塞不进可见高度 → 网格出现可滚动溢出（用户反馈看到 overflow 迹象）。
  // 现在最少 1 行，剩下的类别由末尾「全部」磁贴进完整列表，功能不丢。
  // 起始行数按 74 估（单行标签），随后用**实测**内容高度自我收敛：
  // 放不下就少一行、还塞得下一行就多一行（用户 2026-10-30：不要滚动，屏幕能放多少就多少）。
  // 上下都封 3 步，保证不会来回抖动。
  const [gridRowAdjust, setGridRowAdjust] = useState(0);
  const gridVisibleRows =
    gridH == null
      ? null
      : Math.max(1, Math.floor(gridH / CAT_CELL_ROW_HEIGHT) + gridRowAdjust);
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
  // 金额 → 类别联想用的“当前金额”：键盘打开时 amount 还没落定（「完成」就是保存键），
  // 只能盯实时输入串；多项算式（拆金额中）不参与，避免算术中间态乱跳类别。
  // 金额→类别记忆的作用域：当前账本 + 当前记账币种（不同币种的 100 不该共用同一条记忆）
  const amountScope = {
    ledgerId: activeLedgerId,
    currency: assets.find((a) => a.id === assetId)?.currency ?? null,
  };

  const liveAmountValue = amountKeypadOpen
    ? amountExpr.isMulti
      ? NaN
      : parseFloat(amountExpr.displayValue)
    : parseFloat(amount);

  // 记忆 = 现存账目历史的统计。每次历史变化都整体重建：
  // 删账 → 票自然消失；改账 → 旧票换新票；不会再出现「删掉又被播种回来」。
  // 记忆版本：读盘完成 / 历史重建 / 记账 / 删账都会变 → 触发重算，避免「先输金额后重建」时无反应
  const [amountMemoryVersion, setAmountMemoryVersion] = useState(getAmountCategoryVersion);
  useEffect(() => subscribeAmountCategory(() => setAmountMemoryVersion(getAmountCategoryVersion())), []);

  const lastHistorySignatureRef = useRef('');
  useEffect(() => {
    if (!amountMemoryReady || dataLoading) return; // 数据未就绪时别拿空列表清空记忆
    const history = (allTransactions ?? []) as Array<{
      id?: string;
      type: string;
      amount: number;
      categoryId?: string;
      ledgerId?: string;
      assetId?: string;
      createdAt?: number;
    }>;
    // 廉价签名：条数 + 最大 createdAt + 金额/类别拼接的简易哈希，避免每次渲染都重算
    let hash = 0;
    for (const tx of history) {
      const key = `${tx.id ?? ''}${tx.categoryId ?? ''}`;
      for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    const signature = `${history.length}:${hash}`;
    if (lastHistorySignatureRef.current === signature) return;
    lastHistorySignatureRef.current = signature;

    const assetCurrency = (id?: string) => assets.find((a) => a.id === id)?.currency ?? null;
    rebuildAmountCategory(
      history
        .filter((tx) => tx.type === 'expense' || tx.type === 'income')
        .map((tx) => ({
          type: tx.type as 'expense' | 'income',
          amount: tx.amount,
          categoryId: tx.categoryId,
          scope: { ledgerId: tx.ledgerId, currency: assetCurrency(tx.assetId) },
          at: tx.createdAt,
        }))
    );
  }, [amountMemoryReady, dataLoading, allTransactions, assets]);

  // 金额变化时按「输入过的金额」带出类别：手选过 / 编辑态 / 转账兑换 一律不参与
  useEffect(() => {
    if (isEditing) return;
    if (!amountMemoryReady) return; // 记忆还没读出来：等它好了会因依赖变化重新跑
    if (userPickedCategoryRef.current) return;
    if (uiType !== 'expense' && uiType !== 'income') return;
    if (!liveAmountValue || liveAmountValue <= 0) return;
    const remembered = lookupCategoryForAmount(uiType, liveAmountValue, amountScope);
    if (!remembered || remembered === categoryId) return;
    // 类别可能已被删除：只认当前类型下仍然存在的
    if (!categories.some((c) => c.id === remembered && c.type === uiType)) return;
    setCategoryId(remembered);
  }, [liveAmountValue, uiType, isEditing, categoryId, categories, amountMemoryReady, amountMemoryVersion]);

  // 金额字号档位（V2 稿基准 64；矮屏按 T15 惯例再收一档 44，给类别网格腾「至少 2 行」）
  const heroAmountFontSize = amountFontTier(heroAmountDisplay, isShort ? 44 : 64);

  const fromAsset = assets.find((a) => a.id === fromAssetId);
  const toAsset = assets.find((a) => a.id === toAssetId);
  const isCrossCurrency = !!fromAsset && !!toAsset && fromAsset.currency !== toAsset.currency;
  // 兑换页始终显示汇率输入；普通转账只在跨币种时才显示
  const showRateField = isExchange || isCrossCurrency;

  // 「实收」的当前值：键盘正停在那一格时用实时输入串。
  // ⚠ 必须进依赖数组：2026-11-03 实测「转出 120 / 实收 1000 但汇率仍是 0.00」，
  // 就是因为按键过程中 deps 没变，effect 只在切格子那一刻跑过一次（那时缓冲还是空）。
  // 两侧都要实时：转出侧正在打字时同样不能等提交
  const sentLive = calculatorTarget === 'amount' && amountKeypadOpen ? amountExpr.displayValue : amount;
  const receivedLive =
    calculatorTarget === 'received' && amountKeypadOpen ? receivedExpr.displayValue : receivedAmount;

  // 汇率 = 实收 ÷ (转出 − 手续费)。强制「×」档：用户要看的就是「1 转出币 = ? 转入币」。
  useEffect(() => {
    if (isEditing) return;
    if (!showRateField) return;
    const sent = parseFloat(sentLive) || 0;
    const feeNum = parseFloat(fee) || 0;
    const net = Math.max(0, sent - feeNum);
    const got = parseFloat(receivedLive) || 0;
    // 任一侧为空/为 0：汇率没有意义 → 清空，避免残留上一组金额算出的汇率
    if (net <= 0 || got <= 0) {
      if (exchangeRate) setExchangeRate('');
      return;
    }
    if (rateModeRef.current !== 'mul') setRateMode('mul');
    setExchangeRate(formatRateField(got / net));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentLive, fee, receivedLive, showRateField, isEditing]);


  useEffect(() => {
    if (presetCategoryId) {
      setCategoryId(presetCategoryId);
    userPickedCategoryRef.current = true;
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

  // 转账 / 兑换 两页互不覆盖：离开时存草稿，进入时还原（没有草稿才回到默认钱包 + 空值）
  const isFxType = (t: UiType) => t === 'transfer' || t === 'exchange';

  // 存草稿时优先取「键盘缓冲里正在输入的值」：用户常直接切 tab 不按完成，
  // 此时 amount/receivedAmount/fee 这几个 state 还是旧值，只存 state 会丢数据。
  const liveOr = (target: 'amount' | 'received' | 'fee', live: string, committed: string) =>
    calculatorTarget === target && amountKeypadOpen && live ? live : committed;

  const captureFxDraft = (): FxDraft => ({
    fromAssetId,
    toAssetId,
    amount: liveOr('amount', amountExpr.displayValue, amount),
    receivedAmount: liveOr('received', receivedExpr.displayValue, receivedAmount),
    exchangeRate,
    fee: liveOr('fee', feeExpr.displayValue, fee),
    rateMode: rateModeRef.current,
    rateManual: rateManuallySetRef.current,
  });

  const applyFxDraft = (d?: FxDraft) => {
    const fallbackFrom = pickUsableAsset(getRecentAssetsSnapshot().transferFrom) ?? defaultAsset?.id ?? null;
    setFromAssetId(d ? d.fromAssetId : fallbackFrom);
    setToAssetId(d ? d.toAssetId : null);
    setAmount(d?.amount ?? '');
    amountExpr.reset(d?.amount || undefined);
    setAmountCursor(0);
    setReceivedAmount(d?.receivedAmount ?? '');
    receivedExpr.reset(d?.receivedAmount || undefined);
    setReceivedCursor(0);
    const draftComplete =
      !!d && (parseFloat(d.amount) || 0) > 0 && (parseFloat(d.receivedAmount) || 0) > 0;
    setExchangeRate(draftComplete ? d!.exchangeRate : '');
    setFee(d?.fee ?? '');
    feeExpr.reset(d?.fee || undefined);
    setFeeCursor(0);
    setRateMode(d?.rateMode ?? 'mul');
    rateManuallySetRef.current = d?.rateManual ?? false;
    userPickedFromRef.current = !!d;
    setCalculatorTarget('amount');
  };

  // 支出/收入 与 转账/兑换 是两套金额语义：跨族切换时清空，避免「兑换填了 1000，支出页也变 1000」
  const switchUiType = (nextType: UiType) => {
    if (uiType === nextType) return;
    const fxNow = isFxType(uiType);
    const fxNext = isFxType(nextType);
    // 离开转账/兑换：先把当前这一档整份存成草稿
    if (fxNow) {
      fxDraftsRef.current[uiType as 'transfer' | 'exchange'] = captureFxDraft();
    }
    // 只有 支出↔收入 视为「改同一笔的类型」，保留金额；其余切换一律清空（草稿已保存，不丢）
    const bothSimple =
      (uiType === 'expense' || uiType === 'income') && (nextType === 'expense' || nextType === 'income');
    if (!bothSimple) {
      setAmount('');
      amountExpr.reset();
      setAmountCursor(0);
      setReceivedAmount('');
      setExchangeRate('');
      setFee('');
      rateManuallySetRef.current = false;
    }
    // 进入转账/兑换：还原这一档自己的草稿（没有就用默认）
    if (fxNext && uiType !== nextType) {
      applyFxDraft(fxDraftsRef.current[nextType as 'transfer' | 'exchange']);
    }
    setUiType(nextType);
    setCategoryId(null);
    setStep(stepForType(nextType));
  };

  const resetAll = () => {
    // 离开「记一笔」页面即作废草稿：只有同一次页面停留内切 tab 才保留数据
    fxDraftsRef.current = {};
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
    // ⚠ 关键：上一笔手动点过类别会把 userPickedCategoryRef 置 true，
    // 而「记一笔」这个 Tab 页不会卸载 —— 不复位就会导致「回到首页再记一笔，
    // 输入过往金额永远不自动带类别，必须杀进程」的反馈。
    userPickedCategoryRef.current = false;
    // 现场读快照，而不是渲染期的 preferredAssetId：saveTransaction 刚写进去的记忆还没走完一次渲染，
    // 用闭包会拿到上一笔之前的旧值（表现：必须重载 App 才记得上次的钱包）。resetAll 一律回到支出档。
    setAssetId(pickUsableAsset(getRecentAssetsSnapshot().expense) ?? defaultAsset?.id ?? null);
    setAssetPickerOpen(false);
    setFromAssetId(pickUsableAsset(getRecentAssetsSnapshot().transferFrom) ?? defaultAsset?.id ?? null);
    setToAssetId(null);
    setExchangeRate('');
    // 手动改过汇率的标记复位：新的一笔重新允许自动填
    rateManuallySetRef.current = false;
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
  // 安卓键盘避让（实测量取）：edge-to-edge 下窗口不一定随 adjustResize 缩小，搜狗等输入法会直接
  // 盖住底部面板里的备注框。不假设「窗口缩没缩」，而是键盘弹出后量面板实际底边与键盘上沿的重叠量，
  // 重叠多少就上抬多少（窗口已缩的机型量出来是 0，不会重复上抬）。
  const footerRef = useRef<View>(null);
  const [androidKbLift, setAndroidKbLift] = useState(0);
  // 安卓备注聚焦中：只留备注行贴在键盘上方，数字键收起（不整块计算器顶上去）
  const [noteEditing, setNoteEditing] = useState(false);
  const noteOnly = Platform.OS === 'android' && noteEditing;
  const androidKbLiftRef = useRef(0);
  const setAndroidLift = (v: number) => {
    androidKbLiftRef.current = v;
    setAndroidKbLift(v);
  };
  // 「点击填入：X」的 X：优先商品/类别建议，没有则退回高置信商户名（原有行为）
  // 备注框获得焦点：备注为空且用户没手动改过 → 填入建议（填进去的只是草稿，可改可删）
  // 手动改过备注（只有用户输入会走到这里，程序填入走 setNote）→ 本次票据不再自动覆盖建议
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardVisible(true);
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
      // 系统键盘弹出 → 自绘面板收起让位；但备注框聚焦的共存场景例外
      if (isFocused && !noteFocusRef.current) setAmountKeypadOpen(false);
      if (Platform.OS === 'android' && isFocused && noteFocusRef.current) {
        const kbTop = e?.endCoordinates?.screenY;
        // 等键盘动画/窗口缩放落定再量；量的是「当前已上抬量」折回去之前的原始底边
        setTimeout(() => {
          footerRef.current?.measureInWindow((_x, y, _w, h) => {
            if (kbTop == null || !h) return;
            const rawBottom = y + h + androidKbLiftRef.current;
            setAndroidLift(Math.max(0, Math.round(rawBottom - kbTop)));
          });
        }, 120);
      }
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setAndroidLift(0);
      // 安卓返回键收起键盘时输入框可能仍保持聚焦：主动失焦并还原数字键，避免面板卡在「只剩备注行」
      if (Platform.OS === 'android' && noteFocusRef.current) {
        noteFocusRef.current = false;
        setNoteEditing(false);
        noteInputRef.current?.blur();
      }
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
  // 最终网格内容：固定在前的（本次选过 + 最近用过）、按默认顺序补齐到可见容量；
  // 多出来的（历史用过的）不再按字符估宽裁剪丢弃 —— 网格区可滚动（T15），「全部」永远殿后
  const displayCategories = useMemo(() => {
    if (!selectedCategory || gridPinned.some((c) => c.id === selectedCategory.id)) return gridPinned;
    return [selectedCategory, ...gridPinned];
  }, [gridPinned, selectedCategory]);

  /** 真正铺到网格里的类别：只铺完整行放得下的数量，「全部」永远占最后一格。
   *  网格不再滚动 —— 超出的历史类别只能从「全部」进入完整列表（功能不丢）。 */
  const gridCategories = useMemo(
    () => (gridMaxCount == null ? displayCategories : displayCategories.slice(0, gridMaxCount)),
    [displayCategories, gridMaxCount]
  );

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
    // 选类别是同屏 step（不是独立路由）：硬件返回回表单，别把正在记的这笔一起弹掉
    if (step === 'category') {
      setStep('detail');
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
    userPickedCategoryRef.current = true;
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
    if (!isEditing && autoMonthly) {
      try { await premium.requireFeature('financialPlan'); } catch (error) { premium.showError(error); return false; }
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
    // 账户同理：真的记完账才算「上一次用的钱包」（只是选中没保存不记）
    rememberRecentAsset(type === 'income' ? 'income' : 'expense', assetId);
    // 同时学习「这个金额对应哪个类别」：下次输入同一金额直接带出（精确匹配，最近一次优先）
    rememberAmountCategory(type === 'income' ? 'income' : 'expense', value, categoryId, amountScope);
    // 同一张小票只提示一次：记完账把指纹入库
    void rememberReceiptRawText(lastScanRawTextRef.current);
    // 本机学习：这张票的实付标签 + 这个商户用的分类（下次直接命中）
    void rememberAmountLabel(lastScanMetaRef.current.amountLabel);
    // 商户→分类只在高置信商户上学习，避免把抬头猜测写进记忆
    if (lastScanMetaRef.current.merchantConfident) {
      void rememberMerchantCategory(lastScanMetaRef.current.merchant, categoryId);
    }

    // 自动月结：开关打开（默认关，手动开）时，把这笔账同步建成一条「每月同日自动入账」的
    // 财务规划——之后每个月由补账引擎自动 ±账目。防重复：同名称+同金额+同周期+同账户的计划已存在则跳过
    if (!isEditing && autoMonthly) {
      const planName = note.trim() || (selectedCategory ? getCategoryLabel(selectedCategory, t) : (type === 'income' ? t('finance.typeIncome') : t('finance.typeExpense')));
      const alreadyPlanned = paymentPlans.some(
        (p) => p.cycle === 'monthly' && p.amount === value && p.name === planName && p.assetId === (assetId ?? undefined)
      );
      if (!alreadyPlanned) {
        await addPaymentPlan({
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
            navigation?.navigate(ROUTES.TAB_HOME, { screen: ROUTES.HOME });
          }
        });
      }
    } catch (err) {
      if (err instanceof PremiumRequired) return;
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
      if (err instanceof PremiumRequired) return;
      console.error('保存失败:', err);
      dialog.alert({ title: t('addTx.saveFailed'), message: err instanceof Error ? err.message : String(err) });
    }
  };

  // Enter/下一步箭头已由小数点键取代（标准金额录入）；备注框常驻在计算器面板里可随时点

  // 转账/兑换字段统一走同一个计算器。只有编辑“转出金额”时，完成键才会保存整笔记录；
  // 汇率/手续费完成键只负责把计算结果写回对应字段，不会提前保存。
  const openTransferCalculator = (target: 'amount' | 'rate' | 'fee' | 'received') => {
    // 备注框的系统键盘/光标退场：一次只允许一个光标显示（点自绘字段 = 切换输入焦点）
    noteInputRef.current?.blur();
    // 切换到另一个字段之前，先把当前正在编辑、还没确认的算式定下来——
    // 不然直接点别的格子（比如输入了500转出金额，手滑点了汇率格子）会导致
    // 刚输入的值从没写回 amount/exchangeRate/fee 这几个 state，显示直接跳回 0
    if (amountKeypadOpen && calculatorTarget !== target) {
      try {
        commitTransferField();
      } catch {
        // 提交当前格子失败也必须继续切换焦点，否则整行点了会「毫无反应」
      }
    }
    setCalculatorTarget(target);
    // 打开键盘即从空态起输：按 5 就是 5 元，新输入直接替换旧值（不再从尾部续接）
    if (target === 'amount') { amountExpr.reset(); setAmountCursor(0); }
    // 汇率格不再空态起步：自动汇率已经填好了，点开就把它显示出来（否则看一眼就被清成 0）
    if (target === 'rate') { rateExpr.reset(exchangeRate || undefined); setRateCursor(0); }
    // 实收金额可编辑：点开先显示已填的值（空态才从 0 起输）
    if (target === 'received') { receivedExpr.reset(receivedAmount || undefined); setReceivedCursor(0); }
    // 手续费：点开先带入已填值、光标置于尾端（和「实收」一致；空态由展示层回落 0.00）
    if (target === 'fee') { feeExpr.reset(fee || undefined); setFeeCursor(0); }
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
      // 缓冲是空的（点开汇率格但没输入）时绝不回写：否则会把自动汇率冲成 0
      if (Number.isFinite(value) && value > 0) setExchangeRate(value.toString());
      return value;
    }
    if (calculatorTarget === 'received') {
      const got = receivedExpr.confirm();
      setReceivedAmount(got > 0 ? got.toFixed(2) : '');
      return got;
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
      // 先定这一格的值，再按它决定是否算「手动覆盖」——点开看一眼就点完成，不该锁死自动汇率；
      // commitTransferField 只能调一次：它内部的 confirm() 会重置键盘，第二次会拿到 0。
      const committed = commitTransferField();
      if (calculatorTarget === 'rate' && Number.isFinite(committed) && committed > 0) {
        rateManuallySetRef.current = true;
      }
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
      if (err instanceof PremiumRequired) return;
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
      if (err instanceof PremiumRequired) return;
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
    const typedRate = showRateField ? (options?.rateOverride ?? parseFloat(exchangeRate)) : 1;
    if (showRateField && (!typedRate || typedRate <= 0)) {
      dialog.alert({ title: t('addTx.rateInvalid') });
      return;
    }
    // 界面上的 ÷ 档只是输入方式：入库/计算一律用「转出 × rate = 转入」的系数，
    // 余额、详情页、统计都按这一套算，不用跟着改。
    const rate = !showRateField ? 1 : rateMode === 'div' ? 1 / typedRate : typedRate;
    const feeValue = options?.feeOverride ?? (parseFloat(fee) || 0);
    const changedExchange = !editTransfer || editTransfer.fromAssetId !== fromAssetId || editTransfer.toAssetId !== toAssetId
      || editTransfer.amount !== value || editTransfer.exchangeRate !== rate || (editTransfer.fee ?? 0) !== feeValue || editTransfer.date !== date;
    if (changedExchange && assets.find(a => a.id === fromAssetId)?.currency !== assets.find(a => a.id === toAssetId)?.currency) {
      try { await premium.requireFeature('exchange'); } catch (error) { premium.showError(error); return; }
    }
    // 备注同下面这行一起搬进了键盘面板，小票(收据)现在转账/兑换也能附了——
    // 如果 addTransfer 的类型定义里还没有 receiptUri 字段，需要先在那边补上
    if (editTransfer) {
      // 编辑既有转账：原地更新（含手续费伴随行），不再新增一笔
      await updateTransfer({
        id: editTransfer.id,
        fromAssetId,
        toAssetId,
        amount: value,
        exchangeRate: rate,
        fee: feeValue,
        date,
        note,
        receiptUri: receiptUri ?? undefined,
      });
    } else {
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
    }
    // 转账只记「转出」：下次进来转出直接带出；转入仍留空让用户确认
    rememberRecentAsset('transferFrom', fromAssetId);
    // T17：success 震动 + 300ms 勾选动画，然后照原逻辑（清表单；非长按再回首页）
    hapticSuccess();
    playSaveFlashThen(() => {
      resetAll();
      // 长按"完成"＝保存后继续记下一笔，留在本页；普通点击才退出
      if (!options?.continueRecording) {
        // 编辑态：回上一页（账单详情），那里会读到更新后的数据；新建态才回首页
        if (editTransfer) navigation?.goBack();
        // 转账：落到「资产」Tab 并直接打开转入账户详情 —— 让用户看到「收到钱的那个钱包」到账后的余额/流水
        else {
          // 先把「记一笔」从当前栈上摘掉：它在首页栈 / 资产栈 / AI 栈里都是 push 进来的，
          // 只切 Tab 的话它会留在原栈里，用户再回那个 Tab 看到的是一张空的记一笔表单。
          if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) navigation.goBack();
          navigation?.navigate(ROUTES.TAB_ASSETS, {
            screen: ROUTES.ASSETS,
            params: { focusAssetId: toAssetId },
          });
        }
      }
    });
    return true;
  };

  const handleSaveTransfer = () => handleSaveTransferWithAmount().catch(error => { premium.showError(error); });

  // ---------- 扫描小票 ----------
  // 完全本地：设备端 ML Kit（中文模型）读字 → 本地规则解析 → 本地查重；不调用任何服务端/AI 接口。
  // 会员校验放在入口（开相机 / 选图之前），拍完的照片不会因为校验失败被丢掉
  const runScan = async (base64: string, uri: string) => {
    // 每次扫票先复位日期：否则扫描失败时会留下上一张票的日期（真机出现过 1月15日 残留）
    setDate(todayStr());
    // 本地 OCR 需要新安装包：老 APK 拿到新 JS 时给出更新入口（不再依赖任何 AI 密钥）
    if (!isLocalOcrAvailable()) {
      dialog.alert({
        title: t('addTx.scanNeedUpdateTitle'),
        message: t('addTx.scanNeedUpdateMsg'),
        buttons: [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('addTx.scanGoUpdate'), onPress: () => { void Linking.openURL(APP_UPDATE_URL); } },
        ],
      });
      return;
    }
    setScanning(true);
    try {
      const result = await scanReceipt(uri, base64);

      // 记下 OCR 原文：保存成功后写进本地查重库（同一张小票再扫会提示）
      lastScanRawTextRef.current = result.rawText;
      lastScanMetaRef.current = {
        merchant: result.merchant,
        merchantConfident: result.merchantConfident,
        amountLabel: result.amountLabel,
      };
      if (result.duplicate) {
        dialog.alert({
          title: t('addTx.receiptDuplicateTitle'),
          message: t('addTx.receiptDuplicateMsg').replace('{n}', String(result.duplicateDaysAgo ?? 0)),
        });
      }

      setUiType(result.type);

      if (result.learnedCategoryId) {
        // 本机学过「这个商户属于哪个分类」→ 直接采用（比关键词更准）
        const learned = categories.find((c) => c.type === result.type && c.id === result.learnedCategoryId);
        if (learned) setCategoryId(learned.id);
      } else if (result.suggestedCategory) {
        // AI 提示词固定中文，返回的是中文分类名 → 先映射成内置分类 id 再按 id 匹配，
        // 与界面语言（中文/英文）无关；AI 不会建议用户自建分类，不再按存储名兜底
        const suggestedId = findCategoryIdByChineseName(result.suggestedCategory);
        const matched = suggestedId
          ? categories.find((c) => c.type === result.type && c.id === suggestedId)
          : undefined;
        if (matched) setCategoryId(matched.id);
      userPickedCategoryRef.current = true;
      }
      if (result.amount != null) {
        setAmount(String(result.amount));
        amountExpr.reset(result.amount);
      }
      if (result.date) setDate(result.date);
      // 备注不再自动填充（OCR 商户名常抓错字眼）；只存成建议，由用户点备注框时决定
      // 方案 B：只有票据里有明确 Merchant 标签（钱包账单）才给备注建议；纸质小票一律不给
      // 备注建议：1–2 件商品「购买 A、B」→ ≥3 件「采购文具」→ 高置信商户兜底；null 表示不给建议
      // 新票据 = 新建议：复位「手动改过」标记（已有备注不会被覆盖，填入只发生在备注为空时）
      // 扫描用的这张照片本身就是单据，顺手存成凭证，不用用户再拍一次。
      // 相机给的是 cache 里的临时 uri：先复制进 documentDirectory，清缓存/换机才不会破图
      setReceiptUri(await persistReceiptImage(uri));

      setStep('detail');

      const accountCurrency = assets.find((a) => a.id === assetId)?.currency ?? null;
      if (result.currency && accountCurrency && result.currency !== accountCurrency) {
        // 币种不一致：绝不把同一个数字按另一种币直接入账
        dialog.alert({
          title: t('addTx.scanCurrencyMismatchTitle'),
          message: t('addTx.scanCurrencyMismatchMsg')
            .replace('{scan}', result.currency)
            .replace('{account}', accountCurrency),
        });
      }
      if (result.amount == null) {
        // 清空金额框：否则会残留上一次扫描/输入的数值，用户一路「完成」就记错了
        setAmount('');
        amountExpr.reset();
        dialog.alert({ title: t('common.confirm'), message: t('addTx.scanNoAmount') });
      } else if ((result.confidence ?? 1) < 0.6) {
        // 规则置信度低（没找到明确金额标签/货币符号）：提醒核对，而不是悄悄填错
        dialog.alert({ title: t('addTx.scanCheckAmountTitle'), message: t('addTx.scanCheckAmountMsg') });
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

  const handleScanPress = async () => {
    try { await premium.requireFeature('scan'); } catch (error) { premium.showError(error); return; }
    // 本地识别模块缺失时不必开相机（拍了也解析不了）——直接给更新入口
    if (!isLocalOcrAvailable()) {
      dialog.alert({
        title: t('addTx.scanNeedUpdateTitle'),
        message: t('addTx.scanNeedUpdateMsg'),
        buttons: [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('addTx.scanGoUpdate'), onPress: () => { void Linking.openURL(APP_UPDATE_URL); } },
        ],
      });
      return;
    }
    setCameraMode('scan');
  };

  const pickFromLibrary = async () => {
    try { await premium.requireFeature('scan'); } catch (error) { premium.showError(error); return; }
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
    if (!result.canceled && result.assets?.[0]?.uri) {
      // 相册给的是临时 uri，同样先复制进 documentDirectory 再留档
      setReceiptUri(await persistReceiptImage(result.assets[0].uri));
    }
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
    const toSymbol = getCurrencySymbol(toAsset?.currency ?? currency);
    // ---------- 咬合几何（唯一真相）：卡高 / 间距 / 按钮 / 凹口 全部从这里取 ----------
    const FX_CARD_H = showRateField ? 124 : 62;
    const FX_GAP = 24;
    const FX_BTN = 44;
    const FX_NOTCH_R = 26;
    const fxPairW = fxMeasuredW || windowWidth - layout.page * 2;
    const fxPairH = FX_CARD_H * 2 + FX_GAP;
    const fxCx = fxPairW / 2;
    const fxCy = FX_CARD_H + FX_GAP / 2;
    const fxBtnTop = (FX_GAP - FX_BTN) / 2;
    const fxMaskId = fxMaskIdRef.current;
   const rateNum = parseFloat(exchangeRate) || 0;
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
    // ÷ 档：到账 = 净额 ÷ 汇率（汇率为 0 时先按 0 算，避免 Infinity）
    const liveConverted = showRateField
      ? rateMode === 'div'
        ? liveRateNum > 0
          ? netAmount / liveRateNum
          : 0
        : netAmount * liveRateNum
      : netAmount;
    const converted = formatMoney(liveConverted, { decimals: 2 });

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
          /* 编辑既有转账时锁住类型：转账/兑换在数据层都是 transfer，切到「支出」会把这笔
             转账改写成支出、账户与汇率全部丢失（用户 2026-10-28 指出的风险）。
             新建态照旧可选；编辑态分段也隐藏。 */
          showTypeSwitch={!isEditing}
          onDeletePress={isEditing ? handleDeleteTransaction : undefined}
          onSelectType={(nextType) => {
            if (isEditing) return;
            switchUiType(nextType);
          }}
          title={isEditing ? t('addTx.editTitle') : t('nav.add')}
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
            { paddingBottom: amountKeypadOpen ? 28 : tabClearance + 36 },
          ]}
        >
                    {/* 兑换记录（V2）：一张卡两段，中间 hairline + 骑在缝上的互换钮；
              金额是主角（大字号、点开自绘计算器），账户行只负责选钱包。 */}

          {!showRateField ? (
            <AppText variant="caption" weight="600" color={semantic.textSecondary} style={styles.fxOuterLabel}>
              {t('addTx.fromWalletLabel')}
            </AppText>
          ) : null}

          <View
            style={styles.fxPairWrap}
            onLayout={(e) => setFxMeasuredW(Math.round(e.nativeEvent.layout.width))}
          >
            <Svg width={fxPairW} height={fxPairH} style={styles.fxPairSvg} pointerEvents="none">
                <Defs>
                  <Mask id={fxMaskId} maskUnits="userSpaceOnUse" x={0} y={0} width={fxPairW} height={fxPairH}>
                    <Rect x={0} y={0} width={fxPairW} height={fxPairH} fill="#FFFFFF" />
                    <Circle cx={fxCx} cy={fxCy} r={FX_NOTCH_R} fill="#000000" />
                  </Mask>
                </Defs>
                <Rect x={0} y={0} width={fxPairW} height={FX_CARD_H} rx={radius.md} ry={radius.md}
                  fill={semantic.surface} mask={`url(#${fxMaskId})`} />
                <Rect x={0} y={FX_CARD_H + FX_GAP} width={fxPairW} height={FX_CARD_H} rx={radius.md} ry={radius.md}
                  fill={semantic.surface} mask={`url(#${fxMaskId})`} />
            </Svg>
          <View
            style={[
              styles.fxAmountCard,
              !showRateField && styles.fxWalletCard,
              styles.fxPairCard,
              { height: FX_CARD_H },
              showRateField && calculatorTarget === 'amount' && amountKeypadOpen && styles.fxCardActive,
            ]}
            onLayout={registerFieldY('amount')}
          >

            <PressableScale
              activeScale={0.98}
              hitSlop={0}
              onPress={() => {
                setAccountPickerRole('from');
                setAccountPickerOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.outAccount')}
              style={styles.fxAccountRow}
            >
              <IconCircle
                size={44}
                color={fromAsset?.color ?? semantic.surfaceSunken}
                icon={(fromAsset?.icon as IconName) ?? 'wallet-outline'}
              />

              <AppText
                variant={showRateField ? "subhead" : "headline"}
                weight="600"
                color={fromAsset ? semantic.textPrimary : semantic.textTertiary}
                numberOfLines={1}
                style={styles.fxAccountName}
              >
                {fromAsset?.name ?? t('common.notSelected')}
              </AppText>
              <AppText variant="caption" color={semantic.textTertiary}>
                {fromAsset?.currency ?? ''}
              </AppText>
              {!showRateField && fromAsset ? (
                <AppText color={semantic.textTertiary} numberOfLines={1} style={styles.fxBalanceInline}>
                  {formatMoney(getAssetBalance(fromAsset.id), { decimals: 2 })}
                </AppText>
              ) : null}
              <Ionicons name="chevron-down" size={16} color={semantic.textTertiary} style={styles.fxChevron} />
            </PressableScale>
            <PressableScale
              activeScale={0.98}
              hitSlop={0}
              onPress={() => openTransferCalculator('amount')}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.outAmount')}
              style={showRateField ? styles.fxBigAmountTouch : undefined}
            >


              {showRateField ? (
  <View style={styles.fxAmountLine}>
                  <HeroAmountText
                    display={fxAmountText(amount, calculatorTarget === 'amount' && amountKeypadOpen ? amountExpr.displayValue : null)}
                  onPress={() => openTransferCalculator('amount')}
                    fontSize={amountFontTier(fxAmountText(amount, calculatorTarget === 'amount' && amountKeypadOpen ? amountExpr.displayValue : null), 44)}
                    cursorFromEnd={amountCursor}
                    cursorActive={calculatorTarget === 'amount' && amountKeypadOpen && !amountExpr.isMulti}
                    onCursorChange={setAmountCursor}
                  />

                </View>
              ) : null}
            </PressableScale>
          </View>

          {/* 接缝：间距 24、按钮 44（上下各压 10）；凹口靠卡片 SVG 轮廓 evenodd 挖出，这里不放任何圆盘 */}
          <View style={styles.fxGapBand}>
            {!showRateField ? (
              <AppText variant="caption" weight="600" color={semantic.textSecondary} style={styles.fxGapLabel}>
                {t('addTx.toWalletLabel')}
              </AppText>
            ) : null}
            {/* 定位层：普通透明 View（44×44，left 50% / -22，top -10，相对接缝带局部坐标） */}
            <View style={styles.fxSwapSlot}>
              <PressableScale
                style={[styles.fxSeamBtn, elevation.level2]}
              activeScale={1}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.swapAccounts')}
              onPress={() => {
                hapticLight();
                fxArrowRot.value = withTiming(fxArrowRot.value + 180, {
                  duration: 280,
                  easing: Easing.inOut(Easing.ease),
                });
                userPickedFromRef.current = true;
                // 1) 方向：两个钱包对调（跨币种、同币种都这么做）
                setFromAssetId(toAssetId);
                setToAssetId(fromAssetId);
                if (showRateField) {
                  // 2) 跨币种：两侧金额也要一起对调 —— 「100 MYR → 30.18 SGD」反转后就该是
                  //    「付 30.18 SGD 拿到 100 MYR」，否则金额含义与方向不一致（汇率会算错）。
                  //    优先取键盘缓冲里的实时值，避免没按完成时对调成旧值。
                  const liveFrom =
                    calculatorTarget === 'amount' && amountKeypadOpen ? amountExpr.displayValue : amount;
                  const liveTo =
                    calculatorTarget === 'received' && amountKeypadOpen ? receivedExpr.displayValue : receivedAmount;
                  setAmount(liveTo);
                  setReceivedAmount(liveFrom);
                  amountExpr.reset(liveTo || undefined);
                  receivedExpr.reset(liveFrom || undefined);
                  setAmountCursor(0);
                  setReceivedCursor(0);
                  // 汇率是派生值：实收 ÷ 净转出 → 对调后自动等于原汇率的倒数，不需要切乘除档
                  setRateMode('mul');
                  setCalculatorTarget('amount');
                } else {
                  // 同币种转账：金额不随方向变化，只切换乘除档（原行为）
                  setRateMode((m) => (m === 'mul' ? 'div' : 'mul'));
                }
              }}
            >
              <LinearGradient
                colors={[withAlpha(semantic.accent, 0.86), semantic.accent]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={styles.fxSeamFace}
              >
              <Reanimated.View style={fxArrowStyle}>
                            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
                {/* 参考图：两条互相追随的弧形箭头（上弧朝右、下弧朝左），整体呈旋转交换形态 */}
                <Path
                  d="M4 9 C7 3 16 3 20 9 M20 4 V9 H15"
                  stroke={semantic.onAccent}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path
                  d="M20 15 C17 21 8 21 4 15 M4 20 V15 H9"
                  stroke={semantic.onAccent}
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
              </Reanimated.View>
              </LinearGradient>
              </PressableScale>
            </View>
          </View>


          <View
            style={[
              styles.fxAmountCard,
              !showRateField && styles.fxWalletCard,
              styles.fxPairCard,
              { height: FX_CARD_H },
              calculatorTarget === 'received' && amountKeypadOpen && styles.fxCardActive,
            ]}
          >

            <PressableScale
              activeScale={0.98}
              hitSlop={0}
              onPress={() => {
                setAccountPickerRole('to');
                setAccountPickerOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.inAccount')}
              style={styles.fxAccountRow}
            >
              <IconCircle
                size={44}
                color={toAsset?.color ?? semantic.surfaceSunken}
                icon={(toAsset?.icon as IconName) ?? 'wallet-outline'}
              />

              <AppText
                variant={showRateField ? "subhead" : "headline"}
                weight="600"
                color={toAsset ? semantic.textPrimary : semantic.textTertiary}
                numberOfLines={1}
                style={styles.fxAccountName}
              >
                {toAsset?.name ?? t('common.notSelected')}
              </AppText>
              <AppText variant="caption" color={semantic.textTertiary}>
                {toAsset?.currency ?? ''}
              </AppText>
              {!showRateField && toAsset ? (
                <AppText color={semantic.textTertiary} numberOfLines={1} style={styles.fxBalanceInline}>
                  {formatMoney(getAssetBalance(toAsset.id), { decimals: 2 })}
                </AppText>
              ) : null}
              <Ionicons name="chevron-down" size={16} color={semantic.textTertiary} style={styles.fxChevron} />
            </PressableScale>

            {!showRateField ? null : !isEditing ? (
              <PressableScale
                activeScale={0.98}
                hitSlop={0}
                onPress={() => openTransferCalculator('received')}
                accessibilityRole="button"
                accessibilityLabel={t('addTx.receivedLabel')}
                style={styles.fxBigAmountTouch}
                testID="addtx-received-amount"
              >
                <View style={styles.fxAmountLine}>
                  <HeroAmountText
                    display={fxAmountText(receivedAmount, calculatorTarget === 'received' && amountKeypadOpen ? receivedExpr.displayValue : null)}
                  onPress={() => openTransferCalculator('received')}
                    fontSize={amountFontTier(fxAmountText(receivedAmount, calculatorTarget === 'received' && amountKeypadOpen ? receivedExpr.displayValue : null), 44)}
                    cursorFromEnd={receivedCursor}
                    cursorActive={calculatorTarget === 'received' && amountKeypadOpen && !receivedExpr.isMulti}
                    onCursorChange={setReceivedCursor}
                  />

                </View>
              </PressableScale>
            ) : (
              <View style={styles.fxBigAmountTouch}>
                <View style={styles.fxAmountLine}>
                  <HeroAmountText
                  display={converted}
                  fontSize={amountFontTier(converted, 44)}
                  cursorFromEnd={0}
                  cursorActive={false}
                  onCursorChange={() => {}}
                />

                </View>
              </View>
            )}
          </View>

                      {/* 同币种转账：只有一个金额框（参考图），跨币种才需要两个金额 */}
          </View>

          {!showRateField ? (
            <AppText variant="caption" weight="600" color={semantic.textSecondary} style={styles.fxOuterLabel}>
              {t('addTx.transferAmount')}
            </AppText>
          ) : null}
          {!showRateField ? (
            <View style={[styles.fxAmountCard, styles.fxAmountCardCompact]}>
              <View style={styles.fxAmountLine}>

                <PressableScale
                  style={styles.fxAmountFill}
                  activeScale={0.98}
                  hitSlop={0}
                  onPress={() => openTransferCalculator('amount')}
                  accessibilityRole="button"
                  accessibilityLabel={t('addTx.transferAmount')}
                >
                  <HeroAmountText
                    display={fxAmountText(amount, calculatorTarget === 'amount' && amountKeypadOpen ? amountExpr.displayValue : null)}
                  onPress={() => openTransferCalculator('amount')}
                    fontSize={amountFontTier(fxAmountText(amount, calculatorTarget === 'amount' && amountKeypadOpen ? amountExpr.displayValue : null), 64)}
                    cursorFromEnd={amountCursor}
                    cursorActive={calculatorTarget === 'amount' && amountKeypadOpen && !amountExpr.isMulti}
                    onCursorChange={setAmountCursor}
                  />
                </PressableScale>
                <PressableScale
                  style={styles.fxClearBtn}
                  activeScale={0.9}
                  hitSlop={8}
                  onPress={() => {
                    setAmount('');
                    amountExpr.reset();
                    setAmountCursor(0);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('addTx.clearAmount')}
                >
                  <Ionicons name="close-circle" size={20} color={semantic.textTertiary} />
                </PressableScale>
              </View>
              <View
                onLayout={(e) => {
                  const cardY = fieldY.current['cardTop'] ?? 0;
                  fieldY.current['fee'] = cardY + e.nativeEvent.layout.y;
                }}
              >
              <PressableScale
                style={styles.fxFeeInlineRow}
                activeScale={0.98}
                hitSlop={8}

                onPress={() => openTransferCalculator('fee')}
                accessibilityRole="button"
                accessibilityLabel={t('addTx.fee')}
              >
                <View style={styles.fxMetaPill}>
                  <Ionicons name="receipt-outline" size={14} color={semantic.textSecondary} />
                </View>
                <AppText variant="caption" color={semantic.textSecondary}>
                  {t('addTx.fee')}
                </AppText>
                <View style={styles.fxFeeSpacer} />
                <CursorAmountText
                  display={
                    calculatorTarget === 'fee' && amountKeypadOpen
                      ? feeExpr.displayValue
                      : formatMoney(feeNum, { decimals: 2 })
                  }
                  enabled={calculatorTarget === 'fee' && amountKeypadOpen}
                  cursorFromEnd={feeCursor}
                  onCursorChange={setFeeCursor}
                  style={[styles.rateGridValue, styles.fxRateValueText]}
                  onPress={() => openTransferCalculator('fee')}
                  cursorStyle={styles.feeCursor}
                />
              </PressableScale>
              </View>
            </View>
          ) : null}
          {/* 汇率 + 手续费：仅兑换档需要（转账档的手续费并进金额卡右下角） */}
          {showRateField ? (
          <View style={styles.fxMetaCard}>
            {showRateField ? (
              <View style={styles.fxMetaRow} onLayout={registerFieldY('rate')}>
                <View style={styles.fxMetaPill}>
                  <Ionicons name="swap-vertical-outline" size={14} color={semantic.accentText} />
                </View>
                <AppText variant="caption" color={semantic.textSecondary} style={styles.fxRateLabel}>
                  {t('addTx.rate')}
                </AppText>
                <AppText variant="subhead" weight="600" color={semantic.textPrimary} align="right" style={styles.fxRateValue} numberOfLines={1}>
                  {exchangeRate && fromAsset && toAsset
                    ? formatRateEquation(parseFloat(exchangeRate) || 0, fromAsset.currency, toAsset.currency)
                    : '—'}
                </AppText>
              </View>
            ) : null}

            {showRateField && !exchangeRate ? (
              <AppText variant="caption2" color={semantic.textTertiary} style={styles.fxHintRow}>
                {t('addTx.receivedHint')}
              </AppText>
            ) : null}

            {showRateField ? <View style={styles.fxMetaDivider} /> : null}

            <View onLayout={registerFieldY('fee')}>
            <PressableScale
              style={styles.fxMetaRow}
              activeScale={0.98}
              onPress={() => openTransferCalculator('fee')}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.fee')}
            >
              <View style={styles.fxMetaPill}>
                <Ionicons name="receipt-outline" size={14} color={semantic.textSecondary} />
              </View>
              <AppText variant="caption" color={semantic.textSecondary} style={styles.fxRateLabel}>
                {t('addTx.fee')}
              </AppText>
              <View style={styles.fxRateValue}>
                <CursorAmountText
                  display={
                    calculatorTarget === 'fee' && amountKeypadOpen
                      ? feeExpr.displayValue || '0.00'
                      : formatMoney(feeNum, { decimals: 2 })
                  }
                  enabled={calculatorTarget === 'fee' && amountKeypadOpen}
                  cursorFromEnd={feeCursor}
                  onCursorChange={setFeeCursor}
                  style={[styles.rateGridValue, styles.fxRateValueText]}
                  onPress={() => openTransferCalculator('fee')}
                  cursorStyle={styles.feeCursor}
                />
              </View>
            </PressableScale>
            </View>
          </View>
          ) : null}

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
</ScrollView>
        </View>

        {/* 转账/兑换也使用同一套计算器；金额/汇率/手续费点击后进入这里。
            底部留白收紧(insets-32)：edge-to-edge 下根视图已延伸到导航条后面，
            再垫满 insets 会在键盘下方多出一条空位——键盘整体下移填补它 */}
        {amountKeypadOpen && (
          <View ref={footerRef} style={[styles.stickyFooter, isShort && styles.stickyFooterShort, { paddingBottom: noteOnly ? 6 : keypadBottomPad + (forceHideWanted ? 0 : tabClearance), paddingHorizontal: 0, marginBottom: keypadKeyboardLift + androidKbLift }]}>
            <AmountCalculatorKeypad
              onPressKey={handleExprKey}
              onPressToday={() => setDatePickerOpen(true)}
              selectedDate={date}
              onConfirm={handleTransferCalculatorConfirm}
              onClear={() => {
                if (calculatorTarget === 'amount') { amountExpr.reset(); setAmountCursor(0); }
                else if (calculatorTarget === 'rate') { rateExpr.reset(); setRateCursor(0); }
                else if (calculatorTarget === 'received') { receivedExpr.reset(); setReceivedCursor(0); }
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
              onNoteFocus={() => { noteFocusRef.current = true; setNoteEditing(true); }}
              onNoteBlur={() => { noteFocusRef.current = false; setNoteEditing(false); }}
              noteOnly={noteOnly}
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
            // 转账只能同币种互转（跨币种请用「兑换」页）：转出列表按转入账户币种限制，反之亦然。
            // 兑换（isExchange）不限制，保持跨币种能力。
            restrictCurrency={
              isExchange
                ? null
                : accountPickerRole === 'from'
                  ? toAsset?.currency ?? null
                  : fromAsset?.currency ?? null
            }
            currencyCode={amountCurrencyCode}
            onPickAsset={(id) => {
              // 手动选过之后不再自动跟随"默认账户"变化。
              // 注意：这里**不能**做成「再点一次＝取消选择」——转账的转出/转入都是必填项，
              // 用户点了一下当前已选的账户就变成「未选择」，保存时直接报
              // 「请选择转出与转入账户」，转账压根没记进去（2026-10-28 录屏反馈的根因）。
              userPickedFromRef.current = true;
              if (accountPickerRole === 'from') {
                setFromAssetId(id);
                // 转账：换了转出币种 → 转入账户若不是同币种就清空，用户重新选（兑换不处理）
                const picked = assets.find((a) => a.id === id);
                const toCur = assets.find((a) => a.id === toAssetId)?.currency;
                if (!isExchange && picked && toCur && picked.currency !== toCur) setToAssetId(null);
              } else {
                setToAssetId(id);
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
              // 仅留档凭证：先落盘再进表单（相机 uri 在 cache 里，会被系统清掉）
              void persistReceiptImage(photo.uri).then(setReceiptUri);
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
  // 选类别 = 盖在详情页上的整屏浮层（详情页不卸载）：点「管理类别」不用拆掉整个记一笔页，
  // 返回时也不用重建它——只挂 / 卸类别页自己，两个方向都明显更轻。
  const categoryOverlay = step === 'category' ? (
    // 与「财务规划 → 类别分类」同一份页面（components/category/CategoryPage）：
    // 玻璃组卡 + 玻璃返回钮 + 3 列网格 + 可拖 / 可删 / 可增全在共享页里，这里只做参数适配。
    // ⚠ onBack 必须回本屏的表单步骤：类别是同一屏的 step、不是独立路由，
    //   写成 navigation.goBack() 会多弹一层。
    <View style={[StyleSheet.absoluteFill, { backgroundColor: semantic.bg }]}>
      <EdgeBackSwipe onBack={edgeBackHome}>
        <CategoryPage
          selectMode
          // 类型映射与 filteredCategories 对齐（转账按支出走；本页没有第四种类型）
          initialType={type === 'transfer' ? 'expense' : type}
          onBack={() => setStep('detail')}
          onPickCategory={handlePickCategory}
          onOrderChange={({ categoryOrder: nextCatOrder, groupOrder: nextGroups }) => {
            // 共享页落库后把载荷镜像进本地 state：快捷格与「全部」抽屉按同一份顺序重排。
            // 本页不再自己写这两个存储键（键归共享页写，两处各写一份只会互相覆盖）
            setCategoryOrder(nextCatOrder);
            const mirrored: Record<string, number> = {};
            nextGroups.forEach((group, index) => {
              mirrored[group] = index;
            });
            setGroupOrder(mirrored);
          }}
        />
      </EdgeBackSwipe>
    </View>
  ) : null;

  // ---------- 支出/收入：填详情（金额为主视觉的新版排版） ----------
  return (
    <View style={{ flex: 1 }}>
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
            onSelectType={switchUiType}
            title={t('nav.add')}
            onScanPress={handleScanPress}
          />
        )}

        {/* 金额 Hero（UI V2 / 稿）：币种小胶囊 → 算式（多项时才出现，14pt 降透明）→ 64pt 金额，
            全部居中直接落在渐变上（不再是卡片）；金额点按打开自绘键盘 / 定位光标 */}
        <View style={[styles.heroArea, isShort && styles.heroAreaShort]}>

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

        {/* 币种/钱包卡 + 每月（用户 2026-11-03 二改：只重排这三个控件，其余不动）：
            左＝白色钱包卡，内含「货币按钮 → 短竖线 → 钱包信息」三个互不嵌套的热区；
            右＝独立的「每月」按钮（自带渐变底 / 描边 / 圆角），与卡同高，中间露出 8 的页面背景。
            点货币开币种、点钱包信息开账户、点每月只切换 —— 三者互不触发。 */}
        <View style={styles.walletRow}>
          <View style={[styles.walletCard, !isDark && elevation.level1]}>
            {/* 货币选择：浅蓝圆角胶囊（可点，不是静态标签） */}
            <PressableScale
              style={styles.currencyBtn}
              activeScale={0.94}
              hitSlop={0}
              onPress={() => setAssetPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.selectCurrency')}
              testID="addtx-currency-row"
            >
              <AppText variant="caption2" weight="600" color={semantic.textPrimary} numberOfLines={1}>
                {amountCurrencyCode}
              </AppText>
              <Ionicons name="chevron-down" size={11} color={semantic.textSecondary} />
            </PressableScale>
            {/* 短竖线：只占卡片中段，区分货币与钱包（不贯穿整卡高度） */}
            <View style={styles.walletDivider} />
            {/* 钱包信息：点这里开钱包（账户）选择；名称后不再重复「· 币种」 */}
            <PressableScale
              style={styles.walletInfo}
              activeScale={0.98}
              hitSlop={0}
              onPress={() => setAssetPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.selectAccount')}
              testID="addtx-account-row"
            >
              <View style={styles.walletNameRow}>
                <AppText variant="subhead" weight="500" color={semantic.textPrimary} numberOfLines={1}>
                  {selectedAsset ? selectedAsset.name : t('common.notSelected')}
                </AppText>
                <Ionicons name="chevron-down" size={14} color={semantic.textSecondary} />
              </View>
              {assetId != null && (
                <AppText variant="caption2" color={semantic.textSecondary} numberOfLines={1}>
                  {selectedAsset?.type === 'credit'
                    ? `${t('asset.creditAvailableShort')} ${formatMoney(getAssetDisplayBalance(selectedAsset, getAssetBalance(assetId)))}`
                    : `${t('addTx.availableBalance')} ${formatMoney(getAssetBalance(assetId))}`}
                </AppText>
              )}
            </PressableScale>
          </View>
          {!isEditing && (
            <PressableScale
              style={[styles.monthlyTouch, !isDark && elevation.level1]}
              activeScale={0.94}
              hitSlop={0}
              onPress={() => {
                hapticLight();
                setAutoMonthly((v) => !v);
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: autoMonthly }}
              accessibilityLabel={t('finance.monthlyLabel')}
              testID="addtx-monthly-toggle"
            >
              <LinearGradient
                colors={
                  autoMonthly
                    ? [semantic.accent, withAlpha(semantic.accent, 0.86)]
                    : [withAlpha(semantic.accent, 0.2), withAlpha(semantic.accent, 0.06)]
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={[styles.monthlyBtn, { borderColor: withAlpha(semantic.accent, autoMonthly ? 0.5 : 0.22) }]}
              >
                <Ionicons name="repeat-outline" size={18} color={autoMonthly ? semantic.onAccent : semantic.accentText} />
                <AppText variant="caption" weight="600" color={autoMonthly ? semantic.onAccent : semantic.accentText} numberOfLines={1}>
                  {t('finance.monthlyLabel')}
                </AppText>
              </LinearGradient>
            </PressableScale>
          )}
        </View>

        {/* 类别（T15 / V2）：列数取版型；格 = 42 立体球图标 + 12pt 标签；网格区可滚动，「全部」永远殿后。
            定稿里没有「类别：xxx」提示行（选中态由外圈表达）→ 整行删掉，高度让给网格：
            390×844 露出 3 行（15 格，与稿一致），360×640 至少 2 行 */}
        <ScrollView
          style={styles.catGridScroll}
          contentContainerStyle={[styles.catGridContent, isShort && styles.catGridContentShort]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // 用户 2026-10-30：网格不许滚动，屏幕能放多少行就放多少行
          scrollEnabled={false}
          onLayout={(e) => {
            // 实测网格区可见高度 → 决定铺多少行（至少 1 行，不封顶）
            const h = e.nativeEvent.layout.height;
            // 安卓备注聚焦：面板上抬会临时压矮网格区，此时冻结行数测量，别把类别裁成一行
            if (noteOnly) return;
            setGridH((prev) => {
              if (prev != null && Math.abs(prev - h) <= 0.5) return prev;
              setGridRowAdjust(0); // 屏高变了，重新从估算值开始收敛
              return h;
            });
          }}
          onContentSizeChange={(_w, h) => {
            if (gridH == null || h <= 0 || noteOnly) return;
            // 实测行高 = 内容高 / 已铺行数（含末尾「全部」那格）
            const rows = Math.max(1, Math.ceil((gridCategories.length + 1) / gridColumns));
            const rowH = h / rows;
            if (h > gridH + 1) {
              // 溢出 → 少一行
              if (gridRowAdjust > -3) setGridRowAdjust((a) => a - 1);
            } else if (h + rowH <= gridH + 1) {
              // 还塞得下一整行 → 多一行
              if (gridRowAdjust < 3) setGridRowAdjust((a) => a + 1);
            }
          }}
        >
          {/* 每格外包一层 View 承载百分比宽度 —— RN Web 里百分比宽度必须落在 flex 直接子项上
              （PressableScale 的 Pressable 宽度是内容自适应，百分比给不到它内部那层） */}
          {gridCategories.map((c) => {
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
          ref={footerRef}
          style={[styles.stickyFooter, isShort && styles.stickyFooterShort, { paddingBottom: noteOnly ? 6 : keypadBottomPad + (forceHideWanted ? 0 : tabClearance), paddingHorizontal: 0, marginBottom: keypadKeyboardLift + androidKbLift }]}
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
            onNoteFocus={() => { noteFocusRef.current = true; setNoteEditing(true); }}
            onNoteBlur={() => { noteFocusRef.current = false; setNoteEditing(false); }}
              noteOnly={noteOnly}
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
            // 仅留档凭证：先落盘再进表单（相机 uri 在 cache 里，会被系统清掉）
            void persistReceiptImage(photo.uri).then(setReceiptUri);
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
            // 选中即刻记住（万一这次最后没保存，也仍然记得上次用的钱包）
            rememberRecentAsset(uiType === 'income' ? 'income' : 'expense', id);
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
    {categoryOverlay}
    </View>
  );
}

// 关键：样式表要写成函数，接收 colors，返回 StyleSheet
function makeStyles(colors: ThemeColors, isDark: boolean, semantic: SemanticColors, spacing: Spacing, layout: Layout, radius: Radius) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: semantic.bg },
  scanningWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanningText: { marginTop: 16, color: colors.textSecondary, fontSize: 14 },

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
  // 行容器：左＝钱包卡（吃掉剩余宽度），右＝固定 60 的「每月」按钮；中间 8 露出页面背景。
  // 左右边距取 20（= 备注栏 / 数字键盘 stickyFooter 的内容边），整排与下方键盘块同一条竖线
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    marginHorizontal: spacing.xl,
    marginTop: spacing.sm,
  },
  // 钱包卡：surface 白底 + 14 圆角 + 48 高；内部「货币按钮 / 短竖线 / 钱包信息」横排
  walletCard: {
    flex: 1,
    minWidth: 0,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: semantic.surface,
  },
  // 货币选择：浅蓝圆角胶囊（56×30）—— 可点，不是静态标签
  currencyBtn: {
    width: 56,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 2,
    borderRadius: radius.sm,
    backgroundColor: semantic.accentSoft,
  },
  // 短竖线：卡片高度中段 20，不贯穿整卡
  walletDivider: { width: 1, height: 20, backgroundColor: semantic.hairline },
  // 钱包信息：两行左对齐、整体垂直居中，吃掉卡片剩余宽度（窄屏由 numberOfLines 兜底）
  walletInfo: { flex: 1, minWidth: 0, justifyContent: 'center', rowGap: 1 },
  walletNameRow: { flexDirection: 'row', alignItems: 'center', columnGap: 2 },
  // 金额那一行：币种贴左、每月开关贴右（与账户卡 / 类别网格同一条左右边界）
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // 父容器 heroArea 是居中列，不给 stretch 这行就只占内容宽，space-between 等于没生效
    alignSelf: 'stretch',
    paddingHorizontal: spacing.sm,
  },
  // 「每月」：独立按钮，固定 60×48（与钱包卡同高）；
  // 阴影放在外层（内部渐变半透明，Android 阴影从元件内侧透出的老问题要避开）
  monthlyTouch: { width: 60, height: 48, borderRadius: radius.sm },
  // 渐变 / 描边 / 圆角都落在这一层；图标在上、文字在下，上下排列居中
  monthlyBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
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
    // 铺不满可用高度时（比如只放得下 2 行），整块网格在剩余空间里**垂直居中**，
    // 而不是贴顶把空白全堆在下面（用户 2026-10-30 截图反馈）
    flexGrow: 1,
    alignContent: 'center',
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
  // minWidth：三位的汇率（如 ÷0.3125 兑）也留得下，同时保证可点宽度不小于 104
  rateCenterCellWrap: { minWidth: 104, alignItems: 'stretch' },
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
  // 汇率格：可点区域撑满中间这一列（原来只有文字宽，真机上很难点中）
  rateCenterCell: {
    alignSelf: 'stretch',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rateCenterLabel: { marginBottom: spacing.xs },
  // 汇率数值：accentText 强调色，保持"这里能点"的视觉权重
  rateFieldValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'], color: semantic.accentText },
  exchangeRateDivider: { height: StyleSheet.hairlineWidth, backgroundColor: semantic.hairline, marginTop: spacing.md },
  // 汇率来源状态行：网格与手续费行之间的一行小字，点它 = 重新拉取汇率
  rateStatusRow: { marginTop: spacing.sm, paddingVertical: spacing.xs, alignItems: 'center' },
  // 汇率格下方的一行含义说明（不占交互，只是把方向讲清楚）
  rateCenterHint: { marginTop: 2, textAlign: 'center' },
  // 汇率格下方：÷ / × 两个候选结果并排，当前档加重
  rateModeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', columnGap: 10, marginTop: 2 },
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
  // ---------- 兑换记录（参照新设计稿）：从 / 兑换为 大金额卡 + 汇率条 ----------
  fxSectionLabel: { marginTop: spacing.md, marginBottom: spacing.xs, marginLeft: layout.page },
  fxAmountCard: {
    marginHorizontal: layout.page,
    paddingHorizontal: layout.card,
    paddingVertical: spacing.md,
    minHeight: 124,
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: radius.md,
    backgroundColor: semantic.surface,
  },
  fxAccountRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm, minHeight: 44 },
  fxAccountName: { flex: 1, minWidth: 0 },
  fxChevron: { marginLeft: 'auto' },
  // 金额可点区：44 号字约 49px 高、64 号更高 —— 盒子必须比字大，否则点数字上半部会落空
  // 金额可点区：铺满卡片剩余空间（点数字、点数字周围的空白都算）
  fxBigAmountTouch: { flex: 1, minHeight: 60, justifyContent: 'center', paddingVertical: spacing.xs },
  fxBigAmount: { fontSize: 34, fontWeight: '700', color: semantic.textPrimary },
  fxBigAmountTo: { color: semantic.amountIncome },
  fxBigAmountToText: { fontVariant: ['tabular-nums'] },
  fxBigAmountMuted: { color: semantic.textTertiary },
  // 正在输入的那张卡：蓝描边（与光标同色，两侧一致）
  fxCardActive: { borderColor: semantic.accent },
  fxAmountLine: { flexDirection: 'row', alignItems: 'baseline', columnGap: spacing.xs, minHeight: 56 },
  fxCardLabel: { marginBottom: spacing.xs },
  fxBalanceInline: {
    marginLeft: 'auto',
    marginRight: spacing.sm,
    flexShrink: 0,
    fontSize: 16,
    fontWeight: '600',
    color: semantic.textPrimary,
  },
  fxFeeInlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.xs,
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: semantic.hairline,
  },
  fxFeeSpacer: { flex: 1 },
  // 卡外小标题：贴在上方卡片 8，左右与卡片对齐
  fxOuterLabel: { marginTop: spacing.md, marginBottom: spacing.xs, marginLeft: layout.page },
  // 转账档：钱包卡只放「标题 + 钱包 + 余额」，不需要 124 的金额高度
  fxWalletCard: { minHeight: 0, paddingVertical: spacing.sm },
  fxAmountCardCompact: { minHeight: 0, paddingVertical: spacing.sm },
  fxBalanceLine: { marginTop: spacing.xs, marginLeft: 42 },
  fxAmountFill: { flex: 1 },
  fxClearBtn: {
    alignSelf: 'center',
    marginLeft: spacing.xs,
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: semantic.surfaceSunken,
  },
  fxAmountCurrency: { marginBottom: spacing.xs },
  // 按钮咬进上下两张卡：48 高、上下各 -18 ⇒ 卡间净剩 12
  // 44 高 + 上下 -22：净占 0，按钮整体跨在接缝上，且热区不被父级裁剪
  // 咬合接缝：卡片直边间距 26；凹口圆 r=26、按钮 r=22，同心 ⇒ 按钮上下各重叠 9、凹口留 4px 背景
  fxPairWrap: { position: 'relative', marginHorizontal: layout.page },
  fxPairSvg: { position: 'absolute', left: 0, top: 0 },
  fxPairCard: {
    marginHorizontal: 0,
    marginLeft: 0,
    marginRight: 0,
    minHeight: 0,
    borderWidth: 0,
    paddingVertical: 0,
    justifyContent: 'center',
    backgroundColor: 'transparent',
    zIndex: 1,
  },
  fxGapBand: { height: 24, justifyContent: 'center', zIndex: 2 },
  fxGapLabel: { marginLeft: 0 },
  // 定位层：普通 View，只负责 absolute 定位，不带任何背景/圆盘/阴影
  fxSwapSlot: { position: 'absolute', left: '50%', marginLeft: -22, top: -10, width: 44, height: 44, zIndex: 3 },
  fxSeamRow: {
    height: 44,
    marginTop: -18,
    marginBottom: -18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.page,
    zIndex: 2,
  },
  fxSeamHair: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 18,
    height: StyleSheet.hairlineWidth,
    backgroundColor: semantic.hairline,
  },
  fxSeamBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 渐变面：严格铺在既有 44 圆内（不放大、不加外圈、不碰凹口）
  fxSeamFace: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fxSeamArrows: { flexDirection: 'row', alignItems: 'center', columnGap: 2 },
  fxSwapCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: semantic.surface,
    borderWidth: 1,
    borderColor: semantic.hairline,
  },
  fxSwapWrap: { alignItems: 'center', marginTop: -spacing.lg, marginBottom: -spacing.lg, zIndex: 1 },
  fxRateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    minHeight: 44,
    marginHorizontal: layout.page,
    marginTop: spacing.sm,
    paddingHorizontal: layout.card,
    borderRadius: radius.md,
    backgroundColor: semantic.surface,
  },
  fxRateLabel: { flexShrink: 0 },
  fxMetaCard: {
    marginHorizontal: layout.page,
    marginTop: spacing.md,
    paddingHorizontal: layout.card,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: semantic.surface,
  },
  fxMetaRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm, minHeight: 44 },
  fxMetaPill: {
    width: 26,
    height: 26,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: semantic.brandSoft,
  },
  fxMetaDivider: { height: StyleSheet.hairlineWidth, backgroundColor: semantic.hairline },
  fxRateValue: { flex: 1 },
  fxRateValueText: { textAlign: 'right' },
  fxHintRow: { marginLeft: 34, marginTop: -spacing.xs, marginBottom: spacing.xs },

  });
}
