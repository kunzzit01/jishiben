// receiptParse.ts —— 小票/账单解析（纯函数：无原生依赖、无网络、无 API key）。
//
// 核心规则（2026-11-06 真机样本重写）：
// 1) 优先用 OCR 的**行内坐标**把「标签」和「金额」配成一行：左侧 Rounded Total (RM)、右侧 15.00。
//    坐标缺失时只在上下文明确时配对（标签行没数字 → 下一行是纯数字才认）。
// 2) 最终应付标签优先于小计：Rounded Total / Grand Total / Amount Due / Total / Jumlah / 实付 / 应付。
//    小计（Sub Total / Subtotal / 小计）只有找不到最终应付时兜底。
// 3) Cash / Cash Change / Tendered / Tunai / Baki / 单号 / 电话 / 日期 / 商品数量**永远**不是金额。
// 4) 只找到裸数字（没有任何应付标签）→ amount = null，交给界面提示用户手填；
//    日期/商家/分类识别成功**不**提高金额可信度。
// 5) 商家从抬头识别（Tax Invoice / Reprint Receipt / 付款方式等要排除）。
// 6) 币种随金额一起返回（RM → MYR），界面据此和账户币种比对。

export interface ParsedReceipt {
  amount: number | null;
  currency: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  type: 'expense' | 'income';
  /** 商户名（识别不出就是 null，界面可留空） */
  merchant: string | null;
  /** 商户名是否**高置信**：只有当票据里有明确的 Merchant/商户 标签时为 true。
   *  纸质小票的抬头猜测一律为 false —— 只用于提示，不能自动写进备注。 */
  merchantConfident?: boolean;
  /** 分类中文名建议（与 App 现有分类同名，未知则 null） */
  suggestedCategory: string | null;
  /** 0–1，**只反映金额**的可信度（日期/商户成功不会抬高它） */
  confidence: number;
  /** 金额由哪一档得出（诊断：final/subtotal/signed/large/cashline/column/unique/none） */
  amountTier?: string | null;
  /** 产生金额的那一行原文（用于本机学习「哪种标签是实付」） */
  amountLabel?: string | null;
  rawText: string;
}

/** OCR 的一行文字，带版面坐标（ML Kit TextLine.frame）。坐标缺失时传 undefined。 */
export interface OcrLine {
  text: string;
  /** 距图片顶部的像素 */
  top?: number;
  /** 距图片左侧的像素 */
  left?: number;
  width?: number;
  height?: number;
}

interface Row {
  text: string;
  top: number;
  height: number;
  /** 行内片段（按 left 升序）；没有坐标时只有一个片段 */
  cells: { text: string; left: number; width: number; centerY: number; height: number }[];
}

const CURRENCY_CODES = ['MYR', 'SGD', 'CNY', 'RMB', 'USD', 'HKD', 'EUR', 'GBP', 'JPY', 'TWD', 'KRW', 'THB', 'VND', 'PHP', 'IDR', 'INR', 'AUD', 'NZD', 'CAD'];
const CURRENCY_SYMBOLS: Array<[RegExp, string]> = [
  [/\bRM\s?\d/i, 'MYR'],
  [/\bRM\b/i, 'MYR'],
  [/\bMYR\b/i, 'MYR'],
  [/\bS\$\s?\d/i, 'SGD'],
  [/\bSGD\b/i, 'SGD'],
  [/\bHK\$\s?\d/i, 'HKD'],
  [/\bUS\$\s?\d/i, 'USD'],
  [/\bTWD\b|NT\$\s?\d/i, 'TWD'],
  [/\bTHB\b/i, 'THB'],
  [/\bIDR\b/i, 'IDR'],
  [/\bPHP\b/i, 'PHP'],
  [/\bVND\b/i, 'VND'],
  [/\bINR\b/i, 'INR'],
];
const CURRENCY_WORDS: Array<[RegExp, string]> = [
  [/马来西亚|马币|令吉/i, 'MYR'],
  [/新加坡|新币/i, 'SGD'],
  [/人民币/i, 'CNY'],
  [/美元|美金/i, 'USD'],
  [/港币|港元/i, 'HKD'],
  [/日元|日圆/i, 'JPY'],
  [/欧元/i, 'EUR'],
  [/英镑/i, 'GBP'],
  [/泰铢/i, 'THB'],
  [/越南盾/i, 'VND'],
  [/新台币|台币/i, 'TWD'],
];

/** 最终应付标签（优先级从高到低）。命中即视为「这就是要付的钱」。 */
const FINAL_TOTAL_LABELS: RegExp[] = [
  /(rounded\s*tota[1l]|rounding\s*tota[1l])/i,
  /(grand\s*tota[1l])/i,
  /(amount\s*due|tota[1l]\s*due|balance\s*due)/i,
  /(jumla[hj]|jumlha|实付|应付|应付金额|实收|合计金额|总计)/i,
  // 兜底：tota1 / TOTAL / TotaI 之类（OCR 会把 l 读成 1 或 I）
  /(tota[1li]\b|\btotal\b)/i,
];
/** 小计类：只有找不到最终应付时才兜底 */
const SUBTOTAL_LABELS: RegExp[] = [/(sub\s*-?\s*total|subtotal|小计)/i];
/** 绝不能当金额的行（付款方式、找零、税费、单号、日期、数量…） */
const NON_AMOUNT_LABEL = /(cash\s*change|cashchange|change|tendered|tunai|baki|kembali|余额|找零|gst|sst|tax|service\s*charge|rounding\s*adjust|discount|折扣|优惠|member|terminal|cashier|document\s*no|invoice\s*no|receipt\s*no|tel|phone|date|time|qty|quantity|unit\s*price|u\.?price|points?|ref\b|reference|wallet\s*ref|transaction\s*no|单号|编号|流水|数量|单价|电话|日期|时间)/i;
const PAYMENT_METHOD = /(cash|credit\s*card|debit\s*card|e-?wallet|ewallet|tunai|卡|现金)/i;

function toNumber(raw: string): number | null {
  let s = raw.replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // 两种符号都在：靠后的那个是小数点
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(/,/g, '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    const groupsOfThree = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    // 1,234,567 → 千分位；12,30 → 小数逗号
    s = groupsOfThree ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    // 1.234.567 → 千分位
    s = s.replace(/\./g, '');
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /\d[\d.,]*\d|\d/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = toNumber(m[0]);
    if (n !== null) out.push(n);
  }
  return out;
}

/** 把带坐标的 OCR 行合并成「版面行」：纵向中心差小于行高的 60% 视为同一行 */
function buildRows(lines: OcrLine[]): Row[] {
  const hasCoords = lines.some((l) => typeof l.top === 'number' && typeof l.height === 'number');
  if (!hasCoords) {
    return lines
      .map((l) => l.text.trim())
      .filter(Boolean)
      .map((text, i) => ({ text, top: i, height: 1, cells: [{ text, left: 0, width: text.length * 8, centerY: i, height: 1 }] }));
  }

  const items = lines
    .filter((l) => l.text && l.text.trim())
    .map((l) => ({
      text: l.text.trim(),
      top: l.top ?? 0,
      height: Math.max(1, l.height ?? 12),
      left: l.left ?? 0,
      width: l.width ?? Math.max(1, (l.text?.length ?? 1) * 8),
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const rows: Array<{ cells: typeof items; top: number; height: number }> = [];
  for (const item of items) {
    const centre = item.top + item.height / 2;
    const row = rows.find((r) => Math.abs(r.top + r.height / 2 - centre) <= Math.max(r.height, item.height) * 0.6);
    if (row) {
      row.cells.push(item);
      row.height = Math.max(row.height, item.height);
      row.top = Math.min(row.top, item.top);
    } else {
      rows.push({ cells: [item], top: item.top, height: item.height });
    }
  }

  return rows
    .sort((a, b) => a.top - b.top)
    .map((r) => {
      const cells = [...r.cells]
        .sort((a, b) => a.left - b.left)
        .map((c) => ({ text: c.text, left: c.left, width: c.width, centerY: c.top + c.height / 2, height: c.height }));
      return { text: cells.map((c) => c.text).join(' '), top: r.top, height: r.height, cells };
    });
}

function rowCurrency(row: Row): string | null {
  const text = row.text;
  const code = new RegExp('\\b(' + CURRENCY_CODES.join('|') + ')\\b', 'i').exec(text);
  if (code) {
    const c = code[1].toUpperCase();
    return c === 'RMB' ? 'CNY' : c;
  }
  for (const [re, cur] of CURRENCY_SYMBOLS) if (re.test(text)) return cur;
  for (const [re, cur] of CURRENCY_WORDS) if (re.test(text)) return cur;
  if (/[¥￥]/.test(text)) {
    if (/日元|日圆|JPY/i.test(text)) return 'JPY';
    if (/港币|港元|HKD/i.test(text)) return 'HKD';
    return 'CNY';
  }
  return null;
}

/**
 * 从一行里取与「合计标签」真正对应的金额。
 * 关键：按**与标签的垂直距离**选，而不是「最右边那个」。
 * 真机踩过：照片有透视，Cash Change 的 85.00 有时会被聚进 Rounded Total 那一行，
 * 取最右边就会把 85.00 当成实付（同一张票第一次 15.00、第二次 85.00）。
 */
function amountInRowAfterLabel(row: Row): number | null {
  const cells = row.cells;
  if (cells.length <= 1) {
    const nums = numbersIn(row.text);
    return nums.length ? nums[nums.length - 1] : null;
  }
  const isLabelCell = (t: string) =>
    FINAL_TOTAL_LABELS.some((re) => re.test(t)) || SUBTOTAL_LABELS.some((re) => re.test(t));
  const labelIdx = cells.findIndex((c) => isLabelCell(c.text));
  const labelCenter = labelIdx >= 0 ? cells[labelIdx].centerY : row.cells[0].centerY;

  const cands: { value: number; dy: number }[] = [];
  cells.forEach((cell, idx) => {
    if (idx === labelIdx) return;
    if (isLabelCell(cell.text)) return;
    if (NON_AMOUNT_LABEL.test(cell.text)) return;      // Cash Change 85.00 这类单元直接排除
    const v = moneyCellValue(cell.text) ?? (numbersIn(cell.text).length === 1 ? numbersIn(cell.text)[0] : null);
    if (v === null || v <= 0 || v >= 1e6) return;
    cands.push({ value: v, dy: Math.abs(cell.centerY - labelCenter) });
  });
  if (cands.length === 0) return null;
  cands.sort((a, b) => a.dy - b.dy);
  return cands[0].value;
}

/** 把「-RM17.90 / S$ 12.30 / ¥128.00 / 15.00」这类单元解析成数字；不是纯金额就返回 null */
function moneyCellValue(text: string): number | null {
  // 先把「42. 40」「42 .40」这类 OCR 空格拼回去，再看是不是纯金额
  const spaced = text.replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');
  const cleaned = spaced
    .replace(/[¥￥$€£]/g, '')
    // 注意：不能要求词边界 —— "RM17.90" 里 RM 与数字之间没有边界
    .replace(/(RM|MYR|SGD|USD|TWD|HKD|THB|IDR|PHP|VND|CNY|RMB)(?=\s*\d)/gi, '')
    // 数字前可能出现的各种减号/破折号（U+2212 / en dash / em dash / 全角）都要能吃
    .replace(/^[+\-−–—－﹣]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    // 马来小票的写法：88/= 表示 88.00
    .replace(/\/=$/, '');
  if (!/^[\d.,]+$/.test(cleaned)) return null;
  const nums = numbersIn(cleaned);
  return nums.length === 1 ? nums[0] : null;
}

/** 电子钱包账单：顶部那行带正负号的金额就是这笔交易的金额（无 total 标签） */
/** 只有货币符号/代码的行，例如 "−RM"、"RM"、"S$"、"¥" */
const CURRENCY_ONLY = /^\s*[+\-−–—－﹣]?\s*(RM|MYR|S\$|SGD|US\$|USD|HK\$|HKD|¥|￥|\$|€|£)\s*$/i;

function extractSignedTopAmount(rows: Row[]): AmountResult | null {
  const PAY = /(e-?wallet|ewallet|payment method|duitnow|qr|card|tunai|cash)/i;
  if (!rows.some((r) => PAY.test(r.text))) return null;
  const hits: { idx: number; value: number }[] = [];
  rows.slice(0, 6).forEach((row, idx) => {
    if (NON_AMOUNT_LABEL.test(row.text)) return;
    const signed = /^\s*[+\-−–—－﹣]\s*(?:[¥￥$€£]|RM|MYR|S\$|SGD|\d)/i.test(row.text.trim());
    // 没有符号也接受：钱包详情页的金额常是顶部第一行且带货币（− 可能被 OCR 丢掉）
    const currencyLed = /^\s*(?:[¥￥$€£]|RM\s?\d|MYR\s?\d|S\$\s?\d|SGD\s?\d)/i.test(row.text.trim());
    if (!signed && !currencyLed) return;
    for (const cell of row.cells) {
      const v = moneyCellValue(cell.text);
      if (v !== null && v > 0 && v < 100000) hits.push({ idx, value: v });
    }
  });
  // 只在全票顶部区域只有唯一一笔金额时采用（有歧义就不填）
  // 大字金额被拆成两行：「−RM」+「14.90」→ 跨行配对（符号行紧跟纯数字行）
  if (hits.length === 0) {
    for (let i = 0; i < Math.min(rows.length - 1, 6); i += 1) {
      if (!CURRENCY_ONLY.test(rows[i].text.trim())) continue;
      const next = rows[i + 1].text.trim();
      if (!/^[\d.,]+$/.test(next)) continue;
      const v = moneyCellValue(next);
      if (v === null || v <= 0 || v >= 1e6) continue;
      const currency = rowCurrency(rows[i]) ?? rows.map(rowCurrency).filter(Boolean)[0] ?? null;
      return { amount: v, currency, confidence: 0.7, label: rows[i].text + ' ' + next, tier: 'signed' };
    }
  }
  if (hits.length !== 1) return null;
  const currency = rowCurrency(rows[hits[0].idx]) ?? rows.map(rowCurrency).filter(Boolean)[0] ?? null;
  const hitRow = rows[hits[0].idx];
  const hasSign = /^\s*[+\-−–—－﹣]/.test(hitRow.text.trim());
  return { amount: hits[0].value, currency, confidence: hasSign ? 0.75 : 0.55, label: hitRow.text, tier: 'signed' };
}

function isMoneyShaped(text: string): boolean {
  return /[¥￥$€£]|\bRM\b|\bMYR\b|\bSGD\b|\bTWD\b|\bUSD\b|\bCNY\b|\bHKD\b|\d[\d.,]*\d/i.test(text);
}

interface AmountResult {
  amount: number | null;
  currency: string | null;
  /** 命中标签所在行原文 */
  label?: string | null;
  /** 哪一档得出的金额（诊断用：final/subtotal/signed/large/cashline/column/unique/none） */
  tier?: string;
  /** 0–1：只反映金额可信度 */
  confidence: number;
}

/**
 * 没有任何应付标签时的**保守**兜底：右对齐金额列。
 * 条件（缺一不可，宁可不填也不填错）：
 *   - 票据里出现付款/找零标记（cash / change / tunai / baki / card / ewallet）
 *   - 至少两个「纯金额」单元在右侧对齐成列（右边缘差 ≤ 12px）
 *   - 取该列中位于第一处付款标记之前的最后一笔
 */
/**
 * 最保守的兜底：全票「非噪声行」中只存在**唯一一个**金额值时采用它。
 * 证据强度低于标签配对，所以 confidence 只有 0.5，界面会提示「金额为推断，请核对」。
 * 有多笔不同金额（有歧义）一律返回 null —— 宁可留空也不填错。
 */
/**
 * 「大字金额」：把整页文字按行高（≈字号）排序，取明显大于其它文字的那一行。
 * 依据：钱包详情页与多数小票都把**实付金额**印成最大字号（微信/支付宝/TnG 全都如此）。
 * 只有当：
 *   - 该行（或紧邻的大字行）能解析出金额
 *   - 且它是全票**唯一**的超大字号金额
 * 才采用，confidence 0.7。
 */
function extractLargestTextAmount(rows: Row[]): AmountResult | null {
  const cells = rows.flatMap((r) => r.cells.map((c) => ({ ...c, row: r })));
  const heights = cells.filter((c) => c.text.trim().length > 0).map((c) => c.height).sort((a, b) => a - b);
  if (heights.length < 3) return null;
  const median = heights[Math.floor(heights.length / 2)];
  if (median <= 0) return null;

  const big = cells.filter((c) => c.height >= median * 1.5);
  if (big.length === 0) return null;

  const values: { value: number; label: string; row: Row }[] = [];
  for (let i = 0; i < big.length; i += 1) {
    const cell = big[i];
    const v = moneyCellValue(cell.text);
    if (v !== null && v > 0 && v < 1e6) {
      values.push({ value: v, label: cell.text, row: cell.row });
      continue;
    }
    // 大字被拆成「−RM」+「14.90」两块：
    if (CURRENCY_ONLY.test(cell.text.trim())) {
      const next = big[i + 1];
      if (next && Math.abs(next.centerY - cell.centerY) < cell.height * 1.2) {
        const nv = moneyCellValue(next.text);
        if (nv !== null && nv > 0 && nv < 1e6) {
          values.push({ value: nv, label: cell.text + ' ' + next.text, row: cell.row });
        }
      }
    }
  }
  const distinct = [...new Set(values.map((v) => v.value))];
  if (distinct.length !== 1) return null;   // 有多个大字金额 → 不猜
  const hit = values[0];
  const currency = rowCurrency(hit.row) ?? rows.map(rowCurrency).filter(Boolean)[0] ?? null;
  return { amount: hit.value, currency, confidence: 0.7, label: hit.label, tier: 'large' };
}

function extractUniqueMoney(rows: Row[]): AmountResult | null {
  const values = new Map<number, string>();   // 值 → 首次出现的行文本
  for (const row of rows) {
    if (NON_AMOUNT_LABEL.test(row.text)) continue;      // 找零/现金/单号/日期/数量行不算
    for (const cell of row.cells) {
      const v = moneyCellValue(cell.text);
      if (v === null || v <= 0 || v >= 1e6) continue;
      // 只认带小数的金额（避免把数量 1 / 2 当成金额）
      if (!/[.,]\d{2}\b/.test(cell.text.trim())) continue;
      if (!values.has(v)) values.set(v, row.text);
    }
  }
  if (values.size !== 1) return null;
  // 必须有票据语境：出现币种或日期，才认为这是「一张收据上的唯一金额」而不是截图里的一个裸数字
  const text = rows.map((r) => r.text).join('\n');
  const hasCurrency = rows.some((r) => rowCurrency(r) !== null);
  const hasDate = /(20\d{2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/.test(text);
  if (!hasCurrency && !hasDate) return null;
  const [value, rowText] = [...values.entries()][0];
  return {
    amount: value,
    currency: rowCurrency({ text: rowText, top: 0, height: 1, cells: [] }) ?? rows.map(rowCurrency).filter(Boolean)[0] ?? null,
    confidence: 0.5,
    label: rowText,
    tier: 'unique',
  };
}

/**
 * 无合计标签时：付款行（CASH / TUNAI / BAYAR / TENDERED / CARD）上的货币金额往往就是实付。
 * 例：马来自助小票只印「CASH RM42. 40」，没有 TOTAL。
 * 安全条件（缺一不可）：
 *   - 该行带货币标记（RM/…），且不是「找零」行
 *   - 它的值 ≥ 票面上其它所有货币金额（付款额不会是部分金额）
 *   - 这样的付款行只有一处
 */
function extractCashLineTotal(rows: Row[]): AmountResult | null {
  const PAY_LINE = /(\bcash\b|tunai|bayar|tendered|\bcard\b|credit|debit|nets|paywave)/i;
  const CHANGE = /(change|baki|kembali|找零)/i;
  const moneyRows: { row: Row; value: number }[] = [];
  for (const row of rows) {
    if (CHANGE.test(row.text)) continue;
    if (!rowCurrency(row)) continue;                       // 只要带货币标记的行
    for (const cell of row.cells) {
      const v = moneyCellValue(cell.text);
      if (v !== null && v > 0 && v < 1e6) moneyRows.push({ row, value: v });
    }
  }
  if (moneyRows.length === 0) return null;
  const rowIndex = new Map(rows.map((r, i) => [r, i]));
  const prevLooksPaid = (row: Row): boolean => {
    const idx = rowIndex.get(row) ?? -1;
    if (idx <= 0) return false;
    const prev = rows[idx - 1];
    const gap = row.top - (prev.top + prev.height);
    return gap <= Math.max(row.height, prev.height) * 1.6 && PAY_LINE.test(prev.text) && !CHANGE.test(prev.text);
  };
  const payRows = moneyRows.filter((m) => PAY_LINE.test(m.row.text) || prevLooksPaid(m.row));
  if (payRows.length === 0) return null;
  // 版面行可能把「CASH」与上一行的金额并在一起（透视/行高重叠），
  // 所以候选可能不止一个 —— 取其中**最大**的作为付款额，并要求它不小于票面其它金额。
  const pay = payRows.reduce((a, b) => (b.value > a.value ? b : a));
  const maxOther = Math.max(...moneyRows.map((m) => m.value));
  if (pay.value < maxOther) return null;
  return { amount: pay.value, currency: rowCurrency(pay.row), confidence: 0.55, label: pay.row.text, tier: 'cashline' };
}

function extractAmountColumn(rows: Row[]): AmountResult | null {
  const PAY = /(cash\s*change|change|tunai|baki|tendered|credit\s*card|debit\s*card|e-?wallet|ewallet|cash)/i;
  const firstPayRow = rows.findIndex((r) => PAY.test(r.text));
  if (firstPayRow < 0 && !rows.some((r) => PAY.test(r.text))) return null;

  interface Cand { rowIdx: number; value: number; right: number }
  const cands: Cand[] = [];
  rows.forEach((row, rowIdx) => {
    if (NON_AMOUNT_LABEL.test(row.text)) return;
    for (const cell of row.cells) {
      const t = cell.text.trim();
      const v = moneyCellValue(t);
      if (v === null) continue;
      if (v <= 0 || v >= 100000) continue;
      cands.push({ rowIdx, value: v, right: cell.left + Math.max(cell.width, t.length * 8) });
    }
  });
  if (cands.length < 2) return null;

  const columns = new Map<number, Cand[]>();
  for (const c of cands) {
    const key = Math.round(c.right / 12) * 12;
    const bucket = columns.get(key) ?? [];
    bucket.push(c);
    columns.set(key, bucket);
  }
  let best: Cand[] = [];
  for (const bucket of columns.values()) if (bucket.length > best.length) best = bucket;
  if (best.length < 2) return null;

  const before = best.filter((c) => firstPayRow < 0 || c.rowIdx < firstPayRow).sort((a, b) => a.rowIdx - b.rowIdx);
  const pool = before.length > 0 ? before : best;
  if (pool.length === 0) return null;
  const chosen = pool[pool.length - 1];
  const currency = rowCurrency(rows[chosen.rowIdx]) ?? rows.map(rowCurrency).filter(Boolean)[0] ?? null;
  return { amount: chosen.value, currency, confidence: 0.55, tier: 'column' };
}

function extractAmount(rows: Row[]): AmountResult {
  /** 这个数字在「找零/现金/单号/电话」行里也出现 → 说明很可能配错了 */
  const appearsInNoiseRow = (value: number, excludeRow: string): boolean =>
    rows.some((r) => r.text !== excludeRow && NON_AMOUNT_LABEL.test(r.text) && numbersIn(r.text).includes(value));

  const tryLabels = (labels: RegExp[], confidence: number): AmountResult | null => {
    // 命中多行时从**最后一个**往前试：每个候选依次尝试三种配对，第一个配到金额的就用它。
    // （真机教训：JUMLAH / TOTAL 同时出现时，只看最后一行会永远配不到金额）
    const matches: number[] = [];
    rows.forEach((row, idx) => {
      if (labels.some((re) => re.test(row.text))) matches.push(idx);
    });
    if (matches.length === 0) return null;

    const looksPureAmount = (text: string): number | null => {
      const t = text.trim();
      if (NON_AMOUNT_LABEL.test(t)) return null;
      const nums = numbersIn(t);
      if (nums.length !== 1) return null;
      const cleaned = t.replace(/[\s¥￥$€£]|\bRM\b|\bMYR\b|\bSGD\b|\bTWD\b/g, '');
      return /^[\d.,]+\/?=?$/.test(cleaned) ? nums[0] : null;
    };

    for (let k = matches.length - 1; k >= 0; k -= 1) {
      const idx = matches[k];
      const row = rows[idx];
      let amount = amountInRowAfterLabel(row);           // ① 同一行（右侧）
      let hitRow = row;
      if (amount === null) {
        const next = rows[idx + 1];                      // ② 下一行是纯金额
        if (next) {
          const v = looksPureAmount(next.text);
          if (v !== null) { amount = v; hitRow = next; }
        }
      }
      if (amount === null) {
        const prev = rows[idx - 1];                      // ③ 上一行是纯金额（手写单据：88 写在 TOTAL 上方）
        if (prev) {
          const v = looksPureAmount(prev.text);
          if (v !== null) { amount = v; hitRow = prev; }
        }
      }
      if (amount !== null && amount > 0 && amount < 1e6) {
        const currency = rowCurrency(row) ?? rowCurrency(hitRow) ?? rows.map(rowCurrency).filter(Boolean)[0] ?? null;
        return { amount, currency, confidence, label: row.text, tier: 'final' };
      }
    }
    // 有标签但配不到任何金额 → 金额留空（不猜）
    return { amount: null, currency: rowCurrency(rows[matches[matches.length - 1]]) ?? null, confidence: 0.2, tier: 'label-no-amount' };
  };

  const finalHit = tryLabels(FINAL_TOTAL_LABELS, 0.9);
  if (finalHit && finalHit.amount !== null) {
    if (!appearsInNoiseRow(finalHit.amount, finalHit.label ?? '')) return finalHit;
    // 与找零/现金同值 → 不可信，继续往下（小计 → 顶部符号金额 → 金额列 → null）
  }

  const subtotalHitRaw = tryLabels(SUBTOTAL_LABELS, 0.6);
  const subtotalHit = subtotalHitRaw ? { ...subtotalHitRaw, tier: 'subtotal' } : null;
  if (subtotalHit && subtotalHit.amount !== null) return subtotalHit;

  // 没有任何标签：电子钱包账单（顶部 -RM17.90 这种）优先，其次右对齐金额列
  const signedHit = extractSignedTopAmount(rows);
  if (signedHit) return signedHit;
  // 大字金额（钱包页/把小票把实付印得最大）优先于「右对齐列」—— 对齐在透视下很不可靠
  const largeHitEarly = extractLargestTextAmount(rows);
  if (largeHitEarly) return largeHitEarly;

  const cashLineHit = extractCashLineTotal(rows);
  if (cashLineHit) return cashLineHit;

  const columnHit = extractAmountColumn(rows);
  if (columnHit) return columnHit;

  // 最后一档：全票只有唯一一个非噪声金额（置信度低，界面会要求核对）
  const uniqueHit = extractUniqueMoney(rows);
  if (uniqueHit) return uniqueHit;

  // 没有任何应付标签 → 金额留空（裸数字不可信：可能是单号/电话/数量）
  const fallbackCurrency = rows.map(rowCurrency).filter(Boolean)[0] ?? null;
  return { amount: null, currency: fallbackCurrency, confidence: finalHit ? 0.2 : 0, tier: 'none' };
}

function normaliseDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function extractDate(text: string): string | null {
  let m = /(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/.exec(text);
  if (m) return normaliseDate(+m[1], +m[2], +m[3]);
  m = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/.exec(text);
  if (m) return normaliseDate(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(20\d{2})/.exec(text);
  if (m) return normaliseDate(+m[3], +m[2], +m[1]);
  m = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  if (m) return normaliseDate(new Date().getFullYear(), +m[1], +m[2]);
  return null;
}

/** 票据类型/付款方式等绝不当店名的行首词 */
const MERCHANT_STOP = /^(tax\s*invoice|invoice|reprint\s*receipt|receipt|resit|detailed\s*receipt|cash\s*bill|sales\s*receipt|credit\s*card|debit\s*card|cash|e-?wallet|payment|member|terminal|cashier|document\s*no|invoice\s*no|tel|phone|date|time|qty|gst|sst|total|jumlah|sub\s*total)\b/i;

/**
 * 抬头里的公司名。
 * 真机教训：ML Kit 会把 "Reprint Receipt" 读成 "Reprnt Receipt --"（少字母 + 尾部短横），
 * 只按正则前缀排除根本挡不住，而且同一张票每次 OCR 变异不同 → 备注每次都不一样。
 * 所以改成「模糊排除票据类型词 + 给候选打分选最优」，结果稳定且更像店名。
 */
const RECEIPT_WORDS = /(rece?[il1]?pt|repr[iy]?nt|invoice|resit|cash\s*bill|sales|tax|duitnow|payment|status|successful)/i;
const BUSINESS_WORDS = /(sdn\s*bhd|bhd|enterprise|trading|store|stationery|restaurant|restoran|mart|shop|market|supermarket|cafe|kopitiam|pharmacy|clinic|sdn|holdings|supply|services)/i;

function cleanMerchantText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\-–—_.,:;|]+$/g, '')   // 尾部 -- / 标点（OCR 噪声）
    .trim();
}

function looksLikeMerchant(text: string): boolean {
  const s = cleanMerchantText(text);
  if (s.length < 3 || s.length > 40) return false;
  if (MERCHANT_STOP.test(s)) return false;
  if (RECEIPT_WORDS.test(s)) return false;      // 模糊：Reprnt / Receipt / Reciept 都算
  if (NON_AMOUNT_LABEL.test(s)) return false;
  if (/\d{3,}/.test(s)) return false;
  if (/^[\d\W]+$/.test(s)) return false;
  if (/^[a-z0-9]{2,8}$/.test(s) && !/[aeiou]/.test(s)) return false;
  if (!/[A-Za-z\u4e00-\u9fff]/.test(s)) return false;
  return true;
}

/** 店名打分：全大写多词 + 企业词 + 合理长度 → 越高 */
function merchantScore(text: string): number {
  const s = cleanMerchantText(text);
  let score = 0;
  const words = s.split(' ').filter(Boolean);
  if (words.length >= 2) score += 2;
  const upperWords = words.filter((w) => /^[A-Z][A-Z0-9&.'-]*$/.test(w)).length;
  if (upperWords >= 2) score += 3;
  else if (upperWords === 1 && words.length === 1) score += 1;
  if (BUSINESS_WORDS.test(s)) score += 2;
  if (s.length >= 8 && s.length <= 32) score += 1;
  if (/\u4e00-\u9fff/.test(s)) score += 1;
  if (/[a-z]/.test(s) && upperWords === 0) score -= 1;   // 全小写的碎行要减分
  return score;
}

function extractMerchant(rows: Row[], amountRowIndex: number): { text: string | null; confident: boolean } {
  // ① 标签式：Merchant / 商户 / 商家 —— 同行的值或下一行（电子钱包账单都走这条）
  for (let i = 0; i < rows.length; i += 1) {
    const m = /^(merchant|商户|商家|店铺|收款方)\b[:：]?\s*/i.exec(rows[i].text.trim());
    if (!m) continue;
    const inline = rows[i].text.trim().slice(m[0].length).trim();
    for (const candidate of [inline, rows[i + 1]?.text ?? '']) {
      if (looksLikeMerchant(candidate)) return { text: cleanMerchantText(candidate), confident: true };
    }
  }
  // ② 抬头打分：金额行之前的所有候选里选分最高的（同分取更靠前的）
  const limit = amountRowIndex >= 0 ? amountRowIndex : Math.min(rows.length, 10);
  let best: { text: string; score: number } | null = null;
  for (let i = 0; i < limit; i += 1) {
    const s = cleanMerchantText(rows[i].text);
    if (!looksLikeMerchant(s)) continue;
    const score = merchantScore(s);
    if (!best || score > best.score) best = { text: s, score };
  }
  // 抬头猜测：**不算高置信**（纸质小票一律不给建议）
  return { text: best ? best.text : null, confident: false };
}

const INCOME_WORDS = /(收款|收入|转入|入账|到账|已收款|工资|salary|refund|退款|received)/i;
const EXPENSE_WORDS = /(支出|消费|已支付|支付成功|付款|转出|提现|debit|paid|purchase|payment)/i;

/** 店铺类型信号：比单品关键词更可靠 */
const STORE_CATEGORY: Array<[string, RegExp]> = [
  ['购物', /(apple\s?services|apple\s?store|app\s?store|itunes|icloud|stationery|文具|book\s?store|书店)/i],
  ['日用', /(supermarket|speedmart|speed mart|99 speed|grocery|giant|tesco|lotus|aeon|daiso|minimarket|便利店|超市)/i],
  ['餐饮', /(restoran|restaurant|mamak|kopitiam|cafe|coffee|bistro|kitchen|bakery|eatery|餐厅|饭店|茶餐室|咖啡)/i],
  ['交通', /(petronas|shell|petrol|caltex|bhp|gas station|油站|touch ?n ?go|parking|停车场)/i],
  ['医疗', /(pharmacy|clinic|hospital|guardian|watsons|药房|诊所|医院)/i],
];

const CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  ['餐饮', /(餐|饭|food|restaurant|cafe|coffee|kopitiam|mamak|makan|火锅|快餐|麦当劳|肯德基|星巴克)/i],
  ['蔬菜', /(蔬菜|青菜|菜市场|sayur|vegetable|grocer)/i],
  ['水果', /(水果|fruit|buah|苹果|orange|mango)/i],
  ['零食', /(零食|snack|chocolate|biscuit|ice cream|dessert|甜品)/i],
  ['烟酒', /(烟|酒|tobacco|wine|beer|liquor)/i],
  ['日用', /(日用|生活用品|mart\b|grocery)/i],
  ['购物', /(shopping|mall|store|shop|uniqlo|h&m|zalora|lazada|shopee|淘宝|京东|amazon|clothing|stationery|文具)/i],
  ['交通', /(打车|的士|grab|taxi|uber|petrol|parking|地铁|公交|bus|mrt|lrt|toll)/i],
  ['医疗', /(pharmacy|clinic|hospital|药房|诊所|医院)/i],
  ['娱乐', /(电影|cinema|movie|game|ktv|concert|netflix|spotify)/i],
  ['房租', /(房租|租金|rent|rental)/i],
  ['水电', /(电费|水费|utilities|electric|water bill|internet|wifi|broadband|话费)/i],
  ['工资', /(工资|薪水|salary|payroll|bonus)/i],
];

/** 这些档位即使 confidence 不低也不算可靠 —— 有服务端时应让它复核 */
export const WEAK_AMOUNT_TIERS = ['column', 'unique', 'cashline', 'signed', 'label-no-amount', 'none'];

export function isWeakAmountTier(tier: string | null | undefined): boolean {
  return !tier || WEAK_AMOUNT_TIERS.includes(tier);
}

/** 主入口（带坐标）：优先用版面坐标配对标签与金额 */
export interface ParseOptions {
  /** 用户此前确认过的金额标签（本机学习），命中即按最终应付处理 */
  learnedLabels?: string[];
}

export function parseReceiptOcr(lines: OcrLine[], options: ParseOptions = {}): ParsedReceipt {
  const rows = buildRows(lines);
  const text = rows.map((r) => r.text).join('\n');
  const learned = (options.learnedLabels ?? []).map((l) => l.trim().toLowerCase()).filter((l) => l.length >= 4);
  const learnedRow = learned.length
    ? rows.find((r) => learned.some((l) => r.text.toLowerCase().includes(l)))
    : undefined;
  const learnedHit: AmountResult | null = learnedRow
    ? { amount: amountInRowAfterLabel(learnedRow) ?? numbersIn(learnedRow.text).slice(-1)[0] ?? null, currency: rowCurrency(learnedRow), confidence: 0.95 }
    : null;
  const best = learnedHit && learnedHit.amount !== null ? learnedHit : extractAmount(rows);
  const { amount, currency, confidence } = best;

  const amountRowIndex = rows.findIndex((r) => FINAL_TOTAL_LABELS.some((re) => re.test(r.text)));
  const merchantHit = extractMerchant(rows, amountRowIndex);
  const merchant = merchantHit.text;
  const date = extractDate(text);

  let type: 'expense' | 'income' = 'expense';
  if (INCOME_WORDS.test(text) && !EXPENSE_WORDS.test(text)) type = 'income';

  let suggestedCategory: string | null = null;
  const haystack = `${merchant ?? ''}\n${text}`;
  for (const [name, re] of STORE_CATEGORY) {
    if (re.test(merchant ?? '') || re.test(text)) {
      suggestedCategory = name;
      break;
    }
  }
  if (!suggestedCategory) {
    for (const [name, re] of CATEGORY_KEYWORDS) {
      if (re.test(haystack)) {
        suggestedCategory = name;
        break;
      }
    }
  }

  return {
    amount,
    currency,
    date,
    type,
    merchant,
    suggestedCategory,
    merchantConfident: merchantHit.confident,
    confidence: Math.round(confidence * 100) / 100,
    amountLabel: best.label ?? null,
    amountTier: best.tier ?? null,
    rawText: text,
  };
}

/** 兼容入口（只有文字，没有坐标）：逐行当作版面行，配对更保守 */
export function parseReceiptLines(lines: string[], options: ParseOptions = {}): ParsedReceipt {
  return parseReceiptOcr(lines.map((text) => ({ text })), options);
}
