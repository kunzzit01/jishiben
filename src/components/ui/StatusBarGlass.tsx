// StatusBarGlass.tsx
// Tab 根页的顶部安全区挡板（V2.2c，C1）。
//
// 问题：根页都是「全出血」——品牌渐变通到屏幕顶（SafeAreaView edges=[]），页面内容自己用
// insets.top 让开状态栏。可是滚动起来以后列表 / 卡片会**从状态栏文字底下穿过去**，
// 状态栏文字压在内容上（浅色内容上根本看不清）。
//
// 做法：一层不参与排版的玻璃挡板钉在屏幕顶部，高 = insets.top，填充取浮空 Tab 栏的同一
// 不透明磨砂令牌（semantic.tabBar：夜 88% / 日 90%，见 V2.2 的 tabBar 注释）——
// 滚上来的内容被它挡住，视觉上与底部悬浮栏是同一套材质。
//
// ⚠ 绝对定位 + pointerEvents none：不吃布局、不吃触摸（状态栏区域本来也不该响应业务操作）。
// ⚠ 只在 insets.top > 0 时渲染（Web 预览 / 无状态栏机型不产生多余节点）。
//
// 用法（放在页面根节点里、渐变之后、滚动容器前后都可以，zIndex 保证在最上层）：
//   <StatusBarGlass />

import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { LinearGradient } from 'expo-linear-gradient';
import { withAlpha } from './color';

/** 挡板层级：只在页面内（根节点）压住滚动内容，低于弹层（BottomSheet 是 90） */
const Z_INDEX = 40;

export interface StatusBarGlassProps {
  style?: StyleProp<ViewStyle>;
}

export function StatusBarGlass({ style }: StatusBarGlassProps) {
  const { semantic } = useTheme();
  const insets = useSafeAreaInsets();
  if (insets.top <= 0) return null;
  return (
    <View pointerEvents="none" style={[styles.root, { height: insets.top + 6 }, style]}>
      {/* 顶部渐变遮罩（V3）：页面底色 55% → 透明，不再是不透明色带（Expo Go 下实底会像「白屏/黑条」） */}
      <LinearGradient
        colors={[withAlpha(semantic.homeBg, 0.55), withAlpha(semantic.homeBg, 0)]}
        locations={[0, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: Z_INDEX },
});

export default StatusBarGlass;
