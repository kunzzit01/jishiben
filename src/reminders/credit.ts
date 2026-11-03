// 信用卡提醒的纯计算层：从 src/hooks/useCreditCardReminders.ts 搬出来（排期逻辑已统一到
// src/hooks/useReminders.ts）。这里只留"给定卡片和当前时间，该在什么时候提醒什么"。
import { Asset } from '../types';
import type { TranslateFunction } from '../i18n';

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

/**
 * 当月真实存在的「每月某日」：该月没有 day 这一天（如 2 月 30 日）就取该月最后一天。
 * 还款日和账单日共用——两者都必须裁剪，不能拿 new Date(y, m, 30) 直接构造。
 */
function targetDayOfMonth(year: number, monthIndex: number, day: number): CalendarDay {
  return { year, monthIndex, day: Math.min(day, lastDayOfMonth(year, monthIndex)) };
}

/** 合法的「每月某日」：1-30（账单日与还款日同一口径） */
function isValidMonthDay(day: number | undefined): day is number {
  return typeof day === 'number' && day >= 1 && day <= 30;
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
 * 目标账户：信用卡 + 还款提醒默认开启（只有显式关掉才排除）+ 还款日 1-30 号 + 未归档。跨所有账本，不受当前账本限制。
 * 判 reminderEnabled !== false 而不是 === true：这个字段是后加的可选字段，历史卡片上根本没有它，
 * 判 === true 等于把老数据静默关成「不提醒」，而用户的预期是「提醒本来就是自动的，不需要点开」。
 * 归档判定用 archivedAt（有值即归档；恢复时 AppContext.unarchiveAsset 会把它删掉，所以活跃账户恒为 undefined）。
 * 归档那一下 assets 就变了 → 指纹变化 → reconcile 会把这张卡已排的记录取消并删掉。
 */
function isCreditCardReminderTarget(asset: Asset): boolean {
  return (
    asset.type === 'credit' &&
    asset.reminderEnabled !== false &&
    !asset.archivedAt &&
    isValidMonthDay(asset.dueDay)
  );
}

interface CreditCardReminderNodeBase {
  /** 去重键：还款日节点 userId|assetId|目标还款日 YYYYMMDD|提前天数；账单日节点 userId|assetId|statement|目标账单日 YYYYMMDD */
  key: string;
  assetName: string;
  /** 触发时刻（当地 09:00） */
  at: Date;
}

/** 还款日前 3 / 2 / 1 天 */
export interface PaydayReminderNode extends CreditCardReminderNodeBase {
  kind: 'payday';
  leadDays: number;
}

/** 账单日当天 */
export interface StatementReminderNode extends CreditCardReminderNodeBase {
  kind: 'statement';
}

export type CreditCardReminderNode = PaydayReminderNode | StatementReminderNode;
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
    // 账单日是可选字段：老数据没有它，那就只排还款日节点
    const statementDay = isValidMonthDay(asset.statementDay) ? asset.statementDay : null;

    for (let offset = 0; offset < WINDOW_MONTHS; offset += 1) {
      // 年月偏移自己算（baseMonth 0-11 + offset 0-2，最多跨一个年）
      const shifted = baseMonth + offset;
      const year = now.getFullYear() + Math.floor(shifted / 12);
      const monthIndex = shifted % 12;

      // 账单日当天：和还款日一样先做月末裁剪；键里固定带 statement 段，
      // 与还款日节点形式不同，statementDay === dueDay 时也不会互相覆盖
      if (statementDay !== null) {
        const statement = targetDayOfMonth(year, monthIndex, statementDay);
        const at = new Date(statement.year, statement.monthIndex, statement.day, REMINDER_HOUR, 0, 0, 0);
        if (at.getTime() > now.getTime()) {
          nodes.push({
            key: `${userId}|${asset.id}|statement|${dayStamp(statement)}`,
            assetName: asset.name,
            kind: 'statement',
            at,
          });
        }
      }

      const payday = targetDayOfMonth(year, monthIndex, dueDay);
      const paydayStamp = dayStamp(payday);

      for (const leadDays of LEAD_DAYS) {
        const nodeDay = subtractCalendarDays(payday.year, payday.monthIndex, payday.day, leadDays);
        const at = new Date(nodeDay.year, nodeDay.monthIndex, nodeDay.day, REMINDER_HOUR, 0, 0, 0);
        if (at.getTime() <= now.getTime()) continue;
        nodes.push({
          key: `${userId}|${asset.id}|${paydayStamp}|${leadDays}`,
          assetName: asset.name,
          kind: 'payday',
          leadDays,
          at,
        });
      }
    }
  }

  return nodes;
}
/**
 * 通知文案。还款日节点带提前天数、body 附「如已还款请忽略」；
 * 账单日节点只提醒核对本期账单，那句免责话不属于它。
 */
export function creditCardReminderMessage(
  t: TranslateFunction,
  node: CreditCardReminderNode
): { title: string; body: string } {
  if (node.kind === 'statement') {
    return { title: t('asset.reminderOnStatement', { name: node.assetName }), body: '' };
  }
  const key =
    node.leadDays === 3 ? 'asset.reminderOn3' : node.leadDays === 2 ? 'asset.reminderOn2' : 'asset.reminderOn1';
  return { title: t(key, { name: node.assetName }), body: t('asset.reminderHint') };
}
