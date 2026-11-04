import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 「输入过的金额 → 类别」记忆：记一笔时按金额自动带出类别。
 *
 * 只记精确金额（`toFixed(2)` 归一，12.5 与 12.50 同一格），同一金额写一次覆盖一次，
 * 所以天然就是「最近一次用过的那个类别」。
 *
 * 存储单独一个键：本机使用习惯，不跟账本数据一起同步或清空。
 */
const STORAGE_KEY = '@jizhang/amountCategory.v1';

/** 每种类型最多记多少个金额键，超出按最近使用淘汰 */
const MAX_KEYS_PER_TYPE = 300;

export type AmountCategoryType = 'expense' | 'income';

interface Sample {
  categoryId: string;
  /** 最后一次使用的时间戳（用于淘汰） */
  at: number;
  /** 用过几次（当前只做记录，不参与选择） */
  n: number;
}

type TypeMap = Record<string, Sample>;
interface StoreShape {
  expense: TypeMap;
  income: TypeMap;
}

const EMPTY: StoreShape = { expense: {}, income: {} };

let snapshot: StoreShape = EMPTY;
let hydrated = false;
let hydration: Promise<void> | null = null;

function sanitizeMap(raw: unknown): TypeMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: TypeMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (typeof v.categoryId !== 'string' || !v.categoryId) continue;
    out[key] = {
      categoryId: v.categoryId,
      at: typeof v.at === 'number' ? v.at : 0,
      n: typeof v.n === 'number' && v.n > 0 ? v.n : 1,
    };
  }
  return out;
}

function sanitize(raw: unknown): StoreShape {
  if (!raw || typeof raw !== 'object') return EMPTY;
  const obj = raw as Record<string, unknown>;
  return { expense: sanitizeMap(obj.expense), income: sanitizeMap(obj.income) };
}

/** 从磁盘恢复一次（幂等；多处同时触发也只读一次） */
export function hydrateAmountCategory(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      snapshot = raw ? sanitize(JSON.parse(raw)) : EMPTY;
    } catch (e) {
      console.warn('读取金额-类别记忆失败', e);
      snapshot = EMPTY;
    } finally {
      hydrated = true;
    }
  })();
  return hydration;
}

/** 超出上限时按 at 最旧淘汰 */
function prune(map: TypeMap): TypeMap {
  const keys = Object.keys(map);
  if (keys.length <= MAX_KEYS_PER_TYPE) return map;
  const keep = keys
    .sort((a, b) => map[b].at - map[a].at)
    .slice(0, MAX_KEYS_PER_TYPE);
  const next: TypeMap = {};
  keep.forEach((k) => {
    next[k] = map[k];
  });
  return next;
}

/** 保存成功后记一笔：同一金额覆盖写入（= 最近一次） */
export function rememberAmountCategory(
  type: AmountCategoryType,
  amount: number,
  categoryId: string | null | undefined
): void {
  if (!categoryId) return;
  if (!Number.isFinite(amount) || amount <= 0) return;
  const key = amount.toFixed(2);
  const prev = snapshot[type][key];
  const nextMap = prune({
    ...snapshot[type],
    [key]: { categoryId, at: Date.now(), n: (prev?.n ?? 0) + 1 },
  });
  snapshot = { ...snapshot, [type]: nextMap };
  hydrated = true;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)).catch((e) =>
    console.warn('保存金额-类别记忆失败', e)
  );
}

/** 精确金额查类别；没有记录返回 null */
export function lookupCategoryForAmount(type: AmountCategoryType, amount: number): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return snapshot[type][amount.toFixed(2)]?.categoryId ?? null;
}
