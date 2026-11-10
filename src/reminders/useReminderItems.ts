import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
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
import { buildReminderRules, loadDisabledRules, setRuleEnabled, type ReminderRule } from './rules';
import type { ReminderItem } from './types';

export interface ReminderItemsState {
  /** 应该排期的条目（已排除被关掉的规则与被删掉的实例） */
  items: ReminderItem[];
  /** 全部条目（含被关掉规则的），用于规则清单显示下次时间 */
  allItems: ReminderItem[];
  /** 用户看到的规则清单 */
  rules: ReminderRule[];
  disabledRules: Set<string>;
  toggleRule: (ruleId: string, enabled: boolean) => Promise<void>;
  prefs: ReminderPrefs;
  setPrefs: (next: ReminderPrefs) => Promise<void>;
  muted: Set<string>;
  reloadMuted: () => Promise<void>;
  loading: boolean;
}

/**
 * 提醒的唯一来源：规则清单给页面、条目集合给排期，两者由同一份计算产出。
 * prefs / 规则开关走模块级 store 或磁盘，App 层 hook 与页面读的是同一份。
 */
export function useReminderItems(): ReminderItemsState {
  const { assets, paymentPlans, loading: appLoading } = useApp();
  const { user } = useAuth();
  const prefs = useSyncExternalStore(subscribeReminderPrefs, getReminderPrefsSnapshot, getReminderPrefsSnapshot);
  const [muted, setMuted] = useState<Set<string>>(new Set());
  const [disabledRules, setDisabledRules] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  // 回到前台就刷新「现在」：App 进程常驻几天不重启时，buildInputs 里的 now 会一直停在上次挂载的时刻，
  // 每日提醒的 14 天窗口 / 月末 3 个月窗口就不会往后滚，窗口用完后系统里再没有可触发的通知
  const [clock, setClock] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') setClock((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void hydrateReminderPrefs();
    let alive = true;
    void Promise.all([loadMutedKeys(), loadDisabledRules()]).then(([mutedKeys, disabled]) => {
      if (!alive) return;
      setMuted(mutedKeys);
      setDisabledRules(disabled);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 未登录也照样排提醒：通知是系统级本地通知（expo-notifications），不走服务器。
  // 登录用户沿用 userId 做键命名空间（多账号互不串号）；未登录用 'local'，登出时整体撤销
  const scopeId = user ? String(user.id) : 'local';

  const buildInputs = useMemo(
    () => ({
      userId: scopeId,
      assets,
      paymentPlans,
      daily: { dailyEnabled: prefs.dailyEnabled, dailyHour: prefs.dailyHour },
      now: new Date(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeId, assets, paymentPlans, prefs.dailyEnabled, prefs.dailyHour, clock]
  );

  const allItems = useMemo(() => buildReminderItems(buildInputs), [buildInputs]);

  const rules = useMemo(() => buildReminderRules(buildInputs, allItems), [buildInputs, allItems]);

  const items = useMemo(
    () => allItems.filter((item) => !disabledRules.has(item.ruleId) && !muted.has(item.key)),
    [allItems, disabledRules, muted]
  );

  const toggleRule = useCallback(async (ruleId: string, enabled: boolean) => {
    await setRuleEnabled(ruleId, enabled);
    setDisabledRules((prev) => {
      const next = new Set(prev);
      if (enabled) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }, []);

  const reloadMuted = useCallback(async () => {
    setMuted(await loadMutedKeys());
  }, []);

  return {
    items,
    allItems,
    rules,
    disabledRules,
    toggleRule,
    prefs,
    setPrefs: setReminderPrefs,
    muted,
    reloadMuted,
    loading: appLoading || !ready,
  };
}
