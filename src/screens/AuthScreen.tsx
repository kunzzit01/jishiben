import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
import SegmentedControl from '../components/SegmentedControl';
import BackButton from '../components/ui/BackButton';
import { AppText, GlassView, HeroGradient, withAlpha } from '../components/ui';

type Mode = 'signin' | 'signup';

const AVATAR_STORAGE_KEY = '@jizhang/avatar';
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
  const tr = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const { signIn, signUp, signOut, sessionExpired, user, syncStatus, lastSyncAt, syncNow } = useAuth();
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

  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [useDays, setUseDays] = useState<number | null>(null);
  const avatarLoadedRef = useRef(false);

  // 头像（base64 存 AsyncStorage）+ 首次使用日期（算"使用天数"）
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(AVATAR_STORAGE_KEY);
        if (!mounted) return;
        if (saved) setAvatarUri(saved);
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
      await AsyncStorage.setItem(AVATAR_STORAGE_KEY, uri);
      setAvatarUri(uri);
    } catch (e) {
      dialog.alert({ title: tr('addTx.pickPhotoFailed'), message: tr('addTx.pickPhotoMsg') });
    }
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
          {/* 头像：点击换自己的照片 */}
          <PressableScale
            style={[styles.avatar, { backgroundColor: semantic.accentSoft }]}
            activeScale={0.95}
            onPress={pickAvatar}
            accessibilityRole="button"
            accessibilityLabel={tr('addTx.pcPhotoTitle')}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person-outline" size={42} color={semantic.textPrimary} />
            )}
            <View style={[styles.avatarEditBadge, { backgroundColor: semantic.accent }]}>
              <Ionicons name="camera-outline" size={13} color={semantic.onAccent} />
            </View>
          </PressableScale>
          <AppText variant="title3" numberOfLines={1} style={styles.name}>
            {user.email}
          </AppText>
          <AppText variant="footnote" color={semantic.textSecondary} style={styles.sub}>
            Personal Finance
          </AppText>

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
            contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: 40 }}
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

            {/* 品牌方块（稿：64 圆角方 + accentSoft 底） */}
            <View style={[styles.brandChip, { backgroundColor: semantic.accentSoft }]}>
              <Ionicons name="wallet-outline" size={30} color={semantic.textPrimary} />
            </View>
            <AppText variant="title1" weight="600" style={styles.welcome}>
              {tr('auth.welcomeBack')}
            </AppText>
            <AppText variant="subhead" color={semantic.textSecondary} style={styles.subtitle}>
              {tr('auth.subtitle')}
            </AppText>

            {/* 登录 / 注册分段（§2 玻璃分段：夜白胶囊 / 日紫胶囊） */}
            <View style={styles.modeSwitchWrap}>
              <SegmentedControl
                stretch
                appearance="glass"
                options={[
                  { label: tr('auth.modeSignIn'), value: 'signin' },
                  { label: tr('auth.modeSignUp'), value: 'signup' },
                ]}
                selected={mode}
                onSelect={(v) => setMode(v as Mode)}
              />
            </View>

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
                <TextInput
                  style={[styles.authInput, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={tr('auth.passwordPlaceholder')}
                  placeholderTextColor={semantic.textSecondary}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>
              <AppText variant="caption" color={semantic.textSecondary}>
                {tr('auth.passwordHint')}
              </AppText>

              {/* 主按钮 = accent 渐变胶囊（§3：渐变实心按钮保持白字）；17pt 粗体走大字档 3:1 */}
              <PressableScale
                style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
                activeScale={0.97}
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel={busy ? tr('auth.busy') : mode === 'signin' ? tr('auth.signIn') : tr('auth.signUp')}
              >
                <LinearGradient
                  colors={gradients.accent.colors}
                  locations={gradients.accent.locations as [number, number, ...number[]]}
                  start={gradients.accent.start}
                  end={gradients.accent.end}
                  style={styles.primaryBtnFill}
                >
                  <AppText variant="headline" weight="700" color={semantic.onAccent} numberOfLines={1}>
                    {busy ? tr('auth.busy') : mode === 'signin' ? tr('auth.signIn') : tr('auth.signUp')}
                  </AppText>
                </LinearGradient>
              </PressableScale>

              <PressableScale
                style={styles.switchModeBtn}
                activeScale={0.95}
                onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                accessibilityRole="button"
                accessibilityLabel={mode === 'signin' ? tr('auth.switchToSignUp') : tr('auth.switchToSignIn')}
              >
                <AppText variant="footnote" align="center" numberOfLines={2}>
                  {mode === 'signin' ? tr('auth.switchToSignUp') : tr('auth.switchToSignIn')}
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
  brandChip: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 34,
  },
  welcome: { marginTop: 18 },
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
