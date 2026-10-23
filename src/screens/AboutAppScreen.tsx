import React from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';

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
import Constants from 'expo-constants';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useT } from '../i18n/LanguageContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import PressableScale from '../components/PressableScale';
import { AppText, GlassView, HeroGradient, IconCircle, ScreenHeader } from '../components/ui';

// 版本号统一从 app.json 读取，避免页面里硬编码后跟配置脱节
const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';


/** UI V2.1 玻璃二级页头：ScreenHeader 的返回键是透明 44 触控区，这里在它底下垫一枚 44 玻璃圆钮（稿） */
function GlassBackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  const { spacing } = useTheme();
  const { pagePadding } = useLayout();
  return (
    <View>
      <View pointerEvents="none" style={[styles.headerGlass, { left: pagePadding, top: spacing.sm }]}>
        <GlassView intensity={WEB_GLASS_INTENSITY} radius={999} style={styles.headerGlassInner} />
      </View>
      <ScreenHeader variant="compact" title={title} onBack={onBack} />
    </View>
  );
}

export default function AboutAppScreen({ navigation }: any) {
  const { semantic, spacing, isDark } = useTheme();
  const t = useT();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}>
      <HeroGradient fill />
      <GlassBackHeader title={t('addTx.aboutTitle')} onBack={() => navigation.goBack()} />

      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingBottom: tabClearance, paddingHorizontal: spacing.xl }]}
      >
        {/* App 图标位：§5 立体光泽球（品牌色） */}
        <IconCircle size={64} color={semantic.accent} icon="wallet-outline" />
        <AppText variant="title2" style={styles.appName}>
          Personal Finance
        </AppText>
        <AppText variant="footnote" color={semantic.textSecondary} style={styles.version}>
          {t('profile.version', { version: APP_VERSION })}
        </AppText>

        <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={styles.card}>
          <Row label={t('addTx.currentVersion')} value={APP_VERSION} muted={semantic.textSecondary} />
          <Row label={t('addTx.whatsNew')} value={t('addTx.whatsNewValue')} muted={semantic.textSecondary} wrap />
          <TouchableOpacity
            style={styles.actionRow}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={t('addTx.checkUpdate')}
          >
            <AppText variant="subhead" color={semantic.textSecondary}>
              {t('addTx.checkUpdate')}
            </AppText>
            <Ionicons name="chevron-forward" size={18} color={semantic.textSecondary} />
          </TouchableOpacity>
        </GlassView>

        <AppText variant="caption" color={semantic.textSecondary} style={styles.footer}>
          © 2026 Personal Finance
        </AppText>
      </ScrollView>
    </SafeAreaView>
  );
}

// 信息行：单行左右布局（标签左、值右），压低行高让整页一屏放完
function Row({
  label,
  value,
  muted,
  wrap,
}: {
  label: string;
  value: string;
  muted: string;
  wrap?: boolean;
}) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="subhead" color={muted}>
        {label}
      </AppText>
      <AppText
        variant="subhead"
        weight="500"
        align="right"
        style={wrap ? styles.valueWrap : undefined}
        numberOfLines={wrap ? 3 : 1}
      >
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerGlass: { position: 'absolute', width: 44, height: 44 },
  headerGlassInner: { width: 44, height: 44 },
  content: { alignItems: 'center', paddingTop: 16 },
  appName: { marginTop: 12 },
  version: { marginTop: 2 },
  card: { width: '100%', marginTop: 24, paddingHorizontal: 16 },
  infoRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  // 长文案（如"更新内容"）：右对齐并允许换行，行高收紧保持行距一致
  valueWrap: { flex: 1 },
  actionRow: {
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: { marginTop: 20 },
});
