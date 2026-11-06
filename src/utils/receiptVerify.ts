// receiptVerify.ts —— AI 草稿的程序校验（纯函数：无原生模块、无网络、可单独用 Node 跑）。
//
// 铁律：**AI 说的不算数，能落回 OCR 里某一行的文字和数字才算数**。
// 任何一项对不上就把该项置 null（宁可不填也不填错），并把原因写进 reason（日志/诊断用，界面不展示）。

import type { OcrLine } from './receiptParse';

/** 校验层只关心这几个字段：与 receiptAi.AiDraft 结构兼容，但不 import 它（避免把原生模块拖进纯函数/单测） */
export interface AiDraftInput {
  amount?: number | null;
  currency?: string | null;
  merchant?: string | null;
  date?: string | null;
  evidence?: { lineText?: string | null; valueInLine?: number | null } | null;
}

export interface VerifiedDraft {
  amount: number | null;
  currency: string | null;
  merchant: string | null;
  /** 归一化后的 YYYY-MM-DD */
  date: string | null;
  /** 人话诊断：哪项被采纳/丢弃、为什么（只做日志与排查） */
  reason: string;
}

// ── 归一化 / 数字解析（与 receiptParse 同一套规则，纯函数内自带一份，便于单测） ─────────

/** 去空白、转小写、去标点：只留字母/数字/汉字，用于「这句话确实出现在票上」的判断 */
function norm(text: unknown): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^0-9a-z\u4e00-\u9fff]/g, '');
}

/** 与 receiptParse.toNumber 一致：1,234,567 / 12,30 / 1.234.567 / 15.00 都要读对 */
function toNumber(raw: string): number | null {
  let s = raw.replace(/[^0-9.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(/,/g, '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const parts = s.split(',');
    const groupsOfThree = parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
    s = groupsOfThree ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** 一行里出现的所有数字（7,800 / 15.00 / 0.00 都能拆出来） */
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

function sameAmount(a: number, b: number): boolean {
  // 钱到分：15 与 15.00 视为同一个数
  return Math.round(a * 100) === Math.round(b * 100);
}

function truncate(text: string, max = 40): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// ── 标签 / 排除词 ────────────────────────────────────────────────────────────

/** 真正的最终应付标签（Sub Total 不算） */
const STRONG_TOTAL = /(rounded\s*total|rounding\s*total|grand\s*total|amount\s*due|total\s*due|balance\s*due|jumlah|实付|应付|实收|合计金额|总计)/i;
/** 弱标签：单纯的 Total（要排除 Sub Total） */
const WEAK_TOTAL = /total/i;
const SUBTOTAL = /(sub\s*-?\s*total|subtotal|小计)/i;

/** 绝不能当实付的行：付款方式/找零/单号/电话/日期/数量/积分… */
const EXCLUDE = /(cash|change|tendered|tunai|baki|kembali|refund|\bref\b|reference|document\s*no|invoice\s*no|receipt\s*no|transaction\s*no|no\.|\btel\b|\bphone\b|\bdate\b|\btime\b|\bqty\b|\bquantity\b|\bpoints?\b|单号|编号|流水|电话|数量|日期|单价)/i;
/** 付款/找零标记：右对齐金额列兜底的前提 */
const PAY_MARK = /(cash\s*change|change|tunai|baki|tendered|credit\s*card|debit\s*card|e-?wallet|ewallet|cash)/i;
/** 纯金额单元（不含任何文字） */
const PURE_AMOUNT = /^[¥￥$€£]?\s?[\d.,]+$/;

/** 该行是否写着最终应付（Sub Total / Subtotal 一律不算） */
function isFinalTotal(rowText: string): boolean {
  if (SUBTOTAL.test(rowText) && !STRONG_TOTAL.test(rowText)) return false;
  return STRONG_TOTAL.test(rowText) || WEAK_TOTAL.test(rowText);
}

// ── 版面：把 OCR 行按坐标并成视觉行 ──────────────────────────────────────────

interface Row {
  text: string;
  top: number;
  height: number;
  cells: { text: string; left: number; width: number }[];
  /** 这一行由哪些 OCR 行（原数组下标）拼成 */
  lineIndexes: number[];
}

/** 与 receiptParse.buildRows 同一套规则：纵向中心差小于行高的 60% 视为同一行 */
function buildRows(lines: OcrLine[]): Row[] {
  const hasCoords = lines.some((l) => typeof l.top === 'number' && typeof l.height === 'number');
  const items = lines
    .map((l, i) => ({
      i,
      text: String(l.text ?? '').trim(),
      top: typeof l.top === 'number' ? l.top : i,
      height: Math.max(1, typeof l.height === 'number' ? l.height : 12),
      left: typeof l.left === 'number' ? l.left : 0,
      width: typeof l.width === 'number' ? l.width : Math.max(1, String(l.text ?? '').length * 8),
    }))
    .filter((it) => it.text !== '');

  if (!hasCoords) {
    // 没有坐标：一行就是一行，右边缘是估算值 → 不做「右对齐金额列」判断
    return items.map((it) => ({
      text: it.text,
      top: it.i,
      height: 1,
      cells: [{ text: it.text, left: 0, width: it.width }],
      lineIndexes: [it.i],
    }));
  }

  const sorted = [...items].sort((a, b) => a.top - b.top || a.left - b.left);
  const groups: { cells: typeof sorted; top: number; height: number }[] = [];
  for (const item of sorted) {
    const centre = item.top + item.height / 2;
    const group = groups.find((g) => Math.abs(g.top + g.height / 2 - centre) <= Math.max(g.height, item.height) * 0.6);
    if (group) {
      group.cells.push(item);
      group.height = Math.max(group.height, item.height);
      group.top = Math.min(group.top, item.top);
    } else {
      groups.push({ cells: [item], top: item.top, height: item.height });
    }
  }

  return groups
    .sort((a, b) => a.top - b.top)
    .map((g) => {
      const cells = [...g.cells].sort((a, b) => a.left - b.left).map((c) => ({ text: c.text, left: c.left, width: c.width }));
      return {
        text: cells.map((c) => c.text).join(' '),
        top: g.top,
        height: g.height,
        cells,
        lineIndexes: g.cells.map((c) => c.i),
      };
    });
}

/** 证据行必须能在 OCR 里找到；返回它所在的视觉行 */
function findEvidenceRow(evidenceText: string, lines: OcrLine[], rows: Row[]): { rowIndex: number; row: Row } | null {
  const target = norm(evidenceText);
  if (target.length < 3) return null;
  let best = -1;
  // ① AI 照抄了某一行（含包含关系：AI 多带/少带标点都能对上）
  for (let i = 0; i < lines.length; i += 1) {
    const n = norm(lines[i]?.text);
    if (n.length < 3) continue;
    if (n.includes(target)) {
      best = i;
      break;
    }
  }
  // ② AI 把同一行的标签和金额拼成了一句：取被它整行包含的、最长的那一行
  if (best < 0) {
    let longest = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const n = norm(lines[i]?.text);
      if (n.length < 3 || n.length <= longest) continue;
      if (target.includes(n)) {
        best = i;
        longest = n.length;
      }
    }
  }
  if (best < 0) return null;
  const rowIndex = rows.findIndex((r) => r.lineIndexes.includes(best));
  if (rowIndex < 0) return null;
  return { rowIndex, row: rows[rowIndex] };
}

/**
 * 保守兜底：证据行是「纯金额」，且它与其它金额在右侧对齐成列、位于第一处付款标记之前、是列内最后一笔。
 * （与 receiptParse.extractAmountColumn 同一套条件：缺一不可）
 */
function isRightAlignedColumnLast(rowIndex: number, rows: Row[], hasCoords: boolean, valueInLine: number): boolean {
  if (!hasCoords) return false;
  const firstPay = rows.findIndex((r) => PAY_MARK.test(r.text));
  if (firstPay < 0 || rowIndex >= firstPay) return false;

  const rightOf = (c: { text: string; left: number; width: number }) =>
    c.left + Math.max(c.width, c.text.trim().length * 8);
  // 证据行里「就是 valueInLine 的那个纯金额单元」，它的右边缘决定列位置
  const amountCells = rows[rowIndex].cells.filter((c) => {
    const t = c.text.trim();
    if (!PURE_AMOUNT.test(t)) return false;
    const nums = numbersIn(t);
    return nums.length === 1 && sameAmount(nums[0], valueInLine);
  });
  if (amountCells.length === 0) return false;
  const targetRight = Math.max(...amountCells.map(rightOf));

  const aligned: number[] = [];
  rows.forEach((row, idx) => {
    if (idx >= firstPay) return;
    const hit = row.cells.some((c) => {
      const t = c.text.trim();
      if (!PURE_AMOUNT.test(t)) return false;
      if (numbersIn(t).length !== 1) return false;
      return Math.abs(rightOf(c) - targetRight) <= 12;
    });
    if (hit) aligned.push(idx);
  });
  if (aligned.length < 2) return false;
  // 列内最后一笔才算「合计」（与本地规则一致）
  return aligned[aligned.length - 1] === rowIndex;
}

// ── 币种 / 日期 ─────────────────────────────────────────────────────────────

const CURRENCY_CODES = ['MYR', 'SGD', 'CNY', 'USD', 'HKD', 'EUR', 'GBP', 'JPY', 'TWD', 'KRW', 'THB', 'VND', 'PHP', 'IDR', 'INR', 'AUD', 'NZD', 'CAD'];

/** 票面上出现什么，就只承认什么 */
const CURRENCY_EVIDENCE: Array<[RegExp, string]> = [
  [/\bRM\b/i, 'MYR'],
  [/\bMYR\b/i, 'MYR'],
  [/马来西亚|马币|令吉/i, 'MYR'],
  [/\bS\$\s?\d/i, 'SGD'],
  [/\bSGD\b/i, 'SGD'],
  [/新加坡|新币/i, 'SGD'],
  [/\bHK\$|\bHKD\b/i, 'HKD'],
  [/\bUS\$|\bUSD\b/i, 'USD'],
  [/\bA\$|\bAUD\b/i, 'AUD'],
  [/\bC\$|\bCAD\b/i, 'CAD'],
  [/\bNZD\b/i, 'NZD'],
  [/\bNT\$|\bTWD\b/i, 'TWD'],
  [/\bTHB\b|泰铢/i, 'THB'],
  [/\bIDR\b/i, 'IDR'],
  [/\bPHP\b/i, 'PHP'],
  [/\bVND\b|越南盾/i, 'VND'],
  [/\bINR\b/i, 'INR'],
  [/\bKRW\b/i, 'KRW'],
  [/\bEUR\b|€|欧元/i, 'EUR'],
  [/\bGBP\b|£|英镑/i, 'GBP'],
  [/\bJPY\b|日元|日圆/i, 'JPY'],
  [/\bCNY\b|\bRMB\b|¥|￥|人民币/i, 'CNY'],
];

const CURRENCY_ALIASES: Record<string, string> = {
  RM: 'MYR',
  RMB: 'CNY',
  'S$': 'SGD',
  'HK$': 'HKD',
  'US$': 'USD',
  'A$': 'AUD',
  'C$': 'CAD',
  'NT$': 'TWD',
  '¥': 'CNY',
  '￥': 'CNY',
  '€': 'EUR',
  '£': 'GBP',
};

/** AI 的币种写法统一成 ISO 码（RM → MYR）；认不出返回 null */
function normaliseCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  if (CURRENCY_ALIASES[s]) return CURRENCY_ALIASES[s];
  if (CURRENCY_CODES.includes(s)) return s;
  return null;
}

function supportedCurrencies(text: string): Set<string> {
  const out = new Set<string>();
  for (const [re, code] of CURRENCY_EVIDENCE) if (re.test(text)) out.add(code);
  return out;
}

function normaliseDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const year = y < 100 ? 2000 + y : y;
  if (year < 2000 || year > 2100) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function eachMatch(re: RegExp, text: string, fn: (m: RegExpExecArray) => void): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    fn(m);
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
}

/**
 * 文本里所有可能的日期（YYYY-MM-DD）。
 * 小票日期本身有歧义（04-09-2026 是 4 月 9 日还是 9 月 4 日），两种解释都收：
 * 校验只回答「这个日期在票面上有没有依据」，不做地区约定裁决。
 */
function dateCandidates(text: string): string[] {
  const out: string[] = [];
  const push = (y: number, m: number, d: number) => {
    const v = normaliseDate(y, m, d);
    if (v && !out.includes(v)) out.push(v);
  };
  eachMatch(/(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/g, text, (m) => push(+m[1], +m[2], +m[3]));
  eachMatch(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g, text, (m) => push(+m[1], +m[2], +m[3]));
  eachMatch(/(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(20\d{2})/g, text, (m) => {
    push(+m[3], +m[2], +m[1]);
    push(+m[3], +m[1], +m[2]);
  });
  eachMatch(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, text, (m) => push(new Date().getFullYear(), +m[1], +m[2]));
  return out;
}

// ── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 校验 AI 草稿。规则（缺一条就把该项置 null）：
 *  - evidence.lineText 必须能在 OCR 行里找到（归一化后比对，允许包含关系）
 *  - evidence.valueInLine 必须是证据行里出现的一个数字
 *  - draft.amount 必须等于 evidence.valueInLine
 *  - 证据行命中排除词（cash/change/tunai/baki/单号/电话/日期/数量…）→ amount = null
 *  - 证据行既没有最终应付标签、又不是「右对齐金额列最后一笔」→ amount = null（保守）
 *  - currency 只有票面文字支持才接受；merchant/date 各自独立校验
 */
export function verifyAiDraft(draft: AiDraftInput | null | undefined, lines: OcrLine[]): VerifiedDraft {
  const notes: string[] = [];
  const safeLines = (Array.isArray(lines) ? lines : []).filter((l) => l && typeof l.text === 'string');
  const allText = safeLines.map((l) => l.text).join('\n');
  const rows = buildRows(safeLines);
  const hasCoords = safeLines.some((l) => typeof l.top === 'number' && typeof l.height === 'number');

  // ── 金额（必须落回 OCR 的某一行）──────────────────────────────────────
  let amount: number | null = null;
  const evidenceLineText = typeof draft?.evidence?.lineText === 'string' ? draft.evidence.lineText : '';
  const rawValue = draft?.evidence?.valueInLine;
  const valueInLine = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;
  const draftAmount = typeof draft?.amount === 'number' && Number.isFinite(draft.amount) ? draft.amount : null;

  if (!draft) {
    notes.push('amount 置空：AI 没有返回草稿');
  } else if (draftAmount === null) {
    notes.push('amount 置空：模型自己给了 null');
  } else if (evidenceLineText.trim() === '') {
    notes.push('amount 置空：没有 evidence.lineText，无法回查 OCR');
  } else if (valueInLine === null) {
    notes.push('amount 置空：没有 evidence.valueInLine');
  } else if (!sameAmount(draftAmount, valueInLine)) {
    notes.push(`amount 置空：amount(${draftAmount}) 与 evidence.valueInLine(${valueInLine}) 不一致`);
  } else if (!(valueInLine > 0) || valueInLine >= 1000000) {
    notes.push(`amount 置空：${valueInLine} 不在合理金额范围`);
  } else {
    const hit = findEvidenceRow(evidenceLineText, safeLines, rows);
    if (!hit) {
      notes.push(`amount 置空：证据行「${truncate(evidenceLineText)}」在 OCR 里找不到`);
    } else if (!numbersIn(hit.row.text).some((n) => sameAmount(n, valueInLine))) {
      notes.push(`amount 置空：证据行「${truncate(hit.row.text)}」里没有 ${valueInLine} 这个数字`);
    } else if (EXCLUDE.test(hit.row.text)) {
      notes.push(`amount 置空：证据行「${truncate(hit.row.text)}」命中排除词（付款/找零/单号/日期/数量…）`);
    } else if (!isFinalTotal(hit.row.text) && !isRightAlignedColumnLast(hit.rowIndex, rows, hasCoords, valueInLine)) {
      notes.push(`amount 置空：证据行「${truncate(hit.row.text)}」既没有最终应付标签，也不是右对齐金额列`);
    } else {
      amount = valueInLine;
      notes.push(`amount 采纳 ${valueInLine}（证据行「${truncate(hit.row.text)}」）`);
    }
  }

  // ── 币种（只有票面文字支持才认）─────────────────────────────────────
  let currency: string | null = null;
  const wantedCurrency = normaliseCurrency(draft?.currency);
  if (typeof draft?.currency === 'string' && draft.currency.trim() !== '') {
    if (!wantedCurrency) {
      notes.push(`currency 置空：无法识别的币种「${truncate(draft.currency, 12)}」`);
    } else if (!supportedCurrencies(allText).has(wantedCurrency)) {
      notes.push(`currency 置空：OCR 文本里没有 ${wantedCurrency} 的依据`);
    } else {
      currency = wantedCurrency;
      notes.push(`currency 采纳 ${wantedCurrency}`);
    }
  }

  // ── 商家（必须出现在 OCR 文本里）─────────────────────────────────────
  let merchant: string | null = null;
  const rawMerchant = typeof draft?.merchant === 'string' ? draft.merchant.trim() : '';
  if (rawMerchant !== '') {
    const merchantNorm = norm(rawMerchant);
    if (merchantNorm.length < 2) {
      notes.push('merchant 置空：名称太短，无法核对');
    } else if (!norm(allText).includes(merchantNorm)) {
      notes.push(`merchant 置空：「${truncate(rawMerchant)}」不在 OCR 文本里`);
    } else {
      merchant = rawMerchant;
      notes.push(`merchant 采纳「${truncate(rawMerchant)}」`);
    }
  }

  // ── 日期（必须能在 OCR 文本里找到同一个日期）──────────────────────────
  let date: string | null = null;
  const rawDate = typeof draft?.date === 'string' ? draft.date.trim() : '';
  if (rawDate !== '') {
    const ocrDates = dateCandidates(allText);
    const matchedDate = dateCandidates(rawDate).find((d) => ocrDates.includes(d)) ?? null;
    if (!matchedDate) {
      notes.push(`date 置空：OCR 文本里找不到「${truncate(rawDate, 20)}」`);
    } else {
      date = matchedDate;
      notes.push(`date 采纳 ${matchedDate}`);
    }
  }

  return { amount, currency, merchant, date, reason: notes.join('；') };
}
