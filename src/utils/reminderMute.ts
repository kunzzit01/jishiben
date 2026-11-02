import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 被用户单条删掉的提醒（键集合）。
 *
 * 为什么要"记住"而不是只取消通知：排期是每轮按当前数据全量重算的（App 挂载、资产变化、
 * 换账号都会重算），不记住的话删掉的那条下一轮就会被原样排回来——用户会觉得删除按钮是假的。
 *
 * 为什么要剪枝：键里带目标日期（YYYYMMDD），日期过了这条提醒本来也不会再出现，
 * 留着只会无限增长。loadMutedKeys 每次读取时顺手把过期条目丢掉。
 */
const STORAGE_KEY = '@jizhang/creditCardReminders.muted';

/** 键里那一串 8 位日期（两种键形式都含且只含一个：payday 尾段、statement 末段） */
function stampOfKey(key: string): string | null {
  const hit = key.split('|').find((part) => /^\d{8}$/.test(part));
  return hit ?? null;
}

function todayStamp(now: Date): string {
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

async function readAll(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch (e) {
    console.warn('读取已删除提醒失败', e);
    return [];
  }
}

async function writeAll(keys: string[]): Promise<void> {
  try {
    if (keys.length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch (e) {
    console.warn('保存已删除提醒失败', e);
  }
}

/** 当前生效的"已删除"键集合（顺手清掉日期已过去的条目） */
export async function loadMutedKeys(now: Date = new Date()): Promise<Set<string>> {
  const all = await readAll();
  const today = todayStamp(now);
  const alive = all.filter((key) => {
    const stamp = stampOfKey(key);
    // 解析不出日期的条目无从判断，直接丢掉，别让它永久挡住一条提醒
    return stamp !== null && stamp >= today;
  });
  if (alive.length !== all.length) await writeAll(alive);
  return new Set(alive);
}

export async function muteReminderKey(key: string): Promise<void> {
  const all = await readAll();
  if (all.includes(key)) return;
  await writeAll([...all, key]);
}

/** 恢复全部被删的提醒（页脚「恢复已删除」） */
export async function unmuteAllReminders(): Promise<void> {
  await writeAll([]);
}
