// 回归：PATCH /api/profile 里的 activeLedgerUid 只能指向**服务端认识**的账本。
//
// 背景（2026-11-03 线上）：设备当前账本 1793601452048-23i6wbh 只存在于本机（服务端 /api/ledgers
// 里没有它），于是每次同步都以 profile/me 400 收场：
//   activeLedgerUid does not reference one of your ledgers: 1793601452048-23i6wbh
// 服务端是引用校验（ProfileService.java:79），而空账本在上云前的 preflight 推送里被
// skipUnsyncedEmptyLedgers 刻意跳过 —— 中间这段时间就不能把它的 uid 写进 profile。
// 这里跑真实的 pushSnapshot（见 scripts/lib/sync-probe.mjs），断言实际发出的请求体。
//
// 用法：node scripts/selftest-sync-profile.mjs
import { createApiRecorder, createMemoryStorage, loadSyncService, makeChecker, ProbeApiError } from './lib/sync-probe.mjs';

const { check, finish } = makeChecker();
const MIRROR_KEY = '@jizhang/syncMirror';
const LOCAL_ONLY = '1793601452048-23i6wbh';

const ledger = { id: LOCAL_ONLY, name: 'Ledger A', icon: 'book-outline', color: '#4C9AFF', createdAt: 1700000000000 };
const LEDGER_ROW = { clientUid: LOCAL_ONLY, name: 'Ledger A', icon: 'book-outline', color: '#4C9AFF', sortOrder: 0 };
const snapshot = {
  ledgers: [ledger],
  activeLedgerId: LOCAL_ONLY,
  currency: 'MYR',
  periodPreference: { type: 'month' },
  dateFormat: 'YYYY/MM/DD',
  weekStartsOn: 1,
  decimalPlaces: 2,
  categoryGroups: [], categories: [], budgets: [], assets: [], transactions: [], paymentPlans: [],
};

async function run({ mirror, opts, failLedgerUpsert }) {
  const seed = mirror ? { [MIRROR_KEY]: JSON.stringify(mirror) } : {};
  const storage = createMemoryStorage(seed);
  const recorder = createApiRecorder();
  if (failLedgerUpsert) {
    recorder.failOn.push({ op: 'putLedger', id: LOCAL_ONLY, error: new ProbeApiError('VALIDATION_FAILED: boom') });
  }
  const mod = await loadSyncService({ AsyncStorage: storage, api: recorder.api, ApiError: ProbeApiError });
  const failed = await mod.pushSnapshot(snapshot, opts ?? {});
  return { calls: recorder.calls, failed, storage };
}
const patchesOf = (calls) => calls.filter((c) => c.op === 'patchProfile').map((c) => c.arg);
const putsOf = (calls) => calls.filter((c) => c.op === 'putLedger').map((c) => c.arg);
const mirrorProfile = (storage) => JSON.parse(storage.read(MIRROR_KEY)).profile;

// ① 账本还没上云（preflight 推送会跳过空账本）→ profile 里必须摘掉 activeLedgerUid
const a = await run({ opts: { skipUnsyncedEmptyLedgers: true } });
check('① 账本被跳过上传', putsOf(a.calls).length, 0);
check('① 没有失败行', a.failed.length, 0);
check('① profile 仍然 PATCH 了一次', patchesOf(a.calls).length, 1);
check('① activeLedgerUid 被摘掉', patchesOf(a.calls)[0].activeLedgerUid, undefined);
check('① 其它设置照常上传', patchesOf(a.calls)[0].currency, 'MYR');
check('① 镜像记的是实际发出去的那一行', mirrorProfile(a.storage).activeLedgerUid, null);

// ② 同样的数据再推一次：不该因为镜像与本地不一致而反复 PATCH
const a2 = await run({ mirror: JSON.parse(a.storage.read(MIRROR_KEY)), opts: { skipUnsyncedEmptyLedgers: true } });
check('② 没有变化就不重复 PATCH', patchesOf(a2.calls).length, 0);

// ③ 服务端已经认识这本账本（镜像里有它）→ 可以带上 activeLedgerUid
const b = await run({ mirror: { ledgers: [LEDGER_ROW], profile: null }, opts: { skipUnsyncedEmptyLedgers: true } });
check('③ 账本已上云，不必重推', putsOf(b.calls).length, 0);
check('③ activeLedgerUid 照常带上', patchesOf(b.calls)[0].activeLedgerUid, LOCAL_ONLY);
check('③ 镜像里记下带上后的行', mirrorProfile(b.storage).activeLedgerUid, LOCAL_ONLY);

// ④ 普通推送：账本本轮成功上传 → 同一轮的 profile 就可以引用它
const c = await run({ opts: {} });
check('④ 账本本轮上传了', putsOf(c.calls).length, 1);
check('④ activeLedgerUid 带上', patchesOf(c.calls)[0].activeLedgerUid, LOCAL_ONLY);

// ⑤ 账本本轮上传失败 → 不能引用它，否则又是整条 PATCH 400
const d = await run({ opts: {}, failLedgerUpsert: true });
check('⑤ 账本行算失败', d.failed.map((f) => f.table + '/' + f.id), ['ledgers/' + LOCAL_ONLY]);
check('⑤ activeLedgerUid 被摘掉', patchesOf(d.calls)[0].activeLedgerUid, undefined);
check('⑤ 失败的账本行不进镜像（下次重试）', JSON.parse(d.storage.read(MIRROR_KEY)).ledgers.length, 0);

process.exit(finish());
