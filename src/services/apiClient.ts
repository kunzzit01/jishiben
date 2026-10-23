import { API_BASE_URL, API_TIMEOUT_MS, TOKEN_REFRESH_MARGIN_MS } from '../config/apiConfig';
import {
  SessionUser,
  clearSession,
  getAccessToken,
  getAccessTokenExpiresAt,
  getRefreshToken,
  setSessionUser,
  setTokenPair,
} from './sessionStore';

/**
 * 自研后端（Spring Boot）HTTP 客户端。
 *
 * 职责：传输 + 认证 + 错误码归一化。业务规则（手续费、信用卡口径、跨币种不相加…）
 * 全部留在原处，这里只负责"数据从哪来"。
 *
 * 认证模型（docs/API.md §2）：
 * - 登录/注册/刷新返回 accessToken（24h）+ refreshToken（30d）；
 * - 每个请求带 Authorization: Bearer <accessToken>；
 * - 401 TOKEN_EXPIRED → 刷新并重放；TOKEN_REVOKED / TOKEN_INVALID → 直接登出。
 */

// ────────────────────────────── 错误 ──────────────────────────────

/** 服务端错误码（docs/API.md §7）+ 两个客户端侧稳定码。 */
export type ApiErrorCode =
  | 'VALIDATION_FAILED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REVOKED'
  | 'INVALID_CREDENTIALS'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'NOT_IMPLEMENTED'
  | 'UPSTREAM_ERROR'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  // 客户端侧：网络层没有拿到 HTTP 响应（弱网 / DNS / 后端未启动）
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

export class ApiError extends Error {
  readonly code: ApiErrorCode | (string & {});
  readonly status: number;
  readonly details?: string[];

  constructor(code: string, status: number, message: string, details?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 令牌已经无法再用了（被吊销/不合法）：调用方不做重试，直接登出。 */
export function isSessionDeadError(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'TOKEN_REVOKED' || e.code === 'TOKEN_INVALID');
}

/** 网络类错误（值得重试）。 */
export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError && (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT');
}

// ────────────────────────────── 底层 fetch ──────────────────────────────

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  /** 请求体（自动 JSON 序列化） */
  body?: unknown;
  /** 查询参数；值为 undefined/null/'' 的项会被丢弃 */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** 是否带访问令牌（默认 true；登录/注册/刷新为 false） */
  auth?: boolean;
  /** 单次请求超时（默认 API_TIMEOUT_MS） */
  timeoutMs?: number;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = path.startsWith('http') ? path : API_BASE_URL + path;
  if (!query) return url;
  const parts: string[] = [];
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  if (parts.length === 0) return url;
  return url + (url.includes('?') ? '&' : '?') + parts.join('&');
}

/** 原始响应：状态码 + 解析后的 JSON（或 undefined）。 */
interface RawResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

async function rawFetch(
  method: Method,
  path: string,
  options: RequestOptions,
  token: string | null
): Promise<RawResponse> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), options.timeoutMs ?? API_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller?.signal,
    });
  } catch (e) {
    const aborted = controller?.signal.aborted ?? false;
    const message = e instanceof Error ? e.message : String(e);
    throw aborted
      ? new ApiError('TIMEOUT', 0, '请求超时：' + method + ' ' + path)
      : new ApiError('NETWORK_ERROR', 0, '网络请求失败：' + method + ' ' + path + ' — ' + message);
  } finally {
    clearTimeout(timeout);
  }

  let body: unknown;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: response.status, ok: response.ok, body };
}

/** 把服务端统一错误响应转成 ApiError；非标准响应也给出可读消息。 */
function toApiError(raw: RawResponse, method: Method, path: string): ApiError {
  const payload = raw.body as
    | { code?: unknown; message?: unknown; details?: unknown }
    | string
    | undefined;
  if (payload && typeof payload === 'object') {
    const code = typeof payload.code === 'string' ? payload.code : 'INTERNAL_ERROR';
    const message =
      typeof payload.message === 'string' && payload.message
        ? payload.message
        : '请求失败（HTTP ' + raw.status + '）';
    const details = Array.isArray(payload.details)
      ? payload.details.filter((d): d is string => typeof d === 'string')
      : undefined;
    return new ApiError(code, raw.status, method + ' ' + path + ' → ' + message, details);
  }
  if (typeof payload === 'string' && payload.trim()) {
    return new ApiError('INTERNAL_ERROR', raw.status, method + ' ' + path + ' → ' + payload.slice(0, 200));
  }
  return new ApiError('INTERNAL_ERROR', raw.status, method + ' ' + path + ' → HTTP ' + raw.status);
}

// ────────────────────────────── 单飞刷新（关键） ──────────────────────────────

/**
 * 刷新令牌的"单飞"（single-flight）实现。
 *
 * 问题：访问令牌过期时，如果同一时刻有 N 个请求在飞（拉账本、拉流水、推资产…），
 * 每个都会收到 401 TOKEN_EXPIRED。若各自调 POST /api/auth/refresh，会出现经典竞态：
 * 服务端每次刷新都签发新令牌对，最后返回的那对覆盖内存里的令牌，而先返回的请求
 * 已经拿着"上一代"令牌去重放 → 刚拿到就失效，同步大面积失败。
 *
 * 解法：refreshInFlight 保存"正在进行的刷新"。所有并发调用共享同一个 Promise，
 * 只发一次 HTTP；刷新成功后每个等待者都拿同一个新 accessToken 重放自己的请求。
 * 刷新失败时同一个错误抛给所有等待者，并且只清一次会话。
 */
let refreshInFlight: Promise<string> | null = null;

async function performRefresh(): Promise<string> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    await clearSession();
    throw new ApiError('TOKEN_INVALID', 401, '没有可用的刷新令牌，请重新登录');
  }
  const raw = await rawFetch('POST', '/api/auth/refresh', { body: { refreshToken }, auth: false }, null);
  if (!raw.ok) {
    const error = toApiError(raw, 'POST', '/api/auth/refresh');
    // 刷新令牌过期/被吊销/不合法 = 会话彻底结束，直接登出（不再重试）
    await clearSession();
    throw error;
  }
  const body = raw.body as AuthTokenResponse;
  setTokenPair(
    {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresIn: body.expiresIn ?? 0,
    },
    body.user
  );
  return body.accessToken;
}

/** 单飞刷新入口：并发调用只会触发一次网络请求，其余排队复用同一个结果。 */
export function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  const run = performRefresh().finally(() => {
    if (refreshInFlight === run) refreshInFlight = null;
  });
  refreshInFlight = run;
  return run;
}

// ────────────────────────────── 带认证的请求 ──────────────────────────────

async function authorizedRequest<T>(
  method: Method,
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const auth = options.auth !== false;
  if (!auth) {
    const raw = await rawFetch(method, path, options, null);
    if (!raw.ok) throw toApiError(raw, method, path);
    return raw.body as T;
  }

  // 即将过期就先刷新（省掉一次必然失败的请求；下面的 401 分支仍作兜底）
  let token = getAccessToken();
  if (token && Date.now() >= getAccessTokenExpiresAt() - TOKEN_REFRESH_MARGIN_MS) {
    try {
      token = await refreshAccessToken();
    } catch (e) {
      // 刷新失败不在这里登出：下面 401 分支会统一处理 TOKEN_REVOKED/TOKEN_INVALID
      if (isSessionDeadError(e)) throw e;
    }
  }

  let raw = await rawFetch(method, path, options, token);
  if (raw.ok) return raw.body as T;

  let error = toApiError(raw, method, path);

  if (raw.status === 401) {
    if (error.code === 'TOKEN_REVOKED' || error.code === 'TOKEN_INVALID') {
      // 契约明确：这两个码表示会话已死，刷新没有意义 → 直接登出
      await clearSession();
      throw error;
    }
    if (error.code === 'TOKEN_EXPIRED' || error.code === 'UNAUTHORIZED') {
      // 排队刷新（并发只发一次）→ 用同一个新令牌重放一次
      const fresh = await refreshAccessToken();
      raw = await rawFetch(method, path, options, fresh);
      if (raw.ok) return raw.body as T;
      error = toApiError(raw, method, path);
      if (raw.status === 401) {
        await clearSession();
        throw error;
      }
    }
  }
  throw error;
}

// ────────────────────────────── DTO 类型（camelCase，对齐 docs/API.md） ──────────────────────────────

export interface AuthTokenResponse {
  tokenType: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
}

export interface ProfileDto {
  displayName: string | null;
  currency: string;
  dateFormat: string;
  weekStartsOn: number;
  decimalPlaces: number;
  periodPreference: unknown;
  activeLedgerUid: string | null;
  updatedAt?: string;
}

export interface ProfilePatch {
  displayName?: string;
  currency?: string;
  dateFormat?: string;
  weekStartsOn?: number;
  decimalPlaces?: number;
  periodPreference?: unknown;
  activeLedgerUid?: string | null;
}

export interface LedgerDto {
  clientUid: string;
  name: string;
  icon: string;
  color: string | null;
  sortOrder: number;
  defaultLedger: boolean;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerUpsert {
  clientUid: string;
  name: string;
  icon: string;
  color?: string | null;
  sortOrder?: number;
  defaultLedger?: boolean;
  archived?: boolean;
}

export interface AssetDto {
  clientUid: string;
  ledgerUid: string;
  name: string;
  icon: string;
  color: string;
  type: string;
  currency: string;
  initialBalance: number | string;
  creditLimit: number | string | null;
  statementDay: number | null;
  dueDay: number | null;
  interestRate: number | string | null;
  defaultAsset: boolean;
  sortOrder: number;
  archived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetUpsert {
  clientUid: string;
  ledgerUid: string;
  name: string;
  icon: string;
  color: string;
  type: string;
  currency: string;
  initialBalance?: number;
  creditLimit?: number | null;
  statementDay?: number | null;
  dueDay?: number | null;
  interestRate?: number | null;
  defaultAsset?: boolean;
  sortOrder?: number;
  archived?: boolean;
}

export interface CategoryGroupDto {
  clientUid: string;
  name: string;
  color: string | null;
  icon: string | null;
  type: string;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryGroupUpsert {
  clientUid: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  type: string;
  sortOrder?: number;
  archived?: boolean;
}

export interface CategoryDto {
  clientUid: string;
  groupUid: string | null;
  name: string;
  icon: string;
  color: string | null;
  type: string;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryUpsert {
  clientUid: string;
  groupUid?: string | null;
  name: string;
  icon: string;
  color?: string | null;
  type: string;
  sortOrder?: number;
  archived?: boolean;
}

export interface TransactionDto {
  clientUid: string;
  ledgerUid: string;
  categoryUid: string | null;
  assetUid: string | null;
  fromAssetUid: string | null;
  toAssetUid: string | null;
  type: string;
  amount: number | string;
  currency: string | null;
  exchangeRate: number | string | null;
  convertedAmount: number | string | null;
  fee: number | string | null;
  occurredOn: string;
  note: string | null;
  displayName: string | null;
  receiptPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionUpsert {
  clientUid: string;
  ledgerUid: string;
  categoryUid?: string | null;
  assetUid?: string | null;
  fromAssetUid?: string | null;
  toAssetUid?: string | null;
  type: string;
  amount: number;
  currency?: string;
  exchangeRate?: number | null;
  convertedAmount?: number | null;
  fee?: number | null;
  occurredOn: string;
  note?: string;
  displayName?: string | null;
  receiptPath?: string | null;
}

export interface BudgetDto {
  clientUid: string;
  scope: 'total' | 'category' | string;
  categoryUid: string | null;
  currency: string;
  amount: number | string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetUpsert {
  clientUid?: string;
  /** 'total' 或缺省 = 总预算；'' 同 total；真实分类 uid = 分类预算（docs/API.md §4.2） */
  categoryUid?: string | null;
  amount: number;
  currency?: string;
}

/** 计划付款（docs/API.md §3.10；后端 PaymentPlanDtos.Response，无 note/currency 字段） */
export interface PaymentPlanDto {
  clientUid: string;
  ledgerUid: string;
  categoryUid: string | null;
  assetUid: string | null;
  name: string;
  amount: number | string;
  type: string;
  cycle: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
  day: number | null;
  startDate: string;
  endDate: string | null;
  autoDeduct: boolean;
  /** 补账游标（已处理到的最后一期）；PUT 是整行替换，漏传会被服务端清成 NULL */
  lastProcessedDate: string | null;
  active: boolean;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentPlanUpsert {
  clientUid: string;
  ledgerUid: string;
  categoryUid?: string | null;
  assetUid?: string | null;
  name: string;
  amount: number;
  type: string;
  cycle: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  monthOfYear?: number | null;
  day?: number | null;
  startDate: string;
  endDate?: string | null;
  autoDeduct?: boolean;
  lastProcessedDate?: string | null;
  active?: boolean;
  sortOrder?: number;
}

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface ReportSummaryDto {
  from: string | null;
  to: string | null;
  currencyFilter: string | null;
  currencies: {
    currency: string;
    income: number | string;
    expense: number | string;
    net: number | string;
    transactionCount: number;
    categories: { categoryUid: string | null; name: string; amount: number | string; count: number }[];
  }[];
}

export interface AssetBalancesDto {
  assets: {
    assetUid: string;
    name: string;
    type: string;
    currency: string;
    archived: boolean;
    initialBalance: number | string;
    income: number | string;
    expense: number | string;
    transferIn: number | string;
    transferOut: number | string;
    balance: number | string;
  }[];
  totalsByCurrency: { currency: string; balance: number | string }[];
}

// ────────────────────────────── 端点 ──────────────────────────────

function adoptTokens(response: AuthTokenResponse): AuthTokenResponse {
  setTokenPair(
    {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresIn: response.expiresIn ?? 0,
    },
    response.user
  );
  return response;
}

export const authApi = {
  register: (email: string, password: string, displayName?: string) =>
    authorizedRequest<AuthTokenResponse>('POST', '/api/auth/register', {
      auth: false,
      body: displayName ? { email, password, displayName } : { email, password },
    }).then(adoptTokens),

  login: (email: string, password: string) =>
    authorizedRequest<AuthTokenResponse>('POST', '/api/auth/login', {
      auth: false,
      body: { email, password },
    }).then(adoptTokens),

  me: () => authorizedRequest<SessionUser>('GET', '/api/auth/me'),

  updateMe: (displayName: string) =>
    authorizedRequest<SessionUser>('PATCH', '/api/auth/me', { body: { displayName } }).then((user) => {
      setSessionUser(user);
      return user;
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    authorizedRequest<AuthTokenResponse>('PUT', '/api/auth/password', {
      body: { currentPassword, newPassword },
    }).then(adoptTokens),

  /** 登出全部设备：token_version+1，服务端在同一响应里返回新令牌对 */
  logoutAll: () =>
    authorizedRequest<AuthTokenResponse>('POST', '/api/auth/logout-all').then(adoptTokens),
};

export const api = {
  // profile —— 全局设置（币种/日期格式/周起始/小数位/周期偏好/当前账本）
  getProfile: () => authorizedRequest<ProfileDto>('GET', '/api/profile'),
  patchProfile: (patch: ProfilePatch) =>
    authorizedRequest<ProfileDto>('PATCH', '/api/profile', { body: patch }),

  // ledgers
  listLedgers: (includeArchived = true) =>
    authorizedRequest<LedgerDto[]>('GET', '/api/ledgers', { query: { includeArchived } }),
  putLedger: (body: LedgerUpsert) => authorizedRequest<LedgerDto>('PUT', '/api/ledgers', { body }),
  deleteLedger: (clientUid: string, force = true) =>
    authorizedRequest<unknown>('DELETE', '/api/ledgers/' + encodeURIComponent(clientUid), {
      query: { force },
    }),

  // assets
  listAssets: (includeArchived = true) =>
    authorizedRequest<AssetDto[]>('GET', '/api/assets', { query: { includeArchived } }),
  putAsset: (body: AssetUpsert) => authorizedRequest<AssetDto>('PUT', '/api/assets', { body }),
  deleteAsset: (clientUid: string) =>
    authorizedRequest<unknown>('DELETE', '/api/assets/' + encodeURIComponent(clientUid)),

  // category-groups（大类；App 用大类名当 clientUid）
  listCategoryGroups: (includeArchived = true) =>
    authorizedRequest<CategoryGroupDto[]>('GET', '/api/category-groups', {
      query: { includeArchived },
    }),
  putCategoryGroup: (body: CategoryGroupUpsert) =>
    authorizedRequest<CategoryGroupDto>('PUT', '/api/category-groups', { body }),
  deleteCategoryGroup: (clientUid: string) =>
    authorizedRequest<unknown>('DELETE', '/api/category-groups/' + encodeURIComponent(clientUid)),

  // categories
  listCategories: (includeArchived = true) =>
    authorizedRequest<CategoryDto[]>('GET', '/api/categories', { query: { includeArchived } }),
  putCategory: (body: CategoryUpsert) =>
    authorizedRequest<CategoryDto>('PUT', '/api/categories', { body }),
  deleteCategory: (clientUid: string) =>
    authorizedRequest<unknown>('DELETE', '/api/categories/' + encodeURIComponent(clientUid)),

  // transactions（唯一分页的列表：size 上限 100）
  listTransactions: (params: { page?: number; size?: number; ledgerUid?: string } = {}) =>
    authorizedRequest<PageResponse<TransactionDto>>('GET', '/api/transactions', {
      query: { page: params.page ?? 0, size: params.size ?? 100, ledgerUid: params.ledgerUid },
    }),
  putTransaction: (body: TransactionUpsert) =>
    authorizedRequest<TransactionDto>('PUT', '/api/transactions', { body }),
  deleteTransaction: (clientUid: string) =>
    authorizedRequest<unknown>('DELETE', '/api/transactions/' + encodeURIComponent(clientUid)),

  // budgets
  listBudgets: () => authorizedRequest<BudgetDto[]>('GET', '/api/budgets'),
  putBudget: (body: BudgetUpsert) => authorizedRequest<BudgetDto>('PUT', '/api/budgets', { body }),
  deleteBudget: (clientUid: string) =>
    authorizedRequest<unknown>('DELETE', '/api/budgets/' + encodeURIComponent(clientUid)),

  // payment-plans（计划付款；PATCH 里 lastProcessedDate 是补账游标）
  listPaymentPlans: (includeArchived = true) =>
    authorizedRequest<PaymentPlanDto[]>('GET', '/api/payment-plans', { query: { includeArchived } }),
  putPaymentPlan: (body: PaymentPlanUpsert) =>
    authorizedRequest<PaymentPlanDto>('PUT', '/api/payment-plans', { body }),
  deletePaymentPlan: (clientUid: string) =>
    authorizedRequest<unknown>('DELETE', '/api/payment-plans/' + encodeURIComponent(clientUid)),

  // reports（按币种分块，绝不跨币种相加）
  getReportSummary: (params: { from?: string; to?: string; currency?: string } = {}) =>
    authorizedRequest<ReportSummaryDto>('GET', '/api/reports/summary', {
      query: { from: params.from, to: params.to, currency: params.currency },
    }),
  getAssetBalances: () =>
    authorizedRequest<AssetBalancesDto>('GET', '/api/reports/asset-balances'),

  // push tokens（按令牌归属，不信任客户端自报 userId）
  registerPushToken: (token: string, platform: string) =>
    authorizedRequest<unknown>('POST', '/api/push-tokens', { body: { token, platform } }),
  unregisterPushToken: (token: string) =>
    authorizedRequest<unknown>('DELETE', '/api/push-tokens', { body: { token } }),

  // premium（桩：只读状态，内购未实现）
  premiumStatus: () =>
    authorizedRequest<{ active: boolean; implemented: boolean }>('GET', '/api/premium/status'),
};

/**
 * 拉全部流水：服务端 size 上限 100，必须翻页（否则会被静默截断，
 * 换设备恢复时"少了几个月流水"）。按 totalPages 收敛，并留硬上限防御死循环。
 */
export async function listAllTransactions(): Promise<TransactionDto[]> {
  const out: TransactionDto[] = [];
  const PAGE_SIZE = 100;
  for (let page = 0; page < 10_000; page += 1) {
    const res = await api.listTransactions({ page, size: PAGE_SIZE });
    out.push(...res.content);
    if (res.content.length === 0 || page + 1 >= res.totalPages) return out;
  }
  return out;
}
