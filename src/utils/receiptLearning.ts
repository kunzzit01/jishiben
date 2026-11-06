// receiptLearning.ts —— 扫票的「本地学习」：不联网、只存本机。
//
// 两件事：
// 1) 用户确认过的金额标签（如 "Rounded Total (RM)"）→ 下次优先按它取金额；
// 2) 商户 → 分类：同一个商户下次扫直接把分类带上（比关键词更准）。
// 设计原则：只学「用户已经用行动确认过」的东西（保存成功才记录），不猜。
import AsyncStorage from '@react-native-async-storage/async-storage';

const LABELS_KEY = '@jizhang/receiptAmountLabels.v1';
const MERCHANT_CAT_KEY = '@jizhang/receiptMerchantCategory.v1';
const MAX_LABELS = 20;
const MAX_MERCHANTS = 200;

export interface MerchantCategoryHint {
  merchant: string;
  categoryId: string;
}

let labels: string[] | null = null;
let merchantMap: Record<string, string> | null = null;

function normaliseMerchant(merchant: string): string {
  return merchant.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
}

/** 取本机学到的金额标签（给解析器做最高优先级匹配） */
export async function getLearnedAmountLabels(): Promise<string[]> {
  if (labels) return labels;
  try {
    const raw = await AsyncStorage.getItem(LABELS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    labels = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    labels = [];
  }
  return labels;
}

/** 记录一次被用户确认的金额标签 */
export async function rememberAmountLabel(label: string | null | undefined): Promise<void> {
  const clean = (label ?? '').trim();
  if (clean.length < 4) return;
  const current = await getLearnedAmountLabels();
  const next = [clean, ...current.filter((l) => l.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_LABELS);
  labels = next;
  try {
    await AsyncStorage.setItem(LABELS_KEY, JSON.stringify(next));
  } catch {
    /* 学习失败不影响记账 */
  }
}

/** 商户 → 分类（本机记忆） */
export async function getMerchantCategory(merchant: string | null | undefined): Promise<string | null> {
  if (!merchant) return null;
  if (!merchantMap) {
    try {
      const raw = await AsyncStorage.getItem(MERCHANT_CAT_KEY);
      merchantMap = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      merchantMap = {};
    }
  }
  return merchantMap[normaliseMerchant(merchant)] ?? null;
}

/** 保存成功后记录「这个商户用了这个分类」 */
export async function rememberMerchantCategory(
  merchant: string | null | undefined,
  categoryId: string | null | undefined,
): Promise<void> {
  if (!merchant || !categoryId) return;
  await getMerchantCategory(merchant);
  const key = normaliseMerchant(merchant);
  const map = { ...(merchantMap ?? {}), [key]: categoryId };
  const keys = Object.keys(map);
  const trimmed = keys.length > MAX_MERCHANTS
    ? Object.fromEntries(keys.slice(keys.length - MAX_MERCHANTS).map((k) => [k, map[k]]))
    : map;
  merchantMap = trimmed;
  try {
    await AsyncStorage.setItem(MERCHANT_CAT_KEY, JSON.stringify(trimmed));
  } catch {
    /* 同上 */
  }
}
