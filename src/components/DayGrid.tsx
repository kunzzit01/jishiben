// DayGrid.tsx
// 账单日 / 还款日选择网格（1–max，账单/还款日都是 1–30）。
//
// 为什么是网格而不是列表（真机反馈："账单日 / 还款日划不动"）：
// 原来的 30 天是一层可滚动列表，压在弹层外层 ScrollView 里 —— 安卓没有 nestedScrollEnabled
// 时内层完全滚不动；就算能滚，BottomSheet 的「下移 8px 即关闭」手势也会抢走垂直滑动。
// 30 个数字一屏排得下（5 列 × 6 行），改成不滚动的网格、点一下即选，两层滚动与手势竞争一起消失。
//
// 纯展示 + 点击：选中值、天数上限、回调、testID 前缀全部由调用方传，组件自身不持有状态，
// 写完库、收起弹层的收尾动作仍旧留在各自的屏幕里（行为与改造前一致）。

import React from 'react';
import { StyleSheet, View } from 'react-native';
import AppText from './ui/AppText';
import PressableScale from './PressableScale';
import { useTheme } from '../theme/useTheme';

export interface DayGridProps {
  /** 当前选中日（1-based） */
  value: number;
  /** 天数上限：渲染 1–max（账单日 / 还款日传 30；31 号不入选项，小月没有 31 号） */
  max: number;
  /** 点选回调（1-based） */
  onPick: (day: number) => void;
  /** testID 前缀：每格是 `${testIDPrefix}-${day}`，容器是 `${testIDPrefix}-grid` */
  testIDPrefix: string;
}

/**
 * 5 列 × 6 行：30 天正好排满一屏，不滚动（列宽均分 20%，见 styles.slot）。
 * ⚠ 不要改成 7 列日历式，也不要在外面再套 ScrollView —— 那就退回改造前的两层滚动。
 */
export function DayGrid({ value, max, onPick, testIDPrefix }: DayGridProps) {
  const { semantic, spacing, radius, layout } = useTheme();
  const days = Array.from({ length: max }, (_, index) => index + 1);

  return (
    <View
      style={[styles.grid, { paddingHorizontal: layout.card, paddingVertical: spacing.sm }]}
      testID={`${testIDPrefix}-grid`}
    >
      {days.map((day) => {
        const selected = day === value;
        return (
          <View
            key={day}
            style={[
              styles.slot,
              // 槽自带 2dp 内缩：相邻两格的间隙正好 spacing.xs(4)，列宽才能稳稳均分 20%
              { paddingHorizontal: spacing.xs / 2, paddingVertical: spacing.xs / 2 },
            ]}
          >
            <PressableScale
              onPress={() => onPick(day)}
              // 相邻格只隔 4dp：默认 hitSlop 12 会让命中区互相盖住，这里关掉（格高 44 已够手指）
              hitSlop={0}
              activeScale={0.94}
              style={[
                styles.cell,
                {
                  borderRadius: radius.sm,
                  borderColor: selected ? semantic.accentText : semantic.hairline,
                  backgroundColor: selected ? semantic.accentSoft : 'transparent',
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`${testIDPrefix}-${day}`}
            >
              <AppText variant="subhead" color={selected ? semantic.accentText : semantic.textPrimary}>
                {String(day)}
              </AppText>
            </PressableScale>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  // 5 列：每格 20% 宽，6 行由 flexWrap 自动折行
  slot: { width: '20%' },
  // 触控区高 44（≥40 手指友好），与列表行 / 按钮的最小触控区一致；纯色块，不做新的视觉语言
  cell: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});

export default DayGrid;
