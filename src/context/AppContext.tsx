import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Transaction,
  Category,
  Budget,
  Ledger,
  PeriodPreference,
  Asset,
  AssetType,
  CategoryGroup,
  DateFormat,
  WeekStartsOn,
  DecimalPlaces,
  PaymentPlan,
} from '../types';
import { DEFAULT_CATEGORIES } from '../utils/defaultCategories';
import { getCurrencySymbol } from '../utils/currencies';
import { computePlanOccurrences } from '../utils/paymentPlans';
import { PENDING_LEDGER_ID, budgetId, onLocalDataReplaced, schedulePush } from '../services/syncService';
import { runStorageExclusive } from '../services/storageQueue';
import { api } from '../services/apiClient';
import { t as translate } from '../i18n';

const STORAGE_KEYS = {
  transactions: '@jizhang/transactions',
  categories: '@jizhang/categories',
  categoryGroups: '@jizhang/categoryGroups',
  budgets: '@jizhang/budgets',
  ledgers: '@jizhang/ledgers',
  activeLedgerId: '@jizhang/activeLedgerId',
  defaultLedgerId: '@jizhang/defaultLedgerId',
  currency: '@jizhang/currency',
  periodPreference: '@jizhang/periodPreference',
  assets: '@jizhang/assets',
  dateFormat: '@jizhang/dateFormat',
  weekStartsOn: '@jizhang/weekStartsOn',
  decimalPlaces: '@jizhang/decimalPlaces',
  paymentPlans: '@jizhang/paymentPlans',
};

// 账本默认色与默认图标（新建账本都从这里取，不再散落 hex / 图标字符串）
const LEDGER_DEFAULT_COLOR = '#4C9AFF';
const LEDGER_DEFAULT_ICON = 'book-outline';

/** 真正落一条账本记录（不是运行时兜底对象）：首启建账本 / 新建账本 / 删空后重建都走它 */
function makeLedger(name: string, createdAt = Date.now()): Ledger {
  return {
    id: genId(),
    name,
    icon: LEDGER_DEFAULT_ICON,
    color: LEDGER_DEFAULT_COLOR,
    createdAt,
  };
}
const DEFAULT_PERIOD: PeriodPreference = { type: 'month' };
const DEFAULT_DATE_FORMAT: DateFormat = 'YYYY/MM/DD';
const DEFAULT_WEEK_STARTS_ON: WeekStartsOn = 1;
const DEFAULT_DECIMAL_PLACES: DecimalPlaces = 2;
const FEE_CATEGORY_ID = 'transfer_fee';

/**
 * 补账游标取较晚的那个（YYYY-MM-DD 字符串比较即日期比较）。
 * 游标只进不退：云同步可能带回比本机更晚的 lastProcessedDate，反之亦然，
 * 任何一次回退都会让已经补过的期数被再补一遍（重复流水）。
 */
function laterCursor(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function isLegacyIconValue(icon: string | undefined | null): boolean {
  if (!icon) return true;
  if (!/^[a-z0-9-]+$/.test(icon)) return true;
  // 历史上写进本地数据的非法 Ionicons 图标名（渲染时会刷 Console Warning），按 id 映射回默认表
  return icon === 'pills-outline' || icon === 'gas-pump-outline';
}

function migrateCategoryIcons(stored: Category[]): { result: Category[]; changed: boolean } {
  let changed = false;
  const result = stored.map((c) => {
    if (isLegacyIconValue(c.icon)) {
      changed = true;
      const fresh = DEFAULT_CATEGORIES.find((d) => d.id === c.id);
      return { ...c, icon: fresh?.icon ?? 'help-outline' };
    }
    return c;
  });
  return { result, changed };
}

// 大类分组迁移：老数据里的默认分类没有 group 字段，按 id 从默认表补上，
// 用户自建/未知分类不补（在选择类别页自然落"其他"节）
// 大组改名映射：老数据里的旧组名自动改成新组名（含用户自建的分类）
const GROUP_RENAMES: Record<string, string> = { '人情其他': '节日送礼' };

function migrateCategoryGroups(stored: Category[]): { result: Category[]; changed: boolean } {
  let changed = false;
  const result = stored.map((c) => {
    if (c.group) {
      const renamed = GROUP_RENAMES[c.group];
      if (renamed && renamed !== c.group) {
        changed = true;
        return { ...c, group: renamed };
      }
      return c;
    }
    const fresh = DEFAULT_CATEGORIES.find((d) => d.id === c.id);
    if (fresh?.group) {
      changed = true;
      return { ...c, group: fresh.group };
    }
    return c;
  });
  return { result, changed };
}

// 增量补齐新增的默认分类：老用户本地存的是旧版分类列表，App 升级后在
// defaultCategories.ts 里新加的默认分类不会自动出现——这里按 id 把本地缺的
// 默认分类补进列表尾部。用户删过的默认分类也会被补回来（作为"恢复默认"行为，
// 与手续费分类 FEE_CATEGORY_ID 已有的补齐逻辑一致）；用户自建分类不受影响。
function mergeNewDefaultCategories(stored: Category[]): { result: Category[]; changed: boolean } {
  const missing = DEFAULT_CATEGORIES.filter((d) => !stored.some((c) => c.id === d.id));
  if (missing.length === 0) return { result: stored, changed: false };
  return { result: [...stored, ...missing], changed: true };
}

const ASSET_TYPE_FALLBACK_ICON: Record<AssetType, string> = {
  cash: 'cash-outline',
  bank: 'card-outline',
  credit: 'wallet-outline',
  ewallet: 'phone-portrait-outline',
  investment: 'trending-up-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

function migrateAssetIcons(stored: Asset[]): { result: Asset[]; changed: boolean } {
  let changed = false;
  const result = stored.map((a) => {
    if (isLegacyIconValue(a.icon)) {
      changed = true;
      return { ...a, icon: ASSET_TYPE_FALLBACK_ICON[a.type] ?? 'help-outline' };
    }
    return a;
  });
  return { result, changed };
}

// 老账本数据可能还是 emoji 图标（比如默认账本以前的 '📒'），迁移成线框图标名
function migrateLedgerIcons(stored: Ledger[]): { result: Ledger[]; changed: boolean } {
  let changed = false;
  const result = stored.map((l) => {
    if (isLegacyIconValue(l.icon)) {
      changed = true;
      return { ...l, icon: LEDGER_DEFAULT_ICON };
    }
    return l;
  });
  return { result, changed };
}

// 持久化写入统一排队（与云同步的读-合并-写回串行），防止整数组整体写回时互相覆盖
function persistItem(key: string, value: string): void {
  void runStorageExclusive(() => AsyncStorage.setItem(key, value));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface AppContextValue {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  ledgers: Ledger[];
  activeLedgerId: string;
  /** 默认账本 id（永远恰好一本，且一定在 ledgers 里：不再是运行时兜底对象） */
  defaultLedgerId: string;
  currency: string;
  currencySymbol: string;
  periodPreference: PeriodPreference;
  assets: Asset[];
  dateFormat: DateFormat;
  weekStartsOn: WeekStartsOn;
  decimalPlaces: DecimalPlaces;
  loading: boolean;
  addTransaction: (t: {
    amount: number;
    categoryId: string;
    type: 'expense' | 'income';
    date: string;
    note: string;
    assetId?: string;
    receiptUri?: string;
  }) => Promise<void>;
  updateTransaction: (
    id: string,
    updates: Partial<Omit<Transaction, 'id' | 'createdAt' | 'ledgerId'>>
  ) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  addCategory: (c: Omit<Category, 'id'>) => Promise<Category>;
  addCategoryGroup: (g: CategoryGroup) => Promise<void>;
  deleteCategoryGroup: (name: string) => Promise<void>;
  categoryGroups: CategoryGroup[];
  updateCategory: (id: string, updates: Partial<Omit<Category, 'id'>>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  setBudget: (categoryId: string, amount: number, currency?: string) => Promise<void>;
  getCategoryById: (id: string) => Category | undefined;
  addLedger: (name: string, icon: string, color?: string) => Promise<void>;
  renameLedger: (id: string, name: string) => Promise<void>;
  deleteLedger: (id: string) => Promise<void>;
  setActiveLedgerId: (id: string) => Promise<void>;
  /** 把某本账本设为默认（同一时间只有一本，设置新的会自动清掉旧的） */
  setDefaultLedger: (id: string) => Promise<void>;
  setCurrency: (code: string) => Promise<void>;
  setPeriodPreference: (p: PeriodPreference) => Promise<void>;
  setDateFormat: (f: DateFormat) => Promise<void>;
  setWeekStartsOn: (d: WeekStartsOn) => Promise<void>;
  setDecimalPlaces: (n: DecimalPlaces) => Promise<void>;
  /** 财务规划:计划付款 CRUD(存储/云同步/自动扣账游标都由 AppContext 管理) */
  paymentPlans: PaymentPlan[];
  addPaymentPlan: (p: Omit<PaymentPlan, 'id' | 'createdAt' | 'lastProcessedDate'>) => Promise<void>;
  updatePaymentPlan: (id: string, updates: Partial<Omit<PaymentPlan, 'id' | 'ledgerId' | 'createdAt'>>) => Promise<void>;
  deletePaymentPlan: (id: string) => Promise<void>;
  addAsset: (a: {
    name: string;
    icon: string;
    color: string;
    type: AssetType;
    currency: string;
    initialBalance: number;
    creditLimit?: number;
    statementDay?: number;
    dueDay?: number;
    interestRate?: number;
  }) => Promise<void>;
  updateAsset: (id: string, updates: Partial<Omit<Asset, 'id' | 'createdAt' | 'ledgerId'>>) => Promise<void>;
  /**
   * 删除账户。有任何交易引用它（assetId / fromAssetId / toAssetId）时不删除，改为归档，
   * 返回 'archived'；没有记录时真删除，返回 'deleted'。调用前可用 assetRecordCount 决定文案。
   */
  deleteAsset: (id: string) => Promise<'deleted' | 'archived'>;
  /** 归档账户：从账户列表/记账选择/净资产隐藏，历史交易保持不变；同时取消默认账户 */
  archiveAsset: (id: string) => Promise<void>;
  /** 恢复已归档账户 */
  unarchiveAsset: (id: string) => Promise<void>;
  /** 未归档的账户（净资产/各币种合计/账户选择器用它）。assets 仍是全部账户（含归档） */
  activeAssets: Asset[];
  /** 引用该账户的交易条数（assetId / fromAssetId / toAssetId 任一命中） */
  assetRecordCount: (id: string) => number;
  assetHasRecords: (id: string) => boolean;
  getAssetById: (id: string) => Asset | undefined;
  getAssetBalance: (assetId: string) => number;
  // 把某个资产设为默认（记一笔时自动带出）；传 null 表示"不要任何默认账户"。
  // 同一时间只能有一个默认，设置新的会自动把其它资产的 isDefault 清掉，不用调用方自己处理。
  setDefaultAsset: (id: string | null) => Promise<void>;
  addTransfer: (p: {
    fromAssetId: string;
    toAssetId: string;
    amount: number;
    exchangeRate: number;
    fee: number;
    date: string;
    note: string;
    receiptUri?: string;
  }) => Promise<void>;
  /** 重新从 AsyncStorage 读取全部本地数据（云同步写回后自动调用；也可手动刷新） */
  reloadFromStorage: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  // 账本列表由存档驱动：读取前是空的。空账本表不等于"该建一本"——真账本要么来自存档，
  // 要么由 syncService 首次拉取成功后对账落定（见 useEffect 里的占位账本）
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  // 同步 ledgers 最新值的 ref：deleteLedger 在同一帧内做「删除+回落/重建」时读最新列表
  const ledgersRef = useRef<Ledger[]>([]);
  useEffect(() => {
    ledgersRef.current = ledgers;
  }, [ledgers]);
  const [activeLedgerId, setActiveLedgerIdState] = useState<string>('');
  // 默认账本 = 某条真实账本身上的身份标记（不再是运行时兜底对象）。
  // 永远恰好一本：删掉默认那本由剩余第一本接管，删空则新建的空账本接管。
  const [defaultLedgerId, setDefaultLedgerIdState] = useState<string>('');
  const [currency, setCurrencyState] = useState<string>('MYR'); // 默认货币：RM（马来西亚林吉特）
  const [periodPreference, setPeriodPreferenceState] = useState<PeriodPreference>(DEFAULT_PERIOD);
  const [assets, setAssets] = useState<Asset[]>([]);
  // ⚠ 2026-10-27 回滚：曾按 a.ledgerId === activeLedgerId 过滤，但库里的 asset.ledgerId
  // 与当前 ledgers 的 id 对不上（Supabase 导入后重新生成过 id），结果所有账本都显示「No assets」。
  // 在确认真实数据归属之前，先恢复「全部未归档资产」的行为。
  const activeAssets = useMemo(() => assets.filter((a) => !a.archivedAt), [assets]);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [dateFormat, setDateFormatState] = useState<DateFormat>(DEFAULT_DATE_FORMAT);
  const [weekStartsOn, setWeekStartsOnState] = useState<WeekStartsOn>(DEFAULT_WEEK_STARTS_ON);
  const [decimalPlaces, setDecimalPlacesState] = useState<DecimalPlaces>(DEFAULT_DECIMAL_PLACES);
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([]);
  const [loading, setLoading] = useState(true);

  // 冷启动占位账本：真账本列表还没到位（首次拉取未完成 / 离线 / 未登录）时给界面一个落点。
  // 它只活在内存里——不写 @jizhang/ledgers、不参与同步、不推云端（见 syncService.reconcileLedgers）。
  const pendingLedger = useMemo<Ledger>(
    () => ({
      id: PENDING_LEDGER_ID,
      name: translate('home.pendingLedgerName'),
      icon: LEDGER_DEFAULT_ICON,
      color: LEDGER_DEFAULT_COLOR,
      createdAt: 0,
    }),
    []
  );

  // 当前账本的有效 id：占位期间是占位 id；存档里选中的那本已不存在时回落到第一本
  const effectiveActiveLedgerId =
    ledgers.length === 0
      ? PENDING_LEDGER_ID
      : ledgers.some((l) => l.id === activeLedgerId)
        ? activeLedgerId
        : ledgers[0].id;

  // 启动时读取本地数据；抽成函数是因为云同步把"云端合并结果"写回 AsyncStorage 后
  // 会回调 onLocalDataReplaced → loadFromStorage，把恢复/换机登录拉回来的数据刷进内存 state
  const loadFromStorage = useCallback(async () => {
    await (async () => {
      try {
        const [
          txRaw,
          catRaw,
          catGroupRaw,
          budRaw,
          ledRaw,
          activeLedRaw,
          defaultLedRaw,
          currRaw,
          periodRaw,
          assetRaw,
          dateFormatRaw,
          weekStartsOnRaw,
          decimalPlacesRaw,
          planRaw,
        ] = await runStorageExclusive(() =>
          Promise.all([
            AsyncStorage.getItem(STORAGE_KEYS.transactions),
            AsyncStorage.getItem(STORAGE_KEYS.categories),
            AsyncStorage.getItem(STORAGE_KEYS.categoryGroups),
            AsyncStorage.getItem(STORAGE_KEYS.budgets),
            AsyncStorage.getItem(STORAGE_KEYS.ledgers),
            AsyncStorage.getItem(STORAGE_KEYS.activeLedgerId),
            AsyncStorage.getItem(STORAGE_KEYS.defaultLedgerId),
            AsyncStorage.getItem(STORAGE_KEYS.currency),
            AsyncStorage.getItem(STORAGE_KEYS.periodPreference),
            AsyncStorage.getItem(STORAGE_KEYS.assets),
            AsyncStorage.getItem(STORAGE_KEYS.dateFormat),
            AsyncStorage.getItem(STORAGE_KEYS.weekStartsOn),
            AsyncStorage.getItem(STORAGE_KEYS.decimalPlaces),
            AsyncStorage.getItem(STORAGE_KEYS.paymentPlans),
          ])
        );
        // 账本先落地：老流水缺 ledgerId 时要用「真实存在的那本账本」兜底，不能再指向幽灵 id
        const storedLedgers: Ledger[] = ledRaw ? JSON.parse(ledRaw) : [];
        const { result: migratedLed, changed: ledChanged } = migrateLedgerIcons(
          Array.isArray(storedLedgers) ? storedLedgers : []
        );
        // 账本表为空 = 还没拿到服务端账本列表（首次启动 / 换新机 / 清过缓存）。
        // 这里**绝不**凭空落一条账本记录：那会立刻被同步推上云，账号里就多出一本空壳账本。
        // 界面在 ledgers 为空时用内存占位账本落点；真正建账本只在
        // syncService.reconcileLedgers 里「已登录 + 拉取成功 + 服务端确实 0 本」时发生。
        const resolvedLedgers = migratedLed;
        // 启动落在哪本账本（默认账本语义，2026-10-27 接通）：
        //   ① 「默认账本」有效 → 就用它（这是用户用星标指定的那本，冷启动一律回到它）
        //   ② 默认无效 → 用上次停留的账本
        //   ③ 都不行 → 第一本
        // 以前只认 activeLedgerId，defaultLedgerId 存了却没人消费，标签形同装饰。
        const hasLedger = (id: string | null): boolean =>
          !!id && resolvedLedgers.some((l) => l.id === id);
        const primaryLedgerId =
          resolvedLedgers.length === 0
            ? ''
            : hasLedger(defaultLedRaw)
              ? (defaultLedRaw as string)
              : hasLedger(activeLedRaw)
                ? (activeLedRaw as string)
                : resolvedLedgers[0].id;
        // 默认账本同理：存档里的默认还在就沿用，否则由当前账本接管 —— 永远恰好一本
        const resolvedDefaultId =
          resolvedLedgers.length === 0
            ? ''
            : resolvedLedgers.some((l) => l.id === defaultLedRaw)
              ? (defaultLedRaw as string)
              : primaryLedgerId;
        setLedgers(resolvedLedgers);
        setActiveLedgerIdState(primaryLedgerId);
        setDefaultLedgerIdState(resolvedDefaultId);
        if (
          ledChanged ||
          !ledRaw ||
          activeLedRaw !== primaryLedgerId ||
          defaultLedRaw !== resolvedDefaultId
        ) {
          persistItem(STORAGE_KEYS.ledgers, JSON.stringify(resolvedLedgers));
        }
        if (txRaw) {
          const parsedTx: Transaction[] = JSON.parse(txRaw);
          // 缺 ledgerId 的老流水，以及占位账本期间记的流水（离线冷启动），都改挂到真正的当前账本
          setTransactions(
            parsedTx.map((t) =>
              t.ledgerId && t.ledgerId !== PENDING_LEDGER_ID
                ? t
                : primaryLedgerId
                  ? { ...t, ledgerId: primaryLedgerId }
                  : t
            )
          );
        }
        if (catRaw) {
          const parsedCat: Category[] = JSON.parse(catRaw);
          const hasFee = parsedCat.some((c) => c.id === FEE_CATEGORY_ID);
          const withFee = hasFee ? parsedCat : [...parsedCat, DEFAULT_CATEGORIES.find((c) => c.id === FEE_CATEGORY_ID)!];
          const { result: iconMigrated, changed: iconChanged } = migrateCategoryIcons(withFee);
          const { result: groupMigrated, changed: groupChanged } = migrateCategoryGroups(iconMigrated);
          const { result: migratedCat, changed: mergedNew } = mergeNewDefaultCategories(groupMigrated);
          setCategories(migratedCat);
          if (iconChanged || groupChanged || mergedNew) {
            persistItem(STORAGE_KEYS.categories, JSON.stringify(migratedCat));
          }
        }
        if (catGroupRaw) {
          const parsedGroups: CategoryGroup[] = JSON.parse(catGroupRaw);
          if (Array.isArray(parsedGroups)) setCategoryGroups(parsedGroups);
        }
        if (budRaw) setBudgets(JSON.parse(budRaw));
        if (currRaw) setCurrencyState(currRaw);
        if (periodRaw) setPeriodPreferenceState(JSON.parse(periodRaw));
        if (assetRaw) {
          const parsedAsset: Asset[] = JSON.parse(assetRaw);
          const { result: migratedAsset, changed: assetChanged } = migrateAssetIcons(parsedAsset);
          setAssets(
            primaryLedgerId
              ? migratedAsset.map((a) =>
                  a.ledgerId === PENDING_LEDGER_ID ? { ...a, ledgerId: primaryLedgerId } : a
                )
              : migratedAsset
          );
          if (assetChanged) {
            persistItem(STORAGE_KEYS.assets, JSON.stringify(migratedAsset));
          }
        }
        if (dateFormatRaw) setDateFormatState(dateFormatRaw as DateFormat);
        if (weekStartsOnRaw) setWeekStartsOnState(Number(weekStartsOnRaw) as WeekStartsOn);
        if (decimalPlacesRaw) setDecimalPlacesState(Number(decimalPlacesRaw) as DecimalPlaces);
        if (planRaw) {
          const parsedPlans: PaymentPlan[] = JSON.parse(planRaw);
          const storedPlans = Array.isArray(parsedPlans) ? parsedPlans : [];
          setPaymentPlans((prev) => {
            const prevById = new Map(prev.map((p) => [p.id, p]));
            return storedPlans.map((p) => {
              // 占位账本期间建的计划（离线冷启动）同样改挂到真正的当前账本，与流水/账户一致
              const plan =
                primaryLedgerId && (!p.ledgerId || p.ledgerId === PENDING_LEDGER_ID)
                  ? { ...p, ledgerId: primaryLedgerId }
                  : p;
              // 云同步写回的存档可能是"补账已推进"之前的快照：游标只进不退，否则会重复补账
              const cursor = laterCursor(prevById.get(plan.id)?.lastProcessedDate, plan.lastProcessedDate);
              return cursor === plan.lastProcessedDate ? plan : { ...plan, lastProcessedDate: cursor };
            });
          });
        }
      } catch (e) {
        console.warn('读取本地数据失败', e);
      }
    })();
  }, []);

  // 首次加载完成前 loading=true，压住所有"state 一变就写 AsyncStorage"的副作用
  useEffect(() => {
    void loadFromStorage().finally(() => setLoading(false));
  }, [loadFromStorage]);

  // ── 云同步挂钩 ──────────────────────────────────────────────
  // 1) 本地任一数据变化 → 防抖推送到云端（未登录时 syncService 内部直接跳过，行为同纯本地）
  useEffect(() => {
    if (loading) return;
    // 账本表为空 = 还没拿到服务端账本列表：此状态下推送会把云端账本当"本地已删除"全删掉
    if (ledgers.length === 0) return;
    schedulePush();
  }, [
    transactions,
    categories,
    categoryGroups,
    budgets,
    ledgers,
    activeLedgerId,
    currency,
    periodPreference,
    assets,
    dateFormat,
    weekStartsOn,
    decimalPlaces,
    paymentPlans,
    loading,
  ]);

  // 2) 云同步合并结果写回本地后 → 重新加载进内存（登录恢复 / 换新手机登录恢复资料）
  useEffect(() => {
    return onLocalDataReplaced(() => {
      void loadFromStorage();
    });
  }, [loadFromStorage]);

  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
  }, [transactions, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.categories, JSON.stringify(categories));
  }, [categories, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.categoryGroups, JSON.stringify(categoryGroups));
  }, [categoryGroups, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.budgets, JSON.stringify(budgets));
  }, [budgets, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.ledgers, JSON.stringify(ledgers));
  }, [ledgers, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.activeLedgerId, activeLedgerId);
  }, [activeLedgerId, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.defaultLedgerId, defaultLedgerId);
  }, [defaultLedgerId, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.currency, currency);
  }, [currency, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.periodPreference, JSON.stringify(periodPreference));
  }, [periodPreference, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.assets, JSON.stringify(assets));
  }, [assets, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.dateFormat, dateFormat);
  }, [dateFormat, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.weekStartsOn, String(weekStartsOn));
  }, [weekStartsOn, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.decimalPlaces, String(decimalPlaces));
  }, [decimalPlaces, loading]);
  useEffect(() => {
    if (!loading) persistItem(STORAGE_KEYS.paymentPlans, JSON.stringify(paymentPlans));
  }, [paymentPlans, loading]);

  const addTransaction: AppContextValue['addTransaction'] = async (t) => {
    const newTx: Transaction = {
      ...t,
      id: genId(),
      createdAt: Date.now(),
      ledgerId: effectiveActiveLedgerId,
    };
    setTransactions((prev) => [newTx, ...prev]);
  };

  const updateTransaction: AppContextValue['updateTransaction'] = async (id, updates) => {
    setTransactions((prev) => prev.map((item) => (item.id === id ? { ...item, ...updates } : item)));
  };

  const deleteTransaction: AppContextValue['deleteTransaction'] = async (id) => {
    setTransactions((prev) => prev.filter((item) => (item.id !== id)));
  };

  const addCategory: AppContextValue['addCategory'] = async (c) => {
    const created: Category = { ...c, id: genId() };
    setCategories((prev) => [...prev, created]);
    return created;
  };

  // 更新分类（当前只用于编辑模式里拖拽换大类）：按 id 合并更新，其余字段不动
  const updateCategory: AppContextValue['updateCategory'] = async (id, updates) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
  };

  const addCategoryGroup: AppContextValue['addCategoryGroup'] = async (g) => {
    setCategoryGroups((prev) => (prev.some((x) => x.name === g.name) ? prev : [...prev, g]));
  };

  // 删除自定义大类：组内分类的 group 字段保留不动（它们会自动归入选择页的"其他"节）
  const deleteCategoryGroup: AppContextValue['deleteCategoryGroup'] = async (name) => {
    setCategoryGroups((prev) => prev.filter((g) => g.name !== name));
  };

  const deleteCategory: AppContextValue['deleteCategory'] = async (id) => {
    setCategories((prev) => prev.filter((item) => item.id !== id));
  };

  const setBudget: AppContextValue['setBudget'] = async (categoryId, amount, currency) => {
    // amount <= 0 = 清除该条预算；同一 categoryId 可以按币种各存一条（总预算多币种各设各的）。
    // 查重/清除都带 (b.currency ?? currency) 兜底：老版本存的条目没有 currency 字段，
    // 显示侧（HomeScreen totalBudget）靠兜底能读到，保存侧若严格相等会永远匹配不到 →
    // 每次保存都新增一条、显示永远命中旧条目（用户感知为"改了数值不生效"）。
    // 命中旧条目更新时顺带把 currency 归一化写入，之后走正常更新路径。
    setBudgets((prev) => {
      const exists = amount > 0 ? prev.find((b) => b.categoryId === categoryId && (b.currency ?? currency) === currency) : undefined;
      const next =
        amount <= 0
          ? prev.filter((b) => !(b.categoryId === categoryId && (b.currency ?? currency) === currency))
          : exists
            ? prev.map((b) => (b === exists ? { ...b, amount, currency } : b))
            : [...prev, { categoryId, amount, currency }];
      // 兜底去重：同 (分类+币种) 只保留第一条（界面按 find 读第一条，推送值必须与显示一致）。
      // 历史版本曾在"老条目无 currency + 已有同币种条目"时改出两条同 id 预算 → 云端 upsert
      // 同 id 两行被 Postgres 拒绝（21000）→ 整次同步失败（2026-10-20 事故）。
      const seen = new Set<string>();
      return next.filter((b) => {
        // 有后端回传的 clientUid 就用它（跨端一致），否则退回 (分类|币种) 派生键
        const id = b.clientUid ?? budgetId(b);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    });
  };

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

  const addLedger: AppContextValue['addLedger'] = async (name, icon, color) => {
    setLedgers((prev) => [...prev, { id: genId(), name, icon, color: color ?? LEDGER_DEFAULT_COLOR, createdAt: Date.now() }]);
  };

  const renameLedger: AppContextValue['renameLedger'] = async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setLedgers((prev) => prev.map((l) => (l.id === id ? { ...l, name: trimmed } : l)));
  };

  const deleteLedger: AppContextValue['deleteLedger'] = async (id) => {
    // 用户定版：任何账本都能删（含原名「默认账本」那条），删到一本不剩也允许。
    // 删空时不复活任何兜底账本，而是当场落一本**全新的空账本**让界面有落点 ——
    // 「旧的全没了、只剩一个空壳」在操作上成立。
    const remaining = ledgersRef.current.filter((l) => l.id !== id);
    const next = remaining.length > 0 ? remaining : [makeLedger(translate('home.emptyLedgerName'))];
    const fallbackId = next[0].id;
    // 删的是当前账本 / 默认账本 → 回落到剩下的第一本；删空时新账本同时接管两个身份
    setActiveLedgerIdState((prevActive) => (prevActive === id ? fallbackId : prevActive));
    setDefaultLedgerIdState((prevDefault) => (prevDefault === id ? fallbackId : prevDefault));
    // 级联删除：账本名下的交易/资产/缴费计划一并清除（用户定版：删除即连同数据删除，
    // 不留孤儿数据）。云同步按快照 diff 自动删除对应云端行。
    setTransactions((prev) => prev.filter((t) => t.ledgerId !== id));
    setAssets((prev) => prev.filter((a) => a.ledgerId !== id));
    setPaymentPlans((prev) => prev.filter((p) => p.ledgerId !== id));
    setLedgers(next);
  };

  // 设为默认账本（与「设为默认账户」同规格）：本地立即生效并持久化，离线也成立；
  // 云端尽力而为地写一次 defaultLedger=true（服务端会自动取消其它账本的默认）。
  const setDefaultLedger: AppContextValue['setDefaultLedger'] = async (id) => {
    const list = ledgersRef.current;
    const target = list.find((l) => l.id === id);
    if (!target) return;
    setDefaultLedgerIdState(id);
    try {
      await api.putLedger({
        clientUid: target.id,
        name: target.name,
        icon: target.icon || LEDGER_DEFAULT_ICON,
        color: target.color ?? null,
        sortOrder: list.findIndex((l) => l.id === id),
        defaultLedger: true,
      });
    } catch (e) {
      console.warn('同步默认账本失败（本地已生效）', e);
    }
  };

  const setActiveLedgerId: AppContextValue['setActiveLedgerId'] = async (id) => {
    setActiveLedgerIdState(id);
    // MRU：记录最近使用时间，账本弹层按它把最常用的排到最上面
    setLedgers((prev) =>
      prev.map((l) => (l.id === id ? { ...l, lastUsedAt: Date.now() } : l))
    );
  };

  const setCurrency: AppContextValue['setCurrency'] = async (code) => {
    setCurrencyState(code);
  };

  const setPeriodPreference: AppContextValue['setPeriodPreference'] = async (p) => {
    setPeriodPreferenceState(p);
  };

  const setDateFormat: AppContextValue['setDateFormat'] = async (f) => {
    setDateFormatState(f);
  };

  const setWeekStartsOn: AppContextValue['setWeekStartsOn'] = async (d) => {
    setWeekStartsOnState(d);
  };

  const setDecimalPlaces: AppContextValue['setDecimalPlaces'] = async (n) => {
    setDecimalPlacesState(n);
  };

  const addAsset: AppContextValue['addAsset'] = async (a) => {
    const newAsset: Asset = { ...a, id: genId(), ledgerId: effectiveActiveLedgerId, createdAt: Date.now() };
    setAssets((prev) => [...prev, newAsset]);
  };

  const updateAsset: AppContextValue['updateAsset'] = async (id, updates) => {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  };

  // 引用某账户的交易条数：assetId / fromAssetId / toAssetId 任一命中即算一条
  const assetRecordCount: AppContextValue['assetRecordCount'] = (id) =>
    transactions.reduce(
      (n, t) => (t.assetId === id || t.fromAssetId === id || t.toAssetId === id ? n + 1 : n),
      0
    );
  const assetHasRecords: AppContextValue['assetHasRecords'] = (id) => assetRecordCount(id) > 0;

  const archiveAsset: AppContextValue['archiveAsset'] = async (id) => {
    const archivedAt = new Date().toISOString();
    // 归档即取消默认：已归档账户不能再被记一笔时自动带出
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, archivedAt, isDefault: false } : a)));
  };

  const unarchiveAsset: AppContextValue['unarchiveAsset'] = async (id) => {
    setAssets((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a;
        const restored = { ...a };
        delete restored.archivedAt;
        return restored;
      })
    );
  };

  // 有记录的账户不删除（否则历史交易变孤儿、统计与余额对不上），改为归档
  const deleteAsset: AppContextValue['deleteAsset'] = async (id) => {
    if (assetHasRecords(id)) {
      await archiveAsset(id);
      return 'archived';
    }
    setAssets((prev) => prev.filter((a) => a.id !== id));
    // 无交易的账户可以真删；但计划付款若仍指向它，到期会生成指向已删账户的孤儿交易，先解除关联
    setPaymentPlans((prev) => prev.map((p) => (p.assetId === id ? { ...p, assetId: undefined } : p)));
    return 'deleted';
  };

  const getAssetById = (id: string) => assets.find((a) => a.id === id);

  const setDefaultAsset: AppContextValue['setDefaultAsset'] = async (id) => {
    // 归档账户不能设为默认
    setAssets((prev) => prev.map((a) => ({ ...a, isDefault: id !== null && a.id === id && !a.archivedAt })));
  };

  const getAssetBalance: AppContextValue['getAssetBalance'] = (assetId) => {
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) return 0;
    let balance = asset.initialBalance;
    transactions.forEach((t) => {
      if (t.type === 'transfer') {
        if (t.fromAssetId === assetId) balance -= t.amount + (t.fee ?? 0);
        if (t.toAssetId === assetId) balance += t.convertedAmount ?? t.amount;
        return;
      }
      if (t.assetId !== assetId) return;
      if (t.type === 'income') balance += t.amount;
      if (t.type === 'expense') balance -= t.amount;
    });
    return balance;
  };

  const addTransfer: AppContextValue['addTransfer'] = async ({
    fromAssetId,
    toAssetId,
    amount,
    exchangeRate,
    fee,
    date,
    note,
    receiptUri,
  }) => {
    const convertedAmount = amount * exchangeRate;
    const transferTx: Transaction = {
      id: genId(),
      amount,
      categoryId: '',
      type: 'transfer',
      date,
      note,
      createdAt: Date.now(),
      ledgerId: effectiveActiveLedgerId,
      fromAssetId,
      toAssetId,
      exchangeRate,
      convertedAmount,
      fee,
      receiptUri,
    };
    const newTxs = [transferTx];

    if (fee > 0) {
      const fromAsset = assets.find((a) => a.id === fromAssetId);
      newTxs.push({
        id: genId(),
        amount: fee,
        categoryId: FEE_CATEGORY_ID,
        type: 'expense',
        date,
        note: `转账手续费${fromAsset ? `（${fromAsset.name}）` : ''}`,
        createdAt: Date.now() + 1,
        ledgerId: effectiveActiveLedgerId,
      });
    }

    setTransactions((prev) => [...newTxs, ...prev]);
  };

  // ── 财务规划:计划付款 CRUD ──
  const addPaymentPlan: AppContextValue['addPaymentPlan'] = async (p) => {
    const plan: PaymentPlan = { ...p, id: genId(), createdAt: Date.now() };
    setPaymentPlans((prev) => [...prev, plan]);
  };

  const updatePaymentPlan: AppContextValue['updatePaymentPlan'] = async (id, updates) => {
    setPaymentPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const deletePaymentPlan: AppContextValue['deletePaymentPlan'] = async (id) => {
    setPaymentPlans((prev) => prev.filter((p) => p.id !== id));
  };

  // ── 自动扣账引擎(启动补账):对每个到期的计划逐期生成交易并推进游标 ──
  // 数据加载完成后跑一次;云同步写回数据(loadFromStorage)后也会再跑一次,
  // 保证换机恢复/多设备登录后同样把缺的期数补上。上限 24 期在引擎内控制。
  const processedPlansRef = useRef<string>('');
  useEffect(() => {
    if (loading) return;
    const fingerprint = JSON.stringify(paymentPlans) + activeLedgerId;
    if (processedPlansRef.current === fingerprint) return;
    processedPlansRef.current = fingerprint;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const plans = paymentPlans.filter((p) => p.ledgerId === activeLedgerId);
    if (plans.length === 0) return;

    const newTxs: Transaction[] = [];
    const planUpdates: { id: string; lastProcessedDate: string }[] = [];
    plans.forEach((plan) => {
      const { dueDates, newCursor } = computePlanOccurrences(plan, today);
      if (newCursor && newCursor !== plan.lastProcessedDate) {
        planUpdates.push({ id: plan.id, lastProcessedDate: newCursor });
      }
      dueDates.forEach((d) => {
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        // ⚠ id 必须是「计划 + 期次」派生的确定性值，不能用 genId()。
        // 补账可能在多设备 / 多次冷启动里重复触发（本地游标为空、云同步晚到都会导致），
        // 随机 id 每次都算作一笔新流水，于是服务端堆出一模一样的历史（实测重复生成 7 次、441 笔）。
        // 派生 id 让"同一计划的同一期"永远只有一笔：本地按 id 去重，服务端按
        // uk_transactions_user_client_uid 幂等 upsert。
        newTxs.push({
          id: `plan_${plan.id}_${dateStr}`,
          amount: plan.amount,
          categoryId: plan.categoryId ?? '',
          type: plan.type,
          date: dateStr,
          // note 留空:计划名已在 displayName,首页显示"类别 · 计划名"不会重复
          note: '',
          displayName: plan.name,
          createdAt: Date.now(),
          ledgerId: plan.ledgerId,
          assetId: plan.assetId,
        });
      });
    });

    if (newTxs.length > 0) {
      setTransactions((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        const fresh = newTxs.filter((t) => !seen.has(t.id));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
    }
    if (planUpdates.length > 0) {
      setPaymentPlans((prev) =>
        prev.map((p) => {
          const u = planUpdates.find((x) => x.id === p.id);
          if (!u) return p;
          // 游标只进不退：云同步可能在这批补账之后写回服务端更晚的游标(lastProcessedDate)，
          // 若用本次算出的旧游标覆盖它，下次启动会把已补的期数再补一遍(重复流水)。
          // YYYY-MM-DD 字符串比较即日期比较。
          const cur = p.lastProcessedDate;
          if (cur && cur >= u.lastProcessedDate) return p;
          return { ...p, lastProcessedDate: u.lastProcessedDate };
        })
      );
    }
  }, [loading, paymentPlans, activeLedgerId]);

  return (
    <AppContext.Provider
      value={{
        transactions,
        categories,
        budgets,
        // 界面永远拿到至少一本账本（真账本未到位时是内存占位，不落盘、不参与同步）
        ledgers: ledgers.length > 0 ? ledgers : [pendingLedger],
        activeLedgerId: effectiveActiveLedgerId,
        // 占位账本不是什么"默认账本"，别给它挂默认标记
        defaultLedgerId:
          ledgers.length === 0
            ? ''
            : ledgers.some((l) => l.id === defaultLedgerId)
              ? defaultLedgerId
              : effectiveActiveLedgerId,
        currency,
        currencySymbol: getCurrencySymbol(currency),
        periodPreference,
        assets,
        activeAssets,
        dateFormat,
        weekStartsOn,
        decimalPlaces,
        loading,
        paymentPlans,
        addPaymentPlan,
        updatePaymentPlan,
        deletePaymentPlan,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        addCategory,
        addCategoryGroup,
        deleteCategoryGroup,
        updateCategory,
        categoryGroups,
        deleteCategory,
        setBudget,
        getCategoryById,
        addLedger,
        renameLedger,
        deleteLedger,
        setActiveLedgerId,
        setDefaultLedger,
        setCurrency,
        setPeriodPreference,
        setDateFormat,
        setWeekStartsOn,
        setDecimalPlaces,
        addAsset,
        updateAsset,
        deleteAsset,
        archiveAsset,
        unarchiveAsset,
        assetRecordCount,
        assetHasRecords,
        getAssetById,
        getAssetBalance,
        setDefaultAsset,
        addTransfer,
        reloadFromStorage: loadFromStorage,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp必须在AppProvider内部使用');
  return ctx;
}
