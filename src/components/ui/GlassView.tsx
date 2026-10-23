// GlassView.tsx
// UI V2.1 §2 唯一毛玻璃材质：按钮、分段、卡片、列表、表单、BottomSheet、AppDialog、
// Tab 栏全部用它 —— 不要在页面里各写一份（旧的「白 22% 玻璃 + 白字」「surface 实色卡」已删）。
//
// 材质五层：
//   1. 半透明填充（夜 rgba(14,10,30,.46) / 日 rgba(255,255,255,.55)）
//   2. 1px 亮边（夜 白 10% / 日 白 85%）
//   3. 顶部内高光（1dp 亮线；夜 白 12% / 日 白 90%）
//   4. 投影（0 12 32 -20 rgba(20,10,60,.55)，日夜同值）
//   5. 模糊（iOS / Web 用 expo-blur BlurView(24)，web 走 CSS backdrop-filter；
//      Android 原生模糊有性能/兼容问题 → 退回纯 rgba，只少一层模糊，绝不白屏）
//
// 圆角（§2）：卡片 26 · 按钮 / 分段 / 输入框 999。
//
// 用法：
//   <GlassView radius={999} style={{ height: 44, paddingHorizontal: 16, justifyContent: 'center' }}>
//     <AppText color={semantic.textPrimary}>默认账本</AppText>
//   </GlassView>

import React from 'react';
import { Platform, StyleSheet, View, ViewProps, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../theme/useTheme';

export interface GlassViewProps {
  /** 圆角（数值或 'full'；默认 999 全圆；卡片传 26） */
  radius?: number | 'full';
  /** 填充色覆盖（默认取令牌 glass.fill）。给 V2.2 的 Tab 栏用：栏身要更高不透明度
   *  （夜 88% / 日 90%）挡住背后滚动的列表文字，其余玻璃件一律不传、保持原样） */
  fill?: string;
  /** 模糊强度覆盖（默认取令牌 24） */
  intensity?: number;
  /** 投影开关（默认开；列表行等已在大卡内的玻璃件可关掉，阴影只留在大卡上） */
  shadow?: boolean;
  /** 强模糊（仅浮空 Tab 栏用；其余玻璃件保持默认）：iOS BlurView 强度 70；
   *  web 用 backdrop-filter blur(28px) saturate(160%)；Android 无原生模糊，靠 fill 的高不透明度 */
  strongBlur?: boolean;
  /** 是否输出模糊层（默认 true）。
   *  传 false = 这块玻璃只留「半透明填充 + 亮边 + 高光 + 投影」，不再挂 backdrop-filter / BlurView。
   *  为什么要这个开关：模糊层是一个独立合成图层，即使父级 opacity 已为 0（或整块隐藏）也仍在合成器里，
   *  真机浏览器上会从邻页渗出来（实测：首页日历邻页的玻璃卡在资产页留下一道软边阴影竖带）。
   *  隐藏态 / 动画子树里的玻璃件（横滑邻页预览）用它把这层彻底关掉。 */
  blur?: boolean;
  pointerEvents?: ViewProps['pointerEvents'];
  style?: ViewStyle | ViewStyle[];
  children?: React.ReactNode;
}

export function GlassView({
  radius = 'full',
  fill,
  intensity,
  shadow = true,
  strongBlur = false,
  blur = true,
  pointerEvents,
  style,
  children,
}: GlassViewProps) {
  const { glass } = useTheme();
  const blurSupported = blur && (Platform.OS === 'ios' || Platform.OS === 'web');
  // ⚠ web 的 BlurView 把 tint 当「白色叠层」用（expo-blur getBackgroundColor：
  //    'default' = rgba(255,255,255, (intensity/100) × 0.3)）—— intensity 100 就是 30% 白，
  //    把夜间玻璃整体提亮一档：实测浮空 Tab 栏内底被抬到 rgb(112,104,120)、玻璃槽抬到
  //    rgb(90,89,105)，上面的 11-13pt 次要字全掉到 4.2:1 以下（§4 要 4.5）。
  //    原生端 intensity 100 才是「最厚材质」的正确档位，所以只压 web：
  //    12px 模糊 + 18% 白，夜间玻璃回到「填色令牌说了算」的深色（与稿里的夜间玻璃对得上）。
  const WEB_BLUR_CAP = 60;
  const requested = strongBlur ? STRONG_BLUR_IOS : intensity ?? glass.blurIntensity;
  const resolvedIntensity = Platform.OS === 'web' ? Math.min(requested, WEB_BLUR_CAP) : requested;
  // web 强模糊走 CSS backdrop-filter（比 BlurView 的白色叠层更接近真模糊），此时不再叠 BlurView
  const useCssBackdrop = strongBlur && Platform.OS === 'web';

  return (
    <View
      pointerEvents={pointerEvents}
      style={[
        styles.root,
        {
          borderRadius: radius === 'full' ? 999 : radius,
          backgroundColor: fill ?? glass.fill,
          borderWidth: glass.borderWidth,
          borderColor: glass.borderColor,
          boxShadow: shadow ? glass.shadow : undefined,
        },
        useCssBackdrop ? (WEB_STRONG_BACKDROP as ViewStyle) : null,
        style,
      ]}
    >
      {/* 模糊垫底：只铺在内容下面，不吃触摸。
          tint 固定 'default'（iOS = 系统默认材质；web = 白色叠层，见上面 WEB_BLUR_CAP 的说明）：
          颜色由令牌的 fill 决定，模糊层不再二次染色（'dark' 会把夜间玻璃压暗一档） */}
      {blurSupported && !useCssBackdrop ? (
        <BlurView
          intensity={resolvedIntensity}
          tint="default"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {/* 顶部内高光（1dp 细亮线；不随内容滚动） */}
      <View
        pointerEvents="none"
        style={[
          styles.highlight,
          { height: glass.highlightHeight, backgroundColor: glass.highlightColor },
        ]}
      />
      {children}
    </View>
  );
}

/** 强模糊的 iOS BlurView 强度（默认 24，Tab 栏用 70 让背后文字成为色块而不是可读字） */
const STRONG_BLUR_IOS = 70;
/** 强模糊的 web 实现（backdrop-filter；RN web 直接吃 CSS 属性名） */
const WEB_STRONG_BACKDROP = { backdropFilter: 'blur(28px) saturate(160%)', WebkitBackdropFilter: 'blur(28px) saturate(160%)' } as unknown as ViewStyle;

const styles = StyleSheet.create({
  // overflow hidden：亮边 / 高光 / 模糊都被圆角裁切（半透明卡不加 elevation——会透出阴影）
  root: {
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});

export default GlassView;
