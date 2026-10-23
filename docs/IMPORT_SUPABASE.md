# 从 Supabase 导出导入到本项目 MySQL

> 适用：用户提供 `supabase-backup.zip`（按表拆分的 JSON），需要搬进本项目的自研后端。

## 为什么不能直接导入

| 项 | Supabase | 本项目 |
|---|---|---|
| 数据库 | PostgreSQL | MySQL 8 |
| 主键 | UUID / text | BIGINT 自增 |
| 表间关联 | text id 直接互指 | 真外键 + `client_uid`（App 生成的字符串 id） |
| 金额 | float / numeric | `DECIMAL(19,4)` |
| 预算 | `id = "total|CNY"` | `scope` 列 + 可空外键 |
| 分类分组 | `categories.group_name` 文本 | `category_groups` 表 + `group_id` 外键 |

所以必须做一次**结构翻译**：保留 `client_uid`（原 id），把所有 text 关联换成正查子查询。

## 一键生成 SQL

```bash
node scripts/import-supabase.mjs \
  --in  <解压后的导出目录> \
  --email <接收数据的账号邮箱> \
  --out import.sql
```

生成的 SQL 以 `SET @uid := (SELECT id FROM users WHERE email = '...')` 开头，
**所有 INSERT 都挂在这个账号下**；账号不存在时 @uid 为 NULL，导入会因外键失败而中止（不会污染别人数据）。

## 推荐流程（服务器上没有 node 也行）

```bash
# 1) 先在 App 里注册账号（或 curl 注册），记下邮箱
curl -X POST http://127.0.0.1:8088/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"至少8位","displayName":"你的名字"}'

# 2) 本地生成 SQL（Windows/Mac 都行）
node scripts/import-supabase.mjs --in ./supabase-backup/export-2026-10-23 \
     --email you@example.com --out import.sql

# 3) 上传并执行（走容器里的 mysql 客户端，不依赖宿主机装 mysql）
scp import.sql root@<vps>:/opt/jishiben/
ssh root@<vps> 'cd /opt/jishiben && \
  docker exec -i jishiben-mysql sh -c \
  \'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"\' < import.sql'

# 4) 看脚本末尾自动打印的核对表（ledgers/assets/categories/transactions/budgets 行数）
```

## 校验（务必手工再做一次）

```bash
docker exec -it jishiben-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "
SET @u := (SELECT id FROM users WHERE email=\"you@example.com\");
SELECT currency,
       FORMAT(SUM(IF(type=\"expense\", amount, 0)),2) AS expense,
       FORMAT(SUM(IF(type=\"income\", amount, 0)),2)  AS income,
       COUNT(*) AS n
FROM transactions WHERE user_id=@u GROUP BY currency;"'
```

把结果与源 JSON 的汇总对比（本项目验证过一次：MYR 支出 11,093.60 / 收入 50,655.00 / 48 笔，完全一致）。

## 导入脚本会处理的坑

1. **缺失账本**：导出里出现「流水引用了某个账本，但账本表没这一行」（账本被删过、流水残留）。
   脚本按原 id 补建一个 `恢复的账本 xxxx` 占位行，而不是把流水塞进默认账本——
   后者会篡改用户历史。用户可在 App 里重命名或删除它。
2. **缺失账户/分类**：关联置 NULL（`transactions.asset_id` 可空），不影响流水金额与日期。
3. **category_groups 为空**：Supabase 把分组名直接存在 `categories.group_name` 上，
   脚本按去重结果补建 `category_groups` 行，再回填 `categories.group_id`。
4. **时间字段混用**：导出里既有 ISO 字符串也有 epoch 毫秒，脚本统一转 `DATETIME`（UTC）。
5. **幂等**：全部语句带 `ON DUPLICATE KEY UPDATE`，重复执行不会产生重复数据。

## 回滚

```sql
SET @u := (SELECT id FROM users WHERE email='you@example.com');
DELETE FROM transactions   WHERE user_id=@u;
DELETE FROM budgets        WHERE user_id=@u;
DELETE FROM assets         WHERE user_id=@u;
DELETE FROM categories     WHERE user_id=@u;
DELETE FROM category_groups WHERE user_id=@u;
DELETE FROM ledgers        WHERE user_id=@u;
DELETE FROM profiles       WHERE user_id=@u;
DELETE FROM users          WHERE id=@u;   -- 连账号一起删
```

（按此顺序删，否则 `fk_transactions_ledger` 的 RESTRICT 会拦住。）
