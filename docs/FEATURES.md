# FEATURES.md — jishiben 仓库功能与技术事实盘点（只读审计）

> 审计对象：https://github.com/kunzzit01/jishiben.git
> 本地副本：_repo/jishiben（git clone 后 git fetch --all --tags）
> 审计方式：**纯只读**。未执行 npm install / expo / 构建 / dev server，未访问除 GitHub 外的任何站点，未修改仓库任何文件。
> 约定：**[读到]** = 有文件路径:行号或命令输出可证；**[推测]** = 我的推断，标注「未确认」。
> 分节对应任务书第 3–8 项；第 9 节是最重要的「11 屏设计图 ↔ 代码」对照。

---

## 0. 一句话结论

这是一个 **Expo SDK 57 + React Native 0.86 + TypeScript 的纯移动端 App（无 Java 后端）**：
本地 AsyncStorage 为主存储，云备份走 **Supabase（PostgreSQL + Auth + Storage）**，
另有一个**只有 4 个端点的 Node.js/Express 小后端**（推送 token + 汇率缓存 + 定时推播）。
**仓库内不存在 Spring Boot / Java / MySQL 任何痕迹**（下节给证据）。
功能面比"记账 App 初版"大得多：5 Tab / **30 条 Stack 路由注册**（含双/三注册）/ 17 个屏幕 + 1 个开发画廊 / **35,764 行 TS/TSX**（含 backend、scripts 共 36,346 行），
已实现多账本、多币种账户、转账+兑换+手续费、预算、信用卡账单、财务规划自动扣账、
AI 收据 OCR、AI 语音记账、云同步、生物锁 + 二级 PIN、中英双语、深浅色主题。

---

## 1. 仓库与分支事实

### 1.1 clone 与 HEAD

```
$ git clone https://github.com/kunzzit01/jishiben.git _repo/jishiben
Cloning into '_repo/jishiben'...
(成功，exit 0)

$ git fetch --all --tags          # 成功，exit 0
$ git rev-parse HEAD
aec40f2911adf555b241139419f794f4dc9ba15d
$ git log -1 --format='%H %ad %an %s' --date=iso
aec40f2911adf555b241139419f794f4dc9ba15d 2026-10-21 17:10:02 +0800 kkyylim663-ux Merge pull request #1 from kkyylim663-ux/ui-redesign
```

**[读到]** HEAD = `aec40f29`，是一个 **merge commit**（PR #1，从 ui-redesign 合入 main）。
仓库共 **131 个提交**，时间跨度 **2026-09-02 → 2026-10-21**（`git rev-list --count main` / `git log --reverse`）。
工作树干净，只有 `main` 一个本地分支。

### 1.2 全部分支（git for-each-ref 原文节选）

| 分支 | tip sha | 提交日期 | 可达提交数 | 是否已合入 main |
|---|---|---|---|---|
| origin/main（= HEAD） | `aec40f29` | 2026-10-21 | 131 | — |
| origin/ui-redesign | `bec6051d` | 2026-10-20 | 130 | **YES**（PR #1 已合并） |
| origin/ui/add | `0e3c2663` | 2026-10-10 | 18 | **YES** |
| origin/ui/assets-report | `f37cf227` | 2026-10-10 | 11 | **YES** |
| origin/ui/home | `a4636435` | 2026-10-10 | 30 | **YES** |
| origin/ui/settings-plans | `dc5ec7e6` | 2026-10-10 | 30 | **YES** |

原文（`git for-each-ref --format='%(refname) %(objectname:short) %(committerdate:iso) %(subject)'`）：

```
refs/remotes/origin/HEAD            aec40f29 2026-10-21 Merge pull request #1 from kkyylim663-ux/ui-redesign
refs/remotes/origin/main            aec40f29 2026-10-21 Merge pull request #1 from kkyylim663-ux/ui-redesign
refs/remotes/origin/ui-redesign     bec6051d 2026-10-20 fix(sync): isolate Postgres 21xxx/22xxx data errors as bad rows (not opaque unknown)
refs/remotes/origin/ui/add          0e3c2663 2026-10-10 feat(ui): V2 add-transaction + keypad + transfer reskin (T15-T17)
refs/remotes/origin/ui/assets-report f37cf227 2026-10-10 feat(ui): T19 assets + T20 add-asset + T21 stats redesign (...)
refs/remotes/origin/ui/home         a4636435 2026-10-10 feat(ui): V2.1 main pages glass + contrast
refs/remotes/origin/ui/settings-plans dc5ec7e6 2026-10-10 feat(ui): V2.1 secondary pages glass
```

**[读到] 关键事实：6 条分支全部已合入 main，没有游离的未合并工作。**

```
$ for b in ui-redesign ui/add ui/assets-report ui/home ui/settings-plans; do git merge-base --is-ancestor origin/$b main && echo "$b YES"; done
ui-redesign YES / ui/add YES / ui/assets-report YES / ui/home YES / ui/settings-plans YES

$ git log --oneline main..origin/ui/add
(空)
```

拓扑（**[读到]** 由 `--is-ancestor` 矩阵 + 提交数与合并提交推出）：

```
Initial commit → … → 08862c7d(Supabase 云同步+Bio Lock+后端) → d552c48b(baseline before UI redesign)
   → [UI V2 地基: ui/assets-report(T01–T11) ⊂ ui/add(T13–T21)]
        ├─ ui/home (+a4636435 V2.1 main pages glass)
        └─ ui/settings-plans (+dc5ec7e6 V2.1 secondary pages glass)
             └─ 两路在 94f40fdb / d661e84f 合并
   → ui-redesign（99 个自有提交：主页性能/启动骨架/同步修复…）
   → main（aec40f29，PR #1 合并提交）
```

---

## 2. 技术栈判定（每条带证据）

### 2.1 前端框架：React Native（Expo），**不是** Web / 小程序 / Flutter / 原生

| 项 | 结论 | 证据 |
|---|---|---|
| 框架 | Expo **SDK 57** + React Native **0.86.2** + React **19.2.3** | `package.json:15`、`:37`、`:35` |
| 语言 | TypeScript **~6.0.3**（`tsc --noEmit` 是唯一自动化校验） | `package.json:50`、`CODEMAP.md:28-29` |
| 入口 | `index.ts` → `registerRootComponent(App)` → 根组件 `App.tsx` | `index.ts:1-8` |
| 构建/发布 | Expo + **EAS**（`eas.json`、`app.json`、`metro.config.js`） | `eas.json`、`app.json:67-71`（eas.projectId） |
| 打包目标 | iOS / Android，另含 `react-native-web` 可跑 web | `package.json:45`、`app.json:36-38` |
| Android 包名 | `com.kylim0103.jizhangapp` | `app.json:34` |
| 脚本 | `expo start` / `expo run:android` / `expo run:ios` / `expo start --web` | `package.json:52-57` |

### 2.2 导航 / 状态 / UI / 其它

| 层 | 选型 | 证据 |
|---|---|---|
| 导航 | `@react-navigation` v7：bottom-tabs + native-stack；**1 Tab + 4 个 Stack + 自绘浮空 TabBar（中央凸起 +）** | `App.tsx:83-87`、`App.tsx:592-620`、`App.tsx:319`(CenterTabButton) |
| 状态管理 | **无 Redux/Zustand/MobX**；单一 React Context（`AppContext`）+ 多个小 Context（ThemeMode / Language / Auth / AppLock / TabBarAutoHide） | `src/context/*`、`App.tsx:682-690` Provider 嵌套 |
| 持久化 | **AsyncStorage 2.2.0**，键前缀 `@jizhang/`（16 个业务键 + 若干 UI 偏好键） | `package.json:7`、`src/context/AppContext.tsx:24-36` |
| UI 库 | **无第三方 UI kit**，自建设计系统：`src/components/ui/*`（AppText/MoneyText/Button/Card/ListRow/ListSection/BottomSheet/GlassView/HeroGradient/IconCircle…） | `src/components/ui/index.ts`、`CODEMAP.md:62-65` |
| 图标 | `@expo/vector-icons`（Ionicons） | `package.json:6`，各屏 `Ionicons.glyphMap` |
| 图表 | **自绘**：`react-native-svg` + `src/components/DonutChart.tsx`（环形饼图，可点选扇区） | `package.json:43`、`DonutChart.tsx` |
| 动画 | `react-native-reanimated` 4.5.1 + `react-native-gesture-handler` 2.32（手势分页、金额滚动、玻璃） | `package.json:39-40` |
| 主题 | 浅色/深色两套 token + 跟随系统，1150 行 `theme.ts` | `src/theme/theme.ts:2`、`useSystemColorScheme.ts`、`ThemeModeContext.tsx` |
| i18n | `i18n-js` + `expo-localization`，**zh / en**，可「跟随系统」 | `src/i18n/index.ts:8-30`、`src/i18n/zh.ts`(765 行)/`en.ts`(759 行) |
| 金额输入 | 自绘计算器键盘（四则运算），三处复用 | `src/components/AmountCalculatorKeypad.tsx:2` |

### 2.3 后端：**有，但很小，且是 Node.js（不是 Spring Boot）**

| 项 | 结论 | 证据 |
|---|---|---|
| 位置 | `backend/`（`server.js` 228 行 + `package.json` + `ecosystem.config.js` + README） | `git ls-files backend` |
| 运行时 | **Node.js ≥18 + Express 4.21.2**，PM2 守护，Nginx 反代，只监听 127.0.0.1:3000 | `backend/package.json:10-18`、`backend/server.js:225`、`backend/README.md:13-49` |
| 依赖 | express / @supabase/supabase-js / node-cron / dotenv —— **无 ORM、无 JDBC** | `backend/package.json:13-18` |
| 职责 | ① 推送 token 注册/注销 ② 汇率缓存 ③ 每日抓汇率 cron ④ 可选每日记账提醒推播 ⑤（注释里）预留 RevenueCat webhook | `backend/server.js:1-16` |
| 认证 | 校验 `Authorization: Bearer <Supabase access_token>`，用 service_role 调 `auth.getUser` | `backend/server.js:64-73` |
| 加固 | 内存限流 30 次/分/IP、入参白名单、SSRF 固定出站 host、禁跟随重定向、json 体 16kb | `backend/server.js:46-62`、`:145-159`、`:162-173` |

### 2.4 数据库 / 存储层：**PostgreSQL（Supabase），无 MySQL / SQLite / IndexedDB**

| 项 | 结论 | 证据 |
|---|---|---|
| 数据库 | **Supabase PostgreSQL**，7 张业务表 + 2 张辅助表，**全部开启 RLS**，策略 `user_id = auth.uid()` | `supabase/schema.sql:16-135`、`:140-158`、`supabase/push_tokens.sql:9-42` |
| 迁移方式 | **手写幂等 SQL 脚本**，在 Supabase SQL Editor 手工执行；**无迁移框架**（无 Flyway/Liquibase/Prisma） | `supabase/SETUP.md:1-20`、`schema.sql:5`("可重复执行（幂等）") |
| 文件存储 | Supabase Storage 私有桶 `receipts`（按 user_id 一级目录隔离的策略已建） | `supabase/schema.sql:173-195` |
| 存储使用情况 | **桶建了但前端没有上传代码**：小票只存本地 URI（`receiptUri`/`receipt_path` 注释「Part B 接入」） | `schema.sql:116`、`types/index.ts:35`、仓库内 `storage.from` 调用数 = 0 |
| 本地存储 | AsyncStorage（JSON 整数组写回，串行队列防覆盖） | `src/services/storageQueue.ts:1-20` |
| 同步模型 | **本地为主 + 云端按行镜像**：防抖 push（diff 出增改删，分块 50 行，冲突行逐行隔离）+ 登录/重启 pull 合并（**同 id 以云端为准，本机独有行保留**） | `src/services/syncService.ts:17-28`、`:55`、`:659-663`、`:759-790`、`:999` |

### 2.5 **是否已存在 Spring Boot / Java 后端？—— 明确回答：没有**

```
$ git ls-files | grep -icE "\.java$|\.kt$|pom\.xml|build\.gradle|application\.(properties|yml)$"
0                       # 0 个 Java/Kotlin/Maven/Gradle 文件

$ grep -rilE "spring-boot|springframework|org\.spring|@RestController|mysql-connector|jpa|hibernate" .
./package-lock.json      # 唯一命中是 "jpA" 这个 base64 随机子串（误命中），非真实依赖
```

文件语言构成（`git ls-files` 后缀统计）：**68 tsx / 41 ts** / 14 md / 4 js / 3 html / 2 sql，**0 java**。
**[读到] 结论**：仓库是纯前端 App + 一个 Node/Express 微型后端 + Supabase 托管 Postgres。
"Spring Boot API + MySQL" 属于本次要**新建**的东西，不是"改造现有后端"。

### 2.6 第三方云服务（出站依赖，重写后端时要一并接管）

| 服务 | 用途 | 证据 |
|---|---|---|
| Supabase（`sratnkxbwsbvrewkdeii.supabase.co`） | Auth + PostgREST + Storage | `src/config/supabaseConfig.ts:4-6` |
| **OpenRouter** | ① 视觉模型识别小票 ② 云端 ASR 转写 ③ LLM 把自然语言解析成账目 | `src/utils/scanReceipt.ts:25`、`voiceAccounting.ts:75`、`:112` |
| open.er-api.com | 每日汇率（服务端抓取入库） | `backend/server.js:163` |
| exp.host | Expo Push API 推播 | `backend/server.js:204` |

---

## 3. 页面 / 路由清单

路由名是**中文字符串**，集中在 `src/navigation/routes.ts:9-38`（`ROUTES` 常量），
导航器注册在 `App.tsx`。**[读到]** 实际注册量：**Stack 屏幕注册 30 条 + 底部 Tab 5 个**；屏幕组件 **17 个** + `_preview/ComponentGallery` 1 个。
校验命令：`grep -c "StackNav.Screen name=" App.tsx` → 30；`grep -c "Tab.Screen" App.tsx` → 6（5 个 Tab + 1 处注释）。

```
Tab.Navigator（自绘浮空 TabBar + 中央凸起「+」）
├─ 首页   → HomeStack
│   ├─ 首页主页        HomeScreen              （仪表盘，headerShown:false）
│   ├─ 记一笔          AddTransactionScreen
│   ├─ 类别分类        CategoryManagementScreen
│   ├─ 开设账本        LedgerScreen            ← 与 ProfileStack 双注册
│   ├─ 关于应用        AboutAppScreen
│   ├─ 帮助与反馈      HelpFeedbackScreen
│   ├─ 计算器          CalculatorHubScreen
│   ├─ 贷款计算器      LoanCalculatorScreen
│   ├─ 复利计算器      CompoundInterestScreen
│   ├─ AI专区          AIScreen                ← 与 ProfileStack 双注册
│   └─ 添加资产账户    AddAssetScreen          ← 三处双注册
├─ 资产   → AssetStack
│   ├─ 资产主页        AssetScreen
│   └─ 添加资产账户    AddAssetScreen
├─ 记一笔 → AddTransactionStack（中央圆按钮，onPress 直接 push，每次全新）
│   ├─ 记一笔主页      AddTransactionScreen
│   ├─ 类别分类        CategoryManagementScreen
│   └─ 添加资产账户    AddAssetScreen
├─ 统计   → ReportScreen（直接挂 Tab，无 Stack）
└─ 设置项 → ProfileStack
    ├─ 我的主页        ProfileScreen（=「设置」页）
    ├─ 类别分类 / 开设账本 / AI专区
    ├─ 登录注册        AuthScreen（未登录=登录注册，已登录=个人中心）
    ├─ 财务规划        FinancialPlanningScreen
    ├─ 财务规划编辑    PlanFormScreen（planId 有值=编辑）
    ├─ 关于应用 / 帮助与反馈 / 计算器 / 贷款计算器 / 复利计算器
    └─ 记一笔 / 添加资产账户（双注册，保证 goBack 回原页）
```
证据：`App.tsx:106-122`（HomeStack）、`:140-166`（ProfileStack）、`:185-186`（AssetStack）、`:205-209`（AddTxStack）、`:592-620`（Tab）、`src/navigation/routes.ts:52-106`（参数类型）。

> ⚠️ 路由 `设置`（`ROUTES.SETTINGS`）在 routes.ts:28 有定义，但 **App.tsx 里没有注册该屏幕**——
> 设置页就是 `我的主页 ProfileScreen`。这是常量表与导航器的轻微不一致（非致命，跳转时不会被用到）。

| 页面 | 文件:行数 | 承担的**功能** |
|---|---|---|
| 首页 HomeScreen | `HomeScreen.tsx`:3172 | 净资产（**按币种分页横滑**）、本月预算条 + 设预算弹层、按日分组账单列表（可夹月份分隔）、**日历视图切换**（底部弹层月历 + 逐日热力）、账本抽屉（MRU 排序）、金额隐藏开关、点行编辑、下拉空状态、冷启动数字滚动 |
| 资产 AssetScreen | `AssetScreen.tsx`:1542 | 按币种分组的账户列表（组头=币种+净资产合计）、账户行（信用卡显示欠款/可用/额度使用率细条）、**拖动排序**、账户详情 BottomSheet（余额、信用卡账单/还款日/预估逾期利息、本月流入·流出·净变动）、设为默认、编辑金额（自绘键盘）、归档/删除、已归档折叠区 |
| 添加资产 AddAssetScreen | 695 | 新增/编辑账户：名称、类型（现金/银行/信用卡/电子钱包/投资/其他）、币种、初始余额、信用卡额度/账单日/还款日/年利率 |
| 记一笔 AddTransactionScreen | 2944 | 四入口（支出/收入/**转账**/**兑换**）、分类九宫格（长按拖动排序、最近使用、新增/删除分类）、金额计算器键盘、日期选择、备注、账户选择、转账跨币种手填汇率、手续费（自动生成费用账）、**扫小票回填**、编辑/删除既有账、**自动月结开关** |
| 统计 ReportScreen | 1010 | 支出/收入切换、周/月/年 + 自定义区间、环形饼图（点扇区/点行高亮）、分类排行（占比条 + 金额 + 百分比）、按币种筛选（**不做汇率换算**） |
| 设置 ProfileScreen | 887 | 账户卡（邮箱/同步状态）、安全（生物识别锁 Switch、二级 6 位 PIN）、外观（跟随系统/浅色/深色）、语言（中/EN）、财务规划入口、订阅（**灰行 + 即将推出**）、帮助/关于、版本号 |
| 登录注册 AuthScreen | 568 | Supabase 邮箱注册/登录/退出、头像与首次使用日期、未登录/已登录双态、14 天不活跃登出提示 |
| 类别分类 CategoryManagementScreen | 1002 | 支出/收入分类分段（带条数）、新增/改名/换图标换色/删、大类（group）管理、拖动排序 |
| 开设账本 LedgerScreen | 219 | 新建/重命名/删除账本（默认账本不可删）、模板（生意/报销/公司/团队）、图标色、切换账本 |
| 财务规划 FinancialPlanningScreen | 438 | 计划付款列表（固定支出/收入）、本月合计、左滑删除、暂停/启用、下次扣账日与剩余天数 |
| 计划编辑 PlanFormScreen | 1080 | 计划名/类型/金额（计算器）/关联账户/周期（**只剩每月**）/起止日/自动扣账/暂停/删除 |
| AI专区 AIScreen | 1650 | **语音记账**（录音→ASR→LLM 结构化→确认卡→入账）、**扫小票**入口（跳 AddTransaction autoScan） |
| 计算器 hub / 贷款 / 复利 | 90 / 429 / 274 | 贷款等额本息与复利计算（纯计算器，与账本数据无关） |
| 关于 / 帮助反馈 | 145 / 160 | 版本信息、帮助条目、反馈（无真实提交后端 → 未确认） |
| _preview/ComponentGallery | 808 | **仅 __DEV__ 可见**的设计系统画廊（`App.tsx:692`，生产不渲染） |

---

## 4. 数据模型

### 4.1 实体（源码真相：`src/types/index.ts`；云端真相：`supabase/schema.sql`）

| 实体 | 源码字段（`types/index.ts`） | 云端表（`schema.sql`） | 关系 |
|---|---|---|---|
| Transaction（流水） | `id, amount, categoryId, type('expense'\|'income'\|'transfer'), date(YYYY-MM-DD), note, displayName?, createdAt(ms), ledgerId, assetId?, receiptUri?, fromAssetId?, toAssetId?, exchangeRate?, convertedAmount?, fee?` — `:22-41` | `transactions`:100-119 | ledgerId→ledgers；assetId / fromAssetId / toAssetId → assets（**无外键，仅 id 弱引用**）；categoryId→categories |
| Category（分类） | `id, name, icon, color, type, group?` — `:3-11` | `categories`:86-95（`group_name` 存**名字**而非外键） | group → CategoryGroup.name（弱引用） |
| CategoryGroup（大类） | `name, color?, icon?, type` — `:14-20` | `category_groups`:72-80（`id = name`） | 被 Category.group 引用 |
| Budget（预算） | `categoryId, amount, currency?` — `:43-48`；`categoryId='total'` = 总预算 | `budgets`:128-135（`id = categoryId + '|' + currency`，见 `syncService.ts:380`） | 按 (分类, 币种) 唯一 |
| Ledger（账本） | `id, name, icon, color?, createdAt, lastUsedAt?` — `:50-58` | `ledgers`:32-40 | 所有业务行都带 `ledgerId`；`default` 账本不可删（`AppContext.tsx:506-520`） |
| Asset（账户） | `id, name, icon, color, type('cash'\|'bank'\|'credit'\|'ewallet'\|'investment'\|'other'), currency, initialBalance, ledgerId, createdAt, creditLimit?, statementDay?, dueDay?, interestRate?, isDefault?, archivedAt?` — `:114-136` | `assets`:45-63 | ledgerId→ledgers；credit* 仅信用卡 |
| PaymentPlan（计划付款） | `id, ledgerId, name, amount, type, cycle('weekly'\|'monthly'\|'yearly'), dayOfMonth?/dayOfWeek?/month?/day?, startDate, endDate?, autoDeduct, categoryId\|null, assetId?, active, lastProcessedDate?, createdAt` — `:81-112` | **无对应云表**（不同步！见 §5 缺口） | 到期自动生成 Transaction |
| 设置项 | `currency, dateFormat('YYYY/MM/DD'…), weekStartsOn(0\|1), decimalPlaces(0\|1\|2), periodPreference('day'\|'week'\|'month'\|'year'\|'custom')` — `:60-75` | `profiles`:16-27（同名列/JSONB） | 全局单行 |
| push_tokens | — | `push_tokens.sql:9-15`（token 主键、user_id、platform） | 设备级 |
| exchange_rates | — | `push_tokens.sql:32-36`（base 主键、rates jsonb、fetched_at） | 服务端缓存 |

**[读到] 重要缺口**：`paymentPlans` 只在本地 AsyncStorage（`AppContext.tsx:36` `@jizhang/paymentPlans`），
既不在 `syncService` 的快照里（`syncService.ts:33-46` 的 `LocalSnapshot` 无此字段），
云库也没有对应表 → **换设备会丢财务规划；多设备不互通**。同理丢失的还有：生物锁/二级 PIN/主题/语言/头像/排序等 UI 偏好（本地键，设计上如此）。

### 4.2 货币处理方式（多币种）

| 问题 | 事实 | 证据 |
|---|---|---|
| 支持多少币种 | 内置 **47 种**（含 MYR/CNY/USD/EUR/SGD/HKD/TWD…），带符号；英文名走内置表 + `Intl.DisplayNames` 兜底 | `src/utils/currencies.ts:9-59`、`:407-432` |
| 货币挂在哪一层 | **账户级 `Asset.currency`**；另有**全局偏好 `currency`（默认 `MYR`）** 作为无账户交易的兜底 | `types/index.ts:122`、`AppContext.tsx:259`、`ReportScreen.tsx:420-422` |
| 是否算汇率 | **不做任何自动换算**。净资产/统计**按币种分组**，绝不跨币种相加（README 明确此设计取向） | `README.md:16`、`ReportScreen.tsx:424-435`、`HomeScreen.tsx:1180-1208` |
| 汇率从哪来 | 转账/兑换**由用户手填** `exchangeRate`，系统算 `convertedAmount = amount × exchangeRate` | `AppContext.tsx:635`、`AddTransactionScreen.tsx:779`（兑换页始终显示汇率；普通转账仅跨币种显示） |
| 服务端汇率 | `/api/rates?base=MYR` 抓 open.er-api.com 存 `exchange_rates`，24h 缓存；**但 App 内没有任何调用者**（`BACKEND_URL` 为空） | `backend/server.js:120-143`、`supabaseConfig.ts:14` |
| 预算多币种 | 每币种各一条 `categoryId='total'` 的预算，跟随首页当前选中币种 | `HomeScreen.tsx:1464-1465`、`:2177` |
| 显示规则 | 唯一格式化入口 `formatMoney`：千分位、真减号 U+2212、币种可选前后缀、紧凑 1.5k/1.2M、隐藏 •••••• | `src/utils/formatMoney.ts:114-151` |

### 4.3 金额存储类型：**浮点 number，不是整数分**

**[读到]**
- 源码：`Transaction.amount: number`、`Asset.initialBalance: number`、`Budget.amount: number`、`PaymentPlan.amount: number`（`types/index.ts:24,123,45,84`）。
- 云端：`numeric`（`schema.sql:103,53,132` `amount numeric / initial_balance numeric`），落到 JS 仍是 double。
- 唯一"分"的概念只存在于**输入层**：`useMoneyCentsInput` 把按键数字串格式化为 `整数.两位小数`（`src/hooks/useMoneyCentsInput.ts:10-17`），
  但存进 state/AsyncStorage/Postgres 的仍是 `parseFloat` 结果（`:68`）。
- 四则表达式求值 `amountExpression.ts` 也直接算 double。

**[推测·未确认] 精度风险**：`0.1+0.2` 类误差会经"转账手续费 + 余额累加"放大；目前靠 `toFixed(2)` 显示遮掩，没有分账记账。
→ 重写后端时建议改为 **整数最小单位（bigint 分）× 币种 exponent** 或 `decimal(19,4)`，并保存 `currency` 与 `rate` 快照。

---

## 5. 功能分级（已实现 / 部分实现 / 只有 UI / 完全没有）

> 判定方法：能读到"读→算→写→持久化"全链路 = 已实现；缺一环 = 部分；只有渲染 = 只有 UI；仓库无代码 = 完全没有。
> 仓库内 **TODO/FIXME/HACK 数量 = 0**（`grep -rniE "TODO|FIXME|HACK"` 无命中），说明作者不留标记，
> 缺口必须以"是否有消费者"来判断——下表就是这么得出的。

### 5.1 记账核心 —— 已实现

| 功能 | 状态 | 证据 |
|---|---|---|
| 支出/收入新增、编辑、删除 | 已实现 | `AppContext.tsx:160-173`、`AddTransactionScreen.tsx:1103-1176` |
| 转账（同/跨币种）+ 手续费 | 已实现 | `AppContext.tsx:625-669`（手续费自动生成一笔 expense，`FEE_CATEGORY_ID`） |
| 兑换 | 已实现（复用转账） | `AddTransactionScreen.tsx:99-101`（`UiType` 4 档，exchange→transfer 存储）；README:21 解释「同一套逻辑」 |
| 分类九宫格 + 大类分组 + 拖动排序 + 最近使用 | 已实现 | `AddTransactionScreen.tsx:304-312`（4 个 AsyncStorage 键）、`CategoryManagementScreen.tsx:52-53` |
| 金额四则运算键盘 | 已实现 | `AmountCalculatorKeypad.tsx`(449 行)、`amountExpression.ts`(203 行) |
| 日期选择（含周起始/日期格式响应设置） | 部分 | 选择器已实现；但"日期格式/周起始日"设置**无 UI**（见 5.4） |
| 按月/日分组账单 | 已实现 | `HomeScreen.tsx` SectionList + `monthSep` |

### 5.2 资产 / 账本 / 预算 / 统计

| 功能 | 状态 | 证据与缺口 |
|---|---|---|
| 多账户 6 类型 + 各自币种 + 起始余额 | 已实现 | `AddAssetScreen.tsx`、`types/index.ts:114` |
| 账户余额 = 起始 + 收入 − 支出 + 转入 − 转出（含手续费） | 已实现 | `AppContext.tsx:608-623` |
| 信用卡：欠款/可用额度/额度使用率/账单日/还款日/预估逾期利息 | 已实现 | `creditCard.ts:10-27`（两套口径）、`AssetScreen.tsx:470-502` `computeCreditStatement` |
| 账户详情（余额、本月流入/流出/净变动） | 已实现（**无该账户的流水列表**） | `AssetScreen.tsx:504``computeAssetFlowStats`；详情 i18n `zh.ts asset.inflow/outflow/netChange` |
| 归档有记录的账户 + 已归档折叠区 | 已实现 | `AppContext.tsx:213-217`、`AssetScreen.tsx:558,620` |
| 默认账户 | 已实现 | `AppContext.tsx:603-606` |
| 拖动排序（账户/分类/账本） | 已实现 | `ASSET_ORDER_KEY`/`CAT_ORDER_KEY`、`react-native-draggable-flatlist`（`package.json:38`） |
| 多账本（创建/切换/重命名/删除/模板） | 已实现 | `LedgerScreen.tsx`、`AppContext.tsx:182-185,506-520` |
| **总预算（按币种）** | 已实现 | `HomeScreen.tsx:2177` `setBudget('total', …)`；4 态进度条（<80%/80-100%/>100%/空） `HomeScreen.tsx:971-980` |
| **分类预算（分类进度条 91%/69%/60%）** | **数据层就绪，UI 完全没有** | `setBudget(categoryId,…)` 支持任意分类（`AppContext.tsx:472-497`），但**全仓库唯一调用点是 `setBudget('total',…)`**；`budgets` 唯一读取点也只看 `'total'`（`HomeScreen.tsx:1464`） |
| 统计：收支切换 + 周/月/年/自定义 + 饼图 + 分类排行 + 点选高亮 | 已实现 | `ReportScreen.tsx:61,415-482`、`DonutChart.tsx` |
| 统计按币种筛选 | 已实现（含一处已知 bug，用户知情不修） | `ReportScreen.tsx:443-451` 注释原文「⚠ 币种回退逻辑：本次改造明确不动」 |

### 5.3 AI / 财务规划 / 账户 / 通知

| 功能 | 状态 | 证据与缺口 |
|---|---|---|
| 小票 OCR → 回填表单 | 已实现（**强依赖硬编码密钥 + 外网**） | `ReceiptCameraModal.tsx`(168) → `scanReceipt.ts:20-69`（OpenRouter 视觉模型，返回 amount/merchant/date/type/分类建议）→ `AddTransactionScreen.tsx:791`(`autoScan`) |
| 小票图片上云 | 完全没做 | bucket+RLS 已建（`schema.sql:173-195`），但 0 处 `storage.from` 调用；只存本地 `receiptUri` |
| 语音记账 | 已实现 | `AIScreen.tsx`(1650) + `voiceAccounting.ts`（ASR `qwen/qwen3-asr-flash` + LLM 结构化 + 8s 超时熔断，`:14,17`） |
| AI 消费分析 / 对话式记账 | **明确移除** | `AIScreen.tsx:764` 原文：「两个占位功能（消费习惯分析/对话式记账）未开发，入口已移除」 |
| 财务规划：月度固定支出/收入计划 | 已实现 | `FinancialPlanningScreen.tsx`、`PlanFormScreen.tsx` |
| 自动扣账引擎 + 补账（上限 24 期） | 已实现 | `utils/paymentPlans.ts:11`(`MAX_CATCHUP_OCCURRENCES = 24`)、`AppContext.tsx:685-735` |
| 周/年周期 | **引擎支持，UI 已删** | `paymentPlans.ts:37-52` 支持 weekly/yearly；`PlanFormScreen.tsx:1-6` 原文「扣账周期固定"每月"…旧的每周/每年周期与扣账日字段已移除」 |
| 记账时"自动月结"开关 | 已实现 | `AddTransactionScreen.tsx:1133-1157`（顺带创建 monthly 计划，防重复；游标钉到本期防同日双账） |
| 到期提醒（本地通知） | 部分 | `usePaymentReminders.ts:11-12`（13:00/18:30 检查 7 天内、只提醒未开自动扣账的）；Expo Go 内静默跳过（`:4`） |
| 每日推播提醒（服务端） | 已实现但**默认关闭且 App 未接** | `backend/server.js:187-215,218-220`（`PUSH_REMINDER_ENABLED=false`）；`supabaseConfig.ts:14` `BACKEND_URL=''` → `notifications.ts:96-97` 直接跳过注册 |
| 邮箱注册/登录/退出 | 已实现 | `AuthContext.tsx:22-35`、`AuthScreen.tsx` |
| 14 天不活跃自动登出 | 已实现 | `supabaseConfig.ts:8-10`(`INACTIVITY_LIMIT_MS`)、`AuthContext.tsx:9-10` |
| 云同步（7 表 push/pull/合并） | 已实现 | `syncService.ts:17-28,999,1072-1092`、`useSyncManager.ts` |
| 生物识别锁 | 已实现（**客户端便利锁，不是加密**） | `AppLockContext.tsx:11-23` 原文注明 |
| 二级 6 位 PIN（删除账本时校验） | 已实现 | `AppLockContext.tsx:19-22`、`pinCrypto.ts`(112 行 SHA-256+盐) |
| **修改密码 / 忘记密码** | **完全没有** | 仓库内 `resetPassword`/`updateUser`/`修改密码` 命中 0 |
| **订阅会员 Premium** | **只有 UI（灰行 + 即将推出）** | `ProfileScreen.tsx:293-300`(`disabled` + `Badge`)、i18n `zh.ts:581-582`、`en.ts:578-580`；无 RevenueCat/IAP 依赖（`package.json` 无相关包）；后端只留注释「预留 RevenueCat webhook」（`server.js:9`） |
| 导出/分享（expo-sharing 已装） | 未确认是否有消费者 | `package.json:31` 有 `expo-sharing`，`app.json:55` 注册插件；未逐个核对其调用点 |

### 5.4 【重要】"数据层/接口就绪但 UI 不存在"的死设置（重写时必须补）

| AppContext 暴露的 setter | 全仓库调用点 | 云端已有列 | 结论 |
|---|---|---|---|
| `setCurrency` | **0** | `profiles.currency` | 全局货币切换 UI 不存在（货币只能按账户选） |
| `setDateFormat` | **0** | `profiles.date_format` | 日期格式设置 UI 不存在 |
| `setWeekStartsOn` | **0** | `profiles.week_starts_on` | 周起始日设置 UI 不存在 |
| `setDecimalPlaces` | **0** | `profiles.decimal_places` | 小数位设置 UI 不存在 |
| `setPeriodPreference` | **0** | `profiles.period_preference` | 自定义周期偏好 UI 不存在（统计页用自己的 DateRangePicker） |

证据命令：`grep -rn "setCurrency" --include=*.tsx --include=*.ts .` → 只命中 AppContext 定义与 AddAssetScreen 里的同名 useState（`setCurrencySearch` 不匹配）。

→ **[读到] 这 5 个 setter 是死 API；对应的 4 个设置页（SettingsScreen / CurrencyScreen / PeriodScreen 等）在仓库中不存在。**
（`CODEMAP.md:111-117` 声称有这些页面，见 §10 文档漂移。）

---

## 6. 各 ui/* 分支相对 main 的差异摘要

**先说结论（最容易误判的一点）**：`git log main..<branch>` 对 5 条分支全部为空，`git diff --stat main...<branch>` 也为空。
不是命令出错，而是**这些分支早已全部合入 main**（`git merge-base --is-ancestor origin/<b> main` 全为 YES）。
所以"分支 vs main 的差异"实际是 0；有意义的是**每条分支当初做了什么**，下表用分支 tip 的提交与合并提交还原。

| 分支 | tip | 该分支做的事（从提交与 diff 读出的意图） | 代表提交 |
|---|---|---|---|
| `ui/assets-report` | `f37cf227` | **UI V2 地基 + 资产/统计重做**：T01 设计令牌、T02 formatMoney/formatDate、T03–T05 共享组件（AppText/MoneyText/Button/Card/ListSection/ListRow/BottomSheet…）、T06/T07 TabBar 与安全区单源、T11a 陀螺仪 web 白屏守卫、**T19 资产、T20 添加资产、T21 统计（ListSection 行、信用卡欠款口径、饼图点选/图例、抽屉）** | `7487b17a`、`5fe738ce`、`6f99c375`、`f37cf227` |
| `ui/add` | `0e3c2663` | **UI V2「记一笔」全量重皮**：R0 令牌+Geist+HeroGradient/GlassView/IconCircle+浮空 TabBar、T13 抽出记一笔共享部件、T14 头部/金额 Hero/Chips/账户选择、T15 分类九宫格、T16 转账/兑换、T17 键盘尺寸与震动 | `a6682754`、`42747c50`、`8373b9a3`、`0e3c2663` |
| `ui/home` | `a4636435` | **V2.1 主页面玻璃 + 对比度**：统一 GlassView、3D IconCircle、首页/资产/统计/设置/规划重皮；仅 1 个自有提交（其余来自合并） | `84181159`、`a4636435` |
| `ui/settings-plans` | `dc5ec7e6` | **V2.1 二级页面玻璃**：AuthScreen / CategoryManagement / CalculatorHub / About 等二级页统一玻璃与对比度；仅 1 个自有提交 | `dc5ec7e6` |
| `ui-redesign` | `bec6051d` | **最大的一条（99 个自有提交）**：首页手势分页/日历弹层/性能（UI 线程手势、预挂载邻页、单次提交）、启动门（splash 等待字体与数据 + shimmer 骨架 + 上次快照）、TabBar V2.4 几何、无障碍与对比度修复、**归档账户**、`runStorageExclusive` 串行存储、云同步健壮性（`fullSync` 前 flush、Postgres 21xxx/22xxx 归为坏行、budgets 21000 去重自愈） | `fea92b97`、`af57d352`、`1853dfbb`、`5d8b50a3`、`4914519a`、`bec6051d` |

补充数据：`git diff --shortstat main origin/<branch>` 显示的是"main 相对该分支多出来的后续工作"
（如 ui/add：70 files changed, 5826 insertions(+), 9512 deletions(-)），方向是**回退**，不是该分支的新增。
真正的新增应看分支内部提交，见上表。

---

## 7. API 层清单

### 7.1 App ↔ Supabase（PostgREST，非自研 REST）

客户端只用 `supabase-js` 的通用表访问（`syncService.ts:659-663` 动态表名）：

| 方法 | 路径（等效） | 表 | 用途 | 证据 |
|---|---|---|---|---|
| SELECT | `/rest/v1/{table}?select=*&order=id&range=…` | transactions / categories / category_groups / budgets / ledgers / assets | 登录/重启拉全量（分页拉取） | `syncService.ts:659-663` |
| UPSERT | `/rest/v1/{table}` | 同上 + profiles | 本地变更后防抖推送（50 行/批，失败逐行隔离） | `syncService.ts:759-780` |
| DELETE | `/rest/v1/{table}?id=in.(…)` | 同上 | 本地删除同步到云端 | `syncService.ts:781-790` |
| SELECT/UPSERT | `/rest/v1/profiles` | profiles | 用户设置偏好单行 | `syncService.ts:680,854` |
| Auth | `/auth/v1/*` | — | signUp / signInWithPassword / signOut / getSession / autoRefresh | `supabaseClient.ts:12-18`、`AuthContext.tsx` |
| Storage | `/storage/v1/object/receipts/{uid}/…` | receipts 桶 | **策略已建，客户端 0 调用** | `schema.sql:173-195` |
| RPC | 无 | — | 没有数据库函数/视图/触发器业务逻辑（只有 `moddatetime` 触发 updated_at） | `schema.sql:161-171` |

### 7.2 自研 Node 后端（`backend/server.js`）

| 方法 | 路径 | 鉴权 | 说明 | 行号 |
|---|---|---|---|---|
| GET | `/api/health` | 无 | 健康检查（UptimeRobot 用） | `:79-81` |
| POST | `/api/register-push-token` | Bearer | body `{token, platform}`，Expo token 正则校验，upsert `push_tokens` | `:84-102` |
| POST | `/api/unregister-push-token` | Bearer | body `{token}`，按 user_id 删除 | `:105-117` |
| GET | `/api/rates?base=MYR` | Bearer | 24h 缓存命中即返回，否则抓 open.er-api.com 并入库 | `:120-143` |
| （cron） | `RATES_REFRESH_CRON`（默认 `0 7 * * *`） | — | 每日抓汇率 | `:217`,`:177-184` |
| （cron） | `PUSH_REMINDER_CRON`（默认 `0 14 * * *`，默认关） | — | Expo Push 批量 100/次 | `:218-220`,`:187-215` |
| （预留） | RevenueCat webhook | — | **只有注释，无实现** | `:9` |

限流：同 IP 30 次/分（`:47-62`）。**没有**：用户 CRUD、账目 API、预算 API、OCR 代理、分页查询接口——
账目数据完全由 App 直连 Supabase，不经这个后端。

### 7.3 App ↔ 第三方 AI（OpenRouter，3 个外部端点）

| 端点 | 用途 | 证据 |
|---|---|---|
| `POST https://openrouter.ai/api/v1/chat/completions`（image_url） | 小票识别，要求只返回 JSON | `scanReceipt.ts:25-43`、prompt `:11-18` |
| `POST https://openrouter.ai/api/v1/audio/transcriptions` | 语音转写（`qwen/qwen3-asr-flash-2026-02-10`，language=zh） | `voiceAccounting.ts:72-107` |
| `POST https://openrouter.ai/api/v1/chat/completions`（`provider.sort=latency`） | 自然语言→账目 JSON | `voiceAccounting.ts:109-162` |

---

## 8. 关键业务规则（含代码位置，便于重写时逐条对齐）

### 8.1 余额与转账（`AppContext.tsx:608-669`）

```ts
// 余额 = 起始 + 收入 − 支出 ；转账：转出 −(金额+手续费)，转入 +到账金额
if (t.fromAssetId === assetId) balance -= t.amount + (t.fee ?? 0);
if (t.toAssetId === assetId)   balance += t.convertedAmount ?? t.amount;
```
规则要点：
1. **手续费同时计两次**：转账单的 `fee` 从转出账户扣（`:614`），**并且**额外生成一笔 `type='expense'` 的费用流水（`:654-666`）——
   即"账面支出总额"会包含手续费，而账户余额只扣一次。重写时必须原样保留这个语义（否则历史数据对不上）。
2. 到账金额 = `amount × exchangeRate`（`:635`），**汇率由用户手填**，系统不做联网换算。
3. 兑换与转账在数据层是**同一个 `type='transfer'`**，只有 UI 分两个入口（`AddTransactionScreen.tsx:99-101`）。

### 8.2 信用卡两套口径（`creditCard.ts:10-27`）

- `balance < 0` 视为欠款；**列表/选择器**显示"可用额度 = 额度 − 欠款"（`getAssetDisplayBalance`）；
- **转账/兑换**场景显示"欠费金额"（`getAssetTransferBalance`）；
- 详情页另算账单周期与预估逾期利息（`AssetScreen.tsx:470-502`）。
→ 重写时不要合并成一个"余额"字段，否则信用卡语义会错。

### 8.3 多币种不做换算（产品级硬规则）

- 净资产、统计、预算全部**按币种切分**，不跨币种相加（`HomeScreen.tsx:1180-1208`、`ReportScreen.tsx:424-435`）；
- 页面级"当前币种"由用户选择（首页横滑、统计页 Chip）。
- README 原话：「不同货币不会强行加总，避免出现"我们帮你编了个汇率"这种不严谨的情况」（`README.md:16`）。

### 8.4 预算

- 数据：`(categoryId, currency)` 唯一；`categoryId='total'` 表示总预算（`AppContext.tsx:472-490`）；
- 写入 0/空 = 清除该条（`:473`）；
- 首页只消费总预算，跟随当前币种（`HomeScreen.tsx:1464,2177`）；
- 进度 4 态：<80% 正常 / 80–100% warning / >100% danger / 未设置（`HomeScreen.tsx:971-980`；资产页额度条同语义 `AssetScreen.tsx:102`）。

### 8.5 计划付款引擎（`utils/paymentPlans.ts`）

- 周期：weekly（+7 天同星期）、monthly（下月同日，**超出当月天数兜底为月末**）、yearly（同日，2/29→2/28）（`:37-52`）；
- 补账游标 `lastProcessedDate`，**单次最多补 24 期**（`:11,110`）；
- 只对 `active && autoDeduct` 的计划自动入账；未开 autoDeduct 的只发提醒（`usePaymentReminders.ts:25`）；
- 生成交易的 `note` 留空、计划名写进 `displayName`（`AppContext.tsx:709-720`）；
- 已知缺陷：财务规划页两张汇总卡把**暂停中的计划也计入合计**，用户已确认本批不修（`FinancialPlanningScreen.tsx:13-14` 注释原文）。

### 8.6 收据扫描（`utils/scanReceipt.ts`）

- 输入：base64 图片 → OpenRouter 视觉模型 → 严格 JSON `{amount, merchant, date, type, suggestedCategory}`（`:11-18`）；
- 分类建议是**中文分类名**，再由 `findCategoryIdByChineseName` 映射成 id（`AIScreen.tsx` 同法）；
- 防呆：剥 markdown 代码块、JSON 解析失败给中文错误（`:53-61`）；
- **密钥硬编码在客户端**（`aiConfig.ts:10`），作者自己在注释里承认"上架前必须改成服务端代理"（`aiConfig.ts:1-7`）。
- 无离线/无本地模型兜底；无重试；失败即提示换图。

### 8.7 订阅 / 会员

- 仅一条不可点的灰行 + `Badge('即将推出')`（`ProfileScreen.tsx:293-300`）；
- 无 IAP/RevenueCat/收据校验/权益判断/价格页；
- 后端只有一行注释预留 webhook（`backend/server.js:9`）。
→ **"订阅会员"完全未实现，属纯设计需求。**

### 8.8 安全与隐私

| 规则 | 位置 |
|---|---|
| Bio Lock 是**客户端便利锁**，数据仍明文存 AsyncStorage | `AppLockContext.tsx:17`（原文「不是加密——数据本身仍在 AsyncStorage」） |
| 二级 PIN：SHA-256 + 盐，无自助找回 | `AppLockContext.tsx:19-21`、`pinCrypto.ts` |
| 连续 14 天未打开 → 强制重新登录 | `supabaseConfig.ts:8-10` |
| 云端每表 RLS `user_id = auth.uid()`；service_role 只在后端 .env | `schema.sql:140-158`、`backend/README.md:10-11` |
| 后端不信任客户端 userId，以验签结果为准 | `backend/server.js:93-94` |
| 出站 URL 固定 + 货币白名单 + 禁重定向（防 SSRF） | `backend/server.js:145-159` |

---

## 9. 【最重要】11 屏设计图 ↔ 仓库实现状态对照

> 设计图 11 屏清单取自 `HANDOFF.md`（两张 PNG：`已生成图像 1.png` 浅色 / `已生成图像 1 (1).png` 深色）。
> 判定口径：能在代码里找到"数据来源 + 计算 + 可写回"的完整链路才算「已实现」。

| # | 设计屏 | 仓库落点 | 状态 | 具体差距（重写要补的点） |
|---|---|---|---|---|
| 1 | **首页**（净资产卡 + 快捷操作 + 最近交易 + 底部 Tab） | `HomeScreen.tsx` | **已实现（85%）** | 净资产 ✓（按币种横滑、可隐藏）、最近交易 ✓（按日分组、可夹月份）、底部 Tab ✓（浮空 + 中央 +）。**"四个快捷操作（支出/收入/转账/兑换）"已不在首页**——只在记录页顶部切换（`AddTransactionScreen.tsx:99-101`）；首页无「本月收入/支出/结余」三栏（该汇总只在日历卡里）。详见 §10 文档漂移 |
| 2 | **我的资产**（总额 + 账户分组：全部/现金/银行/电子钱包，多币种） | `AssetScreen.tsx` | **已实现** | 币种分组 ✓、组内合计 ✓（组头"净资产 + 合计"）、信用卡行 ✓。"全部/现金/银行/电子钱包"在设计中是**类型筛选 Tab**，代码里没有类型筛选，只有币种分组 + 类型排序（`typeOrder` `AssetScreen.tsx:892`）。顶部"总额汇总卡"在 V2.2 已被删除（`:617`） |
| 3 | **添加交易**（支出/收入/转账/兑换 + 分类九宫格 + 备注 + 完成） | `AddTransactionScreen.tsx` | **已实现（超出设计）** | 四类型 ✓、九宫格 ✓（含大类分组/拖动/最近）、备注 ✓、键盘 ✓；额外有：日期、账户、跨币种汇率、手续费、扫小票、自动月结、编辑/删除 |
| 4 | **统计分析**（收支切换 + 月/周/年 + 环形饼图 + 分类明细+占比） | `ReportScreen.tsx` | **已实现** | 全部 ✓，且多出：自定义区间、点扇区高亮、按币种筛选。已知 bug：币种回退（`ReportScreen.tsx:443-451`，用户知情不修） |
| 5 | **个人设置**（资料卡 + 订阅 Premium + 安全：生物识别/二级密码/**修改密码**/语言 + 外观：日间/夜间/跟随系统） | `ProfileScreen.tsx` | **部分实现** | 资料卡 ✓ `:179-219`；生物识别 ✓ `:224-233`；二级密码 ✓ `:234-245`；语言 ✓ `:268-284`；外观三选一 ✓ `:250-263`；**订阅 Premium = 灰行 + 即将推出（无功能）** `:293-300`；**修改密码 = 完全没有**（仓库 0 命中） |
| 6 | **日历视图**（月历 + 当日交易） | `MonthCalendarCard.tsx`(608) + `HomeScreen.tsx:827-880` | **已实现（形态不同）** | 不是独立页面，而是**首页底部弹层**（列表/日历切换按钮）；月历 ✓、逐日热力 ✓、按指标分段（支出/收入/转账/总额）✓、点某日看明细 ✓、跨月翻页 ✓ |
| 7 | **分类管理**（支出分类/收入分类，带条数与编辑） | `CategoryManagementScreen.tsx`(1002) | **已实现** | 收支分段 + 条数 ✓（i18n 注释 "Expense · 30" `en.ts:198`）、增删改 ✓、大类管理 ✓、拖动排序 ✓、九宫格选图标色 ✓ |
| 8 | **账户详情**（单账户余额 + 转账/编辑/更多 + **交易记录**/月度统计/账户设置） | `AssetScreen.tsx:470-925` | **部分实现** | 余额 ✓、信用卡账单/还款日/预估利息 ✓、本月流入/流出/净变动 ✓、编辑金额（自绘键盘）✓、设为默认 ✓、归档/删除 ✓。**缺：该账户的"交易记录"列表**（只有聚合统计，无流水清单）；**缺：详情页内的"转账"入口** |
| 9 | **月度预算**（总预算进度 + **分类预算进度条 91%/69%/60%**） | `HomeScreen.tsx:946-1050`、`AppContext.tsx:472-497` | **部分实现（缺一半）** | 总预算进度 ✓（按币种、4 态颜色、可在首页弹层设置）。**分类预算：数据层/接口就绪但 UI 完全没有**——`setBudget` 唯一调用是 `('total', …)`，没有任何页面渲染分类进度条 |
| 10 | **收据扫描**（拍照 OCR → 金额行 → 重拍/确认导入） | `ReceiptCameraModal.tsx` + `scanReceipt.ts` + `AddTransactionScreen.tsx:791` | **已实现（云端 AI，非本地 OCR）** | 拍照/相册 ✓、识别回填（金额/商家/日期/类型/分类）✓、确认导入=提交表单 ✓。**差异**：无"金额行逐项确认"UI（直接回填整张表单）；识别依赖 OpenRouter + 硬编码密钥；**无重拍引导流程**（关闭重开）；识别结果无多候选/无金额校验提示 |
| 11 | **概览模式**（净资产 + 本月支出/收入/结余 + 预算进度 + 快捷操作） | `HomeScreen.tsx` 主页 + `MonthCalendarCard` 汇总块 | **部分实现（无独立"概览模式"）** | 净资产 ✓、预算进度 ✓；**本月支出/收入/结余的集中三栏 / "概览模式"这个独立视图不存在**——最接近的是日历卡顶部的汇总块（`MonthCalendarCard.tsx:300,337` `home.calNet`）。快捷操作同 #1 缺失 |

### 9.1 一句话总结这 11 屏

| 状态 | 屏 |
|---|---|
| 已实现 / 超出设计 | #3 添加交易、#4 统计、#6 日历、#7 分类管理、#10 收据扫描（云端 AI 版） |
| 已实现但有形态差异 | #1 首页（缺 4 快捷入口）、#2 资产（无类型筛选 Tab、无顶部总额卡） |
| **部分实现，重写必须补** | #5 设置（缺修改密码；订阅是空壳）、#8 账户详情（缺该账户流水列表、缺详情内转账）、#9 预算（**缺分类预算进度条**）、#11 概览模式（缺独立视图与收支结余三栏） |
| 完全没有 | 订阅会员/支付（Premium 全链路） |

---

## 10. 文档漂移（重写时不能拿 md 当规格）

**[读到] 仓库里的 md 描述的是更早的版本，与代码不一致。** 三处硬证据：

| 文档声称 | 实际 | 证据 |
|---|---|---|
| `CODEMAP.md` 导航树里有「账单明细 TransactionListScreen」 | **该文件不存在**（`ls src/screens` 无此文件，App.tsx 也未注册） | `CODEMAP.md:98,140` vs `App.tsx:106-122` |
| `CODEMAP.md`/`PROJECT.md` 称设置下有「SettingsScreen / CurrencyScreen / PeriodScreen（选择货币、自定义周期）」 | **三个文件都不存在**；对应 setter 无调用点（§5.4） | `CODEMAP.md:112-116`、`PROJECT.md` vs §5.4 grep |
| `README.md`「首页有收入/支出/转账/兑换四个快捷入口 + 最近使用分类」 | 首页现在没有快捷入口与"最近使用分类"模块（只有中央 + 按钮）；"最近使用分类"在记录页 | `README.md:15-19` vs `HomeScreen.tsx`(无 quick action)；`AddTransactionScreen.tsx:304` `RECENT_CATEGORY_KEY` |

其它仍在生效、可当规格用的文档：`UI_RULES.md`（设计铁律：色/字号/间距/金额日期/中英不撞/交互态）、`AGENTS.md`（开发规则）、`src/i18n/*`（文案全集，等于功能清单的自然语言版）。
`src/screens/_preview/ComponentGallery.tsx`（808 行）是设计系统画廊，仅在 `__DEV__` 渲染（`App.tsx:692`），可作为重构时的组件基线。

---

## 11. 风险清单（重写后端前必须知情的坑）

| 级别 | 风险 | 证据 |
|---|---|---|
| **高** | **真实 OpenRouter API Key 被硬编码并提交进 git 历史**（`sk-or-v1-601f…`）。任何人 clone 即可盗刷额度；改写历史也删不掉（已在 pack 里） | `src/config/aiConfig.ts:10` |
| **高** | 金额用 IEEE754 double 存储与累加，无最小单位整数 | §4.3 |
| **中高** | 云同步无冲突解决：同 id 以云端为准、删除即物理删，**多设备并发编辑/删除会互相覆盖**；无墓碑、无版本号、无 updated_at 比较 | `syncService.ts:17-28,781-790` **[推测·未确认]** 具体覆盖行为未在真机验证 |
| **中高** | `paymentPlans` 不同步（无云表、不在快照里）→ 换机丢数据 | §4.1 |
| **中** | 订阅/付费、修改密码两类"账号级"能力完全没有，而设计与产品都当它们存在 | §5.3、§9#5 |
| **中** | 小票图片只存本地 URI（`receiptUri`），换机/清数据后图片丢失；云端 bucket 空转 | `schema.sql:173-195`、0 处上传 |
| **中** | 迁移是手写幂等 SQL，无版本表、无回滚；靠"add column if not exists"堆叠（已有先例：`archived_at` 漏列导致同步报错） | `schema.sql:65-66`、`syncService.ts:96-98` 注释「2026-10-20 归档功能的 archived_at 列踩过」 |
| **中** | 无任何测试、无 lint；唯一自动化校验是 `npx tsc --noEmit` | `package.json:52-57` 无 test/lint 脚本、`CODEMAP.md:28-29` |
| **低** | 路由常量 `ROUTES.SETTINGS='设置'` 未注册 | `routes.ts:28` vs `App.tsx:140` |
| **低** | `BACKEND_URL=''` → 推送注册整体停用（代码静默跳过） | `supabaseConfig.ts:14`、`notifications.ts:96-97` |

---

## 12. 我无法确认的问题（3–5 条，需要作者/真机/账号）

1. **同步冲突的真实行为**：两设备同时改同一笔交易/一边删一边改，最终结果是什么？
   （代码是"同 id 云端胜 + 物理删除"，但 `pull` 合并后是否会把已删行"复活"、`lastSyncAt`/镜像在异常中断后如何自愈，我没法仅靠读码确定。**未确认**）
2. **AI 收据识别的真实成功率与成本**：`anthropic/claude-sonnet-4.5` 视觉 + 中文手写小票的表现、单次成本、是否需要多币种/多语言 prompt——无样本、不应擅自调用外部 API（边界也禁止）。
   **未确认**；另需确认该 key 当前是否仍有效（若已失效，"扫小票"实际已坏）。
3. **通知链路的真实可用性**：`BACKEND_URL` 为空 → push token 从不注册；且 `usePaymentReminders` 在 Expo Go 里静默跳过。
   线上构建是否另有配置（EAS secrets / 环境变量覆盖）在仓库里看不到。**未确认**。
4. **`supabase/SETUP.md` 与线上库是否一致**：仓库 SQL 是"可重复执行"脚本，但线上库可能已被手工改过（`archived_at` 事故印证过这一点）。
   只有登录 Supabase 才能比对真实 schema。**未确认**。
5. **"设置"页是否曾存在、被谁删掉**：`routes.ts` 仍有 `SETTINGS` 常量、`profiles` 表仍有 currency/date_format/week_starts_on/decimal_places 列，
   但没有任何 UI 与 setter 调用。是"计划中未做"还是"做过又被移除"，从 git 历史看不出明确删除提交。**未确认**。

---

## 13. 复现本报告的命令（只读）

```bash
cd _repo/jishiben
git rev-parse HEAD
git for-each-ref --format='%(refname) %(objectname:short) %(committerdate:iso) %(subject)' refs/remotes refs/heads
for b in ui-redesign ui/add ui/assets-report ui/home ui/settings-plans; do
  git merge-base --is-ancestor origin/$b main && echo "$b: merged into main"; done
git ls-files | grep -icE "\.java$|\.kt$|pom\.xml|build\.gradle"        # → 0
grep -rn "@jizhang/" src App.tsx                                          # 本地存储键全集
grep -rn "setCurrency\|setDateFormat\|setDecimalPlaces\|setPeriodPreference\|setWeekStartsOn" src App.tsx
grep -rn "from('" src/services/syncService.ts                             # 云表访问
grep -rniE "TODO|FIXME|HACK" src App.tsx backend supabase                 # → 0
```

> 本文件是唯一新增产物，除此之外没有修改工作目录内任何文件（两张 PNG 与 HANDOFF.md 未动，clone 出的仓库代码未动，未做任何 commit）。
