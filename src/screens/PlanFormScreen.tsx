// 计划付款 新增/编辑 整页表单(路由:财务规划编辑):
// 与添加资产账户同模式——route.params.planId 有值 = 编辑,无 = 新增。
// 布局(自上而下):1.类型(固定支出/固定收入) 2.计划名称 3.金额(自绘计算器)+关联账户(底部上拉)
// 4.扣账周期固定"每月"(月结:结算日 = 起始日的"日"),只提供日期范围选择开始日期。
// 编辑模式额外有暂停开关与删除按钮;旧的每周/每年周期与扣账日字段已移除。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Dimensions,
  Keyboard,
  Pressable,
  BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import Reanimated, { useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, withTiming, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import PressableScale from '../components/PressableScale';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/useTheme';
import type { Elevation, SemanticColors, ThemeColors } from '../theme/theme';
import { useT } from '../i18n/LanguageContext';
import DateRangePickerSheet from '../components/DateRangePickerSheet';
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { CursorAmountText } from '../components/CursorAmountText';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { getAssetDisplayBalance } from '../utils/creditCard';
import { formatMoney } from '../utils/formatMoney';
import { getCategoryLabel } from '../i18n/categories';
import { hapticSuccess, hapticWarning } from '../utils/haptics';
import { ROUTES } from '../navigation/routes';
import { GlassView, HeroGradient } from '../components/ui';

/** 页面顶部品牌渐变高度（本页没有定稿图，按 V2 同一套元素取 360，矮屏 ×0.9） */
const HERO_HEIGHT = 360;

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PlanFormScreen({ route, navigation }: any) {
  const { addPaymentPlan, updatePaymentPlan, deletePaymentPlan, assets, activeAssets, paymentPlans, activeLedgerId, categories, currency, getAssetBalance, decimalPlaces } = useApp();
  const { colors, semantic, elevation } = useTheme();
  const tr = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const insets = useSafeAreaInsets();
  // 渐变高度：844 高屏 360，矮屏 ×0.9（UI V2 第 1 节）
  const heroHeight = Math.round(HERO_HEIGHT * (Dimensions.get('window').height - insets.top < 700 ? 0.9 : 1));
  const isFocused = useIsFocused();
  const setTabBarForceHidden = useTabBarForceHide();
  const styles = useMemo(() => makeStyles(colors, semantic, elevation), [colors, semantic, elevation]);

  const editPlan = route?.params?.planId ? paymentPlans.find((p) => p.id === route.params.planId) : undefined;
  const isEdit = !!editPlan;
  const today = new Date();

const [type, setType] = useState<'expense' | 'income'>(editPlan?.type ?? 'expense');
  const [name, setName] = useState(editPlan?.name ?? '');
  // 金额：自绘计算器（与记一笔同一套）。amountExpr 管算式，amountValue 存已确认的最终值
  const amountExpr = useAmountExpression();
  const [amountValue, setAmountValue] = useState(editPlan?.amount ?? 0);
  const [keypadOpen, setKeypadOpen] = useState(false);
  // 金额格自绘光标（距显示串尾部的偏移，0=最末尾）：键盘开着时按键在光标处生效
  const [amountCursor, setAmountCursor] = useState(0);
  const [assetId, setAssetId] = useState<string | undefined>(editPlan?.assetId);
  // 关联分类（名称旁按钮 → 跳转"类别分类"选择页，点分类带回结果）；不选时保存兜底到"其他"
  const [categoryId, setCategoryId] = useState<string | null>(editPlan?.categoryId ?? null);
  // 扣账周期固定"每月"（月结）：扣账日 = 开始日期的"日"。只提供单日选择开始日期
  const [rangeStart, setRangeStart] = useState(editPlan?.startDate ?? fmt(today));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [active, setActive] = useState(editPlan?.active ?? true);
  // 账户底部上拉菜单
  const [assetSheetOpen, setAssetSheetOpen] = useState(false);
  // 账户弹层筛选状态（与记一笔账户弹层同款交互）
  const [assetSearch, setAssetSearch] = useState('');
  const [assetFilter, setAssetFilter] = useState<'all' | 'cash' | 'bank' | 'credit' | 'ewallet'>('all');
  // TASK-025：账户弹层币种分组（资产页内联菜单式）——反向记录「被收起」的组，默认全展开
  const [pickerCollapsedGroups, setPickerCollapsedGroups] = useState<Set<string>>(new Set());
  const togglePickerGroup = (code: string) => {
    setPickerCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };
  // 币种直选（与记一笔弹层同款）：ALL 键点开的下拉面板 + 当前币种筛选
  const [assetCurrencyDropOpen, setAssetCurrencyDropOpen] = useState(false);
  const [assetCurrencyFilter, setAssetCurrencyFilter] = useState<string>('all');
  // 金额币种只认所选账户（2026-09-24 用户定版）：弹层币种项只做账户筛选，
  // 不再直选改金额币种（displayCurrencyCode 联动机制已移除——撤销第七十八节的直选联动）
  // 自己已有的币种集合（账户里出现过的币种，去重、ABC 字母序——2026-09-24 用户定版），供 ALL 下拉面板列出
  const ownCurrencies = useMemo(() => {
    const codes: string[] = [];
    activeAssets.forEach((a) => {
      if (a.currency && !codes.includes(a.currency)) codes.push(a.currency);
    });
    return codes.sort((c1, c2) => c1.localeCompare(c2));
  }, [activeAssets]);

  // —— 账户弹层下滑收起手势：与记一笔账户弹层完全同款（manualActivation Pan + sharedValue 动画）——
  // - 列表滚到顶部时往下拖 → 接管手势，整块面板跟手下移，松手超过 120px / 快速甩动就收起
  // - 列表不在顶部、或往上拖 → 不接管，账户列表照常滚动；从把手/头部下滑永远生效
  const sheetPanY = useSharedValue(0);
  const sheetScrim = useSharedValue(0);
  const sheetListOffset = useSharedValue(0);
  const sheetListScrollHandler = useAnimatedScrollHandler((e) => {
    sheetListOffset.value = e.contentOffset.y;
  });
  const sheetDragStart = useSharedValue({ x: 0, y: 0 });
  const sheetClosingSV = useSharedValue(false);
  const closeAssetSheet = () => {
    setAssetSheetOpen(false);
    setAssetCurrencyDropOpen(false);
  };
  const sheetGesture = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e) => {
      const t = e.allTouches[0];
      sheetDragStart.value = { x: t?.absoluteX ?? 0, y: t?.absoluteY ?? 0 };
    })
    .onTouchesMove((e, stateManager) => {
      const t = e.allTouches[0];
      if (!t) return;
      if (sheetListOffset.value > 0) return; // 列表不在顶部：不接管，让它正常滚
      const dy = t.absoluteY - sheetDragStart.value.y;
      const dx = t.absoluteX - sheetDragStart.value.x;
      if (dy > 12 && Math.abs(dy) > Math.abs(dx) * 1.2) stateManager.activate();
    })
    .onUpdate((e) => {
      sheetPanY.value = Math.max(0, e.translationY);
      sheetScrim.value = Math.min(0.4, Math.max(0, e.translationY) / 500 + 0.15);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        if (sheetClosingSV.value) return;
        sheetClosingSV.value = true;
        sheetScrim.value = withTiming(0, { duration: 180 });
        sheetPanY.value = withTiming(900, { duration: 220 }, (finished) => {
          if (finished) runOnJS(closeAssetSheet)();
        });
      } else {
        sheetPanY.value = withTiming(0, { duration: 180 });
        sheetScrim.value = withTiming(0.4, { duration: 150 });
      }
    });
  const sheetAnimStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetPanY.value }] }), []);
  const sheetScrimStyle = useAnimatedStyle(() => ({ opacity: sheetScrim.value }), []);
  // 入场：面板从屏幕外滑入 + 遮罩淡入；列表滚动偏移一并清零
  useEffect(() => {
    if (assetSheetOpen) {
      sheetClosingSV.value = false;
      sheetPanY.value = 900;
      sheetScrim.value = 0;
      sheetListOffset.value = 0;
      sheetPanY.value = withTiming(0, { duration: 260 });
      sheetScrim.value = withTiming(0.4, { duration: 260 });
    }
  }, [assetSheetOpen, sheetPanY, sheetScrim, sheetListOffset]);

  const selectedAsset = assets.find((a) => a.id === assetId);
  const selectedCategory = categories.find((c) => c.id === categoryId);

  // 本页面（添加/编辑计划）**永远不显示底部导航栏**：它是从"财务规划"push 进来的二级
  // 编辑页，语义与"添加资产账户"一致——整页表单不该有 Tab 栏。
  // 注意两个坑：
  // 1) 失焦时【不放栏】——goBack 回财务规划的转场里，本页失焦 effect 会排在
  //    财务规划的"聚焦隐藏"之后执行，若在失焦分支里放栏，会把刚设好的隐藏又覆盖掉
  //    （这就是"返回财务规划时导航栏跑出来"的根源）。放栏只在【卸载】时做。
  // 2) 日期面板关闭时它内部的 cleanup 会放栏——依赖里保留 keypadOpen/datePickerOpen
  //    让本 effect 重跑一次把栏重新压下去。
  useEffect(() => {
    if (isFocused) setTabBarForceHidden(true);
  }, [isFocused, keypadOpen, datePickerOpen, setTabBarForceHidden]);
  // 只有真正卸载（goBack 离开页面）才交还控制权
  useEffect(() => {
    return () => setTabBarForceHidden(false);
  }, []);

  // 打开计算器面板：带入已确认的金额继续编辑（不清零）——只有用户主动按退格/清除才从空态起输。
  // 之前每次打开都 reset() 成空态，已填的 5000 点开面板瞬间就被清掉，是"点金额清 0"bug 的根因
  useEffect(() => {
    if (keypadOpen) {
      amountExpr.reset(amountValue > 0 ? amountValue : undefined);
      setAmountCursor(0); // 打开键盘光标从最末尾开始
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypadOpen]);

  // 键盘互斥（标准：同一时间只允许一个键盘）：系统键盘弹出时收起自绘计算器面板。
  // 打开自绘面板的反向路径已在 openAmountKeypad 里 Keyboard.dismiss()
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeypadOpen(false);
    });
    return () => showSub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android 返回键：先关真正的弹层（账户弹层、日期选择）；自绘键盘不被返回键收起（键盘上有保存键），
  // 其余情况不拦截，导航器直接退出本页
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (assetSheetOpen) {
        closeAssetSheet();
        return true;
      }
      if (datePickerOpen) {
        setDatePickerOpen(false);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [assetSheetOpen, datePickerOpen]);

  // 计算器面板收起时（无论路径：按"完成"、点系统键盘、点其他输入框）把面板当前值求值落回
  // amountValue——之前只有按"完成"才落回，切输入框触发 keyboardDidShow 直接关面板，
  // 已输入的值没保存，金额显示跳回 0（bug 根因）。amountExpr.confirm() 求值并复位算式
  const commitAmount = () => {
    const v = amountExpr.confirm();
    setAmountValue(v);
  };
  // 只在"从开变关"时落回：用 ref 记住上一次的 keypadOpen——首次挂载（编辑页进来
  // keypadOpen 本来就是 false）绝不能跑 commitAmount，否则空算式求值成 0 把 editPlan 的
  // 金额冲掉（"进编辑页金额变 0"的 bug 根因）
  const prevKeypadOpen = useRef(keypadOpen);
  useEffect(() => {
    if (prevKeypadOpen.current && !keypadOpen) {
      commitAmount();
    }
    prevKeypadOpen.current = keypadOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keypadOpen]);

  // 计算器面板上"完成"：求值落回金额并收起面板（收起 effect 会再兜底一次，幂等无害）
  const handleKeypadConfirm = () => {
    const v = amountExpr.confirm();
    setAmountValue(v);
    setKeypadOpen(false);
    // 与"保存"键同功能：资料齐全时点自绘键盘的「完成」直接保存
    // （校验在 handleSave 内部：名称/金额缺失会弹提示，不会误存）
    handleSave(v);
  };
  const amountDisplay = keypadOpen ? amountExpr.displayValue : amountValue > 0 ? formatMoney(amountValue, { decimals: decimalPlaces }) : '0';
  // 规划金额字号：按位数渐缩（与记一笔 Hero 同思路）——34 起、每超 6 位 -0.5px、下限 28
  const planAmountFontSize = Math.max(28, 34 - Math.max(0, amountDisplay.replace('.', '').length - 6) * 0.5);

  const amountFieldYRef = useRef(0);
  const scrollViewRef = useRef<ScrollView>(null);
  const registerAmountFieldY = (y: number) => {
    amountFieldYRef.current = y;
  };
  // 金额框点击：打开计算器并把金额框滚到屏幕中心（"填写金额屏幕中心点 Focus 在金额侧"）。
  // 键盘互斥（标准：同一时间只允许一个键盘）——打开自绘键盘前先收起系统键盘
  const openAmountKeypad = () => {
    Keyboard.dismiss();
    setKeypadOpen(true);
    const visibleH = Dimensions.get('window').height - insets.top;
    const targetOffset = Math.max(amountFieldYRef.current - visibleH / 2, 0);
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({ y: targetOffset, animated: true });
    });
  };

  const handleDelete = () => {
    if (!editPlan) return;
    dialog.alert({
      title: tr('finance.deletePlan'),
      message: tr('finance.deletePlanMsg'),
      buttons: [
        { text: tr('finance.cancel'), style: 'cancel' },
        {
          text: tr('finance.delete'),
          style: 'destructive',
          onPress: () => {
            hapticWarning();
            void deletePaymentPlan(editPlan.id);
            navigation.goBack();
          },
        },
      ],
    });
  };

  // amountOverride：自绘键盘「完成」直接保存时传入刚求值的金额——setAmountValue 是异步的，
  // 不传的话 handleSave 同步读到的还是旧 state
  const handleSave = (amountOverride?: number) => {
    const finalAmount = amountOverride ?? amountValue;
    if (!name.trim()) {
      dialog.alert({ title: tr('finance.planNameRequired') });
      return;
    }
    if (finalAmount <= 0) {
      dialog.alert({ title: tr('finance.planAmountRequired') });
      return;
    }
    const payload = {
      name: name.trim(),
      amount: finalAmount,
      type,
      // 关联分类；未选时兜底到"其他"（支出/收入各自的"其他"分类）
      categoryId: categoryId ?? (type === 'income' ? 'other_income' : 'other_expense'),
      // 扣账周期固定"每月"（月结）：扣账日 = 开始日期的"日"（1-31，超出当月天数时引擎兜底为当月最后一天）
      cycle: 'monthly' as const,
      dayOfMonth: Math.min(31, Math.max(1, Number(rangeStart.split('-')[2]) || 1)),
      startDate: rangeStart,
      // 到点自动入账（固定 true，页面不再提供开关）
      autoDeduct: true,
      active,
      assetId,
    };
    if (isEdit && editPlan) {
      void updatePaymentPlan(editPlan.id, payload);
    } else {
      void addPaymentPlan({ ...payload, ledgerId: activeLedgerId } as any);
    }
    hapticSuccess();
    navigation.goBack();
  };

  // 金额币种只认所选账户：跟随关联账户；没关联账户时跟随 App 全局货币设置（不再硬编码 MYR）
  const amountCurrency = selectedAsset?.currency ?? currency;

  return (
    // UI V2：整页通顶 —— 顶部品牌渐变（360 / 矮屏 ×0.9）压在内容下面，页头落在渐变上
    <SafeAreaView style={styles.container} edges={[]}>
      <HeroGradient height={heroHeight} />
      {/* 头部（V2）：玻璃圆返回键 + 白色标题 + (编辑模式)玻璃圆删除；入口与行为一字未动 */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <PressableScale onPress={() => navigation.goBack()} activeScale={0.94} hitSlop={0}>
          <GlassView radius={999} style={styles.glassHeaderBtn}>
            <Ionicons name="chevron-back" size={18} color={semantic.onAccent} />
          </GlassView>
        </PressableScale>
        <Text style={styles.headerTitle}>{isEdit ? tr('finance.editPlan') : tr('finance.addPlan')}</Text>
        {isEdit ? (
          <PressableScale onPress={handleDelete} activeScale={0.94} hitSlop={0}>
            <GlassView radius={999} style={styles.glassHeaderBtn}>
              <Ionicons name="trash-outline" size={18} color={semantic.onAccent} />
            </GlassView>
          </PressableScale>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 第1层：固定支出 / 固定收入（不加大标题，直接分段选择，贴住顶栏） */}
        <View style={styles.segRow}>
          {(['expense', 'income'] as const).map((tp) => (
            <PressableScale
              key={tp}
              style={[styles.segBtn, type === tp && styles.segBtnActive]}
              activeScale={0.95}
              onPress={() => {
                setType(tp);
                // 切换类型时，已选分类若与新类型不匹配则清空（支出/收入分类各自独立）
                setCategoryId((prev) => (prev && categories.find((c) => c.id === prev)?.type !== tp ? null : prev));
              }}
            >
              <Text style={[styles.segText, type === tp && styles.segTextActive]}>
                {tp === 'expense' ? tr('finance.typeExpense') : tr('finance.typeIncome')}
              </Text>
            </PressableScale>
          ))}
        </View>

        {/* 第2层：金额（点按调出计算器并滚到屏幕中心） */}
        <View onLayout={(e) => registerAmountFieldY(e.nativeEvent.layout.y)}>
          <Text style={styles.formLabel}>{tr('finance.planAmount')}</Text>
          <PressableScale style={styles.amountBox} activeScale={0.98} onPress={openAmountKeypad}>
            <View style={{ flex: 1 }}>
              <Text style={styles.amountBoxLabel}>{tr('finance.planAmount')}</Text>
              <View style={styles.amountBoxRow}>
                <Text style={styles.amountBoxCurrency}>{amountCurrency}</Text>
                {/* 金额可定位光标（字号按位数渐缩）：键盘开着时点按/长按拖动移动光标，
                    按键在光标处插入/删除；键盘收起时只显示已确认金额、点按回落 openAmountKeypad */}
                <CursorAmountText
                  containerStyle={styles.amountBoxValueWrap}
                  style={[styles.amountBoxValue, { fontSize: planAmountFontSize }]}
                  cursorStyle={styles.amountBoxCursor}
                  display={amountDisplay}
                  enabled={keypadOpen}
                  cursorFromEnd={amountCursor}
                  onCursorChange={setAmountCursor}
                  onPress={openAmountKeypad}
                />
              </View>
            </View>
            <Ionicons name="pencil" size={15} color={colors.link} />
          </PressableScale>
        </View>

        {/* 第3层：计划名称（右）+ 类别选择按钮（名称旁，底部弹层选择） */}
        <Text style={styles.formLabelTight}>{tr('finance.planName')}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput
            style={[styles.formInput, { flex: 1, color: colors.textPrimary }]}
            value={name}
            onChangeText={setName}
            placeholder={tr('finance.planNamePlaceholder')}
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.link}
            returnKeyType="done"
          />
          {/* 类别选择框：与名称输入框 50%/50% 等分，文字标注显示已选分类名（未选显示"选择分类"）；
              点击进入"类别分类"选择模式，点分类后经 onPickCategory 回调带回结果并自动退出选择页 */}
          <PressableScale
            style={[styles.categoryBtn, selectedCategory && { borderColor: selectedCategory.color + '66' }]}
            activeScale={0.98}
            onPress={() => navigation.navigate(ROUTES.CATEGORY_MGMT, {
              selectMode: true,
              // TASK-020 纠偏：带上表单当前类型——之前没传，固定收入计划进选择页只会看到支出分类
              initialType: type,
              onPickCategory: (id: string) => setCategoryId(id),
            })}
          >
            <View
              style={[styles.categoryBtnDot, { backgroundColor: (selectedCategory?.color ?? colors.textTertiary) + '33' }]}
            >
              <Ionicons
                name={(selectedCategory?.icon as any) ?? 'apps-outline'}
                size={14}
                color={selectedCategory?.color ?? colors.textTertiary}
              />
            </View>
            <Text
              style={[styles.categoryBtnText, { color: selectedCategory ? colors.textPrimary : colors.textTertiary }]}
              numberOfLines={1}
            >
              {selectedCategory ? getCategoryLabel(selectedCategory, tr) : tr('finance.selectCategory')}
            </Text>
          </PressableScale>
        </View>

        {/* 第4层：关联账户（左）+ 开始日期（右，single 模式只选一个日期）左右各 50%；
            月结扣账日 = 开始日期的"日"；与上方留白收紧 */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>{tr('finance.linkAsset')}</Text>
            <PressableScale
              style={[styles.formInput, styles.formReadonlyField]}
              activeScale={0.98}
              onPress={() => setAssetSheetOpen(true)}
            >
              {/* 币种用代码小芯片（不用国旗 emoji：部分安卓机型只渲染成两个字母） */}
              {selectedAsset && (
                <View style={styles.currencyChip}>
                  <Text style={styles.currencyChipText}>{selectedAsset.currency}</Text>
                </View>
              )}
              <Text
                style={{ flex: 1, color: selectedAsset ? colors.textPrimary : colors.textTertiary, fontSize: 14, marginLeft: selectedAsset ? 6 : 0 }}
                numberOfLines={1}
              >
                {selectedAsset?.name ?? tr('addTx.notSelectedShort')}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.textTertiary} />
            </PressableScale>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.formLabel}>{tr('finance.startDate')}</Text>
            <PressableScale
              style={[styles.formInput, styles.formReadonlyField]}
              activeScale={0.98}
              onPress={() => setDatePickerOpen(true)}
            >
              <Text style={{ color: colors.textPrimary, fontSize: 14 }} numberOfLines={1}>{rangeStart}</Text>
              <Ionicons name="calendar-outline" size={16} color={colors.textTertiary} />
            </PressableScale>
          </View>
        </View>

        {/* 计划状态开关(编辑模式)：开=生效中、关=已暂停——标签描述状态而不是矛盾的反义 */}
        {isEdit && (
          <PressableScale style={[styles.autoDeductRow, { marginTop: 8 }]} activeScale={0.98} onPress={() => setActive((v) => !v)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.textPrimary }}>
                {tr('finance.planStatusLabel')}
              </Text>
              <Text style={{ fontSize: 11, color: active ? colors.link : colors.textTertiary, marginTop: 1 }}>
                {active ? tr('finance.planStatusOn') : tr('finance.planStatusOff')}
              </Text>
            </View>
            <View style={[styles.switchTrack, active && { backgroundColor: colors.link }]}>
              <View style={[styles.autoKnob, active && styles.autoKnobOn]} />
            </View>
          </PressableScale>
        )}
      </ScrollView>

      {/* 保存按钮：计算器键盘开着时让位给键盘面板（同一底部位置），关了再回来 */}
      {!keypadOpen && (
        <View style={[styles.saveFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <PressableScale style={styles.saveBtn} onPress={() => handleSave()} activeScale={0.97}>
            <Text style={styles.saveBtnText}>{tr('finance.save')}</Text>
          </PressableScale>
        </View>
      )}

      {/* 金额计算器键盘（与记一笔同一套；「完成」＝求值落回金额框）。
          底部留白收紧(insets-40)：edge-to-edge 下根视图已延伸到导航条后面，
          再垫满 insets 会在键盘下方多出一条空位——键盘整体贴住屏幕底 */}
      {keypadOpen && (
        <View
          style={[
            styles.keypadFooter,
            {
              paddingBottom: Math.max(insets.bottom - 40, 8),
              backgroundColor: colors.card,
              borderTopColor: colors.dividerHair,
            },
          ]}
        >
          <AmountCalculatorKeypad
            onPressKey={(key) => setAmountCursor(amountExpr.pressKeyAt(key, amountCursor))}
            onPressToday={() => {}}
            onClear={() => { amountExpr.reset(); setAmountCursor(0); }}
            onConfirm={handleKeypadConfirm}
          />
        </View>
      )}

      {/* 账户选择：与记一笔的账户弹层完全同款——树内覆盖层（不用 RN Modal：Modal 接不了下滑手势）+
          把手条 + 头部（选择账户 + ALL 币种直选键 + ✕）+ 币种下拉面板 + 搜索 + 类型筛选芯片 +
          账户行（图标/名称/余额/选中勾）+ 有框「添加新账户」；下滑收起手势与记一笔同一套 */}
      {assetSheetOpen && (
        <View style={[StyleSheet.absoluteFill, { zIndex: 90, elevation: 90 }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeAssetSheet}>
            <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: semantic.scrim }, sheetScrimStyle]} />
          </Pressable>
          <GestureDetector gesture={sheetGesture}>
            <Reanimated.View style={[styles.sheetCard, sheetAnimStyle]}>
            {/* 把手条：与记一笔 accountPickerGrabber 同款 */}
            <View style={styles.sheetGrabber} />
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetTitle}>{tr('addTx.selectAccount')}</Text>
              <View style={styles.sheetHeaderRight}>
                {/* 货币直选键：点开币种下拉，点选只显示该币种的账户；按键文字跟随当前筛选（全部→ALL） */}
                <PressableScale
                  style={styles.sheetCurrencyBtn}
                  activeScale={0.92}
                  onPress={() => setAssetCurrencyDropOpen((v) => !v)}
                >
                  <Text style={styles.sheetCurrencyBtnText}>
                    {assetCurrencyFilter === 'all' ? tr('common.all') : assetCurrencyFilter}
                  </Text>
                  <Ionicons name={assetCurrencyDropOpen ? 'chevron-up' : 'chevron-down'} size={12} color={colors.link} />
                </PressableScale>
                <PressableScale
                  style={styles.sheetCloseCircle}
                  activeScale={0.90}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => { setAssetSheetOpen(false); setAssetCurrencyDropOpen(false); }}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </PressableScale>
              </View>
            </View>

            {/* 币种下拉面板：悬浮在 ALL 键正下方（右对齐、绝对定位），点面板外空白收起 */}
            {assetCurrencyDropOpen && (
              <Pressable style={styles.sheetCurrencyCatch} onPress={() => setAssetCurrencyDropOpen(false)} />
            )}
            {assetCurrencyDropOpen && (
              <View style={styles.sheetCurrencyPanel}>
                <PressableScale
                  style={[styles.sheetCurrencyItem, assetCurrencyFilter === 'all' && { backgroundColor: colors.link + '14' }]}
                  activeScale={0.97}
                  onPress={() => { setAssetCurrencyFilter('all'); setAssetCurrencyDropOpen(false); }}
                >
                  <Text
                    style={[styles.sheetCurrencyItemText, assetCurrencyFilter === 'all' && { color: colors.link, fontWeight: '700' }]}
                  >
                    {tr('addTx.allCurrencies')}
                  </Text>
                  {assetCurrencyFilter === 'all' && <Ionicons name="checkmark" size={16} color={colors.link} />}
                </PressableScale>
                {ownCurrencies.map((code) => {
                  const active = assetCurrencyFilter === code;
                  return (
                    <PressableScale
                      key={code}
                      style={[styles.sheetCurrencyItem, active && { backgroundColor: colors.link + '14' }]}
                      activeScale={0.97}
                      onPress={() => { setAssetCurrencyFilter(code); setAssetCurrencyDropOpen(false); }}
                    >
                      <Text style={[styles.sheetCurrencyItemText, active && { color: colors.link, fontWeight: '700' }]}>{code}</Text>
                      {active && <Ionicons name="checkmark" size={16} color={colors.link} />}
                    </PressableScale>
                  );
                })}
              </View>
            )}
            {/* 搜索框：与记一笔弹层同款规格 */}
            <View style={styles.sheetSearchBox}>
              <Ionicons name="search-outline" size={16} color={colors.textTertiary} />
              <TextInput
                style={styles.sheetSearchInput}
                value={assetSearch}
                onChangeText={setAssetSearch}
                placeholder={tr('addTx.searchPlaceholder')}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
            {/* 类型筛选芯片：全部/现金/银行卡/信用卡/电子钱包 */}
            <View style={styles.sheetFilterRow}>
              {(
                [
                  ['all', tr('common.all')],
                  ['cash', tr('addTx.filterCash')],
                  ['bank', tr('addTx.filterBank')],
                  ['credit', tr('addTx.filterCredit')],
                  ['ewallet', tr('addTx.filterEwallet')],
                ] as const
              ).map(([key, label]) => (
                <PressableScale
                  key={key}
                  style={[styles.sheetFilterChip, assetFilter === key && styles.sheetFilterChipActive]}
                  activeScale={0.94}
                  onPress={() => setAssetFilter(key)}
                >
                  <Text style={[styles.sheetFilterText, assetFilter === key && styles.sheetFilterTextActive]}>{label}</Text>
                </PressableScale>
              ))}
            </View>
            <Reanimated.ScrollView
              onScroll={sheetListScrollHandler}
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {(() => {
                // 资产页同款「一币一大卡」（与记一笔两处弹层同款）：任何时候都是大卡——
                // 选了某币种=只显示那一张卡；账户行保留 meta 行与币种前缀余额（规划页特有）
                const kw = assetSearch.trim().toLowerCase();
                const visible = activeAssets.filter((a) => {
                  const matchSearch = !kw || `${a.name} ${a.currency} ${a.type}`.toLowerCase().includes(kw);
                  // 币种筛选：ALL 下拉里点了 USD 之类后，列表只显示该币种的账户
                  const matchCurrency = assetCurrencyFilter === 'all' || a.currency === assetCurrencyFilter;
                  const matchType = assetFilter === 'all' || a.type === assetFilter;
                  return matchSearch && matchCurrency && matchType;
                });
                if (visible.length === 0) {
                  return <Text style={styles.sheetEmptyText}>{tr('addTx.noAccount')}</Text>;
                }
                const byCurrency: Record<string, typeof visible> = {};
                visible.forEach((a) => {
                  if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
                  byCurrency[a.currency].push(a);
                });
                return Object.entries(byCurrency)
                  .sort(([c1], [c2]) => c1.localeCompare(c2))
                  .map(([code, items]) => {
                    const expanded = !pickerCollapsedGroups.has(code);
                    const groupTotal = items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
                    return (
                      <View key={`grp-${code}`} style={styles.sheetGroupShadow}>
                        {/* 与资产页 currencyGroupCard 同款渐变/描边/圆角 */}
                        <LinearGradient
                          colors={[colors.netWorthGradientFrom, colors.netWorthGradientTo]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.sheetGroupCard}
                        >
                          <PressableScale
                            style={styles.sheetGroupHeader}
                            activeScale={0.98}
                            onPress={() => togglePickerGroup(code)}
                          >
                            <View style={styles.sheetGroupFlag}>
                              <Text style={styles.sheetGroupFlagText}>{code}</Text>
                            </View>
                            <View style={{ flex: 1 }} />
                            <Text style={styles.sheetGroupTotal}>{formatMoney(groupTotal, { decimals: decimalPlaces })}</Text>
                            <Ionicons
                              name={expanded ? 'chevron-up' : 'chevron-down'}
                              size={16}
                              color={colors.netWorthAccent}
                              style={{ marginLeft: 6 }}
                            />
                          </PressableScale>
                          {expanded && (
                            <View style={styles.sheetGroupBody}>
                              {items.map((a) => {
                                const sel = assetId === a.id;
                                return (
                                  <PressableScale
                                    key={a.id}
                                    style={[styles.sheetGroupRow, sel && styles.sheetGroupRowActive]}
                                    activeScale={0.97}
                                    onPress={() => {
                                      setAssetId(a.id);
                                      closeAssetSheet();
                                      setAssetCurrencyFilter('all');
                                    }}
                                  >
                                    <View style={styles.sheetGroupRowIcon}>
                                      <Ionicons name={a.icon as any} size={20} color={a.color} />
                                    </View>
                                    <View style={styles.sheetGroupRowInfo}>
                                      <Text style={styles.sheetGroupRowName} numberOfLines={1}>
                                        {a.name}
                                        {a.isDefault && (
                                          <Text style={styles.sheetRowBadge}>{tr('addTx.currentDefault')}</Text>
                                        )}
                                      </Text>
                                    </View>
                                    <Text style={styles.sheetGroupRowAmount}>
                                      {formatMoney(getAssetDisplayBalance(a, getAssetBalance(a.id)), { decimals: decimalPlaces })}
                                    </Text>
                                    {sel && (
                                      <Ionicons name="checkmark-circle" size={18} color={colors.income} style={{ marginLeft: 6 }} />
                                    )}
                                  </PressableScale>
                                );
                              })}
                            </View>
                          )}
                        </LinearGradient>
                      </View>
                    );
                  });
              })()}
            </Reanimated.ScrollView>
            {/* 贴底添加入口：与记一笔 addAccountPickerBtn 同款有框胶囊，footer 垫安全区 */}
            <View style={{ marginTop: 10, paddingBottom: Math.max(insets.bottom, 20) + 8 - 9 }}>
              <PressableScale
                style={styles.sheetAddBtn}
                activeScale={0.97}
                onPress={() => {
                  closeAssetSheet();
                  navigation.navigate(ROUTES.ADD_ASSET as never);
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color={colors.link} />
                <Text style={styles.sheetAddBtnText}>{tr('addTx.addAccount')}</Text>
              </PressableScale>
            </View>
            </Reanimated.View>
          </GestureDetector>
        </View>
      )}

      {/* 计划周期：日期范围选择（开始日期 + 结束日期；月结按开始日期的"日"） */}
      <DateRangePickerSheet
        visible={datePickerOpen}
        start={rangeStart}
        end={rangeStart}
        mode="single"
        onApply={(d: string) => {
          setRangeStart(d);
          setDatePickerOpen(false);
        }}
        onClose={() => setDatePickerOpen(false)}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: ThemeColors, semantic: SemanticColors, elevation: Elevation) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingBottom: 6,
    },
    // 页头上的玻璃圆钮（V2）：36 圆，与资产 / 统计页的玻璃圆钮同一规格
    glassHeaderBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.link,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: semantic.onAccent },
    headerDeleteBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    // 框到框之间的上下纯留白统一 4px（标签的上下外边距）；表单标签统一 12px/500
    formLabel: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, marginBottom: 4, marginTop: 4 },
    // 金额标签：紧跟计划名称，上边距收紧
    formLabelTight: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, marginBottom: 4, marginTop: 4 },
    formInput: {
      borderWidth: 1,
      borderColor: colors.dividerHair, // 边框色调统一：规划名称/类别/账户/开始日期四框同色
      borderRadius: 12,
      paddingHorizontal: 14,
      height: 40, // 与类别选择按钮同高，纠正两页/两框的大小偏差
      fontSize: 15,
      backgroundColor: colors.card,
    },
    formReadonlyField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    segRow: { flexDirection: 'row', gap: 8 },
    segBtn: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.card,
    },
    segBtnActive: { borderColor: colors.link, backgroundColor: colors.link + '14' },
    segText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
    segTextActive: { color: colors.link, fontWeight: '700' },
    // 金额框（第3层）：浅底框格 + 居中大数字 + 右侧紫色笔（可编辑标识，与资产页同款）
    amountBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    // 计划名称旁的类别选择框：与名称输入框 50%/50% 等分、同高；内部"小图标 + 文字标注"横排居中
    categoryBtn: {
      flex: 1,
      height: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.card,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 8,
    },
    categoryBtnDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    categoryBtnText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
    amountBoxLabel: { fontSize: 12, fontWeight: '500', color: colors.textSecondary, marginBottom: 4 },
    amountBoxRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
    // 金额行：货币代号与金额同字号；两端对齐——货币贴左、金额贴右
    amountBoxCurrency: { fontSize: 34, fontWeight: '800', color: colors.textSecondary },
    amountBoxValue: { fontWeight: '800', color: colors.textPrimary, fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1, marginLeft: 'auto' },
    // 金额文字容器（CursorAmountText 外壳）与光标样式
    amountBoxValueWrap: { flexShrink: 1, marginLeft: 'auto' },
    amountBoxCursor: { fontWeight: '300', color: colors.link },
    // 账户底部上拉面板：与记一笔 accountPickerSheet 同参数（树内覆盖层、贴底 82% 高、圆角 26、描边）
    sheetCard: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: '82%',
      backgroundColor: colors.card,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 9,
    },
    sheetCloseCircle: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetTitle: { fontSize: 17, fontWeight: '800', color: colors.textPrimary, flexShrink: 1, marginRight: 8 },
    // 把手条：与记一笔 accountPickerGrabber 同款
    sheetGrabber: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.divider,
      marginBottom: 10,
    },
    // 货币直选键（ALL）：与记一笔 accountPickerCurrencyBtn 同规格
    sheetCurrencyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.link + '14',
      borderWidth: 1,
      borderColor: colors.link + '33',
      borderRadius: 14,
      paddingHorizontal: 9,
      paddingVertical: 5,
      marginRight: 8,
    },
    sheetCurrencyBtnText: { fontSize: 12, fontWeight: '700', color: colors.link, marginRight: 2 },
    // 币种下拉面板：与记一笔 currencyDropPanel 同规格（悬浮 ALL 键正下方、右对齐）
    sheetCurrencyCatch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 18 },
    sheetCurrencyPanel: {
      position: 'absolute',
      top: 62,
      right: 54,
      zIndex: 20,
      backgroundColor: colors.bg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      paddingVertical: 4,
      minWidth: 150,
      elevation: 6,
    },
    sheetCurrencyItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10 },
    sheetCurrencyItemText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
    // —— 账户弹层分组卡（资产页 currencyGroup* 同款）：一币一大卡、卡内小账户框 ——
    // 阴影走令牌（elevation.level2 的 boxShadow，夜/日各一套），不再写死 shadowColor
    sheetGroupShadow: {
      borderRadius: 20,
      ...elevation.level2,
      marginBottom: 5,
    },
    sheetGroupCard: {
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      overflow: 'hidden',
    },
    sheetGroupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    // 币种代码芯片（分组头 / 已选账户）：替代国旗 emoji
    sheetGroupFlag: {
      minWidth: 48,
      height: 26,
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: colors.cardBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetGroupFlagText: { fontSize: 12, fontWeight: '700', color: colors.netWorthValue, letterSpacing: 0.5 },
    currencyChip: {
      minWidth: 40,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: 6,
      backgroundColor: colors.link + '1F',
      alignItems: 'center',
      justifyContent: 'center',
    },
    currencyChipText: { fontSize: 11, fontWeight: '700', color: colors.link, letterSpacing: 0.3 },
    sheetGroupTotal: { fontSize: 20, fontWeight: '800', color: colors.netWorthValue, marginLeft: 6, fontVariant: ['tabular-nums'] },
    sheetGroupBody: {
      paddingHorizontal: 10,
      paddingBottom: 10,
      paddingTop: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.dividerHair,
    },
    // 卡内账户小框（资产页 assetRowOnGradient 同款）：半透明白底无边框；保留 meta 行（规划页特有）
    sheetGroupRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.tabBlobBg,
      borderRadius: 12,
      paddingVertical: 5,
      paddingHorizontal: 9,
      marginBottom: 3,
    },
    sheetGroupRowActive: { backgroundColor: colors.tabEdge },
    sheetGroupRowIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: semantic.onAccent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetGroupRowInfo: { flex: 1, minWidth: 0, marginLeft: 12 },
    sheetGroupRowName: { fontSize: 15, fontWeight: '700', color: colors.netWorthValue, flexShrink: 1 },
    sheetGroupRowAmount: { fontSize: 16, fontWeight: '700', color: colors.netWorthValue, marginLeft: 8, fontVariant: ['tabular-nums'] },
    sheetRowBadge: { fontSize: 7, fontWeight: '700', color: colors.income, marginLeft: 6, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: colors.income + '18' },
    // —— 账户弹层增强件（与记一笔账户弹层同款规格）——
    sheetHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, zIndex: 21 },
    sheetHeaderRight: { flexDirection: 'row', alignItems: 'center' },
    sheetSearchBox: {
      height: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 12,
      paddingHorizontal: 12,
      marginBottom: 10,
    },
    sheetSearchInput: { flex: 1, fontSize: 14, color: colors.textPrimary, paddingVertical: 0 },
    // 与记一笔 accountFilterRow 同款：单行横排不换行（芯片自身 marginRight 7）
    sheetFilterRow: { flexDirection: 'row', marginBottom: 10 },
    // 与记一笔 accountFilterChip 同款：bg 底 + 1px 显眼外框 + 选中紫实底
    sheetFilterChip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      marginRight: 7,
    },
    sheetFilterChipActive: { backgroundColor: colors.fabBg },
    sheetFilterText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
    sheetFilterTextActive: { color: colors.bg },
    sheetEmptyText: { fontSize: 13, color: colors.textTertiary, textAlign: 'center', paddingVertical: 24 },
    // 底部「添加新账户」：与记一笔 addAccountPickerBtn 同款有框胶囊
    sheetAddBtn: {
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      backgroundColor: colors.bg,
    },
    sheetAddBtnText: { fontSize: 14, fontWeight: '700', color: colors.link, marginLeft: 7 },
    // 计算器键盘底座（与记一笔/添加账户页同规格）
    keypadFooter: { paddingTop: 6, borderTopWidth: 1 },
    autoDeductRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      borderRadius: 12,
      padding: 12,
      marginTop: 14,
    },
    autoKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: semantic.onAccent, margin: 2 },
    autoKnobOn: { alignSelf: 'flex-end' },
    switchTrack: { width: 46, height: 26, borderRadius: 13, backgroundColor: colors.dividerHair },
    saveFooter: {
      paddingHorizontal: 20,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: colors.dividerHair,
      backgroundColor: colors.card,
    },
    saveBtn: {
      height: 48,
      borderRadius: 14,
      // 与"添加规划"入口按钮同色(colors.fabBg)
      backgroundColor: colors.fabBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 与"添加规划"入口按钮文字同色(colors.bg)
    saveBtnText: { color: colors.bg, fontSize: 15, fontWeight: '700' },
  });
}
