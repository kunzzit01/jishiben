#!/usr/bin/env node
// scripts/test-receipt-verify.mjs —— AI 草稿校验（receiptVerify）回归测试（纯本地，不需要 jest / 真机 / 模型）
//
// 用法：node scripts/test-receipt-verify.mjs
// 原理：用 npx tsc 把 src/utils/receiptVerify.ts 编译到 .tmp-receipt-verify/，再 import 断言。
// 目标：证明「AI 不能自证」——金额必须落回 OCR 的某一行、且那一行确实是最终应付，否则一律 null。
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const out = '.tmp-receipt-verify';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tscBin = join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tscBin, 'src/utils/receiptVerify.ts', '--outDir', out, '--module', 'es2022', '--target', 'es2022', '--skipLibCheck', '--ignoreConfig'], { stdio: 'inherit' });

const mod = await import(pathToFileURL(join(process.cwd(), out, 'receiptVerify.js')).href);
const { verifyAiDraft } = mod;

let failed = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (ok ? '' : '  expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual)));
}
function check(label, cond, extra = '') {
  if (!cond) failed += 1;
  console.log((cond ? '  PASS ' : '  FAIL ') + label + (cond ? '' : '  ' + extra));
}
function has(label, text, needle) {
  const ok = typeof text === 'string' && text.includes(needle);
  if (!ok) failed += 1;
  console.log((ok ? '  PASS ' : '  FAIL ') + label + (ok ? '' : '  reason=' + JSON.stringify(text)));
}

// ── 真机样本（CHEE YU STATIONERY）：标签与金额是不同的文字块，靠坐标成行 ───────────────
const cheeYu = [
  { text: 'Tax Invoice', top: 250, left: 120, width: 150, height: 22 },
  { text: 'Reprint Receipt', top: 285, left: 120, width: 170, height: 20 },
  { text: 'CHEE YU STATIONERY', top: 320, left: 90, width: 300, height: 30 },
  { text: '(202303069704)', top: 355, left: 180, width: 140, height: 20 },
  { text: 'Document No. : T01-036402', top: 470, left: 110, width: 300, height: 20 },
  { text: 'Date : 04-09-2026 01:46:20 PM', top: 495, left: 110, width: 320, height: 20 },
  { text: 'Tel : 017-756 1396', top: 545, left: 110, width: 220, height: 20 },
  { text: "A4 2'S CARD-WHITE 100'S L/STAR", top: 640, left: 110, width: 380, height: 20 },
  { text: '1 PKT *', top: 665, left: 130, width: 90, height: 20 },
  { text: '15.00', top: 665, left: 330, width: 60, height: 20 },
  { text: 'Sub Total (Ex) :', top: 720, left: 110, width: 190, height: 20 },
  { text: '15.00', top: 720, left: 400, width: 60, height: 20 },
  { text: 'Rounded Total (RM):', top: 830, left: 110, width: 230, height: 22 },
  { text: '15.00', top: 830, left: 400, width: 60, height: 22 },
  { text: 'Cash', top: 880, left: 110, width: 60, height: 20 },
  { text: '100.00', top: 880, left: 390, width: 70, height: 20 },
  { text: 'Cash Change', top: 905, left: 110, width: 130, height: 20 },
  { text: '85.00', top: 905, left: 395, width: 60, height: 20 },
];

// 同一行版本：标签和金额在一个文字块里
const cheeYuSameLine = [
  { text: 'Tax Invoice', top: 10, left: 10, width: 100, height: 20 },
  { text: 'CHEE YU STATIONERY', top: 40, left: 10, width: 300, height: 28 },
  { text: 'Document No. : T01-036402', top: 90, left: 10, width: 300, height: 20 },
  { text: 'Date : 04-09-2026 01:46:20 PM', top: 115, left: 10, width: 320, height: 20 },
  { text: 'Sub Total (Ex) : 15.00', top: 200, left: 10, width: 300, height: 20 },
  { text: 'Rounded Total (RM): 15.00', top: 240, left: 10, width: 330, height: 22 },
  { text: 'Cash 100.00', top: 280, left: 10, width: 200, height: 20 },
  { text: 'Cash Change 85.00', top: 305, left: 10, width: 220, height: 20 },
];

console.log('\n[1] 证据行与值一致（标签与金额分行，靠坐标成行）→ 全部采纳');
const v1 = verifyAiDraft(
  {
    amount: 15,
    currency: 'RM',
    merchant: 'CHEE YU STATIONERY',
    date: '2026-09-04',
    evidence: { lineText: 'Rounded Total (RM):', valueInLine: 15 },
  },
  cheeYu,
);
eq('[1] amount', v1.amount, 15);
eq('[1] currency（RM → MYR，票面有 RM）', v1.currency, 'MYR');
eq('[1] merchant', v1.merchant, 'CHEE YU STATIONERY');
eq('[1] date', v1.date, '2026-09-04');
has('[1] reason 记录采纳依据', v1.reason, '采纳');

console.log('\n[2] amount 与 evidence.valueInLine 不一致 → null');
const v2 = verifyAiDraft(
  { amount: 18.9, currency: 'MYR', merchant: null, date: null, evidence: { lineText: 'Rounded Total (RM):', valueInLine: 15 } },
  cheeYu,
);
eq('[2] amount', v2.amount, null);
has('[2] reason 说明不一致', v2.reason, '不一致');
const v2b = verifyAiDraft(
  { amount: 12, currency: null, merchant: null, date: null, evidence: { lineText: 'Rounded Total (RM):', valueInLine: 12 } },
  cheeYu,
);
eq('[2b] 证据行里没有 12 这个数字 → amount', v2b.amount, null);
has('[2b] reason 说明行内没这个数字', v2b.reason, '没有');

console.log('\n[3] 证据行是 Cash Change 85.00 → null（找零不是实付）');
const v3 = verifyAiDraft(
  { amount: 85, currency: 'MYR', merchant: null, date: null, evidence: { lineText: 'Cash Change 85.00', valueInLine: 85 } },
  cheeYuSameLine,
);
eq('[3] amount', v3.amount, null);
has('[3] reason 命中排除词', v3.reason, '排除词');

console.log('\n[4] 证据行是 Document No. T01-036402 → null（单号不是实付）');
const v4 = verifyAiDraft(
  { amount: 36402, currency: null, merchant: null, date: null, evidence: { lineText: 'Document No. : T01-036402', valueInLine: 36402 } },
  cheeYuSameLine,
);
eq('[4] amount', v4.amount, null);
has('[4] reason 命中排除词', v4.reason, '排除词');

console.log('\n[5] 证据行在 OCR 里不存在 → null（AI 编了一行）');
const v5 = verifyAiDraft(
  { amount: 99, currency: 'MYR', merchant: null, date: null, evidence: { lineText: 'Grand Total (RM): 99.00', valueInLine: 99 } },
  cheeYu,
);
eq('[5] amount', v5.amount, null);
has('[5] reason 说明找不到证据行', v5.reason, '找不到');

console.log('\n[6] 日期 / 商家不在 OCR 文本里 → 各自置 null（金额仍可采纳）');
const v6 = verifyAiDraft(
  {
    amount: 15,
    currency: 'MYR',
    merchant: 'UNIQLO',
    date: '2026-01-01',
    evidence: { lineText: 'Rounded Total (RM):', valueInLine: 15 },
  },
  cheeYu,
);
eq('[6] amount 仍采纳', v6.amount, 15);
eq('[6] merchant', v6.merchant, null);
eq('[6] date', v6.date, null);
has('[6] reason 说明商家不在文本里', v6.reason, 'merchant 置空');
has('[6] reason 说明日期不在文本里', v6.reason, 'date 置空');

console.log('\n[7] currency 不被票面文字支持（文本里没有 SGD）→ null');
const v7 = verifyAiDraft(
  { amount: 15, currency: 'SGD', merchant: null, date: null, evidence: { lineText: 'Rounded Total (RM):', valueInLine: 15 } },
  cheeYu,
);
eq('[7] amount 仍采纳', v7.amount, 15);
eq('[7] currency', v7.currency, null);
has('[7] reason 说明没有 SGD 依据', v7.reason, 'SGD');

console.log('\n[8] 没有 evidence → amount = null，但日期/商家能校验的仍然返回');
const v8 = verifyAiDraft(
  { amount: 15, currency: null, merchant: 'CHEE YU STATIONERY', date: '2026-09-04', evidence: null },
  cheeYu,
);
eq('[8] amount', v8.amount, null);
eq('[8] merchant', v8.merchant, 'CHEE YU STATIONERY');
eq('[8] date', v8.date, '2026-09-04');
has('[8] reason 说明缺证据', v8.reason, '没有 evidence');

console.log('\n[9] 无应付标签，但证据行是右对齐金额列的最后一笔 → 采纳（与本地规则同一条件）');
const columnReceipt = [
  { text: 'MY SHOP', top: 10, left: 10, width: 120, height: 20 },
  { text: 'Date 01/11/2026', top: 35, left: 10, width: 200, height: 20 },
  { text: 'Item A', top: 80, left: 10, width: 100, height: 20 },
  { text: '12.50', top: 80, left: 400, width: 60, height: 20 },
  { text: 'Item B', top: 105, left: 10, width: 100, height: 20 },
  { text: '4.40', top: 105, left: 405, width: 55, height: 20 },
  { text: 'Cash', top: 160, left: 10, width: 60, height: 20 },
  { text: '20.00', top: 160, left: 402, width: 58, height: 20 },
  { text: 'Change', top: 185, left: 10, width: 80, height: 20 },
  { text: '3.10', top: 185, left: 408, width: 52, height: 20 },
];
const v9 = verifyAiDraft(
  { amount: 4.4, currency: null, merchant: null, date: null, evidence: { lineText: '4.40', valueInLine: 4.4 } },
  columnReceipt,
);
eq('[9] amount', v9.amount, 4.4);
const v9b = verifyAiDraft(
  { amount: 12.5, currency: null, merchant: null, date: null, evidence: { lineText: '12.50', valueInLine: 12.5 } },
  columnReceipt,
);
eq('[9b] 列内不是最后一笔 → amount', v9b.amount, null);
has('[9b] reason 说明没有应付标签', v9b.reason, '既没有最终应付标签');

console.log('\n[10] 数量行 / 裸数字（无标签无付款标记）→ null');
const qtyReceipt = [
  { text: 'SOME SHOP', top: 10, left: 10, width: 120, height: 20 },
  { text: 'QTY 2', top: 40, left: 10, width: 80, height: 20 },
  { text: '15.00', top: 70, left: 300, width: 60, height: 20 },
];
const v10a = verifyAiDraft(
  { amount: 2, currency: null, merchant: null, date: null, evidence: { lineText: 'QTY 2', valueInLine: 2 } },
  qtyReceipt,
);
eq('[10a] 数量行 → amount', v10a.amount, null);
const v10b = verifyAiDraft(
  { amount: 15, currency: null, merchant: null, date: null, evidence: { lineText: '15.00', valueInLine: 15 } },
  qtyReceipt,
);
eq('[10b] 裸数字无标签无列 → amount', v10b.amount, null);

console.log('\n[11] 只有文字没有坐标时，带最终应付标签的行仍可采纳（马来语 JUMLAH）');
const textOnly = [{ text: 'RESTO MAKAN ENAK' }, { text: 'JUMLAH RM 18.90' }, { text: 'TUNAI RM 50.00' }, { text: 'BAKI RM 31.10' }];
const v11 = verifyAiDraft(
  { amount: 18.9, currency: 'RM', merchant: 'RESTO MAKAN ENAK', date: null, evidence: { lineText: 'JUMLAH RM 18.90', valueInLine: 18.9 } },
  textOnly,
);
eq('[11] amount', v11.amount, 18.9);
eq('[11] currency', v11.currency, 'MYR');
eq('[11] merchant', v11.merchant, 'RESTO MAKAN ENAK');
const v11b = verifyAiDraft(
  { amount: 31, currency: null, merchant: null, date: null, evidence: { lineText: 'BAKI RM 31.10', valueInLine: 31.1 } },
  textOnly,
);
eq('[11b] BAKI（找零）→ amount', v11b.amount, null);

console.log('\n[12] 空输入不炸：draft 为 null / 行数组为空');
const v12 = verifyAiDraft(null, cheeYu);
eq('[12] amount', v12.amount, null);
eq('[12] currency', v12.currency, null);
eq('[12] merchant', v12.merchant, null);
eq('[12] date', v12.date, null);
const v12b = verifyAiDraft({ amount: 15, currency: 'MYR', merchant: 'X', date: '2026-09-04', evidence: { lineText: 'Rounded Total (RM):', valueInLine: 15 } }, []);
eq('[12b] 没有任何 OCR 行 → amount', v12b.amount, null);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
process.exit(failed === 0 ? 0 : 1);
