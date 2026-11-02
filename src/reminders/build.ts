import type { PaymentPlan } from '../types';
import { buildCreditCardReminderNodes } from './credit';
import { nextDueDate } from '../utils/paymentPlans';
import type { ReminderItem, BuildInputs } from './types';

/** 提醒时刻：统一早上 9:00（夜里不打扰，早上又不至于还没醒） */
const REMINDER_HOUR = 9;
/** 计划的提前量：与信用卡一致（前 3/2/1 天 + 到期日当天） */
const PLAN_LEADS = [3, 2, 1, 0] as const;
/** 每日提醒排未来多少天：hook 每次挂载都会补排，14 天足够覆盖"隔几天才开一次"的用法 */
const DAILY_WINDOW_DAYS = 14;
/** 月末总结排未来几个月 */
const MONTH_END_MONTHS = 3;

function stampOf(date: Date): string {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function atHour(year: number, monthIndex: number, day: number, hour: number): Date {
  return new Date(year, monthIndex, day, hour, 0, 0, 0);
}

/** 信用卡：复用既有纯函数，键与文案完全不变（历史已排通知不会重复） */
function buildCreditItems(inputs: BuildInputs): ReminderItem[] {
  const { userId, assets, now } = inputs;
  if (!userId) return [];
  return buildCreditCardReminderNodes(userId, assets, now).map((node) => {
    const isStatement = node.kind === 'statement';
    const titleKey = isStatement
      ? 'asset.reminderOnStatement'
      : node.leadDays === 3
        ? 'asset.reminderOn3'
        : node.leadDays === 2
          ? 'asset.reminderOn2'
          : 'asset.reminderOn1';
    return {
      key: node.key,
      // 每张卡两类规则：还款日提醒、账单日提醒
      ruleId: `credit|${node.key.split('|')[1]}|${isStatement ? 'statement' : 'payday'}`,
      source: 'credit' as const,
      at: node.at,
      titleKey,
      titleParams: { name: node.assetName },
      bodyKey: isStatement ? undefined : 'asset.reminderHint',
      label: node.assetName,
    };
  });
}

/**
 * 计划付款：跨所有账本（与信用卡口径一致），只提醒"启用且没开自动扣账"的。
 * 开了自动扣账的计划到点会自己入账，再提醒就是噪音。
 */
function buildPlanItems(inputs: BuildInputs): ReminderItem[] {
  const { paymentPlans, now } = inputs;
  const items: ReminderItem[] = [];
  for (const plan of paymentPlans) {
    if (!plan.active || plan.autoDeduct) continue;
    // 取未来 3 期：窗口内最多 3 次到期，够覆盖 3 个月
    let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (let round = 0; round < 3; round += 1) {
      const due = nextDueDate(plan, cursor);
      if (!due) break;
      // nextDueDate 内部有 24 期追赶上限：起始日很老又没游标的计划会返回一个早就过去的日期，
      // 这种不排（否则会给过去排通知、立刻弹一条）；App 的补账游标会逐次把它推上来。
      if (due < startOfToday) break;
      const dueStamp = stampOf(due);
      for (const lead of PLAN_LEADS) {
        const day = new Date(due.getFullYear(), due.getMonth(), due.getDate() - lead, REMINDER_HOUR);
        if (day.getTime() <= now.getTime()) continue;
        items.push({
          key: `plan|${plan.id}|${dueStamp}|${lead}`,
          ruleId: `plan|${plan.id}`,
          source: 'plan',
          at: day,
          titleKey: lead === 0 ? 'reminder.planToday' : 'reminder.planLead',
          titleParams: { name: plan.name, days: lead },
          bodyKey: 'reminder.planBody',
          bodyParams: {},
          label: plan.name,
          amount: plan.amount,
        });
      }
      // 下一期的下界：到期日次日（nextDueDate 会推到那一天或之后）
      cursor = new Date(due.getFullYear(), due.getMonth(), due.getDate() + 1);
    }
  }
  return items;
}

/** 每日记账：默认关，开了才排；键里带日期，所以每天一条、互不覆盖 */
function buildDailyItems(inputs: BuildInputs): ReminderItem[] {
  const { daily, now } = inputs;
  if (!daily.dailyEnabled) return [];
  const items: ReminderItem[] = [];
  for (let offset = 0; offset < DAILY_WINDOW_DAYS; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, daily.dailyHour, 0, 0, 0);
    if (day.getTime() <= now.getTime()) continue;
    items.push({
      key: `daily|${stampOf(day)}`,
      ruleId: 'daily',
      source: 'daily',
      at: day,
      titleKey: 'reminder.dailyTitle',
      titleParams: {},
      bodyKey: 'reminder.dailyBody',
      bodyParams: {},
      label: '',
    });
  }
  return items;
}

/** 月末总结：每月最后一天早上，提醒看一眼本月收支 */
function buildMonthEndItems(inputs: BuildInputs): ReminderItem[] {
  const { now } = inputs;
  const items: ReminderItem[] = [];
  for (let offset = 0; offset < MONTH_END_MONTHS; offset += 1) {
    const y = now.getFullYear();
    const m = now.getMonth() + offset;
    const year = y + Math.floor(m / 12);
    const monthIndex = ((m % 12) + 12) % 12;
    // 下个月的第 0 天 = 本月最后一天（JS Date 正常化语义，这里正好用得上）
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const at = atHour(year, monthIndex, lastDay, REMINDER_HOUR);
    if (at.getTime() <= now.getTime()) continue;
    items.push({
      key: `monthEnd|${stampOf(at)}`,
      ruleId: 'monthEnd',
      source: 'monthEnd',
      at,
      titleKey: 'reminder.monthEndTitle',
      titleParams: {},
      bodyKey: 'reminder.monthEndBody',
      bodyParams: {},
      label: '',
    });
  }
  return items;
}

/** 全部提醒：按时间升序，页面的"下次提醒"就是第一条 */
export function buildReminderItems(inputs: BuildInputs): ReminderItem[] {
  return [...buildCreditItems(inputs), ...buildPlanItems(inputs), ...buildDailyItems(inputs), ...buildMonthEndItems(inputs)].sort(
    (a, b) => a.at.getTime() - b.at.getTime()
  );
}

export { buildCreditItems, buildPlanItems, buildDailyItems, buildMonthEndItems };
