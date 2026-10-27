// HomeHeaderControls.tsx
// 首页顶部两块：左侧账户药丸（AccountChip）+ 右侧圆形工具键（RoundIconButton）。
//
// 为什么单独一个文件：顶部区在 HomeScreen 里只做排布，控件自己的点击区、描边、
// 半透明底和徽标位置都封在这里，避免 HomeScreen 再堆一层内联样式。
//
// 规则
// - 触控区一律 44（药丸高 44 / 圆键 44×44，UI_RULES 第 4 节）；
// - 颜色全部来自 useHomePalette()，组件内零 hex；
// - 底「微透明」不用 rgba 字面量拼色：垫一层 absoluteFill 的 surface + opacity，
//   这样调色板换成任何色值都成立，且不会写出裸色。

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useHomePalette } from '../../theme/homePalette';
import { useTheme } from '../../theme/useTheme';
import AppText from '../ui/AppText';
import { IconBell, IconChevronDown, IconMoon, IconSearch, IconSun } from './HomeIcons';
import { withAlpha } from '../ui/color';

/** 触控区边长（所有可点元素 ≥44） */
const TOUCH_SIZE = 44;
/** 圆键图标尺寸（图标只有 20 / 24 两档） */
const ROUND_ICON_SIZE = 20;
/** 账户名右侧箭头的视觉尺寸（比图标档位小一档，贴文字基线上更好看） */
const CHEVRON_SIZE = 18;
/** 底面的「微透明」程度：既透出顶部光场，又保证图标与文字对比度 */
const SURFACE_OPACITY = 0.72;
/** 压在照片背景上时的「玻璃」底色透明度（白玻璃，透出背景色） */
const GLASS_FILL_OPACITY = 0.3;
/** 玻璃描边：白色半透明，边缘不会像灰线那样发脏 */
const GLASS_BORDER_ALPHA = 0.72;
/** 玻璃键的轻投影：不造层次，只负责把按钮从背景上托起来一点 */
const GLASS_SHADOW = '0 2px 8px rgba(3,16,48,0.18)';
/** 两种底：surface = 落在普通页面上；glass = 压在照片/渐变背景上 */
export type HeaderTone = 'surface' | 'glass';

/** 右上角未读红点直径 */
const BADGE_SIZE = 7;
/** 红点外圈：1.5 的页面底色描边，让它从圆键里「浮」出来 */
const BADGE_RING = 1.5;

/**
 * 微透明底面：垫一层绝对定位的调色板颜色 + opacity。
 * 用层叠而不是 rgba 字符串，页面底色 / 光场变化时都不用改色值。
 */
function TranslucentFill({ color, radiusValue, opacity = SURFACE_OPACITY }: { color: string; radiusValue: number; opacity?: number }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color, opacity, borderRadius: radiusValue }]}
    />
  );
}

export function AccountChip(props: {
  label: string;
  onPress: () => void;
  /** 压在照片背景上时传 'glass'（白玻璃 + 白字） */
  tone?: HeaderTone;
  testID?: string;
}): React.ReactElement {
  const palette = useHomePalette();
  const { spacing, radius } = useTheme();
  const glass = props.tone === 'glass';

  return (
    <Pressable
      onPress={props.onPress}
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: glass ? withAlpha(palette.fabIcon, GLASS_BORDER_ALPHA) : palette.border,
          borderRadius: radius.full,
          paddingHorizontal: spacing.lg,
          boxShadow: glass ? GLASS_SHADOW : undefined,
          gap: spacing.sm,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      <TranslucentFill
        color={glass ? palette.fabIcon : palette.surface}
        opacity={glass ? GLASS_FILL_OPACITY : SURFACE_OPACITY}
        radiusValue={radius.full}
      />
      <AppText variant="headline" color={glass ? palette.fabIcon : palette.textPrimary} numberOfLines={1}>
        {props.label}
      </AppText>
      <IconChevronDown size={CHEVRON_SIZE} color={glass ? palette.fabIcon : palette.textPrimary} />
    </Pressable>
  );
}

export function RoundIconButton(props: {
  /** theme = 日夜切换（图标由 themeIcon 决定画月亮还是太阳） */
  kind: 'search' | 'bell' | 'theme';
  /** kind='theme' 时用：当前是日间则显示月亮（点了切到夜间），反之显示太阳 */
  themeIcon?: 'moon' | 'sun';
  onPress: () => void;
  badge?: boolean;
  accessibilityLabel: string;
  /** 压在照片背景上时传 'glass'（白玻璃 + 白图标） */
  tone?: HeaderTone;
  testID?: string;
}): React.ReactElement {
  const palette = useHomePalette();
  const { radius } = useTheme();
  const glass = props.tone === 'glass';
  const Icon =
    props.kind === 'bell' ? IconBell : props.kind === 'theme' ? (props.themeIcon === 'sun' ? IconSun : IconMoon) : IconSearch;
  const showBadge = props.kind === 'bell' && props.badge === true;

  return (
    <Pressable
      onPress={props.onPress}
      testID={props.testID}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityValue={showBadge ? { text: '未读' } : undefined}
      style={({ pressed }) => [
        styles.round,
        {
          borderColor: glass ? withAlpha(palette.fabIcon, GLASS_BORDER_ALPHA) : palette.border,
          borderRadius: radius.full,
          boxShadow: glass ? GLASS_SHADOW : undefined,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <TranslucentFill
        color={glass ? palette.fabIcon : palette.surface}
        opacity={glass ? GLASS_FILL_OPACITY : SURFACE_OPACITY}
        radiusValue={radius.full}
      />
      <Icon size={ROUND_ICON_SIZE} color={glass ? palette.fabIcon : palette.textPrimary} />
      {showBadge ? (
        <View
          pointerEvents="none"
          style={[
            styles.badge,
            { backgroundColor: palette.expense, borderColor: palette.pageBg, borderWidth: BADGE_RING },
          ]}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: TOUCH_SIZE,
    minWidth: TOUCH_SIZE,
    // 上限：账本名再长也不把右侧按钮挤出屏幕（超出走 AppText 的 numberOfLines=1 截断）
    maxWidth: '58%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    // 自身透明，半透明底由 TranslucentFill 垫在内容下方
    backgroundColor: 'transparent',
  },
  round: {
    width: TOUCH_SIZE,
    height: TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
  badge: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: BADGE_SIZE,
    height: BADGE_SIZE,
    borderRadius: BADGE_SIZE / 2,
  },
});
