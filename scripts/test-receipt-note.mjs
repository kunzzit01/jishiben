#!/usr/bin/env node
// scripts/test-receipt-note.mjs —— 扫票备注建议（receiptNoteSuggestion）回归测试（纯本地）
//
// 用法：node scripts/test-receipt-note.mjs
// 原理：用 npx tsc 把 src/utils/receiptNoteSuggestion.ts 编译到 .tmp-receipt-note/，再 import 断言。
// 目标：证明「建议只认商品行」——单号/找零/电话/表格标题/总数行都不能进备注，
// 并且 1–2 项写法、≥3 项类别概括、商户兜底、超长截断都按约定工作。
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const out = '.tmp-receipt-note';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const tscBin = join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tscBin, 'src/utils/receiptNoteSuggestion.ts', '--outDir', out, '--module', 'es2022', '--target', 'es2022', '--skipLibCheck', '--ignoreConfig'], { stdio: 'inherit' });

const mod = await import(pathToFileURL(join(process.cwd(), out, 'receiptNoteSuggestion.js')).href);
const { buildNoteSuggestion, NOTE_MAX_LEN } = mod;

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

// ── 真机版式：CHEE YU STATIONERY（Tax Invoice / Reprint Receipt，抬头+地址+单号+电话）──
const header = [
  { text: 'Tax Invoice', top: 250, left: 120, width: 150, height: 22 },
  { text: 'Reprint Receipt', top: 285, left: 120, width: 170, height: 20 },
  { text: 'CHEE YU STATIONERY', top: 320, left: 90, width: 300, height: 30 },
  { text: '(202303069704)', top: 355, left: 180, width: 140, height: 20 },
  { text: 'NO 34, JALAN TANJONG 2 TAMAN DESA CEMERLANG', top: 385, left: 100, width: 400, height: 20 },
  { text: 'Document No. : T01-036402', top: 470, left: 110, width: 300, height: 20 },
  { text: 'Date : 04-09-2026 01:46:20 PM', top: 495, left: 110, width: 320, height: 20 },
  { text: 'Tel : 017-756 1396', top: 545, left: 110, width: 220, height: 20 },
];
const totals = [
  { text: 'Sub Total (Ex) :', top: 720, left: 110, width: 190, height: 20 },
  { text: '30.90', top: 720, left: 400, width: 60, height: 20 },
  { text: 'Rounded Total (RM):', top: 830, left: 110, width: 230, height: 22 },
  { text: '30.90', top: 830, left: 400, width: 60, height: 22 },
  { text: 'Cash', top: 880, left: 110, width: 60, height: 20 },
  { text: '50.00', top: 880, left: 390, width: 70, height: 20 },
  { text: 'Cash Change', top: 905, left: 110, width: 130, height: 20 },
  { text: '19.10', top: 905, left: 395, width: 60, height: 20 },
];

console.log('\n[1] 两个商品行 → 「购买 A、B」');
const twoItems = [
  ...header,
  { text: 'Jus Gamat', top: 640, left: 110, width: 200, height: 20 },
  { text: '12.90', top: 640, left: 400, width: 60, height: 20 },
  { text: 'Krim Vit C', top: 665, left: 110, width: 200, height: 20 },
  { text: '18.00', top: 665, left: 400, width: 60, height: 20 },
  ...totals,
];
const r1 = buildNoteSuggestion({
  lines: twoItems,
  merchant: 'CHEE YU STATIONERY',
  merchantConfident: false,
  amount: 30.9,
});
eq('[1] text', r1.text, '购买 Jus Gamat、Krim Vit C');
check('[1] reason 里记了两个商品', String(r1.reason).includes('items-2'), r1.reason);

console.log('\n[2] 五个文具行 → 「采购文具」');
const fiveStationery = [
  ...header,
  { text: 'A4 PAPER 2.50', top: 600, left: 110, width: 240, height: 20 },
  { text: 'BALL PEN 1.20', top: 625, left: 110, width: 240, height: 20 },
  { text: 'NOTEBOOK 3.00', top: 650, left: 110, width: 240, height: 20 },
  { text: 'ERASER 0.80', top: 675, left: 110, width: 240, height: 20 },
  { text: 'STAPLER 24.00', top: 700, left: 110, width: 240, height: 20 },
  { text: 'Rounded Total (RM):', top: 830, left: 110, width: 230, height: 22 },
  { text: '31.50', top: 830, left: 400, width: 60, height: 22 },
];
const r2 = buildNoteSuggestion({ lines: fiveStationery, merchant: 'CHEE YU STATIONERY', merchantConfident: false, amount: 31.5 });
eq('[2] text', r2.text, '采购文具');

console.log('\n[3] 商品不可读 + 高置信商户 → 「CHEE YU STATIONERY 消费」');
const noItem = [
  ...header,
  { text: '1 PKT *', top: 665, left: 130, width: 90, height: 20 },
  { text: '15.00', top: 665, left: 330, width: 60, height: 20 },
  ...totals,
];
const r3 = buildNoteSuggestion({ lines: noItem, merchant: 'CHEE YU STATIONERY', merchantConfident: true, amount: 15 });
eq('[3] text', r3.text, 'CHEE YU STATIONERY 消费');

console.log('\n[4] 商品不可读 + 低置信商户 → null');
const r4 = buildNoteSuggestion({ lines: noItem, merchant: 'CHEE YU STATIONERY', merchantConfident: false, amount: 15 });
eq('[4] text', r4.text, null);

console.log('\n[5] 行里有单号/找零/电话 → 不得进入备注');
const withNoise = [
  ...header,
  { text: 'Jus Gamat', top: 640, left: 110, width: 200, height: 20 },
  { text: '12.90', top: 640, left: 400, width: 60, height: 20 },
  { text: 'Krim Vit C', top: 665, left: 110, width: 200, height: 20 },
  { text: '18.00', top: 665, left: 400, width: 60, height: 20 },
  { text: 'Document No. : T01-036402', top: 690, left: 110, width: 300, height: 20 },
  { text: 'Cash Change', top: 700, left: 110, width: 130, height: 20 },
  { text: '19.10', top: 700, left: 395, width: 60, height: 20 },
  { text: 'Tel : 017-756 1396', top: 710, left: 110, width: 220, height: 20 },
  ...totals,
];
const r5 = buildNoteSuggestion({ lines: withNoise, merchant: 'CHEE YU STATIONERY', merchantConfident: true, amount: 30.9 });
eq('[5] text 仍只写商品', r5.text, '购买 Jus Gamat、Krim Vit C');
[
  ['单号', 'T01'],
  ['单号前缀', 'Document'],
  ['电话', '1396'],
  ['找零', 'Change'],
  ['地址', 'JALAN'],
  ['付款方式', 'Cash'],
].forEach(([label, needle]) => {
  check('[5] 备注里没有' + label, !String(r5.text).toUpperCase().includes(needle.toUpperCase()), r5.text);
});

console.log('\n[6] 超长商品名 → 截断且 ≤ 30 字');
const longName = 'EXTREMELY LONG PRODUCT DESCRIPTION WITH MANY WORDS A4 PAPER';
const r6 = buildNoteSuggestion({
  lines: [
    ...header,
    { text: longName, top: 640, left: 110, width: 320, height: 20 },
    { text: '9.90', top: 640, left: 420, width: 60, height: 20 },
  ],
  merchant: null,
  merchantConfident: false,
  amount: 9.9,
});
check('[6] 长度 ≤ ' + NOTE_MAX_LEN, typeof r6.text === 'string' && r6.text.length <= NOTE_MAX_LEN, String(r6.text) + ' len=' + String(r6.text && r6.text.length));
check('[6] 以省略号结尾', typeof r6.text === 'string' && r6.text.endsWith('…'), String(r6.text));
check('[6] 以「购买」开头', typeof r6.text === 'string' && r6.text.startsWith('购买 '), String(r6.text));

console.log('\n[7] 相邻行「数量×单价=金额」也能配成一件（真机 A4 CARD 版式）');
const adjacent = [
  ...header,
  { text: "A4 2'S CARD-WHITE 100'S L/STAR", top: 640, left: 110, width: 380, height: 20 },
  { text: '1 PKT *', top: 665, left: 130, width: 90, height: 20 },
  { text: '15.00', top: 665, left: 330, width: 60, height: 20 },
  ...totals,
];
const r7 = buildNoteSuggestion({ lines: adjacent, merchant: 'CHEE YU STATIONERY', merchantConfident: true, amount: 15 });
check('[7] 只有一件商品且带原名', typeof r7.text === 'string' && r7.text.startsWith('购买 A4'), String(r7.text));
check('[7] 没有把「1 PKT」当商品', typeof r7.text === 'string' && !r7.text.includes('PKT'), String(r7.text));

console.log('\n[8] OCR 抖动的合计标签（Rounded T0tal (RM):）不能被当商品');
const garbledTotal = [
  ...header,
  { text: 'Jus Gamat', top: 640, left: 110, width: 200, height: 20 },
  { text: '12.90', top: 640, left: 400, width: 60, height: 20 },
  { text: 'Rounded T0tal (RM):', top: 830, left: 110, width: 230, height: 22 },
  { text: '12.90', top: 830, left: 400, width: 60, height: 22 },
];
const r8 = buildNoteSuggestion({ lines: garbledTotal, merchant: 'CHEE YU STATIONERY', merchantConfident: true, amount: 12.9 });
eq('[8] text', r8.text, '购买 Jus Gamat');

console.log('\n[9] 表格标题行（Item Description Qty ...）不成为商品');
const withTableHeader = [
  ...header,
  { text: 'Item Description Qty U/Price Amount', top: 600, left: 110, width: 400, height: 20 },
  ...totals,
];
const r9 = buildNoteSuggestion({ lines: withTableHeader, merchant: null, merchantConfident: false, amount: 30.9 });
eq('[9] text', r9.text, null);

console.log('\n结果：' + (failed === 0 ? 'ALL PASS' : failed + ' FAILED'));
process.exit(failed === 0 ? 0 : 1);
