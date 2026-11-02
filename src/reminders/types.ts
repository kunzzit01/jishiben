import type { Asset, PaymentPlan } from '../types';

/** 一条提醒的来源：决定列表里的图标与分区，也决定通知文案走哪套 i18n 键 */
export type ReminderSource = 'credit' | 'plan' | 'daily' | 'monthEnd';

/**
 * 统一提醒条目。
 *
 * 为什么文案只存「i18n 键 + 参数」而不是成品字符串：
 * 页面要显示、通知要排期，两处必须一字不差；同一个条目在切语言后也要跟着变。
 * 渲染发生在最后一刻（<AppText> 或 scheduleLocalNotification 之前）。
 */
export interface ReminderItem {
  /** 全局唯一键：删除记忆、去重、对账都靠它 */
  key: string;
  /**
   * 这条属于哪条"规则"（每月 5 号的还款日提醒 = 一条规则）。
   * 用户看到的是规则，系统里排的是这条规则的若干实例；开关按规则关。
   */
  ruleId: string;
  source: ReminderSource;
  /** 触发时刻 */
  at: Date;
  titleKey: string;
  titleParams: Record<string, string | number>;
  bodyKey?: string;
  bodyParams?: Record<string, string | number>;
  /** 列表副标题里的主体名（卡片名 / 计划名；每日与月末为空） */
  label: string;
  /** 计划付款的金额（渲染 body 时按当前小数位格式化，构建层不碰格式） */
  amount?: number;
}

export interface DailyPrefs {
  dailyEnabled: boolean;
  /** 本地小时 0-23 */
  dailyHour: number;
}

export interface BuildInputs {
  userId: string | null;
  assets: Asset[];
  paymentPlans: PaymentPlan[];
  daily: DailyPrefs;
  now: Date;
}

/** 信用卡：本来的排期键与文案原样保留（历史已排的通知不重复） */
export interface CreditLikeNode {
  key: string;
  assetName: string;
  at: Date;
  kind: 'statement' | 'payday';
  leadDays?: number;
}
