// FolderAssetCard.tsx
// V2 资产卡外壳：把 Asset_Card_Reference_v2 包的 SVG 造型原样搬进 RN。
//
// 保真度说明（必须读）：
//   · 三条路径（face / upper / lower）、外缘高光线 rim、两个径向光（左上 shine / 中心 center）、
//     面渐变（face1→face2@55%→face3）按包里的坐标与参数逐字搬过来，画布 804×400，等比缩放；
//   · 两张背卡在包里是**带透视的四边形**（不是圆角矩形），这就是参考图"两张薄卡斜着叠"的来源；
//   · 包里那层 200 格 <rect> 颜色网格 + feGaussianBlur(12) 无法在 RN 还原：react-native-svg 15.15
//     没有 Filter/FeGaussianBlur 元素。这里用「面渐变 + 左上光 + 中心光」复现同一套色场观感；
//   · 字体：包内是 woff/woff2（CardAmount/CardInter），RN 不能加载 woff；沿用项目已打包的 Inter。
//
// 布局：stage 用 aspectRatio 804/400 固定形状（= 参考图 1.99:1）。内容层绝对铺满 stage，
// children 拿到实测尺寸后按包里的百分比（8.8% / 17.9% / 33.5% / 78.6% …）自己摆位。

import React, { useCallback, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useAssetCardColors, useHomePalette } from '../../theme/homePalette';
import { useTheme } from '../../theme/useTheme';
import { ASSET_CARD_MESH } from './assetCardMesh';

const FACE =
  'M63 15H284C302 15 308 19 318 31C325 40 332 42 345 42H747C772 42 785 56 785 81V339C785 363 771 377 747 377H56C32 377 18 363 18 339V59C18 32 36 15 63 15Z';
const RIM = 'M20 87V59C20 33 37 17 63 17H284C301 17 307 21 317 33C324 42 333 44 345 44H747C770 44 783 57 783 81';

const CANVAS_W = 804;
const CANVAS_H = 400;
export type CardSize = { width: number; height: number };

export type FolderAssetCardProps = {
  children: (size: CardSize) => React.ReactNode;
  testID?: string;
};

export function FolderAssetCard(props: FolderAssetCardProps): React.ReactElement {
  const { children, testID } = props;
  const colors = useAssetCardColors();
  const { isDark } = useTheme();
  const { surface: paletteFace } = useHomePalette();
  const [size, setSize] = useState<CardSize>({ width: 0, height: 0 });

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) =>
      Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5 ? prev : { width, height }
    );
  }, []);

  return (
    <View testID={testID} onLayout={handleLayout} style={styles.stage}>
      {/* 卡片**背后不再有任何一层**：没有背卡、没有矩形投影层。
          之前那块 boxShadow 是「圆角矩形」，它的上缘会从肩部凹陷处露出来 —— 那正是看起来
          "多一层"的最后来源。现在层次只由卡面自身的高光与描边承担（真正零叠层）。 */}

      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" viewBox={'0 0 ' + CANVAS_W + ' ' + CANVAS_H}>
          <Defs>
            <LinearGradient id="acFace" x1="0" y1="0" x2="0.86" y2="1" gradientUnits="objectBoundingBox">
              <Stop offset="0" stopColor={colors.face1} />
              <Stop offset="0.55" stopColor={colors.face2} />
              <Stop offset="1" stopColor={colors.face3} />
            </LinearGradient>
            <RadialGradient id="acLight" cx="0.13" cy="0.12" r="0.95" gradientUnits="objectBoundingBox">
              <Stop offset="0" stopColor={colors.shine} stopOpacity="0.2" />
              <Stop offset="0.8" stopColor={colors.shine} stopOpacity="0" />
            </RadialGradient>
            <ClipPath id="acFaceClip">
              <Path d={FACE} />
            </ClipPath>
            <RadialGradient id="acCenter" cx="0.39" cy="0.58" r="0.64" gradientUnits="objectBoundingBox">
              <Stop offset="0" stopColor={colors.shine} stopOpacity={String(colors.centerLight)} />
              <Stop offset="1" stopColor={colors.shine} stopOpacity="0" />
            </RadialGradient>
          </Defs>

          {/* 不做叠层（方案①）：背后那层没有任何信息意义，只会和投影打架 ——
              层次交给「一层柔影 + 上缘高光」，金额是唯一主角。
              要换回叠卡只需恢复 G translate 那两段（组件里注释保留了做法）。 */}

          {/* 沿轮廓的冷蓝边光：偏移 3/5 后只有右下露出来 —— 参考图那道蓝色描边的做法 */}
          <Path
            d={FACE}
            fill="none"
            stroke={colors.blue}
            strokeOpacity={isDark ? 0.5 : 0.62}
            strokeWidth={4}
            transform="translate(3 5)"
          />
          <Path d={FACE} fill="url(#acFace)" stroke={colors.rim} strokeWidth={1.5} />

          {isDark ? (
            <>
              <Path d={FACE} fill="url(#acLight)" />
              <Path d={FACE} fill="url(#acCenter)" />
            </>
          ) : (
            <G clipPath="url(#acFaceClip)">
              {ASSET_CARD_MESH.map((cell, i) => (
                <Rect key={i} x={cell[0]} y={cell[1]} width={cell[2]} height={cell[3]} fill={cell[4]} />
              ))}
            </G>
          )}
          <Path d={RIM} fill="none" stroke={colors.shine} strokeOpacity={0.8} strokeWidth={1.5} />
        </Svg>
      </View>

      <View style={StyleSheet.absoluteFill}>{children(size)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { width: '100%', aspectRatio: CANVAS_W / CANVAS_H, position: 'relative' },
});
