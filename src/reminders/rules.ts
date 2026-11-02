import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Asset, PaymentPlan } from '../types';
import type { BuildInputs, ReminderItem, ReminderSource } from './types';

/**
 * 规则的关/开。
 *
 * 用户看的是"规则"（每月 5 号的还款日提醒），系统里排的是这条规则的若干实例
 * （前 3/2/1 天各一条、未来 3 个月各一份）。所以开关必须按规则关，不能按实例关——
 * 按实例关等于"这一次不提醒"，下个月还会来，用户会觉得关不掉。
 */
const STORAGE_KEY = '@jizhang/reminderRules.off.v1';

export interface ReminderRule {
  id: string;
  source: ReminderSource;
  /** 主体名（卡名 / 计划名；每日与月末为空） */
  label: string;
  /** 节奏描述（i18n 键 + 参数） */
  detailKey: string;
  detailParams: Record<string, string | number>;
  /** 这条规则下一次提醒的时刻（没有未来实例时为 null） */
  nextAt: Date | null;
}

async function readAll(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch (e) {
    console.warn('读取提醒规则开关失败', e);
    return [];
  }
}

export async function loadDisabledRules(): Promise<Set<string>> {
  return new Set(await readAll());
}

export async function setRuleEnabled(ruleId: string, enabled: boolean): Promise<void> {
  const all = await readAll();
  const has = all.includes(ruleId);
  if (enabled && !has) return;
  if (!enabled && has) return;
  const next = enabled ? all.filter((id) => id !== ruleId) : [...all, ruleId];
  try {
    if (!next.length) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn('保存提醒规则开关失败', e);
  }
}

/** 从条目反推规则清单：同一条规则的所有实例合成一行，取最近的一次作为"下次" */
export function buildReminderRules(inputs: BuildInputs, items: ReminderItem[]): ReminderRule[] {
  const { assets, paymentPlans, daily } = inputs;
  const assetById = new Map<string, Asset>(assets.map((a) => [a.id, a]));
  const planById = new Map<string, PaymentPlan>(paymentPlans.map((p) => [p.id, p]));
  const nextByRule = new Map<string, Date>();
  const metaByRule = new Map<string, ReminderItem>();

  for (const item of items) {
    if (!metaByRule.has(item.ruleId)) metaByRule.set(item.ruleId, item);
    const prev = nextByRule.get(item.ruleId);
    if (!prev || item.at.getTime() < prev.getTime()) nextByRule.set(item.ruleId, item.at);
  }

  const out: ReminderRule[] = [];
  for (const [ruleId, sample] of metaByRule) {
    const next = nextByRule.get(ruleId) ?? null;
    const parts = ruleId.split('|');
    if (sample.source === 'credit') {
      const asset = assetById.get(parts[1]);
      const isStatement = parts[2] === 'statement';
      const day = isStatement ? asset?.statementDay : asset?.dueDay;
      out.push({
        id: ruleId,
        source: 'credit',
        label: sample.label,
        detailKey: isStatement ? 'reminder.ruleCreditStatement' : 'reminder.ruleCreditPayday',
        detailParams: { day: day ?? '' },
        nextAt: next,
      });
    } else if (sample.source === 'plan') {
      const plan = planById.get(parts[1]);
      const monthly = plan?.cycle === 'monthly' && typeof plan.dayOfMonth === 'number';
      out.push({
        id: ruleId,
        source: 'plan',
        label: sample.label,
        detailKey: monthly ? 'reminder.rulePlanMonthly' : 'reminder.rulePlanOther',
        detailParams: monthly ? { day: plan?.dayOfMonth ?? '' } : {},
        nextAt: next,
      });
    } else if (sample.source === 'daily') {
      out.push({
        id: ruleId,
        source: 'daily',
        label: '',
        detailKey: 'reminder.ruleDaily',
        detailParams: { hour: daily.dailyHour },
        nextAt: next,
      });
    } else {
      out.push({
        id: ruleId,
        source: 'monthEnd',
        label: '',
        detailKey: 'reminder.ruleMonthEnd',
        detailParams: {},
        nextAt: next,
      });
    }
  }

  // 每日记账是唯一"打开才产生实例"的规则：关着时也必须出现在清单里，否则用户没地方打开它
  if (!metaByRule.has('daily')) {
    out.push({
      id: 'daily',
      source: 'daily',
      label: '',
      detailKey: 'reminder.ruleDaily',
      detailParams: { hour: daily.dailyHour },
      nextAt: null,
    });
  }

  // 有下次的排前面（按时间），没有的（全被删光 / 还没打开）排后面
  return out.sort((a, b) => {
    if (a.nextAt && b.nextAt) return a.nextAt.getTime() - b.nextAt.getTime();
    if (a.nextAt) return -1;
    if (b.nextAt) return 1;
    return a.id.localeCompare(b.id);
  });
}
