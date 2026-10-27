// HomeHeroBackdrop.tsx
// 首页顶部氛围背景：模拟参考图那张"玻璃建筑 + 天空"的照片观感。
//
// 为什么不用 Skia shader：本工程 Web 端没有接 CanvasKit（没有 LoadSkiaWeb），
// Skia 画布在 Web 上跑不起来 = 无法截图验收；这里用 SVG 的多层渐变把同一套观感做出来，
// 安卓/Web 渲染一致、零额外包体、也不吃每帧预算。
//
// 结构（自上而下）：
//   ① 竖向底色渐变：顶部深蓝 → 中部亮蓝 → 底部渐隐到页面底色（与下方内容无缝）
//   ② 右上角径向暖光（模拟逆光太阳）
//   ③ 两条斜向白色玻璃带（模拟幕墙反光）
//   ④ 底部 pageBg 渐隐带：保证背景和页面衔接没有硬边

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useHomePalette } from '../../theme/homePalette';
import { useTheme } from '../../theme/useTheme';

export type HomeHeroBackdropProps = {
  height: number;
  testID?: string;
};

export function HomeHeroBackdrop(props: HomeHeroBackdropProps): React.ReactElement {
  const { height, testID } = props;
  const p = useHomePalette();
  const { isDark } = useTheme();

  const top = isDark ? '#04143A' : '#1B57B8';
  const mid = isDark ? '#0A2F72' : '#2F7CDF';

  return (
    <View pointerEvents="none" testID={testID} style={[styles.root, { height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 390 360" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="hbBase" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={top} />
            <Stop offset="0.5" stopColor={mid} />
            <Stop offset="0.9" stopColor={p.pageBg} />
            <Stop offset="1" stopColor={p.pageBg} />
          </LinearGradient>
          <RadialGradient id="hbSun" cx="0.82" cy="0.16" r="0.55">
            <Stop offset="0" stopColor={p.glowStrong} stopOpacity={isDark ? 0.55 : 0.95} />
            <Stop offset="1" stopColor={p.glowStrong} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="hbBand" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={isDark ? 0.1 : 0.34} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width="390" height="360" fill="url(#hbBase)" />
        <Rect x="0" y="0" width="390" height="230" fill="url(#hbSun)" />
        {/* 幕墙反光带（斜切） */}
        <Path d="M-40 190 L520 -30 L520 30 L-40 360 Z" fill="url(#hbBand)" opacity={0.75} />
        <Path d="M-40 250 L520 60 L520 92 L-40 360 Z" fill="url(#hbBand)" opacity={0.45} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden' },
});
