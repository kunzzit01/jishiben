/**
 * 账本归属的纯判断：「这一行挂的账本 id 是否真实存在」。
 *
 * 服务端对每一行的 ledgerUid 都按本账号的账本 clientUid 校验，对不上就整行 400
 * （`ledgerUid does not reference one of your ledgers: xxx`）。客户端历史上有三条路径
 * 会造出这种永远推不上去的行：
 *   ① 老版本把首本账本的 id 写死成 `'default'`；
 *   ② 冷启动占位账本 `PENDING_LEDGER_ID`（离线期间记的账户/流水/计划）；
 *   ③ 账本被回收后留下的孤儿行（reconcileLedgers 只回收账本，不改挂它的行）。
 * 这些行在界面上「每本账本都可见」（见 AppContext.assetBelongsToActiveLedger 的孤儿兜底），
 * 用户看不出异常，只表现为同步一直卡在那几行 —— 2026-11-03 线上即此症状。
 *
 * 推送前把这类行改挂到一本真实存在的账本。只做纯判断、不碰存储，
 * 便于 scripts/selftest-ledger-refs.mjs 直接跑。
 */

/** 改挂目标：当前账本有效就用它，否则第一本；账本表为空返回 ''（此时不该改挂） */
export function resolveLedgerFallback(ledgerIds: readonly string[], activeLedgerId: string): string {
  if (ledgerIds.length === 0) return '';
  return ledgerIds.includes(activeLedgerId) ? activeLedgerId : ledgerIds[0];
}

/**
 * 该行的账本归属是否需要改挂。
 * 账本表为空 = 还没拉到服务端账本列表（首次启动 / 离线），此时一律不动，
 * 免得把行甩给一本同样不存在的账本。
 */
export function needsLedgerRemap(
  ledgerId: string | undefined,
  ledgerIds: readonly string[]
): boolean {
  if (ledgerIds.length === 0) return false;
  return !ledgerId || !ledgerIds.includes(ledgerId);
}
