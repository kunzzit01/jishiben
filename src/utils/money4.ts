/**
 * 金额定点工具（4 位小数，服务端 DECIMAL(19,4) 的口径）。
 *
 * 为什么需要它：
 * - 后端金额恒为 4 位小数的定点数（`23.5000`），JSON 里是十进制字面量；App 内部是 JS number。
 * - 浮点数不能用来做相等比较：`0.1 + 0.2 !== 0.3`。同步层判断"这行变了没有"必须走整数最小单位。
 *
 * 使用边界：只用于「与后端交换数据」的一层（推送前量化、拉取后归一化、镜像 diff 比较）。
 * 业务计算（余额累加、报表聚合）保持原样，不在本任务里改动。
 */

/** 金额小数位（后端 DECIMAL(19,4)）。 */
export const AMOUNT_SCALE = 4;
/** 汇率小数位（后端 DECIMAL(19,8)）。 */
export const RATE_SCALE = 8;

const POW10 = [1, 10, 100, 1000, 10000, 100000, 10000000, 100000000];

/** 按 half-up 量化到指定小数位；非有限值返回 0（调用方负责校验数据合法性）。 */
export function quantize(value: number, scale: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = POW10[scale] ?? Math.pow(10, scale);
  const sign = value < 0 ? -1 : 1;
  // Number.EPSILON 抵消 1.00005 * 10000 = 10000.499999999998 这类二进制误差
  return (sign * Math.round((Math.abs(value) * factor + Number.EPSILON))) / factor;
}

/**
 * 金额转整数最小单位（1e-4），只用于相等比较与稳定序列化。
 * 例：moneyUnits(23.5) === 235000。
 */
export function moneyUnits(value: number, scale = AMOUNT_SCALE): number {
  const factor = POW10[scale] ?? Math.pow(10, scale);
  const rounded = quantize(value, scale);
  return Math.round(rounded * factor);
}

/**
 * 金额的服务端字面量形式：`"23.5000"`。
 * 同步镜像用它做 diff——字符串相同即数值相同，绕开浮点比较。
 */
export function amountKey(value: number): string {
  const units = moneyUnits(value);
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  const whole = Math.floor(abs / 10000);
  const frac = String(abs % 10000).padStart(4, '0');
  return `${sign}${whole}.${frac}`;
}

/** 汇率的服务端字面量形式（8 位小数，用于镜像 diff）。 */
export function rateKey(value: number): string {
  const units = moneyUnits(value, RATE_SCALE);
  const sign = units < 0 ? '-' : '';
  const abs = Math.abs(units);
  const whole = Math.floor(abs / 100000000);
  const frac = String(abs % 100000000).padStart(8, '0');
  return `${sign}${whole}.${frac}`;
}

/**
 * 解析后端返回的金额/汇率：`"23.5000"`、`23.5000`、null。
 * 缺失或非法一律返回 undefined，让上层决定用不用兜底值。
 */
export function parseAmount(raw: unknown, scale = AMOUNT_SCALE): number | undefined {
  if (raw == null) return undefined;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return undefined;
  return quantize(n, scale);
}

/** 可选的金额字段归一化：null/undefined/非法 → undefined（表示服务端没有这个值）。 */
export function optionalAmount(raw: unknown): number | undefined {
  return parseAmount(raw, AMOUNT_SCALE);
}

/** 可选的汇率字段归一化（8 位小数）。 */
export function optionalRate(raw: unknown): number | undefined {
  return parseAmount(raw, RATE_SCALE);
}
