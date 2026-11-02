import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 预算提醒的两类月度记录（同一个月内去重，换月自动失效）：
 * - 'n'（notified）：这个月已经弹过通知，避免每次数据变化都再弹一遍；
 * - 'd'（dismissed）：用户主动删掉的那条，不再显示在提醒中心。
 * 两者必须分开：共用一个集合的话，刚弹出的提醒会立刻被"已处理"过滤掉，列表永远是空的（踩过）。
 */
const STORAGE_KEY = '@jizhang/budgetAlerts.v1';

export type BudgetMarkKind = 'n' | 'd';

async function readAll(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch (e) {
    console.warn('读取预算提醒记录失败', e);
    return [];
  }
}

async function writeAll(keys: string[]): Promise<void> {
  try {
    if (!keys.length) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch (e) {
    console.warn('保存预算提醒记录失败', e);
  }
}

function markOf(key: string, kind: BudgetMarkKind): string {
  return `${kind}|${key}`;
}

/** 当前月份仍有效的一类记录（顺手丢掉别的月份的） */
export async function loadBudgetMarks(monthPrefix: string, kind: BudgetMarkKind): Promise<Set<string>> {
  const all = await readAll();
  const alive = all.filter((entry) => entry.includes(`|${monthPrefix}|`));
  if (alive.length !== all.length) await writeAll(alive);
  const prefix = `${kind}|`;
  return new Set(alive.filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length)));
}

export async function markBudgetAlert(key: string, kind: BudgetMarkKind): Promise<void> {
  const all = await readAll();
  const entry = markOf(key, kind);
  if (all.includes(entry)) return;
  await writeAll([...all, entry]);
}
