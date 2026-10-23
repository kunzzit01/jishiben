# API.md — jishiben 自建后端接口契约

> 本文件是 App 从「直连 Supabase PostgREST」切换到本服务的唯一接口契约。
> 权威实现：`server/src/main/java/com/jishiben/api/**`。业务语义依据 `docs/FEATURES.md`，
> 表结构依据 `docs/DB-SCHEMA.md`。
> **2026-10 更新**：本机已跑起 MySQL 8.0.43（端口 3307），Flyway v1..v9 全部 success，
> `scripts/api-smoke.mjs` 全绿；下文标注「实测」的取值都来自该环境（见文末「已知限制」）。

---

## 1. 基础约定

| 项 | 约定 |
|---|---|
| Base URL | 单机部署经 nginx 暴露：`https://<host>/api`；直连：`http://<host>:8080/api` |
| 传输 | 仅 JSON，UTF-8。请求 `Content-Type: application/json` |
| 字段命名 | **camelCase**（与 App 的 `src/types/index.ts` 一致），不是 Supabase 时代的 snake_case。客户端不再需要 `toRow/fromRow` 转换 |
| 身份 | 只有 `Authorization: Bearer <accessToken>`。**任何端点都不接受 userId 参数**；服务端从 JWT 取账户，所有查询都带该账户过滤 |
| 金额 | 一律 `BigDecimal`，入库 `DECIMAL(19,4)`。**JSON 里是数字（number），不是字符串**：实测响应就是 `23.5`，不是更早版本文档写的 `"23.5000"`。数值恒按 4 位小数参与运算，但序列化不补尾零（`23.5` / `26` / `0.1`），也绝不出现 `1.25E1`。客户端不要把金额当字符串解析；比较时按 4 位小数的最小单位比，不要用浮点相等 |
| 汇率 | `DECIMAL(19,8)`，例如 `3.50000000` |
| 日期 | `occurredOn` / `startDate` / `endDate` 用 `YYYY-MM-DD`（`LocalDate`）；`createdAt`/`updatedAt` 是 UTC ISO-8601 时间戳，**精度到秒**（库列是 `DATETIME`，响应回显的就是落库值，如 `2024-05-01T09:10:00Z`，不带纳秒） |
| 币种 | ISO-4217 三字母大写（`MYR`/`CNY`/`USD`） |
| 幂等 | 所有写接口按业务键 **upsert**；带 `clientUid` 的表用 `(user_id, client_uid)` 唯一键。响应**一定回传 `clientUid`**，App 用它对齐本地离线数据。重放同一 `clientUid` **不会改变 `createdAt`**（保留首次写入值），只有 `updatedAt` 刷新 |
| 分页 | 只有 `GET /api/transactions` 分页，返回 `{content,page,size,totalElements,totalPages}`；`size` 上限 100 |
| 空值 | 响应里 **null 字段被整体省略**（Jackson `NON_NULL`）：没有分类就**没有** `categoryUid` 这个键，而不是 `"categoryUid": null`。客户端必须把「键不存在」和 `null` 当同一件事 |

### 1.1 外部 id 与内部 id

对外只暴露 **`clientUid`**（App 生成的字符串 id）。数据库自增主键 **绝不出现在响应里**。
请求体里引用其它表时也用 `clientUid`（`ledgerUid` / `categoryUid` / `assetUid` / `groupUid`），
服务端在自己的账户范围内把它解析成主键——别人的 uid 与不存在的 uid 得到同一个 400。

### 1.2 统一错误响应

```json
{
  "code": "VALIDATION_FAILED",
  "message": "categoryUid does not reference one of your categories: cat-x",
  "status": 400,
  "path": "/api/transactions",
  "timestamp": "2024-05-01T10:00:00Z",
  "details": ["amount: must not be negative"]
}
```

`details` 只在请求体字段校验失败时出现。响应**不含堆栈、SQL、密钥**。

---

## 2. 鉴权模型

1. `POST /api/auth/register` 或 `/login` 返回 `accessToken`（默认 24h）+ `refreshToken`（默认 30d）。
2. 每个请求带 `Authorization: Bearer <accessToken>`。
3. 访问令牌过期 → 401 `TOKEN_EXPIRED`；用 `POST /api/auth/refresh` 换新的一对令牌。
4. `users.token_version` 失效机制：**改密码**与**登出全部设备**会把版本 +1，
   所有旧 access/refresh 令牌立即失效（401 `TOKEN_REVOKED`）。两个端点都会在同一响应里返回新令牌，客户端直接替换即可。
5. 口令用 BCrypt（strength 10）存储；`password_hash` 永不出现在任何响应里。

---

## 3. 端点清单（52 个）

「鉴权」列：`公开` = 无需令牌；`Bearer` = 必须带有效访问令牌。

### 3.1 健康检查

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/health` | 公开 | 存活探针，不碰数据库（MySQL 恢复期也能答） |

### 3.2 auth — 账户（users 表）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| POST | `/api/auth/register` | 公开 | 邮箱注册，返回令牌对 + 用户信息，同时建 profile 行 |
| POST | `/api/auth/login` | 公开 | 邮箱密码登录，返回令牌对 |
| POST | `/api/auth/refresh` | 公开 | 用 refreshToken 换新令牌对（校验 token_version） |
| POST | `/api/auth/logout-all` | Bearer | 登出全部设备：token_version+1，返回新令牌对 |
| PUT | `/api/auth/password` | Bearer | 改密码：校验旧密码、换 BCrypt、token_version+1 |
| GET | `/api/auth/me` | Bearer | 当前用户资料 |
| PATCH | `/api/auth/me` | Bearer | 改昵称（`displayName`） |

### 3.3 profile — 设置（profiles 表，每账户一行，首次读写自动创建）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/profile` | Bearer | 读全局设置（币种、日期格式、周起始、小数位、周期偏好、当前账本） |
| PATCH | `/api/profile` | Bearer | 局部改设置（字段都可选） |

- `dateFormat` 只接受 App 自己的四档（`src/types/index.ts` 的 `DateFormat`）：`YYYY/MM/DD`、`YYYY-MM-DD`、`DD/MM/YYYY`、`MM/DD/YYYY`。
  服务端先 `toUpperCase()` 再校验，所以小写也收；其它值 → 400 `VALIDATION_FAILED`。
  （`YYYY-MM-DD` 曾经被漏掉导致 400，现已在真实接口上补测通过。）

### 3.4 ledgers — 账本

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/ledgers?includeArchived=false` | Bearer | 账本列表（按 sortOrder） |
| GET | `/api/ledgers/{clientUid}` | Bearer | 单个账本 |
| PUT | `/api/ledgers` | Bearer | 按 clientUid 幂等 upsert（`defaultLedger=true` 会自动取消其它默认） |
| PATCH | `/api/ledgers/{clientUid}` | Bearer | 局部改（含归档 `archived`） |
| DELETE | `/api/ledgers/{clientUid}?force=false` | Bearer | 删账本；有子数据时**必须** `force=true`（见 §5） |

### 3.5 assets — 资产账户

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/assets?ledgerUid=&includeArchived=false` | Bearer | 账户列表（可按账本筛） |
| GET | `/api/assets/{clientUid}` | Bearer | 单个账户 |
| PUT | `/api/assets` | Bearer | upsert（type 6 选 1；信用卡字段仅 credit 有效） |
| PATCH | `/api/assets/{clientUid}` | Bearer | 局部改（含归档） |
| DELETE | `/api/assets/{clientUid}` | Bearer | 硬删账户；历史流水的 asset_id 由外键置 NULL |

### 3.6 category-groups — 收支大类

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/category-groups?includeArchived=false` | Bearer | 大类列表 |
| GET | `/api/category-groups/{clientUid}` | Bearer | 单个大类 |
| PUT | `/api/category-groups` | Bearer | upsert（同账户下 `name` 唯一，重名 409） |
| PATCH | `/api/category-groups/{clientUid}` | Bearer | 局部改 |
| DELETE | `/api/category-groups/{clientUid}` | Bearer | 删大类；其下分类变「未分组」（外键 SET NULL） |

### 3.7 categories — 收支分类

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/categories?type=&groupUid=&includeArchived=false` | Bearer | 分类列表（按收支类型/大类筛） |
| GET | `/api/categories/{clientUid}` | Bearer | 单个分类 |
| PUT | `/api/categories` | Bearer | upsert（`groupUid` 为空=未分组；大类类型必须匹配） |
| PATCH | `/api/categories/{clientUid}` | Bearer | 局部改 |
| DELETE | `/api/categories/{clientUid}` | Bearer | 删分类；流水的 category_id 置 NULL，预算级联删 |

### 3.8 transactions — 流水（最热表）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/transactions?ledgerUid=&categoryUid=&assetUid=&type=&from=&to=&page=&size=` | Bearer | 分页查询（`assetUid` 同时匹配单账户/转出/转入） |
| GET | `/api/transactions/{clientUid}` | Bearer | 单笔流水 |
| PUT | `/api/transactions` | Bearer | upsert（类型规则见 §4.1；汇率有则算到账金额） |
| PATCH | `/api/transactions/{clientUid}` | Bearer | 局部改（改完仍按类型规则校验） |
| DELETE | `/api/transactions/{clientUid}` | Bearer | 硬删（App 侧是墓碑同步，服务端不留软删） |

- `expense` / `income` 的 `assetUid` **可以缺省**：App 的「转账手续费」就是一笔**没有账户**的独立支出
  （钱只在转账那一行扣一次，否则同一笔手续费会被扣两遍）。这类流水照常计入 §3.13 的按币种收支，
  但不属于任何账户，因此**不计入任何账户余额** —— 与 App 本地 `getAssetBalance` 的口径一致。
- `transfer` 仍然强制 `fromAssetUid` + `toAssetUid`（且必须不同），缺一个就 400。

### 3.9 budgets — 预算

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/budgets?currency=` | Bearer | 预算列表（可按币种筛，不要跨币种相加） |
| PUT | `/api/budgets` | Bearer | upsert；`categoryUid='total'`/空 = 总预算（见 §4.2） |
| DELETE | `/api/budgets/{clientUid}` | Bearer | 删预算（清除某条预算的正确方式） |

### 3.10 payment-plans — 计划付款（本次补齐云端缺口）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/payment-plans?includeArchived=false` | Bearer | 计划列表 |
| GET | `/api/payment-plans/{clientUid}` | Bearer | 单个计划 |
| PUT | `/api/payment-plans` | Bearer | upsert（cycle weekly/monthly/yearly，天数字段按周期） |
| PATCH | `/api/payment-plans/{clientUid}` | Bearer | 局部改（含补账游标 `lastProcessedDate`） |
| DELETE | `/api/payment-plans/{clientUid}` | Bearer | 删计划 |

### 3.11 push-tokens — 推送设备（push_tokens 表）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/push-tokens` | Bearer | 本账户已注册设备 |
| POST | `/api/push-tokens` | Bearer | 注册/换主：同 token 重新注册会改归属到当前账户 |
| DELETE | `/api/push-tokens` | Bearer | 注销；不属于自己的 token 是 no-op（幂等） |

### 3.12 exchange-rates — 汇率缓存（exchange_rates 表）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/exchange-rates?base=MYR&refresh=false` | Bearer | 24h 缓存；过期才抓 open.er-api.com，抓取失败返回旧数据并标 `stale=true` |

### 3.13 reports — 统计（按币种分组）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/reports/summary?from=&to=&currency=` | Bearer | 收入/支出/净额 + 分类排行，**按币种分块返回**；转会（transfer）不计入收支 |
| GET | `/api/reports/asset-balances` | Bearer | 各账户余额 + 按币种汇总（绝不跨币种合并成一个「净资产」） |

- 没有账户的流水（`asset_id IS NULL`，例如转账手续费支出）计入 `summary` 的币种收支，
  但**不出现在 `asset-balances` 的任何账户行里**；账户余额只由「本账户的收支 + 转出 amount+fee + 转入到账额」决定。
- `transfer` 两侧都不计入收入/支出（它只是移动钱）。

### 3.14 receipts — 收据 AI 代理（**已废弃，已删除**）

> 该接口与 §3.16 的 `POST /api/ai/receipt-scan` 功能重叠，已从代码中移除（含 receipt 包与 2 个测试类）。
> 请统一使用 §3.16；旧路径现在返回 404。

### 3.15 premium — 会员（**桩**，不实现内购）

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| GET | `/api/premium/status` | Bearer | 恒返回 `active=false, implemented=false` |
| POST | `/api/premium/purchase` | Bearer | 恒返回 501 `NOT_IMPLEMENTED` |

---

## 4. 魔法值规范化（服务端强制，客户端不必自己处理）

### 4.1 流水类型

| 类型 | 必填 | 服务端行为 |
|---|---|---|
| `expense` / `income` | `assetUid`（**可空**：无账户的手续费支出就是这样进来的） | `exchangeRate/convertedAmount/fee` 一律置 NULL（这些字段只属于转账） |
| `transfer` | `fromAssetUid` + `toAssetUid`（不同账户） | `assetUid` 置 NULL；有 `exchangeRate` 且没给 `convertedAmount` 时算 `amount × rate`；只给 `convertedAmount` 则反推汇率 |

- `categoryUid: ""`（App 的默认空串）→ 入库 `NULL`。
- `currency` 缺省 → 取该笔「主账户」的币种快照；没有账户再取全局币种。
- `amount` 必须 ≥ 0，且 ≤ 1e12（保证 JSON 数字在 JS 双精度内仍精确）。

### 4.2 预算

| 客户端传入 | 服务端落库 |
|---|---|
| `categoryUid: "total"` 或缺省/空串 | `scope='total'` **且** `category_id IS NULL`（否则撞 `chk_budgets_scope`） |
| `categoryUid: "<真实分类>"` | `scope='category'` + 解析出的分类主键 |
| `currency` 缺省/空串 | **写入时固化**成当时的全局币种（之后改全局币种不回头改预算） |
| `clientUid` 缺省 | 由 `(categoryUid \| currency)` 派生，等价 App 旧的确定性主键 |
| `amount = 0` | **拒绝**（400），清预算请用 `DELETE` |

唯一性由 `(user_id, scope, category_key, currency)` 保证：同一分类同一币种只会有一行，
即使客户端换了 clientUid 也只会更新原行。

### 4.3 其它

- 分类的大类必须同类型（expense 分类不能挂 income 大类）→ 400。
- 信用卡专属字段（`creditLimit/statementDay/dueDay/interestRate`）在 `type != credit` 时被置 NULL。
- `archived: true` 写 `archived_at = now`；`false` 清空。
- 账本 upsert 传 `defaultLedger: true` 时，同账户其它账本自动取消默认。

---

## 5. 删除顺序与外键

- `ledgers` 被子表 `ON DELETE RESTRICT` 引用，所以：
  - 没有子数据 → `DELETE` 直接成功；
  - 有子数据且 `force=false` → **409**，消息里带 transactions/paymentPlans/assets 计数；
  - `force=true` → 同一事务内按 `transactions → payment_plans → assets → ledger` 顺序删。
- `is_default=1` **不是删除屏障**：默认账本和普通账本一样可删；删空后由客户端新建一本空账本（服务端只负责删行，不自动补行）。
- 删账户/分类不会连坐历史流水（外键 SET NULL），删分类会连带删它的预算（CASCADE）。
- 删账本会把 `profiles.active_ledger_id` 置 NULL（外键 SET NULL），客户端需重新选账本。

---

## 6. 请求 / 响应示例

### 6.1 注册（`POST /api/auth/register`）

请求：

```json
{ "email": "alex@example.com", "password": "s3cret-pass", "displayName": "Alex" }
```

`201 Created`：

```json
{
  "tokenType": "Bearer",
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
  "expiresIn": 86400,
  "user": {
    "id": 1,
    "email": "alex@example.com",
    "displayName": "Alex",
    "role": "USER",
    "emailVerified": false,
    "createdAt": "2024-05-01T09:00:00Z"
  }
}
```

错误：`409 CONFLICT`（邮箱已注册）、`400 VALIDATION_FAILED`（密码 < 8 位）。

### 6.2 新增一笔支出（`PUT /api/transactions`）

请求：

```json
{
  "clientUid": "tx_1699000000000_ab12",
  "ledgerUid": "led_default",
  "categoryUid": "",
  "assetUid": "acc_cash_myr",
  "type": "expense",
  "amount": 23.5,
  "occurredOn": "2024-05-01",
  "note": "午饭"
}
```

`200 OK`（重复推送同一 `clientUid` 得到同一行：字段按最新值覆盖，`updatedAt` 刷新，`createdAt` 保持首次值）：

```json
{
  "clientUid": "tx_1699000000000_ab12",
  "ledgerUid": "led_default",
  "assetUid": "acc_cash_myr",
  "type": "expense",
  "amount": 23.5,
  "currency": "MYR",
  "occurredOn": "2024-05-01",
  "note": "午饭",
  "createdAt": "2024-05-01T09:10:00Z",
  "updatedAt": "2024-05-01T09:10:00Z"
}
```

三个**实测**要点：

1. `categoryUid: ""` 入库 `NULL`，回传时**整个键被省略**（不是 `"categoryUid": null`）；同理
   `fromAssetUid` / `toAssetUid` / `exchangeRate` / `convertedAmount` / `fee` / `displayName` / `receiptPath`
   为 null 时也都不出现（见 §1「空值」）。
2. `amount` 回传是**数字** `23.5`，不是字符串 `"23.5000"`：库里的 `DECIMAL(19,4)` 值确实是 23.5000，
   但 JSON 序列化是 number 且不补尾零。不要按字符串处理，也不要依赖固定的小数位形态。
3. `createdAt` 带固定首次写入值：再 PUT 一次同一 `clientUid`，只有 `updatedAt` 变
   （时间戳精度到秒，回显值 == 落库值）。

### 6.3 跨币种转账（`PUT /api/transactions`）

```json
{
  "clientUid": "tx_transfer_1",
  "ledgerUid": "led_default",
  "type": "transfer",
  "fromAssetUid": "acc_cash_myr",
  "toAssetUid": "acc_bank_usd",
  "amount": 1000,
  "exchangeRate": 0.2125,
  "fee": 2.5,
  "occurredOn": "2024-05-02"
}
```

响应片段：`"convertedAmount": 212.5000`、`"currency": "MYR"`（转出侧币种快照）。
统计时 `amount` 从转出账户扣、`convertedAmount` 进转入账户，**两侧都不计入收入/支出**。

### 6.4 设置总预算（`PUT /api/budgets`，App 的 `setBudget('total', …)`）

请求：`{"categoryUid":"total","amount":1500}`（不传 currency = 跟随全局币种）

`200 OK`：`{"clientUid":"total|MYR","scope":"total","categoryUid":null,"currency":"MYR","amount":1500.0000,...}`

再发一次同样的请求（哪怕 `currency` 改成 `MYR` 显式传）只会更新同一行，不会插出第二条总预算。

### 6.5 统计（`GET /api/reports/summary?from=2024-05-01&to=2024-05-31`）

```json
{
  "from": "2024-05-01",
  "to": "2024-05-31",
  "currencyFilter": null,
  "currencies": [
    {
      "currency": "MYR",
      "income": 5000.0000,
      "expense": 1200.5000,
      "net": 3799.5000,
      "transactionCount": 17,
      "categories": [
        { "categoryUid": "cat_food", "name": "餐饮", "amount": 800.0000, "count": 9 },
        { "categoryUid": null, "name": "(deleted category)", "amount": 400.5000, "count": 3 }
      ]
    },
    {
      "currency": "USD",
      "income": 0.0000,
      "expense": 200.0000,
      "net": -200.0000,
      "transactionCount": 2,
      "categories": []
    }
  ]
}
```

服务端开启了 `WRITE_BIGDECIMAL_AS_PLAIN`，金额恒为普通十进制字面量，不会出现 `1.5E3` 这种科学计数法。

**不同币种绝不合并**；需要单一币种视图就传 `currency=MYR`（无数据时返回一个零值块）。

### 6.6 收据识别（`POST /api/receipts/extract`）

请求（`imageBase64` 可带 `data:` 前缀）：

```json
{ "imageBase64": "/9j/4AAQSkZJRgABAQ...", "mimeType": "image/jpeg" }
```

`200 OK`：

```json
{
  "amount": 19.99,
  "merchant": "全家便利店",
  "date": "2024-05-01",
  "type": "expense",
  "suggestedCategory": "餐饮",
  "model": "anthropic/claude-sonnet-4.5"
}
```

| 情况 | 响应 |
|---|---|
| 服务端没配 AI 密钥 | `503 AI_UNAVAILABLE`（**不是崩溃**） |
| 图片 > 6 MiB | `413 PAYLOAD_TOO_LARGE` |
| base64 非法 / mime 不在白名单 | `400 VALIDATION_FAILED` |
| 上游超时/拒答 | `502 UPSTREAM_ERROR`（只回状态码，不回显上游 body，永不回显密钥） |

### 6.7 强制删账本

`DELETE /api/ledgers/led_old?force=true` →

```json
{ "clientUid": "led_old", "deleted": true, "deletedTransactions": 412, "deletedPaymentPlans": 3, "deletedAssets": 2 }
```

---

## 7. 错误码表

| code | HTTP | 触发场景 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 字段校验失败、非法魔法值、引用了不属于自己的 uid、类型不匹配 |
| `BAD_REQUEST` | 400 | JSON 解析失败、缺查询参数、参数类型错误 |
| `UNAUTHORIZED` | 401 | 没带令牌、令牌无法验证为当前用户 |
| `TOKEN_INVALID` | 401 | 令牌签名/类型/签发方不对（拿 refresh 当 access 用等） |
| `TOKEN_EXPIRED` | 401 | 令牌过期 |
| `TOKEN_REVOKED` | 401 | `token_version` 已变（改密/登出全部设备/账户已删） |
| `INVALID_CREDENTIALS` | 401 | 邮箱或密码错（两种失败返回同一个错误，避免枚举账户） |
| `FORBIDDEN` | 403 | 已认证但无权限 |
| `NOT_FOUND` | 404 | uid 不存在（或属于别人）、路径不存在 |
| `CONFLICT` | 409 | 邮箱已注册、大类重名、账本仍有子数据且未 `force`、唯一键冲突 |
| `PAYLOAD_TOO_LARGE` | 413 | 收据图片超过上限 |
| `NOT_IMPLEMENTED` | 501 | 会员购买（桩） |
| `UPSTREAM_ERROR` | 502 | 上游汇率/AI 服务异常 |
| `AI_UNAVAILABLE` | 503 | 服务端未配置 AI 密钥 |
| `INTERNAL_ERROR` | 500 | 未预期异常（日志有堆栈，响应只有一句话） |

---

## 8. 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `JWT_SECRET` | **是** | HS256 密钥，≥ 32 字节；缺失/过短时**拒绝启动**（fail closed） |
| `DB_URL` / `DB_USER` / `DB_PASSWORD` | 是（生产） | MySQL 8 连接 |
| `OPENROUTER_API_KEY` | 否 | 收据识别密钥；缺失时该端点 503，其它功能不受影响 |
| `CORS_ALLOWED_ORIGINS` | 否 | 默认 `*` |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | 否 | 默认 `PT24H` / `P30D` |
| `JPA_DDL_AUTO` | 否 | 默认 `validate`（表结构由 Flyway 拥有） |

未列入 `application.yml` 的可选项通过同名 Spring 属性覆盖：
`app.receipt.model`（默认 `anthropic/claude-sonnet-4.5`）、`app.receipt.max-image-bytes`（默认 6291456）、
`app.receipt.read-timeout-ms`（默认 30000）、`app.rates.ttl`（默认 `PT24H`）、`app.rates.read-timeout-ms`（默认 8000）。

---

## 9. 已知限制

1. ~~**没有任何端点跑过真实 MySQL**~~ —— **2026-10 已在本机 MySQL 8.0.43（127.0.0.1:3307）上跑通**：
   Flyway v1..v9 全部 success（含 `VIRTUAL` 生成列 + `ON DELETE CASCADE` 组合）、
   `scripts/api-smoke.mjs` 55 项断言全绿；本文标「实测」的取值都来自该环境。
2. `GET /api/exchange-rates` 与 `POST /api/receipts/extract` 的外网调用未在真实网络下验证（单测只覆盖缺密钥/超限/非法入参路径）。
3. 没有实现：定时抓汇率（cron）、推送发送（Expo Push 批量）、小票文件上传（Storage）、
   计划付款自动入账（引擎仍在 App 本地）、会员权益与内购校验。
4. 汇率只做展示缓存；真正参与计算的汇率落在 `transactions.exchange_rate`。

---

### 3.16 AI 小票识别（经服务端中转，客户端不持有第三方密钥）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/ai/receipt-scan` | Bearer | 上传票据图片 base64，返回结构化记账字段 |

**请求**：`{ "imageBase64": "<裸 base64 或 data:image/*;base64,...>" }`
只受理 PNG / JPEG / WEBP / GIF / HEIC —— **按文件魔数嗅探**，不采信 data URL 里声明的类型。

**响应 200**：`{ amount, merchant, date, type, suggestedCategory }`（识别不到的字段为 null，服务端 `non_null` 会整体省略）。

**错误码**

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 非 base64 / 非图片字节 / 缺少 imageBase64 |
| 401 | `UNAUTHORIZED` | 无 token 或 token 失效 |
| 413 | `PAYLOAD_TOO_LARGE` | 解码后超过上限（默认 8MB） |
| 502 | `AI_UPSTREAM_ERROR` | 上游拒绝或返回不可解析内容（不透传第三方原文，仅带其状态码） |
| 503 | `AI_NOT_CONFIGURED` | 服务端未配置 `OPENROUTER_API_KEY`，客户端应降级为手动记账 |
| 504 | `AI_UPSTREAM_TIMEOUT` | 上游超时（默认 30s） |

**服务端环境变量**：`OPENROUTER_API_KEY`（必填，否则 503）、`OPENROUTER_MODEL`、`OPENROUTER_BASE_URL`、
`AI_RECEIPT_TIMEOUT_MS`、`AI_RECEIPT_MAX_IMAGE_BYTES`。

> 客户端**不再使用** `EXPO_PUBLIC_OPENROUTER_API_KEY`；密钥只存在于服务端。
> 旧接口 `/api/receipts/extract` 已删除（receipt 包与测试一并移除），统一走本端点。

---

### 3.17 AI 语音记账（经服务端中转，客户端不持有第三方密钥）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/ai/voice-parse` | Bearer | 上传录音 base64，服务端**两步**：音频转写 → 文本解析成记账字段 |

**请求**：`{ "audioBase64": "<裸 base64>", "format": "m4a" }`
`format` 走白名单：`m4a/wav/mp3/aac/amr/caf/flac/ogg/opus/webm/mp4/mpga/mpeg`，不在表内 → 400。

**响应 200**：`{ amount, merchant, date, type, suggestedCategory, note, transcript }`
字段形状与 App 的 `VoiceAccountingResult` 一致（`transcript` 必有；其余识别不到为 null，服务端 `non_null` 会整体省略）。

**错误码**

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | 缺少 audioBase64 / 非法 base64 / format 缺失或不在白名单 |
| 401 | `UNAUTHORIZED` | 无 token 或 token 失效 |
| 413 | `PAYLOAD_TOO_LARGE` | 解码后超过上限（默认 10MB，`AI_VOICE_MAX_AUDIO_BYTES`） |
| 502 | `AI_UPSTREAM_ERROR` | 转写或解析上游拒绝/返回不可解析内容（不透传第三方原文，仅带其状态码） |
| 503 | `AI_NOT_CONFIGURED` | 服务端未配置 `OPENROUTER_API_KEY`，客户端应降级为手动记账 |
| 504 | `AI_UPSTREAM_TIMEOUT` | 上游超时（与 AI 客户端共用的读超时，默认 30s/步） |

**服务端环境变量**：`OPENROUTER_API_KEY`（必填，否则 503）、`OPENROUTER_MODEL`（第二步解析用）、
`OPENROUTER_BASE_URL`、`AI_VOICE_STT_MODEL`（第一步转写用，默认 `qwen/qwen3-asr-flash-2026-02-10`）、
`AI_VOICE_MAX_AUDIO_BYTES`。

**日志边界**：只记 `format`、解码后字节数、模型 slug 与转写字符数；
音频 base64、密钥、转写原文全文都不进日志。

> 客户端**不再使用** `EXPO_PUBLIC_OPENROUTER_API_KEY` / `EXPO_PUBLIC_AI_MODEL`：
> `src/config/aiConfig.ts` 里的 `OPENROUTER_API_KEY`、`AI_MODEL` 两个常量已删除，只保留 `isAiConfigured`。
> `src/` 下对 `openrouter.ai` 与 `sk-or-v1` 的引用均为 0。

