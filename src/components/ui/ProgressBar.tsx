// ProgressBar.tsx
// 通用进度条（设计稿「月度预算 · 分类预算」的百分比条）。
//
// 只做四件事：轨道、填充、按状态取色、宽度补间。
// 颜色一律来自 semantic（tokens: status.success / status.warning / status.danger / brand.primary），
// 页面不再自己拼进度条，也不写裸 hex。
//
// 用法
//   <ProgressBar ratio={used / limit} />            // 状态色自动（<65% 绿 / 65–90% 黄 / ≥90% 红）
//   <ProgressBar ratio={1.4} tone="danger" height={8} />

import React, { useEffect } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../theme/useTheme';

/** 预算进度的状态阈值（分类预算条与进度文案共用，一处改全局一致） */
export const BUDGET_DANGER_RATIO = 1;
export const BUDGET_WARNING_RATIO = 0.8;

export type ProgressTone = 'success' | 'warning' | 'danger' | 'accent';

/** 比例 → 状态档（≥100% 危险 / ≥80% 警告 / 其余健康；与 theme.ts 的 warning/danger 令牌注释一致） */
export function progressToneOf(ratio: number): ProgressTone {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'success';
  if (ratio >= BUDGET_DANGER_RATIO) return 'danger';
  if (ratio >= BUDGET_WARNING_RATIO) return 'warning';
  return 'success';
}

export interface ProgressBarProps {
  /** 已用 / 额度（0–1 是常态；>1 表示超支，条宽封顶 100%，只靠颜色与文案表达超支） */
  ratio: number;
  /** 显式指定状态色；省略 = 按 ratio 自动判定 */
  tone?: ProgressTone;
  /** 条高（默认 6，设计稿口径） */
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ProgressBar({ ratio, tone, height = 6, style, testID }: ProgressBarProps) {
  const { semantic, motion } = useTheme();
  const safeRatio = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  const pct = Math.min(safeRatio, 1) * 100;
  const resolvedTone = tone ?? progressToneOf(safeRatio);
  const fillColor =
    resolvedTone === 'danger'
      ? semantic.danger
      : resolvedTone === 'warning'
        ? semantic.warning
        : resolvedTone === 'accent'
          ? semantic.accent
          : semantic.success;

  // 宽度补间（目的：state indication）；轨道 overflow:hidden，圆角不会被拉糊
  const progress = useSharedValue(pct);
  useEffect(() => {
    progress.set(withTiming(pct, { duration: motion.spring.default.duration, easing: motion.easing.out }));
  }, [pct, progress, motion]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.get()}%` }), [progress]);

  return (
    <View
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: semantic.budgetTrack }, style]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      testID={testID}
    >
      <Animated.View style={[styles.fill, { borderRadius: height / 2, backgroundColor: fillColor }, fillStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { height: '100%' },
});

export default ProgressBar;
