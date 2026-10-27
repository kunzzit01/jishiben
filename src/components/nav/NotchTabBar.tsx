// NotchTabBar.tsx
// 贴底通栏的底部导航底板：上边缘中央一段平滑凹弧，用来容纳中央圆形「+」按钮。
//
// 为什么单独抽一个组件：凹槽的几何必须和父级摆放圆钮时用的圆心/半径是同一套，
// 否则凹槽与圆钮之间会出现忽宽忽窄的缝。这里只画「底板 + 上边缘一条 hairline」，
// 不画圆钮、不画五个 Tab、不接导航 —— 圆钮和 tab 由父容器叠在上面。
//
// 规则
// - 颜色一律来自 useHomePalette()（tabBg / tabBorder），组件内零 hex；
// - 几何全部由 notchR / notchGap 推导，不写死像素，320 / 390 宽都是同一套曲线；
// - 凹槽与水平段的接缝走三次贝塞尔，两侧切线分别在接缝处与水平线、与圆弧相切（C1，无折角）。

import React, { useCallback, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useHomePalette } from '../../theme/homePalette';

/**
 * 圆钮圆心落在底栏上边缘下方的深度系数：cy = notchR × 该值。
 * 参考图实测（853×1844 截图 ÷ 2.187 得 dp）：圆钮半径 22.4dp、圆心在边缘下 16.9dp，
 * 16.9 / 22.4 ≈ 0.755 —— 圆钮只有顶上约 1/4 半径露出底栏，其余坐在凹槽里。
 */
const BUTTON_DROP_RATIO = 0.755;

/**
 * 凹槽裙摆：上边缘开口半宽 = 凹槽半径 + 该值。
 * 参考图实测半开口 49.5dp、凹槽半径 30.5dp → 裙摆 19dp；这里取 19，
 * 与「开口宽度 ≈ 2 ×（notchR + notchGap）+ 2 × 19」一致（贴参考图的开口宽度）。
 */
const NOTCH_FLARE = 19;

/**
 * 贝塞尔臂长系数：控制点沿接缝切线方向伸出「该方向跨度 × 该值」。
 * 0.26 是对参考图上边缘描边（逐列提取的 22 个点）做最小二乘拟合的结果；
 * 比常见的 0.55 小 —— 参考图这条曲线在两端转得急、中段接近斜直线。
 */
const KNEE_RATIO = 0.26;

type NotchGeometry = {
  width: number;
  height: number;
  /** 底栏水平中心（凹槽 / 圆钮共用的对称轴） */
  cx: number;
  /** 凹槽半径 = 圆钮半径 + 缝隙，与圆钮同心 */
  troughR: number;
  /** 圆钮圆心相对上边缘的深度（正数 = 在边缘下方） */
  cy: number;
  /** 上边缘开口半宽 */
  openHalf: number;
};

/** 数字进 d 属性前统一收敛：保留 2 位小数，顺带吃掉浮点噪声 */
function fmt(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

/** 上边缘与凹槽共用的几何；两个导出函数都从这里取，保证填充与描边严丝合缝 */
function notchGeometry(width: number, height: number, notchR: number, notchGap: number): NotchGeometry {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  const half = w / 2;
  const capR = Number.isFinite(notchR) ? Math.max(notchR, 0) : 0;
  const gap = Number.isFinite(notchGap) ? Math.max(notchGap, 0) : 0;
  // 兜底：极窄屏（凹槽比底栏还宽）时把凹槽半径收在半宽内，圆弧不会翻出底板
  const troughR = Math.min(capR + gap, half);
  const cy = capR * BUTTON_DROP_RATIO;
  // 裙摆不够位置时先收裙摆，保证两侧始终留有水平段（不会出现负宽度的 H 指令）
  const openHalf = Math.min(troughR + NOTCH_FLARE, half);
  return { width: w, height: h, cx: half, troughR, cy, openHalf };
}

/**
 * 上边缘命令序列（左 → 右）：水平 → 平滑凹入 → 凹槽半圆 → 平滑凹出 → 水平。
 * 填充路径与描边路径共用这一段：描边正好压在填充的上边缘上，下边缘和两侧不描边。
 */
function topEdgeCommands(g: NotchGeometry): string[] {
  const { cx, troughR, cy, openHalf, width } = g;
  // 贝塞尔两条臂长：水平方向按裙摆跨度取，垂直方向按圆心深度取
  const armX = KNEE_RATIO * (openHalf - troughR);
  const armY = KNEE_RATIO * cy;
  const commands = ['M 0 0', `H ${fmt(cx - openHalf)}`];

  if (troughR > 0) {
    commands.push(
      // 凹入：起点切线水平（接左侧水平段），终点切线垂直（接圆在水平直径处最宽点）
      `C ${fmt(cx - openHalf + armX)} 0 ${fmt(cx - troughR)} ${fmt(cy - armY)} ${fmt(cx - troughR)} ${fmt(cy)}`,
      // 凹槽半圆：从左最宽点经最低点 (cx, cy + troughR) 到右最宽点；sweep=0 = 向下绕
      `A ${fmt(troughR)} ${fmt(troughR)} 0 0 0 ${fmt(cx + troughR)} ${fmt(cy)}`,
      // 凹出：起点切线垂直（接圆弧），终点切线水平（接右侧水平段）
      `C ${fmt(cx + troughR)} ${fmt(cy - armY)} ${fmt(cx + openHalf - armX)} 0 ${fmt(cx + openHalf)} 0`
    );
  } else {
    // 凹槽半径为 0：退化成一条水平线（A 指令半径为 0 在 SVG 里非法）
    commands.push(`H ${fmt(cx + openHalf)}`);
  }

  commands.push(`H ${fmt(width)}`);
  return commands;
}

/** 只有上边缘（含凹槽）的开放路径，用来描那条 hairline */
function notchTopEdgePath(width: number, height: number, notchR: number, notchGap: number): string {
  return topEdgeCommands(notchGeometry(width, height, notchR, notchGap)).join(' ');
}

/** 生成底栏上边缘路径：左段水平 → 平滑凹入 → 围绕圆钮的凹槽 → 平滑凹出 → 右段水平 → 下边缘闭合 */
export function notchBarPath(width: number, height: number, notchR: number, notchGap: number): string {
  const geometry = notchGeometry(width, height, notchR, notchGap);
  const commands = topEdgeCommands(geometry);
  // 从上边缘右端垂直落到底边，再平移到左端闭合（底板贴死屏幕底，底边不描边）
  commands.push(`V ${fmt(geometry.height)}`, 'H 0', 'Z');
  return commands.join(' ');
}

/**
 * 底栏底板。绝对铺满父容器，父容器高度应当等于 height（上边缘即底栏上边缘）。
 * 只输出底色 + 上边缘描边；圆钮与 tab 由父级按同一组 notchR / notchGap 叠在上面。
 */
export function NotchTabBarSurface(props: {
  height: number;
  notchR: number;
  notchGap: number;
}): React.ReactElement {
  const { height, notchR, notchGap } = props;
  const palette = useHomePalette();
  const window = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);

  // 首帧先按窗口宽度画（不会闪一帧空白底板），onLayout 量到父容器真实宽度后再覆盖
  const width = measuredWidth > 0 ? measuredWidth : window.width;

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasuredWidth((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);

  const surfacePath = notchBarPath(width, height, notchR, notchGap);
  const edgePath = notchTopEdgePath(width, height, notchR, notchGap);

  return (
    <View style={StyleSheet.absoluteFill} onLayout={handleLayout} pointerEvents="none">
      <Svg width="100%" height={height}>
        <Path d={surfacePath} fill={palette.tabBg} />
        <Path d={edgePath} fill="none" stroke={palette.tabBorder} strokeWidth={1} />
      </Svg>
    </View>
  );
}
