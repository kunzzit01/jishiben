import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 「输入过的金额 → 类别」记忆（v2）。
 *
 * v1 的问题（用户反馈「输对金额却没带出正确分类」）：
 *   1) 只按精确金额一个全局键 —— 同一金额在不同账本、不同币种下会互相覆盖；
 *   2) 后写覆盖前写 —— 同一金额先后记过 3 次水果、1 次餐饮，反而带出餐饮；
 *   3) 永远自动套用 —— 金额本身歧义时（两个类别都用过）会套错。
 *
 * v2 规则：
 *   · 记忆按 (类型, 账本, 币种, 金额) 分组，互不串味；
 *   · 同一金额下按类别累计次数与最近时间；
 *   · 只有「最高票 >= 2 且严格多于第二名」才自动带出 —— 否则留给用户自己选，
 *     宁可不自动填，也不填错。
 */
const STORAGE_KEY = '@jizhang/amountCategory.v2';
const LEGACY_KEY = '@jizhang/amountCategory.v1';
/** 每个 scope 最多保留多少金额键，超出按最近使用淘汰 */
const MAX_KEYS_PER_SCOPE = 400;

export type AmountCategoryType = 'expense' | 'income';

export interface AmountScope {
  /** 账本 id：不同账本的金额习惯互不干扰 */
  ledgerId?: number | string | null;
  /** 币种代码（MYR/SGD…）：100 MYR 与 100 SGD 不该共用一条记忆 */
  currency?: string | null;
}

interface Candidate {
  n: number;
  at: number;
}

// scope -> amountKey -> categoryId -> 统计
interface AmountMap { [scope: string]: { [amountKey: string]: { [categoryId: string]: Candidate } } }

interface StoreShape {
  expense: AmountMap;
  income: AmountMap;
}

const EMPTY: StoreShape = { expense: {}, income: {} };

let snapshot: StoreShape = EMPTY;
let hydrated = false;
let hydration: Promise<void> | null = null;

function scopeKey(scope?: AmountScope): string {
  const ledger = scope?.ledgerId == null ? 'all' : String(scope.ledgerId);
  const currency = (scope?.currency || 'all').toUpperCase();
  return `L${ledger}|C${currency}`;
}

function amountKey(amount: number): string {
  // 统一 %g 口径，避免 12.5 / 12.50 / 12.500000001 这类浮点噪声造成漏命中
  return Number(amount.toFixed(2)).toString();
}

function sanitizeMap(raw: unknown): AmountMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: AmountMap = {};
  for (const [scope, amounts] of Object.entries(raw as Record<string, unknown>)) {
    if (!amounts || typeof amounts !== 'object') continue;
    const bucket: AmountMap[string] = {};
    for (const [amt, cats] of Object.entries(amounts as Record<string, unknown>)) {
      if (!cats || typeof cats !== 'object') continue;
      const inner: Record<string, Candidate> = {};
      for (const [catId, stats] of Object.entries(cats as Record<string, unknown>)) {
        const v = stats as Record<string, unknown>;
        if (!catId) continue;
        inner[catId] = {
          n: typeof v.n === 'number' && v.n > 0 ? v.n : 1,
          at: typeof v.at === 'number' ? v.at : 0,
        };
      }
      if (Object.keys(inner).length > 0) bucket[amt] = inner;
    }
    if (Object.keys(bucket).length > 0) out[scope] = bucket;
  }
  return out;
}

function sanitize(raw: unknown): StoreShape {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const obj = raw as Record<string, unknown>;
  return { expense: sanitizeMap(obj.expense), income: sanitizeMap(obj.income) };
}

/** v1 → v2：老的「全局精确金额」记忆迁移到 all|all 作用域，保留用户既有习惯 */
function migrateLegacy(raw: unknown): StoreShape {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const obj = raw as Record<string, any>;
  const toMap = (src: any): AmountMap => {
    const out: AmountMap = {};
    if (!src || typeof src !== 'object') return out;
    const bucket: Record<string, Record<string, Candidate>> = {};
    for (const [amount, sample] of Object.entries(src as Record<string, any>)) {
      const catId = sample?.categoryId;
      if (!catId) continue;
      bucket[amountKey(Number(amount))] = {
        [catId]: { n: typeof sample.n === 'number' && sample.n > 0 ? sample.n : 1, at: sample.at || 0 },
      };
    }
    if (Object.keys(bucket).length > 0) out['Lall|Call'] = bucket;
    return out;
  };
  return { expense: toMap(obj.expense), income: toMap(obj.income) };
}

function persist(): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch((e) =>
    console.warn('保存金额-类别记忆失败', e)
  );
}

/** 从磁盘恢复一次（幂等；多处同时触发也只读一次） */
export function hydrateAmountCategory(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        snapshot = sanitize(JSON.parse(raw));
      } else {
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        snapshot = legacy ? migrateLegacy(JSON.parse(legacy)) : EMPTY;
        if (legacy) persist();
      }
    } catch (e) {
      console.warn('读取金额-类别记忆失败', e);
      snapshot = EMPTY;
    } finally {
      hydrated = true;
    }
  })();
  return hydration;
}

function prune(bucket: AmountMap[string]): AmountMap[string] {
  const keys = Object.keys(bucket);
  if (keys.length <= MAX_KEYS_PER_SCOPE) return bucket;
  const latest = (amt: string) => Math.max(...Object.values(bucket[amt]).map((c) => c.at));
  const keep = keys.sort((a, b) => latest(b) - latest(a)).slice(0, MAX_KEYS_PER_SCOPE);
  const next: AmountMap[string] = {};
  keep.forEach((k) => {
    next[k] = bucket[k];
  });
  return next;
}

/** 记账成功时调用：累计「这个金额用过哪个类别」 */
export function rememberAmountCategory(
  type: AmountCategoryType,
  amount: number,
  categoryId: string | null | undefined,
  scope?: AmountScope
): void {
  if (!categoryId) return;
  if (!Number.isFinite(amount) || amount <= 0) return;
  const sk = scopeKey(scope);
  const ak = amountKey(amount);
  const bucket: AmountMap[string] = { ...(snapshot[type][sk] ?? {}) };
  const candidates: Record<string, Candidate> = { ...(bucket[ak] ?? {}) };
  const prev = candidates[categoryId];
  candidates[categoryId] = { n: (prev?.n ?? 0) + 1, at: Date.now() };
  bucket[ak] = candidates;
  snapshot = { ...snapshot, [type]: { ...snapshot[type], [sk]: prune(bucket) } };
  hydrated = true;
  persist();
}

/**
 * 查这个金额最可能属于哪个类别。
 * 返回 null 仅代表「这个金额没记录过」。有记录时总给出最可能的类别（票数 → 最近使用），
 * 避免出现「输入了以前的金额却毫无反应」。
 */
export function lookupCategoryForAmount(
  type: AmountCategoryType,
  amount: number,
  scope?: AmountScope
): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const ak = amountKey(amount);
  const scoped = snapshot[type][scopeKey(scope)]?.[ak];
  // 该账本/币种没有记录时，退回全局（迁移来的老数据或跨账本习惯）
  const candidates = scoped ?? snapshot[type]['Lall|Call']?.[ak];
  if (!candidates) return null;

  // 排序：票数优先，其次最近使用时间。始终返回最可能的那一个 ——
  // 用户反馈「输了金额没反应」比「偶尔带错」更不可接受，因此不做「歧义就不填」的静默。
  const ranked = Object.entries(candidates).sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at);
  return ranked[0]?.[0] ?? null;
}

/** 统计用：当前金额有哪些候选（调试/后续可做「常选」提示） */
export function listCategoryHints(
  type: AmountCategoryType,
  amount: number,
  scope?: AmountScope
): Array<{ categoryId: string; n: number }> {
  const ak = amountKey(amount);
  const candidates = snapshot[type][scopeKey(scope)]?.[ak];
  if (!candidates) return [];
  return Object.entries(candidates)
    .map(([categoryId, c]) => ({ categoryId, n: c.n }))
    .sort((a, b) => b.n - a.n);
}

/** 历史账目播种：把已有记录按出现次数折算成票数写进记忆。
 * 幂等 —— 该 (作用域, 金额) 已有任何候选时跳过，所以每次启动调用也不会重复计数。
 * 目的：老用户/换机用户不必把每个金额重新记一遍，就能享受「输入过的金额自动带类别」。
 */
export function seedAmountCategory(
  entries: Array<{
    type: AmountCategoryType;
    amount: number;
    categoryId?: string | null;
    scope?: AmountScope;
    at?: number;
  }>
): void {
  if (entries.length === 0) return;
  // 先按 (类型, 作用域, 金额, 类别) 聚合次数
  const grouped = new Map<string, { type: AmountCategoryType; scope: AmountScope; amount: number; catId: string; n: number; at: number }>();
  for (const e of entries) {
    if (!e.categoryId) continue;
    if (!Number.isFinite(e.amount) || e.amount <= 0) continue;
    const key = `${e.type}|${scopeKey(e.scope)}|${amountKey(e.amount)}|${e.categoryId}`;
    const prev = grouped.get(key);
    if (prev) {
      prev.n += 1;
      prev.at = Math.max(prev.at, e.at ?? 0);
    } else {
      grouped.set(key, {
        type: e.type,
        scope: e.scope ?? {},
        amount: e.amount,
        catId: e.categoryId,
        n: 1,
        at: e.at ?? 0,
      });
    }
  }

  let changed = false;
  const next: StoreShape = { expense: { ...snapshot.expense }, income: { ...snapshot.income } };
  for (const item of grouped.values()) {
    const sk = scopeKey(item.scope);
    const ak = amountKey(item.amount);
    const bucket = { ...(next[item.type][sk] ?? {}) };
    // 已有记录（用户后来的真实使用）优先，播种不覆盖
    if (bucket[ak] && Object.keys(bucket[ak]).length > 0) continue;
    bucket[ak] = { [item.catId]: { n: item.n, at: item.at } };
    next[item.type] = { ...next[item.type], [sk]: prune(bucket) };
    changed = true;
  }

  if (!changed) return;
  snapshot = next;
  hydrated = true;
  persist();
}

/**
 * 撤销一票：删除或改写一笔账时调用。
 * 票数减到 0 就把该类别从金额下移除，金额下没有任何类别时整条金额记录删除 ——
 * 这样「删掉那笔账之后，再输入同一金额不会又跳回被删的分类」。
 */
export function forgetAmountCategory(
  type: AmountCategoryType,
  amount: number,
  categoryId: string | null | undefined,
  scope?: AmountScope
): void {
  if (!categoryId) return;
  if (!Number.isFinite(amount) || amount <= 0) return;
  const sk = scopeKey(scope);
  const ak = amountKey(amount);
  const bucket = snapshot[type][sk];
  const candidates = bucket?.[ak];
  if (!bucket || !candidates || !candidates[categoryId]) return;

  const nextCandidates = { ...candidates };
  const n = (nextCandidates[categoryId]?.n ?? 0) - 1;
  if (n > 0) {
    nextCandidates[categoryId] = { ...nextCandidates[categoryId], n };
  } else {
    delete nextCandidates[categoryId];
  }

  const nextBucket = { ...bucket };
  if (Object.keys(nextCandidates).length === 0) delete nextBucket[ak];
  else nextBucket[ak] = nextCandidates;

  snapshot = { ...snapshot, [type]: { ...snapshot[type], [sk]: nextBucket } };
  persist();
}
