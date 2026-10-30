// BackButton.tsx
// 全 App 唯一的「返回」圆钮（2026-10-30 统一）。
//
// 视觉定版 = 用户点名的「图三」那颗玻璃圆钮：
//   半透明玻璃填充 + 一圈**看得见的细亮边** + 顶部内高光 + chevron 20
//   关键：**不开投影**（开了就是图一/图二那种一圈柔光晕，糊在浅蓝背景上，用户明确否掉）
//
// 之前全项目有 3 套返回键（ScreenHeader 内置的带投影白圆、AuthScreen 的玻璃圆、AI/记一笔的散装箭头），
// 统一成本组件的意义就是把「看起来是同一个东西」这件事固定下来，而不是各页各调。

import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import PressableScale from '../PressableScale';
import GlassView from './GlassView';

const CIRCLE = 40;
const HIT = 44;

export function BackButton({
  onPress,
  accessibilityLabel,
  testID,
  disabled = false,
}: {
  onPress?: () => void;
  /** 读屏标签，默认 i18n common.back */
  accessibilityLabel?: string;
  testID?: string;
  disabled?: boolean;
}) {
  const { semantic, glass } = useTheme();
  const tr = useT();
  const label = accessibilityLabel ?? tr('common.back');

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      activeScale={0.9}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={styles.hit}
    >
      {/* shadow={false}：不要那圈柔光晕（用户 2026-10-30 定的样子）
          borderWidth 用令牌的玻璃亮边，浅色背景上也能看清边界 */}
      <GlassView
        radius={999}
        shadow={false}
        style={[
          styles.circle,
          { borderColor: glass.borderColor, borderWidth: Math.max(1, glass.borderWidth) },
        ]}
      >
        <Ionicons name="chevron-back" size={20} color={semantic.textPrimary} style={styles.icon} />
      </GlassView>
    </PressableScale>
  );
}

export default BackButton;

const styles = StyleSheet.create({
  hit: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // chevron-back 字形重心偏右，左移 1dp 后视觉居中
  icon: { marginLeft: -1 },
});
