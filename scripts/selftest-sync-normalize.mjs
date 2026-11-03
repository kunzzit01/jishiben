// 回归：syncService.normalizeSnapshot 必须把「挂在不存在的账本上的行」改挂到真实账本。
//
// 背景（2026-11-03 线上）：设备的 activeLedgerId 存档成了 'default'，两条账户 / 流水 / 计划
// 一起挂在 'default' 上；服务端按 clientUid 校验每一行的 ledgerUid，对不上就整行 400
// （ledgerUid does not reference one of your ledgers: default），同步就永远卡在那几行上。
// 这里不靠模拟器：把 syncService 的实现体在 node 里跑起来（见 scripts/lib/sync-probe.mjs）。
//
// 用法：node scripts/selftest-sync-normalize.mjs
import { createApiRecorder, createMemoryStorage, loadSyncService, makeChecker, ProbeApiError } from './lib/sync-probe.mjs';

const { check, finish } = makeChecker();
const { normalizeSnapshot } = await loadSyncService({
  AsyncStorage: createMemoryStorage(),
  api: createApiRecorder().api,
  ApiError: ProbeApiError,
});

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

process.exit(finish());
