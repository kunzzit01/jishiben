// 探针：把 src/services/syncService.ts 的实现体原样取出来，在 node 里跑真实的同步逻辑。
//
// 做法：从 `export interface LocalSnapshot` 起截取实现体（丢掉 React Native / apiClient 等平台 import），
// 补一组最小桩（AsyncStorage / api），导出 normalizeSnapshot、pushSnapshot。
// 只给 scripts/selftest-*.mjs 用，不参与打包、不改源码。
import { readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src', 'services', 'syncService.ts');

/** 内存版 AsyncStorage（够 loadMirror / saveMirror / lastSyncAt 用） */
export function createMemoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    async getItem(key) { return map.has(key) ? map.get(key) : null; },
    async setItem(key, value) { map.set(key, String(value)); },
    async removeItem(key) { map.delete(key); },
    read(key) { return map.has(key) ? map.get(key) : null; },
  };
}

/** 与服务端 ApiError 同形的错误：classifySyncError 用它区分瞬时/数据错误 */
export class ProbeApiError extends Error {
  constructor(message, code = 'VALIDATION_FAILED', status = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 记录型 api 客户端：把每次调用记下来，供断言；failOn 可指定某次调用抛错 */
export function createApiRecorder() {
  const calls = [];
  const failOn = [];
  const record = (op) => async (arg) => {
    calls.push({ op, arg });
    const rule = failOn.find((r) => r.op === op && (r.id == null || r.id === (arg && arg.clientUid)));
    if (rule) throw rule.error;
    return arg;
  };
  return {
    calls,
    failOn,
    api: {
      putLedger: record('putLedger'),
      putAsset: record('putAsset'),
      putCategoryGroup: record('putCategoryGroup'),
      putCategory: record('putCategory'),
      putTransaction: record('putTransaction'),
      putPaymentPlan: record('putPaymentPlan'),
      putBudget: record('putBudget'),
      deleteLedger: record('deleteLedger'),
      deleteAsset: record('deleteAsset'),
      deleteCategoryGroup: record('deleteCategoryGroup'),
      deleteCategory: record('deleteCategory'),
      deleteTransaction: record('deleteTransaction'),
      deletePaymentPlan: record('deletePaymentPlan'),
      deleteBudget: record('deleteBudget'),
      patchProfile: record('patchProfile'),
    },
  };
}

const HEAD = (ledgerRefsUrl) => [
  "import { needsLedgerRemap, resolveLedgerFallback } from '" + ledgerRefsUrl + "';",
  '',
  '// —— 探针桩：只为让模块能加载，被断言的逻辑不依赖它们 ——',
  'const S = globalThis.__SYNC_STUBS__;',
  'const AsyncStorage = S.AsyncStorage;',
  'const api = S.api;',
  'const ApiError = S.ApiError;',
  'const listAllTransactions = S.listAllTransactions ?? (async () => []);',
  'const isSessionDeadError = () => false;',
  'const runStorageExclusive = (fn) => fn();',
  'const getCurrentUser = () => null;',
  'const hydrateSession = async () => {};',
  'const translate = (k) => k;',
  'const EXPENSE_CATEGORY_GROUPS = [];',
  'const INCOME_CATEGORY_GROUPS = [];',
  'const amountKey = (v) => (Number.isFinite(v) ? Number(v).toFixed(4) : "0.0000");',
  'const parseAmount = (raw) => (raw == null ? undefined : Number(raw));',
  'const optionalAmount = () => null;',
  'const optionalRate = () => null;',
  'const rateKey = () => null;',
].join('\n');

/** 载入一份 syncService 探针模块（每次调用都是全新实例，桩互不串味） */
export async function loadSyncService(stubs) {
  if (!existsSync(SRC)) {
    throw new Error('请在仓库根目录运行：cwd=' + ROOT);
  }
  const src = readFileSync(SRC, 'utf8');
  const marker = 'export interface LocalSnapshot';
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('syncService.ts 结构变了（找不到 ' + marker + '），需要更新 scripts/lib/sync-probe.mjs');
  const ledgerRefsUrl = pathToFileURL(join(ROOT, 'src', 'services', 'ledgerRefs.ts')).href;
  const dir = mkdtempSync(join(tmpdir(), 'jishiben-sync-probe-'));
  const file = join(dir, 'syncProbe.mts');
  writeFileSync(file, HEAD(ledgerRefsUrl) + '\n\n' + src.slice(at) + '\nexport { normalizeSnapshot, pushSnapshot, buildAllRows };\n', 'utf8');
  globalThis.__SYNC_STUBS__ = stubs;
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 极简断言器：返回失败数 */
export function makeChecker() {
  const state = { failed: 0 };
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) state.failed += 1;
    console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' —— 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)));
  };
  return { check, state, finish: () => { console.log(state.failed ? '\n' + state.failed + ' 项失败' : '\n全部通过'); return state.failed ? 1 : 0; } };
}
