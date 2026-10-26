import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  BackHandler,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { CURRENCY_OPTIONS, WORLD_CURRENCY_OPTIONS, currencyDisplayName, getEnglishCurrencyName } from '../utils/currencies';
import { useLanguage } from '../i18n/LanguageContext';
import { AssetType } from '../types';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import type { SemanticColors, Spacing, ThemeColors, Typography } from '../theme/theme';
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { CursorAmountText } from '../components/CursorAmountText';
import PressableScale from '../components/PressableScale';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';
import { useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { hapticSuccess } from '../utils/haptics';
import { AppText, BottomSheet, Button, ListRow, ScreenHeader } from '../components/ui';

type IconName = keyof typeof Ionicons.glyphMap;

const TYPE_OPTIONS: { type: AssetType; label: string; icon: IconName; color: string }[] = [
  { type: 'cash', label: 'asset.typeCash', icon: 'cash-outline', color: '#66BB6A' },
  { type: 'bank', label: 'asset.typeBank', icon: 'card-outline', color: '#4C9AFF' },
  { type: 'credit', label: 'asset.typeCredit', icon: 'wallet-outline', color: '#EF5350' },
  { type: 'ewallet', label: 'asset.typeEwallet', icon: 'phone-portrait-outline', color: '#26C6DA' },
  // 投资 / 其他：AssetType 本来就有这两档（老数据里也存在这类账户，列表照常显示图标），
  // 旧选择器只是没把它们暴露出来 —— 验收退回要求 6 档都能选到，这里补上（列表变长，抽屉内可滚动）
  { type: 'investment', label: 'asset.typeInvestment', icon: 'trending-up-outline', color: '#D97706' },
  { type: 'other', label: 'asset.typeOther', icon: 'cube-outline', color: '#8E8E9A' },
];

// 账户名称的输入提示跟着类型走：选中「现金」时提示"例如：现金钱包"，
// 而不是永远写着 "e.g. Bank card ****"（那会让用户以为只能填银行卡）。
// 6 档一张映射表，不在这里写三元表达式——将来加类型只需补一行。
const NAME_PLACEHOLDER_KEY: Record<AssetType, string> = {
  cash: 'addTx.accountNamePlaceholderCash',
  bank: 'addTx.accountNamePlaceholderBank',
  credit: 'addTx.accountNamePlaceholderCredit',
  ewallet: 'addTx.accountNamePlaceholderEwallet',
  investment: 'addTx.accountNamePlaceholderInvestment',
  other: 'addTx.accountNamePlaceholderOther',
};

// 计算器键盘当前在给哪个金额字段打字；null = 键盘收起
// （信用卡模式下这个字段就是"信用额度"，现金/银行卡是"起始余额"）
type AmountField = 'balance';

// 底部抽屉当前打开的是哪一个；null = 都收起（类型 / 货币都走统一 BottomSheet）
type SheetKind = 'type' | 'currency' | null;

/** 抽屉内列表占屏高的上限：抽屉本身最高 85% 屏，扣掉标题行与底部留白后给列表 0.7 屏 */
const SHEET_LIST_MAX_RATIO = 0.7;

export default function AddAssetScreen({ route }: any) {
  const { addAsset, updateAsset, getAssetById, currency } = useApp();
  const { colors, semantic, typography, spacing, motion } = useTheme();
  const { pagePadding } = useLayout();
  const { height: windowHeight } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSystemInset();
  const setTabBarForceHidden = useTabBarForceHide();
  const styles = useMemo(
    () => makeStyles(colors, semantic, typography, spacing),
    [colors, semantic, typography, spacing]
  );
  const { t, langMode } = useLanguage();

  // 编辑模式：route.params.assetId 有值时预填原账户（与新增共用同一表单，保存走 updateAsset）
  const editAsset = route?.params?.assetId ? getAssetById(route.params.assetId) : undefined;
  const isEdit = !!editAsset;

  const [name, setName] = useState(editAsset?.name ?? '');
  const [selectedType, setSelectedType] = useState<AssetType>(editAsset?.type ?? 'cash');
  const [selectedCurrency, setSelectedCurrency] = useState(editAsset?.currency ?? currency);

  // ---------- 金额字段：点一下调出计算器键盘（跟"记一笔"同一套），键盘上直接算 ----------
  // 现金/银行卡填"起始余额"；信用卡填"信用额度"。点"完成"把求值结果落到提交值里并收起键盘
  const balanceExpr = useAmountExpression();
  // 编辑模式预填：信用卡填的是额度（creditLimit），其余是起始余额（initialBalance）
  const [balanceValue, setBalanceValue] = useState(
    editAsset ? (editAsset.type === 'credit' ? editAsset.creditLimit ?? 0 : editAsset.initialBalance) : 0,
  );
  const [amountField, setAmountField] = useState<AmountField | null>(null);
  // 金额格自绘光标（距显示串尾部的偏移，0=最末尾）：按键在光标处生效
  const [balanceCursor, setBalanceCursor] = useState(0);

  // ---------- 自绘键盘与系统键盘的协调 ----------
  // 系统键盘（如账户名称输入框）出现时，自绘键盘让位收起；
  // 系统键盘收起后，只要金额编辑模式还开着（amountField 未清空），自绘键盘自动回到原位。
  // 金额模式本身不受影响：点账户名称打字不会丢掉键盘里未提交的算式，回来接着算。
  const [sysKeyboardVisible, setSysKeyboardVisible] = useState(false);
  useEffect(() => {
    // will/did 两套都挂：iOS 的 will 系列更灵敏，Android 只有 did 系列；
    // 有些设备/收起路径（返回键、点空白）did 事件偶发缺失，双保险避免自绘键盘收不回来
    const show1 = Keyboard.addListener('keyboardWillShow', () => setSysKeyboardVisible(true));
    const show2 = Keyboard.addListener('keyboardDidShow', () => setSysKeyboardVisible(true));
    const hide1 = Keyboard.addListener('keyboardWillHide', () => setSysKeyboardVisible(false));
    const hide2 = Keyboard.addListener('keyboardDidHide', () => setSysKeyboardVisible(false));
    return () => {
      show1.remove();
      show2.remove();
      hide1.remove();
      hide2.remove();
    };
  }, []);

  const openAmountField = () => {
    // 系统键盘可能开着（名称框聚焦中）：无论如何都收掉，并让名称框失焦——
    // 系统光标消失、自绘光标接棒。这两步不能跳过，否则从名称框点回金额区时
    // 系统键盘不收、光标也不切换
    Keyboard.dismiss();
    nameInputRef.current?.blur();
    // 金额模式已开着：只收系统键盘/切换光标，不重置算式
    if (amountField === 'balance') return;
    // 打开键盘即从空态起输：按 5 就是 0.05（分录入法），新输入直接替换旧值
    balanceExpr.reset();
    setBalanceCursor(0);
    setAmountField('balance');
  };

  // 进入页面默认常驻计算器键盘（金额是第一填写项）——用户点其他控件（货币弹层/名称框）时
  // 由各自的让位逻辑收起；关闭菜单/失焦后金额模式仍在，键盘自动回到原位
  useEffect(() => {
    if (isFocused) setAmountField('balance');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commitAmountField = () => {
    if (!amountField) return;
    setBalanceValue(balanceExpr.confirm());
    setAmountField(null);
  };

  // 计算器键盘上的 Enter（下一项）箭头已由小数点键取代（标准金额录入）
  const nameInputRef = useRef<TextInput>(null);

  const activeExpr = balanceExpr;

  // ---------- 底部上拉菜单：货币选择用弹层；账户类型用行下内联下拉 ----------
  const [sheetOpen, setSheetOpen] = useState<SheetKind>(null);

  // 底部导航栏在本页【全程隐藏】：添加资产账户是专注填表页（键盘/弹层随时可能出现），
  // 不让 Tab 栏在任何状态下弹出来；离开页面时恢复
  useEffect(() => {
    if (isFocused) setTabBarForceHidden(true);
    return () => setTabBarForceHidden(false);
  }, [isFocused, setTabBarForceHidden]);

  // 币种抽屉关闭后把「强制隐藏 Tab 栏」按回来。
  // ⚠ BottomSheet 的强制隐藏用的是**单个共享布尔量**（不是引用计数）：它退场卸载时会把标记复位，
  //   连本页的强制隐藏一起清掉 —— 不复位的话本页会冒出 Tab 栏并压在计算器键盘上
  //   （本页全程隐藏 Tab 栏是原有行为，替换弹层后必须补这一下）。
  //   延时取抽屉退场弹簧时长（motion.spring.sheet.duration）+ 余量，保证排在它卸载之后。
  useEffect(() => {
    if (!isFocused || sheetOpen === 'currency') return;
    const timer = setTimeout(() => setTabBarForceHidden(true), motion.spring.sheet.duration + 100);
    return () => clearTimeout(timer);
  }, [isFocused, sheetOpen, setTabBarForceHidden, motion]);

  // 币种选择改用全 App 统一的 BottomSheet（T05 组件）：遮罩 / 把手 / 下拉收起 / 弹簧 / 安全区
  // 全部交给它，页面不再自己维护一套下滑手势与进场动画
  const closeCurrencySheet = () => {
    setSheetOpen(null);
    setCurrencySearch('');
  };
  // 抽屉最高 0.85 屏（BottomSheet 默认）：扣掉标题行与底部「安全区 + 16」后，列表最多占 0.7 屏
  // —— 6 个账户类型在 360×640 一屏放得下，~150 种货币则靠抽屉内滚动到底（验收退回要求）
  const sheetListMaxHeight = Math.round(windowHeight * SHEET_LIST_MAX_RATIO);

  // 硬件返回键：币种弹层开着 → 先关弹层（拦截，不退出整页——否则填一半的表单全丢）；
  // 硬件返回键：只关币种弹层（真正的底部弹层）；其余情况不拦截、不动金额键盘，导航器直接 pop 本页
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (sheetOpen === 'currency') {
        closeCurrencySheet();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [sheetOpen]);

  // 货币搜索：世界货币表 ~150 种，按代码/中文名/界面语言显示名过滤
  const [currencySearch, setCurrencySearch] = useState('');
  const filteredCurrencies = useMemo(() => {
    const kw = currencySearch.trim().toLowerCase();
    if (!kw) return WORLD_CURRENCY_OPTIONS;
    return WORLD_CURRENCY_OPTIONS.filter(
      (c) =>
        c.code.toLowerCase().includes(kw) ||
        c.name.toLowerCase().includes(kw) ||
        currencyDisplayName(c).toLowerCase().includes(kw) ||
        (getEnglishCurrencyName(c.code) ?? '').toLowerCase().includes(kw)
    );
  }, [currencySearch, langMode]);

  // ---------- 校验 + 提交（错误直接亮在对应字段上，不打断） ----------
  type ErrorField = 'name';
  const [errors, setErrors] = useState<Partial<Record<ErrorField, string>>>({});
  const clearError = (field: ErrorField) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const handleSave = async (overrideBalance?: number) => {
    const isCredit = selectedType === 'credit';
    const nextErrors: Partial<Record<ErrorField, string>> = {};
    if (!name.trim()) nextErrors.name = t('addTx.enterAccountName');
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});

    // 类型不在 TYPE_OPTIONS 里时（如旧数据的投资/其他类型账户）保持原图标颜色，避免查不到而崩溃
    const typeInfo = TYPE_OPTIONS.find((t) => t.type === selectedType);
    // 信用卡只填"信用额度"：初始余额从 0 开始，填的数字存成 creditLimit；
    // 现金/银行卡填的数字就是初始余额。账单日/还款日/年利率不在此填写
    const bal = overrideBalance ?? balanceValue;

    if (isEdit && editAsset) {
      await updateAsset(editAsset.id, {
        name: name.trim(),
        icon: typeInfo?.icon ?? editAsset.icon,
        color: typeInfo?.color ?? editAsset.color,
        type: selectedType,
        currency: selectedCurrency,
        initialBalance: isCredit ? 0 : bal,
        // 信用额度只属于信用卡：类型从信用卡切走时显式清掉，防止残留
        creditLimit: isCredit ? bal : undefined,
      });
    } else {
      await addAsset({
        name: name.trim(),
        icon: typeInfo!.icon,
        color: typeInfo!.color,
        type: selectedType,
        currency: selectedCurrency,
        initialBalance: isCredit ? 0 : bal,
        ...(isCredit ? { creditLimit: bal } : {}),
      });
    }
    hapticSuccess();
    navigation.goBack();
  };

  // 键盘上的「完成」＝先把当前算式求值落进字段，再直接保存（新增＝创建账户，编辑＝更新账户，与"记一笔"的完成语义一致）
  const handleKeypadConfirm = () => {
    const bal = balanceExpr.confirm();
    setBalanceValue(bal);
    setAmountField(null);
    handleSave(bal);
  };

  // 金额是否多项拆分（15.00+20.00 这类）：多项时字号调小防溢出
  const balanceIsMulti = amountField === 'balance' && balanceExpr.isMulti;

  const selectedTypeInfo = TYPE_OPTIONS.find((opt) => opt.type === selectedType);
  const selectedCurrencyInfo = CURRENCY_OPTIONS.find((c) => c.code === selectedCurrency);

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
      // 点空白处（页面任意非输入区）：收系统键盘 + 名称框失焦——金额模式常驻，
      // 系统键盘一收自绘计算器立刻自动回位（渲染条件只剩 amountField && !sysKeyboardVisible）
      onTouchStart={() => {
        Keyboard.dismiss();
        nameInputRef.current?.blur();
      }}
    >
      {/* 顶栏：统一二级页页头（ScreenHeader compact = 返回 + 居中标题 + 右侧动作） */}
      <ScreenHeader
        variant="compact"
        title={t(isEdit ? 'addTx.editAssetTitle' : 'addTx.addAssetTitle')}
        onBack={() => navigation.goBack()}
        right={
          // 创建 / 编辑都显示"保存"（计划 5.8）。计算器键盘开着时先求值再提交，未确认的算式不丢失
          <Button
            title={t('common.save')}
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => {
              if (amountField) {
                const bal = balanceExpr.confirm();
                setBalanceValue(bal);
                setAmountField(null);
                handleSave(bal);
              } else {
                handleSave();
              }
            }}
            testID="add-asset-save"
          />
        }
      />

      {/* 表单：加 KeyboardAvoidingView + 可滚动容器 —— 系统键盘（账户名称）弹出时不遮挡正在输入的框；
          矮屏 + 键盘同时出现时也能滚到"保存" */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: pagePadding,
            paddingBottom: spacing.xxl,
          }}
        >
        {/* 起始金额：第一焦点。整张卡片都是点按热区（标签、留白也包含在内），
            点一下调出计算器键盘；键盘已开着时再点不会清掉未提交的算式（见 openAmountField 守卫） */}
        <PressableScale
          style={[styles.amountHero, amountField === 'balance' && styles.amountHeroActive]}
          activeScale={0.98}
          onPress={openAmountField}
        >
          <Text style={styles.amountLabel}>
            {selectedType === 'credit' ? t('addTx.creditLimitLabel') : t('addTx.balanceLabel')}
          </Text>
          <View style={styles.amountRow}>
            {/* 金额是主角（计划 A1 / 验收退回第 6 条）：amountEntry 档、右对齐、位数多时按档位降级；
                币种只在下方"选择货币"框上显示，金额这里不再重复写一遍 */}
            <CursorAmountText
              containerStyle={styles.amountTextContainer}
              style={[styles.amountText, ...(balanceIsMulti ? [styles.amountTextSmall] : [])]}
              cursorStyle={styles.amountCursor}
              display={amountField === 'balance' ? balanceExpr.displayValue : balanceValue.toFixed(2)}
              enabled={amountField === 'balance' && !sysKeyboardVisible}
              cursorFromEnd={balanceCursor}
              onCursorChange={setBalanceCursor}
              onPress={openAmountField}
            />
          </View>
        </PressableScale>

        {/* 账户名称 / 账户类型：左右 60% / 40%，类型是下拉选择框 */}
        <View style={styles.nameTypeRow}>
          <View style={styles.nameColumn}>
            <AppText variant="footnote" color={semantic.textSecondary} weight="600" style={styles.pickerLabel}>
              {t('addTx.accountName')}{' '}
              <AppText variant="footnote" color={semantic.danger} weight="600">
                *
              </AppText>
            </AppText>
            <TextInput
              ref={nameInputRef}
              style={[styles.input, errors.name && styles.inputError]}
              value={name}
              onFocus={() => {
                // 名称用系统键盘：聚焦时把开关置位，自绘键盘随即让位收起；
                // 金额模式保持不动——系统键盘收起后（onBlur/keyboard 隐藏事件）自绘键盘自动弹回
                setSysKeyboardVisible(true);
              }}
              onBlur={() => {
                setSysKeyboardVisible(false);
              }}
              onChangeText={(t) => {
                setName(t);
                clearError('name');
              }}
              placeholder={t(NAME_PLACEHOLDER_KEY[selectedType])}
              placeholderTextColor={semantic.textTertiary}
              selectionColor={semantic.accent}
              returnKeyType="done"
            />
            {/* 错误提示：就地亮在字段下方（不弹窗、不位移其它字段） */}
            {!!errors.name && (
              <AppText variant="footnote" color={semantic.danger} style={styles.errorText}>
                {errors.name}
              </AppText>
            )}
          </View>

          <View style={styles.typeColumn}>
            <AppText variant="footnote" color={semantic.textSecondary} weight="600" style={styles.pickerLabel}>
              {t('addTx.accountType')}
            </AppText>
            {/* 类型选择：与货币同一种弹层（计划 10.1「弹出层只有 2 种」——
                选择器一律走 BottomSheet，不再自造行下内联下拉） */}
            <PressableScale
              style={[styles.selectBox, sheetOpen === 'type' && { borderColor: semantic.accentText }]}
              activeScale={0.98}
              onPress={() => {
                // 同一时间只保留一个输入焦点：收系统键盘 + 名称框失焦
                Keyboard.dismiss();
                nameInputRef.current?.blur();
                setSheetOpen('type');
              }}
              testID="add-asset-type-field"
            >
              <Ionicons name={selectedTypeInfo?.icon ?? 'wallet-outline'} size={16} color={semantic.accentText} />
              <AppText variant="footnote" weight="600" numberOfLines={1} style={styles.selectBoxText}>
                {selectedTypeInfo ? t(selectedTypeInfo.label) : selectedType}
              </AppText>
              <Ionicons name="chevron-down" size={14} color={semantic.textTertiary} />
            </PressableScale>
          </View>
        </View>

        {/* 货币：选择框 + 统一 BottomSheet（世界货币表 ~150 种 + 搜索框，不用国旗 emoji） */}
        <AppText variant="footnote" color={semantic.textSecondary} weight="600" style={styles.pickerLabel}>
          {t('addTx.selectCurrency')}
        </AppText>
        <PressableScale
          style={[
            styles.selectBox,
            styles.currencySelectBox,
            sheetOpen === 'currency' && { borderColor: semantic.accentText },
          ]}
          activeScale={0.98}
          onPress={() => {
            // 同一时间只保留一个输入焦点：收系统键盘 + 名称框失焦（金额模式保留，键盘会自动回位）
            Keyboard.dismiss();
            nameInputRef.current?.blur();
            setCurrencySearch('');
            setSheetOpen('currency');
          }}
          testID="add-asset-currency-field"
        >
          <AppText variant="footnote" weight="600" numberOfLines={1} style={styles.selectBoxText}>
            {selectedCurrencyInfo
              ? langMode === 'zh'
                ? `${currencyDisplayName(selectedCurrencyInfo)}（${selectedCurrencyInfo.code}）`
                : `${currencyDisplayName(selectedCurrencyInfo)} (${selectedCurrencyInfo.code})`
              : selectedCurrency}
          </AppText>
          <Ionicons name="chevron-down" size={14} color={semantic.textTertiary} />
        </PressableScale>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* 计算器键盘：只在点了金额字段时出现；底部用与"记一笔"相同的 stickyFooter 包裹，
          垫高到底部安全区之上，键盘位置/高度与那边完全一致。「完成」＝直接保存。
          系统键盘出现时自绘键盘收起让位，系统键盘收起后自动回到原位（金额模式还在的话） */}
      {/* 自绘计算器常驻规则：金额模式开着 && 没有任何上拉菜单（币种弹层）&& 系统键盘没弹——
          三个条件都满足才显示；菜单关闭后金额模式还在，键盘自动回位 */}
      {amountField && sheetOpen !== 'currency' && !sysKeyboardVisible && (
        <View
          style={[
            styles.keypadFooter,
            // 底部留白与"记一笔"同公式（insets−40，edge-to-edge 下根视图已延伸到导航条后面），
            // 不再垫满 insets——那会在键盘下方多出一条空位
            { paddingBottom: Math.max(bottomInset - 40, 8), backgroundColor: colors.card, borderTopColor: colors.dividerHair },
          ]}
        >
          <AmountCalculatorKeypad
            onPressKey={(key) => setBalanceCursor(activeExpr.pressKeyAt(key, balanceCursor))}
            onPressToday={() => {}}
            onClear={() => { activeExpr.reset(0); setBalanceCursor(0); }}
            onConfirm={handleKeypadConfirm}
          />
        </View>
      )}

      {/* 币种抽屉：统一 BottomSheet（把手 + 遮罩 + 下拉收起 + 安全区都由组件负责）。
          ⚠ 挂在页面根（SafeAreaView）的最后一个子节点上，不能放进 ScrollView —— 组件按 absoluteFill
          铺满父容器，放进滚动容器里会跟着内容滚走 */}
      {/* 类型抽屉：高度随内容自适应（BottomSheet 最高 85% 屏），列表超长时在抽屉内滚动，
          底部留「安全区 + 16」——6 档在 360×640 也能全部选到（验收退回 · 严重项） */}
      <BottomSheet
        visible={sheetOpen === 'type'}
        onClose={() => setSheetOpen(null)}
        title={t('addTx.accountType')}
        accessibilityLabel={t('addTx.accountType')}
        testID="add-asset-type-sheet"
      >
        <ScrollView
          style={{ maxHeight: sheetListMaxHeight }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {TYPE_OPTIONS.map((opt, index) => {
            const active = selectedType === opt.type;
            return (
              <ListRow
                key={opt.type}
                icon={opt.icon}
                iconColor={opt.color}
                title={t(opt.label)}
                trailing={
                  active ? <Ionicons name="checkmark" size={20} color={semantic.accentText} /> : undefined
                }
                onPress={() => {
                  setSelectedType(opt.type);
                  setSheetOpen(null);
                }}
                separator={index < TYPE_OPTIONS.length - 1}
                testID={`add-asset-type-${opt.type}`}
              />
            );
          })}
        </ScrollView>
      </BottomSheet>

      <BottomSheet
        visible={sheetOpen === 'currency'}
        onClose={closeCurrencySheet}
        title={t('addTx.selectCurrency')}
        accessibilityLabel={t('addTx.selectCurrency')}
        testID="add-asset-currency-sheet"
      >
        {/* 搜索框：按代码 / 中文名 / 界面语言显示名过滤 */}
        <View
          style={[
            styles.currencySearchBox,
            { backgroundColor: semantic.bg, borderColor: semantic.hairline, marginHorizontal: spacing.lg },
          ]}
        >
          <Ionicons name="search-outline" size={20} color={semantic.textTertiary} />
          <TextInput
            style={[styles.currencySearchInput, { color: semantic.textPrimary }]}
            value={currencySearch}
            onChangeText={setCurrencySearch}
            placeholder={t('addTx.searchCurrency')}
            placeholderTextColor={semantic.textTertiary}
            autoCorrect={false}
          />
          {!!currencySearch && (
            <PressableScale onPress={() => setCurrencySearch('')} hitSlop={6} activeScale={0.9}>
              <Ionicons name="close-circle" size={20} color={semantic.textTertiary} />
            </PressableScale>
          )}
        </View>
        {/* 列表：贴边行（抽屉里不套卡片），最大高按窗口高算（不写死像素） */}
        <ScrollView
          style={{ maxHeight: sheetListMaxHeight }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {filteredCurrencies.map((c, index) => {
            const active = selectedCurrency === c.code;
            return (
              <ListRow
                key={c.code}
                title={currencyDisplayName(c)}
                value={
                  active ? undefined : (
                    <AppText variant="body" color={semantic.textSecondary}>
                      {c.code}
                    </AppText>
                  )
                }
                trailing={
                  active ? (
                    <View style={styles.currencyActiveMark}>
                      <AppText variant="body" color={semantic.accentText}>
                        {c.code}
                      </AppText>
                      <Ionicons name="checkmark" size={20} color={semantic.accentText} />
                    </View>
                  ) : undefined
                }
                onPress={() => {
                  setSelectedCurrency(c.code);
                  closeCurrencySheet();
                }}
                  separator={index < filteredCurrencies.length - 1}
                  testID={`add-asset-currency-${c.code}`}
              />
            );
          })}
          {filteredCurrencies.length === 0 && (
            <AppText variant="subhead" color={semantic.textTertiary} align="center" style={styles.sheetEmpty}>
              {currencySearch ? t('addTx.noMatchingCurrency') : ''}
            </AppText>
          )}
        </ScrollView>
      </BottomSheet>
    </SafeAreaView>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号；几何常量只留纯图形尺寸） */
function makeStyles(
  colors: ThemeColors,
  semantic: SemanticColors,
  typography: Typography,
  spacing: Spacing
) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: semantic.bg },
    amountHero: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      alignItems: 'flex-start',
      paddingVertical: 26,
      paddingHorizontal: 20,
      marginBottom: 14,
    },
    amountHeroActive: { borderColor: semantic.accent },
    amountLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 10,
      letterSpacing: 0.3,
    },
    // 金额行固定高度 56：大金额触发等比缩字（minimumFontScale）时行高不变，
    // 整个 Hero 框的尺寸也就恒定——不会随金额位数增减而变高变矮
    amountRow: { flexDirection: 'row', alignItems: 'center', width: '100%', height: 56 },
    // 金额：主角档（计划 A1 的 amountEntry = 44/52/600），右对齐占满整行宽度；
    // 位数超宽按档位降一级（amountTextSmall），不做连续压缩
    amountText: {
      flex: 1,
      fontSize: typography.amountEntry.fontSize,
      lineHeight: typography.amountEntry.lineHeight,
      fontWeight: typography.amountEntry.fontWeight,
      color: semantic.textPrimary,
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    // 金额文字容器（CursorAmountText 外壳）：内容右对齐，占满整个 Hero 行宽
    amountTextContainer: { flex: 1, alignItems: 'flex-end' },
    // 多项算式（15.00+20.00 这类）时长一档：title1 = 28
    amountTextSmall: { fontSize: typography.title1.fontSize, lineHeight: typography.title1.lineHeight },
    // 金额输入光标（内置键盘开着时显示在金额末尾）：高度跟着金额档位走
    amountCursor: {
      fontSize: typography.amountEntry.fontSize,
      fontWeight: '300',
      color: semantic.accentText,
      marginLeft: 2,
    },
    // 账户名称 / 账户类型：左右 55% / 45%
    nameTypeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, zIndex: 10, elevation: 10 },
    nameColumn: { flex: 55 },
    // zIndex:类型下拉展开时高于全屏透明遮罩层,下拉行不会被遮罩盖住
    typeColumn: { flex: 45, zIndex: 10, elevation: 10 },
    input: {
      backgroundColor: semantic.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: semantic.hairline,
      height: 40,
      paddingVertical: 7,
      paddingHorizontal: spacing.md,
      fontSize: typography.footnote.fontSize,
      lineHeight: typography.footnote.lineHeight,
      color: semantic.textPrimary,
    },
    // 出错：只换描边色（不在出错时改宽度，避免 0.5px 布局跳动）
    inputError: { borderColor: semantic.danger },
    pickerLabel: { marginBottom: 6 },
    // 出错提示：就地落在字段下方，不写死高度（字号 / 行高走 typography 令牌）
    errorText: { marginTop: spacing.xs },
    // 下拉选择框（账户类型/货币）：固定高度、不参与纵向伸缩——名称列出现报错行时，
    // 右侧类型下拉框保持原尺寸不变（之前带 flex:1 会被拉高变形）
    selectBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: semantic.surface,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: semantic.hairline,
      height: 40, // 与"账户名称"输入框同高，视觉对齐
      paddingHorizontal: spacing.md,
    },
    selectBoxText: { flex: 1 },
    // 币种选择框：比名称/类型行的 40 再矮一档。
    // flexGrow:0 + flexShrink:0 + alignSelf:stretch —— 之前继承 selectBox 的 flex:1，在页面
    // 纵列里被纵向拉伸成一个大空框（触发框显得超高）；这里显式关掉拉伸、横向撑满。
    // 注意不能用 flex:0 简写：react-native-web 会原样透传成 CSS flex:0（= 0 1 0%），
    // flex-basis:0% 覆盖 height:40 导致框塌陷成只剩边框（原生 Yoga 的 flex:0 无此问题）。
    currencySelectBox: { flexGrow: 0, flexShrink: 0, alignSelf: 'stretch', height: 40 },
    // 币种搜索框（抽屉内）：记一笔"选择账户"同款
    currencySearchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      height: 40,
      borderRadius: 10,
      borderWidth: 1,
      paddingHorizontal: 10,
      marginBottom: spacing.sm,
    },
    currencySearchInput: { flex: 1, fontSize: typography.subhead.fontSize, color: semantic.textPrimary },
    // 抽屉里当前选中币种：代码 + 勾（并排在行尾）
    currencyActiveMark: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    sheetEmpty: { paddingVertical: spacing.xxl },
    // 键盘底座：与"记一笔"的 stickyFooter 同规格（左右留白 + 顶部分隔线），
    // 底部安全区 padding 在 JSX 里用 insets 算
    keypadFooter: {
      paddingHorizontal: 0,
      paddingTop: 6,
      borderTopWidth: 1,
    },
  });
}
