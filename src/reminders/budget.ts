import type { Asset, Budget, Category, Transaction } from '../types';

/**
 * 预算提醒（事件型提醒：达到阈值才发，不预先排期）。
 *
 * 口径 —— 只统计与预算同币种的交易（用户 2026-11-02 拍定）：
 * 交易本身没有币种字段，币种来自它挂在的账户；没有账户（比如手工记的）就跟随全局设置。
 * 这样跨币种不会混算，永远不会把 1000 MYR 和 1000 JPY 加在一起。代价是外币消费不计入该预算。
 */
export type BudgetAlertLevel = 'near' | 'over';

export interface BudgetAlert {
  /** 每月每个（预算, 币种, 阈值）一条，用于"这个月已经提醒过"去重 */
  key: string;
  level: BudgetAlertLevel;
  /** 总预算或分类名，用于文案 */
  label: string;
  spent: number;
  limit: number;
  currency: string;
  /** 已用百分比（整数，四舍五入） */
  percent: number;
}

export interface BudgetAlertInputs {
  budgets: Budget[];
  transactions: Transaction[];
  assets: Asset[];
  categories: Category[];
  /** 全局货币（老预算/无账户交易跟随它） */
  defaultCurrency: string;
  now: Date;
}

const NEAR_THRESHOLD = 0.8;
const OVER_THRESHOLD = 1;

function monthPrefix(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function buildBudgetAlerts(inputs: BudgetAlertInputs): BudgetAlert[] {
  const { budgets, transactions, assets, categories, defaultCurrency, now } = inputs;
  const prefix = monthPrefix(now);
  const assetCurrency = new Map(assets.map((a) => [a.id, a.currency]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const monthExpenses = transactions.filter((tx) => tx.type === 'expense' && tx.date.startsWith(prefix));
  const alerts: BudgetAlert[] = [];

  for (const budget of budgets) {
    const limit = budget.amount;
    if (!Number.isFinite(limit) || limit <= 0) continue;
    const currency = budget.currency ?? defaultCurrency;
    const isTotal = budget.categoryId === 'total';

    const spent = monthExpenses.reduce((sum, tx) => {
      if (isTotal) {
        const c = (tx.assetId ? assetCurrency.get(tx.assetId) : undefined) ?? defaultCurrency;
        return c === currency ? sum + tx.amount : sum;
      }
      if (tx.categoryId !== budget.categoryId) return sum;
      const c = (tx.assetId ? assetCurrency.get(tx.assetId) : undefined) ?? defaultCurrency;
      return c === currency ? sum + tx.amount : sum;
    }, 0);

    const ratio = spent / limit;
    const level: BudgetAlertLevel | null = ratio >= OVER_THRESHOLD ? 'over' : ratio >= NEAR_THRESHOLD ? 'near' : null;
    if (!level) continue;

    alerts.push({
      key: `budget|${prefix}|${budget.categoryId}|${currency}|${level}`,
      level,
      label: isTotal ? 'total' : categoryName.get(budget.categoryId) ?? 'other',
      spent,
      limit,
      currency,
      percent: Math.round(ratio * 100),
    });
  }

  // 超支优先展示，其次按已用比例
  return alerts.sort((a, b) => (a.level === b.level ? b.percent - a.percent : a.level === 'over' ? -1 : 1));
}

/** 本月已提醒过的预算键（按月滚：换月自动清空，不用专门清理） */
export function currentBudgetMonthKey(now: Date): string {
  return monthPrefix(now);
}
