// QuickActions.tsx
// 首页四个快捷入口（支出 / 收入 / 转账 / 扫描）：等宽四列 + 圆形双色图标 + 单行标签。
//
// 为什么做成一个组件：四列的尺寸、间距、按压反馈必须完全一致，
// 放在 HomeScreen 里重复四遍迟早会走形；这里只负责「一行四格」的内部排布，
// 与上下模块的间距由父级控制。
//
// 规则
// - 颜色全部来自 useHomePalette()，组件内零 hex；
// - 尺寸走 spacing / radius 令牌，圆形直径是参考图量出来的固定值（几何比例，不是随手数字）；
// - 按压只做 transform 缩放 + 降透明，不改变布局（不会把相邻列挤动）。

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useHomePalette } from '../../theme/homePalette';
import { useTheme } from '../../theme/useTheme';
import AppText from '../ui/AppText';
import { IconScan, IconTransfer, IconWalletDown, IconWalletUp, IconProps } from './HomeIcons';

export type QuickActionKey = 'expense' | 'income' | 'transfer' | 'scan';

/** 参照图的从左到右顺序：支出 / 收入 / 转账 / 扫描 */
const ORDER: QuickActionKey[] = ['expense', 'income', 'transfer', 'scan'];

/** 图标 → 双色关系（主笔 quickIconPrimary，箭头 quickIconSecondary） */
const ICONS: Record<QuickActionKey, React.ComponentType<IconProps>> = {
  expense: IconWalletUp,
  income: IconWalletDown,
  transfer: IconTransfer,
  scan: IconScan,
};

/** 圆形快捷入口直径（参考图量取 ≈48dp，按 44 触控区下限放大到 54 更好点） */
const CIRCLE_SIZE = 54;
/** 圆内图标尺寸 */
const ICON_SIZE = 26;
/** 按压时的缩放比例（轻，只是手感提示） */
const PRESSED_SCALE = 0.94;

export function QuickActions(props: {
  onPress: (key: QuickActionKey) => void;
  labels: Record<QuickActionKey, string>;
}): React.ReactElement {
  const palette = useHomePalette();
  const { spacing, radius } = useTheme();

  return (
    <View style={[styles.row, { gap: spacing.sm }]}>
      {ORDER.map((key) => {
        const Icon = ICONS[key];
        const label = props.labels[key];
        return (
          <Pressable
            key={key}
            onPress={() => props.onPress(key)}
            accessibilityRole="button"
            accessibilityLabel={label}
            testID={`quick-action-${key}`}
            style={({ pressed }) => [
              styles.item,
              {
                gap: spacing.sm,
                opacity: pressed ? 0.8 : 1,
                transform: [{ scale: pressed ? PRESSED_SCALE : 1 }],
              },
            ]}
          >
            <View
              style={[
                styles.circle,
                {
                  width: CIRCLE_SIZE,
                  height: CIRCLE_SIZE,
                  borderRadius: radius.full,
                  backgroundColor: palette.quickCircleBg,
                  borderColor: palette.quickCircleBorder,
                },
              ]}
            >
              <Icon size={ICON_SIZE} color={palette.quickIconPrimary} secondary={palette.quickIconSecondary} />
            </View>
            <AppText variant="caption" color={palette.textSecondary} numberOfLines={1}>
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  item: {
    // 四列等宽；按压 / 标签都在这一个触控区内（含标签后高度 > 44）
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
