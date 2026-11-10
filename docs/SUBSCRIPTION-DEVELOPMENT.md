# 订阅开发说明（模拟测试 + Google Play 接入）

2026-11-10 · 分支 `feature/subscription`。Google Play 开发者注册、商户认证、商品后台与上架由另一位负责人办理。

本分支以第一版补丁（单独提交，未改动）为起点。审查后重做了管理员、身份归属、并发、正式通知处理和离线行为，见下文「相对第一版补丁的修正」。

## 1. 会员权益范围

| 需要会员 | 免费 |
| --- | --- |
| 收据扫描（本机与服务端 OCR） | 提醒中心（含信用卡还款提醒） |
| 财务计划新增、修改条款、重新开启 | 手动记账、同币种普通转账、基础统计 |
| 新增第二本及以后的账本 | 第一本账本、已有账本与全部历史记录 |
| 兑换及跨币种转账（新增 / 修改金额等财务字段） | 手动附加收据图片 |

- 正常到期不会删除或隐藏任何历史数据。
- 已有财务计划继续按既定规则执行（只推进 `lastProcessedDate`）。计划可以暂停，也可以删除。
- 检查发生在两处：
  - App 入口：拦下时打开会员页，表单草稿保留；
  - 服务端写接口：`LedgerService`、`PaymentPlanService`、`TransactionService` 的 upsert/patch，以及 nginx `/ocr/` 的 `auth_request`。
- 同步宽限：会员结束后 7 天内（`BILLING_SYNC_GRACE_DAYS`），离线期间创建的会员记录仍可同步到服务端。宽限只对同步生效，App 入口按实时状态判断。退款并撤权的会员没有宽限。
- 被拒同步的记录保留在本机，显示「需会员才能同步」。之后不会每次同步都重推，等会员开通、游客会员绑定或锁定关闭后自动补传，最长 30 分钟自动重试一次。
- 离线时：
  - 锁定未开启：一律放行；
  - 会员且缓存的有效期未过：放行；
  - 从没拿到过状态：放行，由服务端在同步时兜底。
- 价格 RM8.90 / RM79.90 只是模拟展示用的候选价，正式价格以 Play Console 为准。AI 识别额度没有实现，也没有当作商业规则。

## 2. 身份与归属

- **billing subject 是订阅唯一的归属**：
  - 已登录：一个账号对应一个 subject；
  - 游客：服务端只保存随机凭证（32 字节）的 SHA-256。App 把凭证存在 SecureStore（Android Keystore），只有 Web 退回 AsyncStorage。
- **游客身份按需创建**：只有提交申请、购买、恢复购买时才创建。打开 App、查看会员页都是匿名查询，不建身份。`POST /api/premium/guest` 在 nginx 限流：每客户端每分钟 10 次，全局每分钟 300 次。
- **Google 归属**：`obfuscatedAccountId` 填 subject 的 `account_hash`，即 64 位十六进制、不含个人信息。服务端验单时要求它属于当前身份。
- **绑定只能主动发起**：
  - 登录后，如果本机游客有会员或待付款，弹出提示并显示当前账号邮箱，由用户确认绑定；
  - 绑定后游客凭证作废；
  - 已属于账号 A 的订阅，永远不会自动或手动转给账号 B（`BILLING_OWNED_BY_OTHER`）。

| 场景 | 处理 |
| --- | --- |
| 退出登录 | 回到本机游客身份（如有）；账号的会员留在账号上 |
| 切换账号 | 会员跟随账号；本机游客会员需要新账号主动绑定 |
| 重装 / 换手机（游客，正式购买） | 同一 Play 账号「恢复购买」→ 服务端向 Google 验证 → 旧的未绑定游客身份转给新安装 |
| 重装 / 换手机（已登录） | 登录原账号即可；恢复购买会重新验单 |
| 已登录恢复「游客时期」的购买 | 返回 `BILLING_CLAIM_REQUIRED`，App 请用户确认后再绑定 |
| 恢复属于别的账号的购买 | 拒绝，提示登录原账号 |
| 重复绑定 | 409，状态不变 |
| 注销账号 | subject 去标识化保留（`detached_at`）；之后同一 Play 账号恢复时，确认后可重新认领 |
| 模拟游客订阅 | 只存在本次安装，卸载后不可恢复（界面已说明） |

## 3. 管理员

- **管理员资格是会话级的**。必须同时满足：
  1. 本次登录是 **Google 登录**（JWT `amr=google`，refresh 时保留原方式）；
  2. 该 Google 账号的 `sub` 已固定在 `billing_admins` 表里，或等于 `BILLING_ADMIN_GOOGLE_SUB`。
- **固定方式**：第一次用 `BILLING_ADMIN_EMAIL`（经 Google 验证的邮箱）进行 Google 登录时，写入它的 `sub`。之后其他 `sub` 一律无效。
- **密码登录永远不是管理员，即使是同一个账号。** 原因：现有 Google 登录会按邮箱自动合并账号，而密码注册不验证邮箱。如果只认邮箱，抢先注册同邮箱的人就能拿到管理权限。
- 所有管理接口在服务端逐次校验。设置变更和模拟事件都写入 `billing_events`，记录操作者、前后状态和时间。
- 管理开关（每个部署各自一份）：
  - `enrollmentOpen`：订阅入口与申请。关闭后，非管理员且没有订阅记录的用户看不到入口。恢复购买不受影响。
  - `sandboxOpen`：模拟订阅，只有 staging 部署可以打开。
  - `gatesEnabled`：锁定会员功能。

## 4. 模拟测试（staging）

模拟只存在于 `BILLING_ENV=staging` 的部署，并且使用**独立数据库**。正式 compose 强制 `production`。正式环境如果设置了 `BILLING_SANDBOX_ALLOWED=true`，API 拒绝启动。模拟订单无论如何都不能改动 `GOOGLE_PLAY` 行，也不能代替 Google 验单。

1. 在 VPS 上：
   ```bash
   cp deploy/.env.staging.example deploy/.env.staging
   ```
   填写 staging 自己的口令和 JWT 密钥（必须与正式环境不同），以及 `BILLING_ADMIN_EMAIL`。
2. 启动 staging：
   ```bash
   docker compose -p jishiben-staging --env-file deploy/.env.staging -f deploy/docker-compose.staging.yml up -d --build
   ```
3. 把 `deploy/staging/traefik-staging.yml` 复制到 Traefik 动态配置目录，开放 `https://<IP>/staging`。
4. 构建测试包：
   ```bash
   eas build --profile staging
   ```
   API 指向 `/staging`。新原生依赖（expo-iap、expo-secure-store）需要新安装包，旧 APK 不能只收 OTA。
5. 管理员在测试包里用该 Gmail **经 Google 登录** → 设置 → 订阅 → 订阅管理，打开「开放订阅入口与申请」和「开启模拟订阅」。
6. 游客或已登录用户选月付 / 年付 → 提交模拟申请（状态为「等待付款」）。
7. 管理员可以对订单执行以下模拟：确认付款、拒付、续费、取消续费、宽限期、扣款失败（hold）、暂停、恢复、到期、仅退款、退款并撤权。用户自己可以撤回待付款、取消续费。
8. 重复点击是幂等的。过期的 revision 返回 409，需要刷新后再操作。

页面顶部常驻「开发测试，不会扣款」，每条模拟订单都带「模拟」标记。

## 5. 正式 Google Play

**首版支持范围**：
- 一个订阅商品 `premium`，两个普通自动续费 base plan：`monthly`、`yearly`；
- 仅 Android；
- 付款方式由 Google Play 按地区提供，App 不收集任何卡号或银行资料。

**正确处理的状态**：待付款（不开通、不确认）、宽限期（可用）、账号保留 / hold（停用）、暂停（停用）、取消续费（到期前可用）、到期、撤权（立即停用，无同步宽限）、退款（单独记录，`voidedPurchaseNotification` 加 Voided Purchases API 每小时兜底）、Play 商店内重新订阅（`outOfAppPurchaseContext`）、`linkedPurchaseToken` 替换旧订阅（只退役同一归属的旧 token）、测试购买（`testPurchase` 标记）。

**不支持**（启用前需要扩展解析、文案和测试）：免费试用、优惠 / 促销价、预付、分期、App 内月付↔年付切换、多商品组合、iOS、AI 额度计费。

**实现要点**：
- 先调用 Google `purchases.subscriptionsv2.get`（不在数据库事务内），再用短事务落库，只锁定对应购买行。
- 验证通过、状态有效即自动开通。开通提交后立即在服务端调用 `purchases.subscriptions.acknowledge`；失败由后台补查重试。Google 规定 3 天内未确认会自动退款。
- RTDN 只作为「去 Google 重新查询」的触发器，按 `messageId` 去重：
  - 暂时找不到归属的购买，存入 `billing_orphans` 并返回 2xx，由补查任务认领。无法归属的购买不确认，由 Google 自动退款。
  - 不支持的商品 / 状态：记录日志后返回 2xx，不让 Pub/Sub 无限重试。
  - Google 暂时不可用：返回 5xx，由 Pub/Sub 重试。
- 后台补查：数据库租约（多实例只跑一份），每批 20 条，指数退避（最长 1 小时）。超过 24 小时仍未确认、无法归属、连续验证失败的情况，会写 error 日志并显示在管理员页面。
- Google 请求连接超时 5 秒、读取超时 10 秒，不做隐式重试。凭证使用 google-auth-library 的 ADC。
- 购买 token 用 AES-GCM 加密保存，另存 SHA-256 作为唯一键。
- App 端使用 expo-iap 6.4.3。它依赖 openiap-google 4.0.10 → **Play Billing Library 9.1.0**，满足 Google 现行要求：2026-11-01 起新应用和更新至少使用 PBL 7。
- 「管理订阅」深链：`https://play.google.com/store/account/subscriptions?sku=premium&package=com.kylim0103.jizhangapp`。

**开放正式购买前需要完成（上架负责人 / 运维）**：
- [ ] Play Console：创建订阅 `premium` 及 base plan `monthly` / `yearly`，设置售卖地区和最终价格。
- [ ] 内部测试轨道上传包含 Billing 的 AAB（`eas build --profile production`），配置许可证测试账号。**非许可证测试账号会被真实扣款。**
- [ ] GCP：启用 Google Play Developer API；创建服务账号并在 Play Console 授予订单 / 订阅权限；把凭证放到 `deploy/secrets/google-play-service-account.json`（已 gitignore），使用 `docker-compose.billing-google.yml` 叠加。
- [ ] Pub/Sub：创建 topic，授予 `google-play-developer-notifications@system.gserviceaccount.com` 发布权限；创建带 OIDC 认证的 push 订阅，地址为 `https://<正式域名>/api/premium/google/notifications`；把 audience 和服务账号邮箱分别填入 `BILLING_PUSH_AUDIENCE`、`BILLING_PUSH_EMAIL`。
- [ ] `BILLING_TOKEN_ENCRYPTION_KEY`：用 `openssl rand -base64 32` 生成并备份。更换会导致旧 token 无法解密。
- [ ] 设置 `BILLING_GOOGLE_ENABLED=true`；在 Play Console 发送测试通知，确认管理员页面出现 `GOOGLE_TEST` 事件。
- [ ] 用许可证测试账号验证：购买、待付款（慢速测试卡）、拒付、续费（测试周期约 5 分钟）、取消、宽限、hold、退款、撤权、换机恢复、通知与后台补查。
- [ ] 更新隐私政策和 Data safety，补充游客订阅身份、购买记录及保留期限；验证账号删除提示。
- [ ] 以上全部通过后，管理员再打开「开放订阅入口与申请」，最后视需要打开「锁定会员功能」。

## 6. 配置一览

| 变量 | 正式 | staging | 说明 |
| --- | --- | --- | --- |
| `BILLING_ENV` | `production`（compose 固定） | `staging`（compose 固定） | 决定是否允许模拟 |
| `BILLING_SANDBOX_ALLOWED` | `false`（固定） | `true` | 正式环境设为 true 时拒绝启动 |
| `BILLING_GOOGLE_ENABLED` | 完成上节清单后设为 `true` | 可选 | Google 验单 / 通知 / 补查 |
| `BILLING_ADMIN_EMAIL` / `BILLING_ADMIN_GOOGLE_SUB` | 必填其一 | 必填其一 | 管理员 Google 身份 |
| `BILLING_SYNC_GRACE_DAYS` | 7 | 7 | 到期后的同步宽限天数（0–30） |
| `BILLING_TOKEN_ENCRYPTION_KEY`、`BILLING_PUSH_AUDIENCE`、`BILLING_PUSH_EMAIL` | 正式购买必填 | 可选 | 见上节 |

## 7. 数据表（V13）

| 表 | 用途 |
| --- | --- |
| `billing_subjects` | 订阅身份 |
| `billing_settings` | 开关 |
| `billing_admins` | 固定的管理员 Google sub |
| `billing_subscriptions` | 模拟与 Google 订阅；含 `entitled_until`、`refunded_at`、`refund_type`、`revoked_at`、`test_purchase` |
| `billing_orphans` | 暂未归属的 Google 购买 |
| `billing_events` | 幂等键与审计，含前后状态 |
| `billing_jobs` | 后台任务租约 |

- V13 尚未在任何环境执行过，所以直接修订了 V13 本身；V1–V12 没有改动。
- 注销账号时，subject 标记 `detached_at`，外键置空，购买和审计记录去标识化保留。正式隐私政策需要写明保留期限。

## 8. 相对第一版补丁的修正

1. **管理员可被抢注邮箱的人获得** → 改为「Google 会话 + 固定 sub」，密码会话一律无效。
2. **已登录用户在新手机上恢复游客购买被拒、注销后无法找回仍在扣费的订阅** → 改为确认后认领。
3. **所有订阅操作共用一把全局行锁，并且持锁期间调用 Google（最长 15 秒）** → 改为先请求 Google、再短事务处理，只锁对应行。
4. **RTDN 找不到归属或状态不支持时返回错误，导致 Pub/Sub 无限重试** → 改为孤儿表；不支持的情况记录日志后返回 2xx。
5. **退款没有记录，也没有 Voided API 兜底** → 退款与撤权分开记录，补上 Voided API 兜底；区分测试购买；增加超时未确认告警。
6. **每次启动都为游客建立服务端身份，没有限流；凭证明文存在 AsyncStorage** → 按需创建，nginx 限流，凭证改存 SecureStore。
7. **锁定未开启时，离线超过 15 秒也会拦下新增账本 / 计划 / 兑换** → 改用离线缓存规则（见第 1 节）。
8. **订阅入口始终可见** → 由 `enrollmentOpen` 控制。
9. **服务端拒绝同步后，每次同步都报「数据格式不兼容」并重推** → 新增 `premium` 同步错误码，本地保留，状态变化后补传；新增 7 天同步宽限。
10. **扫描在拍完照片后才校验，校验失败会丢失照片** → 移到开相机 / 选图之前。
11. **模拟环境与正式环境只靠一个全局 `BILLING_MODE`，可能共用同一个库** → 改为独立 staging 栈和独立数据库。

## 9. 验证状态

| 项目 | 状态 |
| --- | --- |
| 代码 | 完成（本分支） |
| 后端单元 / 集成测试 | `mvn test` 共 130 项通过（H2 MySQL 模式 + 真实 V13 脚本） |
| MySQL 8.0 实测 | 本地 Docker mysql:8.0 执行 V1–V13 成功；对本地 API 跑完整模拟流程脚本 32/32 通过 |
| 前端 | `tsc --noEmit` 通过；`expo export --platform web` 成功；Web 开发包在浏览器中走通「游客申请 → 管理员确认 → 会员有效」 |
| nginx / compose | 两份 nginx 配置 `nginx -t` 通过；正式与 staging compose `config` 校验通过 |
| 真机 | **未做**：需要 `eas build --profile staging` 后在真机检查中英文、深色、大字体、草稿保留 |
| staging 部署 | **未做**（按约定不部署） |
| 真实 Google Play | **未做**：依赖 Play Console 商品和许可证测试账号；Google 相关代码只经过模拟网关单测 |

## 10. 其他发现（不在本次修改范围）

- `push/PushBroadcastService` 仍按邮箱字符串判定管理员，存在同样的抢注风险，建议改用 `BillingAdminService`。
- Google 登录按邮箱自动合并已有密码账号（2026-11-05 的产品决定），会让普通用户也面临账号被预先劫持的风险。
- `src/config/ocrConfig.ts` 写死了一个 OCR 共享密钥作为回退值。
- `AppContext → PremiumContext → AuthContext → useReminders → AppContext` 之间有 require 循环。运行正常，但 Metro 会报警告。
