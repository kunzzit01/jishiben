// 财务规划-付款提醒 hook:
// 每天固定两个时间点(13:00 / 18:30)检查 7 天内到期的计划付款,发本地通知提醒。
// 只提醒"启用了计划但没开自动扣账"的——autoDeduct 开着的计划会自动入账,无需提醒。
// Expo Go 里通知模块不可用,scheduleLocalNotification 内部安静跳过。
import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { nextDueDate } from '../utils/paymentPlans';
import { scheduleLocalNotification } from '../utils/notifications';
import { formatMoney } from '../utils/formatMoney';

const REMINDER_HOURS = [13, 18.5]; // 13:00 和 18:30
const REMINDER_WINDOW_DAYS = 7;

export function usePaymentReminders() {
  const { paymentPlans, activeLedgerId, loading, decimalPlaces } = useApp();
  // 每轮检查的指纹:计划数据或检查时间点变化才重新调度,避免重复发通知
  const lastFingerprintRef = useRef('');

  useEffect(() => {
    if (loading) return;

    const checkAndSchedule = () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const plans = paymentPlans.filter((p) => p.ledgerId === activeLedgerId && p.active && !p.autoDeduct);
      if (plans.length === 0) return;

      // 指纹:计划数据 + 当前日期 + 当前时段(13:00/18:30 过后再变,允许重复提醒一次/时段)
      const now = new Date();
      const timeSlot = now.getHours() >= 18 ? '1830' : now.getHours() >= 13 ? '1300' : 'morning';
      const fingerprint = `${plans.length}|${plans.map((p) => `${p.id}:${p.lastProcessedDate ?? ''}`).join(',')}|${fmtDay(today)}|${timeSlot}`;
      if (lastFingerprintRef.current === fingerprint) return;
      lastFingerprintRef.current = fingerprint;

      plans.forEach((p) => {
        const next = nextDueDate(p, today);
        if (!next) return;
        const days = Math.round((next.getTime() - today.getTime()) / 86400000);
        if (days < 0 || days > 7) return;
        const trigger = new Date(next);
        trigger.setHours(9, 0, 0, 0); // 到期日早上 9:00 提醒
        if (trigger <= now) return;
        // 调度函数返回通知 id,但本 hook 不取消自己发的提醒(排期完就交给系统);
        // 它内部已兜底不会 reject,这里显式接管 Promise,不再把 Promise<string|null> 当成 void 丢掉
        scheduleLocalNotification(
          `${p.name} · ${days === 0 ? '今天' : `还有 ${days} 天`}到期`,
          `金额 ${formatMoney(p.amount, { decimals: decimalPlaces })},请确认付款计划。`,
          trigger
        ).catch(() => {});
      });
    };

    checkAndSchedule();
    // 每分钟轮询一次时钟,跨越 13:00 / 18:30 时触发检查
    const interval = setInterval(checkAndSchedule, 60000);
    return () => clearInterval(interval);
  }, [loading, paymentPlans, activeLedgerId, decimalPlaces]);
}

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}