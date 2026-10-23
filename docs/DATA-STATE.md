# 数据迁移现状（Supabase → 自建后端）

> 最后核对：2026-10-23　·　来源项目：`sratnkxbwsbvrewkdeii`（Supabase）
> 本文是**当前事实**，不是计划。每一条都有实测来源，核对命令见文末。

---

## 一、源数据里到底有几个人

Supabase `auth.users` 共 **2 个账号**：

| Supabase UUID | 邮箱 | 注册时间 | 最后登录 |
|---|---|---|---|
| `1bc8a1e3-c369-443b-bf15-534272beea06` | kkyylim663@gmail.com | 2026-09-15 16:02:47 | 2026-09-21 03:52:55 |
| `fda327f1-bcde-4024-aad8-1f6b70bf988f` | tangyeawkhoong@gmail.com | 2026-09-21 03:49:35 | 2026-09-21 03:49:35 |

**业务数据只有 kkyylim663 的。** 证据：

```
fda327f1-…（tangyeawkhoong）在所有 JSON 导出中出现 0 次
1bc8a1e3-…（kkyylim663）出现 169 次（= 1 profile + 5 ledgers + 16 assets + 90 categories + 54 transactions + 3 budgets）
```

补充事实：tangyeawkhoong **连 `profiles` 行都没有**（只要正常登录一次就会生成），
且 `created_at` 与 `last_sign_in_at` 相差 **60 毫秒**——注册后自动登录一次，之后没再使用。

> 若你在 Supabase 控制台确认该用户应有数据，用文末「审计查询」复核；
> 若结果全是 0，则结论就是：他本来没有数据，不是迁移丢失。

---

## 二、迁移后各库的现状

### 本地 MySQL（`127.0.0.1:3307`）

| 邮箱 | 密码 | 账本 | 账户 | 分类 | 流水 | 预算 |
|---|---|---|---|---|---|---|
| mingsoon249@gmail.com | `12345678` | 6 | 16 | 90 | 54 | 3 |
| kkyylim663@gmail.com | **原密码**（bcrypt 复用） | 6 | 16 | 90 | 54 | 3 |
| tangyeawkhoong@gmail.com | **原密码**（bcrypt 复用） | 0 | 0 | 0 | 0 | 0 |

### VPS MySQL（`187.127.125.136:8088`）

| 邮箱 | 状态 |
|---|---|
| mingsoon249@gmail.com | 账本 6 / 账户 16 / 流水 54（`12345678` 可登录） |
| kkyylim663@gmail.com | 已导入 `users-real.sql`，`12345678` 登录失败 → 密码已是真实哈希 |
| tangyeawkhoong@gmail.com | 已创建，无业务数据 |

> ⚠️ **mingsoon249 的数据是 kkyylim663 的副本**（按用户要求复制）。
> 两个账号是两份独立数据，改一个不影响另一个。真实归属是 **kkyylim663**。

---

## 三、迁移中发现并处理的数据问题

| 问题 | 处理 | 影响 |
|---|---|---|
| **19 笔流水引用了已删除的账本** `1788744197635-ipcoych` | 按原 id 补建占位账本 **「恢复的账本 oych」** | 未塞进默认账本，保全原始归属；用户可自行改名或删除 |
| **10 笔支出/收入没有关联账户**（合计 2,012.55） | 按原样保留 `asset_id = NULL` | 金额与日期准确，无法按账户统计 |
| `category_groups` 导出为 0 行 | 由 `categories.group_name` 去重补建 **15 个大类** | 分类分组结构完整 |
| 中文全部乱码 | 导入改用 `--default-character-set=utf8mb4` | 修复后：餐饮 / 购物 / 恢复的账本 均正常 |
| 备份缺 `auth.users` | 单独导出 CSV，以 bcrypt 哈希直接复用 | 用户沿用原密码，无需重设 |
| JPY 账户初始余额 700,030,000 | 原样保留 | 账户总额看起来异常，是源数据真实值 |

---

## 四、复现/重跑（三份产物，均不进 git）

```bash
# 1) 业务数据 → 指定账号
node scripts/import-supabase.mjs --in <导出目录>/export-2026-10-23 \
     --email <目标邮箱> --out import.sql

# 2) 账号（含真实密码哈希）
node scripts/import-auth-users.mjs --in auth-users.csv --out users-real.sql

# 3) 按顺序执行（账号必须先存在）
mysql --default-character-set=utf8mb4 -u... -p... db < users-real.sql
mysql --default-character-set=utf8mb4 -u... -p... db < import.sql

# VPS 上（走容器内客户端）
docker exec -i jishiben-mysql sh -c \
  'mysql --default-character-set=utf8mb4 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < import.sql
```

`import*.sql` / `users*.sql` / `auth-users.*` 已在 `.gitignore`（含真实账目与密码哈希）。

---

## 五、尚未解决

| 项 | 状态 | 需要 |
|---|---|---|
| 「立即同步」报错 | ⏳ 未定位 | **需要用户提供报错原文**（6 类错误提示对应完全不同的原因，见 `docs/IMPORT_SUPABASE.md` 与 i18n `sync.*`） |
| 本地开发连本地库、APK 连 VPS 库 | 已确认 | 两个独立数据库，不会自动互通；如需统一，给本地加 `.env` 指向 VPS |
| tangyeawkhoong 是否有隐藏数据 | 待复核 | 在 Supabase 执行文末「审计查询」 |

---

## 六、核对命令

### 本地

```bash
./.tools/mysql/bin/mysql.exe -h127.0.0.1 -P3307 -uroot --skip-password \
  --default-character-set=utf8mb4 -D jishiben -N -e "
SELECT u.email,
  (SELECT COUNT(*) FROM ledgers l WHERE l.user_id=u.id),
  (SELECT COUNT(*) FROM transactions t WHERE t.user_id=u.id)
FROM users u ORDER BY u.id;"
```

### VPS

```bash
curl -s http://127.0.0.1:8088/api/health
docker exec -it jishiben-mysql sh -c 'mysql --default-character-set=utf8mb4 \
  -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "
  SELECT u.email,
    (SELECT COUNT(*) FROM transactions t WHERE t.user_id=u.id) tx
  FROM users u ORDER BY u.id;"'
```

### 审计查询（Supabase SQL Editor，确认某用户是否真无数据）

```sql
select 'profiles' t, count(*) n from public.profiles  where user_id='fda327f1-bcde-4024-aad8-1f6b70bf988f'
union all select 'ledgers',      count(*) from public.ledgers      where user_id='fda327f1-bcde-4024-aad8-1f6b70bf988f'
union all select 'assets',       count(*) from public.assets       where user_id='fda327f1-bcde-4024-aad8-1f6b70bf988f'
union all select 'categories',   count(*) from public.categories   where user_id='fda327f1-bcde-4024-aad8-1f6b70bf988f'
union all select 'transactions', count(*) from public.transactions where user_id='fda327f1-bcde-4024-aad8-1f6b70bf988f'
union all select 'budgets',      count(*) from public.budgets      where user_id='fda327f1-bcde-4024-aad8-1f6b70bf988f';
```
