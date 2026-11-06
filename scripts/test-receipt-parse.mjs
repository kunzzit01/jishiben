#!/usr/bin/env node
// scripts/test-receipt-parse.mjs —— 小票解析回归测试（纯本地，不需要 jest / 真机）
//
// 用法：node scripts/test-receipt-parse.mjs
// 原理：用 npx tsc 把 src/utils/receiptParse.ts 编译到 .tmp-receipt-parse/，再 import 断言。
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const out = '.tmp-receipt-parse';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tscBin = join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tscBin, 'src/utils/receiptParse.ts', '--outDir', out, '--module', 'es2022', '--target', 'es2022', '--skipLibCheck', '--ignoreConfig'], { stdio: 'inherit' });

const mod = await import(pathToFileURL(join(process.cwd(), out, 'receiptParse.js')).href);
const { parseReceiptLines, parseReceiptOcr } = mod;

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

// ── 真机样本（CHEE YU STATIONERY，Tax Invoice / Reprint Receipt）──────────────
// 真机 ML Kit 输出未采集；这里按「同一行」与「标签/金额分行」两种版式分别构造，
// 坐标用近似的版面数值（top/left/width/height），模拟 ML Kit TextLine.frame。
console.log('\n[1] 真机样本：标签与金额分行（Rounded Total (RM) 与 15.00 不同文字块）');
const cheeYuSplit = [
  { text: 'Tax Invoice', top: 250, left: 120, width: 150, height: 22 },
  { text: 'Reprint Receipt', top: 285, left: 120, width: 170, height: 20 },
  { text: 'CHEE YU STATIONERY', top: 320, left: 90, width: 300, height: 30 },
  { text: '(202303069704)', top: 355, left: 180, width: 140, height: 20 },
  { text: 'NO 34, JALAN TANJONG 2 TAMAN DESA CEMERLANG', top: 385, left: 100, width: 400, height: 20 },
  { text: 'Document No. : T01-036402', top: 470, left: 110, width: 300, height: 20 },
  { text: 'Date : 04-09-2026 01:46:20 PM', top: 495, left: 110, width: 320, height: 20 },
  { text: 'Tel : 017-756 1396', top: 545, left: 110, width: 220, height: 20 },
  { text: 'A4 2\'S CARD-WHITE 100\'S L/STAR', top: 640, left: 110, width: 380, height: 20 },
  { text: '1 PKT *', top: 665, left: 130, width: 90, height: 20 },
  { text: '15.00', top: 665, left: 330, width: 60, height: 20 },
  { text: 'Sub Total (Ex) :', top: 720, left: 110, width: 190, height: 20 },
  { text: '15.00', top: 720, left: 400, width: 60, height: 20 },
  { text: 'GST :', top: 745, left: 110, width: 60, height: 20 },
  { text: '0.00', top: 745, left: 400, width: 50, height: 20 },
  { text: 'Service Charge :', top: 770, left: 110, width: 160, height: 20 },
  { text: '0.00', top: 770, left: 400, width: 50, height: 20 },
  { text: 'Rounding Adjustment :', top: 795, left: 110, width: 210, height: 20 },
  { text: '0.00', top: 795, left: 400, width: 50, height: 20 },
  { text: 'Rounded Total (RM):', top: 830, left: 110, width: 230, height: 22 },
  { text: '15.00', top: 830, left: 400, width: 60, height: 22 },
  { text: 'Cash', top: 880, left: 110, width: 60, height: 20 },
  { text: '100.00', top: 880, left: 390, width: 70, height: 20 },
  { text: 'Cash Change', top: 905, left: 110, width: 130, height: 20 },
  { text: '85.00', top: 905, left: 395, width: 60, height: 20 },
];
const r1 = parseReceiptOcr(cheeYuSplit);
eq('[1] amount', r1.amount, 15);
eq('[1] currency', r1.currency, 'MYR');
eq('[1] date', r1.date, '2026-09-04');
eq('[1] merchant', r1.merchant, 'CHEE YU STATIONERY');
eq('[1] type', r1.type, 'expense');

console.log('\n[2] 真机样本：同一行（Rounded Total (RM): 15.00 一个文字块）');
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
const r2 = parseReceiptLines(cheeYuSameLine.map((l) => l.text));
eq('[2] amount', r2.amount, 15);
eq('[2] date', r2.date, '2026-09-04');
eq('[2] merchant', r2.merchant, 'CHEE YU STATIONERY');

console.log('\n[3] 通用规则：TOTAL / CASH / CHANGE');
const r3 = parseReceiptLines(['99 SPEED MART', 'TOTAL RM18.90', 'CASH RM50.00', 'CHANGE RM31.10']);
eq('[3] amount', r3.amount, 18.9);
eq('[3] currency', r3.currency, 'MYR');

console.log('\n[4] 马来语义：JUMLAH / TUNAI / BAKI');
const r4 = parseReceiptLines(['RESTO MAKAN ENAK', 'JUMLAH RM18.90', 'TUNAI RM50.00', 'BAKI RM31.10']);
eq('[4] amount', r4.amount, 18.9);
eq('[4] currency', r4.currency, 'MYR');

console.log('\n[5] 其它币种 + 信用卡付款仍是支出');
const r5 = parseReceiptLines(['書店 TWD', 'TOTAL TWD 7,800', 'CREDIT CARD 7,800']);
eq('[5] amount', r5.amount, 7800);
eq('[5] currency', r5.currency, 'TWD');
eq('[5] type', r5.type, 'expense');

console.log('\n[6] 只有日期/单号/电话/数量 → 金额必须留空');
const r6 = parseReceiptLines(['Date : 04-09-2026', 'Document No. : T01-036402', 'Tel : 017-756 1396', 'QTY 2']);
eq('[6] amount', r6.amount, null);
check('[6] confidence 低', r6.confidence <= 0.3, 'confidence=' + r6.confidence);

console.log('\n[7] 币种不一致（SGD 12.30，账户 MYR）→ 解析层返回 SGD，界面负责提示');
const r7 = parseReceiptLines(['CAFE BAR', 'TOTAL SGD 12.30']);
eq('[7] amount', r7.amount, 12.3);
eq('[7] currency', r7.currency, 'SGD');

console.log('\n[8] 只有裸数字（没有应付标签）→ null');
const r8 = parseReceiptLines(['SOME SHOP', '15.00', '100.00', '85.00']);
eq('[8] amount', r8.amount, null);

console.log('\n[9] 无应付标签，但有右对齐金额列 + 找零行 → 取列内最后一笔（保守兜底）');
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
const r9 = parseReceiptOcr(columnReceipt);
eq('[9] amount', r9.amount, 4.4);
check('[9] 置信度中等', r9.confidence > 0.3 && r9.confidence < 0.9, 'confidence=' + r9.confidence);

console.log('\n[10] 学到的金额标签优先（用户此前确认过 "Rounded Total (RM)"）');
const r10 = parseReceiptLines(['SHOP', 'Sub Total (Ex) : 20.00', 'Rounded Total (RM): 18.90', 'Cash 50.00'], {
  learnedLabels: ['Rounded Total (RM)'],
});
eq('[10] amount', r10.amount, 18.9);

console.log('\n[11] 没有付款行也没有标签 → null（不给瞎猜）');
const r11 = parseReceiptOcr([
  { text: 'NOTE', top: 10, left: 10, width: 60, height: 20 },
  { text: '12.50', top: 40, left: 300, width: 60, height: 20 },
]);
eq('[11] amount', r11.amount, null);

console.log('\n[12] 真机 OCR 变异：把 Reprint Receipt 读成 "Reprnt Receipt --" 也不能当店名');
const r12 = parseReceiptLines([
  'Tax Invoice', 'Reprnt Receipt --', 'CHEE YU STATIONERY', '(202303069704)',
  'Document No. : T01-036402', 'Date : 04-09-2026 01:46:20 PM',
  'Rounded Total (RM): 15.00', 'Cash 100.00', 'Cash Change 85.00',
]);
eq('[12] merchant', r12.merchant, 'CHEE YU STATIONERY');
eq('[12] amount', r12.amount, 15);

console.log('\n[13] 同一张票两次 OCR 变异，店名必须一致（结果稳定）');
const variants = [
  ['TAX INVOICE', 'Resit', 'KK MART JUTC', 'TOTAL RM17.90', 'CASH 20.00'],
  ['Tax  Invoice --', 'Res1t', 'KK MART JUTC', 'TOTAL RM17.90', 'CASH 20.00'],
  ['tax invoice', 'reprint receipt', 'KK MART JUTC', 'TOTAL RM17.90', 'CASH 20.00'],
];
const names = variants.map((v) => parseReceiptLines(v).merchant);
check('[13] 三次结果一致', new Set(names).size === 1, JSON.stringify(names));
eq('[13] merchant', names[0], 'KK MART JUTC');

console.log('\n[14] 电子钱包账单仍走标签式（Merchant 在下一行）');
const r14 = parseReceiptLines([
  'Details', '-RM17.90', 'Transaction Type  DuitNow QR', 'Merchant',
  'KK Mart JUTC', 'Payment Details  DuitNow QR - KK Mart JUTC',
  'Date/Time  03/11/2026 08:52:09', 'Status  Successful',
]);
eq('[14] merchant', r14.merchant, 'KK Mart JUTC');
eq('[14] amount', r14.amount, 17.9);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
process.exit(failed === 0 ? 0 : 1);
