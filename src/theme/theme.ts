// theme.ts
// 颜色 token，light / dark 两套，字段名保持一致方便直接替换 StyleSheet 里的写死颜色。
//
// ⚠ 2026-10-09 起：文件下半部分是「设计系统语义层」（颜色 / 字号 / 间距 / 圆角 / 阴影），
//   上面原有令牌**全部保留**（兼容期，页面逐步迁移）。新代码一律从语义层取值 ——
//   规则见项目根 UI_RULES.md，取用：const { semantic, typography, spacing, radius, elevation } = useTheme();
//
// v4 设计原则（参照 apple-design / emil-design-eng skill）：
// 1. 全屏只有一个"主角"——净资产卡保留渐变，但收敛成更沉稳的深紫，
//    不再和正文卡片抢注意力；正文卡片一律纯色卡面 + 发丝描边。
// 2. 单一强调色：紫色系（link/fab/expense 同族），收入用薄荷绿区分，
//    超支/警示统一玫红。两套主题语义一致，只调明度。
// 3. 中性底色（去掉旧的紫底粉底），让卡面和强调色自己说话。

import type { TextStyle } from 'react-native';

export type ThemeColors = {
  bg: string;
  // 背景渐变端点：日间是很淡的薰衣草紫→近白，压住纯白的刺眼感；夜间两端同色（等效纯色）
  bgGradientFrom: string;
  bgGradientTo: string;
  // 原生 Header 的底色：日间淡紫色调，夜间同卡片色
  headerTint: string;
  card: string;
  cardShadow: string;
  // 卡片描边色：日间基本不需要（阴影已经够撑轮廓），夜间用来给净资产卡/
  // 预算卡/今日账单卡这几张"纯阴影没边"的卡片补一条看得见的边界
  cardBorder: string;

  assetCard: string;
  assetLabel: string;
  assetHint: string;
  assetValue: string;

  // 净资产卡片专用的渐变配色（首页 Hero 卡），跟上面通用的 assetCard 系列分开
  // 避免影响资产页等其他还在用深底白字风格的地方
  netWorthGradientFrom: string;
  netWorthGradientTo: string;
  netWorthAccent: string; // 眼睛图标、走势线等强调色
  netWorthLabel: string;
  netWorthValue: string;
  netWorthHint: string;

  // 首页净资产 Hero 卡专用渐变（2026-09-25 参考银行卡配色定版，只给 Home 用；
  // 资产页/记一笔/财务规划的账户分组大卡继续走上面的 netWorthGradient*，互不影响）：
  // 日间 = 左上薰衣草 → 右下长春花紫的对角渐变（From/To 两端）；
  // 夜间 = 右上紫色光晕 → 左下近黑深蓝（径向光晕用 4 段 stops 线性渐变近似：
  // 光晕起点 Glow、中段过渡 GlowMid、深底 Deep）
  homeHeroGradientFrom: string;
  homeHeroGradientTo: string;
  homeHeroGlow: string;
  homeHeroGlowMid: string;
  homeHeroDeep: string;
  homeHeroTopGlow: string;
  homeHeroUnderGlow: string;
  // 立体毛玻璃（2026-10-07 批次2 起共用；GlassLift 用）
  // ⚠ 2026-10-07 晚：旧 homeGlassEdge（顶部 1px 实心亮线）已删——真机上是浮在边内侧的硬直线。
  // 顶缘柔光改由 GlassLift 的 SVG 三层描边沿轮廓生成，透明度数值在 HomeScreen 的 glassPalette 内。
  homeGlassFillTop: string;
  // 2026-10-09 修正 25：填充改 3 段（亮→略暗→中间调=金属反光带）；日间=银紫拉丝金属（不透明），
  // 夜间=原两段的白 0.20→0.16 线性中值（0.18），加停点后夜间渲染逐像素不变
  homeGlassFillMid: string;
  homeGlassFillBottom: string;
  homeGlassBorder: string;
  // 日间倒角的「底部 1px 深紫灰」（浅底上给厚度=暗面+亮棱）；夜间档不消费（夜间由 border 全圈白边承担）
  glassEdgeShade: string;
  homeGlassShadow: string;
  // Hero 卡上玻璃件的内容色（2026-10-07 第 6 轮·修正 3）：日间玻璃件＝亮白玻璃 → 内容必须深色
  // （白图标/白字在白玻璃上是白叠白＝发糊）；夜间取原 netWorth* 值保证零变化
  homeGlassIcon: string;
  homeGlassText: string;
  homeGlassAccent: string;
  // 顶部/Hero 卡全部图标统一色（2026-10-08 按用户要求）：铃铛/账本箭头/中EN/日月/日历/眼睛/上下箭头
  // 共用此单值；日间=原太阳色，夜间=原上下箭头色。图标一律从这里取色，勿再各写各的。
  homeIconColor: string;

  // Hero 卡极光 shader（AuroraFlowShader）的三段色：暗部 → 中间雾 → 高亮丝。
  // 夜间=参考视频同款深紫极光（整层不透明全接管）；日间=浅底低饱和版（整层 ~0.55 叠在渐变上）
  homeHeroAuroraDark: string;
  homeHeroAuroraMid: string;
  homeHeroAuroraGlow: string;

  // Hero 卡曲面玻璃静态层（GlassRibbons）：玻璃亮面 / 深面 / 上缘高光。
  // 日间=白玻璃+品牌深紫；夜间=浅紫玻璃+更深的暗紫（同族不冲撞）
  homeHeroGlassLight: string;
  homeHeroGlassDeep: string;
  homeHeroGlassSheen: string;

  summaryCard: string;
  divider: string;
  dividerHair: string;

  // 预算/今日账单卡片现在走纯色卡面，渐变端点收成和 card 一致的扁平色，
  // token 保留是为了不动其他还在读这两个字段的页面
  summaryCardGradientFrom: string;
  summaryCardGradientTo: string;

  todayCardGradientFrom: string;
  todayCardGradientTo: string;

  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  link: string;

  income: string;
  expense: string;
  expenseOver: string;
  track: string;

  // 本月预算进度条的渐变端点色：正常（浅紫→青 + 亮青收尾高光，2026-10-06 按交互视频）/
  // 超支一组两档，配合 home 页新的独立预算卡使用
  budgetFillFrom: string;
  budgetFillTo: string;
  budgetFillMid: string;
  budgetFillOverFrom: string;
  budgetFillOverTo: string;

  // 信用卡"额度使用率"进度条的渐变端点色：正常 / 接近或超额度两种状态各一组，
  // 跟银行卡图标的蓝色系呼应，超额时复用预算条同一套警示红，两处红色语义保持一致
  creditFillFrom: string;
  creditFillTo: string;
  creditFillOverFrom: string;
  creditFillOverTo: string;

  fabBg: string;
  fabIcon: string;
  fabBorder: string;
  fabHighlight: string;
  fabShine: string;
  fabShadow: string;
  fabRipple: string;
  // 记一笔中央玻璃球（2026-10-06 照效果图逐像素取值：上玻璃/下紫填充硬分界 + 球外双色光晕）
  fabOrbGlassTop: string;
  fabOrbGlassFall: string;
  fabOrbGlassMid: string;
  fabOrbGlassLow: string;
  fabOrbGlassEdge: string;
  fabOrbWaterLine: string;
  fabOrbFillTop: string;
  fabOrbFillMid: string;
  fabOrbFillLow: string;
  fabOrbFillBottom: string;
  fabOrbAura: string; // 外层薰衣草大晕（2026-10-09 修正 24：只留这一圈很淡的同色光晕）
  fabOrbAuraBloom: string; // ⚠ 已停用（原「内层偏下品红光团」——用户「去掉粉色外晕」后 0 引用保留）
  // ⚠ 已停用（2026-10-09 修正 24：用户「去掉所有粉红/粉紫描边 tabOutline*」——
  //   原对角 X 型粉红描边已换成「白色细边 + 白 9 层顶缘柔光」，见 App.tsx 的 tabRim）
  tabOutlineFrom: string;
  tabOutlineMid: string;
  tabOutlineTo: string;
  // Tab 栏毛玻璃内容底（2026-10-09 修正 24：改**完全不透明**的竖向渐变、上浅下深——
  // 用户「背后的内容完全不透出来，画面干净」；夜 #2A1D45→#1C1233 / 日 #F4F0FF→#E6DFFB）
  tabGlassFrom: string;
  tabGlassMid: string;
  tabGlassTo: string;
  // Tab 栏白色细边（2026-10-09 修正 24）：栏体的 1px 白压线 + 选中托的白边共用（夜 0.22 / 日 0.9）
  tabEdge: string;
  // Tab 栏外投影色（2026-10-09 修正 24）：深紫、向下柔和扩散（填充不透明 → 可以走 elevation）
  tabShadow: string;
  // 底部选中器的"毛玻璃"底色（2026-10-09 修正 24：改圆角方小托 = 白 夜0.10/日0.7 + 白细边）
  tabBlobBg: string;
  // 首页改版材质（2026-10-06 交互视频定版）：深紫玻璃卡面（半透明，隐约透出背景渐变）/
  // 货币下拉悬浮面板玻璃 / 金属反光带 tint / 卡下外辉光色（配 SVG 径向渐变，透明度由组件控）
  // / 预算条收尾高光（亮青头，正常与超支各一档）
  homeGlassCard: string;
  homePanelGlass: string;
  homeMetalSheen: string;
  // Hero 金额「笔画内流光」三色（2026-10-08 处方）：MaskedView 以金额文字作遮罩 + 陀螺仪/自动循环驱动；
  // 亮芯≈纯白（2026-10-08 修正 19：白字叠浅光 = 看不见 → 改为「金属底色 + 近纯白亮芯」的亮度差方案）；
  // 肩 A/B 色相不同 = 轻微彩虹偏色（渐变两端 = 同色 alpha 0，禁用 'transparent'）
  homeAmountSheenCore: string;
  homeAmountSheenShoulderA: string;
  homeAmountSheenShoulderB: string;
  // Hero 金额「金属底色」三段（2026-10-08 修正 19 处方 1）：数字本身 = 竖向金属渐变，
  // 底色整体比纯白低一档 —— 给近纯白的流光亮芯留出亮度差
  homeAmountMetalTop: string;
  homeAmountMetalMid: string;
  homeAmountMetalBottom: string;
  // Hero 卡面扫光三色（2026-10-08 修正 20 处方 2）：宽光带（≈卡宽 70%、斜 20°）的亮芯 + 两肩；
  // 亮芯 alpha 夜≈0.12（冷紫白）/ 日≈0.22（暖白），渐变两端 = 同色 alpha 0（禁 'transparent'）
  homeCardSheenCore: string;
  homeCardSheenShoulderA: string;
  homeCardSheenShoulderB: string;
  homeGlowUnder: string;
  budgetFillHead: string;
  budgetFillHeadOver: string;
  // Hero 卡内预算面板（2026-10-06 按目标图回卡）：卡上内嵌玻璃底 + 白描边（日/夜成对）
  homeHeroPanelText: string;
  // 预算面板内文字/轨道（2026-10-07 第 5 轮新增；第 6 轮起日/夜同款）：
  // 面板=深紫罗兰玻璃 → 白字 + 深轨道（与夜间一致）
  homeBudgetLabel: string;
  homeBudgetValue: string;
  homeBudgetDim: string;
  homeBudgetTrack: string;
  icon: string;
  avatarBg: string;

  overlay: string; // modal 遮罩
};

export const lightColors: ThemeColors = {
  // UI V2.1 §1 日间（2026-10-10）：柔和粉紫 —— 渐变铺满整页，底色 = 线性段最后一停
  bg: '#F5F2FB',
  bgGradientFrom: '#DCD3FF',
  bgGradientTo: '#F5F2FB',
  headerTint: '#DCD3FF',
  card: '#FFFFFF',
  cardShadow: 'rgba(23,15,45,0.05)',
  cardBorder: 'rgba(23,15,45,0.14)',

  assetCard: '#23222B',
  assetLabel: 'rgba(255,255,255,0.62)',
  assetHint: 'rgba(255,255,255,0.45)',
  assetValue: '#f7e0f1',

  // 净资产卡：两套主题里都是饱和紫渐变 + 白字，品牌一致；
  // 日间稍亮一档，夜间更沉
  netWorthGradientFrom: '#7C5CFA',
  netWorthGradientTo: '#c5bbf2',
  netWorthAccent: '#FFFFFF',
  // 日间底色变浅（薰衣草），白字透明度提到 0.88/0.75 保住可读性（参考图同款软白）
  netWorthLabel: 'rgba(255,255,255,0.88)',
  netWorthValue: '#FFFFFF',
  netWorthHint: 'rgba(255,255,255,0.75)',

  // Hero 卡日间渐变：取样自参考图左卡（左上 #A383F1 → 右下 #8181FB）。
  // 夜间三个值仅类型占位，夜间走 darkColors 里的 Glow/GlowMid/Deep；TopGlow 日间不渲染（占位）
  homeHeroGradientFrom: '#A383F1',
  homeHeroGradientTo: '#8181FB',
  homeHeroGlow: '#7D54CE',
  homeHeroGlowMid: '#3A2F62',
  homeHeroDeep: '#0A0D26',
  homeHeroTopGlow: '#7856a2',
  // Hero 卡下呼吸辉光（2026-10-07 批次6 按目标图卡下辉光带取样；日夜同值）
  homeHeroUnderGlow: '#A855E8',
  // 立体毛玻璃日间档（2026-10-07 第 6 轮定「亮白玻璃」；2026-10-09 修正 23 改「半透明」；
  // 2026-10-09 修正 25 按用户处方改「银紫拉丝金属」）：
  // 用户「日间的按钮和面板现在是玻璃，夜间是金属，日间要改成和夜间一样的金属质感」——
  // 夜间读起来像金属的结构：表面不透明偏灰、边缘一条清晰锐利的细亮边（表面比亮边暗=暗面+亮棱的倒角）、
  // 没有柔和光晕、投影干净利落。日间照此结构：
  //   填充 **不透明** 3 段竖向渐变（亮 #ECE8F8 → 略暗 #D3CCEC → 中间调 #E0DAF3，降饱和、偏银灰，不透出 Hero 卡底），
  //   描边 **白 0.95**（顶部/两侧锐利高光），底部 1px 深紫灰 glassEdgeShade，
  //   柔光在 HomeScreen 的 glassPalette 里收窄到 ~1dp / 强度降档（glow 日 [0.10,0.05,0.02]）。
  // ⚠ 铁律残留说明：半透明填充禁用 elevation/shadow*（Android 阴影会透过来在元件内侧烧出内框）——
  // 日间填充改不透明后已可走 elevation（用户处方第 3 条明示），GlassLift 会自动切换；夜间档不动
  homeGlassFillTop: '#ECE8F8',
  homeGlassFillMid: '#D3CCEC',
  homeGlassFillBottom: '#E0DAF3',
  homeGlassBorder: 'rgba(255,255,255,0.95)',
  glassEdgeShade: 'rgba(60,40,120,0.22)',
  homeGlassShadow: '#3D2A7A',
  // Hero 卡上玻璃件内容色日间档（第 6 轮·修正 3）：亮白玻璃上换深紫（= 预算面板文字同族）
  homeGlassIcon: '#3B2A78',
  homeGlassText: '#3B2A78',
  homeGlassAccent: '#1677FF',
  // 图标统一色日间档 = 原太阳图标色（深紫，与面板文字同族）
  homeIconColor: '#3B2A78',

  // 极光 shader 日间：浅薰衣草底上的柔和白紫流光（低饱和、靠 opacity 0.55 压淡）
  homeHeroAuroraDark: '#E7DEFC',
  homeHeroAuroraMid: '#BFB0F6',
  homeHeroAuroraGlow: '#FFFFFF',

  // 曲面玻璃日间：白玻璃亮面 + 品牌深紫背面 + 白高光（叠在浅紫渐变上）
  homeHeroGlassLight: '#FFFFFF',
  homeHeroGlassDeep: '#6C4DF6',
  homeHeroGlassSheen: '#FFFFFF',

  summaryCard: '#F1F1F4',
  divider: '#E2EAF5',
  dividerHair: '#DCDCE4',

  summaryCardGradientFrom: '#FFFFFF',
  summaryCardGradientTo: '#FFFFFF',

  todayCardGradientFrom: '#FFFFFF',
  todayCardGradientTo: '#FFFFFF',

  // UI V2.1 §3：日间不再有白字压在浅色上；三级字/未选中 Tab 都提了对比度
  textPrimary: '#17142A',
  // V2.2c：日间二级字提对比度（#4F4A66 → #52698D）
  textSecondary: '#52698D',
  textTertiary: '#8397B4',
  link: '#1677FF',

  income: '#2FA75F', // tokens: amount.income
  expense: '#EF1116', // tokens: amount.expense（双主题改造：紫 → 红）
  expenseOver: '#EF1116', // tokens: status.danger
  track: '#ECECF1',

  // 预算进度条 2026-10-07 批次5 按目标图取样改 3 停：浅蓝紫 → 亮紫（55%）→ 青
  budgetFillFrom: '#A6B4FC',
  budgetFillMid: '#D6B4FE',
  budgetFillTo: '#42D0A1',
  budgetFillOverFrom: '#f1d6d6',
  budgetFillOverTo: '#E11D48',

  creditFillFrom: '#f67a54',
  creditFillTo: '#ff1500',
  creditFillOverFrom: '#F87171',
  creditFillOverTo: '#E11D48',

  fabBg: '#6C4DF6',
  fabIcon: '#ffffff',
  fabBorder: 'rgba(255,255,255,0.10)',
  fabHighlight: '#8570FF',
  fabShine: 'rgba(255,255,255,0.25)',
  fabShadow: '#4B32D4',
  fabRipple: '#BFAEFF',
  fabOrbGlassTop: '#D8CCFB',
  fabOrbGlassFall: '#C3B0F9',
  fabOrbGlassMid: '#A88CF1',
  fabOrbGlassLow: '#6FB2FF',
  fabOrbGlassEdge: '#7C5CFA',
  fabOrbWaterLine: '#E6E6F8',
  fabOrbFillTop: '#6F6BE3',
  fabOrbFillMid: '#6360DA',
  fabOrbFillLow: '#5854CF',
  fabOrbFillBottom: '#4A45C0',
  fabOrbAura: '#9C86E2',
  fabOrbAuraBloom: '#A848E1',
  tabOutlineFrom: '#5F4E8C',
  tabOutlineMid: '#A64E7E',
  tabOutlineTo: '#4C4A78',
  // Tab 栏底（2026-10-09 修正 24：完全不透明竖向渐变；修正 25：日间改「银紫拉丝金属」，
  // 与顶部按钮同一配方 —— 亮 #ECE8F8 → 略暗 #D3CCEC → 中间调 #E0DAF3，降饱和偏银灰，不再奶白）
  tabGlassFrom: '#ECE8F8',
  tabGlassMid: '#D3CCEC',
  tabGlassTo: '#E0DAF3',
  tabEdge: 'rgba(255,255,255,0.95)',
  tabShadow: '#3D2A7A',
  tabBlobBg: 'rgba(255,255,255,0.7)',
  // 首页改版材质（2026-10-06 交互视频定版；日间同配方各自推导）：
  // 深紫玻璃卡（半透明，隐约透出背景渐变）/ 下拉面板玻璃 / 金属反光带 tint（日间白度更高才看得见）
  // / 卡下外辉光色 / 预算条收尾高光（亮青头）
  // ⚠ 2026-10-07 第 6 轮（用户拍板）：「下面的日志也要用比较浅一点的，这个色调我 ok」→ 日间日卡回浅色档。
  // 填充刻意 0.94 近不透明：Android elevation 阴影透不过去，才不会在卡内侧烧出一圈灰边
  //（真机「日志框格没有渲染好」的根因：阴影透过 0.68 半透明卡面，web 渲染无此问题）
  homeGlassCard: 'rgba(248,245,255,0.94)',
  homePanelGlass: 'rgba(250,247,255,0.96)',
  homeMetalSheen: 'rgba(255,255,255,0.55)',
  // 日间笔画内流光（2026-10-08 修正 19）：暖白亮芯（≈纯白）+ 金/暖粉两肩
  homeAmountSheenCore: 'rgba(255,250,235,1)',
  homeAmountSheenShoulderA: 'rgba(255,236,200,0.34)',
  homeAmountSheenShoulderB: 'rgba(255,214,226,0.34)',
  // 日间金属底色（竖向）：白 → 淡紫白 → 白（比纯白低一档，给高光留空间）
  homeAmountMetalTop: '#FFFFFF',
  homeAmountMetalMid: '#E9E1FF',
  homeAmountMetalBottom: '#FFFFFF',
  // 日间卡面扫光：偏暖白亮芯 + 暖金/暖粉两肩（alpha 低，只在扫过时可见）
  homeCardSheenCore: 'rgba(255,246,226,0.22)',
  homeCardSheenShoulderA: 'rgba(255,238,205,0.09)',
  homeCardSheenShoulderB: 'rgba(255,225,232,0.09)',
  homeGlowUnder: '#6FB2FF',
  budgetFillHead: '#A9FBE9',
  budgetFillHeadOver: '#FFB3C1',
  // Hero 卡内预算面板（2026-10-06 回卡）：日间 = 亮玻璃面板（明显浅过卡面）+ 深紫字一套
  homeHeroPanelText: 'rgba(42,27,94,0.85)',
  // 预算面板内文字/轨道日间档（2026-10-07 第 6 轮定版）：面板浅 → 字深紫
  homeBudgetLabel: '#3B2A78',
  homeBudgetValue: '#2A1B5E',
  homeBudgetDim: 'rgba(42,27,94,0.62)',
  homeBudgetTrack: '#DCD4F5',
  icon: '#1B1B22',
  avatarBg: '#EDEDF2',

  overlay: 'rgba(20,15,40,0.4)',
};

export const darkColors: ThemeColors = {
  // UI V2.1 §1 夜间（2026-10-10）：更深 —— 渐变铺满整页，底色 = 线性段最后一停
  bg: '#06050C',
  bgGradientFrom: '#140A3A',
  bgGradientTo: '#140C22',
  headerTint: '#140A3A',
  card: '#0b162e',
  cardShadow: 'transparent',
  // 比 card 亮半档的发丝线，在深底上撑起卡片轮廓（阴影在深色背景上不够用）
  cardBorder: 'rgba(255,255,255,0.14)',

  assetCard: '#17171E',
  assetLabel: '#9B9BA8',
  assetHint: '#71717F',
  assetValue: '#ffffff',

  // 净资产卡：沉稳的深紫渐变，做全屏唯一的主角，
  // 比旧版的高饱和紫（#7B2FF2）收敛，靠层次而不是亮度突出
  netWorthGradientFrom: '#47257b',
  netWorthGradientTo: '#160932',
  netWorthAccent: '#C3B5FF',
  netWorthLabel: 'rgba(255,255,255,0.72)',
  netWorthValue: '#FFFFFF',
  netWorthHint: 'rgba(255,255,255,0.55)',

  // Hero 卡夜间渐变（2026-10-07 批次1：按新目标图逐像素取样拟合，RMSE≈5/255）：
  // 底色 = 73° 陡对角 #1e0e40（左上）→ #22193d（中）→ #0d0921（右下）；
  // 顶部光晕 = homeHeroTopGlow 径向层（圆心卡外上方 (0.70,-0.30)，r=0.83 卡宽，幂律 2.11）。
  // 日间两个 Gradient 值仅类型占位，日间走 lightColors 的 From/To
  homeHeroGradientFrom: '#A383F1',
  homeHeroGradientTo: '#8181FB',
  homeHeroGlow: '#1e0e40',
  homeHeroGlowMid: '#22193d',
  homeHeroDeep: '#0d0921',
  homeHeroTopGlow: '#7856a2',
  // Hero 卡下呼吸辉光（2026-10-07 批次6 按目标图卡下辉光带取样；日夜同值）
  homeHeroUnderGlow: '#A855E8',
  // 立体毛玻璃夜间档（GlassLift；2026-10-07 晚按目标图逐像素重取样：
  // 目标图卡上件填充几近平坦 ≈白 18%（上 0.20/下 0.16，不再是 0.30→0.10 的奶白渐变）；
  // 边缘线 0.28 与边缘柔光（GlassLift 内侧 9 层描边）叠加后 ≈白 0.42，与目标图顶缘实测 0.437 一致）
  homeGlassFillTop: 'rgba(255,255,255,0.20)',
  // 修正 25 加中停 = 原两段的线性中值（0.18）→ 夜间渲染与旧两段版本逐像素一致
  homeGlassFillMid: 'rgba(255,255,255,0.18)',
  homeGlassFillBottom: 'rgba(255,255,255,0.16)',
  homeGlassBorder: 'rgba(255,255,255,0.28)',
  // 夜间档不消费（夜间倒角由 homeGlassBorder 全圈白边承担；此值占位保证接口成对）
  glassEdgeShade: 'rgba(12,6,30,0.4)',
  homeGlassShadow: '#12082B',
  // Hero 卡上玻璃件内容色夜间档（= 原 netWorthLabel/Value/Accent 夜间值，零变化）
  homeGlassIcon: 'rgba(255,255,255,0.72)',
  homeGlassText: '#FFFFFF',
  homeGlassAccent: '#C3B5FF',
  // 图标统一色夜间档 = 原上下箭头色（淡紫，深卡上清晰）
  homeIconColor: '#C3B5FF',

  // 极光 shader 夜间：深紫底上柔和的同族紫（三段色收拢降低对比，亮丝不再近白——
  // 2026-09-25 用户定版方向：安静的纹理，不喧宾夺主）
  homeHeroAuroraDark: '#221B54',
  homeHeroAuroraMid: '#5B4FC0',
  homeHeroAuroraGlow: '#BBA9F2',

  // 曲面玻璃夜间：浅紫玻璃 + 深暗紫背面 + 薰衣草高光（叠在深紫渐变上，同族不冲撞）
  homeHeroGlassLight: '#A78BFA',
  homeHeroGlassDeep: '#2E1F7A',
  homeHeroGlassSheen: '#D9CFFF',

  summaryCard: '#17171E',
  divider: '#2A2A33',
  dividerHair: 'rgba(255,255,255,0.12)',

  summaryCardGradientFrom: '#17171E',
  summaryCardGradientTo: '#17171E',

  todayCardGradientFrom: '#17171E',
  todayCardGradientTo: '#17171E',

  // UI V2.1 §3：夜间不再用 #73738A / #82829A 这类暗灰；三级字改白 56%
  // V2.2c：二级字 .70 → .76
  textPrimary: '#F4F8FF',
  // 夜间灰字：实测对最亮的渐变色块（#7A2E6A）也 ≥4.5:1（secondary .84 = 5.9，tertiary .72 = 4.8）
  textSecondary: 'rgba(244,248,255,0.84)',
  textTertiary: 'rgba(180,205,240,0.86)',
  link: '#7FB6FF',

  income: '#61E9BE', // tokens: amount.income
  expense: '#FC5F5C', // tokens: amount.expense（双主题改造：紫 → 红）
  expenseOver: '#FC5F5C', // tokens: status.danger
  track: '#26262E',

  // 预算进度条 2026-10-07 批次5 按目标图取样改 3 停：浅蓝紫 → 亮紫（55%）→ 青
  budgetFillFrom: '#A6B4FC',
  budgetFillMid: '#D6B4FE',
  budgetFillTo: '#42D0A1',
  budgetFillOverFrom: '#fdb2bd',
  budgetFillOverTo: '#E11D48',

  creditFillFrom: '#f67a54',
  creditFillTo: '#ff1500',
  creditFillOverFrom: '#FB7185',
  creditFillOverTo: '#E11D48',

  fabBg: '#6C4DF6',
  fabIcon: '#ffffff',
  fabBorder: 'rgba(255,255,255,0.10)',
  fabHighlight: '#8570FF',
  fabShine: 'rgba(255,255,255,0.18)',
  fabShadow: '#3B28B8',
  fabRipple: '#BFAEFF',
  // 夜间整体收暗一档（用户反馈「夜间偏亮」；日间保持亮版，两套球体不再同值）
  fabOrbGlassTop: '#C3B7EA',
  fabOrbGlassFall: '#AC9EE3',
  fabOrbGlassMid: '#9184DC',
  fabOrbGlassLow: '#7A6CD4',
  fabOrbGlassEdge: '#6F61CF',
  fabOrbWaterLine: '#CDC9E8',
  fabOrbFillTop: '#625EC9',
  fabOrbFillMid: '#5754C1',
  fabOrbFillLow: '#4D49B4',
  fabOrbFillBottom: '#403BA4',
  fabOrbAura: '#8069C9',
  fabOrbAuraBloom: '#8F37C4',
  tabOutlineFrom: '#5F4E8C',
  tabOutlineMid: '#A64E7E',
  tabOutlineTo: '#4C4A78',
  // ⚠ 已停用（原「深紫 → 近黑」近覆盖渐变 → 修正 24 改不透光「上浅下深」）
  // Tab 栏底（2026-10-09 修正 24）：完全不透明竖向渐变（夜 #2A1D45 → #1C1233）
  tabGlassFrom: '#2A1D45',
  tabGlassMid: '#231941',
  tabGlassTo: '#1C1233',
  tabEdge: 'rgba(255,255,255,0.22)',
  tabShadow: '#12082B',
  tabBlobBg: 'rgba(255,255,255,0.10)',
  // 首页改版材质（2026-10-06 交互视频定版）：深紫玻璃卡（半透明，隐约透出背景渐变）/
  // 下拉面板玻璃（覆盖内容，透明度更高保可读）/ 金属反光带 tint / 卡下外辉光色 /
  // 预算条收尾高光（亮青头）
  homeGlassCard: 'rgba(26,16,46,0.94)',
  homePanelGlass: 'rgba(24,14,42,0.96)',
  homeMetalSheen: 'rgba(255,255,255,0.16)',
  // 夜间笔画内流光（2026-10-08 修正 19）：纯白亮芯 + 冷蓝/粉紫两肩
  homeAmountSheenCore: 'rgba(255,255,255,1)',
  homeAmountSheenShoulderA: 'rgba(178,200,255,0.32)',
  homeAmountSheenShoulderB: 'rgba(240,205,255,0.32)',
  // 夜间金属底色（竖向）：拉丝银紫 —— 白 → 紫灰 → 淡紫白
  homeAmountMetalTop: '#FFFFFF',
  homeAmountMetalMid: '#CFC4F5',
  homeAmountMetalBottom: '#F2EEFF',
  // 夜间卡面扫光：偏冷紫白亮芯 + 冷蓝/粉紫两肩（alpha 低，只在扫过时可见）
  homeCardSheenCore: 'rgba(224,216,255,0.12)',
  homeCardSheenShoulderA: 'rgba(190,205,255,0.05)',
  homeCardSheenShoulderB: 'rgba(235,215,255,0.05)',
  homeGlowUnder: '#7C5CFA',
  budgetFillHead: '#A9FBE9',
  budgetFillHeadOver: '#FFB3C1',
  // Hero 卡内预算面板（2026-10-06 回卡）：深紫底上白 12% 玻璃 + 白 10% 描边
  // 面板「剩余预算」行文字（2026-10-07 批次5 按目标图取样 ≈0.88 白；夜间不改）
  homeHeroPanelText: 'rgba(255,255,255,0.88)',
  // 预算面板内文字/轨道夜间档（2026-10-07 第 5 轮新增 token；取原观感值，夜间零变化）
  homeBudgetLabel: 'rgba(255,255,255,0.72)',
  homeBudgetValue: '#FFFFFF',
  homeBudgetDim: 'rgba(255,255,255,0.55)',
  homeBudgetTrack: '#26262E',
  icon: '#F4F4F6',
  avatarBg: '#202028',

  overlay: 'rgba(0,0,0,0.55)',
};

// ═══════════════════════════════════════════════════════════════════════════
// 设计系统语义层（UI/UX 改造计划 第 4 节，2026-10-09）
// 上方旧令牌全部保留；新代码只从这里取值。规则文档：项目根 UI_RULES.md。
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 语义颜色层（计划 4.1）。按「用途」命名，不按长相：
 * 紫色只有 accent / accentText / accentSoft 三档 —— 它们只用于主按钮、选中态、链接。
 */
export type SemanticColors = {
  /** 页面底（中性微紫灰 / 近黑），大面积画布 */
  bg: string;
  /** 卡片、列表组 */
  surface: string;
  /** 抽屉、弹层、浮动 Tab 栏（配 elevation.level2） */
  surfaceElevated: string;
  /** 次级块：键盘日期键、输入框、内嵌凹底（UI V2 新档，比 surface 深/浅一档） */
  surfaceSunken: string;
  /** 记一笔键盘面板底（独立一档，日夜都是面板色） */
  keypadPanel: string;
  /** 数字键 / 日期键 / 备注胶囊的实底（分开的圆角块，不是整面板一个底） */
  keyTile: string;
  /** 键按下时的底色（比 keyTile 略深） */
  keyTilePressed: string;
  /** 键的发丝描边（几乎看不见，只给夜间面板的块面一点边界） */
  keyTileHairline: string;
  /** 退格键 / 收据芯片的淡紫实底（实底，不用 accentSoft 半透明：半透明叠在面板上会把紫字压到 4:1 以下） */
  keyAccentTile: string;
  /** 退格键图标 / 收据芯片字：深一档的紫，在 keyAccentTile 上 ≥4.5:1（日间 accentText #6C4DF6 只有 4.08） */
  keyAccentText: string;
  /** 悬浮 Tab 栏栏身（V2.2 定稿：高不透明度磨砂 —— 夜 88% / 日 90%，模糊仍走玻璃令牌） */
  tabBar: string;
  /** Tab 选中色（夜白 / 日紫）；未选中色见 tabInactive */
  tabActive: string;
  /** Tab 选中「标签文字」色：夜间 accentText(#7FB6FF) 落在栏身上只有 ~4.3:1，改用更亮的 #D2C8FF（≥4.5:1 on 栏身）；日间同 accent */
  tabActiveLabel: string;
  /** Tab 未选中色 */
  tabInactive: string;
  /** 分割线、卡片描边 */
  hairline: string;
  /** Switch 关闭态轨道（V2.2c：日 #CBD9EE / 夜白 22%）—— 玻璃 / 渐变上 6% 的发丝线太浅，看不见 */
  switchTrackOff: string;
  /** 主文字 */
  textPrimary: string;
  /** 次要文字 */
  textSecondary: string;
  /** 弱化文字 —— 只给 ≥13pt（footnote 及以上）的辅助文字用 */
  textTertiary: string;
  /** 主按钮 / 选中底 / 强调填充（唯一紫色填充） */
  accent: string;
  /** 紫底上的文字（一律白色，修旧 colors.bg 当字色用的 bug） */
  onAccent: string;
  /** 紫色文字 / 链接（夜间要提亮，所以与 accent 分开两档） */
  accentText: string;
  /** 选中胶囊底、选中图标方块底（10% 紫） */
  accentSoft: string;
  /** 支出金额 = 主文字色 + 「−」（中性，既不是红也不是紫） */
  amountExpense: string;
  /** 收入金额 = 绿 + 「+」 */
  amountIncome: string;
  /** 转账金额 = 次要文字色 + ⇄ 图标（无正负号） */
  amountTransfer: string;
  /** 超支 / 删除 / 错误（删除图标、滑动删除底一律改用它） */
  danger: string;
  /** 预算接近上限（≥80%，>100% 用 danger） */
  warning: string;
  /** 全 App 唯一遮罩色（替换现有 6 种写法） */
  scrim: string;
  /** V3 首页页面底（渐变之下的纯色底） */
  homeBg: string;
  /** V3 首页账单实底卡（不透明，无玻璃） */
  homeCard: string;
  /** V3 首页账单卡发丝线 */
  homeHairline: string;
  /** V3 首页账单行图标方块底（38dp 圆角方块） */
  homeIconTile: string;
  /** 选中行底（10% 紫压在卡色上，不透明）：日 #F0EDFE / 夜 #1F1A35 */
  selectedRow: string;
  /** 系统导航栏区（底部安全区）的实底：日 #F5F2FB / 夜 #06050C */
  navBarBg: string;
  /** 首页预算进度条轨道 */
  budgetTrack: string;
  /** 首页预算进度条填充（健康） */
  budgetFill: string;
  /** 首页预算进度条填充（超支） */
  budgetFillOver: string;

  /* ─── design/tokens.json 新增语义（2026 双主题改造）─────────────────────────
   * 命名严格对齐 tokens.json -> light.color / dark.color 的键，
   * 组件只从这里取色，禁止再写裸 hex。 */

  /** 成功（收入确认 / 预算健康 / 结余为正）—— tokens: status.success */
  success: string;
  /** 品牌淡底块（选中底、图表淡底）—— tokens: bg.brandSoft */
  brandSoft: string;
  /** 薄荷淡底（次要图表块 / 提示块）—— tokens: bg.tileMint */
  tileMint: string;
  /** 文字链接 —— tokens: text.link */
  textLink: string;
  /** 反色文字（渐变、深底、品牌色块上的字）—— tokens: text.inverse */
  textInverse: string;
  /** 分组分隔线（比 hairline 深一档）—— tokens: border.divider */
  divider: string;
  /** 图表第 1 色 —— tokens: chart.orange */
  chartOrange: string;
  /** 图表第 2 色 —— tokens: chart.violet */
  chartViolet: string;
  /** 品牌渐变起点（按钮 / 选中块 / 环形图）—— tokens: brand.gradientFrom */
  gradientFrom: string;
  /** 品牌渐变终点 —— tokens: brand.gradientTo */
  gradientTo: string;
  /** Hero 渐变起点（首页顶部大色块，日夜两套不同）—— tokens: brand.heroFrom */
  heroFrom: string;
  /** Hero 渐变终点 —— tokens: brand.heroTo */
  heroTo: string;
};

export const lightSemantic: SemanticColors = {
  // UI V2.1 定稿数值（.zcode/design/UI_V21_SPEC.md 第 1/2/3 节，2026-10-10）
  bg: '#F5FAFF', // tokens: bg.page
  surface: '#FFFFFF', // tokens: bg.surface
  surfaceElevated: '#FFFFFF', // tokens: bg.surfaceRaised
  surfaceSunken: '#EAF4FF', // tokens: bg.surfaceSunken
  keypadPanel: '#F5F9FF', // 日间键盘面板：浅薰衣草底，白色圆角键浮在上面（稿 G_AddLight）
  keyTile: '#FFFFFF',
  keyTilePressed: '#DCEBFF',
  keyTileHairline: 'rgba(17,17,26,0.06)',
  keyAccentTile: '#E8F2FF',
  keyAccentText: '#1677FF',
  // Tab 栏 = 唯一玻璃材质（§2）+ V2.2 高不透明度栏身填充：后面的列表文字不再透出来
  tabBar: 'rgba(255,255,255,0.94)',
  tabActive: '#1677FF',
  tabActiveLabel: '#1677FF',
  tabInactive: '#8397B4', // = textTertiary（§3：Tab 未选中）
  hairline: '#EAF4FF', // tokens: border.hairline
  switchTrackOff: '#CBD9EE',
  textPrimary: '#071C49', // tokens: text.primary
  textSecondary: '#52698D', // tokens: text.secondary
  textTertiary: '#8397B4', // tokens: text.tertiary
  accent: '#1677FF', // tokens: brand.primary
  onAccent: '#FFFFFF',
  accentText: '#1677FF', // tokens: text.link
  accentSoft: 'rgba(22,119,255,0.10)',
  // ⚠ 双主题改造：支出金额从紫色改为红色（tokens: amount.expense / status.danger）
  amountExpense: '#EF1116',
  amountIncome: '#2FA75F', // tokens: amount.income / status.success
  amountTransfer: '#52698D', // tokens: amount.transfer
  danger: '#EF1116', // tokens: status.danger
  warning: '#FAAE2F', // tokens: status.warning
  scrim: 'rgba(10,8,20,0.40)',
  homeBg: '#F5FAFF', // = bg（tokens: bg.page）
  homeCard: '#FFFFFF', // = surface（tokens: bg.surface）
  homeHairline: '#EAF4FF', // = hairline（tokens: border.hairline）
  homeIconTile: '#EEF5FF',
  selectedRow: '#E8F2FF', // tokens: bg.brandSoft
  navBarBg: '#F5FAFF',
  budgetTrack: 'rgba(7,28,73,0.10)',
  budgetFill: '#1677FF', // tokens: brand.primary
  budgetFillOver: '#EF1116', // tokens: status.danger
  success: '#2FA75F',
  brandSoft: '#E8F2FF',
  tileMint: '#D0ECE2',
  textLink: '#1677FF',
  textInverse: '#FFFFFF',
  divider: '#E2EAF5',
  chartOrange: '#FE8751',
  chartViolet: '#6F36CC',
  gradientFrom: '#2F7CDF',
  gradientTo: '#1677FF',
  heroFrom: '#2F7CDF',
  heroTo: '#1677FF',
};

export const darkSemantic: SemanticColors = {
  // UI V2.1 定稿数值（.zcode/design/UI_V21_SPEC.md 第 1/2/3 节，2026-10-10）
  // 夜间：bg < surface < surfaceElevated 逐级变亮（底层后退、浮层前进），不靠阴影
  bg: '#020E22', // tokens: bg.page
  surface: '#0A1A32', // tokens: bg.surface
  surfaceElevated: '#1D2233', // tokens: bg.surfaceRaised
  surfaceSunken: '#161A27', // tokens: bg.surfaceSunken
  keypadPanel: '#121219',
  keyTile: '#1E1B2A',
  keyTilePressed: '#2B2740',
  keyTileHairline: 'rgba(255,255,255,0.07)',
  keyAccentTile: '#2B2547',
  keyAccentText: '#7FB6FF',
  // Tab 栏 = 唯一玻璃材质（§2）+ V2.2 高不透明度栏身填充：后面的列表文字不再透出来
  tabBar: 'rgba(14,10,30,0.92)',
  tabActive: '#FFFFFF',
  // 选中标签文字：#D2C8FF 在栏身最暗到最亮的实测底色（#3A3550 ~ #5A5470）上均 ≥4.5:1
  tabActiveLabel: '#D2C8FF',
  // ⚠ 不是 textTertiary（0.56）：Tab 标签是 11pt 小字（§4 要 4.5:1），而浮空 Tab 栏是玻璃 +
  //    模糊，实测栏内底色会被下方内容提亮到 rgb(90-104, 80-93, 96-144) —— 0.56 只有 3.0-3.4:1。
  //    0.85 实测 4.48:1（差 0.02 不达标），取 0.90（选中 / 未选中仍靠「实心图标 vs 线框图标 + 亮度差」区分）
  tabInactive: 'rgba(244,248,255,0.86)',
  hairline: 'rgba(255,255,255,0.05)',
  switchTrackOff: 'rgba(255,255,255,0.22)',
  textPrimary: '#F4F8FF',
  // 夜间灰字（见 darkColors 同名注释）：secondary .84 / tertiary .72，对最亮渐变色块 ≥4.5:1
  textSecondary: 'rgba(244,248,255,0.84)',
  textTertiary: 'rgba(180,205,240,0.86)',
  accent: '#1685FF', // tokens: brand.primary
  onAccent: '#FFFFFF',
  accentText: '#7FB6FF', // tokens: text.link
  accentSoft: 'rgba(22,133,255,0.16)',
  // ⚠ 双主题改造：支出金额从紫色改为红色（tokens: amount.expense / status.danger）
  amountExpense: '#FC5F5C',
  amountIncome: '#61E9BE', // tokens: amount.income / status.success
  amountTransfer: 'rgba(244,248,255,0.84)', // tokens: amount.transfer
  danger: '#FC5F5C', // tokens: status.danger
  warning: '#FFC21D', // tokens: status.warning
  scrim: 'rgba(0,0,0,0.55)',
  homeBg: '#020E22', // = bg（tokens: bg.page）
  homeCard: '#0A1A32', // = surface（tokens: bg.surface）
  homeHairline: 'rgba(255,255,255,0.05)', // = hairline（tokens: border.hairline）
  homeIconTile: '#10264A',
  selectedRow: '#0E2A55', // tokens: bg.brandSoft
  navBarBg: '#020E22',
  budgetTrack: 'rgba(255,255,255,0.14)',
  budgetFill: '#1685FF', // tokens: brand.primary
  budgetFillOver: '#FC5F5C', // tokens: status.danger
  success: '#61E9BE',
  brandSoft: '#0E2A55',
  tileMint: '#17382A',
  textLink: '#7FB6FF',
  textInverse: '#FFFFFF',
  divider: '#2A2A33',
  chartOrange: '#FC5F2C',
  chartViolet: '#6FB2FF',
  gradientFrom: '#1685FF',
  gradientTo: '#1257B6',
  heroFrom: '#1257B6',
  heroTo: '#0A2A66',
};

/**
 * 字号层（计划 4.2）：11 档取代现有 26 种字号，最小 11pt（禁止 7–10pt）。
 * - letterSpacing 只对数字 / 拉丁字母有意义，中文文本请置 0（AppText 会自动判断）。
 * - maxFontSizeMultiplier：尊重系统「大字」设置又保证不破版（计划 8.2 第 3 条）。
 * - 全部金额文字必须加 fontVariant: ['tabular-nums']（等宽数字）。
 */
export type TypographyVariant =
  | 'display'
  | 'amountEntry'
  | 'title1'
  | 'title2'
  | 'title3'
  | 'headline'
  | 'body'
  | 'subhead'
  | 'footnote'
  | 'caption'
  | 'caption2';

export type TypographyToken = {
  fontSize: number;
  /** 拉丁 / 数字行高（拉丁字形的行盒比中文矮，用更紧的行高） */
  lineHeight: number;
  /** 中文行高（硬约束 ≥1.30 × fontSize；AppText 判定为 CJK 字体分流时用它） */
  lineHeightCjk: number;
  fontWeight: TextStyle['fontWeight'];
  letterSpacing: number;
  maxFontSizeMultiplier: number;
};

export type Typography = Record<TypographyVariant, TypographyToken>;

// 数值与 design/tokens.json -> typography.variants 逐档一致（lineHeightCjk 见各自 source 注）。
export const typography: Typography = {
  // 净资产金额（Hero 卡）；超过 9 位整数按档位降级 40 → 34 → 28，不做连续压缩
  display: { fontSize: 40, lineHeight: 46, lineHeightCjk: 52, fontWeight: '600', letterSpacing: -0.8, maxFontSizeMultiplier: 1.15 },
  // 记一笔输入金额（自动缩小，下限 28）
  amountEntry: { fontSize: 44, lineHeight: 52, lineHeightCjk: 58, fontWeight: '600', letterSpacing: -0.9, maxFontSizeMultiplier: 1.15 },
  // Tab 根页面大标题（资产 / 统计 / 设置）
  title1: { fontSize: 28, lineHeight: 34, lineHeightCjk: 37, fontWeight: '700', letterSpacing: -0.4, maxFontSizeMultiplier: 1.2 },
  // 卡片大数字、页内主数字
  title2: { fontSize: 22, lineHeight: 28, lineHeightCjk: 29, fontWeight: '700', letterSpacing: -0.3, maxFontSizeMultiplier: 1.2 },
  // 二级页标题
  title3: { fontSize: 20, lineHeight: 25, lineHeightCjk: 26, fontWeight: '600', letterSpacing: 0, maxFontSizeMultiplier: 1.2 },
  // 列表行标题、按钮
  headline: { fontSize: 17, lineHeight: 22, lineHeightCjk: 23, fontWeight: '600', letterSpacing: 0, maxFontSizeMultiplier: 1.2 },
  // 正文
  body: { fontSize: 17, lineHeight: 22, lineHeightCjk: 23, fontWeight: '400', letterSpacing: 0, maxFontSizeMultiplier: 1.35 },
  // 行副标题、账户名
  subhead: { fontSize: 15, lineHeight: 20, lineHeightCjk: 20, fontWeight: '400', letterSpacing: 0, maxFontSizeMultiplier: 1.35 },
  // 日期头、说明
  footnote: { fontSize: 13, lineHeight: 18, lineHeightCjk: 17, fontWeight: '400', letterSpacing: 0, maxFontSizeMultiplier: 1.35 },
  // 徽章、标签
  caption: { fontSize: 12, lineHeight: 16, lineHeightCjk: 16, fontWeight: '500', letterSpacing: 0.1, maxFontSizeMultiplier: 1.3 },
  // 最小字号档（任何地方都不许比它更小）
  caption2: { fontSize: 11, lineHeight: 13, lineHeightCjk: 15, fontWeight: '500', letterSpacing: 0.2, maxFontSizeMultiplier: 1.3 },
};

/** 间距层（计划 4.3）：8pt 网格，只有这 8 个值，页面上不许再出现别的数字 */
export type Spacing = {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
  xxxl: number;
  huge: number;
};

export const spacing: Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
};

/** 页面级固定尺寸（计划 4.3）：页边距 / 卡内边距 / 分组间距 / 列表行最小高度 */
export const layout = {
  /** 页面左右边距 */
  page: 16,
  /** 卡内边距 */
  card: 16,
  /** 分组间距 */
  section: 24,
  /** 列表行最小高度（44 触控区 + 留白） */
  rowMinHeight: 56,
} as const;

export type Layout = typeof layout;

/** 圆角层（计划 4.3）：6 档取代现有约 28 档 */
export const radius = {
  /** 徽章 */
  xs: 6,
  /** 胶囊 / 输入框 */
  sm: 10,
  /** 按钮、图标方块 */
  md: 14,
  /** 卡片、Hero */
  lg: 20,
  /** 抽屉顶部 */
  xl: 28,
  /** 全圆 */
  full: 999,
} as const;

export type Radius = typeof radius;

/**
 * 阴影层（计划 4.3 / 8.2 第 6 条）：全部走 RN 跨平台 boxShadow 字符串，iOS / Android 一致。
 * level0 = 无阴影（用 hairline 撑轮廓）；夜间 level1 也无阴影（靠 surface 比 bg 亮一档 + hairline）。
 * 用法：StyleSheet.create({ card: { ...elevation.level1 } }) 或 style={[styles.card, elevation.level2]}
 */
export type ElevationToken = { boxShadow?: string };

export type Elevation = {
  level0: ElevationToken;
  level1: ElevationToken;
  level2: ElevationToken;
};

export const lightElevation: Elevation = {
  level0: {},
  // 卡片：极轻双层阴影（日间）
  level1: { boxShadow: '0px 1px 2px rgba(23,15,45,0.04), 0px 4px 12px rgba(23,15,45,0.06)' },
  // 浮层：Tab 栏、抽屉、下拉
  level2: { boxShadow: '0px 8px 24px rgba(23,15,45,0.12)' },
};

export const darkElevation: Elevation = {
  level0: {},
  // 夜间卡片不用阴影：surface(#15151E) 比 bg(#0B0B12) 亮一档即分层
  level1: {},
  level2: { boxShadow: '0px 8px 24px rgba(0,0,0,0.50)' },
};

/* ─────────────────────── UI V2：品牌渐变 / 玻璃（2026-10-10 定稿） ───────────────────────
 * 数值来源：.zcode/design/UI_V2_SPEC.md 第 1 节（与 .zcode/design/mockups/*.dc.html 的内联样式一致）。
 * 页面不直接拼色值 —— 一律经由 HeroGradient / GlassView 组件取这里。
 */

/**
 * expo-linear-gradient 参数（CSS 角度已按 390×580 的版面折算成 start/end 分数；
 * start/end 都是相对容器宽高的比例，不是绝对坐标）。
 */
export type LinearGradientToken = {
  colors: readonly [string, string, ...string[]];
  locations?: number[];
  start: { x: number; y: number };
  end: { x: number; y: number };
};

/** Hero 径向光斑（SVG RadialGradient 的椭圆参数，圆心/半径都是容器分数；0.6 处淡到全透明） */
export type HeroBlob = {
  color: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** 颜色淡出的半径位置（CSS radial-gradient 的 transparent 60%） */
  fadeStop: number;
};

export type HeroGradientToken = LinearGradientToken & { blobs: HeroBlob[]; angle: number };

/**
 * CSS 渐变角 → expo-linear-gradient 的 start/end 分数（按容器实测宽高换算）。
 * expo-linear-gradient 只有两点坐标：直接写分数会让角度随容器高宽漂移
 * （实测 390×580 是 160°，220 高的演示块漂成 127°）。按 CSS 公式
 * 「渐变线长 = |w·sinθ| + |h·cosθ|」换算后，任意框型都是同一个角度。
 * @param angleDeg CSS 角度（0 = 向上，90 = 向右，180 = 向下）
 */
export function gradientAxis(
  angleDeg: number,
  width: number,
  height: number
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const len = Math.abs(width * dx) + Math.abs(height * dy);
  const half = len / 2;
  const cx = width / 2;
  const cy = height / 2;
  return {
    start: { x: (cx - half * dx) / width, y: (cy - half * dy) / height },
    end: { x: (cx + half * dx) / width, y: (cy + half * dy) / height },
  };
}

/**
 * 品牌渐变（UI V2.1 §1 —— 渐变铺满整页，配 HeroGradient 的 fill 模式）：
 * - heroDark / heroLight：3 个径向光斑 + 165° 主渐变（夜间更深 / 日间柔和粉紫）；
 * - accent：135°（中央「+」、完成键、选中三选一）。
 * 数值取样自 .zcode/design/mockups/v21/*.dc.html 的 .dk / .lt 变量。
 */
export const gradients: {
  heroDark: HeroGradientToken;
  heroLight: HeroGradientToken;
  /** 品牌渐变（浅色主题；= tokens: brand.gradientFrom/To） */
  brandLight: LinearGradientToken;
  /** 品牌渐变（深色主题；= tokens: brand.gradientFrom/To） */
  brandDark: LinearGradientToken;
  /**
   * @deprecated 用 useTheme().gradients.accent —— 它是按当前主题解析过的品牌渐变。
   * 这里保留只为兼容尚未迁移的 import；值等于 brandLight。
   */
  accent: LinearGradientToken;
  /** 键盘「完成」键：accent 紫 → 亮紫（稿 G_Add，135°） */
  keyConfirm: LinearGradientToken;
} = {
  // ⚠ 双主题改造：Hero 渐变日夜两套不再共用（tokens: brand.heroFrom/heroTo）。
  //   日间 = 亮紫 → 主紫；夜间 = 中紫 → 深靛紫（更深，压在 bg #020E22 上不刺眼）。
  heroDark: {
    colors: [darkSemantic.heroFrom, darkSemantic.heroTo],
    locations: [0, 1],
    // 165°（CSS）；start/end 是 390×844 的折算值，运行时按实测宽高用 gradientAxis() 重算
    angle: 165,
    start: { x: 0.2, y: -0.02 },
    end: { x: 0.8, y: 1.02 },
    blobs: [
      { color: 'rgba(124,99,246,0.50)', cx: 0, cy: 0, rx: 0.9, ry: 0.55, fadeStop: 0.6 },
      { color: 'rgba(94,61,250,0.42)', cx: 1, cy: 0.35, rx: 0.8, ry: 0.5, fadeStop: 0.62 },
      { color: 'rgba(39,16,166,0.45)', cx: 0.2, cy: 0.85, rx: 0.7, ry: 0.45, fadeStop: 0.6 },
    ],
  },
  heroLight: {
    // 日间：深端在上、亮端在下（180° 竖直）——Hero 顶部的文字是白字（tokens: text.inverse），
    // 深端 #1677FF 上白字 5.2:1；若把亮端 #2F7CDF 放顶部，白字只有 3.1:1、深字也只有 3.5:1，
    // 两头都不达标。取值仍严格来自 tokens（brand.heroFrom / heroTo），只调方向。
    colors: [lightSemantic.heroTo, lightSemantic.heroFrom],
    locations: [0, 1],
    angle: 180,
    start: { x: 0.5, y: 0 },
    end: { x: 0.5, y: 1 },
    blobs: [
      { color: 'rgba(255,255,255,0.22)', cx: 0, cy: 0, rx: 0.9, ry: 0.55, fadeStop: 0.6 },
      { color: 'rgba(99,79,252,0.35)', cx: 1, cy: 0.35, rx: 0.8, ry: 0.5, fadeStop: 0.62 },
      { color: 'rgba(144,131,252,0.40)', cx: 0.2, cy: 0.85, rx: 0.7, ry: 0.45, fadeStop: 0.6 },
    ],
  },
  brandLight: {
    colors: [lightSemantic.gradientFrom, lightSemantic.gradientTo],
    locations: [0, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
  brandDark: {
    colors: [darkSemantic.gradientFrom, darkSemantic.gradientTo],
    locations: [0, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
  accent: {
    colors: [lightSemantic.gradientFrom, lightSemantic.gradientTo],
    locations: [0, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
  keyConfirm: {
    colors: [lightSemantic.gradientFrom, lightSemantic.gradientTo],
    locations: [0, 1],
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
  },
};

/**
 * 页面底渐变（HeroGradient 的 fill 模式）：整页铺底但不压住内容 ——
 * 顶部取 heroFrom 的极淡薄层，向下融进 bg.page。
 * 两个端点都没有裸色值：颜色一律来自 semantic（heroFrom / bg）。
 */
export const pageWashAlpha = { from: 0.20, mid: 0.06 } as const;

/** Hero 渐变底部淡出到页面底：从渐变高度 ~50% 处开始，92% 处已是实底 bg */
export const heroFade = {
  startFraction: 0.5,
  solidAt: 0.92,
} as const;

/** 首页 Hero 上的 26dp 网格线（白色 6% 夜 / 12% 日，从 30% 处向下淡出到 90% 透明） */
export const heroGrid = {
  light: 'rgba(255,255,255,0.12)',
  dark: 'rgba(255,255,255,0.06)',
  size: 26,
  fadeFrom: 0.3,
  fadeTo: 0.9,
} as const;

/**
 * 唯一毛玻璃材质（UI V2.1 §2，2026-10-10）：按钮、分段、卡片、列表、表单、
 * BottomSheet、AppDialog、Tab 栏全部用它（旧的「白 22% 玻璃 + 白字」「surface 实色卡」都删）。
 * = 半透明填充 + 1px 亮边 + 顶部内高光 + 投影；iOS / Web 叠加 BlurView(blur 24)，
 * Android 不支持模糊时退回纯 rgba（见 GlassView，绝不白屏；对比度仍按 §4 达标）。
 * ⚠ CSS 的 saturate(150%) expo-blur 做不了，模糊层只用 tint 固定材质（视觉差在饱和度，颜色由 fill 决定）。
 */
export type GlassToken = {
  /** 半透明填充 */
  fill: string;
  /** 1px 边 */
  borderColor: string;
  borderWidth: number;
  /** 顶部内高光（贴顶细亮线） */
  highlightColor: string;
  highlightHeight: number;
  /** 投影（稿：0 12 32 -20 rgba(20,10,60,.55)，日夜同值） */
  shadow: string;
  /**
   * expo-blur 强度（稿是 CSS blur 24px）。
   * expo-blur 的 web 映射 = blur(${min(intensity,100) × 0.2}px) → 100 才到 20px（库上限，最接近 24）；
   * iOS 的 100 ≈ 系统最厚材质，与稿里的磨砂观感一致。
   */
  blurIntensity: number;
};

export const lightGlass: GlassToken = {
  fill: 'rgba(255,255,255,0.55)',
  borderColor: 'rgba(255,255,255,0.85)',
  borderWidth: 1,
  highlightColor: 'rgba(255,255,255,0.90)',
  highlightHeight: 1,
  shadow: '0px 12px 32px -20px rgba(20,10,60,0.55)',
  blurIntensity: 100,
};

export const darkGlass: GlassToken = {
  fill: 'rgba(14,10,30,0.46)',
  borderColor: 'rgba(255,255,255,0.10)',
  borderWidth: 1,
  highlightColor: 'rgba(255,255,255,0.12)',
  highlightHeight: 1,
  shadow: '0px 12px 32px -20px rgba(20,10,60,0.55)',
  blurIntensity: 100,
};

/**
 * 分段控件的选中块（UI V2.1 §2）：夜 = 白胶囊 + 深字；日 = 紫胶囊 + 白字。
 * fill = 胶囊底 / text = 选中字色 / muted = 未选中字色（玻璃上，取 text.secondary 保证对比）
 */
export const glassPill = {
  light: { fill: '#1677FF', text: '#FFFFFF', muted: '#4F4A66' },
  dark: { fill: '#FFFFFF', text: '#1A1040', muted: 'rgba(244,248,255,0.84)' },
} as const;

/**
 * 类别选中圆的外圈（UI V2 记一笔）：两层外圈 = 3dp 页面底色打底 + 5dp 外环；
 * 日间外环用固定紫 #9B5BD6，夜间用类别色 60%（见 IconCircle）。
 */
export const categoryRing = {
  light: '#9B5BD6',
  darkAlpha: 0.6,
  gapWidth: 3,
  ringWidth: 5,
} as const;

/**
 * 悬浮 Tab 栏 / 中央「+」的投影（UI V2 稿）：
 * 栏身——夜 = 大黑软阴影 / 日 = 近距淡影 + 大范围淡紫灰；
 * 「+」——粉紫光晕（稿里带负 spread，RN 用略低 alpha + 小模糊近似）。
 */
export const tabBarShadow = {
  light: '0px 2px 4px rgba(20,20,40,0.05), 0px 14px 32px rgba(60,30,120,0.16)',
  dark: '0px 14px 32px rgba(0,0,0,0.55)',
} as const;

export const centerButtonShadow = {
  light: '0px 8px 18px rgba(194,103,143,0.60)',
  dark: '0px 8px 18px rgba(194,103,143,0.75)',
} as const;

/**
 * 打包字体层（UI V2.2c，2026-10-12）：数字 / 英文 = **Inter**，中文 = **Noto Sans SC**，
 * 两族都随包发（OFL 许可）——不再依赖系统字体，跨机型字形与宽度一致。
 * - Inter 400/500/600/700：assets/fonts/Inter-*.ttf（官方 4 档，无 300）。
 * - Noto Sans SC 400/500/700：assets/fonts/NotoSansSC-*.ttf，用 pyftsubset 子集化为
 *   常用汉字 3755（GB2312 一级字表）+ 标点 + 拉丁，每档 1.4MB（≤1.5MB 预算）。
 * ⚠ 这里的值 = 字体内部 PostScript 名，也是 App.tsx 里 useFonts 的键 —— 改一处必须同步另一处。
 * ⚠ 静态字体按家族名分字重（Inter-SemiBold / NotoSansSC-Bold…），**不能再给 fontWeight**，
 *   否则安卓会去合成加粗、iOS 二次加粗（家族名即字重）。
 */
export const fontFamily = {
  light: 'Inter-Regular', // Inter 无 300 单档，Light 档回落到 Regular
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semiBold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
} as const;

export type FontFamily = typeof fontFamily;

/**
 * 中文字体家族（Noto Sans SC 子集）：只有 400 / 500 / 700 三档。
 * 600（semiBold）落到 Bold —— 中文 700 相对 500 的笔画增量远小于拉丁，观感仍是「半粗」，
 * 且金额 / 标题要求的最低字重是 600，宁可偏重也不能偏轻。
 */
export const fontFamilyCjk = {
  light: 'NotoSansSC-Regular',
  regular: 'NotoSansSC-Regular',
  medium: 'NotoSansSC-Medium',
  semiBold: 'NotoSansSC-Bold',
  bold: 'NotoSansSC-Bold',
} as const;

export type FontFamilyCjk = typeof fontFamilyCjk;

/** fontFamily 令牌取值的联合（Inter-* 与 NotoSansSC-*） */
export type FontFamilyName = FontFamily[keyof FontFamily] | FontFamilyCjk[keyof FontFamilyCjk];

/** typography 十一档里实际出现过的字重 + UI V2 Hero 金额的 Light 300（RM / 小数） */
export type FontWeightKey = '300' | '400' | '500' | '600' | '700';

/** 字重 → Inter 家族（数字 / 拉丁文本） */
export const fontFamilyByWeight: Record<FontWeightKey, FontFamilyName> = {
  '300': fontFamily.light,
  '400': fontFamily.regular,
  '500': fontFamily.medium,
  '600': fontFamily.semiBold,
  '700': fontFamily.bold,
};

/** 字重 → Noto Sans SC 家族（含中文的文本） */
export const fontFamilyCjkByWeight: Record<FontWeightKey, FontFamilyName> = {
  '300': fontFamilyCjk.light,
  '400': fontFamilyCjk.regular,
  '500': fontFamilyCjk.medium,
  '600': fontFamilyCjk.semiBold,
  '700': fontFamilyCjk.bold,
};

/**
 * 打包拉丁字体（Inter）的字形范围：空白 + ASCII 可见字符 + Latin-1 + Latin Extended-A/B
 * + 常用标点 / 货币 / 箭头 / 上下标 / 数学符号。
 * ⚠ 纯函数，供 AppText 使用：返回 true 才套 Inter 家族名。
 */
const LATIN_SAFE_RE = /^[\s\u0020-\u007E\u00A0-\u024F\u2000-\u206F\u20A0-\u20BF\u2190-\u21FF\u2070-\u209F\u2200-\u22FF]*$/;

/** 这段文本能不能用打包的拉丁字体（Inter）：整段都是数字 / 拉丁字母 / 拉丁符号才 true（空串视为 true） */
export function canUseLatinText(text: string): boolean {
  return LATIN_SAFE_RE.test(text);
}

/**
 * 打包中文字体（Noto Sans SC）子集**确实有字形**的字符范围：上面的拉丁/标点范围，
 * 加上 CJK 标点（U+3000–3030）、汉字基本区（U+4E00–9FFF）、全角形式（U+FF00–FFEF）。
 * 范围必须与 pyftsubset 的字符集一致（_scratch/fonts/build_noto.py）—— 多写一个区段
 * 就会渲染成方框（豆腐块）。
 * ⚠ 假名、谚文、CJK 扩展 A/B、emoji、其他文种一律落在范围外 → 返回 false → 回退系统字体。
 */
const CJK_SAFE_RE = /^[\s\u0020-\u007E\u00A0-\u024F\u2000-\u206F\u20A0-\u20BF\u2190-\u21FF\u2070-\u209F\u2200-\u22FF\u3000-\u3030\u4E00-\u9FFF\uFF00-\uFFEF]*$/;

/** 这段文本能不能用打包的中文字体（Noto Sans SC 子集）：拉丁 + CJK 标点 + 汉字 + 全角才 true（空串视为 true） */
export function canUseCjkText(text: string): boolean {
  return CJK_SAFE_RE.test(text);
}

/** @deprecated 旧名保留兼容（T01b 时代为 Inter）；新代码用 canUseLatinText */
export const canUseInterText = canUseLatinText;