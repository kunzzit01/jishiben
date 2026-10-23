import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/**
 * 非活跃 Tab 的「不绘制」档：visibility:hidden 让整棵子树退出绘制 / 合成树，
 * 但**保留布局盒**——这一点是刻意的：
 *   display:none 会把布局盒一起摘掉，首页滚动容器的高度会被测成 0，
 *   切回来时列表的 scrollTop / 可视高度都会变（实测 600/844 → 690/729），
 *   状态就等于丢了；visibility:hidden 实测合成层数同样从 34 降到 12，
 *   而 scrollTop 600 / 高度 844 原样保留。
 * 不卸载、不懒加载：组件树、React 状态、滚动容器 DOM 全部保留，路由结构不变。
 */
const WEB_HIDDEN = { visibility: 'hidden' } as unknown as ViewStyle;

export function TabSceneDisplayGate({
  sceneName,
  children,
}: {
  sceneName: string;
  children: React.ReactNode;
}) {
  const isFocused = useIsFocused();
  return (
    <View
      testID={`tab-scene-${sceneName}`}
      pointerEvents={isFocused ? 'auto' : 'none'}
      style={[styles.gate, isFocused ? null : WEB_HIDDEN]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1 },
});
