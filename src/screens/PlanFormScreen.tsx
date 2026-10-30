// 计划付款 新增/编辑 整页表单(路由:财务规划编辑):
// 与添加资产账户同模式——route.params.planId 有值 = 编辑,无 = 新增。
// 布局(自上而下):1.类型(固定支出/固定收入) 2.计划名称 3.金额(自绘计算器)+关联账户(底部上拉)
// 4.扣账周期固定"每月"(月结:结算日 = 起始日的"日"),只提供日期范围选择开始日期。
// 编辑模式额外有暂停开关与删除按钮;旧的每周/每年周期与扣账日字段已移除。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  Dimensions,
  Keyboard,
  BackHandler,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import PressableScale from '../components/PressableScale';
import { AccountPickerSheet } from '../components/transaction/AccountPickerSheet';
import { useTheme } from '../theme/useTheme';
import type { Radius, SemanticColors, Spacing, Typography } from '../theme/theme';
import { useT } from '../i18n/LanguageContext';
import DateRangePickerSheet from '../components/DateRangePickerSheet';
import { AmountCalculatorKeypad } from '../components/AmountCalculatorKeypad';
import { CursorAmountText } from '../components/CursorAmountText';
import { useAmountExpression } from '../hooks/useAmountExpression';
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';
import { useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { formatMoney } from '../utils/formatMoney';
import { getCategoryLabel } from '../i18n/categories';
import { hapticSuccess, hapticWarning } from '../utils/haptics';
import { ROUTES } from '../navigation/routes';
import SegmentedControl from '../components/SegmentedControl';
import { useLayout } from '../theme/useLayout';
import { AppText, Button, Card, HeroGradient, IconButton, ScreenHeader, Switch, withAlpha } from '../components/ui';

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PlanFormScreen({ route, navigation }: any) {
  const { addPaymentPlan, updatePaymentPlan, deletePaymentPlan, assets, paymentPlans, activeLedgerId, categories, currency, decimalPlaces } = useApp();
  const { semantic, spacing, radius, typography } = useTheme();
  const { pagePadding } = useLayout();
  const tr = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const insets = useSafeAreaInsets();
  const bottomInset = useBottomSystemInset();
  const isFocused = useIsFocused();
  const setTabBarForceHidden = useTabBarForceHide();
  const styles = useMemo(
    () => makeStyles(semantic, spacing, radius, typography),
    [semantic, spacing, radius, typography]
  );

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
  // 关联账户抽屉（共享 AccountPickerSheet）：遮罩 / 下滑收起 / 安卓返回键都由组件内部处理，
  // 这里只留一个开关；筛选、分组折叠、选中态全部由组件自己管（每次打开都是全新的面板状态）
  const [assetSheetOpen, setAssetSheetOpen] = useState(false);
  const closeAssetSheet = () => setAssetSheetOpen(false);

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
  // 3) 账户抽屉（BottomSheet）卸载时同样会放栏——依赖里带上 assetSheetOpen，同一条路径压回去。
  useEffect(() => {
    if (isFocused) setTabBarForceHidden(true);
  }, [isFocused, keypadOpen, datePickerOpen, assetSheetOpen, setTabBarForceHidden]);
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

  // 换类型：已选分类若与新类型不匹配则清空（支出/收入分类各自独立）——原逻辑一字未动
  const handleTypeChange = (tp: 'expense' | 'income') => {
    setType(tp);
    setCategoryId((prev) => (prev && categories.find((c) => c.id === prev)?.type !== tp ? null : prev));
  };

  return (
    // 版式：与设置页同一代 —— 页底 semantic.bg + 品牌渐变铺满整页；
    // 页头统一 ScreenHeader（返回 + 居中标题 + 右侧动作），安全区由 SafeAreaView 的 top 边负责
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      <ScreenHeader
        variant="compact"
        title={isEdit ? tr('finance.editPlan') : tr('finance.addPlan')}
        onBack={() => navigation.goBack()}
        right={
          isEdit ? (
            <IconButton
              icon="trash-outline"
              accessibilityLabel={tr('finance.deletePlan')}
              onPress={handleDelete}
              testID="plan-delete-button"
            />
          ) : undefined
        }
      />

      <ScrollView
        ref={scrollViewRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 第1层：固定支出 / 固定收入 —— 统一分段控件（与类别管理页 / 记一笔同一套） */}
        <View style={styles.segWrap}>
          <SegmentedControl
            stretch
            options={[
              { label: tr('finance.typeExpense'), value: 'expense' },
              { label: tr('finance.typeIncome'), value: 'income' },
            ]}
            selected={type}
            onSelect={(v) => handleTypeChange(v as 'expense' | 'income')}
          />
        </View>

        {/* 第2层：金额（点按调出计算器并滚到屏幕中心）—— surface 卡 + radius/spacing 令牌 */}
        <View onLayout={(e) => registerAmountFieldY(e.nativeEvent.layout.y)}>
          <PressableScale
            style={styles.amountCard}
            activeScale={0.98}
            onPress={openAmountKeypad}
            testID="plan-amount-field"
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <AppText variant="footnote" color={semantic.textSecondary} weight="600">
                {tr('finance.planAmount')}
              </AppText>
              <View style={styles.amountRow}>
                <AppText variant="title2" weight="600" color={semantic.textSecondary}>
                  {amountCurrency}
                </AppText>
                {/* 金额可定位光标（字号按位数渐缩）：键盘开着时点按/长按拖动移动光标，
                    按键在光标处插入/删除；键盘收起时只显示已确认金额、点按回落 openAmountKeypad */}
                <CursorAmountText
                  containerStyle={styles.amountValueWrap}
                  style={[styles.amountValue, { fontSize: planAmountFontSize, color: semantic.textPrimary }]}
                  cursorStyle={[styles.amountCursor, { color: semantic.accentText }]}
                  display={amountDisplay}
                  enabled={keypadOpen}
                  cursorFromEnd={amountCursor}
                  onCursorChange={setAmountCursor}
                  onPress={openAmountKeypad}
                />
              </View>
            </View>
            <Ionicons name="pencil" size={16} color={semantic.accentText} />
          </PressableScale>
        </View>

        {/* 第3层：名称 / 类别 / 账户 / 开始日期 / 状态 —— 一张 surface 卡内的行，行间发丝线分组
            （标签左、控件右，与设置页 / 添加资产账户同一套表单语言） */}
        <Card padded={false} style={styles.sectionCard}>
          <View style={styles.fieldRow}>
            <AppText variant="subhead" color={semantic.textSecondary}>
              {tr('finance.planName')}
            </AppText>
            <TextInput
              style={[styles.fieldInput, { color: semantic.textPrimary }]}
              value={name}
              onChangeText={setName}
              placeholder={tr('finance.planNamePlaceholder')}
              placeholderTextColor={semantic.textTertiary}
              selectionColor={semantic.accent}
              returnKeyType="done"
              testID="plan-name-input"
            />
          </View>

          <View style={styles.rowDivider} />

          {/* 类别：点击进入"类别分类"选择模式，点分类后经 onPickCategory 回调带回结果并自动退出选择页 */}
          <PressableScale
            style={styles.fieldRow}
            activeScale={0.98}
            onPress={() =>
              navigation.navigate(ROUTES.CATEGORY_MGMT, {
                selectMode: true,
                // TASK-020 纠偏：带上表单当前类型——之前没传，固定收入计划进选择页只会看到支出分类
                initialType: type,
                onPickCategory: (id: string) => setCategoryId(id),
              })
            }
            testID="plan-category-row"
          >
            <AppText variant="subhead" color={semantic.textSecondary}>
              {tr('finance.category')}
            </AppText>
            <View style={styles.fieldValueRight}>
              <View
                style={[
                  styles.categoryDot,
                  { backgroundColor: withAlpha(selectedCategory?.color ?? semantic.textTertiary, 0.12) },
                ]}
              >
                <Ionicons
                  name={(selectedCategory?.icon as any) ?? 'apps-outline'}
                  size={14}
                  color={selectedCategory?.color ?? semantic.textTertiary}
                />
              </View>
              <AppText
                variant="subhead"
                color={selectedCategory ? semantic.textPrimary : semantic.textTertiary}
                numberOfLines={1}
                style={styles.fieldValueText}
              >
                {selectedCategory ? getCategoryLabel(selectedCategory, tr) : tr('finance.selectCategory')}
              </AppText>
              <Ionicons name="chevron-forward" size={16} color={semantic.textTertiary} />
            </View>
          </PressableScale>

          <View style={styles.rowDivider} />

          {/* 关联账户：底部弹层选择（弹层交互一字未动） */}
          <PressableScale
            style={styles.fieldRow}
            activeScale={0.98}
            onPress={() => setAssetSheetOpen(true)}
            testID="plan-asset-row"
          >
            <AppText variant="subhead" color={semantic.textSecondary}>
              {tr('finance.linkAsset')}
            </AppText>
            <View style={styles.fieldValueRight}>
              {/* 币种用代码小芯片（不用国旗 emoji：部分安卓机型只渲染成两个字母） */}
              {selectedAsset && (
                <View style={styles.currencyChip}>
                  <AppText variant="caption2" weight="600" color={semantic.accentText}>
                    {selectedAsset.currency}
                  </AppText>
                </View>
              )}
              <AppText
                variant="subhead"
                color={selectedAsset ? semantic.textPrimary : semantic.textTertiary}
                numberOfLines={1}
                style={styles.fieldValueText}
              >
                {selectedAsset?.name ?? tr('addTx.notSelectedShort')}
              </AppText>
              <Ionicons name="chevron-forward" size={16} color={semantic.textTertiary} />
            </View>
          </PressableScale>

          <View style={styles.rowDivider} />

          {/* 开始日期：single 模式只选一个日期；月结扣账日 = 开始日期的"日" */}
          <PressableScale
            style={styles.fieldRow}
            activeScale={0.98}
            onPress={() => setDatePickerOpen(true)}
            testID="plan-date-row"
          >
            <AppText variant="subhead" color={semantic.textSecondary}>
              {tr('finance.startDate')}
            </AppText>
            <View style={styles.fieldValueRight}>
              <AppText variant="subhead" color={semantic.textPrimary} numberOfLines={1} style={styles.fieldValueText}>
                {rangeStart}
              </AppText>
              <Ionicons name="calendar-outline" size={16} color={semantic.textTertiary} />
            </View>
          </PressableScale>

          {/* 计划状态开关(编辑模式)：开=生效中、关=已暂停——标签描述状态而不是矛盾的反义 */}
          {isEdit && (
            <>
              <View style={styles.rowDivider} />
              <View style={styles.fieldRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="subhead" color={semantic.textPrimary} weight="600">
                    {tr('finance.planStatusLabel')}
                  </AppText>
                  <AppText
                    variant="caption2"
                    color={active ? semantic.accentText : semantic.textTertiary}
                    style={styles.fieldHint}
                  >
                    {active ? tr('finance.planStatusOn') : tr('finance.planStatusOff')}
                  </AppText>
                </View>
                <Switch
                  value={active}
                  onValueChange={setActive}
                  accessibilityLabel={tr('finance.planStatusLabel')}
                  testID="plan-status-switch"
                />
              </View>
            </>
          )}
        </Card>
      </ScrollView>

      {/* 保存按钮：ui/Button gradient 档（与「记一笔」完成键同规格）；计算器键盘开着时让位给键盘面板 */}
      {!keypadOpen && (
        <View style={[styles.saveFooter, { paddingBottom: Math.max(bottomInset, spacing.lg) }]}>
          <Button
            title={tr('finance.save')}
            variant="gradient"
            onPress={() => handleSave()}
            testID="plan-save-button"
          />
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
              paddingBottom: Math.max(bottomInset - 40, spacing.sm),
              backgroundColor: semantic.surface,
              borderTopColor: semantic.hairline,
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

      {/* 关联账户：共享账户抽屉（与记一笔同一套）。外壳（遮罩 / 下滑收起 / 安卓返回键）
          全在 BottomSheet 内，这里只传数据与开关；本页额外打开的是币种直选、搜索+类型筛选、
          行金额币种代码三项——另两处调用点不传这些 prop，行为与之前完全一致 */}
      {assetSheetOpen && (
        <AccountPickerSheet
          title={tr('addTx.selectAccount')}
          selectedId={assetId ?? null}
          currencyCode={amountCurrency}
          showCurrencyFilter
          showTypeFilter
          amountWithCurrency
          onPickAsset={(id) => {
            setAssetId(id);
            closeAssetSheet();
          }}
          onClose={closeAssetSheet}
          onAddAccount={() => {
            closeAssetSheet();
            navigation.navigate(ROUTES.ADD_ASSET as never);
          }}
        />
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

function makeStyles(
  semantic: SemanticColors,
  spacing: Spacing,
  radius: Radius,
  typography: Typography
) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: semantic.bg },

    // —— 表单（本页主体）：semantic.surface 卡 + radius / spacing 令牌 ——
    segWrap: { marginBottom: spacing.lg },
    // 一卡多行：行间发丝线，行高 ≥ 52（触控 + 留白）
    sectionCard: { borderRadius: radius.lg, overflow: 'hidden' },
    fieldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      minHeight: 52,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: semantic.surface,
    },
    rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: semantic.hairline, marginLeft: spacing.lg },
    fieldInput: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 0,
      fontSize: typography.subhead.fontSize,
      textAlign: 'right',
    },
    fieldValueRight: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.sm,
      flexShrink: 1,
      marginLeft: 'auto',
    },
    fieldValueText: { flexShrink: 1 },
    fieldHint: { marginTop: 1 },
    // 类别色小圆点（类别色 12% 底 + 100% 图标，与类别管理页同一套推导）
    categoryDot: { width: 22, height: 22, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
    // 币种代码小芯片（不用国旗 emoji）
    currencyChip: {
      minWidth: 40,
      height: 20,
      paddingHorizontal: 6,
      borderRadius: radius.xs,
      backgroundColor: semantic.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // 金额卡（第2层）：surface 底 + 大数字 + 右侧紫色笔（可编辑标识）
    amountCard: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      backgroundColor: semantic.surface,
      borderRadius: radius.lg,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.lg,
    },
    amountRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', columnGap: spacing.sm },
    amountValue: { fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1, marginLeft: 'auto' },
    // 金额文字容器（CursorAmountText 外壳）与光标样式
    amountValueWrap: { flexShrink: 1, marginLeft: 'auto' },
    amountCursor: { fontWeight: '300' },
    // 计算器键盘底座（与记一笔/添加账户页同规格）
    keypadFooter: { paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth },
    // 底部主按钮容器：页底铺色 + 发丝线，按钮本身走 ui/Button（gradient 档）
    saveFooter: {
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: semantic.hairline,
      backgroundColor: semantic.surface,
    },

  });
}
