import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ApiError,
  AssetDto,
  AssetUpsert,
  BudgetDto,
  BudgetUpsert,
  CategoryDto,
  CategoryGroupDto,
  CategoryGroupUpsert,
  CategoryUpsert,
  LedgerDto,
  LedgerUpsert,
  ProfilePatch,
  TransactionDto,
  TransactionUpsert,
  api,
  isSessionDeadError,
  listAllTransactions,
} from './apiClient';
import { runStorageExclusive } from './storageQueue';
import { getCurrentUser, hydrateSession } from './sessionStore';
import {
  Asset,
  Budget,
  Category,
  CategoryGroup,
  DateFormat,
  DecimalPlaces,
  Ledger,
  PeriodPreference,
  Transaction,
  WeekStartsOn,
} from '../types';
import { amountKey, optionalAmount, optionalRate, parseAmount, rateKey } from '../utils/money4';
import { EXPENSE_CATEGORY_GROUPS, INCOME_CATEGORY_GROUPS } from '../utils/defaultCategories';

/**
 * 云端按行同步服务。
 *
 * 架构：AsyncStorage 仍是本地主存储（离线照常记账），云端按行备份/恢复。
 * - 推（push）：本地数据变化后防抖触发，diff 出增/改/删的行，逐行 PUT/DELETE 到自研后端
 * - 拉（pull）：登录或重启恢复会话时拉取云端全部行，与本地合并（同 id 以云端为准，
 *   本机独有行保留），合并结果写回 AsyncStorage 并通知 AppContext 重载
 *   —— 换手机登录同一账号即自动恢复全部资料
 *
 * 本文件不 import 任何 React / Context：与 UI 完全解耦，
 * 通过 onLocalDataReplaced 回调让 AppContext 刷新界面。
 *
 * 数据口径（docs/API.md）：后端是 camelCase；本地字符串 id == 后端的 clientUid；
 * 金额是 4 位小数的定点数（这里用定点字符串做 diff，绝不用浮点比较）；
 * 分类的 group 名 → 大类表的 clientUid；预算用 scope + clientUid，不再自己拼 id 当主键。
 */

// ────────────────────────────── 类型与常量 ──────────────────────────────

/** AppContext 管理的全部本地数据快照（key 名与 AppContext 的 STORAGE_KEYS 对应） */
export interface LocalSnapshot {
  transactions: Transaction[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
  budgets: Budget[];
  ledgers: Ledger[];
  activeLedgerId: string;
  currency: string;
  periodPreference: PeriodPreference;
  assets: Asset[];
  dateFormat: DateFormat;
  weekStartsOn: WeekStartsOn;
  decimalPlaces: DecimalPlaces;
}

/** 云端行（canonical 形状：只包含本 App 负责的字段，金额是 4 位定点字符串） */
type Row = Record<string, unknown>;

const MIRROR_KEY = '@jizhang/syncMirror'; // 最近一次成功同步的数据镜像，用于 diff 出变更行
const LAST_SYNC_KEY = '@jizhang/lastSyncAt';
const LAST_USER_KEY = '@jizhang/lastUserId';

/** 并发推送上限：太少慢、太多容易撞后端连接池；逐行失败隔离不受影响 */
const PUSH_CONCURRENCY = 4;

export type SyncStatus = 'idle' | 'syncing' | 'error';

/** 同步失败的稳定错误码（界面按码显示中英文提示） */
export type SyncErrorCode =
  | 'network'
  | 'auth'
  | 'constraint'
  | 'schema'
  | 'server'
  | 'local_data_corrupt'
  | 'not_logged_in'
  | 'sync_in_progress'
  | 'unknown';

export interface SyncResult {
  ok: boolean;
  error?: SyncErrorCode | string;
  /** 原始错误信息（弹窗副文里展示，便于反馈定位） */
  detail?: string;
}

/** 本地快照里存在但 JSON 解析失败的 key：继续同步会把坏数据当空表推上云（误删云端），必须中止 */
export class LocalDataCorruptError extends Error {
  constructor(keys: string[]) {
    super('本地数据解析失败：' + keys.join(', '));
    this.name = 'LocalDataCorruptError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 把任意同步异常归类成稳定错误码（界面按码显示中英文提示）：
 * - network：网络层没拿到响应（弱网 / 后端未启动 / DNS）
 * - auth：令牌失效或被吊销（TOKEN_EXPIRED 已在 apiClient 里单飞刷新并重放）
 * - constraint：数据类拒绝（字段校验/引用不存在/唯一冲突/默认账本不可删…）
 * - schema：服务端没有这个接口（服务端版本落后于 App）
 * - server：服务端 5xx
 */
function classifySyncError(
  e: unknown
): Exclude<SyncErrorCode, 'local_data_corrupt' | 'not_logged_in' | 'sync_in_progress'> {
  if (e instanceof ApiError) {
    if (e.code === 'NETWORK_ERROR' || e.code === 'TIMEOUT') return 'network';
    if (
      isSessionDeadError(e) ||
      e.code === 'TOKEN_EXPIRED' ||
      e.code === 'UNAUTHORIZED' ||
      e.code === 'INVALID_CREDENTIALS' ||
      e.code === 'FORBIDDEN'
    ) {
      return 'auth';
    }
    if (e.code === 'NOT_FOUND') return 'schema';
    if (
      e.code === 'VALIDATION_FAILED' ||
      e.code === 'BAD_REQUEST' ||
      e.code === 'CONFLICT' ||
      e.code === 'PAYLOAD_TOO_LARGE' ||
      e.code === 'NOT_IMPLEMENTED'
    ) {
      return 'constraint';
    }
    if (e.code === 'INTERNAL_ERROR' || e.code === 'UPSTREAM_ERROR' || e.code === 'AI_UNAVAILABLE') {
      return 'server';
    }
    if (e.status >= 500) return 'server';
    if (e.status >= 400) return 'constraint';
    return 'unknown';
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/network|fetch|timeout|timed out|socket|dns/i.test(message)) return 'network';
  return 'unknown';
}

/** 瞬时错误（网络/服务端抖动）值得重试；数据类错误重试没有意义 */
function isTransientError(e: unknown): boolean {
  const code = classifySyncError(e);
  return code === 'network' || code === 'server';
}

/** 瞬时错误重试 2 次（0.8s/1.6s 退避）；非瞬时错误立即抛出 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isTransientError(e)) throw e;
  }
  await sleep(800);
  try {
    return await fn();
  } catch (e) {
    if (!isTransientError(e)) throw e;
  }
  await sleep(1600);
  return fn();
}

/** 有限并发（每行独立成败，不因为一行坏数据拖垮整张表） */
async function runLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await task(items[index]);
    }
  });
  await Promise.all(workers);
}

// ────────────────────────────── 同步状态（供 UI 订阅） ──────────────────────────────

let status: SyncStatus = 'idle';
let lastSyncAt: number | null = null;
const statusListeners = new Set<() => void>();

AsyncStorage.getItem(LAST_SYNC_KEY)
  .then((v) => {
    if (v) lastSyncAt = Number(v);
  })
  .catch(() => {});

function setStatus(next: SyncStatus) {
  status = next;
  statusListeners.forEach((cb) => cb());
}

function setLastSyncAt(t: number) {
  lastSyncAt = t;
  AsyncStorage.setItem(LAST_SYNC_KEY, String(t)).catch(() => {});
  statusListeners.forEach((cb) => cb());
}

export function getSyncState(): { status: SyncStatus; lastSyncAt: number | null } {
  return { status, lastSyncAt };
}

export function subscribeSyncState(cb: () => void): () => void {
  statusListeners.add(cb);
  return () => statusListeners.delete(cb);
}

// ────────────────────────────── 本地数据被替换的回调（AppContext 重载界面用） ──────────────────────────────

const reloadListeners = new Set<() => void>();

export function onLocalDataReplaced(cb: () => void): () => void {
  reloadListeners.add(cb);
  return () => reloadListeners.delete(cb);
}

function notifyDataReplaced() {
  reloadListeners.forEach((cb) => cb());
}

// ────────────────────────────── 小工具 ──────────────────────────────

/** 后端 VARCHAR 上限，超长会被 400 整行拒绝——这里先截断，宁可少几个字也不要同步失败 */
function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** 后端 color 是 CHAR(7) 且校验 #RRGGBB；本地老数据里的 emoji/短 hex 归一化掉 */
function safeColor(value: string | undefined | null, fallback?: string): string | null {
  if (value && /^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return fallback ?? null;
}

/** 后端币种是 CHAR(3) 且校验 ISO-4217；老数据里的异常币种退回全局币种，避免整行 400 */
function safeCurrency(value: string | undefined | null, fallback: string): string {
  const upper = (value || fallback || 'MYR').toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) return upper;
  const back = (fallback || 'MYR').toUpperCase();
  return /^[A-Z]{3}$/.test(back) ? back : 'MYR';
}
/** ISO 时间戳 → 毫秒（本地 createdAt 是 number）；失败返回 undefined */
function toMillis(iso: unknown): number | undefined {
  if (typeof iso !== 'string') return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/** 大类名 == 内置大类（这些组由 defaultCategories 渲染，不进 categoryGroups，避免管理页重复分组） */
const DEFAULT_GROUP_NAMES = new Set<string>([...EXPENSE_CATEGORY_GROUPS, ...INCOME_CATEGORY_GROUPS]);

// ────────────────────────────── 行转换：本地实体 ↔ 云端行 ──────────────────────────────
// 所有金额字段在"行"里都是 4 位定点字符串（amountKey）：diff 就是字符串相等，不用浮点比较。

interface LedgerRow extends Row {
  clientUid: string;
  name: string;
  icon: string;
  color: string | null;
  sortOrder: number;
}

interface AssetRow extends Row {
  clientUid: string;
  ledgerUid: string;
  name: string;
  icon: string;
  color: string;
  type: string;
  currency: string;
  initialBalance: string;
  creditLimit: string | null;
  statementDay: number | null;
  dueDay: number | null;
  interestRate: string | null;
  defaultAsset: boolean;
  sortOrder: number;
  archived: boolean;
}

interface GroupRow extends Row {
  clientUid: string;
  name: string;
  color: string | null;
  icon: string | null;
  type: string;
  sortOrder: number;
}

interface CategoryRow extends Row {
  clientUid: string;
  groupUid: string | null;
  name: string;
  icon: string;
  color: string | null;
  type: string;
  sortOrder: number;
}

interface TxRow extends Row {
  clientUid: string;
  ledgerUid: string;
  categoryUid: string | null;
  assetUid: string | null;
  fromAssetUid: string | null;
  toAssetUid: string | null;
  type: string;
  amount: string;
  exchangeRate: string | null;
  convertedAmount: string | null;
  fee: string | null;
  occurredOn: string;
  note: string;
  displayName: string | null;
  receiptPath: string | null;
}

interface BudgetRow extends Row {
  clientUid: string;
  categoryUid: string | null;
  currency: string;
  amount: string;
}

/** 全局设置行（PATCH /api/profile 的字段子集） */
interface ProfileRow extends Row {
  currency: string;
  dateFormat: string | null;
  weekStartsOn: number;
  decimalPlaces: number;
  periodPreference: PeriodPreference;
  activeLedgerUid: string | null;
}

function ledgerToRow(l: Ledger, index: number): LedgerRow {
  return {
    clientUid: l.id,
    name: clip(l.name, 100),
    icon: clip(l.icon || 'book-outline', 64),
    color: safeColor(l.color),
    sortOrder: index,
  };
}

function ledgerFromDto(d: LedgerDto): Ledger {
  return {
    id: d.clientUid,
    name: d.name,
    icon: d.icon,
    color: d.color ?? undefined,
    createdAt: toMillis(d.createdAt) ?? Date.now(),
  };
}

function assetToRow(a: Asset, index: number, fallbackLedgerId: string, fallbackCurrency: string): AssetRow {
  return {
    clientUid: a.id,
    ledgerUid: a.ledgerId || fallbackLedgerId,
    name: clip(a.name, 100),
    icon: clip(a.icon || 'wallet-outline', 64),
    color: safeColor(a.color, '#4C9AFF') as string,
    type: a.type,
    currency: safeCurrency(a.currency, fallbackCurrency),
    initialBalance: amountKey(a.initialBalance ?? 0),
    creditLimit: a.creditLimit != null ? amountKey(a.creditLimit) : null,
    statementDay: a.statementDay ?? null,
    dueDay: a.dueDay ?? null,
    interestRate: a.interestRate != null ? rateKey(a.interestRate) : null,
    defaultAsset: a.isDefault === true,
    sortOrder: index,
    archived: Boolean(a.archivedAt),
  };
}

function assetFromDto(d: AssetDto): Asset {
  return {
    id: d.clientUid,
    name: d.name,
    icon: d.icon,
    color: d.color,
    type: d.type as Asset['type'],
    currency: d.currency,
    initialBalance: parseAmount(d.initialBalance) ?? 0,
    ledgerId: d.ledgerUid,
    createdAt: toMillis(d.createdAt) ?? Date.now(),
    creditLimit: optionalAmount(d.creditLimit),
    statementDay: d.statementDay ?? undefined,
    dueDay: d.dueDay ?? undefined,
    interestRate: optionalRate(d.interestRate),
    isDefault: d.defaultAsset ? true : undefined,
    // 归档时间只在"确实已归档"时保留；未归档 = 活跃账户（App 用 undefined 判断活跃）
    archivedAt: d.archived ? d.archivedAt ?? new Date().toISOString() : undefined,
  };
}

/** App 的大类没有 id：用大类名当 clientUid（docs/DB-SCHEMA §3.5），跨端稳定 */
function groupToRow(g: CategoryGroup, index: number): GroupRow {
  return {
    clientUid: clip(g.name, 64),
    name: clip(g.name, 50),
    color: safeColor(g.color),
    icon: g.icon ? clip(g.icon, 64) : null,
    type: g.type,
    sortOrder: index,
  };
}

function groupFromDto(d: CategoryGroupDto): CategoryGroup {
  return {
    name: d.name,
    color: d.color ?? undefined,
    icon: d.icon ?? undefined,
    type: d.type as CategoryGroup['type'],
  };
}

function categoryToRow(c: Category, index: number): CategoryRow {
  return {
    clientUid: c.id,
    groupUid: c.group ? clip(c.group, 64) : null,
    name: clip(c.name, 50),
    icon: clip(c.icon || 'help-outline', 64),
    color: safeColor(c.color),
    type: c.type,
    sortOrder: index,
  };
}

function categoryFromDto(d: CategoryDto): Category {
  return {
    id: d.clientUid,
    name: d.name,
    icon: d.icon,
    color: d.color ?? '',
    type: d.type as Category['type'],
    group: d.groupUid ?? undefined,
  };
}

function txToRow(t: Transaction): TxRow {
  return {
    clientUid: t.id,
    ledgerUid: t.ledgerId,
    // App 的空串表示"无分类"，后端要 null（docs/API.md §4.1）
    categoryUid: t.categoryId ? t.categoryId : null,
    assetUid: t.assetId ?? null,
    fromAssetUid: t.fromAssetId ?? null,
    toAssetUid: t.toAssetId ?? null,
    type: t.type,
    amount: amountKey(t.amount),
    // 汇率/到账金额/手续费只属于转账；expense/income 传上去后端也会清成 NULL
    exchangeRate: t.exchangeRate != null ? rateKey(t.exchangeRate) : null,
    convertedAmount: t.convertedAmount != null ? amountKey(t.convertedAmount) : null,
    fee: t.fee != null ? amountKey(t.fee) : null,
    occurredOn: t.date,
    note: clip(t.note ?? '', 500),
    displayName: t.displayName ? clip(t.displayName, 100) : null,
    receiptPath: t.receiptUri ? clip(t.receiptUri, 512) : null,
  };
}

function txFromDto(d: TransactionDto): Transaction {
  return {
    id: d.clientUid,
    amount: parseAmount(d.amount) ?? 0,
    type: d.type as Transaction['type'],
    categoryId: d.categoryUid ?? '',
    date: d.occurredOn,
    note: d.note ?? '',
    displayName: d.displayName ?? undefined,
    createdAt: toMillis(d.createdAt) ?? Date.now(),
    ledgerId: d.ledgerUid,
    assetId: d.assetUid ?? undefined,
    receiptUri: d.receiptPath ?? undefined,
    fromAssetId: d.fromAssetUid ?? undefined,
    toAssetId: d.toAssetUid ?? undefined,
    exchangeRate: optionalRate(d.exchangeRate),
    convertedAmount: optionalAmount(d.convertedAmount),
    fee: optionalAmount(d.fee),
  };
}

/**
 * App 端预算没有 id：本地用 categoryId + 币种定位（'total' = 总预算）。
 * 后端 clientUid 由 (categoryUid|currency) 派生，响应一定回传；
 * 这里优先用响应里的 clientUid（跨端一致），缺失时才退回同样的派生规则。
 */
export function budgetId(b: Budget): string {
  return b.categoryId + '|' + (b.currency ?? '');
}

function budgetRowId(b: Budget, fallbackCurrency: string): string {
  return b.clientUid ?? b.categoryId + '|' + (b.currency ?? fallbackCurrency);
}

function budgetToRow(b: Budget, fallbackCurrency: string): BudgetRow {
  return {
    clientUid: budgetRowId(b, fallbackCurrency),
    categoryUid: b.categoryId === 'total' ? null : b.categoryId,
    currency: safeCurrency(b.currency, fallbackCurrency),
    amount: amountKey(b.amount),
  };
}

function budgetFromDto(d: BudgetDto): Budget {
  return {
    // scope='total' 的行在 App 侧统一表示成 'total'
    categoryId: d.scope === 'total' ? 'total' : d.categoryUid ?? 'total',
    amount: parseAmount(d.amount) ?? 0,
    currency: d.currency,
    clientUid: d.clientUid,
  };
}

function profileToRow(s: LocalSnapshot): ProfileRow {
  const ledgerIds = new Set(s.ledgers.map((l) => l.id));
  return {
    currency: safeCurrency(s.currency, 'MYR'),
    dateFormat: s.dateFormat,
    weekStartsOn: s.weekStartsOn,
    decimalPlaces: s.decimalPlaces,
    periodPreference: s.periodPreference,
    // 当前账本必须真实存在，否则后端 400（activeLedgerUid 做引用校验）
    activeLedgerUid: ledgerIds.has(s.activeLedgerId) ? s.activeLedgerId : null,
  };
}

/** 把云端 profile 套到本地快照的设置字段上（云端为 null 的字段保留本地值） */
function applyProfileRow(s: LocalSnapshot, row: ProfileRow | null): LocalSnapshot {
  if (!row) return s;
  const period = row.periodPreference;
  return {
    ...s,
    currency: typeof row.currency === 'string' && row.currency ? row.currency : s.currency,
    dateFormat:
      typeof row.dateFormat === 'string' && row.dateFormat ? (row.dateFormat as DateFormat) : s.dateFormat,
    weekStartsOn: typeof row.weekStartsOn === 'number' ? (row.weekStartsOn as WeekStartsOn) : s.weekStartsOn,
    decimalPlaces:
      typeof row.decimalPlaces === 'number' ? (row.decimalPlaces as DecimalPlaces) : s.decimalPlaces,
    periodPreference:
      period && typeof period === 'object' && 'type' in period
        ? (period as PeriodPreference)
        : s.periodPreference,
    activeLedgerId: row.activeLedgerUid ?? s.activeLedgerId,
  };
}

function profileFromDto(dto: {
  currency?: string | null;
  dateFormat?: string | null;
  weekStartsOn?: number | null;
  decimalPlaces?: number | null;
  periodPreference?: unknown;
  activeLedgerUid?: string | null;
}): ProfileRow {
  const period = dto.periodPreference;
  return {
    currency: typeof dto.currency === 'string' ? dto.currency : 'MYR',
    dateFormat: typeof dto.dateFormat === 'string' ? dto.dateFormat : null,
    weekStartsOn: typeof dto.weekStartsOn === 'number' ? dto.weekStartsOn : 1,
    decimalPlaces: typeof dto.decimalPlaces === 'number' ? dto.decimalPlaces : 2,
    periodPreference:
      period && typeof period === 'object' && 'type' in period
        ? (period as PeriodPreference)
        : { type: 'month' },
    activeLedgerUid: typeof dto.activeLedgerUid === 'string' ? dto.activeLedgerUid : null,
  };
}

// ────────────────────────────── 镜像（最近一次成功同步的数据，用于 diff） ──────────────────────────────

interface SyncMirror {
  ledgers: Row[];
  assets: Row[];
  categoryGroups: Row[];
  categories: Row[];
  transactions: Row[];
  budgets: Row[];
  profile: ProfileRow | null;
}

function emptyMirror(): SyncMirror {
  return {
    ledgers: [],
    assets: [],
    categoryGroups: [],
    categories: [],
    transactions: [],
    budgets: [],
    profile: null,
  };
}

async function loadMirror(): Promise<SyncMirror> {
  try {
    const raw = await AsyncStorage.getItem(MIRROR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncMirror> & { category_groups?: Row[] };
      // 兼容旧版本（旧键名 category_groups）的镜像：读不到就当空镜像，下一次推送全量重放
      return {
        ledgers: parsed.ledgers ?? [],
        assets: parsed.assets ?? [],
        categoryGroups: parsed.categoryGroups ?? parsed.category_groups ?? [],
        categories: parsed.categories ?? [],
        transactions: parsed.transactions ?? [],
        budgets: parsed.budgets ?? [],
        profile: (parsed.profile as ProfileRow | null) ?? null,
      };
    }
  } catch {}
  return emptyMirror();
}

function saveMirror(m: SyncMirror): Promise<void> {
  return AsyncStorage.setItem(MIRROR_KEY, JSON.stringify(m)).catch(() => {});
}

/**
 * 本地分类用到的所有大类（含 defaultCategories 里写死的默认大组）：
 * 分类的 group 是大类**名字**，后端要 clientUid（= 名字）且必须已存在，
 * 所以推送前把「categoryGroups ∪ 分类里出现的 group 名」一起补上。
 */
function effectiveGroups(s: LocalSnapshot): CategoryGroup[] {
  const out: CategoryGroup[] = [...s.categoryGroups];
  const seen = new Set(out.map((g) => g.name));
  s.categories.forEach((c) => {
    if (!c.group || seen.has(c.group)) return;
    seen.add(c.group);
    out.push({ name: c.group, type: c.type });
  });
  return out;
}

/** 把当前快照按表转成云端行（canonical 形状，diff 用） */
function buildAllRows(s: LocalSnapshot): SyncMirror {
  const fallbackLedgerId = s.activeLedgerId || 'default';
  const currency = s.currency || 'MYR';
  return {
    ledgers: s.ledgers.map(ledgerToRow),
    assets: s.assets.map((a, i) => assetToRow(a, i, fallbackLedgerId, currency)),
    categoryGroups: effectiveGroups(s).map(groupToRow),
    categories: s.categories.map(categoryToRow),
    transactions: s.transactions.map(txToRow),
    budgets: s.budgets.map((b) => budgetToRow(b, currency)),
    profile: profileToRow(s),
  };
}

// ────────────────────────────── 本地读写 ──────────────────────────────

const KEYS = {
  transactions: '@jizhang/transactions',
  categories: '@jizhang/categories',
  categoryGroups: '@jizhang/categoryGroups',
  budgets: '@jizhang/budgets',
  ledgers: '@jizhang/ledgers',
  activeLedgerId: '@jizhang/activeLedgerId',
  currency: '@jizhang/currency',
  periodPreference: '@jizhang/periodPreference',
  assets: '@jizhang/assets',
  dateFormat: '@jizhang/dateFormat',
  weekStartsOn: '@jizhang/weekStartsOn',
  decimalPlaces: '@jizhang/decimalPlaces',
};

function emptySnapshot(): LocalSnapshot {
  return {
    transactions: [],
    categories: [],
    categoryGroups: [],
    budgets: [],
    ledgers: [],
    activeLedgerId: 'default',
    currency: 'MYR',
    periodPreference: { type: 'month' },
    assets: [],
    dateFormat: 'YYYY/MM/DD',
    weekStartsOn: 1,
    decimalPlaces: 2,
  };
}

async function readLocalSnapshot(): Promise<LocalSnapshot> {
  const [tx, cat, grp, bud, led, activeLed, curr, per, ast, df, wk, dp] = await Promise.all([
    AsyncStorage.getItem(KEYS.transactions),
    AsyncStorage.getItem(KEYS.categories),
    AsyncStorage.getItem(KEYS.categoryGroups),
    AsyncStorage.getItem(KEYS.budgets),
    AsyncStorage.getItem(KEYS.ledgers),
    AsyncStorage.getItem(KEYS.activeLedgerId),
    AsyncStorage.getItem(KEYS.currency),
    AsyncStorage.getItem(KEYS.periodPreference),
    AsyncStorage.getItem(KEYS.assets),
    AsyncStorage.getItem(KEYS.dateFormat),
    AsyncStorage.getItem(KEYS.weekStartsOn),
    AsyncStorage.getItem(KEYS.decimalPlaces),
  ]);
  // key 存在但解析失败 = 本地数据损坏。静默回退空数组会把坏表当"空表"推上云
  // （diff 出全量 delete，误删云端），所以这里直接中止同步保护数据。
  const corrupt: string[] = [];
  const parseStrict = <T,>(raw: string | null, key: string, fallback: T): T => {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      corrupt.push(key);
      return fallback;
    }
  };
  const transactions = parseStrict<Transaction[]>(tx, KEYS.transactions, []);
  const categories = parseStrict<Category[]>(cat, KEYS.categories, []);
  const categoryGroups = parseStrict<CategoryGroup[]>(grp, KEYS.categoryGroups, []);
  const budgets = parseStrict<Budget[]>(bud, KEYS.budgets, []);
  const ledgers = parseStrict<Ledger[]>(led, KEYS.ledgers, []);
  const periodPreference = parseStrict<PeriodPreference>(per, KEYS.periodPreference, { type: 'month' });
  const assets = parseStrict<Asset[]>(ast, KEYS.assets, []);
  if (corrupt.length) throw new LocalDataCorruptError(corrupt);
  return {
    transactions,
    categories,
    categoryGroups,
    budgets,
    ledgers,
    activeLedgerId: activeLed ?? 'default',
    currency: curr ?? 'MYR',
    periodPreference,
    assets,
    dateFormat: (df as DateFormat) ?? 'YYYY/MM/DD',
    // 注意不能用 || 兜底：weekStartsOn 合法值包含 0（周日），会被 falsy 判断吞掉
    weekStartsOn: wk != null ? (Number(wk) as WeekStartsOn) : 1,
    decimalPlaces: dp != null ? (Number(dp) as DecimalPlaces) : 2,
  };
}

// ────────────────────────────── 老数据兜底（防止 400 拒写卡死同步） ──────────────────────────────

const FALLBACK_COLOR = '#4C9AFF'; // 与 AppContext.DEFAULT_LEDGER 一致的主题蓝
const FALLBACK_ICON = 'book-outline';

function dedupeBudgets(list: Budget[]): Budget[] {
  const seen = new Set<string>();
  const out = list.filter((b) => {
    const id = b.clientUid ?? budgetId(b);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return out.length === list.length ? list : out;
}

/**
 * 修复历史遗留的不完整/悬空数据，避免推云时被后端字段校验整块拒绝：
 * - 资产缺 color/currency/icon/ledgerId/createdAt（每资产币种上线前的老设备数据）
 * - 交易缺 ledgerId/createdAt/date、金额非法（NaN 会被后端拒绝）
 * - 账本缺 icon/createdAt
 * - 预算同 (分类+币种) 的重复条目去重；金额 <= 0 的条目清掉（后端不接受 0 预算，清预算 = 删除）
 * - 预算/流水指向已被删除的分类：预算丢弃、流水的分类置空
 *   —— 与后端「删分类时预算 CASCADE、流水 category_id SET NULL」的语义对齐
 *   （分类列表为空时不处理：那可能是还没加载完，不能把全部分类引用抹掉）
 * 返回 (快照, 是否有修复)：有修复时调用方把结果写回本地自愈，下次不再触发。
 */
function normalizeSnapshot(s: LocalSnapshot): { snapshot: LocalSnapshot; changed: boolean } {
  let changed = false;
  const currencyFallback = s.currency || 'MYR';
  const ledgerFallback = s.activeLedgerId || 'default';

  const assets = s.assets.map((a) => {
    const patch: Partial<Asset> = {};
    if (!a.color) patch.color = FALLBACK_COLOR;
    if (!a.currency) patch.currency = currencyFallback;
    if (!a.icon) patch.icon = FALLBACK_ICON;
    if (!a.ledgerId) patch.ledgerId = ledgerFallback;
    if (!Number.isFinite(Number(a.createdAt)) || !a.createdAt) patch.createdAt = Date.now();
    if (!Object.keys(patch).length) return a;
    changed = true;
    return { ...a, ...patch } as Asset;
  });

  const knownCategories = new Set(s.categories.map((c) => c.id));
  const categoriesLoaded = s.categories.length > 0;

  const transactions = s.transactions.map((t) => {
    const patch: Partial<Transaction> = {};
    if (!t.ledgerId) patch.ledgerId = ledgerFallback;
    if (!Number.isFinite(Number(t.createdAt)) || !t.createdAt) patch.createdAt = Date.now();
    if (!t.date) patch.date = new Date().toISOString().slice(0, 10);
    if (!Number.isFinite(Number(t.amount))) patch.amount = 0;
    if (categoriesLoaded && t.categoryId && !knownCategories.has(t.categoryId)) patch.categoryId = '';
    if (!Object.keys(patch).length) return t;
    changed = true;
    return { ...t, ...patch } as Transaction;
  });

  const ledgers = s.ledgers.map((l) => {
    const patch: Partial<Ledger> = {};
    if (!l.icon) patch.icon = FALLBACK_ICON;
    if (!Number.isFinite(Number(l.createdAt)) || !l.createdAt) patch.createdAt = Date.now();
    if (!Object.keys(patch).length) return l;
    changed = true;
    return { ...l, ...patch } as Ledger;
  });

  const budgetsFiltered = s.budgets.filter((b) => {
    if (!Number.isFinite(Number(b.amount)) || Number(b.amount) <= 0) return false;
    if (categoriesLoaded && b.categoryId !== 'total' && !knownCategories.has(b.categoryId)) return false;
    return true;
  });
  if (budgetsFiltered.length !== s.budgets.length) changed = true;
  const budgets = dedupeBudgets(budgetsFiltered);
  if (budgets !== budgetsFiltered) changed = true;

  return {
    snapshot: changed ? { ...s, assets, transactions, ledgers, budgets } : s,
    changed,
  };
}

/** 合并结果写回 AsyncStorage（AppContext 通过 onLocalDataReplaced 重载进内存） */
async function writeLocalSnapshot(s: LocalSnapshot): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(KEYS.transactions, JSON.stringify(s.transactions)),
    AsyncStorage.setItem(KEYS.categories, JSON.stringify(s.categories)),
    AsyncStorage.setItem(KEYS.categoryGroups, JSON.stringify(s.categoryGroups)),
    AsyncStorage.setItem(KEYS.budgets, JSON.stringify(s.budgets)),
    AsyncStorage.setItem(KEYS.ledgers, JSON.stringify(s.ledgers)),
    AsyncStorage.setItem(KEYS.activeLedgerId, s.activeLedgerId),
    AsyncStorage.setItem(KEYS.currency, s.currency),
    AsyncStorage.setItem(KEYS.periodPreference, JSON.stringify(s.periodPreference)),
    AsyncStorage.setItem(KEYS.assets, JSON.stringify(s.assets)),
    AsyncStorage.setItem(KEYS.dateFormat, s.dateFormat),
    AsyncStorage.setItem(KEYS.weekStartsOn, String(s.weekStartsOn)),
    AsyncStorage.setItem(KEYS.decimalPlaces, String(s.decimalPlaces)),
  ]);
}

// ────────────────────────────── 云端读取（拉全量） ──────────────────────────────

interface CloudPull {
  /** canonical 形状的云端行（用于合并设置字段与镜像） */
  cloud: SyncMirror;
  /** DTO 转成的本地实体（合并时用） */
  entities: {
    ledgers: Ledger[];
    assets: Asset[];
    categoryGroups: CategoryGroup[];
    categories: Category[];
    transactions: Transaction[];
    budgets: Budget[];
  };
}

async function fetchAll(): Promise<CloudPull> {
  const [ledgerDtos, assetDtos, groupDtos, categoryDtos, txDtos, budgetDtos, profileDto] = await Promise.all([
    withRetry(() => api.listLedgers(true)),
    withRetry(() => api.listAssets(true)),
    withRetry(() => api.listCategoryGroups(true)),
    withRetry(() => api.listCategories(true)),
    // 流水是唯一分页的列表（size 上限 100），必须翻页拉全
    withRetry(() => listAllTransactions()),
    withRetry(() => api.listBudgets()),
    withRetry(() => api.getProfile()),
  ]);

  const ledgers = ledgerDtos.map(ledgerFromDto);
  const assets = assetDtos.map(assetFromDto);
  const categoryGroups = groupDtos.map(groupFromDto);
  const categories = categoryDtos.map(categoryFromDto);
  const transactions = txDtos.map(txFromDto);
  const budgets = budgetDtos.map(budgetFromDto);
  const profile = profileFromDto(profileDto);

  // 镜像统一转成 canonical 形状（toRow(fromDto(dto))），这样推送 diff 时键序一致；
  // profile 行也走一次归一化，避免带着 updatedAt 之类的服务端列导致每次启动都误判"有变化"
  const cloud: SyncMirror = {
    ledgers: ledgers.map(ledgerToRow),
    assets: assets.map((a, i) => assetToRow(a, i, a.ledgerId || 'default', profile.currency)),
    categoryGroups: categoryGroups.map(groupToRow),
    categories: categories.map(categoryToRow),
    transactions: transactions.map(txToRow),
    budgets: budgets.map((b) => budgetToRow(b, profile.currency)),
    profile,
  };
  return { cloud, entities: { ledgers, assets, categoryGroups, categories, transactions, budgets } };
}

// ────────────────────────────── 推送 ──────────────────────────────

/** 单行推送失败记录：数据类失败跳过坏行、其余照常上云，失败行不入镜像（下次同步重试） */
interface RowFailure {
  table: string;
  id: string;
  op: 'upsert' | 'delete';
  reason: string;
}

function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const details = e.details?.length ? ' (' + e.details.join('; ') + ')' : '';
    return '[' + e.code + '] ' + e.message + details;
  }
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

/** 一次 PUT/DELETE：瞬时错误重试；数据类错误按"单行失败"隔离，不拖垮整张表 */
async function pushRow(
  table: string,
  id: string,
  op: 'upsert' | 'delete',
  action: () => Promise<unknown>,
  failedRows: RowFailure[]
): Promise<void> {
  try {
    await withRetry(action);
  } catch (e) {
    if (isTransientError(e)) throw e; // 网络/5xx：整次同步失败（下次重试，本地数据零丢失）
    failedRows.push({ table, id, op, reason: errorMessage(e) });
  }
}

/** 父表在前（账本 → 大类 → 分类 → 资产 → 流水 → 预算）；删除反过来，账本永远最后 */
const UPSERT_ORDER = ['ledgers', 'categoryGroups', 'categories', 'assets', 'transactions', 'budgets'] as const;
const DELETE_ORDER = ['transactions', 'budgets', 'categories', 'categoryGroups', 'assets', 'ledgers'] as const;
type TableName = (typeof UPSERT_ORDER)[number];

/** 把 canonical 行还原成 PUT 请求体（金额字符串 → number） */
function toApiBody(table: TableName, row: Row): unknown {
  switch (table) {
    case 'ledgers': {
      const r = row as unknown as LedgerRow;
      const body: LedgerUpsert = {
        clientUid: r.clientUid,
        name: r.name,
        icon: r.icon,
        color: r.color ?? undefined,
        sortOrder: r.sortOrder,
      };
      return body;
    }
    case 'assets': {
      const r = row as unknown as AssetRow;
      const body: AssetUpsert = {
        clientUid: r.clientUid,
        ledgerUid: r.ledgerUid,
        name: r.name,
        icon: r.icon,
        color: r.color,
        type: r.type,
        currency: r.currency,
        initialBalance: Number(r.initialBalance),
        creditLimit: r.creditLimit != null ? Number(r.creditLimit) : null,
        statementDay: r.statementDay,
        dueDay: r.dueDay,
        interestRate: r.interestRate != null ? Number(r.interestRate) : null,
        defaultAsset: r.defaultAsset,
        sortOrder: r.sortOrder,
        archived: r.archived,
      };
      return body;
    }
    case 'categoryGroups': {
      const r = row as unknown as GroupRow;
      const body: CategoryGroupUpsert = {
        clientUid: r.clientUid,
        name: r.name,
        color: r.color ?? undefined,
        icon: r.icon ?? undefined,
        type: r.type,
        sortOrder: r.sortOrder,
      };
      return body;
    }
    case 'categories': {
      const r = row as unknown as CategoryRow;
      const body: CategoryUpsert = {
        clientUid: r.clientUid,
        groupUid: r.groupUid,
        name: r.name,
        icon: r.icon,
        color: r.color ?? undefined,
        type: r.type,
        sortOrder: r.sortOrder,
      };
      return body;
    }
    case 'transactions': {
      const r = row as unknown as TxRow;
      const body: TransactionUpsert = {
        clientUid: r.clientUid,
        ledgerUid: r.ledgerUid,
        categoryUid: r.categoryUid,
        assetUid: r.assetUid,
        fromAssetUid: r.fromAssetUid,
        toAssetUid: r.toAssetUid,
        type: r.type,
        amount: Number(r.amount),
        exchangeRate: r.exchangeRate != null ? Number(r.exchangeRate) : null,
        convertedAmount: r.convertedAmount != null ? Number(r.convertedAmount) : null,
        fee: r.fee != null ? Number(r.fee) : null,
        occurredOn: r.occurredOn,
        note: r.note,
        displayName: r.displayName,
        receiptPath: r.receiptPath,
      };
      return body;
    }
    case 'budgets': {
      const r = row as unknown as BudgetRow;
      const body: BudgetUpsert = {
        clientUid: r.clientUid,
        categoryUid: r.categoryUid,
        amount: Number(r.amount),
        currency: r.currency,
      };
      return body;
    }
    default:
      throw new Error('未知表：' + String(table));
  }
}

async function pushUpsert(table: TableName, row: Row, failedRows: RowFailure[]): Promise<void> {
  const body = toApiBody(table, row);
  const id = String((row as { clientUid: string }).clientUid);
  await pushRow(
    table,
    id,
    'upsert',
    () => {
      switch (table) {
        case 'ledgers':
          return api.putLedger(body as LedgerUpsert);
        case 'assets':
          return api.putAsset(body as AssetUpsert);
        case 'categoryGroups':
          return api.putCategoryGroup(body as CategoryGroupUpsert);
        case 'categories':
          return api.putCategory(body as CategoryUpsert);
        case 'transactions':
          return api.putTransaction(body as TransactionUpsert);
        case 'budgets':
          return api.putBudget(body as BudgetUpsert);
        default:
          throw new Error('未知表：' + String(table));
      }
    },
    failedRows
  );
}

async function pushDelete(table: TableName, id: string, failedRows: RowFailure[]): Promise<void> {
  const action = () => {
    switch (table) {
      case 'ledgers':
        // App 删账本 = 连数据一起删（用户定版），后端要求 force=true 才会级联
        return api.deleteLedger(id, true);
      case 'assets':
        return api.deleteAsset(id);
      case 'categoryGroups':
        return api.deleteCategoryGroup(id);
      case 'categories':
        return api.deleteCategory(id);
      case 'transactions':
        return api.deleteTransaction(id);
      case 'budgets':
        return api.deleteBudget(id);
      default:
        throw new Error('未知表：' + String(table));
    }
  };
  try {
    await withRetry(action);
  } catch (e) {
    // 已经不存在 = 删除幂等达成（另一台设备先删了）
    if (e instanceof ApiError && e.code === 'NOT_FOUND') return;
    if (isTransientError(e)) throw e;
    failedRows.push({ table, id, op: 'delete', reason: errorMessage(e) });
  }
}

async function pushProfile(row: ProfileRow, failedRows: RowFailure[]): Promise<void> {
  const patch: ProfilePatch = {
    currency: row.currency,
    weekStartsOn: row.weekStartsOn,
    decimalPlaces: row.decimalPlaces,
    periodPreference: row.periodPreference,
  };
  if (row.dateFormat) patch.dateFormat = row.dateFormat;
  if (row.activeLedgerUid) patch.activeLedgerUid = row.activeLedgerUid;
  try {
    await withRetry(() => api.patchProfile(patch));
  } catch (e) {
    if (isTransientError(e)) throw e;
    failedRows.push({ table: 'profile', id: 'me', op: 'upsert', reason: errorMessage(e) });
  }
}

function formatRowFailures(failedRows: RowFailure[]): string {
  const shown = failedRows.slice(0, 3).map((f) => f.table + '/' + f.id + ': ' + f.reason);
  return failedRows.length > shown.length
    ? shown.join('；') + '（共 ' + failedRows.length + ' 条失败）'
    : shown.join('；');
}

/** 把快照 diff 后推送到云端：只上传有变化的行、删除云端多余行，最后更新镜像 */
async function pushSnapshot(s: LocalSnapshot): Promise<RowFailure[]> {
  const current = buildAllRows(s);
  const mirror = await loadMirror();
  const failedRows: RowFailure[] = [];

  const tableRows: Record<string, Row[]> = {
    ledgers: current.ledgers,
    categoryGroups: current.categoryGroups,
    categories: current.categories,
    assets: current.assets,
    transactions: current.transactions,
    budgets: current.budgets,
  };
  const mirrorRows: Record<string, Row[]> = {
    ledgers: mirror.ledgers,
    categoryGroups: mirror.categoryGroups,
    categories: mirror.categories,
    assets: mirror.assets,
    transactions: mirror.transactions,
    budgets: mirror.budgets,
  };

  const upserts: Record<string, Row[]> = {};
  const deletes: Record<string, string[]> = {};

  UPSERT_ORDER.forEach((table) => {
    const prevRows = mirrorRows[table] ?? [];
    const prev = new Map(prevRows.map((r) => [String(r.clientUid), r]));
    const rows = tableRows[table] ?? [];
    const idsNow = new Set(rows.map((r) => String(r.clientUid)));
    upserts[table] = rows.filter((r) => {
      const old = prev.get(String(r.clientUid));
      // 行已序列化成"金额定点字符串 + 固定键序"的对象：比 JSON 就是逐字段比较（无浮点）
      return !old || JSON.stringify(old) !== JSON.stringify(r);
    });
    deletes[table] = prevRows.filter((r) => !idsNow.has(String(r.clientUid))).map((r) => String(r.clientUid));
  });

  // 先推父表再推子表；删除反过来（账本最后删，避开外键 RESTRICT）
  for (const table of UPSERT_ORDER) {
    const rows = upserts[table] ?? [];
    if (rows.length) await runLimited(rows, PUSH_CONCURRENCY, (row) => pushUpsert(table, row, failedRows));
  }
  for (const table of DELETE_ORDER) {
    const ids = deletes[table] ?? [];
    if (ids.length) await runLimited(ids, PUSH_CONCURRENCY, (id) => pushDelete(table, id, failedRows));
  }

  // profiles 行：局部 PATCH（只写我们管理的列，不影响 displayName 等）
  const profileChanged =
    !mirror.profile || JSON.stringify(mirror.profile) !== JSON.stringify(current.profile);
  if (current.profile && profileChanged) {
    await pushProfile(current.profile, failedRows);
  }

  // 镜像 = 本次成功上云的状态：失败的 upsert 行不入镜像（下次同步重试），
  // 失败的 delete 保留旧行（下次同步再删）。网络/服务器中断则整次不落镜像。
  const failedUpsertKeys = new Set(failedRows.filter((f) => f.op === 'upsert').map((f) => f.table + ':' + f.id));
  const failedDeleteKeys = new Set(failedRows.filter((f) => f.op === 'delete').map((f) => f.table + ':' + f.id));

  const nextMirror: SyncMirror = {
    ...emptyMirror(),
    profile: failedUpsertKeys.has('profile:me') ? mirror.profile : current.profile,
  };
  UPSERT_ORDER.forEach((table) => {
    const prevRows = mirrorRows[table] ?? [];
    const prevMap = new Map(prevRows.map((r) => [String(r.clientUid), r]));
    const kept: Row[] = [];
    // 当前本地行：推送成功才入镜像；失败的 upsert 保留旧镜像行
    // （若之后本地把该行删了，旧镜像行才能触发下次的 delete，否则云端坏行会复活循环）
    for (const r of tableRows[table] ?? []) {
      const id = String(r.clientUid);
      if (!failedUpsertKeys.has(table + ':' + id)) {
        kept.push(r);
      } else if (prevMap.has(id)) {
        kept.push(prevMap.get(id) as Row);
      }
    }
    // 失败的 delete 保留旧行，下次同步再删
    for (const r of prevRows) {
      if (failedDeleteKeys.has(table + ':' + String(r.clientUid))) kept.push(r);
    }
    (nextMirror as unknown as Record<string, Row[]>)[table] = kept;
  });

  await saveMirror(nextMirror);
  setLastSyncAt(Date.now());
  return failedRows;
}

// ────────────────────────────── 合并 ──────────────────────────────

/**
 * 按 id 合并一张表的本地行与云端行：
 * - 同 id：云端为准（后同步者覆盖，MVP 策略）
 * - 本机独有：保留（稍后被推上云）
 * - 云端独有：追加（transactions 按 createdAt 倒序排在后面，其他保持云端顺序）
 */
function mergeById<T extends { id: string }>(localRows: T[], cloudRows: T[]): T[] {
  const cloudMap = new Map(cloudRows.map((r) => [r.id, r]));
  const out = localRows.map((r) => cloudMap.get(r.id) ?? r);
  const localIds = new Set(localRows.map((r) => r.id));
  const cloudOnly = cloudRows.filter((r) => !localIds.has(r.id));
  return [...out, ...cloudOnly];
}

/** 预算合并：以 clientUid（服务端回传）优先，否则用 (分类|币种) 派生 id 对齐 */
function mergeBudgets(localBudgets: Budget[], cloudBudgets: Budget[]): Budget[] {
  const keyOf = (b: Budget) => b.clientUid ?? budgetId(b);
  const cloudMap = new Map(cloudBudgets.map((b) => [keyOf(b), b]));
  const out = localBudgets.map((b) => cloudMap.get(keyOf(b)) ?? b);
  const localKeys = new Set(localBudgets.map(keyOf));
  const cloudOnly = cloudBudgets.filter((b) => !localKeys.has(keyOf(b)));
  return dedupeBudgets([...out, ...cloudOnly]);
}

/**
 * 云端数据与本地合并：
 * - cloudWinsAll = true（切换到另一个账号登录）：本机遗留数据丢弃，以云端为准
 * - 否则（首次绑定账号 / 同账号重登 / 换新手机）：按行合并，绝不静默丢数据
 */
function mergeSnapshots(local: LocalSnapshot, pull: CloudPull, cloudWinsAll: boolean): LocalSnapshot {
  if (cloudWinsAll) {
    const base = emptySnapshot();
    const withSettings = applyProfileRow(base, pull.cloud.profile);
    return {
      transactions: pull.entities.transactions,
      categories: pull.entities.categories,
      // 内置大组由 defaultCategories 渲染，不进 categoryGroups（否则管理页会出现重复分组）
      categoryGroups: pull.entities.categoryGroups.filter((g) => !DEFAULT_GROUP_NAMES.has(g.name)),
      budgets: pull.entities.budgets,
      ledgers: pull.entities.ledgers,
      assets: pull.entities.assets,
      activeLedgerId: withSettings.activeLedgerId,
      currency: withSettings.currency,
      periodPreference: withSettings.periodPreference,
      dateFormat: withSettings.dateFormat,
      weekStartsOn: withSettings.weekStartsOn,
      decimalPlaces: withSettings.decimalPlaces,
    };
  }

  const merged: LocalSnapshot = {
    transactions: mergeById(local.transactions, pull.entities.transactions).sort(
      (a, b) => b.createdAt - a.createdAt
    ),
    categories: mergeById(local.categories, pull.entities.categories),
    categoryGroups: mergeById(
      local.categoryGroups.map((g) => ({ ...g, id: g.name })),
      pull.entities.categoryGroups
        .filter((g) => !DEFAULT_GROUP_NAMES.has(g.name))
        .map((g) => ({ ...g, id: g.name }))
    ).map((g) => ({ name: g.name, color: g.color, icon: g.icon, type: g.type })),
    budgets: mergeBudgets(local.budgets, pull.entities.budgets),
    ledgers: mergeById(local.ledgers, pull.entities.ledgers),
    assets: mergeById(local.assets, pull.entities.assets),
    activeLedgerId: local.activeLedgerId,
    currency: local.currency,
    periodPreference: local.periodPreference,
    dateFormat: local.dateFormat,
    weekStartsOn: local.weekStartsOn,
    decimalPlaces: local.decimalPlaces,
  };
  return applyProfileRow(merged, pull.cloud.profile);
}

// ────────────────────────────── 对外 API ──────────────────────────────

let syncing = false;

/** 当前登录账号 id；未登录返回 null（未登录时同步是空操作，本地功能完全不受影响） */
async function currentUserId(): Promise<string | null> {
  await hydrateSession();
  const user = getCurrentUser();
  return user && user.id ? String(user.id) : null;
}

/** 统一出口：把异常归类成稳定错误码 + 原始信息 */
function toSyncResult(e: unknown): SyncResult {
  if (e instanceof LocalDataCorruptError) {
    return { ok: false, error: 'local_data_corrupt', detail: e.message };
  }
  return { ok: false, error: classifySyncError(e), detail: errorMessage(e) };
}

/**
 * 完整同步（登录成功 / 重启恢复会话时调用）：
 * 拉取云端 → 与本地合并 → 写回本地 → 把合并结果推上云。
 */
export async function fullSync(): Promise<SyncResult> {
  if (syncing) return { ok: false, error: 'sync_in_progress' };
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'not_logged_in' };

  syncing = true;
  setStatus('syncing');
  try {
    // 先把防抖期间尚未上云的本地修改推上去（否则下面的拉取会用云端旧版本覆盖掉这些编辑，如刚归档的账户被恢复）。
    // 切换账号（cloudWinsAll）时本地数据本就被云端替换，绝不能把旧账号的数据推给新账号，只丢弃挂起的推送。
    const preLastUserId = await AsyncStorage.getItem(LAST_USER_KEY);
    const preCloudWinsAll = preLastUserId != null && preLastUserId !== userId;
    const hadPending = pushTimer != null || pushDeferred;
    if (pushTimer) {
      clearTimeout(pushTimer);
      pushTimer = null;
    }
    pushDeferred = false;
    if (hadPending && !preCloudWinsAll) await pushLocalSnapshot();

    // 网络拉取不占锁（可能很慢）；本地「读快照 → 合并 → 写回」在锁内用拉取后的最新本地数据完成，
    // 与 AppContext 的持久化写入串行，避免读写之间的编辑被合并结果覆盖
    const pull = await fetchAll();
    const normalized = await runStorageExclusive(async () => {
      const local = await readLocalSnapshot();
      const lastUserId = await AsyncStorage.getItem(LAST_USER_KEY);
      const cloudWinsAll = lastUserId != null && lastUserId !== userId;
      const merged = mergeSnapshots(local, pull, cloudWinsAll);
      // 推送前兜底修复老数据（缺币种/颜色/时间戳等），并写回本地自愈
      const { snapshot: fixed } = normalizeSnapshot(merged);
      await writeLocalSnapshot(fixed);
      return fixed;
    });
    // 必须无条件通知重载：合并可能只追加了云端行（normalize 无改动），
    // 若跳过通知，React 状态停在旧数据，下次本地写回会把合并结果覆盖掉，
    // 再下一次推送就会把"消失"的行当成删除发上云 —— 云端数据被误删
    notifyDataReplaced();
    const failedRows = await pushSnapshot(normalized);
    await AsyncStorage.setItem(LAST_USER_KEY, userId);
    setStatus('idle');
    if (failedRows.length) {
      return { ok: false, error: 'constraint', detail: formatRowFailures(failedRows) };
    }
    return { ok: true };
  } catch (e) {
    console.warn('云端同步失败', e);
    setStatus('error');
    return toSyncResult(e);
  } finally {
    syncing = false;
    flushDeferredPush();
  }
}

/** 同步进行中被跳过的推送请求：同步结束后补排一次，避免期间的编辑要等到下一次改动才上云 */
let pushDeferred = false;
function flushDeferredPush(): void {
  if (!pushDeferred) return;
  pushDeferred = false;
  schedulePush();
}

/**
 * 防抖推送（AppContext 数据变化时调用）。
 * 未登录时是空操作，所以本地功能完全不受影响。
 */
let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function schedulePush(delayMs = 2000): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushNow();
  }, delayMs);
}

/** 读取本地快照（先规范化并自愈写回）后推上云。调用方须已持有 syncing 锁 */
async function pushLocalSnapshot(): Promise<RowFailure[]> {
  const { snapshot: fixed, changed } = await runStorageExclusive(async () => {
    const result = normalizeSnapshot(await readLocalSnapshot());
    if (result.changed) await writeLocalSnapshot(result.snapshot);
    return result;
  });
  if (changed) notifyDataReplaced();
  return pushSnapshot(fixed);
}

/** 立即推送当前本地数据（设置页"立即同步"按钮用：拉+推走 fullSync 更稳妥） */
export async function pushNow(): Promise<SyncResult> {
  if (syncing) {
    pushDeferred = true; // 同步结束后补推，见 flushDeferredPush
    return { ok: false, error: 'sync_in_progress' };
  }
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'not_logged_in' };

  syncing = true;
  setStatus('syncing');
  try {
    const failedRows = await pushLocalSnapshot();
    await AsyncStorage.setItem(LAST_USER_KEY, userId);
    setStatus('idle');
    if (failedRows.length) {
      return { ok: false, error: 'constraint', detail: formatRowFailures(failedRows) };
    }
    return { ok: true };
  } catch (e) {
    console.warn('云端备份失败', e);
    setStatus('error');
    return toSyncResult(e);
  } finally {
    syncing = false;
    flushDeferredPush();
  }
}
