// BackButton.tsx
// 全 App 唯一的「返回」圆钮（2026-10-30 统一）。
//
// 为什么要有这个文件：之前返回键有 3 套写法 ——
//   1) ScreenHeader 内置的 40 圆（表面色 + 发丝描边 + 轻投影）
//   2) AuthScreen / 关于 这类用 GlassView 玻璃圆，**没有描边** —— 浅色背景上几乎看不见（用户截图指出）
//   3) AIScreen / ReportScreen / TransactionTypeHeader 各自散装 Ionicons
// 现在统一成这一个组件：44 触控区 + 40 圆 + 发丝描边 + 轻投影 +
// 图标 22 居中（chevron-back 视觉重心偏左，所以左移 1dp 补正），深浅色都用令牌。

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import PressableScale from '../PressableScale';

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
  const { semantic } = useTheme();
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
      <View
        style={[
          styles.circle,
          {
            backgroundColor: semantic.surfaceElevated,
            borderColor: semantic.hairline,
            // 一层很浅的投影把它从「浅蓝渐变背景」上托起来（单实例，成本可忽略）
            boxShadow: '0px 2px 8px 0px rgba(7,28,73,0.10)',
          },
        ]}
      >
        <Ionicons name="chevron-back" size={22} color={semantic.textPrimary} style={styles.icon} />
      </View>
    </PressableScale>
  );
}

export default BackButton;

const styles = StyleSheet.create({
  hit: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // chevron-back 的字形重心偏右，左移 1dp 后视觉居中
  icon: { marginLeft: -1 },
});
