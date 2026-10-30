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

const FREQUENCIES: { key: string; value: number }[] = [
  { key: 'addTx.calcFreqYearly', value: 1 },
  { key: 'addTx.calcFreqHalf', value: 2 },
  { key: 'addTx.calcFreqQuarter', value: 4 },
  { key: 'addTx.calcFreqMonthly', value: 12 },
];

/** 金额统一走 formatMoney，小数位跟随 App 的小数位设置 */
function fmt(n: number, decimals: DecimalPlaces) {
  if (!isFinite(n)) return '--';
  return formatMoney(n, { decimals });
}

/** UI V2.1 玻璃二级页头：ScreenHeader 的返回键是透明 44 触控区，这里在它底下垫一枚 44 玻璃圆钮（稿） */
function GlassBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View>
      <ScreenHeader variant="compact" title={title} onBack={onBack} />
    </View>
  );
}

export default function CompoundInterestScreen({ navigation }: any) {
  const { decimalPlaces } = useApp();
  const { semantic, spacing, isDark } = useTheme();
  const { pagePadding } = useLayout();
  const t = useT();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();

  const [principalStr, setPrincipalStr] = useState('');
  const [rateStr, setRateStr] = useState('');
  const [yearsStr, setYearsStr] = useState('');
  const [monthlyStr, setMonthlyStr] = useState('');
  const [frequency, setFrequency] = useState(12);

  const principal = parseFloat(principalStr) || 0;
  const annualRate = parseFloat(rateStr) || 0;
  const years = parseFloat(yearsStr) || 0;
  const monthlyContribution = parseFloat(monthlyStr) || 0;

  const result = useMemo(() => {
    if (years <= 0) return null;
    const i = annualRate / 100 / frequency;
    const n = frequency * years;
    const growth = Math.pow(1 + i, n);
    const futureFromPrincipal = principal * growth;

    // 定投按频率折算：例如按季度复利，每季度实际投入的是「月定投 × 3」
    const contributionPerPeriod = monthlyContribution * (12 / frequency);
    const futureFromContributions =
      i === 0 ? contributionPerPeriod * n : contributionPerPeriod * ((growth - 1) / i);

    const futureValue = futureFromPrincipal + futureFromContributions;
    const totalContributed = principal + contributionPerPeriod * n;
    const totalInterest = futureValue - totalContributed;

    return { futureValue, totalContributed, totalInterest };
  }, [principal, annualRate, years, monthlyContribution, frequency]);

  const inputStyle = [st.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }];

  return (
    <SafeAreaView style={[st.container, { backgroundColor: semantic.bg }]} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      <HeroGradient fill />
      <GlassBackHeader title={t('addTx.compoundCalc')} onBack={() => navigation.goBack()} />

      {/* 表单页：键盘弹出不遮住输入框 */}
      <KeyboardAvoidingView style={st.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          onScroll={onTabScroll ?? undefined}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: tabClearance + spacing.xl, gap: spacing.md }}
        >
          <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={[st.card, { gap: spacing.md }]}>
            <View>
              <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                {t('addTx.calcPrincipal')}
              </AppText>
              <TextInput
                style={inputStyle}
                value={principalStr}
                onChangeText={setPrincipalStr}
                keyboardType="numeric"
                placeholder={t('addTx.calcPrincipalPh')}
                placeholderTextColor={semantic.textSecondary}
              />
            </View>

            <View style={st.row}>
              <View style={st.col}>
                <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                  {t('addTx.calcRate')}
                </AppText>
                <TextInput
                  style={inputStyle}
                  value={rateStr}
                  onChangeText={setRateStr}
                  keyboardType="numeric"
                  placeholder={t('addTx.calcRatePh')}
                  placeholderTextColor={semantic.textSecondary}
                />
              </View>
              <View style={st.col}>
                <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                  {t('addTx.calcYears')}
                </AppText>
                <TextInput
                  style={inputStyle}
                  value={yearsStr}
                  onChangeText={setYearsStr}
                  keyboardType="numeric"
                  placeholder={t('addTx.calcYearsPh')}
                  placeholderTextColor={semantic.textSecondary}
                />
              </View>
            </View>

            <View>
              <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                {t('addTx.calcMonthlyInvest')}
              </AppText>
              <TextInput
                style={inputStyle}
                value={monthlyStr}
                onChangeText={setMonthlyStr}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={semantic.textSecondary}
              />
            </View>

            {/* 复利频率：四选一胶囊（选中 = accentSoft 底 + 对勾） */}
            <View>
              <AppText variant="caption" color={semantic.textSecondary} style={st.fieldLabel}>
                {t('addTx.calcFrequency')}
              </AppText>
              <View style={st.freqWrap}>
                {FREQUENCIES.map((f) => {
                  const active = frequency === f.value;
                  return (
                    <PressableScale
                      key={f.value}
                      activeScale={0.96}
                      onPress={() => setFrequency(f.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={t(f.key)}
                    >
                      <View
                        style={[
                          st.freqPill,
                          { backgroundColor: active ? semantic.accentSoft : 'transparent' },
                        ]}
                      >
                        <AppText variant="footnote" weight={active ? '600' : '400'} numberOfLines={1}>
                          {t(f.key)}
                        </AppText>
                        {active && <Ionicons name="checkmark" size={15} color={semantic.textPrimary} />}
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
                {t('addTx.calcFutureValue')}
              </AppText>
              <AppText variant="title2" align="center" style={st.resultValue}>
                {fmt(result.futureValue, decimalPlaces)}
              </AppText>
              <View style={[st.divider, { backgroundColor: semantic.hairline }]} />
              <View style={st.resultRow}>
                <AppText variant="footnote" color={semantic.textSecondary}>
                  {t('addTx.calcTotalContributed')}
                </AppText>
                <AppText variant="subhead" weight="600">
                  {fmt(result.totalContributed, decimalPlaces)}
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
  freqWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  freqPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 999,
  },
  resultValue: { marginTop: 6 },
  divider: { height: 1, marginVertical: 14, alignSelf: 'stretch' },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch', paddingVertical: 4, gap: 12 },
  hint: { marginTop: 24 },
});
