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

console.log('\n[11] 没有标签、没有币种、没有日期（纯裸数字）→ null（不给瞎猜）');
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

console.log('\n[15] 透视抖动：Cash Change 的 85.00 被聚进 Rounded Total 那一行，仍必须是 15.00');
const skewed = [
  { text: 'Tax Invoice', top: 100, left: 100, width: 140, height: 22 },
  { text: 'CHEE YU STATIONERY', top: 150, left: 60, width: 320, height: 30 },
  { text: 'Sub Total (Ex) :', top: 400, left: 100, width: 190, height: 20 },
  { text: '15.00', top: 400, left: 420, width: 60, height: 20 },
  { text: 'Rounded Total (RM):', top: 460, left: 100, width: 230, height: 22 },
  { text: '15.00', top: 460, left: 420, width: 60, height: 22 },
  // 关键：85.00 的 y 与合计行几乎相同（透视/合并导致），但在最右边
  { text: 'Cash Change', top: 478, left: 100, width: 140, height: 20 },
  { text: '85.00', top: 462, left: 560, width: 60, height: 20 },
];
const r15 = parseReceiptOcr(skewed);
eq('[15] amount', r15.amount, 15);

console.log('\n[16] 同一张票扫两次（坐标抖动）结果必须一致');
const variant = skewed
  .map((l) => ({ ...l, top: l.top + (l.text === '85.00' ? 12 : 0) }))
  .map((l) => ({ ...l, top: l.top + (l.text === 'Rounded Total (RM):' ? -6 : 0) }));
eq('[16] 第一次', parseReceiptOcr(skewed).amount, 15);
eq('[16] 第二次', parseReceiptOcr(variant).amount, 15);

console.log('\n[17] 钱包账单：OCR 把「−」读成「–」或干脆丢掉，仍要取到 14.90（Apple Services）');
const apple1 = ['Details', '−RM14.90', '+14 points', 'Transaction Type  Payment', 'Merchant  Apple Services', 'Payment Method  eWallet Balance', 'Date/Time  02/11/2026 22:27:08', 'Status  Successful', 'Transaction No.  MLJWVFKHD6a0'];
eq('[17a] 全角减号', parseReceiptLines(apple1).amount, 14.9);
const apple2 = ['Details', '–RM14.90', '+14 points', 'Merchant  Apple Services', 'Payment Method  eWallet Balance'];
eq('[17b] en dash', parseReceiptLines(apple2).amount, 14.9);
const apple3 = ['Details', 'RM14.90', '+14 points', 'Merchant  Apple Services', 'Payment Method  eWallet Balance'];
eq('[17c] 符号丢失但有货币', parseReceiptLines(apple3).amount, 14.9);
eq('[17d] 商户', parseReceiptLines(apple3).merchant, 'Apple Services');

console.log('\n[18] 钱包账单但没有任何金额（只有单号/日期）→ null，不能瞎填');
const noAmount = ['Details', 'Merchant  Apple Services', 'Payment Method  eWallet Balance', 'Date/Time  02/11/2026 22:27:08', 'Transaction No.  MLJWVFKHD6a0', 'Wallet Ref  2026110210110000010000TNGOW3MY1'];
eq('[18] amount', parseReceiptLines(noAmount).amount, null);

console.log('\n[19] 标签全丢，但全票非噪声行只有一个金额且有币种 → 采用并标记低置信（界面要求核对）');
const onlyAmount = ['KEDAI ABC', 'Date 04-09-2026', 'RM 15.00', 'Terima kasih', 'Cash 100.00', 'Cash Change 85.00'];
const r19 = parseReceiptLines(onlyAmount);
eq('[19] amount', r19.amount, 15);
check('[19] 低置信', r19.confidence <= 0.6, 'confidence=' + r19.confidence);

console.log('\n[20] 两个不同的非噪声金额（有歧义）→ null');
const ambiguous = ['SHOP A', 'RM 15.00', 'RM 22.00', 'Date 04-09-2026'];
eq('[20] amount', parseReceiptLines(ambiguous).amount, null);

console.log('\n[21] 大字金额被 ML Kit 拆成两行：「−RM」+「14.90」');
const splitAmount = ['Details', '−RM', '14.90', '+14 points', 'Transaction Type  Payment', 'Merchant  Apple Services', 'Payment Method  eWallet Balance', 'Date/Time  02/11/2026 22:27:08'];
const r21 = parseReceiptLines(splitAmount);
eq('[21] amount', r21.amount, 14.9);
eq('[21] merchant', r21.merchant, 'Apple Services');

console.log('\n[22] 钱包详情页：金额字号远大于正文（40 vs 20），据此取金额');
const wallet = [
  { text: 'Details', top: 60, left: 200, width: 120, height: 20 },
  { text: '−RM14.90', top: 110, left: 30, width: 220, height: 44 },
  { text: '+14 points', top: 118, left: 430, width: 90, height: 18 },
  { text: 'Transaction Type', top: 200, left: 30, width: 160, height: 20 },
  { text: 'Payment', top: 200, left: 400, width: 100, height: 20 },
  { text: 'Merchant', top: 260, left: 30, width: 100, height: 20 },
  { text: 'Apple Services', top: 260, left: 380, width: 140, height: 20 },
  { text: 'Payment Method', top: 320, left: 30, width: 150, height: 20 },
  { text: 'eWallet Balance', top: 320, left: 360, width: 160, height: 20 },
  { text: 'Date/Time', top: 380, left: 30, width: 90, height: 20 },
  { text: '02/11/2026 22:27:08', top: 380, left: 330, width: 210, height: 20 },
  { text: 'Transaction No.', top: 500, left: 30, width: 140, height: 20 },
  { text: 'MLJWVFKHD6a0', top: 500, left: 380, width: 150, height: 20 },
];
const r22 = parseReceiptOcr(wallet);
eq('[22] amount', r22.amount, 14.9);
eq('[22] currency', r22.currency, 'MYR');
eq('[22] merchant', r22.merchant, 'Apple Services');

console.log('\n[23] 大字是店名（没有金额特征）→ 不能当金额');
const bigName = [
  { text: 'CHEE YU STATIONERY', top: 60, left: 40, width: 400, height: 48 },
  { text: 'Rounded Total (RM):', top: 200, left: 30, width: 230, height: 20 },
  { text: '15.00', top: 200, left: 420, width: 60, height: 20 },
];
eq('[23] amount', parseReceiptOcr(bigName).amount, 15);

console.log('\n' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
process.exit(failed === 0 ? 0 : 1);
