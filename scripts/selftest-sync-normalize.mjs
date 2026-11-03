// 回归：syncService.normalizeSnapshot 必须把「挂在不存在的账本上的行」改挂到真实账本。
//
// 背景（2026-11-03 线上）：设备的 activeLedgerId 存档成了 'default'，两条账户 / 流水 / 计划
// 一起挂在 'default' 上；服务端按 clientUid 校验每一行的 ledgerUid，对不上就整行 400
// （ledgerUid does not reference one of your ledgers: default），同步就永远卡在那几行上。
// 这里不靠模拟器：把 src/services/syncService.ts 的实现体原样取出（剥掉平台 import、补最小桩），
// 在 node 里直接跑真实的 normalizeSnapshot，断言推上云的每个 ledgerUid 都落在真实账本里。
//
// 用法：node scripts/selftest-sync-normalize.mjs
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const srcText = readFileSync(join(root, 'src', 'services', 'syncService.ts'), 'utf8');
const marker = 'export interface LocalSnapshot';
const at = srcText.indexOf(marker);
if (at < 0) {
  console.error('FAIL 找不到 ' + marker + '，syncService.ts 结构变了，需要更新本脚本');
  process.exit(1);
}
const ledgerRefsUrl = pathToFileURL(join(root, 'src', 'services', 'ledgerRefs.ts')).href;
const stubs = [
  '// 只为让模块能被加载；normalizeSnapshot 不依赖这些桩',
  'const AsyncStorage = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };',
  'const EXPENSE_CATEGORY_GROUPS = [];',
  'const INCOME_CATEGORY_GROUPS = [];',
  'const translate = (k) => k;',
  'const api = new Proxy({}, { get: () => async () => null });',
  'const listAllTransactions = async () => [];',
  'const isSessionDeadError = () => false;',
  'class ApiError extends Error {}',
  'const runStorageExclusive = async (fn) => fn();',
  'const getCurrentUser = () => null;',
  'const hydrateSession = async () => {};',
  'const amountKey = (v) => String(v);',
  'const optionalAmount = () => null;',
  'const parseAmount = (v) => Number(v);',
  'const rateKey = () => null;',
  'const optionalRate = () => null;',
].join('\n');
const probe = "import { needsLedgerRemap, resolveLedgerFallback } from '" + ledgerRefsUrl + "';\n\n" + stubs + '\n\n' + srcText.slice(at) + '\nexport { normalizeSnapshot };\n';
const dir = mkdtempSync(join(tmpdir(), 'jishiben-sync-selftest-'));
const probePath = join(dir, 'normalizeProbe.mts');
writeFileSync(probePath, probe, 'utf8');

let normalizeSnapshot;
try {
  ({ normalizeSnapshot } = await import(pathToFileURL(probePath).href));
} catch (e) {
  console.error('FAIL 加载 normalizeSnapshot 失败（可能是新增了模块级依赖，需要补桩）：' + (e && e.message));
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' —— 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)));
};

const LEDGERS = ['1788744197635-ipcoych', '1789897416677-yddbwa1', '1793668475563-q7f8rta', '1793668557917-plsylr1'];
const ids = new Set(LEDGERS);
const asset = (id, ledgerId) => ({ id, ledgerId, name: 'A', icon: 'wallet-outline', color: '#4C9AFF', currency: 'MYR', type: 'cash', initialBalance: 1, createdAt: 1700000000000 });
const base = {
  ledgers: LEDGERS.map((id, i) => ({ id, name: 'L' + i, icon: 'book-outline', color: '#4C9AFF', createdAt: 1700000000000 })),
  activeLedgerId: 'default',
  currency: 'MYR',
  periodPreference: { type: 'month' },
  dateFormat: 'YYYY/MM/DD',
  weekStartsOn: 1,
  decimalPlaces: 2,
  categoryGroups: [], categories: [], budgets: [],
  assets: [
    asset('1788485476586-kw77cxt', 'default'),
    asset('1788586816421-xnmhp2l', 'default'),
    asset('1793668526454-xrnlqks', LEDGERS[2]),
    asset('1793668526455-orphan', '__pending_ledger__'),
  ],
  transactions: [
    { id: 't1', ledgerId: 'default', amount: 1, date: '2026-11-01', createdAt: 1700000000000, categoryId: '' },
    { id: 't2', ledgerId: LEDGERS[3], amount: 2, date: '2026-11-01', createdAt: 1700000000000, categoryId: '' },
  ],
  paymentPlans: [{ id: 'p1', ledgerId: 'default', amount: 5, startDate: '2026-11-01', createdAt: 1700000000000 }],
};

const { snapshot: out, changed } = normalizeSnapshot(base);
check('毒快照被标记为已修复', changed, true);
check('当前账本从 default 改挂到真实账本', out.activeLedgerId, LEDGERS[0]);
check('账户归属全部落在真实账本', out.assets.every((a) => ids.has(a.ledgerId)), true);
check('流水归属全部落在真实账本', out.transactions.every((t) => ids.has(t.ledgerId)), true);
check('计划归属全部落在真实账本', out.paymentPlans.every((p) => ids.has(p.ledgerId)), true);
check('已归属的账户不被搬动', out.assets[2].ledgerId, LEDGERS[2]);

const clean = {
  ...base,
  activeLedgerId: LEDGERS[2],
  assets: base.assets.map((a, i) => ({ ...a, ledgerId: LEDGERS[i % 4] })),
  transactions: [{ ...base.transactions[0], ledgerId: LEDGERS[2] }],
  paymentPlans: [{ ...base.paymentPlans[0], ledgerId: LEDGERS[3] }],
};
const cleanResult = normalizeSnapshot(clean);
check('干净快照不触发改写（不反复写盘）', cleanResult.changed === false && cleanResult.snapshot === clean, true);

const noLedgers = normalizeSnapshot({ ...base, ledgers: [], assets: [asset('x1', 'default')], transactions: [], paymentPlans: [] });
check('账本表还没拉到时不动归属', noLedgers.snapshot.assets[0].ledgerId, 'default');

console.log(failed ? '\n' + failed + ' 项失败' : '\n全部通过');
process.exit(failed ? 1 : 0);
