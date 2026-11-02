import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { loadMutedKeys } from '../utils/reminderMute';
import { DEFAULT_REMINDER_PREFS, loadReminderPrefs, saveReminderPrefs, type ReminderPrefs } from '../utils/reminderPrefs';
import { buildReminderItems } from './build';
import type { ReminderItem } from './types';

export interface ReminderItemsState {
  /** 已排除用户删掉的条目，按时间升序 */
  items: ReminderItem[];
  /** 全部条目（不排除删掉的），用来判断"是否还有被删的可以恢复" */
  allItems: ReminderItem[];
  prefs: ReminderPrefs;
  setPrefs: (next: ReminderPrefs) => Promise<void>;
  muted: Set<string>;
  reloadMuted: () => Promise<void>;
  loading: boolean;
}

/**
 * 提醒条目的唯一来源：页面显示与通知排期都从这里取，避免两处各算一遍算出不同结果。
 * 未登录时不产任何条目——排期键带 userId，没账号就没有"谁该被提醒"。
 */
export function useReminderItems(): ReminderItemsState {
  const { assets, paymentPlans, loading: appLoading } = useApp();
  const { user } = useAuth();
  const [prefs, setPrefsState] = useState<ReminderPrefs>(DEFAULT_REMINDER_PREFS);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [prefsLoading, setPrefsLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadReminderPrefs(), loadMutedKeys()]).then(([loadedPrefs, loadedMuted]) => {
      if (!alive) return;
      setPrefsState(loadedPrefs);
      setMuted(loadedMuted);
      setPrefsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const userId = user ? String(user.id) : null;

  const allItems = useMemo(
    () =>
      userId
        ? buildReminderItems({ userId, assets, paymentPlans, daily: { dailyEnabled: prefs.dailyEnabled, dailyHour: prefs.dailyHour }, now: new Date() })
        : [],
    [userId, assets, paymentPlans, prefs.dailyEnabled, prefs.dailyHour]
  );

  const items = useMemo(() => allItems.filter((item) => !muted.has(item.key)), [allItems, muted]);

  const setPrefs = useCallback(async (next: ReminderPrefs) => {
    setPrefsState(next);
    await saveReminderPrefs(next);
  }, []);

  const reloadMuted = useCallback(async () => {
    setMuted(await loadMutedKeys());
  }, []);

  return { items, allItems, prefs, setPrefs, muted, reloadMuted, loading: appLoading || prefsLoading };
}
