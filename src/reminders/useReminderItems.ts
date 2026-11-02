import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { loadMutedKeys } from '../utils/reminderMute';
import {
  getReminderPrefsSnapshot,
  hydrateReminderPrefs,
  setReminderPrefs,
  subscribeReminderPrefs,
  type ReminderPrefs,
} from '../utils/reminderPrefs';
import { buildReminderItems } from './build';
import type { ReminderItem } from './types';

export interface ReminderItemsState {
  /** 已排除用户删掉的条目，按时间升序 */
  items: ReminderItem[];
  /** 全部条目（不排除删掉的），用于"恢复已删除"和排期对账 */
  allItems: ReminderItem[];
  prefs: ReminderPrefs;
  setPrefs: (next: ReminderPrefs) => Promise<void>;
  muted: Set<string>;
  reloadMuted: () => Promise<void>;
  loading: boolean;
}

/**
 * 提醒条目的唯一来源：页面显示与通知排期都从这里取，避免两处各算一遍算出不同结果。
 * prefs 走模块级 store（不是本地 state）：页面里改开关，App 层的排期 hook 必须立刻看到。
 */
export function useReminderItems(): ReminderItemsState {
  const { assets, paymentPlans, loading: appLoading } = useApp();
  const { user } = useAuth();
  const prefs = useSyncExternalStore(subscribeReminderPrefs, getReminderPrefsSnapshot, getReminderPrefsSnapshot);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [mutedReady, setMutedReady] = useState(false);

  useEffect(() => {
    void hydrateReminderPrefs();
    let alive = true;
    void loadMutedKeys().then((keys) => {
      if (!alive) return;
      setMuted(keys);
      setMutedReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const userId = user ? String(user.id) : null;

  const allItems = useMemo(
    () =>
      userId
        ? buildReminderItems({
            userId,
            assets,
            paymentPlans,
            daily: { dailyEnabled: prefs.dailyEnabled, dailyHour: prefs.dailyHour },
            now: new Date(),
          })
        : [],
    [userId, assets, paymentPlans, prefs.dailyEnabled, prefs.dailyHour]
  );

  const items = useMemo(() => allItems.filter((item) => !muted.has(item.key)), [allItems, muted]);

  const reloadMuted = useCallback(async () => {
    setMuted(await loadMutedKeys());
  }, []);

  return { items, allItems, prefs, setPrefs: setReminderPrefs, muted, reloadMuted, loading: appLoading || !mutedReady };
}
