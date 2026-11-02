// creditStatement.ts
// 信用卡账期计算（纯函数：不读全局状态、不写 storage、不依赖 React）。
//
// 为什么每个"某月第 N 天"都要先做短月裁剪：账单日/还款日放宽到 1–30 后，2 月没有 30 号——
// new Date(2026, 1, 30) 不报错，而是静默滚到 3 月 2 日，整个账期会跟着错一个月。
// 所以月份 + 日号不能分开生成，必须一起交给 clampDayToMonth 裁决。
//
// 时间一律用本地时区 Date（与全项目其它日期逻辑一致），返回的时刻都是当天 0 点。

/** 该月实际可用的日：day 超过当月天数时返回当月最后一天（含闰年 2 月 29） */
export function clampDayToMonth(year: number, monthIndex: number, day: number): number {
  // 下个月第 0 天 = 本月最后一天；monthIndex 传 -1 / 12 时 Date 会自动进位到相邻年份
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  // 下界压到 1：0 或负数会被 Date 解释成上个月的最后一天，静默跑到别的账期里
  return Math.max(1, Math.min(day, lastDay));
}

/** 某个月的账单日（0 点）；monthIndex 越界时会自动进位到相邻月份 */
export function statementDayInMonth(year: number, monthIndex: number, statementDay: number): Date {
  return new Date(year, monthIndex, clampDayToMonth(year, monthIndex, statementDay));
}

/** 该日期所属账单周期：close = 该日期当天或之前最近的账单日，start = 上一个账单日的次日（都是 0 点） */
export function periodForDate(date: Date, statementDay: number): { start: Date; close: Date } {
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  // 拿"日号"而不是整个 Date 做比较：入参通常带时分秒，比 Date 会把当天的账单日误判成已经过去
  const thisMonthCloseDay = clampDayToMonth(year, monthIndex, statementDay);
  const close =
    date.getDate() >= thisMonthCloseDay
      ? statementDayInMonth(year, monthIndex, statementDay)
      : statementDayInMonth(year, monthIndex - 1, statementDay);

  const prevClose = statementDayInMonth(close.getFullYear(), close.getMonth() - 1, statementDay);
  // 用年月日分量 +1 天：直接 getTime() + 86400000 在夏令时切换那天会偏一小时、落到前一天 23 点
  const start = new Date(prevClose.getFullYear(), prevClose.getMonth(), prevClose.getDate() + 1);

  return { start, close };
}

/** 到期日：dueDay 比账单日靠后就落在账单日同月，否则顺延到次月；两种情况同样做短月裁剪 */
export function dueDateFor(closeDate: Date, statementDay: number, dueDay: number): Date {
  // 相等时取次月：若取同月，还款日与账单日就是同一天，相当于没有免息期
  const sameMonth = dueDay > statementDay;
  return statementDayInMonth(closeDate.getFullYear(), closeDate.getMonth() + (sameMonth ? 0 : 1), dueDay);
}
