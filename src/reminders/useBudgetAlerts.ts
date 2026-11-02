import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { scheduleLocalNotification } from '../utils/notifications';
import { formatMoney } from '../utils/formatMoney';
import { buildBudgetAlerts, currentBudgetMonthKey, type BudgetAlert } from './budget';
import { loadBudgetMarks, markBudgetAlert } from './budgetFired';

/**
 * 预算超支提醒（事件型）：当月花到 80%/100% 的那一刻才成立，没有"未来时刻"可排，
 * 所以不进排期映射，而是数据一变就算一遍，把本月还没弹过的弹掉（now + 3s 的本地通知）。
 *
 * 两类记录分开存（见 budgetFired.ts）：已通知只影响"还弹不弹"，已删除才影响"还显示不显示"。
 */
export interface BudgetAlertsState {
  alerts: BudgetAlert[];
  dismiss: (key: string) => Promise<void>;
}

export function useBudgetAlerts(): BudgetAlertsState {
  const { budgets, transactions, assets, categories, currency, decimalPlaces } = useApp();
  const { user } = useAuth();
  const t = useT();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const allAlerts = useMemo(
    () =>
      user
        ? buildBudgetAlerts({ budgets, transactions, assets, categories, defaultCurrency: currency, now: new Date() })
        : [],
    [user, budgets, transactions, assets, categories, currency]
  );

  const monthPrefix = currentBudgetMonthKey(new Date());

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [notified, dismissedKeys] = await Promise.all([
        loadBudgetMarks(monthPrefix, 'n'),
        loadBudgetMarks(monthPrefix, 'd'),
      ]);
      if (!alive) return;
      setDismissed(dismissedKeys);

      const fresh = allAlerts.filter((alert) => !notified.has(alert.key));
      for (const alert of fresh) {
        const name = alert.label === 'total' ? t('reminder.budgetTotal') : alert.label;
        const title =
          alert.level === 'over'
            ? t('reminder.budgetOverTitle', { name, percent: alert.percent })
            : t('reminder.budgetNearTitle', { name, percent: alert.percent });
        const body = t('reminder.budgetBody', {
          spent: formatMoney(alert.spent, { decimals: decimalPlaces }),
          limit: formatMoney(alert.limit, { decimals: decimalPlaces }),
        });
        await scheduleLocalNotification(title, body, new Date(Date.now() + 3000));
        await markBudgetAlert(alert.key, 'n');
      }
    })();
    return () => {
      alive = false;
    };
  }, [allAlerts, monthPrefix, t, decimalPlaces]);

  const dismiss = useCallback(
    async (key: string) => {
      await markBudgetAlert(key, 'd');
      setDismissed((prev) => new Set(prev).add(key));
    },
    []
  );

  const alerts = useMemo(() => allAlerts.filter((alert) => !dismissed.has(alert.key)), [allAlerts, dismissed]);

  return { alerts, dismiss };
}
