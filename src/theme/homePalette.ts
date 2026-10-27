// homePalette.ts
// 首页（含底部导航）专用配色层 —— 2026-10 视觉重构的唯一色彩来源。
//
// 为什么不复用 semantic：本轮参考图（冰蓝白 / 深午夜蓝）是一次面向首页的定向视觉改版，
// 其余页面仍走 semantic（紫系）。把两套混在 theme.ts 的 SemanticColors 里会让
// 每个页面都得判断自己用哪套；这里独立成一个模块，首页子树静态 import 即可。
//
// 规则：
// 1. 首页 / 底栏组件内 **不得出现任何 hex 字面量**，一律从 useHomePalette() 取。
// 2. 新增颜色必须 light / dark 双值，并在此文件顶部补一行注释说明用途。
// 3. 取值来自参考图像素采样（design/reference/home-day.png / home-night.png），
//    不是拍脑袋：日 #F5FAFF 页底、卡片近白微蓝；夜 #020E22 页底、资产卡 #1257B6→#0A2A66 渐变。

import { useTheme } from './useTheme';

export type HomePalette = {
  // ── 页面
  pageBg: string;          // 页面底色
  glowStrong: string;      // 顶部右侧光场核心色
  glowSoft: string;        // 光场渐隐色
  scrim: string;           // 弹层遮罩

  // ── 面
  surface: string;         // 普通卡片面
  surfaceSunken: string;   // 下沉面（分类图标底、药丸底）
  panel: string;           // 汇总 / 列表大面板面
  hairline: string;        // 1px 分隔线
  border: string;          // 卡片描边

  // ── 文字
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  // ── 强调
  brand: string;           // 主蓝（选中态 / 链接 / 进度）
  brandSoft: string;       // 主蓝淡底
  cyan: string;            // 青色收尾高光

  // ── 语义
  income: string;
  expense: string;
  incomeSoft: string;
  expenseSoft: string;

  // ── 资产卡（文件夹造型）
  cardFillTop: string;     // 卡面渐变起点
  cardFillBottom: string;  // 卡面渐变终点
  cardEdge: string;        // 轮廓描边
  cardShadow: string;      // 投影（克制，不靠外发光）
  cardText: string;        // 卡上主文字
  cardTextMuted: string;   // 卡上次要文字
  deckBack1: string;       // 后方第一层错位底卡
  deckBack2: string;       // 后方第二层错位底卡
  trackBg: string;         // 进度条轨道
  progressFrom: string;
  progressTo: string;

  // ── 快捷圆形
  quickCircleBg: string;
  quickCircleBorder: string;
  quickIconPrimary: string;   // 深色描边（图标主笔）
  quickIconSecondary: string; // 浅色填充（图标副笔）

  // ── 底部导航（中央凹槽）
  tabBg: string;
  tabBorder: string;
  tabActive: string;
  tabInactive: string;
  fabBg: string;
  fabIcon: string;
  fabGlow: string;
};

/** V2 资产卡（Asset_Card_Reference_v2）色彩令牌：日/夜两套，值原样取自包的 asset-card.css */
export type AssetCardColors = {
  text: string; muted: string; icon: string;
  face1: string; face2: string; face3: string;
  backA: string; backB: string; backStroke: string;
  rim: string; shine: string; track: string;
  blue: string; cyan: string; shadow: string;
  /** 中心十字光不透明度（包里的 --ac-center-light） */
  centerLight: number;
  selected: string; dot: string;
};

const assetLight: AssetCardColors = {
  text: '#071B49', muted: '#49648A', icon: '#17366A',
  face1: '#F4FAFF', face2: '#F0F8FE', face3: '#EDF8FE',
  backA: '#C8ECFF', backB: '#C5E1FF', backStroke: '#A9DCFF',
  rim: '#ACD9FF', shine: '#FFFFFF', track: '#CDDDF1',
  blue: '#127AFF', cyan: '#10C9E6', shadow: 'rgba(45,143,226,0.15)',
  centerLight: 0.52, selected: '#147CFF', dot: '#A8CCFA',
};

const assetDark: AssetCardColors = {
  text: '#F5F9FF', muted: '#B2C8E8', icon: '#C1DCFF',
  face1: '#2676C8', face2: '#143E79', face3: '#082149',
  backA: '#1161A8', backB: '#174584', backStroke: '#1760A4',
  rim: '#75B9F5', shine: '#CCE7FF', track: '#284F88',
  blue: '#208DFF', cyan: '#1DD6ED', shadow: 'rgba(0,5,25,0.28)',
  centerLight: 0.07, selected: '#EDF7FF', dot: '#43668F',
};

const light: HomePalette = {
  pageBg: '#F5FAFF',
  glowStrong: '#D9EFFE',
  glowSoft: '#F2F9FF',
  scrim: 'rgba(7,28,73,0.18)',

  surface: '#FFFFFF',
  surfaceSunken: '#EAF4FF',
  panel: '#FFFFFF',
  hairline: 'rgba(7,28,73,0.08)',
  border: 'rgba(22,119,255,0.12)',

  textPrimary: '#071C49',
  textSecondary: '#52698D',
  textTertiary: '#8397B4',

  brand: '#1677FF',
  brandSoft: '#E8F2FF',
  cyan: '#12C7E8',

  income: '#00A88A',
  expense: '#EF655D',
  incomeSoft: '#E4F7F2',
  expenseSoft: '#FDECEA',

  cardFillTop: '#F4FAFF',
  cardFillBottom: '#FFFFFF',
  cardEdge: 'rgba(150,190,240,0.55)',
  cardShadow: 'rgba(23,74,150,0.10)',
  cardText: '#071C49',
  cardTextMuted: '#52698D',
  deckBack1: 'rgba(226,240,255,0.92)',
  deckBack2: 'rgba(214,232,255,0.80)',
  trackBg: '#CADEF5',
  progressFrom: '#1677FF',
  progressTo: '#12C7E8',

  quickCircleBg: '#EAF4FF',
  quickCircleBorder: 'rgba(22,119,255,0.14)',
  quickIconPrimary: '#0B2E7A',
  quickIconSecondary: '#1677FF',

  tabBg: '#FFFFFF',
  tabBorder: 'rgba(7,28,73,0.07)',
  tabActive: '#1677FF',
  tabInactive: '#7C90AE',
  fabBg: '#1677FF',
  fabIcon: '#FFFFFF',
  fabGlow: 'rgba(22,119,255,0.28)',
};

const dark: HomePalette = {
  pageBg: '#020E22',
  glowStrong: '#0846B0',
  glowSoft: '#03122E',
  scrim: 'rgba(0,4,14,0.60)',

  surface: '#0A1A32',
  surfaceSunken: '#10264A',
  panel: '#0A1830',
  hairline: 'rgba(166,187,221,0.14)',
  border: 'rgba(120,180,255,0.18)',

  textPrimary: '#F4F8FF',
  textSecondary: '#A6BBDD',
  textTertiary: '#6F86AB',

  brand: '#1685FF',
  brandSoft: 'rgba(22,133,255,0.18)',
  cyan: '#16C8EA',

  income: '#39DDB9',
  expense: '#FF796D',
  incomeSoft: 'rgba(57,221,185,0.14)',
  expenseSoft: 'rgba(255,121,109,0.14)',

  cardFillTop: '#1257B6',
  cardFillBottom: '#0A2A66',
  cardEdge: 'rgba(140,195,255,0.30)',
  cardShadow: 'rgba(0,0,0,0.55)',
  cardText: '#FFFFFF',
  cardTextMuted: 'rgba(212,230,255,0.78)',
  deckBack1: 'rgba(14,52,110,0.85)',
  deckBack2: 'rgba(10,38,84,0.70)',
  trackBg: 'rgba(255,255,255,0.20)',
  progressFrom: '#26B8FD',
  progressTo: '#7DE3FF',

  quickCircleBg: '#10264A',
  quickCircleBorder: 'rgba(120,180,255,0.20)',
  quickIconPrimary: '#A8CDFF',
  quickIconSecondary: '#3FD0F5',

  tabBg: '#0A1A32',
  tabBorder: 'rgba(166,187,221,0.12)',
  tabActive: '#2CADFE',
  tabInactive: '#8FA6C8',
  fabBg: '#1685FF',
  fabIcon: '#FFFFFF',
  fabGlow: 'rgba(22,133,255,0.45)',
};

export const homePalette: { light: HomePalette; dark: HomePalette } = { light, dark };

/** 按当前主题取首页配色。跟随设置项的主题偏好（system / light / dark）。 */
export function useHomePalette(): HomePalette {
  const { isDark } = useTheme();
  return isDark ? dark : light;
}

/** 按当前主题取 V2 资产卡配色 */
export function useAssetCardColors(): AssetCardColors {
  const { isDark } = useTheme();
  return isDark ? assetDark : assetLight;
}
