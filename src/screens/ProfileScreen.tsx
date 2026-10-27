// ProfileScreen.tsx —— 设置页（T22 / 计划 5.6 P1–P4）
//
// 这一轮是「逐屏统一版式」的第一屏：**只统一呈现**，功能与交互一字未动
// （登录 / 账号页入口、PIN 创建·更改·清除、生物锁前置校验、语言即时切换、
//   深色模式三档、财务规划、帮助反馈、关于的跳转全部照旧；同步文案计算也没动）：
//   P1 页头换成设计系统的 <ScreenHeader variant="compact">（玻璃返回键 + 居中标题 + 右侧动作）
//   P2 分组统一 ListSection（surface 卡 + 组内发丝线）+ ListRow 行规格
//   P3 订阅行保持「不可点 + 即将推出」的后端桩语义，只换 ListRow 视觉
//   P4 页脚版本号 caption 档、居中
//
// 只有两行仍在页内自建（不是漏迁移，原因写在各组件注释里）：
//   · 生物识别解锁行：副标题必须整段换行、Switch 必须永远贴右（ListRow 会截断 / 换行错位）
//   · 深色模式行：标签一行 + 三档控件另起一行撑满整行（ListRow 表达不了两行结构）
//   以及三档分段控件本身（见 FullWidthSegments 的「为什么不用 SegmentedControl」）。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Constants from 'expo-constants';
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ROUTES } from '../navigation/routes';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useTabClearance, TAB_BAR_RAISE } from '../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../context/TabBarAutoHideContext';
import { useThemeMode, ThemeMode } from '../context/ThemeModeContext';
import type { Layout, Radius, SemanticColors, Spacing } from '../theme/theme';
import PinSheet, { PinSheetMode } from '../components/PinSheet';
import { useDialog } from '../components/AppDialog';
import { useAuth } from '../context/AuthContext';
import { useAppLock } from '../context/AppLockContext';
import { useLanguage, LangMode } from '../i18n/LanguageContext';
import { useT } from '../i18n/LanguageContext';
import { hapticSelection } from '../utils/haptics';
import {
  AppText,
  Badge,
  Card,
  GlassView,
  HeroGradient,
  ListRow,
  ListSection,
  ScreenHeader,
  StatusBarGlass,
  Switch,
} from '../components/ui';

/**
 * 玻璃材质（UI V2.1 §2）在 web 上的偏差修正 —— 与其它二级页同一份取值：
 * expo-blur 的 web 实现用「tint 底色」模拟模糊，intensity 100 会给夜间玻璃叠一层白 30%，
 * 令牌里的次要字全部跌破 §4 的 4.5:1；web 强度降到 8 后玻璃回到稿里的 rgba(14,10,30,.46)，
 * iOS 仍用 GlassView 默认真材质，Android 本来就没有模糊。
 */
const WEB_GLASS_INTENSITY = Platform.OS === 'web' ? 8 : undefined;

export default function ProfileScreen({ navigation }: any) {
  const { semantic, spacing, layout } = useTheme();
  const { pagePadding, contentMaxWidth } = useLayout();
  const insets = useSafeAreaInsets();
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  const { themeMode, setThemeMode } = useThemeMode();
  const { langMode, setLangMode } = useLanguage();
  const tr = useT();
  const styles = useMemo(() => makeStyles(semantic, spacing, layout), [semantic, spacing, layout]);
  // ── 账号与同步 ──
  const { user, authInitializing, syncStatus, lastSyncAt } = useAuth();

  // 同步状态一句话：同步中 / 上次同步时间 / 尚未同步 / 失败
  // (错误文案 authErrorText 与 退出登录/立即同步 都已搬进"我的账户"账号页 AuthScreen)
  const syncText = !user
    ? tr('auth.syncHint')
    : syncStatus === 'syncing'
      ? tr('auth.syncing')
      : syncStatus === 'error'
        ? tr('auth.syncFailed')
        : lastSyncAt
          ? `${tr('auth.lastSync')}` + ' ' + new Date(lastSyncAt).toLocaleString()
          : tr('auth.neverSynced');

  // 退出登录/立即同步已搬进"我的账户"账号页(AuthScreen)

  // ── Bio Lock（生物识别锁）：仅登录后可开启 ──
  const { bioEnabled, bioReady, setBioEnabled, hasPin, clearPin } = useAppLock();
  const dialog = useDialog();

  const applyBio = async (v: boolean) => {
    if (v && !bioReady) {
      dialog.alert({ title: tr('lock.bioToggle'), message: tr('lock.notReadyMsg') });
      return;
    }
    // 开启生物锁必须已有二级密码：没有就先走 PinSheet 创建，成功后自动开启（用户定版）
    if (v && !hasPin) {
      dialog.alert({ title: tr('lock.bioToggle'), message: tr('lock.needPinFirst') });
      bioPendingEnableRef.current = true;
      setPinSheetMode('create');
      setPinSheetVisible(true);
      return;
    }
    await setBioEnabled(v);
  };

  // ── 二级密码（6 位 PIN）：设置 / 更改 / 清除，统一走 PinSheet ──
  const [pinSheetVisible, setPinSheetVisible] = useState(false);
  const [pinSheetMode, setPinSheetMode] = useState<PinSheetMode>('create');
  // 「清除」意图标记：change 流程旧 PIN 验证通过后（onVerified）直接清除而非创建新 PIN
  const pinClearModeRef = useRef(false);
  // 「为开生物锁而创建 PIN」标记：PinSheet 创建成功后自动开启生物锁
  const bioPendingEnableRef = useRef(false);

  // 二级密码行：未设 → 直接进 create；已设 → 主题化弹窗选择「更改 / 清除」（用户定版）
  const handlePinRowPress = () => {
    if (!hasPin) {
      setPinSheetMode('create');
      setPinSheetVisible(true);
      return;
    }
    dialog.alert({
      title: tr('pin.settingsTitle'),
      message: tr('pin.chooseAction'),
      // 竖排按钮顺序（Verify 建议）：取消在上、常规操作居中、危险的红/清除放最下
      buttons: [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('pin.change'), style: 'default', onPress: openPinChange },
        {
          text: tr('pin.clear'),
          style: 'destructive',
          onPress: () => {
            // 清除前需验证原身份：走 change 流程（先验旧 PIN），验证通过后直接清除
            pinClearModeRef.current = true;
            setPinSheetMode('change');
            setPinSheetVisible(true);
          },
        },
      ],
    });
  };
  const openPinChange = () => {
    setPinSheetMode('change');
    setPinSheetVisible(true);
  };

  // 版本号读 app.json 的 expo.version，不硬编码
  const appVersion = (Constants.expoConfig?.version as string | undefined) ?? '1.0.0';

  // 根页不显示返回键：只看**本栈**能不能回退。
  // ⚠ 不能用 navigation.canGoBack()：它会一路冒泡到父导航器 —— 从首页切到设置 Tab 之后，
  //   Tab 导航器的 index 已经不是 0，canGoBack() 就变成 true，于是根页会冒出一枚
  //   「回首页」的返回键（语义错：设置不是从首页进去的二级页）。本栈 index 为 0 才是根。
  const canGoBackInStack = ((navigation?.getState?.()?.index as number | undefined) ?? 0) > 0;

  // 平板 / 宽屏：页头与内容一起居中收窄（页头不在 ScrollView 里，得各自套同一份框架样式）
  const frameStyle = contentMaxWidth
    ? { width: '100%' as const, maxWidth: contentMaxWidth, alignSelf: 'center' as const }
    : undefined;

  return (
    // 全出血（同首页 / 资产页 / 统计页）：渐变通到屏幕顶，内容自己用 insets.top 让开状态栏
    <SafeAreaView style={styles.container} edges={[]}>
      {/* UI V2.1 §1：品牌渐变铺满整页（fill），卡片 / 列表直接浮在渐变上 */}
      <HeroGradient fill />
      {/* C1：顶部安全区挡板 —— 滚动时内容不从状态栏文字下穿过 */}
      <StatusBarGlass />

      {/* 页头：设计系统唯一的二级页头（玻璃返回键 + 居中标题），
          与类别管理页 / 帮助反馈页同一枚「44 玻璃圆钮垫在透明返回键底下」的画法。
          稿 05 屏（个人设置）的页头只有标题、没有右侧动作；「帮助与反馈」在「支持」分组里已有入口。
          根页不显示返回键：本页是 ProfileStack 根页，栈里没有上一屏 —— 一枚只会「回首页」的返回键
          语义是错的（用户会以为设置是从首页进来的二级页）；被 push 进别的栈时返回键与玻璃圆钮才出现。 */}
      <View style={[frameStyle, { paddingTop: insets.top }]}>
        <GlassBackHeader
          title={tr('profile.title')}
          onBack={canGoBackInStack ? () => navigation.goBack() : undefined}
        />
      </View>

      <ScrollView
        onScroll={onTabScroll ?? undefined}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        style={frameStyle}
        contentContainerStyle={{
          paddingHorizontal: pagePadding,
          paddingBottom: tabClearance + TAB_BAR_RAISE + spacing.huge,
        }}
      >
        {/* 资料卡（= 账号页入口）：surface 卡 + 令牌圆角/内衬；头像走 RowIcon（下沉蓝圆 + 强调色线条图标）；
            邮箱 + 同步状态两行；点击仍进原账号页（按下反馈由 Card 提供） */}
        <Card
          onPress={authInitializing ? undefined : () => navigation.navigate(ROUTES.AUTH)}
          accessibilityLabel={
            authInitializing
              ? tr('auth.busy')
              : user
                ? tr('auth.title') + ' ' + user.email
                : tr('auth.signInOrUp')
          }
          style={styles.accountCard}
          testID="profile-account-card"
        >
          <View style={styles.accountRow}>
            <RowIcon size={48} icon="person" tone="accent" />
            <View style={styles.accountTextBlock}>
              <AppText variant="headline" numberOfLines={2}>
                {authInitializing ? tr('auth.busy') : user ? user.email : tr('auth.signInOrUp')}
              </AppText>
              {/* 副行：登录后是同步状态一句话；未登录是登录说明。说明文字随内容换行（不截断） */}
              {!authInitializing && (
                <AppText variant="footnote" color={semantic.textSecondary} style={styles.accountSub}>
                  {user ? syncText : tr('auth.subtitle')}
                </AppText>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={semantic.textTertiary} />
          </View>
        </Card>

        {/* P2 安全分组（登录后可见）：生物识别锁改 Switch；二级密码保留「当前值 + chevron」 */}
        {!authInitializing && user && (
          <ListSection title={tr('profile.security')} style={styles.section} testID="profile-security">
            <SwitchRow
              icon="finger-print-outline"
              title={tr('lock.bioToggle')}
              subtitle={tr('lock.bioHint')}
              value={bioEnabled}
              onValueChange={(v) => {
                void applyBio(v);
              }}
              testID="profile-bio-row"
            />
            <ListRow
              leading={<RowIcon icon="key-outline" />}
              title={tr('pin.settingsTitle')}
              value={hasPin ? tr('pin.setup') : tr('pin.none')}
              chevron
              onPress={handlePinRowPress}
              testID="profile-pin-row"
            />
          </ListSection>
        )}

        {/* 外观分组：只放深色模式（语言不属于外观，见下「通用」分组） */}
        <ListSection title={tr('profile.appearance')} style={styles.section} testID="profile-appearance">
          <AppearanceRow label={tr('profile.darkMode')}>
            <FullWidthSegments
              options={[
                { label: tr('theme.segSystem'), value: 'system' },
                { label: tr('theme.segLight'), value: 'light' },
                { label: tr('theme.segDark'), value: 'dark' },
              ]}
              selected={themeMode}
              // 震动由控件内部发（切档时 selection 一次），这里不再重复触发
              onSelect={(v) => setThemeMode(v as ThemeMode)}
              testID="profile-theme-segments"
            />
          </AppearanceRow>
        </ListSection>

        {/* 通用分组：语言（中 / EN 分段在行右侧）+ 财务规划 › + 订阅（灰 + 即将推出） */}
        <ListSection title={tr('profile.general')} style={styles.section} testID="profile-general">
          <ListRow
            leading={<RowIcon icon="language-outline" />}
            title={tr('profile.language')}
            trailing={
              <LanguageSegments
                options={[
                  { label: tr('lang.segZh'), value: 'zh' },
                  { label: tr('lang.segEn'), value: 'en' },
                ]}
                selected={langMode === 'system' ? 'zh' : langMode}
                onSelect={(v) => setLangMode(v as LangMode)}
                testID="profile-language-segments"
              />
            }
            testID="profile-language-row"
          />
          <ListRow
            leading={<RowIcon icon="pie-chart-outline" />}
            title={tr('finance.title')}
            chevron
            onPress={() => navigation.navigate(ROUTES.FINANCE_PLAN)}
            testID="profile-finance-row"
          />
          {/* 订阅（Premium）：后端还是桩 → 行不可点 + 「即将推出」徽章（语义未变，只换视觉） */}
          <ListRow
            leading={<RowIcon icon="star-outline" />}
            title={tr('profile.subscribe')}
            trailing={<Badge label={tr('profile.subscribeSub')} />}
            disabled
            testID="profile-subscribe-row"
          />
        </ListSection>

        {/* 功能分组：AI 专区入口 —— AIScreen 已双注册在 HomeStack / ProfileStack
            （App.tsx 的 ROUTES.AI），但全仓一直没有 navigate(ROUTES.AI)，等于「有页面、没入口」；
            这里补上设置页的正式入口。行规格直接复用 ListRow（同高 / 同内衬 / 同 chevron），不另画。 */}
        <ListSection title={tr('profile.features')} style={styles.section} testID="profile-features">
          <ListRow
            leading={<RowIcon icon="sparkles-outline" tone="accent" />}
            title={tr('profile.aiZone')}
            chevron
            onPress={() => navigation.navigate(ROUTES.AI)}
            testID="profile-ai-row"
          />
          {/* 概览模式（设计稿第 11 屏）：OverviewScreen 双注册在 HomeStack / ProfileStack
              （App.tsx 的 ROUTES.OVERVIEW）。设计稿第 11 屏自身没有入口提示、首页不在本任务可改
              范围内（Boundary），所以入口落在设置项「功能」分组，与 AI 专区同组同规格。 */}
          <ListRow
            leading={<RowIcon icon="grid-outline" />}
            title={tr('profile.overview')}
            chevron
            onPress={() => navigation.navigate(ROUTES.OVERVIEW)}
            testID="profile-overview-row"
          />
          {/* 计算器（贷款 / 复利）：CalculatorHubScreen 在 App.tsx 双注册，但此前全仓没有
              任何 navigate(ROUTES.CALCULATOR) —— 功能存在却无法到达（评审实测：设置页与
              财务规划页都没有入口）。入口补在「功能」分组，与 AI 专区 / 概览模式同规格。 */}
          <ListRow
            leading={<RowIcon icon="calculator-outline" />}
            title={tr('profile.calculators')}
            chevron
            onPress={() => navigation.navigate(ROUTES.CALCULATOR)}
            testID="profile-calculators-row"
          />
        </ListSection>

        {/* 支持：帮助与反馈 / 关于应用 */}
        <ListSection title={tr('profile.support')} style={styles.section} testID="profile-support">
          <ListRow
            leading={<RowIcon icon="chatbubble-ellipses-outline" />}
            title={tr('profile.help')}
            chevron
            onPress={() => navigation.navigate(ROUTES.FEEDBACK)}
            testID="profile-help-row"
          />
          <ListRow
            leading={<RowIcon icon="information-circle-outline" />}
            title={tr('profile.about')}
            chevron
            onPress={() => navigation.navigate(ROUTES.ABOUT)}
            testID="profile-about-row"
          />
        </ListSection>

        {/* P4 页脚版本号：caption 档、居中（中文写「版本 1.0.0」，英文 Version 1.0.0）；
            色走 textSecondary —— §3 规定 textTertiary 只给 ≥13pt，caption 12pt 用它只有 4.35:1 */}
        <AppText variant="caption" color={semantic.textSecondary} align="center" style={styles.footer}>
          {tr('profile.version', { version: appVersion })}
        </AppText>
      </ScrollView>

      {/* 二级密码键盘弹层：create=首次设置（不再要求生物识别前置）；change=先验旧 PIN（onVerified）再创建；
          验证通过且处于清除模式时直接清除 */}
      <PinSheet
        visible={pinSheetVisible}
        mode={pinSheetMode}
        onClose={() => {
          setPinSheetVisible(false);
          pinClearModeRef.current = false;
          bioPendingEnableRef.current = false;
        }}
        onSuccess={() => {
          // create/change 完成后无需额外处理（PinSheet 内部已 setPin）；
          // 若本轮是"为开生物锁而建 PIN"，建完自动开启
          if (bioPendingEnableRef.current) {
            bioPendingEnableRef.current = false;
            void setBioEnabled(true);
          }
        }}
        onVerified={() => {
          // change 模式旧 PIN 已验证：若本轮是「清除」意图则先同步关弹层，再异步清除存储
          if (pinClearModeRef.current) {
            pinClearModeRef.current = false;
            setPinSheetVisible(false);
            void (async () => {
              await clearPin();
              dialog.alert({ title: tr('pin.settingsTitle'), message: tr('pin.cleared') });
            })();
          }
        }}
      />
    </SafeAreaView>
  );
}

/** 页头玻璃圆钮的纯几何（与 ScreenHeader 左侧槽位对齐；颜色 / 材质在 GlassView 内） */
const glassHeaderStyles = StyleSheet.create({
  glass: { position: 'absolute', width: 44, height: 44 },
  glassInner: { width: 44, height: 44 },
});

/**
 * UI V2.1 玻璃二级页头：ScreenHeader 的返回键是透明 44 触控区，
 * 这里在它底下垫一枚 44 玻璃圆钮（与帮助反馈页 / 类别管理页同一套画法与定位）。
 * 没有可返回的上一屏（Tab 根页）时不传 onBack：返回键与垫底玻璃圆钮一起不渲染。
 */
function GlassBackHeader({
  title,
  onBack,
}: {
  title: string;
  /** 缺省 = 没有可返回的上一屏（Tab 根页），返回键与玻璃圆钮都不画 */
  onBack?: () => void;
}) {
  const { spacing } = useTheme();
  const { pagePadding } = useLayout();
  return (
    <View>
      {onBack ? (
        <View
          pointerEvents="none"
          style={[glassHeaderStyles.glass, { left: pagePadding, top: spacing.sm }]}
        >
          <GlassView
            intensity={WEB_GLASS_INTENSITY}
            radius={999}
            style={glassHeaderStyles.glassInner}
          />
        </View>
      ) : null}
      <ScreenHeader variant="compact" title={title} onBack={onBack} testID="profile-header" />
    </View>
  );
}

/**
 * 外观行整行三选一（页面内自建 —— 验收退回「撑满整行」+ 验收口径第 1 条）。
 * 为什么不用 SegmentedControl：它的 touchWrap 是 alignSelf: 'flex-start'（内容宽度），
 * 父级怎么包 flex 都撑不开（align-self 覆盖父级 align-items，已实测：三种包法都无效）；
 * 撑满要靠组件自己的 stretch 档，而该档在车道 B（ui/add）分支、尚未合并，本车道又不改该文件。
 * 所以这里按同一套规格自建一个「整行三等分」版本：
 *   槽 hairline 底 + radius.full + 36 高 + 内衬 3、滑块 accent 实底、文字 footnote
 *   （选中 onAccent/600、未选中 textSecondary/400）、触控高 44、首帧不播动画、
 *   切档 selection 震动、读屏报「已选中」—— 与 SegmentedControl 逐项一致，只多一个「段等分撑满」。
 * ⚠ 车道 B 的 stretch 合并后，本组件可以删掉、换回共享 SegmentedControl 的 stretch 档。
 */
/** 槽内边距（与 SegmentedControl 同规格：滑块贴槽内缘 3） */
const SEG_TRACK_PADDING = 3;
/** 槽高（与 SegmentedControl 同规格） */
const SEG_TRACK_HEIGHT = 36;
/** 触控区高度下限（UI_RULES：可点元素 ≥44pt） */
const SEG_TOUCH_HEIGHT = 44;

function FullWidthSegments({
  options,
  selected,
  onSelect,
  testID,
}: {
  options: { label: string; value: string }[];
  selected: string;
  onSelect: (value: string) => void;
  testID?: string;
}) {
  const { semantic, radius, motion, gradients } = useTheme();
  const segStyles = useMemo(() => makeSegStyles(semantic, radius), [semantic, radius]);

  // 段宽靠槽实测宽等分（每段 flex:1，等宽是结构决定的，不需要逐段实测）
  const [trackWidth, setTrackWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === selected)
  );
  const segWidth = trackWidth > 0 ? (trackWidth - SEG_TRACK_PADDING * 2) / options.length : 0;
  const ready = segWidth > 0;

  const thumbX = useSharedValue(0);
  const thumbWidth = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);
  const positioned = useRef(false);

  useEffect(() => {
    if (!ready) return;
    const targetX = SEG_TRACK_PADDING + index * segWidth;
    // 首帧（槽宽刚测到）：不播动画直接落位再淡入，避免滑块从 0 位滑过去
    if (!positioned.current) {
      positioned.current = true;
      thumbX.value = targetX;
      thumbWidth.value = segWidth;
      thumbOpacity.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
      return;
    }
    // 动画中再点：withSpring 直接改目标（Reanimated 重定向），不卡死、不重复触发
    thumbX.value = withSpring(targetX, motion.spring.default);
    thumbWidth.value = withSpring(segWidth, motion.spring.default);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, index, segWidth]);

  const thumbStyle = useAnimatedStyle(() => ({
    width: thumbWidth.value,
    opacity: thumbOpacity.value,
    transform: [{ translateX: thumbX.value }],
  }));

  return (
    <View style={segStyles.touch} testID={testID}>
      <View
        style={segStyles.track}
        onLayout={(e) => {
          const w = Math.round(e.nativeEvent.layout.width);
          if (w !== trackWidth) setTrackWidth(w);
        }}
      >
        <Animated.View style={[segStyles.thumb, thumbStyle]} pointerEvents="none">
          {/* 选中块 = accent 渐变 + 白字（UI V2 稿的「深色模式」三选一） */}
          <LinearGradient
            colors={gradients.accent.colors}
            locations={gradients.accent.locations as [number, number, ...number[]]}
            start={gradients.accent.start}
            end={gradients.accent.end}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        {options.map((opt) => {
          const isActive = opt.value === selected;
          return (
            <TouchableOpacity
              key={opt.value}
              style={segStyles.segment}
              activeOpacity={0.75}
              onPress={() => {
                if (!isActive) hapticSelection();
                onSelect(opt.value);
              }}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: isActive }}
            >
              <AppText
                variant="footnote"
                weight={isActive ? '600' : '400'}
                color={isActive ? semantic.onAccent : semantic.textSecondary}
                align="center"
                numberOfLines={1}
              >
                {opt.label}
              </AppText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** 分段控件外观（与 SegmentedControl 同规格；颜色 / 圆角全部取令牌） */
function makeSegStyles(semantic: SemanticColors, radius: Radius) {
  return StyleSheet.create({
    // 外侧留白：把触控区从 36 撑到 44，视觉轨道仍是 36（同 SegmentedControl）
    touch: { paddingVertical: (SEG_TOUCH_HEIGHT - SEG_TRACK_HEIGHT) / 2 },
    track: {
      flexDirection: 'row',
      // 槽底：稿里的卡片配色（夜 #1E1E27 / 日 #F1F0F6）→ 令牌的「凹底」档 surfaceSunken
      backgroundColor: semantic.surfaceSunken,
      borderRadius: radius.full,
      padding: SEG_TRACK_PADDING,
      minHeight: SEG_TRACK_HEIGHT,
      alignItems: 'center',
    },
    // 滑块底色由 accent 渐变子层自绘（见 JSX），这里只管位置与圆角
    thumb: {
      position: 'absolute',
      top: SEG_TRACK_PADDING,
      bottom: SEG_TRACK_PADDING,
      left: 0,
      borderRadius: radius.full,
      overflow: 'hidden',
    },
    // 段等分撑满：3 档各占槽宽 1/3（共享件的 stretch 档同款写法）
    segment: {
      flex: 1,
      minHeight: SEG_TRACK_HEIGHT - SEG_TRACK_PADDING * 2,
      paddingHorizontal: SEG_TRACK_PADDING,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
}

/** 设置行左侧圆形图标直径（38 圆 + 18 图标 —— 与首页账单行的行首圆同一套尺寸） */
const ROW_ICON_SIZE = 38;
/** 行首圆内的图标直径（38 → 18，同首页账单行） */
const ROW_ICON_GLYPH = 18;

/** RowIcon 的样式（令牌进、StyleSheet 出）：圆底 = 「下沉底」surfaceSunken，与首页账单行同一档 */
function makeIconStyles(semantic: SemanticColors, radius: Radius) {
  return StyleSheet.create({
    circle: {
      borderRadius: radius.full,
      backgroundColor: semantic.surfaceSunken,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
  });
}

/**
 * 设置行首的圆形图标（本轮换掉旧的立体光泽球 IconCircle）。
 * 视觉与首页账单行对齐：**圆底 surfaceSunken（浅蓝下沉档）+ 线条图标**，无渐变 / 无高光 / 无投影。
 * 颜色只从语义令牌取，本页不写任何裸 hex：
 *   · 圆底 —— semantic.surfaceSunken（日 #EAF4FF / 夜 #161A27）
 *   · 图标 —— semantic.textSecondary（中性项）或 semantic.accent（需要强调的少数行）
 * ⚠ 本页允许的饱和色只有 accent 一个（账号 / 深色模式 / AI 专区三行用它），
 *   其余行一律 textSecondary —— 别再按旧稿给每行塞一种彩色。
 * 对比度实测（图标压在圆底上）：夜 accent 4.82:1 / 日 accent 3.69:1（§4 图标 ≥3:1），
 * 日 textSecondary 5.02:1 / 夜 textSecondary 11.67:1（§3 文字 ≥4.5:1）。改令牌前先复测。
 */
function RowIcon({
  icon,
  size = ROW_ICON_SIZE,
  tone = 'neutral',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  size?: number;
  /** neutral = textSecondary（默认）；accent = 本页唯一的强调色 */
  tone?: 'neutral' | 'accent';
}) {
  const { semantic, radius } = useTheme();
  const iconStyles = useMemo(() => makeIconStyles(semantic, radius), [semantic, radius]);
  return (
    <View style={[iconStyles.circle, { width: size, height: size }]}>
      <Ionicons
        name={icon}
        size={Math.round((size * ROW_ICON_GLYPH) / ROW_ICON_SIZE)}
        color={tone === 'accent' ? semantic.accent : semantic.textSecondary}
      />
    </View>
  );
}

/**
 * 语言中 / EN 二选一（UI V2 稿：**自然宽度**的胶囊，右侧贴在行尾）。
 * 为什么不用共享 SegmentedControl：稿里这一档的选中块是「夜 = #F2F2F7 黑字 / 日 = #15141C 白字」
 * （= 令牌 textPrimary 底 + 页面底色字），共享件的选中块固定是「白底 + 深紫字」，改不了；
 * 槽底也要求用卡片配色（surfaceSunken），共享件的 solid 档是 hairline 底。
 * 规格与 SegmentedControl 完全同款：槽 36 高 / 内衬 3、滑块贴槽内缘、触控 ≥44、切档 selection 震动、
 * 首帧不播动画，只是「段宽 = 内容宽」并把颜色按稿换成令牌组合。
 */
function LanguageSegments({
  options,
  selected,
  onSelect,
  testID,
}: {
  options: { label: string; value: string }[];
  selected: string;
  onSelect: (value: string) => void;
  testID?: string;
}) {
  const { semantic, radius, motion } = useTheme();
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const active = options.find((o) => o.value === selected) ?? options[0];
  const frame = active ? frames[active.value] : undefined;

  const thumbX = useSharedValue(0);
  const thumbWidth = useSharedValue(0);
  const thumbOpacity = useSharedValue(0);
  const positioned = useRef(false);

  useEffect(() => {
    if (!frame) return;
    // 首帧（几何未测到）：不播动画直接落位再淡入，避免滑块从 0 位滑过去
    if (!positioned.current) {
      positioned.current = true;
      thumbX.value = frame.x;
      thumbWidth.value = frame.width;
      thumbOpacity.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
      return;
    }
    thumbX.value = withSpring(frame.x, motion.spring.default);
    thumbWidth.value = withSpring(frame.width, motion.spring.default);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame?.x, frame?.width]);

  const thumbStyle = useAnimatedStyle(() => ({
    width: thumbWidth.value,
    opacity: thumbOpacity.value,
    transform: [{ translateX: thumbX.value }],
  }));

  return (
    <View style={{ paddingVertical: (SEG_TOUCH_HEIGHT - SEG_TRACK_HEIGHT) / 2 }} testID={testID}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          padding: SEG_TRACK_PADDING,
          borderRadius: radius.full,
          backgroundColor: semantic.surfaceSunken,
        }}
      >
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: SEG_TRACK_PADDING,
              bottom: SEG_TRACK_PADDING,
              left: 0,
              borderRadius: radius.full,
              // 选中块：令牌 textPrimary（夜 #F2F2F7 / 日 #15141C）
              backgroundColor: semantic.textPrimary,
            },
            thumbStyle,
          ]}
          pointerEvents="none"
        />
        {options.map((opt) => {
          const isActive = opt.value === active?.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={{ minHeight: 30, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' }}
              activeOpacity={0.75}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                setFrames((prev) =>
                  prev[opt.value]?.x === x && prev[opt.value]?.width === width
                    ? prev
                    : { ...prev, [opt.value]: { x, width } }
                );
              }}
              hitSlop={{ top: SEG_TRACK_PADDING, bottom: SEG_TRACK_PADDING, left: 0, right: 0 }}
              onPress={() => {
                if (!isActive) hapticSelection();
                onSelect(opt.value);
              }}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              accessibilityState={{ selected: isActive }}
            >
              <AppText
                variant="footnote"
                weight={isActive ? '600' : '400'}
                // 选中时字色 = 页面底色（夜黑 / 日白），与选中块形成反差
                color={isActive ? semantic.bg : semantic.textSecondary}
                numberOfLines={1}
              >
                {opt.label}
              </AppText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/**
 * 外观行（页内自建 —— ListRow 表达不了这里的**两行结构**：标签一行 + 控件另起一行占满整行）。
 * 行规格与 ListRow 逐项对齐：左右内衬 layout.card、上下 spacing.md、行首同一颗 38 圆图标块；
 * 标签与控件之间 spacing.sm。
 */
function AppearanceRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { spacing, layout } = useTheme();
  return (
    <View style={{ paddingHorizontal: layout.card, paddingVertical: spacing.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          columnGap: spacing.md,
          paddingBottom: spacing.sm,
        }}
      >
        <RowIcon icon="moon-outline" tone="accent" />
        <AppText variant="subhead" weight="500">
          {label}
        </AppText>
      </View>
      {/* 控件层：竖排容器 —— 整行三选一自己撑满（见 FullWidthSegments 注释） */}
      <View>{children}</View>
    </View>
  );
}

/**
 * 开关行（页内自建 —— 不是漏迁移，是 ListRow 表达不了这三条硬要求）：
 *  · ListRow 的副标题固定 numberOfLines=1 —— 「打开或切回 App 时需要验证指纹/面容」在窄屏
 *    （320）会被截断，而副标题是这一行的说明，必须整段可读；
 *  · ListRow 的三块用 flexWrap + space-between 排布，副标题一长 Switch 会掉到下一行、左对齐
 *    （T22 在窄屏 + 英文 + 系统大字下实测过）；
 *  · 开关必须永远贴右、文字块自己换行变高。
 * 行规格与 ListRow 逐项一致：minHeight = useLayout().rowMinHeight、左右内衬 layout.card、
 * 上下 spacing.md、行首同一颗 38 圆图标块、行尾开关走 ui/Switch。
 */
function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  testID?: string;
}) {
  const { semantic, spacing, layout } = useTheme();
  const { rowMinHeight } = useLayout();
  const styles = useMemo(() => makeStyles(semantic, spacing, layout), [semantic, spacing, layout]);
  return (
    <View style={[styles.switchRow, { minHeight: rowMinHeight }]} testID={testID}>
      {/* 行首：中性档 38 圆（安全组的锁 / 密码不是彩色分类 —— 圆底 surfaceSunken、图标 textSecondary） */}
      <RowIcon icon={icon} />
      <View style={styles.switchRowText}>
        {/* 标题最多 2 行（与 ListRow 同规则），副标题不设上限：宁可行变高也不省略 */}
        <AppText variant="headline" numberOfLines={2}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="footnote" color={semantic.textSecondary}>
            {subtitle}
          </AppText>
        )}
      </View>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={title} />
    </View>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距；几何常量只留纯图形尺寸与稿内联数值） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, layout: Layout) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: semantic.bg },

    // 资料卡：与页头留 spacing.lg；卡面（surface / radius.lg / elevation）全由 Card 提供
    accountCard: { marginTop: spacing.lg },
    // 头像 + 文字块 + chevron 一行
    accountRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.md },
    accountTextBlock: { flexShrink: 1, flexGrow: 1 },
    accountSub: { marginTop: spacing.xs },

    // 分组之间留 layout.section（与全 App 其它列表页同一档）
    section: { marginTop: layout.section },

    // 开关行（见 SwitchRow 注释）：文字块自己换行，开关永远贴右
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
      columnGap: spacing.md,
    },
    switchRowText: { flex: 1, minWidth: 0 },

    // 页脚版本号：caption 档、居中
    footer: { marginTop: spacing.xxl },
  });
}
