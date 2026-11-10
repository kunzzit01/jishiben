import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  View,
  StyleSheet,
  TextInput,
  Image,
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useT } from '../i18n/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { useDialog } from '../components/AppDialog';
import PressableScale from '../components/PressableScale';

import BackButton from '../components/ui/BackButton';
import GoogleLogo from '../components/GoogleLogo';
import { useCustomAvatar, setCustomAvatar, clearCustomAvatar } from '../utils/avatarStore';

import { AppText, GlassView, HeroGradient, withAlpha } from '../components/ui';
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';

type Mode = 'signin' | 'signup';

/**
 * Google 品牌按钮的固定配色：Google 规范要求按钮为浅底深字，
 * 因此**不跟随主题**（夜间用 textPrimary 会变成白字压白底，完全看不清）。
 */
const GOOGLE_BTN_BG = '#FFFFFF';
const GOOGLE_BTN_BORDER = 'rgba(60,64,67,0.40)';
const GOOGLE_BTN_TEXT = '#1F1F1F';

/**
 * 第一版 Google 登录只在原生端可用；生产 Web 不展示假入口（方案 §1）。
 * 但本地开发（__DEV__）的 web 预览要能看到按钮设计，因此开发态放行 —— 点击只提示「Web 暂不支持」。
 */
const GOOGLE_ENABLED = Platform.OS !== 'web' || __DEV__;

const AVATAR_STORAGE_KEY = '@jizhang/avatar';
// 用户是否在 App 内自己选过头像：为 '1' 时优先于 Google 头像
const AVATAR_CUSTOM_KEY = '@jizhang/avatarCustom';
const FIRST_USE_STORAGE_KEY = '@jizhang/firstUseDate';

// 认证错误码 → 当前语言提示（错误码来自 AuthContext.mapAuthError）
function authErrorText(code: string | undefined, tr: (k: string) => string): string {
  switch (code) {
    case 'invalid_credentials':
      return tr('auth.errInvalidCredentials');
    case 'email_taken':
      return tr('auth.errEmailTaken');
    case 'email_not_confirmed':
      return tr('auth.errEmailNotConfirmed');
    case 'email_provider_disabled':
      return tr('auth.errEmailProviderDisabled');
    case 'weak_password':
      return tr('auth.errWeakPassword');
    case 'rate_limited':
      return tr('auth.errRateLimited');
    case 'network':
      return tr('auth.errNetwork');
    default:
      return code || tr('auth.errUnknown');
  }
}

// 云同步错误码 → 当前语言提示（错误码来自 syncService 的稳定错误码）
function syncErrorText(code: string | undefined, tr: (k: string) => string): string {
  switch (code) {
    case 'network':
      return tr('sync.errNetwork');
    case 'auth':
      return tr('sync.errAuth');
    case 'constraint':
      return tr('sync.errConstraint');
    case 'premium':
      return tr('sync.errPremium');
    case 'server':
      return tr('sync.errServer');
    case 'schema':
      return tr('sync.errSchema');
    case 'local_data_corrupt':
      return tr('sync.errCorrupt');
    case 'not_logged_in':
      return tr('sync.errNotLoggedIn');
    default:
      return tr('sync.errUnknown');
  }
}

/**
 * 我的账户页（原"登录/注册"页升级）：
 * - 未登录 → 显示登录/注册表单；
 * - 已登录 → 显示个人中心内容（头像/邮箱/使用情况），底部"退出登录"按钮。
 * 从设置项的「我的账户」或「账号与同步」进入。
 */
export default function AuthScreen({ navigation }: any) {
  const { semantic, gradients, isDark } = useTheme();
  const { pagePadding } = useLayout();
  // 矮屏档：按窗口高度给插画降高（普通 124 / 矮屏 96，均在要求的区间内）
  const windowHeight = Dimensions.get('window').height;
  // 底部系统栏高度：给「立即注册」和 Tab 栏让位，避免被遮住
  const bottomInset = useBottomSystemInset();
  const isShort = windowHeight < 700;
  // 插画高度随屏高自适应：矮屏 90–110、常规 112–140（不写死一个值）
  const heroHeight = isShort
    ? Math.round(Math.min(110, Math.max(90, windowHeight * 0.14)))
    : Math.round(Math.min(132, Math.max(104, windowHeight * 0.085)));
  // 图片原始 720×360（2:1），左侧约 17% 是透明留白 → 按主体对齐时只取 0.83 宽，
  // 这样钱包/记账本的右边缘正好贴住内容右边缘，不会被留白顶偏。
  const heroArtWidth = Math.round(heroHeight * 2 * 0.83);
  const tr = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const { signIn, signUp, signInWithGoogle, updateDisplayName, signOut, sessionExpired, user, syncStatus, lastSyncAt, syncNow } = useAuth();
  const { transactions, ledgers, activeLedgerId } = useApp();

  // 立即同步(自设置页"账号与同步"迁入):手动触发一次云端备份
  const [syncBusy, setSyncBusy] = useState(false);
  const handleSyncNow = async () => {
    if (syncBusy || syncStatus === 'syncing') return;
    setSyncBusy(true);
    const r = await syncNow();
    setSyncBusy(false);
    if (!r.ok) {
      if (r.error === 'sync_in_progress') return; // 已在同步中，不打扰
      dialog.alert({
        title: tr('sync.errTitle'),
        message: syncErrorText(r.error, tr) + (r.detail ? `\n\n${String(r.detail).slice(0, 160)}` : ''),
      });
    }
  };

  // 同步状态一句话:同步中 / 上次同步时间 / 尚未同步 / 失败
  const syncText =
    syncStatus === 'syncing'
      ? tr('auth.syncing')
      : syncStatus === 'error'
        ? tr('auth.syncFailed')
        : lastSyncAt
          ? `${tr('auth.lastSync')} ${new Date(lastSyncAt).toLocaleString()}`
          : tr('auth.neverSynced');

  // ---------------------------------------------------------
  // 已登录：个人中心内容（头像/使用情况,自 PersonalCenterScreen 迁移）
  // ---------------------------------------------------------


  // 头像：统一由 avatarStore 提供（个人中心与设置页共用同一份，改一处两处同步）
  const { uri: avatarUri, custom: avatarCustom } = useCustomAvatar();
  // 展示名优先级由后端解析好（自定义昵称 → Google 名称 → 邮箱前缀），这里只兜底邮箱前缀
  const displayTitle =
    (user?.displayName && user.displayName.trim()) || (user?.email ?? '').split('@')[0] || '';
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [nameEditOpen, setNameEditOpen] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  // 头像优先级：Google picture → 本地自选头像 → 默认图标（失败也回退）
  // 头像优先级：自己选过的照片 → Google picture → 本地/默认（加载失败也回退）
  const effectiveAvatarUri = avatarCustom
    ? avatarUri
    : !avatarFailed && user?.avatarUrl
      ? user.avatarUrl
      : avatarUri;
  const [useDays, setUseDays] = useState<number | null>(null);
  const avatarLoadedRef = useRef(false);

  // 头像（base64 存 AsyncStorage）+ 首次使用日期（算"使用天数"）
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {


        if (!mounted) return;

        let firstUse = await AsyncStorage.getItem(FIRST_USE_STORAGE_KEY);
        if (!firstUse) {
          firstUse = new Date().toISOString().slice(0, 10);
          await AsyncStorage.setItem(FIRST_USE_STORAGE_KEY, firstUse);
        }
        if (!mounted) return;
        const days = Math.floor((Date.now() - new Date(`${firstUse}T00:00:00`).getTime()) / 86400000) + 1;
        setUseDays(Math.max(days, 1));
        avatarLoadedRef.current = true;
      } catch (e) {
        console.warn('个人中心数据读取失败', e);
        avatarLoadedRef.current = true;
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 点头像 → 相册选一张 → 裁成方形 → base64 持久化
  const pickAvatar = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        dialog.alert({ title: tr('addTx.pcPhotoTitle'), message: tr('addTx.pcPhotoMsg') });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.4,
        base64: true,
      });
      if (result.canceled || !result.assets[0]?.base64) return;
      const uri = `data:image/jpeg;base64,${result.assets[0].base64}`;
      // 写入共享 store：两处界面同时更新，且优先于 Google 头像
      await setCustomAvatar(uri);
    } catch (e) {
      dialog.alert({ title: tr('addTx.pickPhotoFailed'), message: tr('addTx.pickPhotoMsg') });
    }
  };

  /** 保存昵称：写服务端（打上自定义标记），成功后收起输入框 */
  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next) return;
    setNameSaving(true);
    const r = await updateDisplayName(next);
    setNameSaving(false);
    if (r.ok) setNameEditOpen(false);
    else dialog.alert({ title: tr('auth.googleUnavailable'), message: r.detail });
  };

  /** 清掉 App 内自选头像，回到 Google 账号照片 */
  const revertToGooglePhoto = async () => {
    try {
      await clearCustomAvatar();
    } catch {
      /* 忽略存储错误：内存状态照样恢复 */
    }
    setAvatarFailed(false);
  };

  // 记账天数：当前账本里出现过交易记录的去重日期数
  const bookkeepingDays = useMemo(() => {
    const days = new Set(
      transactions.filter((t) => t.ledgerId === activeLedgerId).map((t) => t.date)
    );
    return days.size;
  }, [transactions, activeLedgerId]);

  const handleSignOut = () => {
    dialog.alert({
      title: tr('auth.logout'),
      message: tr('auth.logoutConfirmMsg'),
      buttons: [
        { text: tr('common.cancel'), style: 'cancel' },
        { text: tr('auth.logout'), style: 'destructive', onPress: () => void signOut() },
      ],
    });
  };

  // ---------------------------------------------------------
  // 未登录：登录/注册表单
  // ---------------------------------------------------------

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  // 后端密码最低 8 位；登录时同样要求（真密码不可能短于 8 位）
  const canSubmit = !!email.trim() && password.length >= 8 && !busy;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    const r = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
    setBusy(false);
    if (!r.ok) {
      dialog.alert({ title: authErrorText(r.error, tr) });
      return;
    }
    if (r.needsConfirm) {
      // 兜底：后端若改成「注册需邮箱验证」，注册后会走到这里
      dialog.alert({ title: tr('auth.signedUpNeedsConfirm') });
      return;
    }
    // 成功：留在本页,user 状态切换后自动变为"个人中心"视图
  };

  const handleGoogle = async () => {
    // 本地 web 预览（web-preview）：只验证按钮设计，不发起真实登录
    if (Platform.OS === 'web') {
      dialog.alert({ title: tr('auth.googleWebPreview') });
      return;
    }
    if (busy) return;
    setBusy(true);
    const r = await signInWithGoogle(mode === 'signup' ? 'signup' : 'login');
    setBusy(false);
    if (r.ok) return;
    // 取消是正常操作：不弹错
    if (r.error === 'google_cancelled') return;
    if (r.error === 'google_already_registered') {
      // 注册页用 Google：这个身份已经有账号 → 引导去登录，而不是静默登录
      dialog.alert({ title: tr('auth.googleAlreadyRegistered') });
      setMode('signin');
      return;
    }
    if (r.error === 'google_link_required') {
      dialog.alert({ title: tr('auth.googleLinkRequired') });
      return;
    }
    if (r.error === 'google_not_configured') {
      dialog.alert({ title: tr('auth.googleNotConfigured') });
      return;
    }
    dialog.alert({ title: tr('auth.googleUnavailable'), message: r.detail });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      {/* UI V2.1 §1：渐变铺满整页 */}
      <HeroGradient fill />

      {/* 玻璃二级页头：稿里这条只有返回圆钮（大标题在页内，未登录视图用稿的 30/600 大标题） */}
      <View style={styles.headerRow}>
        <BackButton onPress={() => navigation.goBack()} accessibilityLabel={tr('common.back')} />
      </View>

      {user ? (
        // ============ 已登录:个人中心内容 ============
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.profileWrap, { paddingHorizontal: pagePadding }]}
          showsVerticalScrollIndicator={false}
        >
          {/* 头像：点击换自己的照片。相机徽章画在圆**外面**（父容器不裁剪），
              再用与页面同色的描边做出「挖孔」效果，避免被圆形裁成半月形 */}
          <PressableScale
            style={styles.avatarWrap}
            activeScale={0.95}
            onPress={pickAvatar}
            accessibilityRole="button"
            accessibilityLabel={tr('addTx.pcPhotoTitle')}
          >
            <View style={[styles.avatar, { backgroundColor: semantic.accentSoft }]}>
              {effectiveAvatarUri ? (
                <Image
                  source={{ uri: effectiveAvatarUri }}
                  style={styles.avatarImage}
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <Ionicons name="person-outline" size={42} color={semantic.textPrimary} />
              )}
            </View>
            <View
              style={[
                styles.avatarEditBadge,
                { backgroundColor: semantic.accent, borderColor: semantic.bg },
              ]}
            >
              <Ionicons name="camera" size={15} color={semantic.onAccent} />
            </View>
          </PressableScale>
          <PressableScale
            style={styles.nameRow}
            activeScale={0.97}
            onPress={() => {
              setNameDraft(displayTitle);
              setNameEditOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel={tr('auth.editNameTitle')}
            testID="profile-name-row"
          >
            <AppText variant="title3" numberOfLines={1} style={styles.name}>
              {displayTitle}
            </AppText>
            <Ionicons name="pencil" size={16} color={semantic.accentText} style={styles.namePencil} />
          </PressableScale>
          <AppText variant="footnote" color={semantic.textSecondary} style={styles.sub}>
            {user.email}
          </AppText>

          {nameEditOpen ? (
            <View style={styles.nameEditor}>
              <TextInput
                style={[styles.nameInput, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                value={nameDraft}
                onChangeText={setNameDraft}
                placeholder={tr('auth.editNamePlaceholder')}
                placeholderTextColor={semantic.textSecondary}
                maxLength={40}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void saveName()}
                testID="name-edit-input"
              />
              <View style={styles.nameEditorRow}>
                <PressableScale
                  style={styles.nameEditorBtn}
                  activeScale={0.95}
                  onPress={() => setNameEditOpen(false)}
                  accessibilityRole="button"
                >
                  <AppText variant="subhead" color={semantic.textSecondary}>{tr('common.cancel')}</AppText>
                </PressableScale>
                <PressableScale
                  style={[styles.nameEditorBtn, styles.nameEditorSave, { backgroundColor: semantic.accent }]}
                  activeScale={0.95}
                  disabled={nameSaving}
                  onPress={() => void saveName()}
                  accessibilityRole="button"
                  testID="name-edit-save"
                >
                  <AppText variant="subhead" weight="600" color={semantic.onAccent}>
                    {nameSaving ? tr('auth.busy') : tr('common.save')}
                  </AppText>
                </PressableScale>
              </View>
            </View>
          ) : null}
          {avatarCustom ? (
            <PressableScale
              style={styles.revertPhotoBtn}
              activeScale={0.96}
              onPress={() => void revertToGooglePhoto()}
              accessibilityRole="button"
              testID="revert-google-photo"
            >
              <Ionicons name="refresh" size={13} color={semantic.textSecondary} />
              <AppText variant="caption" color={semantic.textSecondary}>
                {tr('auth.revertGooglePhoto')}
              </AppText>
            </PressableScale>
          ) : null}

          <AppText variant="footnote" color={semantic.textSecondary} style={styles.section}>
            {tr('addTx.usage')}
          </AppText>
          <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={styles.card}>
            <Info label={tr('addTx.bookkeepingDays')} value={tr('addTx.daysUnit', { n: bookkeepingDays })} muted={semantic.textSecondary} />
            <Info label={tr('addTx.usedDays')} value={useDays !== null ? tr('addTx.daysUnit', { n: useDays }) : '--'} muted={semantic.textSecondary} />
            <Info label={tr('addTx.ledgerCount')} value={tr('addTx.countUnit', { n: ledgers.length })} muted={semantic.textSecondary} />
          </GlassView>

          {/* 云同步:状态与"立即同步"合并成一行——显示状态一句话,点击即触发同步 */}
          <AppText variant="footnote" color={semantic.textSecondary} style={styles.section}>
            {tr('auth.title')}
          </AppText>
          <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={styles.card}>
            <PressableScale
              style={styles.syncNowRow}
              activeScale={0.97}
              onPress={handleSyncNow}
              disabled={syncBusy || syncStatus === 'syncing'}
              accessibilityRole="button"
              accessibilityLabel={tr('auth.syncNow')}
            >
              <Ionicons name="cloud-upload-outline" size={18} color={semantic.textPrimary} />
              <View style={styles.syncNowTextWrap}>
                <AppText variant="subhead" weight="500">
                  {syncBusy || syncStatus === 'syncing' ? tr('auth.syncing') : tr('auth.syncNow')}
                </AppText>
                <AppText variant="caption" color={semantic.textSecondary} numberOfLines={1}>
                  {syncText}
                </AppText>
              </View>
              <Ionicons name="chevron-forward" size={15} color={semantic.textSecondary} />
            </PressableScale>
          </GlassView>

          {/* 退出登录:红色紧凑药丸按钮（15/700 = 大字档，danger 4.2 达标） */}
          <View style={styles.logoutBtnWrap}>
            <PressableScale
              style={styles.logoutBtn}
              activeScale={0.95}
              onPress={handleSignOut}
              accessibilityRole="button"
              accessibilityLabel={tr('auth.logout')}
            >
              <Ionicons name="log-out-outline" size={18} color={semantic.danger} />
              <AppText variant="subhead" weight="700" color={semantic.danger}>
                {tr('auth.logout')}
              </AppText>
            </PressableScale>
          </View>
        </ScrollView>
      ) : (
        // ============ 未登录:登录/注册表单（稿 P_Auth：品牌方块 + 大标题 + 分段 + 玻璃表单卡 + 渐变主按钮）============
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: 40 + bottomInset + 72 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* 14 天未上线被强制登出后的提示横幅 */}
            {sessionExpired && (
              <View style={[styles.expiredBanner, { backgroundColor: withAlpha(semantic.danger, 0.12) }]}>
                <Ionicons name="time-outline" size={20} color={semantic.danger} />
                <AppText variant="footnote" style={styles.expiredBannerText}>
                  {tr('auth.expiredBanner')}
                </AppText>
              </View>
            )}

            {/* 头部区域：左侧标题/副标题，右侧插画（同一行，表单因此上移） */}
            <View style={[styles.heroRow, { minHeight: heroHeight }]}>
              {/* 插画绝对定位贴右：图片左半是透明留白，主体（钱包/记账本）落在这半边，
                  所以按主体对齐 = 让图片右边缘贴住内容右边缘 */}
              <Image
                source={require('../../assets/auth_header.webp')}
                style={[styles.heroArt, { width: heroArtWidth, height: heroHeight }]}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
              <View style={[styles.heroText, { paddingRight: heroArtWidth * 0.42 }]}>
                <AppText variant="title1" weight="600" style={styles.welcome}>
                  {mode === 'signin' ? tr('auth.welcomeBack') : tr('auth.signUpTitle')}
                </AppText>
                <AppText variant="subhead" color={semantic.textSecondary} style={styles.subtitle}>
                  {mode === 'signin' ? tr('auth.subtitleSignIn') : tr('auth.subtitleSignUp')}
                </AppText>
              </View>
            </View>
            {/* 表单卡（方案 B）：邮箱/密码 → 主按钮 → 或使用其他方式 → Google 按钮 → 切换模式 */}
            <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={styles.authCard}>

              <View>
                <AppText variant="caption" color={semantic.textSecondary} style={styles.fieldLabel}>
                  {tr('auth.email')}
                </AppText>
                <TextInput
                  style={[styles.authInput, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder={tr('auth.emailPlaceholder')}
                  placeholderTextColor={semantic.textSecondary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View>
                <AppText variant="caption" color={semantic.textSecondary} style={styles.fieldLabel}>
                  {tr('auth.password')}
                </AppText>
                {/* 密码框 + 眼睛：与设计稿一致，可切明文 */}
                <View>
                  <TextInput
                    style={[styles.authInput, styles.authInputWithIcon, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={tr('auth.passwordPlaceholderSignUp')}
                    placeholderTextColor={semantic.textSecondary}
                    secureTextEntry={!passwordVisible}
                    autoCapitalize="none"
                  />
                  <PressableScale
                    style={styles.eyeBtn}
                    activeScale={0.9}
                    onPress={() => setPasswordVisible((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={passwordVisible ? tr('auth.hidePassword') : tr('auth.showPassword')}
                    testID="auth-password-eye"
                  >
                    <Ionicons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={18} color={semantic.textSecondary} />
                  </PressableScale>
                </View>
              </View>

              <PressableScale
                style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
                activeScale={0.97}
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel={busy ? tr('auth.busy') : mode === 'signin' ? tr('auth.signIn') : tr('auth.createAccount')}
              >
                <LinearGradient
                  colors={gradients.accent.colors}
                  locations={gradients.accent.locations as [number, number, ...number[]]}
                  start={gradients.accent.start}
                  end={gradients.accent.end}
                  style={styles.primaryBtnFill}
                >
                  <AppText variant="headline" weight="700" color={semantic.onAccent} numberOfLines={1}>
                    {busy ? tr('auth.busy') : mode === 'signin' ? tr('auth.signIn') : tr('auth.createAccount')}
                  </AppText>
                </LinearGradient>
              </PressableScale>

              {GOOGLE_ENABLED ? (
                <>
                  {/* 方案 B：主按钮之后才是「或使用其他方式」+ Google 按钮 */}
                  <View style={styles.orRow}>
                    <View style={[styles.orLine, { backgroundColor: semantic.hairline }]} />
                    <AppText variant="caption" color={semantic.textSecondary}>{tr('auth.orOtherWays')}</AppText>
                    <View style={[styles.orLine, { backgroundColor: semantic.hairline }]} />
                  </View>
                  <PressableScale
                    style={styles.googleBtn}
                    activeScale={0.98}
                    disabled={busy}
                    onPress={() => void handleGoogle()}
                    accessibilityRole="button"
                    accessibilityLabel={tr('auth.googleContinue')}
                    testID="auth-google"
                  >
                    <GoogleLogo size={18} />
                    <AppText variant="subhead" weight="600" color={GOOGLE_BTN_TEXT}>
                      {tr('auth.googleContinue')}
                    </AppText>
                  </PressableScale>
                </>
              ) : null}

              <PressableScale
                style={styles.switchModeBtn}
                activeScale={0.95}
                onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                accessibilityRole="button"
                accessibilityLabel={mode === 'signin' ? tr('auth.noAccountCta') : tr('auth.hasAccountCta')}
              >
                <AppText variant="footnote" align="center" numberOfLines={2}>
                  {mode === 'signin' ? tr('auth.noAccountCta') : tr('auth.hasAccountCta')}
                </AppText>
              </PressableScale>
            </GlassView>

          </ScrollView>

        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Info({ label, value, muted }: any) {
  return (
    <View style={styles.info}>
      <AppText variant="subhead" weight="500">
        {label}
      </AppText>
      <AppText variant="subhead" color={muted}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  // Google 按钮：白底 + 细描边（官方风格），与蓝白主题一致
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 10,
    minHeight: 50,
    borderRadius: 999,
    backgroundColor: GOOGLE_BTN_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GOOGLE_BTN_BORDER,
  },
  // 「或」分隔：两条淡线夹一个字
  orRow: { flexDirection: 'row', alignItems: 'center', columnGap: 10, marginVertical: 14 },
  orLine: { flex: 1, height: StyleSheet.hairlineWidth },
  // 密码框右侧的眼睛（44 命中高度）
  authInputWithIcon: { paddingRight: 44 },
  eyeBtn: { position: 'absolute', right: 6, top: 0, bottom: 0, width: 40, alignItems: 'center', justifyContent: 'center' },
  passwordHint: { marginTop: 6 },
  container: { flex: 1 },
  flex: { flex: 1 },

  headerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, minHeight: 52 },
  headerGlassBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  // ============ 已登录:个人中心 ============
  profileWrap: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 40,
  },
  // 外层容器：只负责定位，不裁剪（否则徽章会被圆的 overflow:hidden 切掉）
  // 昵称行：文字 + 铅笔，整体可点改名
  // 昵称行：文字 + 铅笔，整体水平居中（44 高命中区，不加边框）
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: 7,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  nameEditor: { width: '100%', maxWidth: 320, marginTop: 10, gap: 8 },
  nameInput: { height: 46, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  nameEditorRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  nameEditorBtn: { minWidth: 92, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  nameEditorSave: { paddingHorizontal: 16 },
  namePencil: { opacity: 0.55, marginTop: 3 },
  revertPhotoBtn: { flexDirection: 'row', alignItems: 'center', columnGap: 4, marginTop: 6, paddingVertical: 4 },
  avatarWrap: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: 88, height: 88 },
  avatarEditBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { marginTop: 12, maxWidth: '90%' },
  sub: { marginTop: 2 },
  section: { alignSelf: 'flex-start', marginTop: 24, marginBottom: 8 },
  card: { alignSelf: 'stretch', width: '100%', paddingHorizontal: 16 },
  info: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    gap: 12,
  },
  syncNowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    minHeight: 56,
  },
  syncNowTextWrap: { flex: 1, minWidth: 0, gap: 2 },
  logoutBtnWrap: { alignSelf: 'stretch', alignItems: 'center', marginTop: 24 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },

  // ============ 未登录:登录/注册表单 ============
    // 顶部插画：透明 WebP，宽度撑满内容区，高度由 JSX 按矮屏分级；无背景/边框/圆角
  // 头部行：标题在左、插画在右（插画绝对贴右，文字右侧留出主体宽度避免压字）
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 10 },
  heroArt: { position: 'absolute', right: -4, bottom: -2 },
  heroText: { flexShrink: 1 },
  welcome: { marginTop: 0 },
  subtitle: { marginTop: 6 },
  modeSwitchWrap: { marginTop: 22 },
  authCard: { marginTop: 16, padding: 16, gap: 12 },
  fieldLabel: { marginBottom: 6 },
  // 胶囊输入框（§2：输入框 radius 999）
  authInput: {
    height: 50,
    borderRadius: 999,
    paddingHorizontal: 16,
    fontSize: 15,
  },
  primaryBtn: { alignSelf: 'stretch', marginTop: 4 },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnFill: {
    height: 54,
    borderRadius: 999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  switchModeBtn: { alignSelf: 'stretch', paddingVertical: 8 },
  expiredBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 18,
    marginTop: 12,
  },
  expiredBannerText: { flex: 1, minWidth: 0 },
});
