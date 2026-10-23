// useTheme.ts
import {
  lightColors,
  darkColors,
  ThemeColors,
  lightSemantic,
  darkSemantic,
  SemanticColors,
  typography,
  Typography,
  spacing,
  Spacing,
  layout,
  Layout,
  radius,
  Radius,
  lightElevation,
  darkElevation,
  Elevation,
  fontFamily,
  FontFamily,
  fontFamilyByWeight,
  fontFamilyCjk,
  fontFamilyCjkByWeight,
  FontWeightKey,
  FontFamilyName,
  gradients,
  heroFade,
  heroGrid,
  lightGlass,
  darkGlass,
  GlassToken,
  glassPill,
  tabBarShadow,
  centerButtonShadow,
  HeroGradientToken,
  LinearGradientToken,
} from './theme';
import { useMotion, MotionTokens } from './motion';
import { useSystemColorScheme } from './useSystemColorScheme';
import { useThemeMode } from '../context/ThemeModeContext';

/** useTheme() 的完整返回：颜色（旧层 + 新语义层）与设计系统令牌（字号 / 间距 / 圆角 / 阴影 / 动效） */
export interface AppTheme {
  isDark: boolean;
  /** 旧颜色层（兼容期保留，页面逐步迁移到 semantic） */
  colors: ThemeColors;
  /** 语义颜色层（计划 4.1）—— 新代码只用它 */
  semantic: SemanticColors;
  /** 字号层（计划 4.2） */
  typography: Typography;
  /** 间距层（计划 4.3，8pt 网格） */
  spacing: Spacing;
  /** 页面级固定尺寸：页边距 / 卡内边距 / 分组间距 / 列表行最小高 */
  layout: Layout;
  /** 圆角层（6 档） */
  radius: Radius;
  /** 阴影层（level0/1/2，跨平台 boxShadow） */
  elevation: Elevation;
  /** 动效层（弹簧 / 时长 / 缓动 / 按压缩放；含减弱动态效果降级） */
  motion: MotionTokens;
  /** 打包字体层（V2.2c）：4 档 Inter 家族名（数字 / 拉丁文本） */
  fontFamily: FontFamily;
  /** 字重 → Inter 家族映射（键 = typography 各档的 fontWeight 值） */
  fontFamilyByWeight: Record<FontWeightKey, FontFamilyName>;
  /** 打包中文字体层（V2.2c）：3 档 Noto Sans SC 子集家族名（含中文的文本） */
  fontFamilyCjk: typeof fontFamilyCjk;
  /** 字重 → Noto Sans SC 家族映射（600 落到 Bold：中文只有 400/500/700） */
  fontFamilyCjkByWeight: Record<FontWeightKey, FontFamilyName>;
  /** UI V2 品牌渐变（第 1 节）：heroDark / heroLight（主渐变 + 光斑）、accent */
  gradients: {
    heroDark: HeroGradientToken;
    heroLight: HeroGradientToken;
    accent: LinearGradientToken;
    /** 键盘「完成」键渐变（紫 → 亮紫） */
    keyConfirm: LinearGradientToken;
    /** 跟随当前主题的 hero 渐变（= isDark ? heroDark : heroLight） */
    hero: HeroGradientToken;
  };
  /** UI V2 玻璃材质（第 1 节）：已按当前主题解析好 */
  glass: GlassToken;
  /** 玻璃上的白色选中胶囊（分段控件用）：fill = 胶囊底、text = 选中字色、muted = 未选中字色 */
  glassPill: { fill: string; text: string; muted: string };
  /** Hero 渐变底部淡出参数（50% 起淡、92% 实底 bg） */
  heroFade: typeof heroFade;
  /** Hero 网格线（26dp，白 6% 夜 / 12% 日） */
  heroGrid: { color: string; size: number; fadeFrom: number; fadeTo: number };
  /** 悬浮 Tab 栏栏身投影（UI V2） */
  tabBarShadow: string;
  /** 中央「+」圆钮的柔和投影（UI V2） */
  centerButtonShadow: string;
}

// override参数保留：极少数需要强制显示某个主题的场景可以用（比如某个截图/预览）。
// 正常页面不传override，会自动读取"设置项"里保存的深色模式偏好：
//   跟随系统 -> 用手机当前的系统外观
//   始终亮色 / 始终暗色 -> 忽略系统外观，固定用这个
export function useTheme(override?: 'light' | 'dark'): AppTheme {
  // ⚠ 不用 RN 自带的 useColorScheme()：它在 react-native-web 下不跟随系统变化（见 useSystemColorScheme.ts 头注释）
  const systemScheme = useSystemColorScheme(); // 'light' | 'dark'
  const { themeMode } = useThemeMode();
  const motion = useMotion();

  const resolvedMode: 'light' | 'dark' =
    override ?? (themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : themeMode);
  const isDark = resolvedMode === 'dark';

  return {
    isDark,
    colors: isDark ? darkColors : lightColors,
    semantic: isDark ? darkSemantic : lightSemantic,
    typography,
    spacing,
    layout,
    radius,
    elevation: isDark ? darkElevation : lightElevation,
    motion,
    fontFamily,
    fontFamilyByWeight,
    fontFamilyCjk,
    fontFamilyCjkByWeight,
    gradients: {
      heroDark: gradients.heroDark,
      heroLight: gradients.heroLight,
      // 品牌渐变按主题解析（tokens: brand.gradientFrom/To 日夜各一套）
      accent: isDark ? gradients.brandDark : gradients.brandLight,
      keyConfirm: gradients.keyConfirm,
      hero: isDark ? gradients.heroDark : gradients.heroLight,
    },
    glass: isDark ? darkGlass : lightGlass,
    glassPill: isDark ? glassPill.dark : glassPill.light,
    heroFade,
    heroGrid: {
      color: isDark ? heroGrid.dark : heroGrid.light,
      size: heroGrid.size,
      fadeFrom: heroGrid.fadeFrom,
      fadeTo: heroGrid.fadeTo,
    },
    tabBarShadow: isDark ? tabBarShadow.dark : tabBarShadow.light,
    centerButtonShadow: isDark ? centerButtonShadow.dark : centerButtonShadow.light,
  };
}
