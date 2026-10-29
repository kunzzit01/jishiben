// interestRate.ts
// 信用卡「年利率(%)」的输入清洗与解析 —— AddAssetScreen（新建）与 AssetScreen（账户设置里改）
// 共用同一份实现，避免两处规则漂移。
//
// 为什么清洗返回字符串：中间态（"18." 之后还要敲 5）必须留住；空串 = 未设置。

/** 只留数字与一个小数点、最多两位小数、上限 100 */
export function sanitizeInterestRateInput(raw: string): string {
  let intPart = '';
  let decPart = '';
  let hasDot = false;
  for (const ch of raw) {
    if (ch >= '0' && ch <= '9') {
      if (!hasDot) intPart += ch;
      else if (decPart.length < 2) decPart += ch;
    } else if ((ch === '.' || ch === ',') && !hasDot) {
      hasDot = true;
    }
  }
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if (!intPart && !decPart) return '';
  const next = hasDot ? `${intPart}.${decPart}` : intPart;
  return Number(next) > 100 ? '100' : next;
}

/** 保存用：空 / 非法 → undefined（清空后必须让 interestRate 这个键消失，绝不能落成 0） */
export function parseInterestRate(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const num = Number(text);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : undefined;
}
