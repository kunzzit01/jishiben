# COMPONENTS.md — 记账 App 设计系统组件规格

> 服务对象：后续 22 屏设计稿（.op）与 `_repo/jishiben` 前端改造。
> 取值来源：`design/tokens.json`（图 → token）+ `_repo/jishiben/src/theme/theme.ts`（行号标注）+ `src/theme/motion.ts`。
> 冲突规则：**图 > 代码**。与 `theme.ts` 不一致处，条目末尾用 ⚠ 标出，汇总见 §9。
> 「设计图新增」= 参考图里存在、`_repo/jishiben/src/components/` 下没有对应文件，改造时需新建。

## 0. 读法与索引

- 尺寸单位一律 pt/dp（与 RN 数值 1:1）。参考图缩放 ≈0.66 px/pt（手机宽 257px ↔ 390pt），图中直接量测误差 ±2pt，因此尺寸以代码与 `tokens.json` 为准。
- 每个组件必须能只靠 token 拼出来：颜色只取 `tokens.json` 语义名，尺寸只取 `spacing` / `radius` / `layout`，动效只取 `motion`。
- 组件一律不写死 hex；唯一例外是分类图标（emoji 自带色彩）。

| # | 组件 | 层 | 文件 | 状态 |
|---|---|---|---|---|
| 1 | AppText | 基础 | `ui/AppText.tsx` | 已有 |
| 2 | MoneyText | 基础 | `ui/MoneyText.tsx` | 已有 |
| 3 | Card | 基础 | `ui/Card.tsx` | 已有 |
| 4 | GlassView | 基础 | `ui/GlassView.tsx` | 已有 |
| 5 | HeroGradient | 基础 | `ui/HeroGradient.tsx` | 已有 |
| 6 | PressableScale | 基础 | `components/PressableScale.tsx` | 已有 |
| 7 | StartupSkeleton | 基础 | `ui/StartupSkeleton.tsx` | 已有 |
| 8 | StatusBarGlass | 基础 | `ui/StatusBarGlass.tsx` | 已有 |
| 9 | HeroRollMoney | 基础 | `ui/ColdStartMotion.tsx` | 已有 |
| 10 | Button | 操作 | `ui/Button.tsx` | 已有 |
| 11 | IconButton | 操作 | `ui/IconButton.tsx` | 已有 |
| 12 | Chip | 操作 | `ui/Chip.tsx` | 已有 |
| 13 | SegmentedControl | 操作 | `components/SegmentedControl.tsx` | 已有 |
| 14 | Switch | 操作 | `ui/Switch.tsx` | 已有 |
| 15 | IconCircle | 操作 | `ui/IconCircle.tsx` | 已有 |
| 16 | Badge | 操作 | `ui/Badge.tsx` | 已有 |
| 17 | ListSection | 结构 | `ui/ListSection.tsx` | 已有 |
| 18 | ListRow | 结构 | `ui/ListRow.tsx` | 已有 |
| 19 | TransactionRow | 结构 | `ui/TransactionRow.tsx` | 已有 |
| 20 | ScreenHeader | 结构 | `ui/ScreenHeader.tsx` | 已有 |
| 21 | BottomTabBar | 结构 | — | 设计图新增 |
| 22 | SectionDateHeader | 结构 | — | 设计图新增 |
| 23 | DonutChart | 数据 | `components/DonutChart.tsx` | 已有 |
| 24 | MonthCalendarCard | 数据 | `components/MonthCalendarCard.tsx` | 已有 |
| 25 | StatLegendRow | 数据 | — | 设计图新增 |
| 26 | BudgetProgressRow | 数据 | — | 设计图新增 |
| 27 | SummaryStatTriple | 数据 | — | 设计图新增 |
| 28 | CalendarHeatDay | 数据 | — | 设计图新增 |
| 29 | AccountCurrencyRow | 领域 | — | 设计图新增 |
| 30 | AccountDetailHero | 领域 | — | 设计图新增 |
| 31 | TypeTabs | 领域 | — | 设计图新增 |
| 32 | QuickActionTile | 领域 | — | 设计图新增 |
| 33 | CategoryTile | 领域 | — | 设计图新增 |
| 34 | CategoryManageRow | 领域 | — | 设计图新增 |
| 35 | PremiumBanner | 领域 | — | 设计图新增 |
| 36 | SettingsRow | 领域 | — | 设计图新增 |
| 37 | ReceiptOverlay | 领域 | — | 设计图新增 |
| 38 | ReceiptCameraModal | 领域 | `components/ReceiptCameraModal.tsx` | 已有 |
| 39 | AmountCalculatorKeypad | 领域 | `components/AmountCalculatorKeypad.tsx` | 已有 |
| 40 | MoneyInput | 领域 | `components/MoneyInput.tsx` | 已有 |
| 41 | InlineCurrencyPicker | 领域 | `components/InlineCurrencyPicker.tsx` | 已有 |
| 42 | DateRangePickerSheet | 领域 | `components/DateRangePickerSheet.tsx` | 已有 |
| 43 | PinSheet | 领域 | `components/PinSheet.tsx` | 已有 |
| 44 | BottomSheet | 领域 | `ui/BottomSheet.tsx` | 已有 |
| 45 | EmptyState | 领域 | `ui/EmptyState.tsx` | 已有 |
| 46 | AppDialog | 领域 | `components/AppDialog.tsx` | 已有 |

> 口径说明：题述「34 个自建 UI 组件」实测为 `src/components/ui/` 下 **20 个组件 + index.ts + color.ts**；另有 `src/components/` 根目录 19 个自建组件（SegmentedControl / DonutChart / MonthCalendarCard / AmountCalculatorKeypad 等）。本文按「设计系统真正会复用」的口径收录 46 个。
> 路径写法：表中 `ui/xxx.tsx` = `_repo/jishiben/src/components/ui/xxx.tsx`；`components/xxx.tsx` = `_repo/jishiben/src/components/xxx.tsx`；文件列写「—」的条目 = 仓库不存在，即 **设计图新增**，改造时需新建文件。

## 1. 基础层

### 1. AppText · `ui/AppText.tsx`
- **用途**：全 App 唯一文本入口，强制走 typography 11 档 + 中英字体分流（Inter / NotoSansSC）。
- **props**：`variant?`(11 档，默认 body) · `color?` · `weight?` · `align?` · `font?` · `style?` · `children`
- **variants**：display / amountEntry / title1 / title2 / title3 / headline / body / subhead / footnote / caption / caption2（token → `typography.variants`）
- **states**：静态。中文自动 `letterSpacing: 0`；含中文时切 `fontFamilyCjk`。
- **关键尺寸**：字号/行高见 `tokens.json → typography`；中文必须用 `lineHeightCjk`（比值 ≥1.30）。
- **验收点**：页面出现裸 `<Text>` 即缺陷；中文行高比 <1.30 即缺陷。

### 2. MoneyText · `ui/MoneyText.tsx`
- **用途**：金额专用文本：整数/小数分层字号、`tabular-nums`、逐位滚动。
- **props**：`value` · `variant?` · `weight?` · `color?` · `roll?` · `shrinkLadder?` · `compactFallback?` · `hero?` · `heroSize?` · `heroDecimalSize?` · `heroDecimalWeight?` · `heroDecimalColor?` · `style?` · `accessibilityLabel?`
- **variants**：普通金额 / hero 金额（净资产卡）/ 紧凑回退（宽度不足降档）
- **states**：静态 · 滚动中（`motion.timing.numberRoll` 600ms）· 溢出降档 · 隐藏金额（••••）
- **关键尺寸**：hero 用 `display` 40/46；行内大数字用 `title2` 22/28。始终 `fontVariant: ['tabular-nums']`。
- **⚠ 与 theme.ts 不一致**：金额色彩语义见 §9 第 1 条（支出改红）。

### 3. Card · `ui/Card.tsx`
- **用途**：标准内容卡（列表分组、汇总块、设置分组）。
- **props**：`children` · `padded?` · `onPress?` · `onLongPress?` · `accessibilityLabel?` · `style?` · `testID?`
- **variants**：静态卡 / 可点卡（内挂 PressableScale 反馈）
- **states**：默认 · 按压（scale 0.97）· 选中（`bg.surfaceSunken` 底）· 禁用
- **关键尺寸**：圆角 `radius.lg` 20 · 内边距 `layout.card` 16 · 日间 `shadow.level1`；夜间 `shadow.level1 = none`，靠 `bg.surface` 比 `bg.page` 亮一档分层（theme.ts:851）。
- **token**：`bg.surface` / `border.hairline`。

### 4. GlassView · `ui/GlassView.tsx`
- **用途**：唯一允许的玻璃材质（浮空 Tab 栏、Hero 内胶囊）。
- **props**：`radius?` · `fill?` · `intensity?` · `shadow?` · `strongBlur?` · `pointerEvents?` · `style?` · `children?`
- **variants**：日 / 夜（`lightGlass` theme.ts:1005 / `darkGlass` theme.ts:1015）
- **states**：默认 · 强模糊 · 无阴影
- **关键尺寸**：Tab 栏高 `layout.rowMinHeight` 56 + 底部安全区；日间栏身 `rgba(255,255,255,0.94)`（theme.ts:638），夜间 `rgba(14,10,30,0.92)`（theme.ts:682）。
- **约束**：玻璃只用于「浮在内容之上」的层；卡片禁止玻璃。

### 5. HeroGradient · `ui/HeroGradient.tsx`
- **用途**：净资产 / 总资产 Hero 卡背景渐变 + 光斑 + 网格。
- **props**：`variant?` · `height?` · `fill?` · `grid?` · `style?`
- **variants**：日 / 夜（`gradients`，theme.ts:915-960）
- **states**：静态；`fill=false` 只画上半屏渐变
- **关键尺寸**：高度内容自适应；圆角 `radius.lg` 20；角度见 theme.ts:923（夜 165°）/ theme.ts:937（日 165°）。
- **⚠**：端点改取 `brand.heroFrom / brand.heroTo`（§9 第 4 条）。

### 6. PressableScale · `components/PressableScale.tsx`
- **用途**：全 App 统一按压反馈（缩放 + 过渡）。
- **props**：`onPress?` · `onLongPress?` · `activeScale?` · `disabled?` · `hitSlop?` · `delayLongPress?` · `accessibilityRole?` · `accessibilityLabel?` · `accessibilityState?` · `testID?` · `style?` · `children?`
- **variants**：默认 `motion.pressScale` 0.97
- **states**：默认 · 按下 · 禁用（无反馈）
- **关键尺寸**：`PRESS_TRANSITION` 跟随 `motion.spring.press` 180ms
- **验收点**：页面里禁止另写 Animated 缩放。

### 7. StartupSkeleton · `ui/StartupSkeleton.tsx`
- **用途**：首屏冷启动骨架（Hero 占位 + 列表占位）。
- **props**：无
- **variants**：唯一形态（贴合首页布局）
- **states**：显示 / 卸载
- **关键尺寸**：沿用首页 Hero 高度与 `layout.rowMinHeight` 行高，保证骨架 → 真内容不跳版。
- **token**：`bg.surface` + `border.hairline`。

### 8. StatusBarGlass · `ui/StatusBarGlass.tsx`
- **用途**：状态栏区域渐隐遮罩，保证浅色 Hero 上状态栏可读。
- **props**：`style?`
- **variants**：日 / 夜（随主题）
- **states**：静态
- **关键尺寸**：高度 = 状态栏安全区；渐变取自 `gradients`。
- **验收点**：只存在于 Hero 类页面顶部。

### 9. HeroRollMoney · `ui/ColdStartMotion.tsx`
- **用途**：冷启动时净资产数字一次性滚动入场。
- **props**：`code`（币种）· `value` + 继承 MoneyText 的 props
- **variants**：唯一
- **states**：未播 / 播放中（`COLD_ROLL_MS` 1600ms，`COLD_EASE` out-cubic）/ 已播（`claimColdRoll` 去重）
- **关键尺寸**：跟随 MoneyText hero 档。

## 2. 操作层

### 10. Button · `ui/Button.tsx`
- **用途**：主操作按钮（完成 / 保存 / 确认导入 / 重拍）。
- **props**：`title` · `onPress?` · `onLongPress?` · `variant?` · `icon?` · `disabled?` · `loading?` · `fullWidth?`(默认 true) · `size?`(`'md'|'sm'`) · `accessibilityLabel?` · `style?` · `testID?`
- **variants**：`primary` / `secondary` / `destructive` / `ghost` / `gradient`（Button.tsx:34）
- **states**：默认 · 按压 · loading（保留本档配色，只把文字换成同色转圈，宽度不跳）· disabled（降透明度，非重绘配色）
- **关键尺寸**：`HEIGHT_MD` 50 / `HEIGHT_SM` 44（Button.tsx:31-32）· 圆角 `radius.md` 14 · 横向内边距 `spacing.xl` 20 · 文字 `headline` 17/22 `600`。
- **对比图**：参考图「完成」「确认导入」为整宽实心，高度约 52-54pt，与该档一致；**但填充是纯实色 `brand.primary`（浅）/ 渐变 `brand.gradientFrom→To`（深）**，⚠ 见 §9 第 3 条。

### 11. IconButton · `ui/IconButton.tsx`
- **用途**：无文字图标按钮（返回、更多、搜索、通知）。
- **props**：`icon`(必填) · `accessibilityLabel`(必填) · `onPress?` · `onLongPress?` · `size?` · `color?` · `variant?` · `disabled?` · `hitSlop?` · `accessibilityState?` · `style?` · `testID?`
- **variants**：透明 / 幽灵（Hero 上用）
- **states**：默认 · 按压 · 禁用
- **关键尺寸**：`minHeight: TOUCH_SIZE`（44 触控下限）· 图标 22-24pt。

### 12. Chip · `ui/Chip.tsx`
- **用途**：可选/可点标签：币种、分类筛选、账户筛选、区间预设。
- **props**：`label` · `selected?` · `onPress?` · `icon?` · `trailingIcon?` · `disabled?` · `accessibilityLabel?` · `style?` · `testID?`
- **variants**：默认（`bg.surface` + `border.hairline`）/ 选中（`brand.primary` 底 + `brand.onBrand` 字）
- **states**：未选 · 选中 · 按压 · 禁用
- **关键尺寸**：`CHIP_MIN_HEIGHT` 32（12pt 文字 + 上下 `spacing.xs`）· 圆角 `radius.full` · 横向 `spacing.md` 12 · 触控外框 44。

### 13. SegmentedControl · `components/SegmentedControl.tsx`
- **用途**：二/多段切换：支出·收入 / 月·周·年 / 日间·夜间·跟随系统。
- **props**：`options` · `value` · `onSelect` · `stretch?` · `appearance?`
- **variants**：`appearance` 两套（浅槽 / 深槽）；8 屏图里出现 3 处
- **states**：未选（透明字 `text.secondary`）· 选中（胶囊 `brand.primary` 底 + 白字）· 按压 · 禁用
- **关键尺寸**：`TRACK_HEIGHT` 轨道高 · `TRACK_PADDING` 内缩 · 触摸区外扩 `(TOUCH_HEIGHT-TRACK_HEIGHT)/2`（SegmentedControl.tsx:202-231）· 圆角 `radius.full`。
- **对比图**：参考图「支出/收入」选中胶囊在浅色是实心 `#5B40FD`，深色是 `#7659FB→#6D4BF7` 渐变，⚠ 见 §9 第 3 条。

### 14. Switch · `ui/Switch.tsx`
- **用途**：设置项开关（生物识别解锁）。
- **props**：`value` · `onValueChange?` · `disabled?` · `accessibilityLabel?` · `style?` · `testID?`
- **variants**：开 / 关
- **states**：开（`brand.primary` 轨道）· 关（`switchTrackOff`：日 #D6D3E0 theme.ts:643 / 夜 rgba(255,255,255,0.22) theme.ts:691）· 按压 · 禁用
- **关键尺寸**：`minHeight: TOUCH_SIZE` 44；轨道 51×31 标准 iOS 比例。

### 15. IconCircle · `ui/IconCircle.tsx`
- **用途**：分类图标圆/方形底（交易行、分类九宫格、分类管理）。
- **props**：`color?` · `size?` · `iconSize?` · `icon?` · `selected?` · `shape?` · `style?` · `children?`
- **variants**：圆形 / 方形（`shape`）；尺寸默认 38dp 方块（对应 `homeIconTile` 注释 theme.ts:611-612）
- **states**：默认 · 选中（外环 `categoryRing` theme.ts:1038）· 按压
- **关键尺寸**：38×38 · 圆角 `radius.md` 14（方形）/ `radius.full`（圆形）· 图标 20。
- **对比图**：图中分类图标是彩色 emoji 直接铺在淡色方块上，无描边——比 theme.ts 的 `categoryRing` 外环更简；改造时建议保留 `selected` 外环、默认态去掉。

### 16. Badge · `ui/Badge.tsx`
- **用途**：小徽章/计数（分类条数「(12)」、状态提示）。
- **props**：`label` · `tone?`(默认 neutral) · `dot?` · `style?` · `testID?`
- **variants**：`neutral` / success / warning / danger（tone 映射 `status.*`）
- **states**：静态
- **关键尺寸**：`BADGE_MIN_HEIGHT` · 横向 `spacing.sm` 8 · 文字 `caption2` 11/13。

## 3. 结构层

### 17. ListSection · `ui/ListSection.tsx`
- **用途**：带标题/脚注的分组容器（设置分组、账户分组）。
- **props**：`title?` · `footer?` · `children` · `cardStyle?` · `style?` · `testID?`
- **variants**：有标题 / 无标题；脚注在卡外
- **states**：静态 · 空组（不渲染标题）
- **关键尺寸**：组间距 `layout.section` 24 · 标题 `footnote` 13/18 + `text.secondary` · 卡内不重复内边距。

### 18. ListRow · `ui/ListRow.tsx`
- **用途**：通用设置/信息行（图标 + 标题 + 副标题 + 值 + chevron）。
- **props**：`title` · `subtitle?` · `value?` · `valueCaption?` · `icon?` · `iconColor?` · `leading?` · `trailing?` · `chevron?` · `onPress?` · `onLongPress?` · `disabled?` · `separator?` · `accessibilityLabel?` · `style?` · `testID?`
- **variants**：单行 / 双行（有 subtitle）/ 带右侧控件（Switch、值+chevron）
- **states**：默认 · 按压 · 禁用 · 选中（`bg.surfaceSunken`）· 分隔线有无
- **关键尺寸**：`minHeight: layout.rowMinHeight` 56 · 横向 `layout.card` 16 · 纵向 `spacing.md` 12（ListRow.tsx:181-183）· 标题 `headline`/副标题 `subhead`。
- **对比图**：参考图设置行 ≈56-60pt，右侧值 13pt `text.tertiary`，chevron 16pt；一致。

### 19. TransactionRow · `ui/TransactionRow.tsx`
- **用途**：交易流水行（分类图标 + 分类名·备注 + 时间/账户 + 金额）。
- **props**：`categoryName` · `amount` · `categoryIcon?` · `categoryColor?` · `accountName?` · `note?` · `kind?` · `hideAmount?` · `currency?` · `showCurrency?` · `currencyPosition?` · `onPress?` · `onLongPress?` · `style?` · `accessibilityLabel?` · `testID?`
- **variants**：支出（金额红）/ 收入（金额绿）/ 转账（金额 `text.secondary`）——**语义见 §9 第 1 条**
- **states**：默认 · 按压 · 隐藏金额 · 选中 · 分隔线
- **关键尺寸**：`minHeight: layout.rowMinHeight` 56 · 横向 `layout.card` 16 · 纵向 `spacing.md` 12 · 图标 38 · 金额 `headline` 17/22 `600` `tabular-nums`。
- **对比图**：图中行高 ≈60pt（更松），图标 40pt 淡色圆角方块，金额右侧对齐，与实现基本一致。

### 20. ScreenHeader · `ui/ScreenHeader.tsx`
- **用途**：二级页/根页面顶部标题栏（返回 + 标题 + 副标题 + 右侧动作）。
- **props**：`title` · `subtitle?` · `variant?` · `onBack?` · `backAccessibilityLabel?` · `right?` · `padded?` · `titleNumberOfLines?` · `style?` · `testID?`
- **variants**：`variant` = 根页面大标题（`title1` 28/34 `700`）/ 二级页（`title3` 20/25 + 左返回箭头）/ Hero 悬浮（透明，白字）
- **states**：默认 · 滚动收缩（大标题 → 小标题）· 详情页
- **关键尺寸**：横向 `layout.page` 16 · 高度 56（二级页）/ 88（大标题含副标题）。

### 21. BottomTabBar 【设计图新增】
- **用途**：首页 / 我的资产 / 统计 / 我的 的四项底部导航 + 中央 ⊕ FAB。
- **props**（建议）：`items` · `activeKey` · `onSelect` · `centerAction` · `centerLabel?` · `hidden?`
- **variants**：浅色（白玻璃 `rgba(255,255,255,0.94)`）/ 深色（`rgba(14,10,30,0.92)`）两套
- **states**：选中（实心图标 + `brand.primary` 标签）· 未选（线框图标 + `text.tertiary`）· 中央 FAB 按压（scale 0.97）
- **关键尺寸**：栏高 56 + 底部安全区 · 圆角 `radius.xl` 28（浮空胶囊样式）· FAB 56×56 `radius.full` · 图标 22。
- **对应实现**：当前 Tab 栏在 `src/navigation/` 内联实现（`GlassView` + `tabBarShadow` theme.ts:1050 / `centerButtonShadow` theme.ts:1055），无独立组件 → 需抽出。
- **⚠**：FAB 填充图测 `#6650FD`，取 `brand.primary`；深色渐变见 §9 第 3 条。

### 22. SectionDateHeader 【设计图新增】
- **用途**：流水按日分组条：「10月19日 · 今天　　支出 6.20」。
- **props**（建议）：`label` · `sublabel?` · `total?` · `kind?` · `trailing?`
- **variants**：今天 / 昨天 / 普通日期；支出汇总 / 收入汇总
- **states**：静态（粘性吸顶可选）
- **关键尺寸**：高 28-30 · 横向 `layout.page` 16 · 圆角 `radius.sm` 10 · 底 `bg.surfaceSunken`（图测 #EBE9FD）· 文字 `footnote` 13/18，右侧合计 `caption` 12/16。
- **对应实现**：当前为 `HomeScreen.tsx` 内联渲染，无组件 → 需抽出。

## 4. 数据展示层

### 23. DonutChart · `components/DonutChart.tsx`
- **用途**：统计分析环形饼图（分类占比）。
- **props**：`data`（`{value,color}[]`）· `size?` · `strokeWidth?` · `rotation?` · `gap?` · `selectedIndex?` · `dimOpacity?` · `animateIn?` · `trackColor?`
- **variants**：完整环 / 高亮单扇区（其余压暗）
- **states**：入场（`motion.timing.numberRoll` 逐段绘制）· 默认 · 选中扇区（外扩 + 其余 dim）· 空数据（轨道环）
- **关键尺寸**：尺寸约 180-200 · 环宽 26-28 · 扇区间隙 2-3 · 中心区放「总支出 + 金额」（`title2` + `display` 缩档）。
- **token**：扇区色取 `chart.orange / chart.violet` + 分类色（见 §11 未决）。

### 24. MonthCalendarCard · `components/MonthCalendarCard.tsx`
- **用途**：月历 + 逐日热力 + 月度汇总 + 选中日明细（设计图第 6 屏）。
- **props**：`year` · `month` · `days` · `items` · `monthExpense` · `monthIncome` · `onPrevMonth` · `onNextMonth` · `onPressItem?` · `segKey?` · `onSegKeyChange?` · `selectionKey?`
- **variants**：7 列网格；顶部指标分段（支出/收入/转账/总额）
- **states**：默认 · 选中日（实心圆）· 今天（描边圆）· 数据热度三档 · 切月
- **关键尺寸**：日期圆 36×36（MonthCalendarCard.tsx:135）· 触控 44×44（:134）· 行高 `minHeight` 46（:522/:530）· 周标签 `paddingVertical: spacing.xs`。
- **token**：`bg.surface` / `chart.orange` / `border.hairline`。

### 25. StatLegendRow 【设计图新增】
- **用途**：统计页分类明细行：色块 + 占比 + 分类名 + 金额 + chevron。
- **props**（建议）：`color` · `percent` · `name` · `amount` · `kind?` · `onPress?`
- **variants**：支出 / 收入；带占比徽标 / 不带
- **states**：默认 · 按压 · 选中（与环图扇区联动高亮）
- **关键尺寸**：行高 56 · 左侧色块 28-32 圆角 `radius.sm` · 占比 `caption` 12/16 在上、分类名 `headline` 在下 · 金额 `headline` `tabular-nums`。
- **对应实现**：`ReportScreen.tsx` 内联，无组件。

### 26. BudgetProgressRow 【设计图新增】
- **用途**：分类预算行：图标 + 分类名 + 「已用 / 上限」+ 百分比 + 进度条（设计图第 9 屏三行 91% / 69% / 60%）。
- **props**（建议）：`name` · `icon?` · `iconColor?` · `spent` · `limit` · `percent` · `state?`(`'safe'|'warn'|'over'`) · `onPress?`
- **variants**：safe(<70%) / warn(≥80%) / over(>100%)
- **states**：默认 · 按压 · 超支（条满 + 危险色 + 百分比变红）
- **关键尺寸**：行高 64-72 · 进度条高 8 `radius.full` · 轨道 `bg.surfaceSunken` / theme `budgetTrack` · 图标 34 方块 `radius.md` · 名称 `subhead` 15/20、金额 `headline` 17/22、百分比 `caption` 12/16 `600`。
- **条形色**：safe = `status.success`、warn = `status.warning`、over = `status.danger`；**参考图三种都是单色→同族更深色的横向渐变**（如 91% 红→橙），实现可用 LinearGradient 从 `status.danger` 到其 15% 变亮档。
- **对应实现**：分类预算 UI 完全缺失（`docs/FEATURES.md` §9 第 9 屏）→ 必须新建。

### 27. SummaryStatTriple 【设计图新增】
- **用途**：概览模式三栏：本月支出 / 本月收入 / 结余（设计图第 11 屏）。
- **props**（建议）：`items`（`{label,value,kind}[]`，固定 3 项）· `currency?` · `onPressItem?`
- **variants**：三栏等分 / 紧凑双行
- **states**：默认 · 某栏可点（按压）· 数据为 0
- **关键尺寸**：高 64-72 · 三栏等分（`flex:1`）+ 竖向发丝线分隔 · 标签 `caption` 12/16 `text.tertiary` · 金额 `title2` 22/28 缩档 `headline` `tabular-nums`。
- **对应实现**：仓库不存在独立「概览模式」（`docs/FEATURES.md` §9 第 11 屏）→ 需新建。

### 28. CalendarHeatDay 【设计图新增】
- **用途**：日历单格：日期数字 + 数据热度底色。
- **props**（建议）：`day` · `level`(0-3) · `selected?` · `isToday?` · `hasData?` · `onPress?`
- **variants**：普通 / 今天 / 选中 / 无数据灰字
- **states**：默认 · 选中（`brand.primary` 实心白字）· 今天（`brand.primary` 描边）· 热度 1-3 档（`brand.primary` 8%/16%/28% 叠在 `bg.surface` 上）
- **关键尺寸**：圆 36×36 · 触控 44×44 · 字 `subhead` 15/20 `tabular-nums`。
- **对应实现**：热度逻辑在 `MonthCalendarCard.tsx` 内联，无独立组件。

## 5. 领域组件

### 29. AccountCurrencyRow 【设计图新增】
- **用途**：我的资产——币种账户行：国旗 + 币种/名称 + 余额 + chevron（设计图第 2 屏）。
- **props**（建议）：`flag` · `code`(`'MYR'`) · `name?`(`'马来西亚'`) · `balance` · `kind?`(`'cash'|'bank'|'wallet'|'credit'`) · `onPress?` · `selected?`
- **variants**：普通 / 信用卡（额外显示额度与账单日）/ 组头（净资产 + 合计）
- **states**：默认 · 按压 · 选中 · 归档（灰显）
- **关键尺寸**：行高 60-64 · 国旗 28×20 圆角 4 · 币种 `headline` 17/22、名称 `caption` 12/16 `text.tertiary` · 余额 `headline` `tabular-nums` 右对齐 · chevron 16 `text.tertiary`。
- **对应实现**：`AssetScreen.tsx:470-925` 内联 → 需抽出。
- **⚠**：设计图顶部有「类型筛选 Tab（全部账户/现金/银行/电子钱包）」，仓库没有类型筛选（`docs/FEATURES.md` §9 第 2 屏）→ 需新建 Chip 组合。

### 30. AccountDetailHero 【设计图新增】
- **用途**：账户详情头：币种 + 余额 + 转账/编辑/更多（设计图第 8 屏）。
- **props**（建议）：`code` · `name` · `balance` · `onTransfer?` · `onEdit?` · `onMore?`
- **variants**：浅色（`brand.heroFrom→To` 渐变）/ 深色（`brand.heroTo` 深靛）
- **states**：默认 · 按压动作 · 隐藏余额
- **关键尺寸**：高 150-170 · 圆角 `radius.lg` 20 · 余额 `display` 40/46 · 三个动作按钮 `Button size=sm`（44）横排 `spacing.sm` 8 间距。
- **对应实现**：`AssetScreen.tsx` 内联。

### 31. TypeTabs 【设计图新增】
- **用途**：添加交易的四种类型切换：支出 / 收入 / 转账 / 兑换（设计图第 3 屏顶部）。
- **props**（建议）：`types` · `value` · `onChange` · `appearance?`
- **variants**：4 段胶囊（选中实心 `brand.primary`）
- **states**：未选 / 选中 / 按压
- **关键尺寸**：轨道高 40 · 圆角 `radius.full` · 段文字 `headline` 17/22 · 参照 `SegmentedControl` 但段数固定 4 且允许横向滚动（窄屏）。
- **对应实现**：`AddTransactionScreen.tsx:99-101` 有类型切换，复用 `SegmentedControl` 即可，无需新组件（列为「可合并」）。

### 32. QuickActionTile 【设计图新增】
- **用途**：首页四宫格：支出 / 收入 / 转账 / 扫描（设计图第 1、11 屏）。
- **props**（建议）：`icon` · `label` · `tint?` · `onPress?` · `disabled?`
- **variants**：四色 tint（紫 `bg.brandSoft` / 薄荷 `bg.tileMint` / 天蓝 / 淡紫）
- **states**：默认 · 按压（scale 0.97）· 禁用
- **关键尺寸**：方块 56×56 · 圆角 `radius.md` 14 · 图标 24（彩色）· 标签 `caption` 12/16 在方块下 `spacing.sm` 8 处。
- **对应实现**：仓库首页已无快捷操作（`docs/FEATURES.md` §9 第 1 屏）→ 如需照图重构必须新建。

### 33. CategoryTile 【设计图新增】
- **用途**：分类九宫格单块：emoji/图标 + 名称（设计图第 3 屏，16 格 4 列）。
- **props**（建议）：`icon`(emoji) · `name` · `selected?` · `onPress?` · `onLongPress?`
- **variants**：默认 / 选中（`brand.soft` 底 + `brand.primary` 文字）
- **states**：默认 · 选中 · 按压 · 拖拽中（排序）
- **关键尺寸**：块 56×56（含标签 72 高）· 图标 34 · 名称 `caption` 12/16 · 网格 4 列、`spacing.sm` 8 间距、页边距 `layout.page` 16 · 圆角 `radius.md` 14。
- **对应实现**：`AddTransactionScreen.tsx` 九宫格内联。

### 34. CategoryManageRow 【设计图新增】
- **用途**：分类管理行：emoji + 名称（条数）+ 编辑 + 删除（设计图第 7 屏）。
- **props**（建议）：`icon` · `name` · `count?` · `onEdit?` · `onDelete?` · `dragging?`
- **variants**：带条数 / 不带；支出组 / 收入组
- **states**：默认 · 编辑态（右侧两个按钮）· 拖拽中（提升阴影）· 禁用（默认分类不可删）
- **关键尺寸**：行高 56 · 图标方块 34-38 `radius.md` · 名称 `headline` 17/22 + 条数 `caption` `text.tertiary` · 右侧图标按钮 28。
- **对应实现**：`CategoryManagementScreen.tsx` 内联。

### 35. PremiumBanner 【设计图新增】
- **用途**：个人设置顶部会员卡（订阅会员 / Premium 会员 / 到期日）（设计图第 5 屏）。
- **props**（建议）：`title` · `subtitle?` · `expiresAt?` · `onPress?` · `badgeIcon?`
- **variants**：浅色（`#7168EE` 紫渐变，图测）/ 深色（`#4F27E2` 紫渐变）
- **states**：默认 · 按压 · 未订阅（灰行）
- **关键尺寸**：高 76-84 · 圆角 `radius.md` 14 · 内边距 `spacing.lg` 16 · 标题 `headline` 17/22 白字 · 副标题 `caption` 12/16 白 80% · 右侧 chevron 白。
- **⚠ 与 theme.ts 不一致**：品牌紫取值 `#7168EE`（图测）/ theme 无对应渐变 token；建议新增 `brand.vipFrom/vipTo`。

### 36. SettingsRow 【设计图新增】
- **用途**：设置行（图标 + 标题 + 值 + chevron/开关），设计图第 5 屏 5 行。
- **props**（建议）：`icon` · `title` · `value?` · `type?`(`'nav'|'switch'|'action'`) · `switchValue?` · `onToggle?` · `onPress?` · `disabled?`
- **variants**：导航型 / 开关型 / 危险动作型（退出、删除）
- **states**：默认 · 按压 · 禁用（「即将推出」灰行）· 开关开/关
- **关键尺寸**：行高 56 · 图标 22 `text.secondary`（或 `brand.primary`）· 标题 `body` 17/22 · 值 `subhead` 15/20 `text.tertiary` · Switch 51×31。
- **对应实现**：`ProfileScreen.tsx` 用 `ListRow` 拼装，可直接复用 `ListRow` —— 本条仅作设计规格，不新建组件。

### 37. ReceiptOverlay 【设计图新增】
- **用途**：收据扫描取景：四角标记 + 结果卡 + 重拍/确认导入（设计图第 10 屏）。
- **props**（建议）：`imageUri` · `amount?` · `merchant?` · `items?` · `onRetake` · `onConfirm` · `recognizing?`
- **variants**：取景中 / 识别中（shimmer）/ 识别完成（金额行）/ 识别失败
- **states**：默认 · 识别中 · 成功 · 失败重试
- **关键尺寸**：四角标记 24×24 描边 2 `radius.xs` 6 · 结果卡 `radius.md` 14 白底 `spacing.md` 12「金额行」 · 底部两按钮各行 50（`Button size=md`）。
- **对应实现**：`ReceiptCameraModal.tsx` 只有相机；「金额行逐项确认」UI 完全没有（`docs/FEATURES.md` §9 第 10 屏）→ 需新建。

### 38. ReceiptCameraModal · `components/ReceiptCameraModal.tsx`
- **用途**：相机/相册取图（扫描小票入口）。
- **props**：`visible` · `onClose` · `onCapture` · `onPickFromLibrary`
- **variants**：唯一（全屏 modal）
- **states**：请求权限中 · 无权限（引导按钮）· 就绪 · 拍照中
- **关键尺寸**：顶部栏 56 · 底部操作栏 120 · 快门按钮 72 外/56 内 · 侧按钮圆 56。

### 39. AmountCalculatorKeypad · `components/AmountCalculatorKeypad.tsx`
- **用途**：记一笔自绘键盘 + 备注 + 日期 + 小票入口。
- **props**：`onPressKey` · `onPressToday` · `onConfirm` · `onClear` · `onConfirmLongPress?` · `note?` · `onNoteChange?` · `notePlaceholder?` · `receiptUri?` · `onAttachReceipt?` · `onRemoveReceipt?` · `onPreviewReceipt?` · `selectedDate?` · `noteInputRef?` · `onNoteFocus?` · `onNoteBlur?`
- **variants**：`panel` / `panelShort`（无备注行）
- **states**：默认 · 按键按下（`keyTilePressed`）· 确认键按下 · 备注聚焦 · 小票缩略图
- **关键尺寸**：`keypadPanelHeight(keyHeight, isShort, withNote)` 计算面板高 · 键 `keyTile` 圆角 `radius.md` 14 · 网格 3×4 + 右侧纵向列 · 面板底 `keypadPanel`（日 #F3F1FA theme.ts:631）。
- **对比图**：参考图第 3 屏是**系统输入态 + 分类九宫格**，不是自绘键盘；两套都要能覆盖。

### 40. MoneyInput · `components/MoneyInput.tsx`
- **用途**：金额输入框（受控 + 千分位格式化）。
- **props**：`field` · `initialValue?` · `onAmountChange?`（forwardRef 到 TextInput）
- **variants**：唯一
- **states**：默认 · 聚焦 · 错误 · 禁用
- **关键尺寸**：见 `form-basics` 约定：宽 100%（`fill_container`）、高 48 `radius.md` 14、内边距 `spacing.md` 12、文字 `body` 17/22 `tabular-nums`。

### 41. InlineCurrencyPicker · `components/InlineCurrencyPicker.tsx`
- **用途**：币种胶囊横滑选择。
- **props**：`selected` · `onSelect`
- **variants**：唯一（横滑 Chips）
- **states**：未选 / 选中 / 禁用
- **关键尺寸**：Chip 32 高 `radius.full` · 间距 `spacing.sm` 8。

### 42. DateRangePickerSheet · `components/DateRangePickerSheet.tsx`
- **用途**：自定义统计区间选择抽屉。
- **props**：`visible` · `start` · `end` · `mode?` · `onClose` · `onApply`
- **variants**：日/月/年模式
- **states**：未选 · 选择中 · 已选区间 · 关闭动画（`motion.spring.sheet`）
- **关键尺寸**：抽屉 `radius.xl` 28 · 把手 36×4 `spacing.sm` · 日历格 44 触控。

### 43. PinSheet · `components/PinSheet.tsx`
- **用途**：二级密码 / 生物识别验证抽屉。
- **props**：`visible` · `mode` · `onClose` · `onSuccess` · `onVerified?`
- **variants**：设置 / 验证 / 修改
- **states**：输入中 · 错误（抖动）· 成功
- **关键尺寸**：圆点 12 `spacing.sm` 8 间距 · 键盘键 64 · 抽屉 `radius.xl` 28。

### 44. BottomSheet · `ui/BottomSheet.tsx`
- **用途**：通用底部抽屉容器（日历、预算设置、筛选）。
- **props**：`visible` · `onClose` · `children` · `title?` · `handle?` · `closeButton?` · `dismissible?` · `maxHeightRatio?` · `fill?` · `accessibilityLabel?` · `style?` · `testID?`
- **variants**：带标题 / 不带；可拖拽关闭 / 仅按钮
- **states**：关闭 · 打开 · 拖拽中 · 锁定（不可下滑关闭）
- **关键尺寸**：顶部圆角 `radius.xl` 28 · 把手 36×4 · 头部槽 `HEADER_SLOT`（BottomSheet.tsx:311）· 遮罩 `scrim` · 动效 `motion.spring.sheet`。

### 45. EmptyState · `ui/EmptyState.tsx`
- **用途**：空列表 / 空账号 / 无数据。
- **props**：`title` · `icon?` · `description?` · `actionLabel?` · `onAction?` · `style?` · `testID?`
- **variants**：带动作 / 不带动作
- **states**：静态
- **关键尺寸**：图标 48 · 标题 `headline` 17/22 · 描述 `subhead` 15/20 `text.tertiary` · 动作 `Button variant=secondary size=sm` 44。

### 46. AppDialog · `components/AppDialog.tsx`
- **用途**：全局对话框（确认删除、退出）。
- **props**：`title` · `message?` · `buttons` · `request` · `onClose`（通过 `useDialog()` 调用）
- **variants**：单按钮 / 双按钮（危险动作红色主按钮）
- **states**：打开 · 关闭 · 点击遮罩关闭（`onScrimPress`）
- **关键尺寸**：卡宽 300-320 · 圆角 `radius.lg` 20 · 内边距 `spacing.xl` 20 · 按钮高 44 · 遮罩 `scrim`。

## 9. 与 theme.ts 不一致的组件级要点（重构必须改的点）

| # | 组件 | 现状（theme.ts） | 参考图要求 | 动作 |
|---|---|---|---|---|
| 1 | TransactionRow / MoneyText / ReportScreen / BudgetProgressRow | 支出金额 = 紫 `#5B3DF0` / 夜 `#B8A6FF`（theme.ts:651 / 700） | 支出金额 = 红 `#EF1116` / 夜 `#FC5F5C` | **blocker**：改 `amount.expense` 语义并回归所有金额渲染 |
| 2 | 全局 danger | `#E11D48` 玫红 / `#FB7185`（theme.ts:654 / 704） | 纯红 `#EF1116` / 珊瑚 `#FC5F5C` | 替换 danger + `budgetFillOver` + `expenseOver` |
| 3 | Button / SegmentedControl / BottomTabBar 选中态 | 单一实色 `accent #6C4DF6`（theme.ts:647 / 696） | 浅 = 实色 `#5E43FC`；深 = 渐变 `#8063F8→#5E3DFA` | 新增 `brand.gradientFrom/To`，深色按钮改 LinearGradient |
| 4 | HeroGradient | 日夜共用 `#A383F1→#8181FB`（theme.ts:228-229 / 399-400） | 浅 `#9083FC→#634FFC`；深 `#7C63F6→#2710A6` | 拆两套渐变 token |
| 5 | Card / ListRow 底色 | 日 `#FFFFFF` + 页面底 `#F5F2FB`（theme.ts:628 / 627） | 页面底 `#F5F4FC`、卡面 `#FBFAFE`（更接近、更紫） | 微调，并检查对比度 |
| 6 | 页面底（深色） | `#06050C`（theme.ts:671） | `#0E121B`（更亮、偏靛蓝） | 提亮 6 L*，同步检查全部夜间对比度 |
| 7 | ListRow 分隔线 | rgba(20,20,40,0.06)（theme.ts:642） | 实色 `#EBE9FD` | 改实色（在近白底上更清楚） |
| 8 | IconCircle / homeIconTile | `#F0EDFA` / `#221E30`（theme.ts:660 / 710） | `#E0DFFD` / `#251A66` | 提高 tint 饱和度 |
| 9 | warning 色 | 日 `#D97706` 偏棕（theme.ts:655） | `#FAAE2F` 亮橙黄 | 替换并复核 AA |
| 10 | 分类预算 / 概览三栏 / 首页快捷四宫格 / 账户交易流水 | 完全不存在（`docs/FEATURES.md` §9） | 参考图 4 处都有 | 新建 4 个组件 + 数据接线 |

## 10. 落地检查表（每个新组件/新屏过一遍）

1. 颜色：所有 hex 都来自 `design/tokens.json` 语义名；文件里 hex 出现次数 = 0（emoji 除外）。
2. 文字：只用 `AppText` / `MoneyText`；中文 `lineHeightCjk` 比值 ≥1.30。
3. 间距：只出现 `spacing` 8 档 + `layout` 4 值；不出现 5、7、9、13、14、18 这类散值。
4. 圆角：只出现 `radius` 6 档。
5. 动效：只用 `motion` 档位；`reducedMotion` 下不位移、不滚动。
6. 触控：所有可点元素 ≥44×44；列表行 `minHeight 56`。
7. 明暗：`light` 与 `dark` 两套都跑一遍，任何新 token 必须两层都有值。
8. 金额：`tabular-nums` + 千分位 + 币种后缀；不换行不截断（宽度不足走 `shrinkLadder`）。
9. 状态：默认 / 按压 / 禁用 / 空 / 加载 / 错误 六态齐全。
10. 无障碍：每个可点元素有 `accessibilityLabel`；图标按钮必须有。

## 11. 未决与待补

- **分类 tint 调色板**（九宫格 16 色）：无法从 1x 图分离 emoji 与 tile 底色，需设计确认或按「同一 hue 8% 叠在 `bg.surface`」规则推导后再写入 `tokens.json`。
- **chart.violet 深色**：深色环图第二扇区未取到，暂用 `#8B6CFF`（theme.ts:714）。
- **数值渐变进度条**：参考图三种预算条都是同族横向渐变，是否需要第二个 stop 需设计确认。
- **DPR/字体渲染**：参考图是 1x 栅格，17pt 与 15pt 的字高差低至 1.3px，字号档位最终以 `tokens.json → typography` 为准。
