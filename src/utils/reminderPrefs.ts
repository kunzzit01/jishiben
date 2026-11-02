import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 提醒偏好（"每天记一笔"）。
 *
 * 为什么需要一个模块级 store 而不是 useState：
 * 偏好同时被两处消费——设置它的页面、按它排期的 App 层 hook。各持一份 state 的话，
 * 页面里打开开关只有页面自己知道，排期 hook 仍按旧偏好算，系统里不会多排一条通知
 * （实测过：开关亮着但闹钟数不变）。这里用一份内存快照 + 订阅，两边读同一份。
 *
 * 存储单独一个键：它不属于账本数据，不该跟着账号同步或清空。
 */
const STORAGE_KEY = '@jizhang/reminderPrefs.v1';

export interface ReminderPrefs {
  /** 每天提醒记一笔；默认关（不打扰是默认值） */
  dailyEnabled: boolean;
  /** 提醒时刻（本地小时），默认 21:00 —— 睡前把当天的账记完 */
  dailyHour: number;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { dailyEnabled: false, dailyHour: 21 };

let snapshot: ReminderPrefs = DEFAULT_REMINDER_PREFS;
let hydrated = false;
let hydration: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

function sanitize(raw: unknown): ReminderPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_REMINDER_PREFS;
  const obj = raw as Record<string, unknown>;
  const hour =
    typeof obj.dailyHour === 'number' && obj.dailyHour >= 0 && obj.dailyHour <= 23
      ? obj.dailyHour
      : DEFAULT_REMINDER_PREFS.dailyHour;
  return { dailyEnabled: obj.dailyEnabled === true, dailyHour: hour };
}

/** 从磁盘恢复一次（幂等；多个调用方同时触发也只读一次） */
export function hydrateReminderPrefs(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydration) return hydration;
  hydration = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      snapshot = raw ? sanitize(JSON.parse(raw)) : DEFAULT_REMINDER_PREFS;
    } catch (e) {
      console.warn('读取提醒偏好失败', e);
      snapshot = DEFAULT_REMINDER_PREFS;
    } finally {
      hydrated = true;
      emit();
    }
  })();
  return hydration;
}

export function getReminderPrefsSnapshot(): ReminderPrefs {
  return snapshot;
}

export function subscribeReminderPrefs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 改偏好：先更新内存快照并通知（UI 立刻响应），再落盘 */
export async function setReminderPrefs(next: ReminderPrefs): Promise<void> {
  snapshot = next;
  hydrated = true;
  emit();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('保存提醒偏好失败', e);
  }
}
