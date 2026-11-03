// 回归：幽灵账本 id（老版本的 'default' / 占位账本 id / 已回收账本留下的孤儿）必须被改挂到真实账本。
//
// 原因：服务端对每一行的 ledgerUid 都按本账号账本 clientUid 校验，对不上就整行 400
// （ledgerUid does not reference one of your ledgers: default），同步就永远卡在那几行上。
// 2026-11-03 线上症状即此：assets/1788485476586-kw77cxt 与 assets/1788586816421-xnmhp2l
// 两条账户一直拒写，其余数据正常。
//
// 纯规则，无需模拟器：node scripts/selftest-ledger-refs.mjs
import { needsLedgerRemap, resolveLedgerFallback } from '../src/services/ledgerRefs.ts';

let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' —— 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)));
};

const LEDGERS = ['1788744197635-ipcoych', '1789897416677-yddbwa1'];

// ① 改挂目标：当前账本有效就用它
check('当前账本有效 → 就是它', resolveLedgerFallback(LEDGERS, LEDGERS[1]), LEDGERS[1]);
// ② 当前账本是幽灵 id（存档里存过 'default' / 缺 key 存成 ''）→ 落到第一本真实账本
check("当前账本 = 'default' → 第一本", resolveLedgerFallback(LEDGERS, 'default'), LEDGERS[0]);
check('当前账本 = \'\' → 第一本', resolveLedgerFallback(LEDGERS, ''), LEDGERS[0]);
// ③ 账本表为空（还没拉到服务端账本）→ 不改挂，返回空
check('账本表为空 → 不改挂', resolveLedgerFallback([], LEDGERS[0]), '');

// ④ 哪些行需要改挂
check("'default' 要改挂", needsLedgerRemap('default', LEDGERS), true);
check('占位账本 id 要改挂', needsLedgerRemap('__pending_ledger__', LEDGERS), true);
check('指向已回收账本要改挂', needsLedgerRemap('1700000000000-gone1', LEDGERS), true);
check('缺 ledgerId 要改挂', needsLedgerRemap(undefined, LEDGERS), true);
check('空 ledgerId 要改挂', needsLedgerRemap('', LEDGERS), true);
check('真实账本不动', needsLedgerRemap(LEDGERS[0], LEDGERS), false);
check('账本表为空时一律不动', needsLedgerRemap('default', []), false);

// ⑤ 线上那两条账户的实际情况：改挂后推上去的 ledgerUid 必须落在真实账本里
const devicesAssets = [
  { clientUid: '1788485476586-kw77cxt', ledgerId: 'default' },
  { clientUid: '1788586816421-xnmhp2l', ledgerId: 'default' },
  { clientUid: '1793668526454-xrnlqks', ledgerId: LEDGERS[0] },
];
const fallback = resolveLedgerFallback(LEDGERS, 'default');
const pushed = devicesAssets.map((a) => (needsLedgerRemap(a.ledgerId, LEDGERS) ? fallback : a.ledgerId));
check('两条幽灵账户改挂到第一本', [pushed[0], pushed[1]], [LEDGERS[0], LEDGERS[0]]);
check('已归属的账户不被搬动', pushed[2], LEDGERS[0]);
check('推送体里的每个 ledgerUid 都是真实账本', pushed.every((id) => LEDGERS.includes(id)), true);

console.log(failed ? '\n' + failed + ' 项失败' : '\n全部通过');
process.exit(failed ? 1 : 0);
