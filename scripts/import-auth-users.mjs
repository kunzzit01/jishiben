#!/usr/bin/env node
/**
 * 把 Supabase auth.users 导出（CSV 或 JSON）导入成本项目账号。
 *
 * 为什么能沿用原密码：Supabase 的 auth.users.encrypted_password 是 bcrypt（$2a$/$2b$），
 * 本项目 Spring Security 的 BCryptPasswordEncoder 同样支持这两种前缀 ——
 * 直接复制哈希即可，用户无需重设密码。
 *
 * 用法：
 *   node scripts/import-auth-users.mjs --in auth-users.csv --out users.sql
 *   node scripts/import-auth-users.mjs --in auth-users.json --out users.sql
 *
 * 期望字段：id, email, encrypted_password（JSON 里叫 encrypted_password 或 password_hash）, created_at
 */
import fs from 'node:fs';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const IN = get('in');
const OUT = get('out', 'users.sql');
if (!IN) { console.error('用法: node scripts/import-auth-users.mjs --in <auth-users.csv|json> [--out users.sql]'); process.exit(1); }

/** 极简 CSV 解析：支持引号包裹与转义双引号 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 1 || (r[0] || '').trim()).map((r) => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx]; });
    return o;
  });
}

const raw = fs.readFileSync(IN, 'utf8').trim();
let rows;
if (raw.startsWith('[')) rows = JSON.parse(raw);
else if (raw.startsWith('{')) { const j = JSON.parse(raw); rows = Array.isArray(j) ? j : (j.rows || j.users || []); }
else rows = parseCsv(raw);

const q = (s) => (s === null || s === undefined || s === '' ? 'NULL' : "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'");
const pick = (r, ...keys) => { for (const k of keys) if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') return String(r[k]).trim(); return null; };

const L = [];
L.push('-- 由 scripts/import-auth-users.mjs 生成');
L.push('-- 账号数: ' + rows.length);
L.push('');
L.push('-- 映射表：Supabase UUID → 本项目用户（供业务数据按人分配）');
L.push('DROP TABLE IF EXISTS supa_user_map;');
L.push('CREATE TEMPORARY TABLE supa_user_map (supa_uid VARCHAR(64) PRIMARY KEY, email VARCHAR(255) NOT NULL);');
L.push('');

const rows2 = [];
for (const r of rows) {
  const id = pick(r, 'id', 'user_id', 'uuid');
  const email = pick(r, 'email');
  const hash = pick(r, 'encrypted_password', 'password_hash', 'password');
  const createdAt = pick(r, 'created_at', 'inserted_at');
  if (!email) continue;
  rows2.push({ id, email, hashHas: !!hash });
  if (!hash) {
    L.push('-- 注意：' + email + ' 在导出里没有密码哈希，created_at 保留但无法沿用原密码');
  }
  L.push(`INSERT INTO users (email, password_hash, display_name, user_role, created_at, updated_at)
VALUES (${q(email)}, ${q(hash)}, ${q(null)}, 'USER', ${createdAt ? q(String(createdAt).replace('T', ' ').slice(0, 19)) : 'NOW()'}, NOW())
ON DUPLICATE KEY UPDATE password_hash = COALESCE(VALUES(password_hash), password_hash), updated_at = NOW();`);
  if (id) {
    L.push(`INSERT INTO supa_user_map (supa_uid, email) VALUES (${q(id)}, ${q(email)}) ON DUPLICATE KEY UPDATE email = VALUES(email);`);
    L.push(`INSERT INTO profiles (user_id, currency, date_format, week_starts_on, decimal_places)
SELECT id, 'MYR', 'YYYY/MM/DD', 1, 2 FROM users WHERE email = ${q(email)}
ON DUPLICATE KEY UPDATE updated_at = NOW();`);
  }
  L.push('');
}

L.push('-- 完成后可查看映射：');
L.push('SELECT m.supa_uid, m.email, u.id AS local_uid FROM supa_user_map m JOIN users u ON u.email = m.email;');

fs.writeFileSync(OUT, L.join('\n') + '\n');
console.log('已生成 ' + OUT);
console.log('  账号: ' + rows2.length + '（含密码哈希: ' + rows2.filter((r) => r.hashHas).length + '）');
for (const r of rows2) console.log('    ' + (r.id || '(无id)') + '  ' + r.email + (r.hashHas ? '  [有哈希]' : '  [无哈希]'));
