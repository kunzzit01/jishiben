// HeroGradient.tsx
// UI V2.1 §1：页面背景渐变（全 App 页面共用，不要在页面里各写一份）。
// 默认块高模式（旧页面的 hero 顶部块）；新页面一律用 fill 铺满整页，卡片直接浮在渐变上。
//
// 组成（自上而下 4 层，全部 pointerEvents="none"）：
//   1. 主线性渐变（165°；令牌 gradients.heroDark / heroLight）
//   2. 3 个径向光斑（SVG RadialGradient；原生端用 rx/ry 做椭圆，web 回退圆）
//   3. 26dp 网格线（可选，首页用；白色 6% 夜 / 12% 日，30% 处起向下淡出，Mask 实现）
//   4. 底部淡出层（块高模式专用：从渐变高度 50% 处 → 92% 处已是实底 bg；fill 模式没有这层）
//
// 用法（放在页面最外层容器的第一个子节点）：
//   <View style={{ flex: 1 }}>
//     <HeroGradient fill />
//     ...页面内容
//   </View>
//
// ⚠ 块高模式的数值按 UI V2 定稿：首页 580 · 记一笔 400 · 资产 440 · 统计 460 · 设置 360（844 高屏；
//   矮屏 ×0.9），渐变不能盖住第一张内容卡的文字。fill 模式不受此限。
// ⚠ RNSVG 原生端两个坑（真机踩过、勿回退）：
//   1) <Stop> 不认 stopColor 里的 rgba alpha —— 一律拆成 stopColor + stopOpacity；
//   2) 渐变定义 id 必须带主题指纹（调色板变化即换 id），否则同实例切主题后原生端沿用旧定义。

import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, G, Mask, Path, RadialGradient, Rect, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { gradientAxis, pageWashAlpha } from '../../theme/theme';
import { withAlpha } from './color';

export interface HeroGradientProps {
  /** 'dark' | 'light' 显式指定；省略 = 跟随当前主题 */
  variant?: 'dark' | 'light';
  /** 渐变块高度（dp）；fill=true 时忽略 */
  height?: number;
  /** UI V2.1 §1：铺满整页（top:0; bottom:0），不再淡出成纯色底 —— 页面所有卡片浮在渐变上 */
  fill?: boolean;
  /** 网格线（UI V2：首页额外有 26dp 网格线） */
  grid?: boolean;
  style?: ViewStyle;
}

/** '#rrggbb' / 'rgba(...)' → { color: 'rgb(...)' 或 hex, opacity }（RNSVG 原生端 alpha 必须拆开写） */
function splitColorAlpha(c: string): { color: string; opacity: number } {
  const m = /^rgba?\(([^)]+)\)$/.exec(c.trim());
  if (!m) return { color: c, opacity: 1 };
  const parts = (m[1] ?? '').split(',').map((p) => p.trim());
  const [r, g, b] = parts;
  const a = parts.length > 3 ? Number(parts[3]) : 1;
  return { color: `rgb(${r},${g},${b})`, opacity: Number.isFinite(a) ? a : 1 };
}

/** '#rrggbb' → 同色 alpha 0 的 rgba（淡出层的起点色） */
function transparentOf(hexColor: string): string {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return 'rgba(0,0,0,0)';
  return `rgba(${r},${g},${b},0)`;
}

export function HeroGradient({ variant, height, fill = false, grid = false, style }: HeroGradientProps) {
  const { isDark, gradients, semantic, heroFade, heroGrid } = useTheme();
  const spec = variant === 'dark' ? gradients.heroDark : variant === 'light' ? gradients.heroLight : gradients.hero;
  const blockHeight = height ?? 0;

  // fill 模式（整页铺底）= Hero 起点的极淡薄层融进 bg.page：
  // 页面底色仍然是 tokens 的 bg.page，卡片面（surface）与之对比度不变；
  // 两个端点都由 semantic 推导，日夜两套自动跟着走。
  const wash = useMemo(
    () => ({
      colors: [
        withAlpha(semantic.heroFrom, pageWashAlpha.from),
        withAlpha(semantic.heroTo, pageWashAlpha.mid),
        semantic.bg,
      ] as readonly [string, string, string],
      locations: [0, 0.45, 1] as number[],
    }),
    [semantic.heroFrom, semantic.heroTo, semantic.bg]
  );
  const mainSpec = fill ? wash : spec;

  // SVG（光斑 / 网格）需要实测尺寸：百分比在 Mask / 原生端不稳，全部用数值
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    const w = Math.round(width);
    const hh = Math.round(h);
    if (w > 0 && hh > 0 && (w !== box.w || hh !== box.h)) setBox({ w, h: hh });
  };

  // 主题指纹：调色板变了就换 id（原生端同 id 的渐变定义不保证随 props 重建）
  const paletteKey = spec.colors.join('|').replace(/[^0-9a-zA-Z]/g, '');
  // 主渐变轴：按实测宽高把 CSS 角度（160°）换算成 start/end，角度不随块高漂移
  const axis = useMemo(
    () => (box.w > 0 ? gradientAxis(spec.angle, box.w, box.h) : { start: spec.start, end: spec.end }),
    [spec, box.w, box.h]
  );
  const blobIds = useMemo(
    () => spec.blobs.map((b, i) => `heroBlob${i}${paletteKey}${b.color.replace(/[^0-9a-zA-Z]/g, '')}`),
    [spec, paletteKey]
  );
  const gridMaskId = `heroGridMask${paletteKey}`;
  const gridFadeId = `heroGridFade${paletteKey}`;

  const gridLines = useMemo(() => {
    if (!grid || box.w <= 0 || box.h <= 0) return null;
    const verticals: string[] = [];
    for (let x = heroGrid.size; x < box.w; x += heroGrid.size) verticals.push(`M${x},0 V${box.h}`);
    const horizontals: string[] = [];
    for (let y = heroGrid.size; y < box.h; y += heroGrid.size) horizontals.push(`M0,${y} H${box.w}`);
    return [...verticals, ...horizontals].join(' ');
  }, [grid, box, heroGrid.size]);

  const fadeTop = Math.round(blockHeight * heroFade.startFraction);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.root,
        // fill：铺满整页（父容器 flex:1 时 top/bottom 都贴边）；否则固定块高
        fill ? styles.fill : { height: blockHeight },
        style,
      ]}
      onLayout={onLayout}
    >
      {/* 1. 主线性渐变（fill = 页面底薄层；块高模式 = Hero 主渐变 tokens: heroFrom/heroTo） */}
      <LinearGradient
        colors={mainSpec.colors}
        locations={mainSpec.locations as [number, number, ...number[]]}
        start={axis.start}
        end={axis.end}
        style={StyleSheet.absoluteFill}
      />

      {/* 2. 径向光斑 + 3. 网格线（同一张 SVG，实测尺寸后渲染）
          fill 模式不画光斑：整页薄底上叠光斑会与新 bg.page 打架 */}
      {box.w > 0 && !fill ? (
        <Svg width={box.w} height={box.h} style={StyleSheet.absoluteFill}>
          <Defs>
            {spec.blobs.map((blob, i) => {
              const { color, opacity } = splitColorAlpha(blob.color);
              return (
                <RadialGradient
                  key={blobIds[i]}
                  id={blobIds[i]}
                  cx={`${blob.cx * 100}%`}
                  cy={`${blob.cy * 100}%`}
                  rx={`${blob.rx * 100}%`}
                  ry={`${blob.ry * 100}%`}
                  r={`${Math.round(((blob.rx + blob.ry) / 2) * 100)}%`}
                >
                  <Stop offset="0" stopColor={color} stopOpacity={opacity} />
                  <Stop offset={`${blob.fadeStop}`} stopColor={color} stopOpacity={0} />
                </RadialGradient>
              );
            })}
            {grid ? (
              <Mask id={gridMaskId} maskUnits="userSpaceOnUse" x="0" y="0" width={box.w} height={box.h}>
                <SvgLinearGradient id={gridFadeId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset={`${heroGrid.fadeFrom}`} stopColor="#FFFFFF" stopOpacity={1} />
                  <Stop offset={`${heroGrid.fadeTo}`} stopColor="#FFFFFF" stopOpacity={0} />
                </SvgLinearGradient>
                <Rect x="0" y="0" width={box.w} height={box.h} fill={`url(#${gridFadeId})`} />
              </Mask>
            ) : null}
          </Defs>
          {spec.blobs.map((blob, i) => (
            <Rect key={`b${i}`} x="0" y="0" width={box.w} height={box.h} fill={`url(#${blobIds[i]})`} />
          ))}
          {gridLines ? (
            <G mask={grid ? `url(#${gridMaskId})` : undefined}>
              <Path d={gridLines} stroke={heroGrid.color} strokeWidth={1} fill="none" />
            </G>
          ) : null}
        </Svg>
      ) : null}

      {/* 4. 底部淡出到页面底（从 50% 处开始，92% 处已是实底 bg）—— fill 模式不要这层：
          渐变本身就铺满整页（UI V2.1 §1），卡片直接浮在渐变上 */}
      {fill ? null : (
        <LinearGradient
          colors={[transparentOf(semantic.bg), semantic.bg, semantic.bg]}
          locations={[0, heroFade.solidAt, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: fadeTop,
            height: blockHeight - fadeTop,
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  // fill 模式：四边贴满父容器（父容器是整页容器，页面内容照常叠在上面）
  fill: {
    bottom: 0,
  },
});

export default HeroGradient;
