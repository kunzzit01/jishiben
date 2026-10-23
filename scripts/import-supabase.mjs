#!/usr/bin/env node
/**
 * Supabase JSON 导出 → 本项目 MySQL 导入 SQL 生成器
 *
 * 为什么要转换而不是直接导入：
 *   Supabase 用 Postgres + UUID 主键，表之间用 text id 互联；
 *   本项目用 BIGINT 自增主键 + client_uid（App 生成的字符串 id）+ 真外键。
 *   所以必须重建成 client_uid 保留、外键换成子查询解析的形式。
 *
 * 用法：
 *   node scripts/import-supabase.mjs --in <导出目录> --email <接收数据的账号邮箱> [--out import.sql]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const INDIR = get('in');
const EMAIL = get('email');
const OUT = get('out', 'import.sql');
if (!INDIR || !EMAIL) {
  console.error('用法: node scripts/import-supabase.mjs --in <导出目录> --email <账号邮箱> [--out import.sql]');
  process.exit(1);
}

const read = (t) => {
  const p = path.join(INDIR, t + '.json');
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8').trim();
  if (!raw) return [];
  const j = JSON.parse(raw);
  return Array.isArray(j) ? j : (j.rows || j.data || []);
};

const q = (s) => (s === null || s === undefined ? 'NULL' : "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'");
const num = (n) => (n === null || n === undefined || n === '' ? 'NULL' : String(Number(n)));
const bool = (b) => (b ? 1 : 0);

/** 时间统一成 MySQL DATETIME：支持 ISO 字符串与 epoch 毫秒 */
function ts(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  let d;
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    d = new Date(n < 1e11 ? n * 1000 : n);
  } else {
    d = new Date(String(v));
  }
  if (isNaN(d.getTime())) return 'NULL';
  const p = (x) => String(x).padStart(2, '0');
  return `'${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}'`;
}

const ledgers = read('ledgers');
const assets = read('assets');
const categories = read('categories');
const groups = read('category_groups');
const txs = read('transactions');
const budgets = read('budgets');
const profiles = read('profiles');

const L = [];
L.push('-- 由 scripts/import-supabase.mjs 生成');
L.push('-- 目标账号: ' + EMAIL);
L.push('-- 数量: ledgers=' + ledgers.length + ' assets=' + assets.length + ' categories=' + categories.length + ' transactions=' + txs.length + ' budgets=' + budgets.length);
L.push('');
L.push('SET @uid := (SELECT id FROM users WHERE email = ' + q(EMAIL) + ' LIMIT 1);');
L.push("-- 若账号不存在，@uid 为 NULL，下面所有 INSERT 会因外键失败而中止（这是有意的）");
L.push('');

// ── 补建缺失账本 ──
// 导出里存在这种数据：流水引用了某个账本 id，但账本表里没有它（账本被删过、流水残留）。
// 直接丢进默认账本会篡改用户的历史，所以按原 id 补建一个占位账本，用户可自行重命名/删除。
const ledgerIds = new Set(ledgers.map((l) => l.id));
const orphanLedgers = new Set();
for (const t of txs) if (t.ledger_id && !ledgerIds.has(t.ledger_id)) orphanLedgers.add(t.ledger_id);
for (const a of assets) if (a.ledger_id && !ledgerIds.has(a.ledger_id)) orphanLedgers.add(a.ledger_id);

// ── 账本 ──
L.push('-- 账本');
for (const l of ledgers) {
  L.push(`INSERT INTO ledgers (user_id, client_uid, name, icon, color, sort_order, is_default, created_at, updated_at)
VALUES (@uid, ${q(l.id)}, ${q(l.name)}, ${q(l.icon || 'book-outline')}, ${q(l.color)}, ${num(l.sort_order ?? 0)}, ${bool(l.id === 'default' || l.is_default)}, ${ts(l.created_at)}, ${ts(l.updated_at)})
ON DUPLICATE KEY UPDATE name=VALUES(name), icon=VALUES(icon), color=VALUES(color), updated_at=VALUES(updated_at);`);
}
L.push('');

if (orphanLedgers.size) {
  L.push('-- 被流水引用但导出中缺失的账本：补建占位行（否则这些流水无处归属）');
  for (const lid of orphanLedgers) {
    const short = String(lid).slice(-4);
    L.push(`INSERT INTO ledgers (user_id, client_uid, name, icon, color, sort_order, is_default, created_at, updated_at)
VALUES (@uid, ${q(lid)}, ${q('恢复的账本 ' + short)}, 'book-outline', '#9E9E9E', 99, 0, NOW(), NOW())
ON DUPLICATE KEY UPDATE updated_at=NOW();`);
  }
  L.push('');
}

// ── 大类（Supabase 把 group_name 直接存在 categories 上，这里补建大类行）──
const groupMap = new Map();
for (const c of categories) {
  const gname = c.group_name;
  if (!gname) continue;
  if (!groupMap.has(gname)) {
    groupMap.set(gname, { name: gname, type: c.type || 'expense', icon: c.icon, color: c.color, count: 0 });
  }
  groupMap.get(gname).count++;
}
const explicitGroups = groups.length;
if (groupMap.size) {
  L.push('-- 收支大类（由 categories.group_name 去重补建，共 ' + groupMap.size + ' 个；导出里 category_groups 原本 ' + explicitGroups + ' 行）');
  let gi = 0;
  for (const g of groupMap.values()) {
    L.push(`INSERT INTO category_groups (user_id, client_uid, name, color, icon, type, sort_order, created_at, updated_at)
VALUES (@uid, ${q(g.name)}, ${q(g.name)}, ${q(g.color)}, ${q(g.icon)}, ${q(g.type)}, ${gi++}, NOW(), NOW())
ON DUPLICATE KEY UPDATE name=VALUES(name), updated_at=NOW();`);
  }
  L.push('');
}

// ── 分类 ──
L.push('-- 分类');
let ci = 0;
for (const c of categories) {
  const gid = c.group_name
    ? `(SELECT id FROM category_groups WHERE user_id=@uid AND client_uid=${q(c.group_name)})`
    : 'NULL';
  L.push(`INSERT INTO categories (user_id, client_uid, group_id, name, icon, color, type, sort_order, created_at, updated_at)
VALUES (@uid, ${q(c.id)}, ${gid}, ${q(c.name)}, ${q(c.icon || 'ellipse-outline')}, ${q(c.color)}, ${q(c.type || 'expense')}, ${num(ci++)}, ${ts(c.updated_at)}, ${ts(c.updated_at)})
ON DUPLICATE KEY UPDATE group_id=VALUES(group_id), name=VALUES(name), icon=VALUES(icon), color=VALUES(color), updated_at=VALUES(updated_at);`);
}
L.push('');

// ── 账户 ──
L.push('-- 账户');
for (const a of assets) {
  L.push(`INSERT INTO assets (user_id, client_uid, ledger_id, name, icon, color, type, currency, initial_balance, credit_limit, statement_day, due_day, interest_rate, is_default, sort_order, archived_at, created_at, updated_at)
VALUES (@uid, ${q(a.id)},
        (SELECT id FROM ledgers WHERE user_id=@uid AND client_uid=${q(a.ledger_id || 'default')}),
        ${q(a.name)}, ${q(a.icon || 'wallet-outline')}, ${q(a.color || '#4C9AFF')}, ${q(a.type || 'cash')}, ${q(a.currency || 'MYR')},
        ${num(a.initial_balance ?? 0)}, ${num(a.credit_limit)}, ${num(a.statement_day)}, ${num(a.due_day)}, ${num(a.interest_rate)},
        ${bool(a.is_default)}, ${num(a.sort_order ?? 0)}, ${ts(a.archived_at)}, ${ts(a.created_at)}, ${ts(a.updated_at)})
ON DUPLICATE KEY UPDATE name=VALUES(name), initial_balance=VALUES(initial_balance), archived_at=VALUES(archived_at), updated_at=VALUES(updated_at);`);
}
L.push('');

// ── 流水 ──
const assetCur = new Map(assets.map((a) => [a.id, a.currency || 'MYR']));
const catIds = new Set(categories.map((c) => c.id));
L.push('-- 流水');
for (const t of txs) {
  const ledger = `(SELECT id FROM ledgers WHERE user_id=@uid AND client_uid=${q(t.ledger_id || 'default')})`;
  const cat = t.category_id && catIds.has(t.category_id)
    ? `(SELECT id FROM categories WHERE user_id=@uid AND client_uid=${q(t.category_id)})`
    : 'NULL';
  const asset = t.asset_id ? `(SELECT id FROM assets WHERE user_id=@uid AND client_uid=${q(t.asset_id)})` : 'NULL';
  const fromA = t.from_asset_id ? `(SELECT id FROM assets WHERE user_id=@uid AND client_uid=${q(t.from_asset_id)})` : 'NULL';
  const toA = t.to_asset_id ? `(SELECT id FROM assets WHERE user_id=@uid AND client_uid=${q(t.to_asset_id)})` : 'NULL';
  // 币种快照：单账户取该账户币种；转账取转出账户币种
  const cur = assetCur.get(t.asset_id) || assetCur.get(t.from_asset_id) || 'MYR';
  L.push(`INSERT INTO transactions (user_id, client_uid, ledger_id, category_id, asset_id, from_asset_id, to_asset_id, type, amount, currency, exchange_rate, converted_amount, fee, occurred_on, note, display_name, receipt_path, created_at, updated_at)
VALUES (@uid, ${q(t.id)}, ${ledger}, ${cat}, ${asset}, ${fromA}, ${toA}, ${q(t.type || 'expense')}, ${num(t.amount)}, ${q(cur)},
        ${num(t.exchange_rate)}, ${num(t.converted_amount)}, ${num(t.fee)}, ${q(String(t.date || '').slice(0, 10))}, ${q(t.note || '')}, ${q(t.display_name)}, ${q(t.receipt_path)},
        ${ts(t.created_at)}, ${ts(t.updated_at)})
ON DUPLICATE KEY UPDATE amount=VALUES(amount), category_id=VALUES(category_id), occurred_on=VALUES(occurred_on), note=VALUES(note), updated_at=VALUES(updated_at);`);
}
L.push('');

// ── 预算 ──
L.push('-- 预算（Supabase: id = "total|CNY" / "<categoryId>|<CUR>"；MySQL: scope + 可空外键）');
for (const b of budgets) {
  const isTotal = b.category_id === 'total' || String(b.id || '').startsWith('total|');
  const scope = isTotal ? 'total' : 'category';
  const cat = isTotal ? 'NULL' : `(SELECT id FROM categories WHERE user_id=@uid AND client_uid=${q(b.category_id)})`;
  const clientUid = b.id || (b.category_id + '|' + b.currency);
  L.push(`INSERT INTO budgets (user_id, client_uid, scope, category_id, amount, currency, created_at, updated_at)
VALUES (@uid, ${q(clientUid)}, ${q(scope)}, ${cat}, ${num(b.amount)}, ${q(b.currency || 'MYR')}, ${ts(b.updated_at)}, ${ts(b.updated_at)})
ON DUPLICATE KEY UPDATE amount=VALUES(amount), updated_at=VALUES(updated_at);`);
}
L.push('');

// ── 资料/显示设置 ──
const p0 = profiles[0];
if (p0) {
  L.push('-- 资料与显示设置');
  L.push(`UPDATE profiles SET
  display_name      = COALESCE(${q(p0.display_name)}, display_name),
  currency          = ${q(p0.currency || 'MYR')},
  date_format       = ${q(p0.date_format || 'YYYY/MM/DD')},
  week_starts_on    = ${num(p0.week_starts_on ?? 1)},
  decimal_places    = ${num(p0.decimal_places ?? 2)},
  period_preference = ${p0.period_preference ? q(JSON.stringify(p0.period_preference)) : 'NULL'},
  active_ledger_id  = (SELECT id FROM ledgers WHERE user_id=@uid AND client_uid=${q(p0.active_ledger_id || 'default')}),
  updated_at        = NOW()
WHERE user_id = @uid;`);
  L.push('');
}

L.push('-- 导入完成，核对：');
L.push("SELECT 'ledgers' t, COUNT(*) n FROM ledgers WHERE user_id=@uid");
L.push("UNION ALL SELECT 'assets', COUNT(*) FROM assets WHERE user_id=@uid");
L.push("UNION ALL SELECT 'categories', COUNT(*) FROM categories WHERE user_id=@uid");
L.push("UNION ALL SELECT 'category_groups', COUNT(*) FROM category_groups WHERE user_id=@uid");
L.push("UNION ALL SELECT 'transactions', COUNT(*) FROM transactions WHERE user_id=@uid");
L.push("UNION ALL SELECT 'budgets', COUNT(*) FROM budgets WHERE user_id=@uid;");

fs.writeFileSync(OUT, L.join('\n') + '\n');
console.log('已生成 ' + OUT);
console.log('  语句数: ' + L.filter((x) => x.startsWith('INSERT') || x.startsWith('UPDATE')).length);
console.log('  补建账本(导出缺失): ' + orphanLedgers.size + (orphanLedgers.size ? ' -> ' + [...orphanLedgers].join(', ') : ''));
console.log('  明细: ledgers=' + ledgers.length + ' groups=' + groupMap.size + ' categories=' + categories.length + ' assets=' + assets.length + ' transactions=' + txs.length + ' budgets=' + budgets.length);
