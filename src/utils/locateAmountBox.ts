// locateAmountBox.ts —— 用 OCR 的文字框，把「AI 读到的总金额」定位到原图上（0~1 归一化矩形）。
//
// 为什么不让模型直接给框：只有 qwen 系列会给可靠的像素坐标，而且慢（每张图 ~1100 图像 token，约 40 秒）；
// 换成更快的 gemma3:4b（~18 秒）后模型不再给框。OCR 的文字框是原图像素坐标、本来就有，足够用来「指给用户看」。
import type { OcrLine } from './receiptParse';

export interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const TOTAL_LABEL = /(total|jumlah|amount due|grand|balance|合计|总计|总额|总赖|应付|实付|小计|銀額|银额)/i;

/** 一行文字里的所有数字 token（去千分位逗号后的数值与原串） */
function numberTokens(text: string): { value: number; digits: string }[] {
  const out: { value: number; digits: string }[] = [];
  for (const m of text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
    const clean = m.replace(/,/g, '');
    const value = Number(clean);
    if (Number.isFinite(value)) out.push({ value, digits: clean.replace(/\.0+$/, '') });
  }
  return out;
}

/**
 * 在 OCR 行里找「最像总金额」的那一行并返回它的归一化框。
 * 评分：数值恰好等于金额 +3；数字串包含金额（如 OCR 读成 188 而 AI 说 88）+1；
 *       与「合计/TOTAL」标签同一水平带 +3；页面越靠下越优先（总额通常在票据下半部分）。
 * 找不到返回 null —— 宁可不画，也不画错位置。
 */
export function locateAmountBox(
  amount: number,
  lines: OcrLine[],
  imageWidth: number | null | undefined,
  imageHeight: number | null | undefined,
): NormalizedBox | null {
  if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0 || !Number.isFinite(amount)) return null;
  const want = String(Number(amount.toFixed(2)));
  const labels = lines.filter(
    (l) => TOTAL_LABEL.test(l.text) && l.top !== undefined && l.height !== undefined,
  );

  let best: { line: OcrLine; score: number } | null = null;
  for (const line of lines) {
    if (line.top === undefined || line.left === undefined || !line.width || !line.height) continue;
    let score = 0;
    for (const tok of numberTokens(line.text)) {
      if (Math.abs(tok.value - amount) < 0.005) score = Math.max(score, 3);
      else if (tok.digits.includes(want)) score = Math.max(score, 1);
    }
    if (score === 0) continue;
    const cy = line.top + line.height / 2;
    const lineH = line.height;
    if (labels.some((lb) => Math.abs(lb.top! + lb.height! / 2 - cy) < Math.max(lb.height!, lineH) * 1.6)) {
      score += 3;
    }
    score += (cy / imageHeight) * 0.9; // 越靠下越优先，但不压过「同带标签」
    if (!best || score > best.score) best = { line, score };
  }
  if (!best) return null;
  const l = best.line;
  const box: NormalizedBox = {
    x: l.left! / imageWidth,
    y: l.top! / imageHeight,
    w: l.width! / imageWidth,
    h: l.height! / imageHeight,
  };
  if (box.w <= 0 || box.h <= 0 || box.x < 0 || box.y < 0 || box.x + box.w > 1.02 || box.y + box.h > 1.02) return null;
  return box;
}
