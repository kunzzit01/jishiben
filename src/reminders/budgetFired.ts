import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 预算提醒的"这个月已经提醒过"记录。
 * 预算提醒是事件型的（达到 80%/100% 才发），没有排期可对账，所以用一份月度集合去重：
 * 一个月内同一个（预算, 币种, 阈值）只弹一次，换月自动失效。
 */
const STORAGE_KEY = '@jizhang/budgetAlerts.v1';

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

/** 当前月份仍有效的已提醒键（顺手丢掉别的月份的） */
export async function loadFiredBudgetKeys(monthPrefix: string): Promise<Set<string>> {
  const all = await readAll();
  const alive = all.filter((key) => key.split('|')[1] === monthPrefix);
  if (alive.length !== all.length) await writeAll(alive);
  return new Set(alive);
}

export async function markBudgetAlertFired(key: string): Promise<void> {
  const all = await readAll();
  if (all.includes(key)) return;
  await writeAll([...all, key]);
}
