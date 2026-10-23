# DB-SCHEMA.md — jishiben MySQL 8 数据模型（本次地基任务的权威说明）

> 权威来源：`docs/FEATURES.md` §4「数据模型」（8 张业务表 + push_tokens + exchange_rates）与
> `_repo/jishiben/supabase/schema.sql`、`supabase/push_tokens.sql`（列级事实）。
> 本文件描述 **MySQL 8 版** 的落地形态；迁移脚本在 `server/src/main/resources/db/migration/`。
> 空库起步，不迁 Supabase 数据。

---

## 1. 全局约定（所有表硬性遵守）

| 维度 | 约定 | 理由 |
|---|---|---|
| 引擎 | `InnoDB` | 需要事务 + 行锁 + 外键；流水/预算的并发扣账依赖它 |
| 字符集 | `utf8mb4` | 备注、分类名、账户名都可能含 emoji 与中文；`utf8`(3 字节) 存不下 emoji |
| 排序规则 | `utf8mb4_0900_ai_ci` | MySQL 8 默认 UCA 9.0.0，大小写/重音不敏感；邮箱唯一性天然不区分大小写 |
| 主键 | `BIGINT UNSIGNED AUTO_INCREMENT` | 8 字节，够用且不迁移；对外同步用 `client_uid`（见 §2） |
| 审计列 | 每表都有 `created_at` / `updated_at`，后者 `ON UPDATE CURRENT_TIMESTAMP` | 与 Supabase 的 `moddatetime` 触发器等价，且不需要触发器 |
| 时间类型 | `DATETIME` + 应用侧 UTC | 全链路 UTC（`spring.jpa.properties.hibernate.jdbc.time_zone=UTC`、容器 `TZ=UTC`、`--default-time-zone=+00:00`） |
| 金额 | `DECIMAL(19,4)`，**禁止 FLOAT/DOUBLE** | 现有 App 用 double 是已知缺陷（FEATURES §4.3）；浮点在「余额累加 + 手续费」上会放大误差 |
| 汇率 | `DECIMAL(19,8)` | 8 位小数足以承载 JPY→USD 这类小数值汇率，且仍是定点数 |
| 币种 | `CHAR(3)` | 47 种内置币种全为 ISO-4217 三字母 |
| 软删/归档 | `archived_at DATETIME NULL`（账户/账本/分类/大类/计划付款） | 对齐现有 `assets.archived_at` 的归档语义；流水不软删（App 侧是硬删 + 同步墓碑） |

---

## 2. 主键与 `client_uid`：为什么要两套 id

现有 App 在离线状态下生成**字符串 id**（`types/index.ts`，如 `led_1699...`），上云时 Supabase 直接拿它当主键。
MySQL 版按硬性约定改用 `BIGINT UNSIGNED` 自增主键，同时保留：

- `client_uid VARCHAR(64) NOT NULL`：App 生成的原始 id；
- `UNIQUE KEY uk_<table>_user_client_uid (user_id, client_uid)`：**同步幂等键**。

作用：同一台设备断网重连、同一笔流水被 push 两次，服务端用 `(user_id, client_uid)` 做 upsert，
不会产生重复行；表间关联则统一走 BIGINT 外键（比 Supabase 的 text 弱引用可校验）。

例外：`users`（无 client_uid，邮箱唯一）、`profiles`（每用户一行，`user_id` 唯一）、
`exchange_rates`（`base` 唯一）、`push_tokens`（`token` 唯一）。

---

## 3. 表清单与字段含义

共 **11 张表** = 10 张业务表（含补齐的 `payment_plans`）+ 1 张认证主体 `users`。

### 3.1 users — 认证主体（替代 Supabase `auth.users`）

| 列 | 类型 | 含义 |
|---|---|---|
| id | BIGINT UNSIGNED PK | 主键 |
| email | VARCHAR(255) | 登录邮箱，全局唯一 |
| password_hash | VARCHAR(100) | BCrypt/Argon2 哈希，**绝不存明文** |
| display_name | VARCHAR(100) | 昵称 |
| user_role | VARCHAR(20) | `USER`/`ADMIN`（`ROLE` 是 MySQL 8 保留字，故加前缀） |
| email_verified_at | DATETIME | 验证时间，NULL = 未验证 |
| token_version | INT UNSIGNED | 改密/登出全部设备时 +1，使旧 JWT 立刻失效 |
| last_login_at | DATETIME | 最近登录 |
| created_at / updated_at | DATETIME | 审计列 |

### 3.2 profiles — 用户资料与显示设置（每用户一行）

`user_id`（唯一）、`display_name`、`currency`（全局兜底币种，默认 `MYR`）、`date_format`、
`week_starts_on`（0/1）、`decimal_places`（0/1/2）、`period_preference JSON`、
`active_ledger_id`（→ ledgers，删账本置 NULL）。

对应 FEATURES §5.4 的 5 个「数据层就绪、UI 不存在」的死设置：列在这里，UI 由后续任务补。

### 3.3 ledgers — 账本

`user_id`、`client_uid`、`name`、`icon`、`color`、`sort_order`、`is_default`（默认账本不可删）、`archived_at`。

### 3.4 assets — 资产账户

`user_id`、`client_uid`、`ledger_id`、`name`、`icon`、`color`、`type`（cash/bank/credit/ewallet/investment/other）、
`currency`、`initial_balance DECIMAL(19,4)`、`credit_limit`、`statement_day`、`due_day`、
`interest_rate DECIMAL(9,6)`（0.185000 = 18.5%）、`is_default`、`sort_order`、`archived_at`。

信用卡字段全部可空 —— 只有 `type='credit'` 才有意义，用 `chk_assets_*` 约束日期范围（1-31）。

### 3.5 category_groups — 收支大类

`user_id`、`client_uid`（App 用大类名当 id）、`name`、`color`、`icon`、`type`（expense/income）、`sort_order`、`archived_at`。
`(user_id, name)` 唯一：App 里同名大类不可重复。

### 3.6 categories — 收支分类

`user_id`、`client_uid`、`group_id`（→ category_groups，**可为空 = 未分组**）、`name`、`icon`、`color`、`type`、`sort_order`、`archived_at`。

> 与 Supabase 的差异：原表 `group_name` 存**名字**而不是外键（怕删大类时约束报错）。
> 这里改为真外键 + `ON DELETE SET NULL`：删大类不会报错，分类自动变「未分组」，
> 同时数据库能校验引用完整性。同步层负责 `group_name → group_id` 的解析。

### 3.7 transactions — 流水（支出/收入/转账/汇兑）

| 列 | 类型 | 含义 |
|---|---|---|
| user_id / client_uid | BIGINT / VARCHAR(64) | 归属与幂等键 |
| ledger_id | BIGINT NOT NULL | → ledgers |
| category_id | BIGINT NULL | → categories；App 的空串 `''` 入库前规范化为 NULL |
| asset_id / from_asset_id / to_asset_id | BIGINT NULL | 单账户 / 转账转出 / 转入 |
| type | VARCHAR(16) | expense / income / transfer |
| amount | DECIMAL(19,4) | 交易金额（转出侧） |
| currency | CHAR(3) | 金额币种**快照** |
| exchange_rate | DECIMAL(19,8) | 用户手填汇率 |
| converted_amount | DECIMAL(19,4) | 转入侧金额 = amount × exchange_rate |
| fee | DECIMAL(19,4) | 手续费（App 会另生成一笔 fee 支出） |
| occurred_on | DATE | 业务日期（Supabase 用 text 存 `YYYY-MM-DD`） |
| note / display_name / receipt_path | VARCHAR | 备注 / 无分类时的标题 / 小票路径 |

三处**刻意升级**：
1. 金额/汇率改定点数；
2. `asset_id`/`from_asset_id`/`to_asset_id` 从「仅 id 弱引用」升级为真外键 `ON DELETE SET NULL`
   —— 账户被删后历史流水保留，但不会指向不存在的账户；
3. 新增 `currency` 快照：产品级硬规则是「按币种分组、绝不跨币种相加」（FEATURES §4.2），
   而转账两侧可能不同币种；靠 join assets 既慢，账户删除后还会失真。

### 3.8 budgets — 预算

`scope`（`total` = 总预算 / `category` = 分类预算）、`category_id`（仅 `scope='category'` 有值）、
`category_key`（**VIRTUAL** 生成列 = `IFNULL(category_id,0)`）、`currency`、`amount DECIMAL(19,4)`。

生成列**必须是 `VIRTUAL`，不能是 `STORED`**：`category_key` 的基列 `category_id` 上有
`fk_budgets_category ... ON DELETE CASCADE`，而 MySQL 禁止「存储生成列的基列」带 `CASCADE` / `SET NULL`
引用动作 —— `STORED` 时建表直接 `ERROR 1215 (HY000) Cannot add foreign key constraint`（真实 8.0.43 上实测）。
改 `VIRTUAL` 后语义不变：唯一索引在虚拟列上同样生效，所以「总预算只能有一条」照样成立。

Supabase 用 `id = categoryId + '|' + currency` 造确定性主键，并用 `categoryId='total'` 这个魔法字符串表示总预算。
MySQL 版改用显式 `scope` + 可空外键 + `CHECK` 约束；唯一键落在生成列上，因为 **NULL 不参与唯一约束**，
否则「总预算」可以插入任意多条。

### 3.9 payment_plans — 计划付款（本次补齐）

Supabase 没有这张表，App 只存在 AsyncStorage，换设备即丢（FEATURES §4.1 缺口）。
字段按 `types/index.ts` 的 `PaymentPlan` 对齐：`cycle`(weekly/monthly/yearly)、`day_of_week`/`day_of_month`/`month_of_year`/`day`、
`start_date`/`end_date`、`auto_deduct`、`last_processed_date`（补账游标，上限 24 期）、`active`、`archived_at`。

### 3.10 push_tokens — 推送设备

`user_id`、`token`（全局唯一，VARCHAR(191) 保证 utf8mb4 索引安全）、`platform`（ios/android/web）、`last_seen_at`。

### 3.11 exchange_rates — 汇率缓存

`base CHAR(3)`（唯一）、`rates JSON`、`fetched_at`。24h 过期判定用 `fetched_at`。

> `rates` 保留 JSON 原始响应，新增币种无需改表；**参与计算的汇率不要从这个 JSON 取**，
> 用 `transactions.exchange_rate DECIMAL(19,8)`。

---

## 4. 索引与外键：逐条理由

### 4.1 `user_id` 索引（硬性要求，全部显式声明）

每张业务表都有 `KEY idx_<table>_user_id (user_id)`。理由：

1. **RLS 的替代品**：Supabase 靠 `auth.uid()` 行级策略隔离，MySQL 没有 RLS，
   所有查询都必须带 `WHERE user_id = ?`；这个索引是所有业务查询的最左过滤条件。
2. **外键要求**：InnoDB 要求外键列有索引，显式声明比隐式自动创建更可控。
3. **冗余说明（已知且有意）**：`uk_<table>_user_client_uid (user_id, client_uid)` 已含 `user_id` 最左前缀，
   单列索引在优化器看来部分冗余。保留它是为了让「每表 user_id 必须有索引」这条约定在 DDL 里可直接核对，
   代价是每行多一个 B 树条目。个人账本数据量（万级）下可忽略；若后续写放大成为问题，
   删掉单列索引不会改变任何语义。

### 4.2 各表附加索引

| 索引 | 表 | 理由 |
|---|---|---|
| `uk_*_user_client_uid (user_id, client_uid)` | ledgers/assets/category_groups/categories/transactions/budgets/payment_plans | 同步幂等键；离线 upsert 的唯一冲突目标 |
| `uk_categories/…_user_name` | category_groups | App 内同名大类唯一 |
| `idx_transactions_user_date (user_id, occurred_on DESC)` | transactions | 首页按月分组列表的主查询（原 Supabase 已有同名索引） |
| `idx_transactions_user_ledger_date (user_id, ledger_id, occurred_on DESC)` | transactions | 按账本筛选的列表/统计 |
| `idx_transactions_user_category (user_id, category_id, occurred_on)` | transactions | 分类排行（ReportScreen 饼图 / 分类聚合） |
| `idx_transactions_user_asset (user_id, asset_id, occurred_on)` | transactions | 账户余额与「本月流入流出」 |
| `idx_transactions_{ledger,category,asset,from_asset,to_asset}_id` | transactions | 外键必需索引（`ON DELETE SET NULL` 需要反查引用行）。代价：热表 11 个索引，写入有放大；个人账本写入频率低，可接受 |
| `idx_assets_user_ledger (user_id, ledger_id)` | assets | 账户列表按账本筛选 |
| `idx_assets_user_archived (user_id, archived_at)` | assets | 归档区折叠查询 |
| `idx_categories_user_group (user_id, group_id)` | categories | 大类下钻分类九宫格 |
| `idx_categories_user_type (user_id, type, sort_order)` | categories | 记账页按收支类型取分类并排序 |
| `idx_assets_ledger_id` / `idx_categories_group_id` / `idx_budgets_category_id` | assets / categories / budgets | 外键索引：`RESTRICT`/`SET NULL`/`CASCADE` 都要按父键反查子行，InnoDB 要求外键列有「最左前缀」索引；`(user_id, ledger_id)` 这类复合索引不满足，故显式补单列索引，避免 InnoDB 隐式建同名索引（名字不可控） |
| `uk_budgets_user_scope_category_currency` | budgets | 「同一分类同一币种只有一条预算」这一业务不变量的数据库级保证 |
| `idx_payment_plans_user_active (user_id, active, start_date)` | payment_plans | 每日定时任务扫描「启用且已到期待处理」的计划 |
| `uk_push_tokens_token` | push_tokens | 一个 Expo token 只应绑定一个用户；重新注册时用 upsert 换主 |
| `uk_exchange_rates_base`, `idx_exchange_rates_fetched_at` | exchange_rates | 每基准币种一条；按抓取时间判 24h 过期 |

### 4.3 外键策略（不是所有删都级联）

| 子表.列 | 父表 | 动作 | 理由 |
|---|---|---|---|
| 全部业务表 `user_id` | users | `ON DELETE CASCADE` | 注销账号必须一并清空个人数据（GDPR 式删除），且没有「无主数据」的合法状态 |
| assets/transactions/payment_plans `ledger_id` | ledgers | `ON DELETE RESTRICT` | 账本下挂着数据时禁止直接删；App 侧逻辑是先迁移/清空再删。数据库兜底防止孤儿流水 |
| categories `group_id` | category_groups | `ON DELETE SET NULL` | 删大类不该连坐分类，分类退化为「未分组」（对齐原设计顾虑） |
| transactions `category_id`、payment_plans `category_id` | categories | `ON DELETE SET NULL` | 分类是标签而非所有者；历史流水必须保留 |
| transactions `asset_id/from_asset_id/to_asset_id`、payment_plans `asset_id` | assets | `ON DELETE SET NULL` | 账户归档/删除后流水仍要能看（Supabase 版是弱引用，这里升级为可校验外键） |
| budgets `category_id` | categories | `ON DELETE CASCADE` | 分类没了，它的预算额度就是无意义数据 |
| profiles `active_ledger_id` | ledgers | `ON DELETE SET NULL` | 删掉当前账本后回到「无选中」，由 App 选默认账本 |

> 注意：`RESTRICT` 意味着删除顺序有讲究（先删流水/账户，再删账本）。这正是想要的效果 ——
> 静默丢数据比报错更糟。

---

## 5. Supabase(PostgreSQL) → MySQL 8 类型映射

| Supabase / PG | MySQL 8 | 说明 |
|---|---|---|
| `uuid` | `BIGINT UNSIGNED`（`users.id`） | 不迁移数据，改用自增整数；对外仍然是用户可见 id |
| `text` 存主键（App 生成的 id） | `client_uid VARCHAR(64)` + 唯一键 | 见 §2 |
| `bigint`（App 的 `Date.now()` 毫秒） | 不保留该语义，改用 `DATETIME` | 毫秒时间戳只用于端侧排序；服务端以 UTC 时间为准，避免客户端时钟漂移 |
| `timestamptz` | `DATETIME`（全链路 UTC） | MySQL 的 `TIMESTAMP` 只在 2038 年前有效且受会话时区影响；`DATETIME` + 应用侧 UTC 更稳 |
| `smallint`（week_starts_on / statement_day / decimal_places） | `TINYINT UNSIGNED` | 值域由 `CHECK` 约束 |
| `numeric`（金额） | `DECIMAL(19,4)` | **禁止 FLOAT/DOUBLE**（FEATURES §4.3 的精度缺陷不再继承） |
| `numeric`（汇率） | `DECIMAL(19,8)` | 汇率需要比金额更多小数位 |
| `numeric`（利率） | `DECIMAL(9,6)` | 0.185000 = 18.5% |
| `jsonb`（`period_preference`、`rates`） | `JSON` | MySQL 8 的 JSON 是二进制存储，支持 `->>` 路径查询；但没有 jsonb 的 GIN 索引，本项目的 JSON 只读整块，无需索引 |
| `boolean` | `TINYINT(1)` | 保持 ORM/JDBC 的 boolean 映射习惯 |
| `date` 存 text（`YYYY-MM-DD`） | `DATE` | 原表把日期存字符串，无法做范围/排序优化；改原生 DATE 后 `occurred_on` 可索引 |
| `text` 存颜色 | `CHAR(7)` | `#RRGGBB` 定长 |
| `text` 存币种 | `CHAR(3)` | ISO-4217 |
| `create extension moddatetime` + 触发器 | `ON UPDATE CURRENT_TIMESTAMP` | 少一个触发器，行为等价 |
| RLS `user_id = auth.uid()` | 应用层强制 `user_id` 过滤 + `user_id` 索引 | MySQL 无 RLS；由 Spring Security 的认证上下文统一注入，Repository 层禁止裸查询 |
| `storage.buckets`（小票桶） | 本次不建表 | 单机部署先用文件系统 + `transactions.receipt_path`；对象存储属后续任务 |

---

## 6. 迁移文件清单（Flyway）

`server/src/main/resources/db/migration/`，命名 `V<n>__<desc>.sql`，`application.yml` 中
`spring.flyway.locations=classpath:db/migration`。

| 版本 | 文件 | 内容 |
|---|---|---|
| V1 | `V1__create_users.sql` | users |
| V2 | `V2__create_ledgers_and_profiles.sql` | ledgers → profiles（含 `active_ledger_id` 外键） |
| V3 | `V3__create_assets.sql` | assets |
| V4 | `V4__create_category_groups_and_categories.sql` | category_groups → categories |
| V5 | `V5__create_transactions.sql` | transactions（最大表，11 个索引） |
| V6 | `V6__create_budgets.sql` | budgets（生成列 + scope 约束） |
| V7 | `V7__create_payment_plans.sql` | payment_plans（补齐云端缺口） |
| V8 | `V8__create_push_tokens.sql` | push_tokens |
| V9 | `V9__create_exchange_rates.sql` | exchange_rates |

规则：

- **已发布的迁移文件永不修改**（Flyway 的 checksum 会拒绝启动）；改结构一律新增 V10、V11…
- 顺序依赖靠文件名，不要依赖 `out-of-order`（`spring.flyway.out-of-order=false`）。
- `spring.flyway.clean-disabled=true`：禁止 `flyway:clean` 在部署机上误清库。
- `baseline-on-migrate=false`：空库起步，不存在「已有库打基线」的情况。

---

## 7. 部署、备份与恢复

- `deploy/docker-compose.yml`：mysql（健康检查）+ api（`depends_on: service_healthy`）+ nginx（唯一对外端口）。
- `deploy/backup.sh`：`mysqldump --single-transaction | gzip -9`，产出 `.sql.gz` + `.sha256` + `.counts`（关键表行数快照），
  口令经容器内 `MYSQL_PWD` 传递，不出现在 `ps` 参数里。
- `deploy/restore.sh`：先验 `.sha256` 与 gzip 完整性 → 记录恢复前各表行数 → 导入 → **逐表对账**
  （与 `.counts` 完全一致才算通过，否则退出码 1）。
- 环境变量模板：仓库根 `.env.example` → 复制为 `deploy/.env`（已 gitignore）。

---

## 8. 本次未能在本机验证的部分（诚实记录）

本机没有 Docker、没有 MySQL 服务端/客户端，因此以下内容**只做了静态检查，未做运行时验证**：

1. 迁移脚本**没有在真实 MySQL 8 上执行过** —— `CHECK` 约束、VIRTUAL 生成列（原写 STORED，实测会
   `ERROR 1215`，见 §3.8）、`occurred_on DATE` 上的
   `DESC` 索引、`json` 默认值等语法只做了人工核对。
2. `docker compose config` / `docker compose up` 未执行；健康检查脚本的真实行为未验证。
3. `backup.sh` / `restore.sh` 只通过 `bash -n` 语法检查，未在真实 `mysqldump` 上跑通。
4. Hikari + `ddl-auto=validate` 在真实连接下的启动行为未验证（当前无任何 JPA 实体，validate 不校验任何表）。
5. Flyway checksum 基线未生成（首次启动时才写入 `flyway_schema_history`）。

**上真机时的第一条命令**（部署机上）：

```bash
docker compose -f deploy/docker-compose.yml up -d mysql
docker compose -f deploy/docker-compose.yml logs -f mysql     # 等 healthy
curl -sf http://localhost/api/health                          # 经 nginx 探活
```
