# PROJECT.md — 记账 App（jizhang-app）

个人记账应用：支持支出/收入/转账记账、多账本、资产管理、预算、计划付款、统计报表，以及 AI 小票扫描和语音记账。数据全部保存在手机本地（AsyncStorage），无账号、无云端同步。

- **语言/界面**：中文界面，代码注释也以中文为主
- **平台**：iOS / Android（Expo），兼做 Web
- **包名**：`kunova.moni`（Android；iOS bundleIdentifier 仍是 com.kylim0103.jizhangapp），EAS projectId 已配置（见 `app.json`）

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | Expo SDK 57（bare workflow，含 `android/` 原生目录）、React Native 0.86、React 19 |
| 语言 | TypeScript ~6.0（无 lint / 测试配置，验证手段为 `npx tsc --noEmit`） |
| 导航 | @react-navigation v7：bottom-tabs + native-stack |
| 状态管理 | React Context（`src/context/AppContext.tsx` 单一全局 Context），无 Redux/Zustand |
| 持久化 | @react-native-async-storage/async-storage（键前缀 `@jizhang/`） |
| 动画 | react-native-reanimated 4 + react-native-worklets、RN 内置 Animated |
| 图表 | react-native-svg 自绘（DonutChart 环形图、趋势图） |
| AI | OpenRouter API（视觉模型 `anthropic/claude-sonnet-4.5`、语音转写 `qwen/qwen3-asr-flash-2026-02-10`），密钥配置在 `src/config/aiConfig.ts` |
| 其他 Expo 模块 | expo-notifications（计划付款提醒）、expo-camera / expo-image-picker（拍小票）、expo-audio（语音记账）、expo-haptics、expo-linear-gradient、expo-blur、expo-file-system、expo-sharing、expo-device、expo-constants |

## 功能总览

底部 5 个 Tab：**首页 / 资产 / 记一笔（中间凸起圆形按钮）/ 统计 / 设置项**。首页和设置项各自内嵌 Stack，切换 Tab 会自动重置回根页面（`resetToRootOnTabPress`）。浮空 Tab 栏带"水滴"滑动指示器，滚动时自动收起（`TabBarAutoHideContext`）。

### 记账
- 三种类型：支出、收入、转账。转账选转出/转入账户；跨币种时手动填汇率，生成 `convertedAmount`；手续费选填，一旦填写会**自动生成一笔"手续费"支出**（分类 id `transfer_fee`），不会漏记
- 金额输入支持**计算器键盘 + 四则表达式**（`AmountCalculatorKeypad` / `useAmountExpression` / `amountExpression`）
- 支持新增、编辑、删除；可关联资产账户、附小票照片（`receiptUri`）
- 记一笔时自动带出"默认资产账户"（同一时间最多一个 `isDefault`）

### 首页（仪表盘）
顶部收入/支出/结余卡片（带环比上月变化）、四个快捷入口、今日账单预览、本月预算进度、最近使用分类；月份切换器可翻看任意月份；"查看全部"进入按月分组的**账单明细**（`TransactionListScreen`）。

### 资产
6 类账户：现金 / 银行卡 / 信用卡 / 电子钱包 / 投资 / 其他。每个账户可设自己的货币和起始余额，净资产**按币种分开显示**（不强行汇兑加总）。信用卡有专属字段：额度、账单日、还款日、年利率；信用卡在"支出/收入"场景显示**可用额度**（额度−已用），在"转账"场景显示**欠费金额**，两者是不同的数（`src/utils/creditCard.ts`）。

### 统计
支出/收入切换标签；分类占比环形图 + 近 6 个月趋势图；配合首页的月份切换查看历史。

### 多账本
支持多账本（生意/报销/公司/团队四个快捷模板 + 自定义名称图标），账本间数据完全隔离——交易、资产、计划付款都带 `ledgerId`。默认账本 id 固定为 `default`，不可删除。

### 预算与分类
- 按分类设预算，首页显示预算进度
- 预置 30 个支出分类 + 6 个收入分类（`src/utils/defaultCategories.ts`），支持新增/删除自定义分类

### 财务规划（已实现）
入口：设置项 → 财务规划（`FinancialPlanningScreen`）。核心子项**计划付款**（`PaymentPlan`，存储键 `@jizhang/paymentPlans`）：
- 周期：每周 / 每月 / 每年（扣账日各配），关联资产账户与分类可选
- "到点自动入账"开启时，App 启动 / 云同步写回后自动补账（逐期追赶，上限 24 期，月末兜底不溢出；引擎纯函数在 `utils/paymentPlans.ts`，游标 `lastProcessedDate`）
- 自动扣账关闭的计划仅**本地通知提醒**（`usePaymentReminders`，每天 13:00 / 18:30 检查 7 天内到期项，Expo Go 内自动跳过）
- 概览卡：本月已扣合计 / 7 天内到期 / 暂停中；页面预留扩展位（储蓄目标等未来模块各占一卡）

### AI 功能（OpenRouter）
- **扫描小票**：拍照或相册选图 → 视觉模型识别金额、商家、日期、支出/收入、建议分类 → 回填记账表单（`scanReceipt.ts` + `ReceiptCameraModal`）
- **语音记账**：录音 → ASR 转写 → LLM 解析成记账信息 → 确认后入账（`voiceAccounting.ts`，入口在 AI 专区 `AIScreen`，含分阶段诊断日志）
- 其他 AI 功能目前为"开发中"占位卡片

### 设置
选择货币（内置 12 种，全局金额符号联动）、自定义统计周期（日/周/月/年/自定义范围）、日期显示格式、每周起始日、金额小数位数、深色模式（跟随系统 + 手动覆盖）。另有计算器合集：**贷款计算器、复利计算器**。

## 架构

### 入口与 Provider 层级（`App.tsx`）

```
GestureHandlerRootView
└─ SafeAreaProvider
   └─ ThemeModeProvider        # 深色模式偏好
      └─ AppProvider           # 全部业务数据 + 持久化（src/context/AppContext.tsx）
         └─ AppContent
            ├─ TabBarAutoHideProvider
            └─ NavigationContainer（主题色与 useTheme 联动）
               └─ Tab.Navigator（自定义浮空 TabBar + 中央凸起"+"按钮）
                  ├─ 首页   → HomeStack（记一笔/账单明细/开设账本/个人中心/关于/帮助/计算器×3）
                  ├─ 资产   → AssetScreen
                  ├─ 记一笔 → AddTransactionScreen（Tab 上是 CenterTabButton）
                  ├─ 统计   → ReportScreen
                  └─ 设置项 → ProfileStack（我的主页/设置/类别分类/选择货币/自定义周期/开设账本/AI专区）
```

同一个组件（如"记一笔"、"开设账本"）会在两个 Stack 里各注册一次，使返回手势天然回到正确的来源页。

### 状态与持久化

`AppContext` 持有全部业务状态，启动时从 AsyncStorage 并行读取，之后每次变更自动写回（loading 期间不写，避免清空）。读取时做**数据迁移**：老数据补 `ledgerId`、emoji 图标迁移为 Ionicons 线框图标名、计划付款补 `recurrence/autoDeduct` 默认值、分类表自动补上 `transfer_fee`。修改数据结构时注意沿用这个迁移模式，不要让老用户数据读不出来。

### 目录结构

```
jizhang-app/
├── App.tsx                        # 入口：Provider、导航、自定义 TabBar、中央按钮
├── app.json / eas.json            # Expo 配置、EAS 构建
├── android/                       # 原生工程（expo run:android 用）
├── assets/                        # 图标、splash
└── src/
    ├── components/                # 通用组件
    │   ├── AmountCalculatorKeypad.tsx   # 金额计算键盘
    │   ├── AmountEntryPanel.tsx         # 金额录入面板
    │   ├── MoneyInput.tsx / ChainedTextInput.tsx
    │   ├── DateRangePickerSheet.tsx     # 自定义日期范围选择
    │   ├── DonutChart.tsx               # 环形图（react-native-svg）
    │   ├── ReceiptCameraModal.tsx       # 小票拍照弹窗
    │   ├── PressableScale.tsx           # 按压缩放反馈
    │   └── FieldChainProvider.tsx
    ├── config/aiConfig.ts         # OpenRouter API Key + 模型名（见下方安全注意）
    ├── constants/uncategorized.ts
    ├── context/
    │   ├── AppContext.tsx         # 全局状态 + AsyncStorage 持久化 + 迁移 + 自动扣账
    │   ├── ThemeModeContext.tsx   # 深色模式
    │   └── TabBarAutoHideContext.tsx    # Tab 栏滚动收起
    ├── hooks/
    │   ├── useAmountExpression.ts / useMoneyCentsInput.ts   # 金额输入
    │   ├── useNotificationSetup.ts  # 推送注册 + 计划付款提醒
    │   └── useTabClearance.ts       # 页面底部避开浮空 Tab 栏
    ├── screens/                   # 19 个页面（见功能总览）
    ├── theme/
    │   ├── theme.ts               # lightColors / darkColors 设计令牌
    │   └── useTheme.ts
    ├── types/index.ts             # 全部数据类型定义
    └── utils/                     # 纯函数工具（金额表达式、信用卡、货币、分类、通知、AI 调用等）
```

## 数据模型（`src/types/index.ts`）

| 实体 | 关键字段 |
| --- | --- |
| `Transaction` | amount、categoryId、type（expense/income/transfer）、date（YYYY-MM-DD）、note、displayName（列表标题，与备注分开）、ledgerId、assetId、receiptUri；转账专属：fromAssetId、toAssetId、exchangeRate、convertedAmount、fee |
| `Category` | name、icon（Ionicons 名）、color、type（expense/income） |
| `Asset` | type（cash/bank/credit/ewallet/investment/other）、currency、initialBalance、ledgerId；信用卡：creditLimit、statementDay、dueDay、interestRate；isDefault |
| `Ledger` | name、icon、color |
| `Budget` | categoryId + amount |
| `PlannedPayment` | name、amount、dueDate、recurrence（once/monthly/yearly）、autoDeduct、isPaid、assetId、ledgerId |
| `PeriodPreference` | type（day/week/month/year/custom）+ customStart/customEnd |

**余额规则**（`AppContext.getAssetBalance`）：起始余额 + 收入 − 支出；转账从转出方扣 `amount + fee`、向转入方加 `convertedAmount`。信用卡展示余额再经 `creditCard.ts` 换算（可用额度 / 欠费）。

**AsyncStorage 键**（前缀 `@jizhang/`）：transactions、categories、budgets、ledgers、activeLedgerId、currency、periodPreference、assets、plannedPayments、dateFormat、weekStartsOn、decimalPlaces。

## 安全注意（重要）

1. **AI 密钥**：`src/config/aiConfig.ts` 里是直接写死的 OpenRouter API Key，会随安装包分发，可被反编译提取。当前仅适合自用/小范围测试；正式发布前必须改为"自家后端代理调用 AI"的架构。密钥本身不要写进任何文档或提交记录。
2. **数据存储**：AsyncStorage 本地主存储 + 登录后按行同步到 Supabase（Part A 已接，换手机登录即恢复；建表/配置见 `supabase/`）。Hostinger 后端（推播、汇率代理）为 Part B 待做。

## 运行与构建

```bash
npm install          # 安装依赖
npx expo start       # 启动开发服务器，用 Expo Go 扫码预览
npm run android      # expo run:android（使用 android/ 原生工程，需要本地 Android SDK）
npm run ios          # expo run:ios
npm run web          # Web 版
npx tsc --noEmit     # 类型检查（项目无 lint/test 配置）
```

- AI 功能使用前需在 `src/config/aiConfig.ts` 配置有效的 OpenRouter API Key，并核对模型名在 OpenRouter 上仍然有效
- Android 权限已配置：麦克风（语音记账）、相机/相册（拍小票），权限文案在 `app.json` 的 plugins 里

## 相关文档

- `README.md`：面向使用者的功能说明 + 运行指南
- `AGENTS.md`：AI 开发规则（改代码前必读：先扩展现有实现、保持功能不回退、TS 类型、UI 一致性、完成后跑检查）
