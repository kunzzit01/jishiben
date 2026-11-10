import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useApp } from '../context/AppContext';
import { useT } from '../i18n/LanguageContext';
import {
  cancelScheduledNotification,
  isNotificationPermissionGranted,
  scheduleLocalNotification,
} from '../utils/notifications';
import { loadMutedKeys } from '../utils/reminderMute';
import { loadDisabledRules } from '../reminders/rules';
import { useReminderItems } from '../reminders/useReminderItems';
import type { ReminderItem } from '../reminders/types';
import type { TranslateFunction } from '../i18n';
import { formatMoney } from '../utils/formatMoney';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 统一排期：把"应该存在的提醒集合"和"已经排在系统里的"对账，多退少补。
 *
 * 与旧实现的两点差别：
 * 1. 一个映射管所有来源（信用卡 / 计划付款 / 每日 / 月末），不再各 hook 各存一份，
 *    否则同一份数据被两个 hook 各排一次、取消时互相踩。
 * 2. 旧键 '@jizhang/creditCardReminders.v1' 首次运行时统一撤销并清空（迁移），
 *    否则换键之后老通知还躺在系统里，用户会收到重复的两条。
 */
const STORAGE_KEY = '@jizhang/reminders.v2';
const LEGACY_KEY = '@jizhang/creditCardReminders.v1';

type ReminderMap = Record<string, string>;

async function loadMap(key: string): Promise<ReminderMap> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const map: ReminderMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') map[k] = v;
    return map;
  } catch (e) {
    console.warn('读取提醒映射失败', e);
    return {};
  }
}

async function saveMap(key: string, map: ReminderMap): Promise<void> {
  try {
    if (Object.keys(map).length === 0) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(map));
  } catch (e) {
    console.warn('保存提醒映射失败', e);
  }
}

/** 迁移：旧版只存信用卡，键前缀不同且没有来源段，直接撤销重排最省事也最安全 */
let legacyMigrated = false;
async function migrateLegacyOnce(): Promise<void> {
  if (legacyMigrated) return;
  legacyMigrated = true;
  const legacy = await loadMap(LEGACY_KEY);
  const ids = Object.values(legacy);
  for (const id of ids) await cancelScheduledNotification(id);
  await AsyncStorage.removeItem(LEGACY_KEY).catch(() => {});
}

function renderText(t: TranslateFunction, item: ReminderItem, decimals: number): { title: string; body: string } {
  const title = t(item.titleKey, item.titleParams);
  const bodyParams =
    item.amount !== undefined
      ? { ...item.bodyParams, amount: formatMoney(item.amount, { decimals }) }
      : item.bodyParams;
  const body = item.bodyKey ? t(item.bodyKey, bodyParams) : '';
  return { title, body };
}

export interface ReconcileInput {
  items: ReminderItem[];
  t: TranslateFunction;
  decimals: number;
}

async function doReconcile({ items, t, decimals }: ReconcileInput): Promise<void> {
  await migrateLegacyOnce();
  // 已删除集合与规则开关每次都从磁盘现读，不信调用方传进来的 UI 状态：
  // 页面里刚关掉一条规则时，App 层那个 hook 的内存快照还是旧的，照旧算会把这条重新排回去
  const [muted, disabledRules] = await Promise.all([loadMutedKeys(), loadDisabledRules()]);
  const desired = new Set(
    items
      .filter((item) => !muted.has(item.key) && !disabledRules.has(item.ruleId))
      .map((item) => item.key)
  );
  const stored = await loadMap(STORAGE_KEY);

  // 1) 已经不该存在的：账户删了 / 关开关 / 节点过去 → 撤销并丢记录
  const next: ReminderMap = {};
  for (const [key, id] of Object.entries(stored)) {
    if (desired.has(key)) {
      next[key] = id; // 同一节点已排过：复用 id，绝不重复排
      continue;
    }
    await cancelScheduledNotification(id);
  }

  // 2) 还没有的：补排（失败返回 null 就不记，下一轮再试）
  for (const item of items) {
    if (!desired.has(item.key)) continue; // 被关掉的规则 / 被删掉的实例不补排
    if (next[item.key]) continue;
    const { title, body } = renderText(t, item, decimals);
    const id = await scheduleLocalNotification(title, body, item.at);
    if (id) next[item.key] = id;
  }

  await saveMap(STORAGE_KEY, next);
}

let chain: Promise<void> = Promise.resolve();

/** 重算并落地排期（幂等：同一份数据跑多少次结果都一样） */
export function reconcileReminders(input: ReconcileInput): Promise<void> {
  const run = () => doReconcile(input).catch((e) => console.warn('提醒排期失败', e));
  chain = chain.then(run, run);
  return chain;
}

/** 取消单条并抹掉记录（页面里点删除时用；调用方随后还要把键记进 muted） */
export async function cancelReminderItem(key: string): Promise<void> {
  const stored = await loadMap(STORAGE_KEY);
  const id = stored[key];
  if (!id) return;
  await cancelScheduledNotification(id);
  const next: ReminderMap = { ...stored };
  delete next[key];
  await saveMap(STORAGE_KEY, next);
}

/** 登出清理：撤掉这个账号已排的提醒（键里带 userId 的才撤），别的账号不受影响 */
export async function cancelRemindersForUser(userId: string | null): Promise<void> {
  const stored = await loadMap(STORAGE_KEY);
  const prefix = userId ? `${userId}|` : null;
  const next: ReminderMap = {};
  for (const [key, id] of Object.entries(stored)) {
    const belongs = prefix === null ? true : key.startsWith(prefix) || key.startsWith(`plan|${userId}|`);
    if (belongs) await cancelScheduledNotification(id);
    else next[key] = id;
  }
  await saveMap(STORAGE_KEY, next);
}

/** 挂载点：条目集合或语言/小数位变化时对账一次 */
export function useReminders(): void {
  // 用 allItems（未过滤删除项）：过滤交给 reconcile 现读磁盘的 muted 集合，
  // 这样即使 UI 侧的快照过期，也不会把用户删掉的提醒排回来
  const { allItems, prefs, loading } = useReminderItems();
  const { decimalPlaces } = useApp();
  const t = useT();
  const lastRef = useRef('');
  // 回到前台且「已有通知权限」→ 重试一次对账。
  // 场景：首次因权限被拒没排上，用户随后去系统设置里打开了通知，回到 App 时提醒清单没变、
  // 指纹相同 → 原来要杀进程重开才会补排。对账是幂等的（已排过的复用 id，只补缺的）。
  // 只在已授权时才重试：没授权就重试只会反复弹授权框 / 白跑。
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void isNotificationPermissionGranted().then((ok) => {
        if (ok) setRetryTick((n) => n + 1);
      });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (loading) return;
    // 指纹 = 全部键 + 小数位 + 前台重试序号；仅时间流逝（条目没变）时不重复读写映射
    const fingerprint = `${allItems.map((i) => i.key).join(',')}|${decimalPlaces}|${retryTick}`;
    if (lastRef.current === fingerprint) return;
    lastRef.current = fingerprint;
    void reconcileReminders({ items: allItems, t, decimals: decimalPlaces });
  }, [allItems, loading, t, decimalPlaces, prefs.dailyEnabled, prefs.dailyHour, retryTick]);
}

export { loadMutedKeys };
