// receiptDedupe.ts —— 小票查重：同一张单子被扫两次时给出提示（本地、离线、无网络）。
//
// 思路来自开源项目 TeleBot 的 ocr_bill.py：把 OCR 全文去掉空格标点后做指纹；
// 再额外取「含数字的行」做行级指纹 —— 金额/时间/单号才是每张单子独有的部分，
// 模板行（收据/谢谢光临）不参与，避免两张不同的小票因为共用模板被判重复。
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@jizhang/receiptFingerprints.v1';
const MAX_RECORDS = 200;
/** 超过这个天数的旧指纹不再提示（避免同一家店同金额的常态消费被误判） */
const TTL_DAYS = 30;

interface FingerprintRecord {
  fp: string;
  /** 行级指纹（只有数字行），用于「模板相同但内容不同」的二次确认 */
  lineFps: string[];
  at: number;
}

let records: FingerprintRecord[] | null = null;
let hydration: Promise<void> | null = null;

function hash32(input: string): string {
  // FNV-1a 32bit：够用且无需引入加密库（React Native 没有 node:crypto）
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** 全文指纹：去掉空白/标点，只留字母数字与汉字 */
export function fingerprintText(rawText: string): string {
  const normalised = rawText.replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, '').toLowerCase();
  return normalised ? hash32(normalised) : '';
}

/** 行级指纹：只取含数字的行（金额/日期/单号），跳过模板行 */
export function lineFingerprints(rawText: string): string[] {
  const out: string[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    if (!/\d/.test(line)) continue;
    const normalised = line.replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, '').toLowerCase();
    if (normalised.length < 3) continue;
    out.push(hash32(normalised));
  }
  return out.slice(0, 12);
}

async function load(): Promise<FingerprintRecord[]> {
  if (records) return records;
  if (!hydration) {
    hydration = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        records = Array.isArray(parsed)
          ? (parsed as FingerprintRecord[]).filter((r) => r && typeof r.fp === 'string')
          : [];
      } catch {
        records = [];
      }
    })();
  }
  await hydration;
  return records ?? [];
}

async function persist(next: FingerprintRecord[]): Promise<void> {
  records = next.slice(0, MAX_RECORDS);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    /* 查重只是便利功能，写盘失败不影响记账 */
  }
}

export interface DuplicateCheck {
  duplicate: boolean;
  /** 上次扫描距今多少天（duplicate=true 时有值） */
  daysAgo?: number;
}

/** 扫描后调用：判断这张小票是不是最近扫过 */
export async function checkReceiptDuplicate(rawText: string): Promise<DuplicateCheck> {
  const fp = fingerprintText(rawText);
  if (!fp) return { duplicate: false };

  const list = await load();
  const now = Date.now();
  const ttlMs = TTL_DAYS * 86400000;
  const hit = list.find((r) => r.fp === fp && now - r.at < ttlMs);

  // 全文没命中时，再看「数字行」是否有 ≥3 条重叠（换了排版但内容还是同一单）
  let lineHit: FingerprintRecord | undefined;
  if (!hit) {
    const wanted = new Set(lineFingerprints(rawText));
    if (wanted.size >= 3) {
      lineHit = list.find((r) => {
        if (now - r.at >= ttlMs) return false;
        const overlap = r.lineFps.filter((x) => wanted.has(x)).length;
        return overlap >= Math.min(3, Math.ceil(wanted.size * 0.6));
      });
    }
  }

  const found = hit ?? lineHit;
  if (!found) return { duplicate: false };
  return { duplicate: true, daysAgo: Math.max(0, Math.round((now - found.at) / 86400000)) };
}

/** 保存成功后调用：把这张小票记进查重库 */
export async function rememberReceipt(rawText: string): Promise<void> {
  const fp = fingerprintText(rawText);
  if (!fp) return;
  const list = await load();
  const next = [
    { fp, lineFps: lineFingerprints(rawText), at: Date.now() },
    ...list.filter((r) => r.fp !== fp),
  ];
  await persist(next);
}
