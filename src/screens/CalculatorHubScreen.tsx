import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';

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
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useT } from '../i18n/LanguageContext';
import { useTabClearance } from '../hooks/useTabClearance';
import PressableScale from '../components/PressableScale';
import { AppText, GlassView, HeroGradient, IconCircle, ScreenHeader } from '../components/ui';

const TOOLS: { name: string; sub: string; icon: string; color: string; route: string }[] = [
  // 名称改为运行时翻译 key（zh/en 字典 addTx.loanCalc*）
  { name: 'addTx.loanCalc', sub: 'addTx.loanCalcSub', icon: 'cash-outline', color: '#4C9AFF', route: '贷款计算器' },
  { name: 'addTx.compoundCalc', sub: 'addTx.compoundCalcSub', icon: 'trending-up-outline', color: '#66BB6A', route: '复利计算器' },
];

/** UI V2.1 玻璃二级页头：ScreenHeader 的返回键是透明 44 触控区，这里在它底下垫一枚 44 玻璃圆钮（稿） */
function GlassBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View>
      <ScreenHeader variant="compact" title={title} onBack={onBack} />
    </View>
  );
}

const headerStyles = StyleSheet.create({
  glass: { position: 'absolute', width: 44, height: 44 },
  glassInner: { width: 44, height: 44 },
});

export default function CalculatorHubScreen({ navigation }: any) {
  const { semantic, spacing, isDark } = useTheme();
  const t = useT();
  const tabClearance = useTabClearance();

  return (
    <SafeAreaView style={[s.container, { backgroundColor: semantic.bg }]} edges={['top']}>
      <HeroGradient fill />
      <GlassBackHeader title={t('addTx.calcTitle')} onBack={() => navigation.goBack()} />
      <View style={[s.content, { paddingBottom: tabClearance, paddingHorizontal: spacing.xl, gap: spacing.md }]}>
        {TOOLS.map((tool) => (
          <PressableScale
            key={tool.name}
            activeScale={0.97}
            onPress={() => navigation.navigate(tool.route)}
            accessibilityRole="button"
            accessibilityLabel={t(tool.name)}
          >
            <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={s.card}>
              {/* UI V2.1 §5：立体光泽球 */}
              <IconCircle size={48} color={tool.color} icon={tool.icon as any} />
              <View style={s.cardText}>
                <AppText variant="subhead" weight="600" numberOfLines={2}>
                  {t(tool.name)}
                </AppText>
                <AppText variant="caption" color={semantic.textSecondary} numberOfLines={2} style={s.cardSub}>
                  {t(tool.sub)}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={18} color={semantic.textSecondary} />
            </GlassView>
          </PressableScale>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 },
  cardText: { flex: 1, minWidth: 0 },
  cardSub: { marginTop: 3 },
});
