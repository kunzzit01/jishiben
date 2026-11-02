import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 提醒偏好（目前只有"每天记一笔"）。
 * 单独存一个键：它不属于账本数据，不该跟着账号同步或清空——换账号后提醒习惯通常不变。
 */
const STORAGE_KEY = '@jizhang/reminderPrefs.v1';

export interface ReminderPrefs {
  /** 每天提醒记一笔；默认关（不打扰是默认值） */
  dailyEnabled: boolean;
  /** 提醒时刻（本地小时），默认 21:00 —— 睡前把当天的账记完 */
  dailyHour: number;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { dailyEnabled: false, dailyHour: 21 };

export async function loadReminderPrefs(): Promise<ReminderPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_REMINDER_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_REMINDER_PREFS;
    const obj = parsed as Record<string, unknown>;
    const hour = typeof obj.dailyHour === 'number' && obj.dailyHour >= 0 && obj.dailyHour <= 23 ? obj.dailyHour : DEFAULT_REMINDER_PREFS.dailyHour;
    return { dailyEnabled: obj.dailyEnabled === true, dailyHour: hour };
  } catch (e) {
    console.warn('读取提醒偏好失败', e);
    return DEFAULT_REMINDER_PREFS;
  }
}

export async function saveReminderPrefs(prefs: ReminderPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn('保存提醒偏好失败', e);
  }
}
