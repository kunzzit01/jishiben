import React, { useRef, useState } from 'react';
import * as Updates from 'expo-updates';
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

type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'latest' | 'ready' | 'failed' | 'unsupported';

export default function AboutAppScreen({ navigation }: any) {
  const { semantic, spacing, isDark } = useTheme();
  const t = useT();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();

  /* ── 手动检查更新（用户 2026-10-30 要的入口） ─────────────────────────
   * 平时 expo-updates 只在冷启动检查一次；这里手动跑同一套流程：
   * 检查 → 有新版就下载（下载完成写进缓存）→ 重启生效。
   * Web / 未配置 OTA 的构建里 isEnabled 为 false，直接给出"当前构建不支持"，
   * 绝不假装在检查。                                               */
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const busyRef = useRef(false);

  const updateIdText = Updates.updateId ? Updates.updateId.slice(0, 8) : t('addTx.updateBuiltin');

  const phaseText =
    phase === 'checking'
      ? t('addTx.updateChecking')
      : phase === 'downloading'
        ? t('addTx.updateDownloading')
        : phase === 'latest'
          ? t('addTx.updateLatest')
          : phase === 'ready'
            ? t('addTx.updateReady')
            : phase === 'failed'
              ? t('addTx.updateFailed')
              : phase === 'unsupported'
                ? t('addTx.updateUnsupported')
                : '';

  const handleCheckUpdate = async () => {
    if (busyRef.current) return;
    // Web 上 expo-updates 的桩会让 isEnabled 为 true，但调用必抛 —— 显式当"不支持"处理，
    // 免得把浏览器的正常状态报成"检查失败"
    if (Platform.OS === 'web' || !Updates.isEnabled) {
      setPhase('unsupported');
      return;
    }
    busyRef.current = true;
    setPhase('checking');
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setPhase('latest');
        return;
      }
      setPhase('downloading');
      await Updates.fetchUpdateAsync();
      setPhase('ready');
    } catch {
      setPhase('failed');
    } finally {
      busyRef.current = false;
    }
  };

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
            onPress={handleCheckUpdate}
            disabled={phase === 'checking' || phase === 'downloading'}
            accessibilityRole="button"
            accessibilityLabel={t('addTx.checkUpdate')}
            testID="about-check-update"
          >
            <AppText variant="subhead" color={semantic.textSecondary}>
              {t('addTx.checkUpdate')}
            </AppText>
            <View style={styles.actionRight}>
              {phaseText ? (
                <AppText variant="footnote" color={semantic.textSecondary} numberOfLines={1}>
                  {phaseText}
                </AppText>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={semantic.textSecondary} />
            </View>
          </TouchableOpacity>

          {/* 已下载好、等重启：给出唯一的动作按钮（重启后立刻是新版本） */}
          {phase === 'ready' && (
            <TouchableOpacity
              style={styles.actionRow}
              activeOpacity={0.6}
              onPress={() => {
                Updates.reloadAsync().catch(() => setPhase('failed'));
              }}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.updateRestart')}
              testID="about-restart-update"
            >
              <AppText variant="subhead" weight="600" color={semantic.accent}>
                {t('addTx.updateRestart')}
              </AppText>
              <Ionicons name="refresh" size={18} color={semantic.accent} />
            </TouchableOpacity>
          )}

          {/* 诊断行：现在跑的是哪一份 JS（内置 / 某个 updateId）+ 哪个渠道 */}
          <Row
            label={t('addTx.updateBundleRow')}
            value={Updates.isEnabled ? updateIdText : t('addTx.updateUnsupported')}
            muted={semantic.textSecondary}
          />
          <Row
            label={t('addTx.updateChannelRow')}
            value={Updates.channel ?? '-'}
            muted={semantic.textSecondary}
          />
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
  actionRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  footer: { marginTop: 20 },
});
