// receiptNoteSuggestion.ts —— 扫票备注建议（纯函数：无原生依赖、无网络，可 Node 单测）。
//
// 只产出「建议文案」，永远不写进备注：界面把它做成「点击填入」的占位提示，
// 用户点备注框且备注为空时才填入，可改可删。
//
// 生成顺序（命中即停）：
// 1) 商品 1–2 项清楚 → 「购买 A、B」
// 2) 商品 ≥3 项 → 按类别概括（文具 / 食材 / 药品 / 日用品…）
// 3) 商品看不清但商户**高置信** → 「<商户名> 消费」
// 4) 都不行 → null
//
// 硬约束：收件人 / 单号 / 付款方式 / 找零 / 用途一律不进备注；文本总长 ≤ 30 字（超了截断加 …）。
//
// 实现说明：本文件**只有类型导入**（编译后无 import），版面行合并逻辑自带一份 ——
// 这样 scripts/test-receipt-note.mjs 用 tsc 单文件编译后能被 Node ESM 直接 import，
// 也不会因为改动 receiptParse 的成行逻辑影响它那套已经稳定的金额降级链。
import type { OcrLine } from './receiptParse';

export interface NoteSuggestionInput {
  /** OCR 行（本地或服务端；坐标可缺，缺坐标时一行就是一行） */
  lines: OcrLine[];
  /** 商户名（票据抬头或 Merchant 标签） */
  merchant?: string | null;
  /** 商户是否高置信（只有明确 Merchant 标签才算） */
  merchantConfident?: boolean;
  /** 本次扫票的最终金额：用来排除「单价大于合计」的找零/付款行 */
  amount?: number | null;
}

export interface NoteSuggestion {
  /** 建议备注；null 表示不建议（界面就不显示占位提示） */
  text: string | null;
  /** 诊断用：为什么给出/没给（单行，不进备注） */
  reason: string;
}

/** 备注文本硬上限（含省略号），界面「点击填入」那一行放得下 */
export const NOTE_MAX_LEN = 30;

// ── 版面行 ──────────────────────────────────────────────────────────────────
/** 同一行内的文字块按 left 升序 */
interface Cell {
  text: string;
  left: number;
  centerY: number;
  height: number;
}

interface Row {
  text: string;
  cells: Cell[];
}

/** 纵向中心差小于最大行高的 60% 视为同一行（与 receiptParse 的成行口径一致） */
function buildRows(lines: OcrLine[]): Row[] {
  const items = (lines ?? [])
    .filter((l) => l && typeof l.text === 'string' && l.text.trim())
    .map((l) => ({
      text: l.text.trim(),
      top: typeof l.top === 'number' ? l.top : 0,
      height: Math.max(1, typeof l.height === 'number' ? l.height : 12),
      left: typeof l.left === 'number' ? l.left : 0,
    }));
  const hasCoords = (lines ?? []).some(
    (l) => l && typeof l.top === 'number' && typeof l.height === 'number',
  );
  if (!hasCoords) {
    // 没有坐标：一行就是一行（纯文本模式）
    return items.map((it, i) => ({
      text: it.text,
      cells: [{ text: it.text, left: 0, centerY: i, height: 1 }],
    }));
  }
  const groups: Array<{ items: typeof items; top: number; height: number }> = [];
  for (const item of items) {
    const centre = item.top + item.height / 2;
    const row = groups.find(
      (r) => Math.abs(r.top + r.height / 2 - centre) <= Math.max(r.height, item.height) * 0.6,
    );
    if (row) {
      row.items.push(item);
      row.height = Math.max(row.height, item.height);
      row.top = Math.min(row.top, item.top);
    } else {
      groups.push({ items: [item], top: item.top, height: item.height });
    }
  }
  return groups
    .sort((a, b) => a.top - b.top)
    .map((r) => {
      const cells = [...r.items]
        .sort((a, b) => a.left - b.left)
        .map((c) => ({ text: c.text, left: c.left, centerY: c.top + c.height / 2, height: c.height }));
      return { text: cells.map((c) => c.text).join(' '), cells };
    });
}

// ── 金额单元 ────────────────────────────────────────────────────────────────
/** 一个单元是不是纯金额（RM15.00 / -17.90 / 88/=）：是则返回数值 */
function moneyValue(text: string): number | null {
  const spaced = text.replace(/(\d)\s*\.\s*(\d)/g, '$1.$2');
  const cleaned = spaced
    .replace(/[¥￥$€£]/g, '')
    .replace(/(RM|MYR|SGD|USD|TWD|HKD|THB|IDR|PHP|VND|CNY|RMB)(?=\s*\d)/gi, '')
    .replace(/^[+\-−–—－﹣]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\/=$/, '');
  if (!/^[\d.,]+$/.test(cleaned)) return null;
  let s = cleaned;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else if (s.includes(',') && !s.includes('.')) s = s.replace(/,/g, '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1e6 ? n : null;
}

/** 行里最后一个数字（「2 x 3.50 7.00」这类明细行取行末金额） */
function lastNumber(text: string): number | null {
  const hits = text.match(/[\d][\d.,]*\d|\d/g);
  if (!hits || hits.length === 0) return null;
  const v = moneyValue(hits[hits.length - 1]);
  return v;
}

// ── 噪声行（绝不进备注）────────────────────────────────────────────────────
/** 表格标题 / 地址 / 电话 / 单号 / 付款方式 / 找零 / 合计 / 税 / 折扣 / 日期 / 会员 */
const NOISE = new RegExp(
  // 积分/奖励/状态这类绝不能当商品（真机把 "+14 points" 当商品过）
  'point|积分|reward|cashback|bonus|status|successful|balance|余额|' +
  [
    // 表格标题
    '^(item|items|description|particulars|product|goods|qty|quantity|unit\\s*price|u\\.?price|price|amount|code|item\\s*code|no\\.?|bil\\.?|s/n|sn\\.?|#|商品|品名|名称|数量|单价|金额)(\\s|$)',
    // 地址
    '(\\b(jalan|taman|persiaran|street|road|avenue|lot\\b|postcode|poskod|kuala|selangor|penang|johor|perak|melaka|sabah|sarawak|\\bno\\.?\\s*\\d|\\bblock\\b|\\bfloor\\b|\\blevel\\b|地址))',
    // 电话
    '(\\b(tel|telephone|phone|hp|mobile|whatsapp|fax)\\b|\\b01\\d[- ]?\\d{3,4}[- ]?\\d{3,4}\\b|\\b0[3-9][- ]?\\d{3,4}[- ]?\\d{4}\\b)',
    // 单号 / 参考号
    '(document\\s*no|invoice\\s*no|receipt\\s*no|order\\s*no|bill\\s*no|ref\\b|reference|transaction\\s*no|tax\\s*no|gst\\s*no|\\btrx\\b|\\btxn\\b|单号|编号|流水)',
    // 付款方式 / 找零
    '(\\b(cash|tunai|credit|debit|visa|master|e-?wallet|ewallet|duitnow|qr\\s*pay|maybank|touch\\s*n\\s*go|change|baki|kembali|tendered|payment|bayaran|余额|找零|现金|刷卡)\\b)',
    // 合计 / 小计 / 税 / 折扣 / 舍入
    '(sub\\s*-?\\s*t[o0]ta[1li]|t[o0]ta[1li]|jumla[hj]|amount\\s*due|balance\\s*due|\\bgst\\b|\\bsst\\b|\\btax\\b|service\\s*charge|rounding|discount|voucher|小计|合计|总计|实付|应付|税额|折扣|优惠)',
    // 日期 / 时间 / 会员 / 收银员 / 终端
    '(\\b(date|time|tarikh|masa|member|cashier|terminal|kasir|staff|server)\\b|\\d{2}[-/.]\\d{2}[-/.]\\d{2,4}|\\d{1,2}:\\d{2})',
    // 票据类型抬头
    '(tax\\s*invoice|\\binvoice\\b|\\breceipt\\b|resit|repr[iy]?nt|cash\\s*bill|sales\\s*receipt|票据|小票)',
    // 收件人 / 用途（明确不进备注）
    '(收件人|收货人|收件地址|attn|ship\\s*to|deliver\\s*to|用途|备注|remark|note\\s*:)',
  ].join('|'),
  'i',
);

/** 去掉数量前缀（"2 x Kopi O" / "1 PKT *" / "3 pcs"） */
const QTY_PREFIX = /^\s*\d+(?:[.,]\d+)?\s*(?:x|×|@|pkt|pcs|pc|nos|unit|units|bag|box|btl|kg|g|ml|l|个|件|包|盒|瓶)?\s*[*:.\-]?\s*/i;

/** 单个数量单位（"1 PKT" / "2 pcs" 这类单元不是商品名） */
const UNIT_ONLY = /^(pkt|pck|pcs|pc|nos|unit|units|bag|box|btl|kg|g|ml|l|x|qty|quantity|个|件|包|盒|瓶)$/i;

function stripQty(text: string): string {
  return text.replace(QTY_PREFIX, '').replace(/[\s*:.,\-–—]+$/g, '').trim();
}

/** 单元/行文本 → 商品名：去掉数量前缀，纯数量单元一律返回空串 */
function nameOfCell(raw: string): string {
  const text = cleanText(raw);
  if (!text) return '';
  const stripped = stripQty(text);
  if (!stripped) return '';
  if (UNIT_ONLY.test(stripped)) return '';
  return stripped;
}

/** 名字里至少要有两个字母/汉字，否则不是商品名（"15.00"、"1 PKT" 都不算） */
function looksLikeName(text: string): boolean {
  return /[A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff'&./ ]*/.test(text) && (text.match(/[A-Za-z\u4e00-\u9fff]/g) ?? []).length >= 2;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ── 商品行抽取 ──────────────────────────────────────────────────────────────
interface NoteItem {
  name: string;
  money: number | null;
}

/** 把一行拆成「名称 + 右侧金额」；没有金额则 money=null */
function splitRow(row: Row): { name: string; money: number | null } {
  const cells = row.cells ?? [];
  if (cells.length >= 2) {
    let moneyIdx = -1;
    for (let i = cells.length - 1; i >= 0; i -= 1) {
      if (moneyValue(cells[i].text) !== null) {
        moneyIdx = i;
        break;
      }
    }
    if (moneyIdx >= 0) {
      const money = moneyValue(cells[moneyIdx].text);
      const parts: string[] = [];
      cells.forEach((c, i) => {
        if (i === moneyIdx) return;
        const name = nameOfCell(c.text);
        if (name) parts.push(name);
      });
      return { name: cleanText(parts.join(' ')), money };
    }
    // 多个单元但没有金额单元：整行当一个名字（明细行「2 x 3.50 7.00」走这里）
    const tail = lastNumber(row.text);
    const head = cleanText(row.text);
    if (tail !== null && /[A-Za-z\u4e00-\u9fff]/.test(head)) {
      return { name: nameOfCell(head), money: tail };
    }
    return { name: head, money: null };
  }

  const text = cleanText(row.text);
  // 单行版式：「Kopi O 2.50」/「A4 PAPER RM7.90」/ 只有金额
  const m = /^(.*?)[\s:]*((?:RM|MYR|S\$|SGD|US\$|USD|HK\$|HKD|\$|¥|￥)?\s*[+\-−–—－﹣]?\d[\d.,]*\d)\s*$/i.exec(
    text.replace(/(\d)\s*\.\s*(\d)/g, '$1.$2'),
  );
  if (m) {
    const money = moneyValue(m[2]);
    const name = nameOfCell(m[1] ?? '');
    if (money !== null) return { name, money };
  }
  return { name: text, money: null };
}

/** 整行就是一个付款方式（"Credit Card" / "CARD"）：只在整行匹配，避免误伤 "A4 2'S CARD-WHITE" 这类商品名 */
const PAYMENT_ONLY_ROW = /^(credit|debit|prepaid)?\s*card$/i;

function isNoiseRow(text: string, merchant: string | null): boolean {
  const s = cleanText(text);
  if (!s) return true;
  if (PAYMENT_ONLY_ROW.test(s)) return true;
  // 行尾是冒号、且行尾不是数字 → 一定是标签行（"Rounded T0tal (RM):" 这类 OCR 抖动也挡得住）
  if (/[:：]\s*$/.test(s) && !/\d\s*$/.test(s)) return true;
  if (NOISE.test(s)) return true;
  // 商户名/抬头出现在成品里没有意义（备注只写「买了什么」）
  if (merchant && merchant.length >= 3) {
    const m = merchant.toLowerCase();
    if (s.toLowerCase().includes(m) || m.includes(s.toLowerCase())) return true;
  }
  return false;
}

/** 抽商品项：同一行有名称+金额；或「名称行」紧跟「数量×单价=金额行」 */
function extractItems(rows: Row[], merchant: string | null, amount: number | null): NoteItem[] {
  const items: NoteItem[] = [];
  const seen = new Set<string>();
  let pending: { name: string; index: number } | null = null;

  const push = (name: string, money: number | null) => {
    const clean = nameOfCell(name);
    if (!clean || !looksLikeName(clean)) return;
    if (money !== null && amount !== null && money > amount + 0.005) return; // 找零/付款金额大于合计 → 不是商品
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name: clean, money });
  };

  rows.forEach((row, index) => {
    if (isNoiseRow(row.text, merchant)) {
      pending = null;
      return;
    }
    const { name, money } = splitRow(row);
    if (money === null) {
      // 纯名称行：等下一行的「数量×单价=金额」来配对（相邻才算）
      pending = name && looksLikeName(name) ? { name, index } : null;   // 名字已在 splitRow 里过了一遍 nameOfCell
      return;
    }
    if (name && looksLikeName(name)) {
      push(name, money);
      pending = null;
      return;
    }
    // 只有金额（或只有数量+金额）：与上一行名称配对
    if (pending && index - pending.index <= 1) {
      push(pending.name, money);
    }
    pending = null;
  });

  return items;
}

// ── 类别概括 ────────────────────────────────────────────────────────────────
/** 关键词表：命中即归到该类（顺序有讲究：文具/食材优先，日用品兜底） */
const ITEM_CATEGORIES: Array<[string, RegExp]> = [
  ['文具', /(stationery|文具|\bpaper\b|\bpen\b|\bpens\b|pencil|notebook|\bbook\b|eraser|marker|stapler|staple|\bfile\b|folder|toner|\bink\b|highlighter|ruler|\bclip\b|\bglue\b|\bcard\b|笔记本|订书|胶带|回形针|笔)/i],
  ['食材', /(\bjus\b|juice|krim|\bcream\b|makanan|\bfood\b|bread|roti|sayur|vegetable|fruit|buah|ayam|chicken|ikan|fish|\bmeat\b|daging|beras|\brice\b|telur|\begg\b|gula|sugar|tepung|flour|minyak|\boil\b|milk|susu|kopi|coffee|\btea\b|食材|蔬菜|水果|鸡蛋|大米|面条|猪肉|牛肉|鸡肉|鱼|牛奶|调料)/i],
  ['药品', /(pharmacy|clinic|medicine|panadol|paracetamol|tablet|kapsul|capsule|vitamin|bandage|\bmask\b|药|胶囊|软膏|口罩|消毒)/i],
  ['日用品', /(sabun|soap|shampoo|toothpaste|tissue|detergent|cleaner|battery|towel|日用|生活用品|grocery|\bmart\b|toilet|纸巾|毛巾|洗衣液|电池)/i],
];

function detectCategory(names: string[]): string {
  const hay = names.join('\n');
  for (const [name, re] of ITEM_CATEGORIES) {
    if (re.test(hay)) return name;
  }
  return '日用品';
}

// ── 对外入口 ────────────────────────────────────────────────────────────────
/** 超长截断：总长不超过 NOTE_MAX_LEN（含省略号） */
function clamp(text: string): string {
  const s = cleanText(text);
  return s.length <= NOTE_MAX_LEN ? s : s.slice(0, NOTE_MAX_LEN - 1) + '…';
}

/**
 * 生成备注建议（纯函数，绝不写库）。
 * 命中即停：1–2 项商品 → 3 项以上按类别 → 商户高置信 → null。
 */
export function buildNoteSuggestion(input: NoteSuggestionInput): NoteSuggestion {
  const amount =
    typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : null;
  const merchantText = cleanText(input.merchant ?? '');
  const merchant = merchantText ? merchantText : null;
  const rows = buildRows(input.lines ?? []);
  const items = extractItems(rows, merchant, amount);

  if (items.length === 1 || items.length === 2) {
    const names = items.map((i) => i.name);
    return {
      text: clamp('购买 ' + names.join('、')),
      reason: 'items-' + items.length + '（' + names.join(' / ') + '）',
    };
  }
  if (items.length >= 3) {
    const category = detectCategory(items.map((i) => i.name));
    return {
      text: clamp('采购' + category),
      reason: 'items-' + items.length + ' category=' + category,
    };
  }
  if (merchant && input.merchantConfident === true) {
    return { text: clamp(merchant + ' 消费'), reason: 'merchant-confident（商品看不清，商户高置信）' };
  }
  return {
    text: null,
    reason: items.length === 0 ? 'no-items（没识别出可读商品行）' : 'merchant-low（商品看不清且商户非高置信）',
  };
}
