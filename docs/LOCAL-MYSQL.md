# 本机真实 MySQL 8.0 联调环境（LOCAL-MYSQL）

本文件记录这台开发机上**便携版 MySQL 8.0.43 + Spring Boot 真实启动**的落地方式与实测结论。
目的：把「迁移 SQL 只做过语法解析」变成「已在真实 MySQL 上执行并逐项验证过约束」。

- 数据库：MySQL Community Server **8.0.43**（Windows x64 官方 ZIP，便携运行）
- 监听：**127.0.0.1:3307**（刻意避开 3306）
- **不注册 Windows 服务**，全部是当前用户的普通进程；机器重启后需重新执行启动脚本。
- 应用：`server/target/jishiben-api.jar`（Spring Boot 3.3.5 / Java 21），由 Flyway 自动建表。

---

## 1. 目录与文件

| 路径 | 用途 |
| --- | --- |
| `.tools/mysql/` | MySQL 8.0.43 程序（ZIP 解压，可整体删除重建） |
| `.tools/mysql-data/` | **数据目录**（InnoDB 文件，删除即重置） |
| `.tools/mysql8.cnf` | 由启动脚本生成的 my.cnf（端口/字符集/日志路径） |
| `.tools/logs/` | `mysqld-error-3307.log`、`api.log`、`api.err.log`、`api.pid` |
| `.tools/downloads/` | 原始 ZIP（244,242,563 字节） |
| `.env.local` | 本机凭据：DB 口令 + JWT_SECRET（**已加入 .gitignore，绝不入库**） |
| `scripts/mysql-start.sh` | 初始化（幂等）+ 启动 + 建库建号 |
| `scripts/mysql-stop.sh` | 优雅关闭 |
| `scripts/mysql-reset.sh` | 删数据目录重建（表结构由下次启动 Flyway 重建） |
| `scripts/_mysql-secrets.sh` | 生成/读取 `.env.local`、幂等建库建号（被 start/reset 引用） |
| `scripts/api-start.sh` / `api-stop.sh` | 后台起停 Spring Boot |
| `scripts/verify-db.sh` | **约束验收**：CHECK / 唯一键 / SET NULL / RESTRICT 逐项实测 |
| `scripts/smoke-api.sh` | **接口冒烟**：注册→登录→账本→资产→分类→支出/收入/转账→报表 |

## 2. 起停

```bash
# 启动数据库（首次会自动 --initialize-insecure 初始化，之后幂等）
bash scripts/mysql-start.sh
# 期望输出中有：mysqld is alive
# 自检：
.tools/mysql/bin/mysqladmin --defaults-file=.tools/mysql8.cnf -u root -P3307 ping

# 启动应用（读取 .env.local，Flyway 自动迁移）
bash scripts/api-start.sh
curl -s http://127.0.0.1:8080/api/health

# 停止
bash scripts/api-stop.sh
bash scripts/mysql-stop.sh
```

启动脚本用 PowerShell `Start-Process` 把进程从当前 shell 的进程树里摘出去，所以脚本返回后
服务继续运行；但**当前 shell 被强杀**时子进程可能一起结束，重启后用上面的命令再起即可。

## 3. 端口与账号

- MySQL：`127.0.0.1:3307`，`bind-address=127.0.0.1`（不对外）。X Plugin 关闭（`mysqlx=0`），只占 TCP。
- API：`0.0.0.0:8080`（Spring 默认绑定所有网卡，本机联调可用 `http://127.0.0.1:8080`）。
- 账号来源**只有一个**：`.env.local`。由 `scripts/_mysql-secrets.sh` 用 .NET CSPRNG 生成：
  - `DB_USER=jishiben` / `DB_PASSWORD=` 24 字节随机 → 48 位十六进制
  - `JWT_SECRET=` 48 字节随机 → base64（64 字符，远大于 HS256 要求的 32 字节）
  - `DB_URL` 指向 3307，含 `allowPublicKeyRetrieval=true`（caching_sha2_password 需要）
- 授权范围：`jishiben`@`127.0.0.1` 与 `jishiben`@`localhost` 只对 `jishiben.*` 有权限。
- `root@localhost` 是 `--initialize-insecure` 建的**空密码**账号，仅本机 TCP 可达；
  生产/共享机器上不要这样用（本项目 `deploy/` 的 compose 用的是带口令的 root）。
- 注意：`.env.local` 的每个值都加了引号。`DB_URL` 里有 `&`，不加引号会被 shell 当作后台分隔符，
  结果变量被截断、应用回落到默认 3306 —— 这个坑已经在实测中踩过一次。

## 4. 重置

```bash
bash scripts/mysql-reset.sh     # 停库 -> 删 .tools/mysql-data -> 重新初始化 -> 起库 -> 重建库与账号
bash scripts/api-start.sh       # Flyway 重新应用 V1..V9
```

只想重来表结构、保留 MySQL？直接删库重建即可，Flyway 会全量重放：

```bash
.tools/mysql/bin/mysql --defaults-file=.tools/mysql8.cnf -u root -e \
  "DROP DATABASE jishiben; CREATE DATABASE jishiben CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
bash scripts/api-stop.sh && bash scripts/api-start.sh
```

轮换口令：删掉 `.env.local`，再跑一次 `scripts/mysql-start.sh`（自动生成新口令并 `ALTER USER`）。

## 5. 如何验证（可重复执行）

```bash
bash scripts/verify-db.sh    # 数据库约束验收
bash scripts/smoke-api.sh    # 接口全链路冒烟
```

### 5.1 实测通过的结论（2025-10-22，MySQL 8.0.43）

结构：`SHOW TABLES` = 11 张业务表 + `flyway_schema_history`（9 条 success，v1..v9）。

| 验收项 | 实测结果 |
| --- | --- |
| `budgets` 生成列 | `category_key bigint unsigned GENERATED ALWAYS AS (ifnull(category_id,0)) VIRTUAL` |
| `budgets` CHECK | `chk_budgets_scope`：total⇔category_id IS NULL，category⇔NOT NULL（**两个方向都拒**） |
| `transactions` 外键 | 6 条：user→CASCADE、ledger→RESTRICT、category/asset/from_asset/to_asset→SET NULL |
| `transactions` 索引 | `idx_transactions_user_date (user_id, occurred_on DESC)`，`information_schema.statistics.collation='D'` 已确认 |
| 插坏：scope=category 但 category_id NULL | `ERROR 3819 Check constraint 'chk_budgets_scope' is violated.` |
| 插坏：scope=total 却带 category_id | `ERROR 3819` 同上 |
| 插坏：`type='nope'` | `ERROR 3819 Check constraint 'chk_transactions_type' is violated.` |
| 插坏：同 `(user_id, client_uid)` 插两次 | `ERROR 1062 Duplicate entry '11-verify_tx_dup' for key 'transactions.uk_transactions_user_client_uid'` |
| 生成列唯一性（同币种第二条总预算） | `ERROR 1062 Duplicate entry '11-total-0-USD' for key 'budgets.uk_budgets_user_scope_category_currency'` |
| 删 assets | `transactions.asset_id` 由 `16` 变 `NULL`（SET NULL 生效） |
| 有子数据时删 ledger | `ERROR 1451 ... fk_transactions_ledger ... ON DELETE RESTRICT` |

### 5.2 冒烟链路（真实状态码）

`GET /api/health` 200 → `POST /api/auth/register` 201 → `POST /api/auth/login` 200 →
`PUT /api/ledgers` 200 → `PUT /api/assets`×2 200 → `PUT /api/categories` 200 →
`PUT /api/transactions`×3（expense / income / transfer）200 → `GET /api/reports/summary` 200。

报表按币种分块、且转账不进收支（50 CNY 的转账没有出现在任何一块里）：

```json
{"from":"2026-10-01","to":"2026-10-22","currencies":[
  {"currency":"CNY","income":0.0000,"expense":100.0000,"net":-100.0000,"transactionCount":1,...},
  {"currency":"USD","income":500.0000,"expense":0.0000,"net":500.0000,"transactionCount":1,...}]}
```

`/api/reports/asset-balances`：CNY 余额 850.0000（1000 − 100 支出 − 50 转出）、
USD 余额 607.0000（100 + 500 收入 + 7 转入），`totalsByCurrency` 分块、不跨币种相加。

## 6. 与仓库里原设计的一处**必要偏差**（已改 `server/src`，需知会）

`V6__create_budgets.sql` 原本用 **STORED** 生成列 `category_key`，同时 `fk_budgets_category`
带 `ON DELETE CASCADE`。这个组合在真实 MySQL 上**建表直接失败**：

```
ERROR 1215 (HY000): Cannot add foreign key constraint
```

原因（实测矩阵确认，不是猜测）：MySQL 禁止「存储生成列的基列」带 CASCADE / SET NULL 引用动作。

| 组合 | 结果 |
| --- | --- |
| STORED 生成列 + FK `ON DELETE CASCADE` | ✗ 1215 |
| STORED 生成列 + FK `ON DELETE SET NULL` | ✗ 1215 |
| STORED 生成列 + FK `ON DELETE RESTRICT` | ✓ |
| **VIRTUAL 生成列 + FK `ON DELETE CASCADE`** | ✓ |
| VIRTUAL 生成列 + FK `ON DELETE SET NULL` | ✓ |

因此只改了**一个词**：`STORED` → `VIRTUAL`（并在迁移文件里写明原因）。
语义不变：删分类仍然级联删预算；唯一索引建在虚拟列上同样生效（实测两条 NULL 总预算撞唯一键）。
副作用：生成列不再物化存储（不可用于覆盖索引），本场景没有必要物化。

> 待办（本次未做，因为 `docs/` 下已有文件不在本次改动范围内）：
> `docs/DB-SCHEMA.md` 里若写了 「STORED」，需同步改为 VIRTUAL + 上述原因。

## 7. 已知限制 / 风险（如实记录）

1. **数据目录在 OneDrive 同步目录内**（`Desktop/jishiben/.tools/mysql-data`）。OneDrive 后台同步
   正在被 InnoDB 打开的文件，理论上可能导致文件锁冲突或同步噪声。若出现异常，可把数据目录移到
   非同步路径（改 `.tools/mysql8.cnf` 的 `datadir` + `scripts/mysql-start.sh` 的 `DATADIR`）。
2. **没有 Windows 服务**：机器重启 / 用户注销后需要手动 `bash scripts/mysql-start.sh && bash scripts/api-start.sh`。
3. **API 监听 0.0.0.0:8080**，本机局域网内其他机器可访问；数据库只监听回环。
4. `root` 空密码（`--initialize-insecure` 的默认结果），仅限本机回环可连，勿在共享机器复用。
5. 迁移文件是**打进 jar 的**（`classpath:db/migration`）。改了 `.sql` 必须
   `cd server && JAVA_HOME="..." sh ../.tools/apache-maven-3.9.16/bin/mvn -B -DskipTests package` 重新打包，否则应用仍用旧 SQL。
6. `javax`/`unzip`/`nohup`/`openssl`/`git` 在这台机器的 bash 里并不都存在：脚本已按实际情况
   改用 `tar`（bsdtar，支持 zip）解压、PowerShell `Start-Process` 后台启动、.NET CSPRNG 生成随机串。
