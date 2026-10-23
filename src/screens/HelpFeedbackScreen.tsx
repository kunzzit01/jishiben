import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
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
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useDialog } from '../components/AppDialog';
import { useT } from '../i18n/LanguageContext';
import { useTabClearance } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import PressableScale from '../components/PressableScale';
import { AppText, Card, GlassView, HeroGradient, ScreenHeader } from '../components/ui';

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

export default function HelpFeedbackScreen({ navigation }: any) {
  const { semantic, spacing, gradients, isDark } = useTheme();
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const [feedback, setFeedback] = useState('');

  const submitFeedback = () => {
    if (!feedback.trim()) {
      dialog.alert({ title: t('addTx.enterFeedback') });
      return;
    }
    dialog.alert({ title: t('addTx.submitOk'), message: t('addTx.submitThanks') });
    setFeedback('');
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      <HeroGradient fill />
      <GlassBackHeader title={t('addTx.helpTitle')} onBack={() => navigation.goBack()} />

      {/* 表单页：键盘弹出不遮住输入框与提交键 */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          onScroll={onTabScroll ?? undefined}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: tabClearance, paddingHorizontal: spacing.xl }]}
        >
          <AppText variant="footnote" color={semantic.textSecondary} style={styles.sectionTitle}>
            {t('addTx.faq')}
          </AppText>
          {/* 实色 Card，不再用玻璃：这一页有输入框，玻璃的「模糊 + 白色叠层」会把框里文字洗淡
              （用户反馈「蒙」）。玻璃留给页头那枚 44 圆钮与浮空 Tab 栏，内容卡一律走 surface。 */}
          <Card style={styles.card}>
            <Row label={t('addTx.faqAdd')} muted={semantic.textSecondary} />
            <Row label={t('addTx.faqSwitch')} muted={semantic.textSecondary} />
            <Row label={t('addTx.faqAssets')} muted={semantic.textSecondary} />
          </Card>

          <AppText variant="footnote" color={semantic.textSecondary} style={styles.sectionTitle}>
            {t('addTx.feedbackSection')}
          </AppText>
          <Card style={styles.feedbackCard}>
            <TextInput
              value={feedback}
              onChangeText={setFeedback}
              placeholder={t('addTx.feedbackPlaceholder')}
              placeholderTextColor={semantic.textSecondary}
              multiline
              textAlignVertical="top"
              // 原来是「玻璃卡 + 半透明 accentSoft」两层叠加，文字被洗淡（用户说的「蒙」）；
              // 同时显式关掉浏览器默认聚焦描边（那圈橙色 outline 不属于设计）。
              style={[
                styles.input,
                {
                  color: semantic.textPrimary,
                  backgroundColor: semantic.surfaceSunken,
                  borderWidth: 1,
                  borderColor: semantic.hairline,
                  outlineWidth: 0,
                },
              ]}
            />
            {/* 主按钮 = accent 渐变胶囊（§3：渐变实心按钮保持白字）；17pt 粗体走大字档 3:1 */}
            <PressableScale
              style={styles.button}
              activeScale={0.97}
              onPress={submitFeedback}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.submitFeedback')}
            >
              <LinearGradient
                colors={gradients.accent.colors}
                locations={gradients.accent.locations as [number, number, ...number[]]}
                start={gradients.accent.start}
                end={gradients.accent.end}
                style={styles.buttonFill}
              >
                <AppText variant="headline" weight="700" color={semantic.onAccent} numberOfLines={1}>
                  {t('addTx.submitFeedback')}
                </AppText>
              </LinearGradient>
            </PressableScale>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Row({ label, muted }: { label: string; muted: string }) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel={label}>
      <AppText variant="subhead" weight="500">
        {label}
      </AppText>
      <Ionicons name="chevron-forward" size={18} color={muted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  headerGlass: { position: 'absolute', width: 44, height: 44 },
  headerGlassInner: { width: 44, height: 44 },
  content: { paddingBottom: 40 },
  sectionTitle: { marginTop: 24, marginBottom: 9 },
  card: { width: '100%', paddingHorizontal: 16 },
  row: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  feedbackCard: { width: '100%', padding: 16 },
  // 多行输入不做全圆胶囊（长文本会顶着圆角），半径 24 + accentSoft 底（§2 表单填充）
  input: { minHeight: 130, borderRadius: 24, padding: 16, fontSize: 15 },
  button: { alignSelf: 'stretch', marginTop: 14 },
  buttonFill: {
    height: 54,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
});
