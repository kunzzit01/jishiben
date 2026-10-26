import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';

/**
 * 玻璃材质（UI V2.1 §2）在 web 上的偏差修正：expo-blur 的 web 实现用「tint 底色」模拟模糊——
 * tint default + intensity 100 → 叠一层 rgba(255,255,255,.30) 的白，夜间玻璃被洗成中紫，
 * 规范里的 text.secondary / income / danger 全部跌破 §4 硬指标（实测 2.7–4.2）。
 * 这里把 web 强度降到 8（白底 2.4%，模糊 1.6px ≈ 不可见），玻璃回到稿里的 rgba(14,10,30,.46) 实色；
 * iOS 仍用 GlassView 默认 100（真材质），Android 本来就没有模糊。
 */
const WEB_GLASS_INTENSITY = Platform.OS === 'web' ? 8 : undefined;
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { formatMoney } from '../utils/formatMoney';
import type { DecimalPlaces } from '../types';
import { useT } from '../i18n/LanguageContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import PressableScale from '../components/PressableScale';
import { AppText, GlassView, HeroGradient, ScreenHeader } from '../components/ui';

type Method = 'reducing' | 'straight' | 'flat';

type ScheduleRow = {
  period: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
};

/** 金额统一走 formatMoney，小数位跟随 App 的小数位设置 */
function fmt(n: number, decimals: DecimalPlaces) {
  if (!isFinite(n)) return '--';
  return formatMoney(n, { decimals });
}

// 余额递减法（等额本息）：每月供款固定，利息按剩余本金算，本金部分逐月变多
function buildReducingSchedule(principal: number, monthlyRate: number, months: number): { payment: number; rows: ScheduleRow[] } {
  const payment =
    monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);

  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let period = 1; period <= months; period++) {
    const interest = balance * monthlyRate;
    let principalPortion = payment - interest;
    if (period === months) principalPortion = balance; // 抹掉最后一期的浮点误差
    balance = Math.max(0, balance - principalPortion);
    rows.push({ period, payment: principalPortion + interest, principal: principalPortion, interest, balance });
  }
  return { payment, rows };
}

// 直线法（等额本金）：每月还的本金固定，利息按剩余本金算，月供逐月变少
function buildStraightSchedule(principal: number, monthlyRate: number, months: number): { rows: ScheduleRow[] } {
  const monthlyPrincipal = principal / months;
  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let period = 1; period <= months; period++) {
    const interest = balance * monthlyRate;
    balance = Math.max(0, balance - monthlyPrincipal);
    rows.push({ period, payment: monthlyPrincipal + interest, principal: monthlyPrincipal, interest, balance });
  }
  return { rows };
}

// 平息法（Flat Rate）：利息一开始就按最初的本金总额算死、平摊到每期，
// 不管你已经还了多少本金，每期利息永远是同一个数字——跟前两种「利息按剩余本金算」的逻辑完全不同，
// 所以本金和月供都是固定值，总利息 = 本金 × 月利率 × 期数（相当于单利，不复利）。
function buildFlatSchedule(principal: number, monthlyRate: number, months: number): { payment: number; rows: ScheduleRow[] } {
  const totalInterest = principal * monthlyRate * months;
  const monthlyPrincipal = principal / months;
  const monthlyInterest = totalInterest / months;
  const payment = monthlyPrincipal + monthlyInterest;

  const rows: ScheduleRow[] = [];
  let balance = principal;
  for (let period = 1; period <= months; period++) {
    balance = Math.max(0, balance - monthlyPrincipal);
    rows.push({ period, payment, principal: monthlyPrincipal, interest: monthlyInterest, balance });
  }
  return { payment, rows };
}

/** UI V2.1 玻璃二级页头：ScreenHeader 的返回键是透明 44 触控区，这里在它底下垫一枚 44 玻璃圆钮（稿） */
function GlassBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { spacing } = useTheme();
  const { pagePadding } = useLayout();
  return (
    <View>
      <View pointerEvents="none" style={[st.headerGlass, { left: pagePadding, top: spacing.sm }]}>
        <GlassView intensity={WEB_GLASS_INTENSITY} radius={999} style={st.headerGlassInner} />
      </View>
      <ScreenHeader variant="compact" title={title} onBack={onBack} />
    </View>
  );
}

export default function LoanCalculatorScreen({ navigation }: any) {
  const { decimalPlaces } = useApp();
  const { semantic, spacing, isDark } = useTheme();
  const { pagePadding } = useLayout();
  const t = useT();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();

  const [principalStr, setPrincipalStr] = useState('');
  const [rateStr, setRateStr] = useState('');
  const [yearsStr, setYearsStr] = useState('');
  const [method, setMethod] = useState<Method>('reducing');
  const [showSchedule, setShowSchedule] = useState(false);

  const principal = parseFloat(principalStr) || 0;
  const annualRate = parseFloat(rateStr) || 0;
  const years = parseFloat(yearsStr) || 0;
  const months = Math.max(0, Math.round(years * 12));
  const monthlyRate = annualRate / 100 / 12;

  const result = useMemo(() => {
    if (principal <= 0 || months <= 0) return null;
    if (method === 'reducing') {
      const { payment, rows } = buildReducingSchedule(principal, monthlyRate, months);
      const totalPaid = rows.reduce((s, r) => s + r.payment, 0);
      return {
        firstPayment: payment,
        lastPayment: payment,
        totalInterest: totalPaid - principal,
        totalPaid,
        rows,
      };
    } else if (method === 'straight') {
      const { rows } = buildStraightSchedule(principal, monthlyRate, months);
      const totalPaid = rows.reduce((s, r) => s + r.payment, 0);
      return {
        firstPayment: rows[0].payment,
        lastPayment: rows[rows.length - 1].payment,
        totalInterest: totalPaid - principal,
        totalPaid,
        rows,
      };
    } else {
      const { payment, rows } = buildFlatSchedule(principal, monthlyRate, months);
      const totalPaid = rows.reduce((s, r) => s + r.payment, 0);
      return {
        firstPayment: payment,
        lastPayment: payment,
        totalInterest: totalPaid - principal,
        totalPaid,
        rows,
      };
    }
  }, [principal, monthlyRate, months, method]);

  const METHODS: { key: Method; label: string; sub: string }[] = [
    { key: 'reducing', label: t('addTx.loanMethodReducing'), sub: t('addTx.loanMethodReducingSub') },
    { key: 'straight', label: t('addTx.loanMethodStraight'), sub: t('addTx.loanMethodStraightSub') },
    { key: 'flat', label: t('addTx.loanMethodFlat'), sub: t('addTx.loanMethodFlatSub') },
  ];

  return (
    <SafeAreaView style={[st.container, { backgroundColor: semantic.bg }]} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      <HeroGradient fill />
      <GlassBackHeader title={t('addTx.loanCalc')} onBack={() => navigation.goBack()} />

      {/* 表单页：键盘弹出不遮住输入框 */}
      <KeyboardAvoidingView style={st.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          onScroll={onTabScroll ?? undefined}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: tabClearance + spacing.xl, gap: spacing.md }}
        >
          {/* 输入组：一张玻璃卡，胶囊输入框（§2） */}
          <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={[st.card, { gap: spacing.md }]}>
            <View>
              <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                {t('addTx.loanPrincipal')}
              </AppText>
              <TextInput
                style={[st.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                value={principalStr}
                onChangeText={setPrincipalStr}
                keyboardType="numeric"
                placeholder={t('addTx.loanPrincipalPh')}
                placeholderTextColor={semantic.textSecondary}
              />
            </View>
            <View style={st.row}>
              <View style={st.col}>
                <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                  {t('addTx.calcRate')}
                </AppText>
                <TextInput
                  style={[st.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                  value={rateStr}
                  onChangeText={setRateStr}
                  keyboardType="numeric"
                  placeholder={t('addTx.calcRatePhLoan')}
                  placeholderTextColor={semantic.textSecondary}
                />
              </View>
              <View style={st.col}>
                <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                  {t('addTx.calcYears')}
                </AppText>
                <TextInput
                  style={[st.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                  value={yearsStr}
                  onChangeText={setYearsStr}
                  keyboardType="numeric"
                  placeholder={t('addTx.calcYearsPhLoan')}
                  placeholderTextColor={semantic.textSecondary}
                />
              </View>
            </View>

            {/* 还款方式：三选一（选中 = accentSoft 底 + accent 渐变圆点） */}
            <View>
              <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                {t('addTx.loanMethod')}
              </AppText>
              <View style={{ gap: spacing.sm }}>
                {METHODS.map((m) => {
                  const active = method === m.key;
                  return (
                    <PressableScale
                      key={m.key}
                      activeScale={0.98}
                      onPress={() => setMethod(m.key)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={m.label}
                    >
                      <View
                        style={[
                          st.methodRow,
                          { backgroundColor: active ? semantic.accentSoft : 'transparent' },
                        ]}
                      >
                        <View style={st.methodText}>
                          <AppText variant="subhead" weight="600" numberOfLines={1}>
                            {m.label}
                          </AppText>
                          <AppText variant="caption" color={semantic.textSecondary} numberOfLines={1}>
                            {m.sub}
                          </AppText>
                        </View>
                        <Ionicons
                          name={active ? 'radio-button-on' : 'radio-button-off'}
                          size={20}
                          color={active ? semantic.textPrimary : semantic.textSecondary}
                        />
                      </View>
                    </PressableScale>
                  );
                })}
              </View>
            </View>
          </GlassView>

          {result ? (
            <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={st.card}>
              <AppText variant="footnote" color={semantic.textSecondary} align="center">
                {method === 'straight' ? t('addTx.loanFirstPayment') : t('addTx.loanMonthlyPayment')}
              </AppText>
              <AppText variant="title2" align="center" style={st.resultValue}>
                {fmt(result.firstPayment, decimalPlaces)}
              </AppText>
              <View style={[st.divider, { backgroundColor: semantic.hairline }]} />
              {method === 'straight' && (
                <View style={st.resultRow}>
                  <AppText variant="footnote" color={semantic.textSecondary}>
                    {t('addTx.loanLastPayment')}
                  </AppText>
                  <AppText variant="subhead" weight="600">
                    {fmt(result.lastPayment, decimalPlaces)}
                  </AppText>
                </View>
              )}
              <View style={st.resultRow}>
                <AppText variant="footnote" color={semantic.textSecondary}>
                  {t('addTx.loanTotalPaid')}
                </AppText>
                <AppText variant="subhead" weight="600">
                  {fmt(result.totalPaid, decimalPlaces)}
                </AppText>
              </View>
              <View style={st.resultRow}>
                <AppText variant="footnote" color={semantic.textSecondary}>
                  {t('addTx.calcTotalInterest')}
                </AppText>
                <AppText variant="subhead" weight="600">
                  {fmt(result.totalInterest, decimalPlaces)}
                </AppText>
              </View>

              {/* 每月明细：玻璃胶囊开关 + 表（表头 caption / 单元格 caption） */}
              <PressableScale
                style={{ marginTop: spacing.md }}
                activeScale={0.97}
                onPress={() => setShowSchedule((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  showSchedule
                    ? t('addTx.loanScheduleHide')
                    : t('addTx.loanScheduleShow', { count: months })
                }
              >
                <GlassView intensity={WEB_GLASS_INTENSITY} radius={999} style={st.toggleBtn} shadow={false}>
                  <AppText variant="subhead" weight="600" align="center" numberOfLines={2}>
                    {showSchedule
                      ? t('addTx.loanScheduleHide')
                      : t('addTx.loanScheduleShow', { count: months })}
                  </AppText>
                  <Ionicons name={showSchedule ? 'chevron-up' : 'chevron-down'} size={18} color={semantic.textSecondary} />
                </GlassView>
              </PressableScale>

              {showSchedule && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginTop: spacing.md }}
                  contentContainerStyle={st.scheduleTable}
                >
                  <View style={st.scheduleTableInner}>
                  <View style={[st.scheduleRow, st.scheduleHeader]}>
                    <AppText variant="caption" color={semantic.textSecondary} style={[st.scheduleCell, st.periodCell]}>
                      {t('addTx.loanSchedulePeriod')}
                    </AppText>
                    <AppText variant="caption" color={semantic.textSecondary} style={st.scheduleCell}>
                      {t('addTx.loanSchedulePayment')}
                    </AppText>
                    <AppText variant="caption" color={semantic.textSecondary} style={st.scheduleCell}>
                      {t('addTx.loanSchedulePrincipal')}
                    </AppText>
                    <AppText variant="caption" color={semantic.textSecondary} style={st.scheduleCell}>
                      {t('addTx.loanScheduleInterest')}
                    </AppText>
                    <AppText
                      variant="caption"
                      color={semantic.textSecondary}
                      style={[st.scheduleCell, st.balanceCell]}
                    >
                      {t('addTx.loanScheduleBalance')}
                    </AppText>
                  </View>
                  {result.rows.map((r) => (
                    <View key={r.period} style={st.scheduleRow}>
                      <AppText variant="caption" style={[st.scheduleCell, st.periodCell]}>
                        {r.period}
                      </AppText>
                      <AppText variant="caption" style={st.scheduleCell}>
                        {fmt(r.payment, decimalPlaces)}
                      </AppText>
                      <AppText variant="caption" style={st.scheduleCell}>
                        {fmt(r.principal, decimalPlaces)}
                      </AppText>
                      <AppText variant="caption" style={st.scheduleCell}>
                        {fmt(r.interest, decimalPlaces)}
                      </AppText>
                      <AppText variant="caption" style={[st.scheduleCell, st.balanceCell]}>
                        {fmt(r.balance, decimalPlaces)}
                      </AppText>
                    </View>
                  ))}
                  </View>
                </ScrollView>
              )}
            </GlassView>
          ) : (
            <AppText variant="footnote" color={semantic.textSecondary} align="center" style={st.hint}>
              {t('addTx.calcEnterHint')}
            </AppText>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  headerGlass: { position: 'absolute', width: 44, height: 44 },
  headerGlassInner: { width: 44, height: 44 },
  card: { padding: 16 },
  fieldLabel: { marginBottom: 6 },
  // 胶囊输入框（§2：输入框 radius 999）
  input: {
    height: 50,
    borderRadius: 999,
    paddingHorizontal: 16,
    fontSize: 15,
  },
  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  methodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 52,
  },
  methodText: { flex: 1, minWidth: 0, gap: 2 },
  resultValue: { marginTop: 6 },
  divider: { height: 1, marginVertical: 14, alignSelf: 'stretch' },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', paddingVertical: 4, gap: 12 },
  toggleBtn: {
    minHeight: 46,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3 },
  scheduleHeader: { paddingBottom: 6 },
  // 5 列数字表在窄屏无法均分：原先 flex:1 且无内边距，320 宽下每列仅 ~55px，
  // 而 998,646.88 这类金额需 ~70px → 右对齐文字向左溢出并贴住前一列
  // （实测字形间隙为 0，渲染成 4,978.121,353.123,625.00998,646.88）。
  // 改为固定列宽 + 左右内边距 + 等宽数字；超出容器时由外层横向滚动兜底。
  scheduleCell: {
    width: 70,
    textAlign: 'right',
    paddingHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  periodCell: { width: 36, textAlign: 'left' },
  balanceCell: { width: 78 },
  scheduleTable: { flexGrow: 1 },
  scheduleTableInner: { minWidth: '100%' },
  hint: { marginTop: 24 },
});
