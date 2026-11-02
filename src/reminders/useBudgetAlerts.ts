import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n/LanguageContext';
import { scheduleLocalNotification } from '../utils/notifications';
import { formatMoney } from '../utils/formatMoney';
import { buildBudgetAlerts, currentBudgetMonthKey, type BudgetAlert } from './budget';
import { loadFiredBudgetKeys, markBudgetAlertFired } from './budgetFired';

/**
 * 预算超支提醒（事件型）。
 *
 * 与排期型提醒的区别：它没有"未来某个时刻"，而是"当月花到 80%/100% 的那一刻"才成立，
 * 所以不预先排期、也不进排期映射，而是每次数据变化时算一遍，把当月还没提醒过的弹掉。
 * 弹的是立刻触发的本地通知（now + 3s）：本地通知只支持定时触发，没有立即展示的入口。
 */
export interface BudgetAlertsState {
  alerts: BudgetAlert[];
  dismiss: (key: string) => Promise<void>;
}

export function useBudgetAlerts(): BudgetAlertsState {
  const { budgets, transactions, assets, categories, currency, decimalPlaces } = useApp();
  const { user } = useAuth();
  const t = useT();
  const [fired, setFired] = useState<Set<string>>(new Set());

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
    void loadFiredBudgetKeys(monthPrefix).then(async (loaded) => {
      if (!alive) return;
      setFired(loaded);
      const fresh = allAlerts.filter((alert) => !loaded.has(alert.key));
      if (!fresh.length) return;
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
        await markBudgetAlertFired(alert.key);
        loaded = new Set([...loaded, alert.key]);
      }
      if (alive) setFired(new Set(loaded));
    });
    return () => {
      alive = false;
    };
  }, [allAlerts, monthPrefix, t, decimalPlaces]);

  const dismiss = useCallback(async (key: string) => {
    await markBudgetAlertFired(key);
    setFired((prev) => new Set(prev).add(key));
  }, []);

  const alerts = useMemo(() => allAlerts.filter((alert) => !fired.has(alert.key)), [allAlerts, fired]);

  return { alerts, dismiss };
}
