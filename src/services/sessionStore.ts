import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 会话（令牌对 + 用户信息）的唯一存放处。
 *
 * 规则（安全要求）：
 * - 访问令牌只放内存 + AsyncStorage，**不落任何明文文件、不写日志、不进 URL**；
 * - 刷新令牌同理；
 * - 这里不做任何 HTTP 请求，因此不会和 apiClient 形成循环依赖（刷新逻辑在 apiClient）。
 */

const SESSION_KEY = '@jizhang/apiSession';

export interface SessionUser {
  id: number;
  email: string;
  displayName?: string | null;
  role?: string;
  emailVerified?: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** 访问令牌到期时间（ms 时间戳），由 expiresIn 换算，用于提前刷新 */
  expiresAt: number;
}

export interface StoredSession {
  tokens: TokenPair;
  user: SessionUser;
}

let current: StoredSession | null = null;
let hydrated = false;
let hydration: Promise<void> | null = null;
const listeners = new Set<(session: StoredSession | null) => void>();

function emit() {
  listeners.forEach((cb) => {
    try {
      cb(current);
    } catch {
      /* 监听方异常不能影响其它监听方 */
    }
  });
}

/** 读一次磁盘（进程内只读一次）；并发调用共享同一个 Promise。 */
export function hydrateSession(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = AsyncStorage.getItem(SESSION_KEY)
    .then((raw) => {
      if (raw) {
        const parsed = JSON.parse(raw) as StoredSession;
        if (parsed?.tokens?.accessToken && parsed?.tokens?.refreshToken) current = parsed;
      }
    })
    .catch(() => {
      /* 损坏的会话 = 未登录，不阻塞启动 */
    })
    .then(() => {
      hydrated = true;
      hydration = null;
    });
  return hydration;
}

export function getSession(): StoredSession | null {
  return current;
}

export function getAccessToken(): string | null {
  return current?.tokens.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return current?.tokens.refreshToken ?? null;
}

export function getAccessTokenExpiresAt(): number {
  return current?.tokens.expiresAt ?? 0;
}

export function getCurrentUser(): SessionUser | null {
  return current?.user ?? null;
}

/** 保存新令牌对（刷新/登录/注册成功都走这里），并落盘。 */
export function setTokenPair(tokens: Omit<TokenPair, 'expiresAt'> & { expiresAt?: number; expiresIn?: number }, user?: SessionUser): void {
  const expiresAt =
    tokens.expiresAt ?? Date.now() + Math.max(0, Number(tokens.expiresIn ?? 0)) * 1000;
  const next: StoredSession = {
    tokens: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt,
    },
    user: user ?? current?.user ?? { id: 0, email: '' },
  };
  current = next;
  void AsyncStorage.setItem(SESSION_KEY, JSON.stringify(next)).catch(() => {});
  emit();
}

/** 只更新用户信息（不改令牌）。 */
export function setSessionUser(user: SessionUser): void {
  if (!current) return;
  current = { ...current, user };
  void AsyncStorage.setItem(SESSION_KEY, JSON.stringify(current)).catch(() => {});
  emit();
}

/** 清空会话（登出 / 令牌被吊销）。 */
export async function clearSession(): Promise<void> {
  current = null;
  hydrated = true;
  await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
  emit();
}

export function subscribeSession(cb: (session: StoredSession | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
