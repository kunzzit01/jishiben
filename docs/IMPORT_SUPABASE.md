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
#    ⚠️ 必须带 --default-character-set=utf8mb4，否则中文会被按本地编码二次编码成乱码
scp import.sql root@<vps>:/opt/jishiben/
ssh root@<vps> 'cd /opt/jishiben && \
  docker exec -i jishiben-mysql sh -c \
  \'mysql --default-character-set=utf8mb4 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"\' < import.sql'

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

---

## 实测记录（2026-10-23，真实备份数据）

源：用户提供的 `supabase-backup.zip` → `export-2026-10-23/`

```
SQL 语句数            185
补建占位账本          1（1788744197635-ipcoych，被 19 笔流水引用但导出中缺失）

导入后 DB             ledgers=6  assets=16  categories=90  category_groups=15
                      transactions=54  budgets=3
经 /api 校验（size=200）
                      流水 54 / total=54；账户 16；分类 90；账本 6；预算 3
按币种汇总（与源 JSON 逐项比对，完全一致）
                      MYR  支出 11,093.60   收入 50,655.00
                      USD  支出 0.00        收入 0.00
                      CNY  支出 100.00      收入 100.00
```

注意：`GET /api/transactions` 默认分页 50 条，核对总数要带 `?size=200`（或看 `totalElements`）。

## 在 VPS 上执行的完整命令

```bash
cd /opt/jishiben

# 1) 目标账号必须已存在（导入挂在这个账号下）
curl -X POST http://127.0.0.1:8088/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"mingsoon249@gmail.com","password":"12345678","displayName":"Ming Soon"}'

# 2) 执行导入（import.sql 由本地脚本生成后上传）
docker exec -i jishiben-mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' < import.sql

# 3) 核对（脚本末尾已自动打印一张表，这里再手工查一次）
docker exec -it jishiben-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e "
SET @u := (SELECT id FROM users WHERE email=\"mingsoon249@gmail.com\");
SELECT COUNT(*) AS tx FROM transactions WHERE user_id=@u;
SELECT currency, FORMAT(SUM(IF(type=\"expense\",amount,0)),2) exp,
                 FORMAT(SUM(IF(type=\"income\",amount,0)),2) inc
FROM transactions WHERE user_id=@u GROUP BY currency;"'
```


## ⚠️ 字符集（实测踩过）

第一次导入时没指定客户端字符集，结果中文全部变成二次编码乱码：

```
恢复的账本  →  µüóÕñìþÜäÞ┤ªµ£¼
餐饮        →  ÚñÉÚÑ«
```

原因：Windows 版 `mysql` 客户端默认按本地代码页读取 SQL 文件，把 UTF-8 字节当成了其它编码。

**正确做法**：导入与查询都加 `--default-character-set=utf8mb4`

```bash
mysql --default-character-set=utf8mb4 -u... -p... db < import.sql
```

修复后实测（经 /api 校验）：

```
账本: T1 / T / Tz / Ta / 2 / 恢复的账本 oych
分类: 餐饮 / 购物 / 日用 / 交通 / 蔬菜 / 水果 / 零食 / 运动
备注: 唐茶 | GX | 转账手续费（Cash）
```


---

## 账号表（auth.users）——业务数据之外的唯一缺口

`export.mjs` 只导了 8 张业务表，**没有 `auth.users`**（邮箱、密码哈希都在那里）。
所以「有几个人注册过」这份备份回答不了，只能回答「有几个人写过业务数据」。

### 好消息：密码哈希可以直接复用

| | Supabase | 本项目 |
|---|---|---|
| 字段 | `auth.users.encrypted_password` | `users.password_hash` |
| 算法 | bcrypt（`$2a$` / `$2b$`） | Spring BCrypt（`$2a$`） |

两者兼容，**直接复制哈希**，用户继续用原密码登录，不需要重设。

### 在 Supabase 控制台导出

Dashboard → SQL Editor → 执行：

```sql
select id, email, encrypted_password, created_at, last_sign_in_at
from auth.users
order by created_at;
```

结果面板右上角 **Download CSV**，保存为 `auth-users.csv`。

> ⚠️ 这个 CSV 含密码哈希（不可逆，但仍是敏感数据）：不要提交到仓库、不要发群、导入后删除。

### 导入

```bash
node scripts/import-auth-users.mjs --in auth-users.csv --out users.sql

# 本地
mysql --default-character-set=utf8mb4 -u... -p... jishiben < users.sql

# 服务器
ssh root@<vps> 'cd /opt/jishiben && docker exec -i jishiben-mysql sh -c \
  \'mysql --default-character-set=utf8mb4 -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"\' < users.sql'
```

脚本会：
1. 用 `email` 建账号，`password_hash` 直接取 Supabase 的 bcrypt 值；
2. 建一条 `profiles` 默认行；
3. 建临时表 `supa_user_map(supa_uid, email)`，把 Supabase UUID 映射到本地 uid ——
   业务数据脚本可以据此**按人分配**，而不是全部塞进一个账号；
4. 全部语句带 `ON DUPLICATE KEY UPDATE`，重复执行安全。

### 核对

```sql
SELECT m.supa_uid, m.email, u.id AS local_uid
FROM supa_user_map m JOIN users u ON u.email = m.email;
```
