// formatRate.ts —— 汇率「等式」的唯一展示口径（纯展示，不参与任何计算）。
//
// 内部 rate 的含义永远是「1 单位 from 换多少单位 to」，所以 rate < 1 时会变成 0.128205 这种小数。
// 这里翻成「把 ≥1 的一侧放左边」的人话：
//   rate 7.8（MYR→TWD）      → 「1 MYR = 7.8 TWD」
//   rate 0.128205（TWD→MYR） → 「7.8 TWD = 1 MYR」（1/rate = 1 单位 to 等于多少 from）
// 兑换页点 Reverse 后 from/to 与金额互换、rate 取倒数，等式左右自动镜像，不需要额外分支。
// 调用方：AddTransactionScreen（兑换输入区）、TransactionDetailScreen（账单详情）。
export function formatRateEquation(rate: number, from: string, to: string): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  const trim = (n: number) => {
    const s = n >= 1000 ? n.toFixed(0) : n >= 100 ? n.toFixed(1) : n >= 10 ? n.toFixed(2) : n.toFixed(4);
    return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  };
  return rate >= 1 ? `1 ${from} = ${trim(rate)} ${to}` : `${trim(1 / rate)} ${from} = 1 ${to}`;
}
