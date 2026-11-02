// 信用卡还款提醒 hook：给"还款日前 3 / 2 / 1 天"排本地通知（本地 09:00）。
//
// 为什么预排 3 个月：本地通知只在 App 挂载或账户数据变化时才能排期，而用户可能连着几周
// 不打开 App。一次把未来 3 个月交给系统，长时间不开也不会漏提醒；窗口再长只会在系统里
// 堆积一堆待发通知（iOS 待发通知上限 64 条），窗口太短又容易漏，3 个月是这两头的折中。
//
// 为什么必须做月末裁剪：还款日 30 号碰到 2 月根本没有这一天。直接 new Date(y, m, 30) 会被
// JS Date 规范化成 3 月 2 日，提醒就排到了错误的日期上。所以先取 min(dueDay, 当月天数) 得到
// 真实存在的还款日，再在这个日期上做日历天减法。
//
// 为什么按 key 去重：同一份数据会被反复调度（App 每次挂载、assets 每次变化、切账号），
// 没有 key 就会重复排期——用户同一天收到好几条提醒，而且旧的那几条再也无法取消。
// key = userId|assetId|目标还款日|提前天数 唯一标识一个节点：已存在就复用它的通知 id，
// 每轮只在"应存在集合"和"已排集合"之间做增删，重复跑是幂等的。
import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from '../types';
import type { TranslateFunction } from '../i18n';
import { useApp } from '../context/AppContext';
import { useT } from '../i18n/LanguageContext';
import {
  cancelScheduledNotification,
  cancelScheduledNotifications,
  scheduleLocalNotification,
} from '../utils/notifications';

/** key -> notificationId 的映射（键名带版本号：以后换结构整块换新键，老键自然废弃） */
const STORAGE_KEY = '@jizhang/creditCardReminders.v1';
/** 滚动窗口：从本月起排 3 个月 */
const WINDOW_MONTHS = 3;
/** 提前天数：还款日前 3 / 2 / 1 天 */
const LEAD_DAYS = [3, 2, 1] as const;
/** 提醒时刻：当地 09:00（不打扰休息，又不至于当天还没开始就催） */
const REMINDER_HOUR = 9;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

interface CalendarDay {
  year: number;
  /** 0-11，与 Date.getMonth() 一致 */
  monthIndex: number;
  day: number;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 某年某月有多少天。自己算闰年，不借 Date 的月末语义 */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return monthIndex === 1 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[monthIndex];
}

/** 当月真实存在的还款日：该月没有 dueDay 这一天（如 2 月 30 日）就取该月最后一天 */
function targetPaydayOfMonth(year: number, monthIndex: number, dueDay: number): CalendarDay {
  return { year, monthIndex, day: Math.min(dueDay, lastDayOfMonth(year, monthIndex)) };
}

/**
 * 日历天减法：逐月借位，全程只有日期字段的加减，不做毫秒运算
 * （毫秒减 86400000 在夏令时切换那天会差出 1 小时，节气时间一变提醒时刻就漂了）。
 */
function subtractCalendarDays(year: number, monthIndex: number, day: number, days: number): CalendarDay {
  let y = year;
  let m = monthIndex;
  let d = day - days;
  while (d < 1) {
    m -= 1;
    if (m < 0) {
      m = 11;
      y -= 1;
    }
    d += lastDayOfMonth(y, m);
  }
  return { year: y, monthIndex: m, day: d };
}

function dayStamp(day: CalendarDay): string {
  return `${day.year}${String(day.monthIndex + 1).padStart(2, '0')}${String(day.day).padStart(2, '0')}`;
}

/**
 * 目标账户：信用卡 + 开了还款提醒 + 还款日 1-30 号 + 未归档。跨所有账本，不受当前账本限制。
 * 归档判定用 archivedAt（有值即归档；恢复时 AppContext.unarchiveAsset 会把它删掉，所以活跃账户恒为 undefined）。
 * 归档那一下 assets 就变了 → 指纹变化 → reconcile 会把这张卡已排的记录取消并删掉。
 */
function isCreditCardReminderTarget(asset: Asset): boolean {
  return (
    asset.type === 'credit' &&
    asset.reminderEnabled === true &&
    !asset.archivedAt &&
    typeof asset.dueDay === 'number' &&
    asset.dueDay >= 1 &&
    asset.dueDay <= 30
  );
}

export interface CreditCardReminderNode {
  /** 去重键：userId|assetId|目标还款日 YYYYMMDD|提前天数 */
  key: string;
  assetName: string;
  leadDays: number;
  /** 触发时刻（当地 09:00） */
  at: Date;
}

/**
 * 算出"应存在的节点集合"：未来 3 个月 × 3 个提前量。
 * 触发时刻已经过去（<= now）的节点直接丢掉——本地通知不能补发，给过去的时间排期只会立刻弹一条。
 */
export function buildCreditCardReminderNodes(userId: string, assets: Asset[], now: Date): CreditCardReminderNode[] {
  const nodes: CreditCardReminderNode[] = [];
  const baseMonth = now.getMonth();

  for (const asset of assets) {
    if (!isCreditCardReminderTarget(asset)) continue;
    const dueDay = asset.dueDay as number;

    for (let offset = 0; offset < WINDOW_MONTHS; offset += 1) {
      // 年月偏移自己算（baseMonth 0-11 + offset 0-2，最多跨一个年）
      const shifted = baseMonth + offset;
      const year = now.getFullYear() + Math.floor(shifted / 12);
      const monthIndex = shifted % 12;
      const payday = targetPaydayOfMonth(year, monthIndex, dueDay);
      const paydayStamp = dayStamp(payday);

      for (const leadDays of LEAD_DAYS) {
        const nodeDay = subtractCalendarDays(payday.year, payday.monthIndex, payday.day, leadDays);
        const at = new Date(nodeDay.year, nodeDay.monthIndex, nodeDay.day, REMINDER_HOUR, 0, 0, 0);
        if (at.getTime() <= now.getTime()) continue;
        nodes.push({
          key: `${userId}|${asset.id}|${paydayStamp}|${leadDays}`,
          assetName: asset.name,
          leadDays,
          at,
        });
      }
    }
  }

  return nodes;
}

type ReminderMap = Record<string, string>;

async function loadReminderMap(): Promise<ReminderMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const map: ReminderMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') map[key] = value;
    }
    return map;
  } catch (e) {
    console.warn('读取信用卡还款提醒映射失败', e);
    return {};
  }
}

async function saveReminderMap(map: ReminderMap): Promise<void> {
  try {
    if (Object.keys(map).length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('保存信用卡还款提醒映射失败', e);
  }
}

function reminderTitle(t: TranslateFunction, leadDays: number, assetName: string): string {
  const key =
    leadDays === 3 ? 'asset.reminderOn3' : leadDays === 2 ? 'asset.reminderOn2' : 'asset.reminderOn1';
  return t(key, { name: assetName });
}

async function doReconcile(params: ReconcileParams): Promise<void> {
  const { userId, assets, t } = params;
  const now = params.now ?? new Date();
  const nodes = buildCreditCardReminderNodes(userId, assets, now);
  const desiredKeys = new Set(nodes.map((node) => node.key));
  const stored = await loadReminderMap();

  // 1) 多余的记录：账户删了 / 关了提醒 / 节点已经过去 → 撤通知并丢掉记录
  const next: ReminderMap = {};
  for (const [key, id] of Object.entries(stored)) {
    if (desiredKeys.has(key)) {
      next[key] = id; // 同一节点已经排过：复用它的通知 id，绝不重复排
      continue;
    }
    await cancelScheduledNotification(id);
  }

  // 2) 缺失的节点：补排并记下 id（调度失败返回 null，不记记录，下一轮还会再试）
  for (const node of nodes) {
    if (next[node.key]) continue;
    const id = await scheduleLocalNotification(reminderTitle(t, node.leadDays, node.assetName), t('asset.reminderHint'), node.at);
    if (id) next[node.key] = id;
  }

  await saveReminderMap(next);
}

export interface ReconcileParams {
  userId: string;
  assets: Asset[];
  t: TranslateFunction;
  /** 当前时间（验收脚本注入用；界面里不传，取 now） */
  now?: Date;
}

// 串行执行：assets 连续变化时两轮调度会同时读写同一份映射，同一节点可能被排两次
let reconcileChain: Promise<void> = Promise.resolve();

/** 重算并落地这个用户的还款提醒排期（幂等：同一份数据跑多少次结果都一样） */
export function reconcileCreditCardReminders(params: ReconcileParams): Promise<void> {
  const run = () => doReconcile(params).catch((e) => console.warn('信用卡还款提醒调度失败', e));
  reconcileChain = reconcileChain.then(run, run);
  return reconcileChain;
}

/**
 * 登出清理：撤掉这个账号已排的还款提醒并抹掉映射。
 * 只取消自己映射里的通知 id，所以不会碰到计划付款提醒（它的 id 不在这个存储里）。
 */
export async function cancelCreditCardRemindersForUser(userId: string | null): Promise<void> {
  const stored = await loadReminderMap();
  const prefix = userId ? `${userId}|` : null;
  const next: ReminderMap = {};
  const ids: string[] = [];
  for (const [key, id] of Object.entries(stored)) {
    if (prefix === null || key.startsWith(prefix)) ids.push(id);
    else next[key] = id;
  }
  await cancelScheduledNotifications(ids);
  await saveReminderMap(next);
}

/**
 * 挂载点：assets 变化 / 账号变化时重算。不轮询——
 * 排期是"未来 3 个月全量重算"的快照，只有数据本身变了才需要再来一遍。
 */
export function useCreditCardReminders(userId: string | null): void {
  const { assets, loading } = useApp();
  const t = useT();
  // 指纹：同一份数据 + 同一天反复调度只是白读白写映射，直接跳过
  const lastFingerprintRef = useRef('');

  useEffect(() => {
    // 没登录就没有 userId，去重键无从谈起（也不能把提醒排给一个没有主人的账号）
    if (loading || !userId) return;

    const today = new Date();
    const fingerprint = [
      userId,
      `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,
      ...assets
        .filter(isCreditCardReminderTarget)
        .map((asset) => `${asset.id}:${asset.name}:${asset.dueDay}`)
        .sort(),
    ].join('|');
    if (lastFingerprintRef.current === fingerprint) return;
    lastFingerprintRef.current = fingerprint;

    void reconcileCreditCardReminders({ userId, assets, t });
  }, [assets, loading, userId, t]);
}
