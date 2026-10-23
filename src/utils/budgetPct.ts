// budgetPct.ts
// 预算百分比的唯一口径：首页净资产卡的预算槽 + 月度预算抽屉（总预算卡 / 分类行）共用一份。
// 放在 utils 里是因为它被两个页面级组件共用，任何一方都不该反向依赖另一方。
//
// 语义（用户拍板）
// - ratio ≤ 1：百分比就是「进度」→ 标签 = Math.round(ratio*100)%（改造前的老写法，一字未改）；
// - ratio > 1：百分比不再是进度，改称「超支幅度」→ 标签 = −N%（N = 超出额度的百分点，
//   173% → −73%）；条**固定满格**、色调**固定 danger**，不随超支幅度变化；
// - 读屏不能用负号（会被念成「负七十三」）→ 超支读「超支 N%」（i18n: home.budgetOverBy）；
// - 1 < ratio < 1.005 时 N 会四舍五入成 0，标签写「−0%」是纯 bug 观感，用户会怀疑算错 →
//   退回 100% 口径（"刚好压线超一点点"视觉上与 100% 无差别），条仍满格 danger。
//
// 颜色与阈值不在这里另立一套：tone 直接复用 ui/ProgressBar 的 progressToneOf（65% / 90%），
// 条本身的 Math.min(ratio,1) 封顶也在 ProgressBar 里，本文件只给语义值。

import { progressToneOf, type ProgressTone } from '../components/ui/ProgressBar';
import type { TranslateFunction } from '../i18n';

/** 预算百分比的四件套（+ 是否超支），调用方不要再自己写百分比三元表达式 */
export type BudgetPctDisplay = {
  /** 屏幕标签：未超支 "67%"；超支 "−73%"；压线（1 < ratio < 1.005）→ "100%" */
  text: string;
  /** 读屏文本：**绝不含负号**；超支读「超支 73%」，其余与标签同字 */
  a11y: string;
  /** 条色：超支固定 danger，不随超支幅度变化 */
  tone: ProgressTone;
  /** 条填充比例：超支固定满格 1（ProgressBar 内部另有封顶，这里给的是语义值） */
  fillRatio: number;
  /** 是否超支（used > total）：需要给超支单独配色的地方用它，免得自己再判一次 */
  over: boolean;
};

/** U+2212 真负号（落在打包字体的 Latin-safe 区段，不会掉字形） */
const MINUS = '\u2212';

/** 已用 / 额度 → 标签文本 + 读屏文本 + 条色 + 条填充 + 是否超支 */
export function formatBudgetPct(used: number, total: number, t: TranslateFunction): BudgetPctDisplay {
  const raw = total > 0 ? used / total : 0;
  const ratio = Number.isFinite(raw) ? Math.max(0, raw) : 0;

  if (ratio > 1) {
    const overPct = Math.round((ratio - 1) * 100);
    // 压线超支：−0% 会让人以为算错，按 100% 报（条已满格 danger，视觉无差别）
    if (overPct === 0) return { text: '100%', a11y: '100%', tone: 'danger', fillRatio: 1, over: true };
    return {
      text: `${MINUS}${overPct}%`,
      a11y: t('home.budgetOverBy', { pct: overPct }),
      tone: 'danger',
      fillRatio: 1,
      over: true,
    };
  }

  const pct = Math.round(ratio * 100);
  return { text: `${pct}%`, a11y: `${pct}%`, tone: progressToneOf(ratio), fillRatio: ratio, over: false };
}
