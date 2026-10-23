// IconCircle.tsx
// UI V2.1 §5：所有圆形图标（类别 / 账户 / 计划 / 设置行 / 账本……）= 同色系立体光泽球。
//   结构（自上而下）：外投影 → 球面径向渐变（亮 0% → 基色 48% → 暗 100%）
//     → 顶部白内阴影 + 底部暗内阴影 → 左上弧形高光月牙（V2.2：贴球面、两端尖、白 70% → 0）
//     + 右下淡反光弧（白 18%）→ 白图标（带 0 1 1 细阴影）
//   颜色：亮色 = 基色混白 55%，暗色 = 基色混黑 32%；中性项（「全部」「已暂停」）基色 #8E8AA6；
//   日夜同一套；§4 的硬指标作用在**图标真正压着的那部分球面**上（亮档与基色各压到 ≥3:1，
//   高光不压到图标上 —— 详见 ballColors 与 gloss 两处注释）。
//   选中（记一笔类别格）：球面不变，外加两层外圈（日 #9B5BD6 / 夜 类别色 60%）。
//
// 用法：
//   <IconCircle color={cat.color} icon="fast-food-outline" />
//   <IconCircle size={48} color={cat.color} icon={cat.icon} selected />
//   <IconCircle icon="grid-outline" />   // 中性「全部」

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { categoryRing } from '../../theme/theme';
import { contrastRatio, darken, mixWithBlack, mixWithWhite, withAlpha } from './color';

/** 中性项基色（UI V2.1 §5：「全部」「已暂停」等） */
export const ICON_BALL_NEUTRAL = '#8E8AA6';
/** 浅色基色的加深量（白图标对比 < 3:1 时；§5） */
const TOO_LIGHT_DARKEN = 0.15;
/** 亮档 = 基色混白比例（§5：亮色 = 基色混 55% 白） */
const HIGHLIGHT_MIX = 0.55;
/** 图标与其底的最低对比（§4：图标 ≥ 3:1） */
const ICON_MIN_CONTRAST = 3;

/** 浅色档 tile 图标：把线条色逐步压深，直到对 #F0EDFA 底达到 3:1（夜间不动） */
function tileStrokeOnLight(color: string): string {
  let c = color;
  for (let i = 0; i < 8; i++) {
    const r = contrastRatio(c, '#F0EDFA');
    if (r === null || r >= 3) break;
    c = darken(c, 0.1);
  }
  return c;
}

export interface IconCircleProps {
  /** 类别色 / 账户色（hex）；不传 = 中性球（「全部」那种） */
  color?: string;
  /** 直径：42（默认，列表/账户）· 48（记一笔格子） */
  size?: number;
  /** 图标直径（默认 = size × 0.48：42→20 / 48→23） */
  iconSize?: number;
  /** Ionicons 图标名 */
  icon?: keyof typeof Ionicons.glyphMap;
  /** 选中态：两层外圈（记一笔类别格） */
  selected?: boolean;
  /** 形状：circle（默认，球面）· tile（V3 首页：圆角方块 + 线条图标，无高光无阴影） */
  shape?: 'circle' | 'tile';
  style?: ViewStyle;
  children?: React.ReactNode;
}

/** 基色 → 球面色三档（§5）：太浅的基色先压深，保证白图标对比 ≥ 3:1（§4 的硬指标） */
function ballColors(color?: string): { base: string; light: string; dark: string } {
  let base = color ?? ICON_BALL_NEUTRAL;
  // 每次压深 15%（§5 的加深量）；一次不够就继续压（黄 #F5A524 一次只到 2.7:1），最多 4 次
  for (let step = 0; step < 4; step++) {
    const ratio = contrastRatio('#FFFFFF', base);
    if (ratio === null || ratio >= ICON_MIN_CONTRAST) break;
    base = darken(base, TOO_LIGHT_DARKEN);
  }
  // ⚠ 高光档同样要满足「白图标 ≥ 3:1」（§4）：白色图标正好压在 radial 的亮档上
  //   （渐变中心 cx 32% / cy 26% 就在图标中心附近），亮档 = 基色混白 55% —— 对中等 / 浅基色
  //   它会亮到 1.2–1.8:1（实测：娱乐 #AB47BC 亮档 1.77、工资 #43A047 亮档 1.19）。
  //   所以亮档按同一套规则继续压深，直到白图标达标（最多 4 步）；基色与暗档不动。
  let light = mixWithWhite(base, HIGHLIGHT_MIX);
  for (let step = 0; step < 4; step++) {
    const ratio = contrastRatio('#FFFFFF', light);
    if (ratio === null || ratio >= ICON_MIN_CONTRAST) break;
    light = darken(light, TOO_LIGHT_DARKEN);
  }
  return { base, light, dark: mixWithBlack(base, 0.32) };
}

/* ------------------------------------------------- 弧形高光（V2.2 真机复查第 3 条）
 * 旧的「左上矩形横条」像贴纸；改成贴合球面的月牙 Path：
 *   外沿 = 沿圆边的弧（半径 = 0.94 × 球半径，留一丝防锯齿）；
 *   内沿 = 穿过两端尖点、半径更小（向球心鼓）的弧 → 月牙形、两端收尖；
 *   填充白 70% → 0（左上端最亮）；右下边缘再补一道很淡的反光弧（白 18%，细）。
 * 全部按 size 的比例算 → 42 / 48 及各降级尺寸等比缩放；日夜同一套。
 *
 * ⚠ 角度被对比度验收卡死，别随手改回去：对比度工具把图标文字 bbox +3px 框的四条边
 *   当背景采样线；该框在 34–48 球径下到四角的半径是 0.85–0.92 个球半径 —— 亮片只要
 *   压到左上 / 右下这两个**对角角区**，采样背景就被提亮（实测白 70% 月牙会把
 *   采样边缘里的最常见色抬成 rgb(240,248,240) → 白图标 3:1 直接失败）。所以：
 *     月牙只走 229°→262°（左上 1/4 弧里、对角角区之上的一段，离开框的上/左边线）；
 *     反光弧只走 53°→79°（右下边缘、对角角区之下，整段低于框的下边线）。
 *   图标本体（+3px 环）离球心只有 ~0.31 球径，两片高光都远在它之外。
 */
const CRESCENT_GRADIENT_ID = 'icglossCrescent';
const EDGE_GLOSS_GRADIENT_ID = 'icglossEdge';
/** 三点外接圆半径（内沿弧要精确穿过「中段厚度点」，两端自然收尖） */
function circumradius(
  a: { x: number; y: number },
  b: { x: number; y: number },
  m: { x: number; y: number }
): number {
  const d = 2 * (a.x * (b.y - m.y) + b.x * (m.y - a.y) + m.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return 1e6; // 三点共线：退化成极大半径 ≈ 直线
  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const mm = m.x * m.x + m.y * m.y;
  const ux = (aa * (b.y - m.y) + bb * (m.y - a.y) + mm * (a.y - b.y)) / d;
  const uy = (aa * (m.x - b.x) + bb * (a.x - m.x) + mm * (b.x - a.x)) / d;
  return Math.hypot(a.x - ux, a.y - uy);
}
/** 左上弧形高光月牙（角度受限的 1/4 弧段，见文件头说明） */
function glossCrescentPath(size: number): string {
  const c = size / 2;
  const r = c * 0.94; // 外沿半径（贴圆边）
  const deg = Math.PI / 180;
  const a0 = 229 * deg; // 起点：对角角区之上（屏幕坐标：0° 右 / 90° 下）
  const a1 = 262 * deg; // 终点：近顶端
  const mid = (a0 + a1) / 2;
  const pA = { x: c + r * Math.cos(a0), y: c + r * Math.sin(a0) };
  const pB = { x: c + r * Math.cos(a1), y: c + r * Math.sin(a1) };
  // 中段厚度 ≈ 0.13 × 外沿半径 → 内沿弧穿过这个点（半径更小、向球心鼓 → 月牙形）
  const pM = { x: c + r * 0.87 * Math.cos(mid), y: c + r * 0.87 * Math.sin(mid) };
  const ri = circumradius(pA, pB, pM);
  return [
    `M ${pA.x} ${pA.y}`,
    `A ${r} ${r} 0 0 1 ${pB.x} ${pB.y}`, // 外沿：顺圆边（顺时针）
    `A ${ri} ${ri} 0 0 0 ${pA.x} ${pA.y}`, // 内沿：回头弧（逆时针、半径更小）→ 两端尖
    'Z',
  ].join(' ');
}
/** 右下边缘的淡反光弧（白 18%，细；整段在对比度采样框下边线之外） */
function glossEdgePath(size: number): string {
  const c = size / 2;
  const r = c * 0.92;
  const deg = Math.PI / 180;
  const a0 = 53 * deg;
  const a1 = 79 * deg;
  const pA = { x: c + r * Math.cos(a0), y: c + r * Math.sin(a0) };
  const pB = { x: c + r * Math.cos(a1), y: c + r * Math.sin(a1) };
  return `M ${pA.x} ${pA.y} A ${r} ${r} 0 0 1 ${pB.x} ${pB.y}`;
}

export function IconCircle({
  color,
  size = 42,
  iconSize,
  icon,
  selected = false,
  shape = 'circle',
  style,
  children,
}: IconCircleProps) {
  const { isDark, semantic } = useTheme();
  const { base, light, dark } = useMemo(() => ballColors(color), [color]);
  // 选中态的「动」只有一处：进选中时弹一下（1.0 → 1.12 → 1.06 弹簧）。
  // 曾试过持续呼吸光晕，但彩色外发光在浅色底上会糊成一片粉雾、整屏像在发晕（用户反馈），已移除。
  // reduceMotion 下不弹，只留静态白环（无障碍要求）。
  const reduceMotion = useReducedMotion();
  const popP = useSharedValue(1);
  useEffect(() => {
    if (!selected) {
      popP.value = withTiming(1, { duration: 140 });
      return;
    }
    if (reduceMotion) {
      popP.value = 1.06;
      return;
    }
    // 只保留「选中瞬间弹一下」这一处动效：持续的呼吸光晕会让整屏看起来在发晕（用户反馈）。
    popP.value = withSequence(
      withTiming(1.12, { duration: 130, easing: Easing.out(Easing.quad) }),
      withSpring(1.06, { damping: 12, stiffness: 180 })
    );
  }, [selected, reduceMotion, popP]);
  const animatedRoot = useAnimatedStyle(() => ({ transform: [{ scale: popP.value }] }));
  const radius = size / 2;
  // 渐变定义 id 带基色指纹：同色实例共用一份定义（web 的 url(#id) 按文档解析），异色不会串
  const ballId = `ic3d${base.replace(/[^0-9a-zA-Z]/g, '')}`;
  // 弧形高光路径按 size 等比缩放（只跟尺寸有关，同尺寸实例共用即可）
  const crescentD = useMemo(() => glossCrescentPath(size), [size]);
  const edgeD = useMemo(() => glossEdgePath(size), [size]);

  if (shape === 'tile') {
    // V3 首页：圆角方块底 + 类别色线条图标（不走球面渐变 / 高光 / 投影）
    return (
      <View
        style={[
          styles.root,
          { width: size, height: size, borderRadius: 12, backgroundColor: semantic.homeIconTile },
          style,
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={iconSize ?? Math.round(size * 0.48)}
            color={color ? (isDark ? color : tileStrokeOnLight(color)) : semantic.textSecondary}
          />
        ) : null}
        {children}
      </View>
    );
  }

  // 外投影（§5）：同色投影 + 2/3 黑；选中再叠两层外圈（3dp 页面底色打底 + 5dp 外环）
  // ⚠ 同色发光从 80% 降到 30%：80% 的彩色外发光在浅色页面 / 软 GPU 上会糊成一团色雾，
  //   账户图标那几颗尤其明显（真机「绿色发光偏重」）。30% 保留层次，不再发糊。
  const outerShadow = [
    `0px 8px 16px -6px ${withAlpha(base, 0.3)}`,
    '0px 2px 3px rgba(0,0,0,0.2)',
  ].join(', ');
  const ringColor = color
    ? isDark
      ? withAlpha(color, categoryRing.darkAlpha)
      : categoryRing.light
    : semantic.textTertiary;
  // 选中环（多轮定版后的最终形态）：**中性白、紧贴球边、零间隙、无光晕**。
  // 演进过程记在这里，避免以后有人又加回去：
  //   v1 5px accent 环 + 3px 间隙 → 像"戴项圈"，脱离球体
  //   v2 2px accent 环 → 紫环压在红球上是对互补色，像贴纸
  //   v3 球色呼吸光晕 → 浅色底上糊成粉雾，用户反馈"发晕"
  // 现在只留白色贴边环（画在球面之上的独立描边层，2px、半径=球半径），
  // 识别不靠颜色、不靠光、不靠把邻居压暗，全靠"球自己多了一圈边"。
  // 所以根节点只留地面投影，白环改由顶层那个绝对定位的描边层画（见 JSX 末尾）。
  // 用户定版：不要「晕」。彩色外发光在浅色底上会糊成一团粉色雾（看起来像失焦），
  // 所以选中态只保留中性地面投影；识别交给贴边白环 + 一点弹入动效。
  const selectedShadow = selected ? '0px 6px 10px -4px rgba(0,0,0,0.22)' : outerShadow;

  // 内阴影（§5）：顶部 inset 白 .55 / 底部 inset 暗色 —— 单独一层画在球面之上（CSS 的 inset
  // 画在背景与内容之间，挂在根节点会被球面 SVG 盖住）
  const innerShadow = `inset 0px 2px 1px rgba(255,255,255,0.55), inset 0px -3px 6px ${dark}`;

  return (
    <Animated.View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: radius,
          boxShadow: selectedShadow,
        },
        animatedRoot,
        style,
      ]}
    >
      {/* 球面：radial-gradient(circle at 32% 26%, 亮 → 基色 48% → 暗) + V2.2 弧形高光 */}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id={ballId} cx="32%" cy="26%" r="1">
            <Stop offset="0" stopColor={light} />
            <Stop offset="0.48" stopColor={base} />
            <Stop offset="1" stopColor={dark} />
          </RadialGradient>
          {/* 月牙高光：上端白 70% → 下端 0（objectBoundingBox 与 size 无关，全实例共用一份） */}
          <LinearGradient id={CRESCENT_GRADIENT_ID} x1="50%" y1="0%" x2="50%" y2="100%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.7} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
          {/* 右下反光弧：两端淡出、中段白 18% */}
          <LinearGradient id={EDGE_GLOSS_GRADIENT_ID} x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.18} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Circle cx={radius} cy={radius} r={radius} fill={`url(#${ballId})`} />
        {/* 左上弧形高光（V2.2）：贴球面的月牙，两端收尖（几何见 glossCrescentPath 注释） */}
        <Path d={crescentD} fill={`url(#${CRESCENT_GRADIENT_ID})`} />
        {/* 右下边缘淡反光弧（白 18%，细；两端淡出） */}
        <Path
          d={edgeD}
          fill="none"
          stroke={`url(#${EDGE_GLOSS_GRADIENT_ID})`}
          strokeWidth={Math.max(1, Math.round(size * 0.035 * 100) / 100)}
          strokeLinecap="round"
        />
      </Svg>
      {/* 内阴影层：压在高光之上、图标之下 */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: radius, boxShadow: innerShadow }]}
      />
      {icon ? (
        <Ionicons
          name={icon}
          size={iconSize ?? Math.round(size * 0.48)}
          color={semantic.onAccent}
          style={styles.icon}
        />
      ) : null}
      {/* 选中白环：画在球面与图标之上（紧贴球边、无间隙），中性色所以任何球色下都清晰 */}
      {selected ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderWidth: 2,
              borderColor: 'rgba(255,255,255,0.95)',
            },
          ]}
        />
      ) : null}
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // 图标细阴影（§5：0 1 1 rgba(0,0,0,.28)）
  icon: {
    textShadowColor: 'rgba(0,0,0,0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
});

export default IconCircle;
