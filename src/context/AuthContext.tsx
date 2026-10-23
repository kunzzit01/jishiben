import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, authApi, refreshAccessToken } from '../services/apiClient';
import {
  SessionUser,
  clearSession,
  getSession,
  hydrateSession,
  subscribeSession,
} from '../services/sessionStore';
import { INACTIVITY_LIMIT_MS } from '../config/apiConfig';
import { fullSync, getSyncState, subscribeSyncState, SyncStatus } from '../services/syncService';

// 距上次"上线"（打开 App）超过该时长 → 会话作废，要求重新登录
const LAST_ACTIVE_KEY = '@jizhang/lastActiveAt';

export interface AuthActionResult {
  ok: boolean;
  /** 失败原因：常见错误给稳定错误码（界面按码显示中英文），否则是原始错误消息 */
  error?: string;
  /** 原始错误详情（同步类错误弹窗副文展示，便于反馈定位） */
  detail?: string;
  /** 需要用户先去邮箱验证（当前后端注册即登录，恒为 false，保留字段以兼容界面） */
  needsConfirm?: boolean;
}

interface AuthContextValue {
  user: SessionUser | null;
  /** App 启动时正在恢复上次登录态（期间界面不要急着显示未登录） */
  authInitializing: boolean;
  /** 因连续 14 天未打开 App 被自动登出（AuthScreen 显示横幅提示） */
  sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<AuthActionResult>;
  signUp: (email: string, password: string) => Promise<AuthActionResult>;
  signOut: () => Promise<void>;
  syncStatus: SyncStatus;
  lastSyncAt: number | null;
  /** 手动"立即同步"：拉取云端并合并 → 推送本地 */
  syncNow: () => Promise<AuthActionResult>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * 后端错误码（docs/API.md §7）→ 界面稳定错误码。
 * 界面只认这些码（AuthScreen.authErrorText），服务端文案不直接展示给用户。
 */
function mapAuthError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'INVALID_CREDENTIALS':
        return 'invalid_credentials';
      case 'CONFLICT':
        return 'email_taken';
      case 'NETWORK_ERROR':
      case 'TIMEOUT':
        return 'network';
      case 'VALIDATION_FAILED':
      case 'BAD_REQUEST':
        // 后端密码下限是 8 位，注册时的字段级校验都落在这个分支
        return e.details?.some((d) => /password/i.test(d)) || /password/i.test(e.message)
          ? 'weak_password'
          : 'network';
      case 'TOKEN_EXPIRED':
      case 'TOKEN_REVOKED':
      case 'TOKEN_INVALID':
      case 'UNAUTHORIZED':
        return 'session_expired';
      default:
        return e.message;
    }
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/network|fetch|timeout/i.test(message)) return 'network';
  return message;
}

/**
 * 账号认证 Context：注册 / 登录 / 退出 / 重启自动恢复登录态。
 * 登录态变化后的数据同步由 useSyncManager 触发，这里只管身份。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authInitializing, setAuthInitializing] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [syncState, setSyncState] = useState(getSyncState());
  // AppState 回调里判断"当前是否登录"用的最新引用
  const userRef = useRef<SessionUser | null>(null);
  userRef.current = user;

  useEffect(() => {
    const markActive = () => AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});

    // 恢复上次登录态（令牌对存在 AsyncStorage，sessionStore 负责读写）
    (async () => {
      await hydrateSession();
      if (getSession()) {
        // 安全要求：连续 14 天没打开过 App → 会话作废，要求重新登录。
        // lastActiveAt 缺失 = 本次更新前登录的老会话，宽限一次（记为现在），不把人踢下线
        const last = await AsyncStorage.getItem(LAST_ACTIVE_KEY).catch(() => null);
        if (last != null && Date.now() - Number(last) > INACTIVITY_LIMIT_MS) {
          await clearSession();
          setSessionExpired(true);
        } else {
          await markActive();
        }
      }
      setUser(getSession()?.user ?? null);
      setAuthInitializing(false);
    })();

    // 登录 / 退出 / 令牌刷新等所有会话变化统一走这里（sessionStore 是唯一真相）
    const unsubscribe = subscribeSession((session) => {
      setUser(session?.user ?? null);
    });

    // 每次回到 App（上线）都刷新活跃时间；后台 JS timer 会被系统冻结，
    // 回前台先补一次令牌刷新（即将过期时 apiClient 也会自动刷新），再放行同步
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (userRef.current) {
          void markActive();
          void refreshAccessToken().catch(() => {
            /* 刷新失败（含刷新令牌过期）由 apiClient 统一登出，这里不额外打扰用户 */
          });
        }
      }
    });

    const unsubSync = subscribeSyncState(() => setSyncState(getSyncState()));
    return () => {
      unsubscribe();
      appStateSub.remove();
      unsubSync();
    };
  }, []);

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    try {
      await authApi.login(email.trim(), password);
      await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
      setSessionExpired(false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapAuthError(e), detail: e instanceof Error ? e.message : String(e) };
    }
  };

  const signUp: AuthContextValue['signUp'] = async (email, password) => {
    try {
      // 后端注册成功直接返回令牌对（没有"等邮箱验证"这一步），所以 needsConfirm 恒为 false
      await authApi.register(email.trim(), password);
      await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())).catch(() => {});
      setSessionExpired(false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: mapAuthError(e), detail: e instanceof Error ? e.message : String(e) };
    }
  };

  const signOut: AuthContextValue['signOut'] = async () => {
    // 只退出登录，本机数据保留（离线照常用）；下次登录同账号会自动合并。
    // 后端没有"吊销本会话"的端点（只有 logout-all 会踢掉所有设备），所以这里只清本地令牌，
    // 与旧版语义一致；需要踢掉全部设备时用 authApi.logoutAll()。
    await clearSession();
    setSessionExpired(false);
  };

  const syncNow: AuthContextValue['syncNow'] = async () => {
    const r = await fullSync();
    return r.ok ? { ok: true } : { ok: false, error: r.error, detail: r.detail };
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authInitializing,
        sessionExpired,
        signIn,
        signUp,
        signOut,
        syncStatus: syncState.status,
        lastSyncAt: syncState.lastSyncAt,
        syncNow,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth必须在AuthProvider内部使用');
  return ctx;
}
