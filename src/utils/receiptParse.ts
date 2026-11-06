// receiptParse.ts —— 小票/账单截图**文本**解析（纯函数，无原生依赖、无网络、无 API key）。
//
// 输入：OCR 得到的一行行文字（顺序即阅读顺序）。输出：金额、币种、日期、收支方向、商户、分类建议。
// 规则来自真实收据/转账截图的结构特征：金额常在「合计/应付/实付/Total」附近，或带货币符号；
// 金额候选要排除手续费/余额/折扣/优惠这类干扰项。

export interface ParsedReceipt {
  amount: number | null;
  currency: string | null;
  /** YYYY-MM-DD */
  date: string | null;
  type: 'expense' | 'income';
  /** 商户名（识别不出就是 null，界面可留空） */
  merchant: string | null;
  /** 分类**中文名**建议（与 App 现有分类同名，未知则 null） */
  suggestedCategory: string | null;
  /** 0–1，规则推断的置信度：多信号一致时更高 */
  confidence: number;
  rawText: string;
}

const CURRENCY_CODES = ['MYR', 'SGD', 'CNY', 'RMB', 'USD', 'HKD', 'EUR', 'GBP', 'JPY', 'KRW', 'THB', 'VND', 'PHP', 'IDR', 'INR', 'AUD', 'NZD', 'CAD', 'TWD'];
const CURRENCY_WORDS: Array<[RegExp, string]> = [
  [/马来西亚|马币|令吉/i, 'MYR'],
  [/新加坡|新币/i, 'SGD'],
  [/人民币|元整/i, 'CNY'],
  [/美元|美金/i, 'USD'],
  [/港币|港元/i, 'HKD'],
  [/日元|日圆/i, 'JPY'],
  [/欧元/i, 'EUR'],
  [/英镑/i, 'GBP'],
  [/泰铢/i, 'THB'],
  [/越南盾/i, 'VND'],
];

/** 不是「这笔花了多少」的行：出现这些词时，同行的数字不作为金额候选 */
const AMOUNT_NOISE = /(手续费|服务费|小费|余额|找零|折扣|优惠|红包|积分|points?|税率|利率|运费|税|change|balance|tip|discount|tax|fee|ref\b|reference|wallet ref|transaction no|order|invoice|serial|卡号|账号|单号|编号|流水)/i;
/** 强金额标签：命中就优先 */
const AMOUNT_STRONG = /(合计|总计|总价|总额|应付|实付|实收|应付金额|付款金额|消费金额|金额|total|grand total|amount due|amount|subtotal|paid)/i;

const INCOME_WORDS = /(收款|收入|转入|入账|到账|已收款|工资|salary|refund|退款|received|credit)/i;
const EXPENSE_WORDS = /(支出|消费|已支付|支付成功|付款|转出|提现|debit|paid|purchase)/i;

/** 店铺类型信号：比单品关键词更可靠（超市里也可能买到水果） */
const STORE_CATEGORY: Array<[string, RegExp]> = [
  ['购物', /(apple\s?services|apple\s?store|app\s?store|itunes|icloud|apple pay|apple music|apple tv|google play|netflix|spotify)/i],
  ['日用', /(supermarket|speedmart|speed mart|99 speed|mart\b|grocery|giant|tesco|lotus|aeon|daiso|minimarket|便利店|超市)/i],
  ['餐饮', /(restoran|restaurant|mamak|kopitiam|cafe|coffee|bistro|kitchen|bakery|eatery|餐厅|饭店|茶餐室|咖啡)/i],
  ['交通', /(petronas|shell|petrol|caltex|bhp|gas station|油站|touch ?n ?go|parking|停车场)/i],
  ['医疗', /(pharmacy|clinic|hospital|guardian|watsons|药房|诊所|医院)/i],
].map(([n, re]) => [n, re] as [string, RegExp]);

/** 分类关键词 → App 里的中文分类名（命中即建议） */
const CATEGORY_KEYWORDS: Array<[string, RegExp]> = [
  ['餐饮', /(餐|饭|food|restaurant|cafe|coffee|kopitiam|mamak|restoran|makan|饮食|火锅|快餐|麦当劳|肯德基|星巴克|subway|mcdonald|kfc|starbucks)/i],
  ['蔬菜', /(蔬菜|青菜|菜市场|market vegetable|sayur|vegetable|grocer)/i],
  ['水果', /(水果|fruit|buah|苹果|orange|mango)/i],
  ['零食', /(零食|snack|chocolate|biscuit|candy|ice cream|dessert|甜品)/i],
  ['烟酒', /(烟|酒|tobacco|wine|beer|liquor|alcohol)/i],
  ['日用', /(日用|超市|supermarket|mart|grocery|tesco|lotus|99 speedmart|giant|aeon|daiso|生活用品)/i],
  ['购物', /(购物|shopping|mall|store|shop|uniqlo|h&m|zalora|lazada|shopee|淘宝|京东|amazon|衣服|clothing)/i],
  ['交通', /(交通|打车|的士|grab|taxi|uber|petrol|油站|petronas|shell|touch n go|tng|parking|停车|地铁|公交|bus|mrt|lrt|toll|过路费)/i],
  ['医疗', /(医院|诊所|药房|药品|pharmacy|clinic|hospital|medical|guardian|watsons|看诊)/i],
  ['娱乐', /(电影|cinema|movie|game|游戏|ktv|concert|netflix|spotify|订阅)/i],
  ['房租', /(房租|租金|rent|rental|management fee|物业)/i],
  ['水电', /(电费|水费|utilities|electric|water bill|tnb|syabas|internet|wifi|broadband|电话费|话费)/i],
  ['教育', /(学费|课程|tuition|course|book|书店|education)/i],
  ['工资', /(工资|薪水|salary|payroll|bonus|allowance)/i],
];

function toNumber(raw: string): number | null {
  // 去掉千分位与货币符号，兼容 1.234,56（欧洲写法）与 1,234.56
  let s = raw.replace(/[^0-9.,-]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function normaliseDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const year = y < 100 ? 2000 + y : y;
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function extractDate(lines: string[]): string | null {
  const text = lines.join(' ');
  // 2026-11-05 / 2026/11/5 / 2026.11.05
  let m = /(20\d{2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})/.exec(text);
  if (m) return normaliseDate(+m[1], +m[2], +m[3]);
  // 2026年11月5日
  m = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/.exec(text);
  if (m) return normaliseDate(+m[1], +m[2], +m[3]);
  // 05/11/2026（日/月/年）与 11/05/2026（月/日/年）：优先日/月/年（马来/欧洲常见）
  m = /(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(20\d{2})/.exec(text);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    // a>12 说明 a 是「日」；否则按 日/月 处理（马来收据多为 DD/MM/YYYY）
    return a > 12 ? normaliseDate(y, b, a) : normaliseDate(y, b, a);
  }
  // 只有 11月5日（补当前年）
  m = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text);
  if (m) return normaliseDate(new Date().getFullYear(), +m[1], +m[2]);
  return null;
}

function extractCurrency(text: string): string | null {
  const code = new RegExp('\\b(' + CURRENCY_CODES.join('|') + ')\\b', 'i').exec(text);
  if (code) return code[1].toUpperCase() === 'RMB' ? 'CNY' : code[1].toUpperCase();
  for (const [re, cur] of CURRENCY_WORDS) if (re.test(text)) return cur;
  if (/RM\s?\d/i.test(text)) return 'MYR';
  if (/S\$\s?\d/i.test(text)) return 'SGD';
  if (/HK\$\s?\d/i.test(text)) return 'HKD';
  if (/US\$\s?\d/i.test(text)) return 'USD';
  // ¥ 有歧义：上下文提到日元/日圆 → JPY，港币 → HKD，否则 CNY
  if (/[¥￥]/.test(text)) {
    if (/日元|日圆|JPY/i.test(text)) return 'JPY';
    if (/港币|港元|HKD/i.test(text)) return 'HKD';
    return 'CNY';
  }
  return null;
}

/** 从一行里挑数字（可能有多个，取最像金额的那个） */
function numbersIn(line: string): number[] {
  const out: number[] = [];
  const re = /\d[\d.,]*\d|\d/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const n = toNumber(m[0]);
    if (n !== null && n > 0) out.push(n);
  }
  return out;
}

function extractAmount(lines: string[]): { amount: number | null; strength: number } {
  // 评分规则（真实账单截图验证）：
  //   3 = 带货币符号/代码的行（RM14.90、¥128.00、SGD 12.30）
  //   2 = 带金额标签的行（Total / Amount / 金额 …）
  //   1 = 其它裸数字
  // 单号/参考号/积分/日期时间行一律跳过——它们动辄十几位，最容易被误当金额。
  const TIME_RE = /\b\d{1,2}[:：]\d{2}([:：]\d{2})?\b/;
  const DATE_RE = /\d{1,4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,4}/;
  let best: { amount: number; strength: number } | null = null;

  for (const line of lines) {
    if (AMOUNT_NOISE.test(line)) continue;
    if (TIME_RE.test(line) || DATE_RE.test(line)) continue;
    const hasMoney = /[¥￥$€£]|\bRM\s?\d|\bRM\b|\bMYR\b|\bSGD\b|\bUSD\b|\bCNY\b|\bHKD\b/i.test(line);
    const strong = AMOUNT_STRONG.test(line);
    const nums = numbersIn(line);
    if (nums.length === 0) continue;
    const value = nums[nums.length - 1];
    if (value <= 0 || value >= 100000) continue;
    const strength = hasMoney ? 3 : strong ? 2 : 1;
    if (!best || strength > best.strength || (strength === best.strength && value > best.amount)) {
      best = { amount: value, strength };
    }
  }
  return { amount: best?.amount ?? null, strength: best?.strength ?? 0 };
}
function extractMerchant(lines: string[]): string | null {
  for (const raw of lines.slice(0, 6)) {
    const line = raw.trim();
    if (line.length < 2 || line.length > 28) continue;
    if (/\d{3,}/.test(line)) continue;
    if (AMOUNT_STRONG.test(line) || AMOUNT_NOISE.test(line)) continue;
    if (/^(收据|小票|发票|订单|谢谢|欢迎|thank|receipt|invoice)/i.test(line)) continue;
    if (/(rm|myr|sgd|cny|usd|total|date|time|tel|电话|地址)/i.test(line)) continue;
    return line;
  }
  return null;
}

/** 主入口：把 OCR 行解析成记账需要的字段 */
export function parseReceiptLines(lines: string[]): ParsedReceipt {
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  const text = clean.join('\n');

  const { amount, strength } = extractAmount(clean);
  const currency = extractCurrency(text);
  const date = extractDate(clean);
  const merchant = extractMerchant(clean);

  let type: 'expense' | 'income' = 'expense';
  if (INCOME_WORDS.test(text) && !EXPENSE_WORDS.test(text)) type = 'income';

  let suggestedCategory: string | null = null;
  const haystack = `${merchant ?? ''}\n${text}`;
  // 店铺类型优先（超市小票里出现 APPLE 不应该被归成「水果」）
  for (const [name, re] of STORE_CATEGORY) {
    if (re.test(merchant ?? '') || re.test(text)) {
      suggestedCategory = name;
      break;
    }
  }
  for (const [name, re] of CATEGORY_KEYWORDS) {
    if (suggestedCategory) break;
    if (re.test(haystack)) {
      suggestedCategory = name;
      break;
    }
  }

  const confidence = Math.min(
    1,
    (amount !== null ? 0.5 : 0) + (strength >= 3 ? 0.2 : strength === 2 ? 0.1 : 0) + (date ? 0.15 : 0) + (suggestedCategory ? 0.15 : 0),
  );

  return { amount, currency, date, type, merchant, suggestedCategory, confidence: Math.round(confidence * 100) / 100, rawText: text };
}
