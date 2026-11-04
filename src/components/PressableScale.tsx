// PressableScale.tsx
// 全局统一的按压反馈：按下瞬间缩放（默认 0.97，可传 activeScale 调），松手弹回。
// 反馈发生在按下瞬间而不是松手之后 —— 这是"界面在听你"的感觉来源。
//
// T05 重写（计划 4.5 / 11.4）
// - 缩放改由 Reanimated shared value + 弹簧驱动：按下只改 UI thread 的值，**不再 setState**，
//   列表 / 键盘这种高频点按不再有整块重渲染；
// - 弹簧参数取令牌 motion.spring.press（180ms 临界阻尼），按下即响应；
// - 默认 accessibilityRole="button"：读屏能读出「按钮」，不再依赖每个调用点自己传；
// - 系统「减弱动态效果」时 motion.pressScale = 1 → 无缩放位移（自动降级）。
//
// 兼容：props 与旧版完全一致（onPress / onLongPress / style / children / activeScale /
// disabled / hitSlop / delayLongPress / accessibilityRole / accessibilityLabel /
// accessibilityState / testID），16 个页面的调用点不用改。
//
// ⚠ 底部 Tab 按钮禁止任何按压反馈（用户明令）：Tab 栏若要用本组件，必须传 activeScale={1}。

import React, { useEffect } from 'react';
import { Platform, Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/useTheme';

// RN 的 ViewStyle 类型还没收录 CSS transition 这几个属性
// （web 端 react-native-web 和新架构原生都实际支持），抽成宽类型常量绕过检查。
// 注意：原生端 Reanimated 的 transitionTimingFunction 只认预定义关键字
// （linear/ease/ease-in/ease-out/ease-in-out...），cubic-bezier 字符串会直接报错；
// web 端浏览器则完全支持 cubic-bezier。
//
// ⚠ 保留导出：AmountCalculatorKeypad 直接用它给键帽做 CSS transition 按下反馈（7 处），
//   本组件自身已改走 Reanimated 弹簧，不再消费这个常量。
export const PRESS_TRANSITION = {
  transitionProperty: 'transform',
  transitionDuration: '120ms',
  transitionTimingFunction: Platform.select({
    web: 'cubic-bezier(0.23, 1, 0.32, 1)',
    default: 'ease-out',
  }),
} as unknown as ViewStyle;

type Props = {
  onPress?: () => void;
  onLongPress?: () => void;
  /** 视觉样式：落在内层 Animated.View 上（缩放的那一层），不参与命中测试 */
  style?: StyleProp<ViewStyle>;
  /**
   * 命中区样式：落在 Pressable 自身，也就是真正吃触摸的那一层。
   * ⚠ 需要「绝对定位 / 铺满某个绝对容器 / 固定边长」时**必须**放这里。
   * style 若写成 position:'absolute' 就会出事：内层跟随内容走，Pressable 自身没有
   * 在流内的子节点 → 塌成 0 高，安卓 / iOS 上整块点不动（Web 例外：CSS 命中按元素
   * 盒子算，子节点跑到父盒子外面照样点得到，所以浏览器预览发现不了）。
   */
  containerStyle?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** 按下时的缩放（默认取令牌 motion.pressScale 0.97）；传 1 = 完全不缩放（底部 Tab 用） */
  activeScale?: number;
  disabled?: boolean;
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
  /** 长按触发延迟（毫秒），透传给 RN Pressable 的 delayLongPress */
  delayLongPress?: number;
  accessibilityRole?: React.ComponentProps<typeof Pressable>['accessibilityRole'];
  accessibilityLabel?: string;
  accessibilityState?: React.ComponentProps<typeof Pressable>['accessibilityState'];
  /** 按下时覆盖一层淡色底（不改变布局、不缩放）：用于日历格子这类需要「按下反馈但不晃动」的场景 */
  pressedOverlayColor?: string;
  /** 测试 / 预览页定位用（透传给 Pressable） */
  testID?: string;
};

export default function PressableScale({
  onPress,
  onLongPress,
  style,
  containerStyle,
  children,
  activeScale,
  disabled,
  hitSlop = 12,
  delayLongPress,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityState,
  testID,
  pressedOverlayColor,
}: Props) {
  const { motion } = useTheme();
  const scale = useSharedValue(1);
  const pressedScale = activeScale ?? motion.pressScale;

  const tint = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.value }));

  const pressIn = () => {
    scale.value = withSpring(pressedScale, motion.spring.press);
  };
  const pressOut = () => {
    scale.value = withSpring(1, motion.spring.press);
  };

  // 按下过程中被禁用（比如提交后立刻 disabled）：把缩放松回去，别卡在小尺寸
  useEffect(() => {
    if (disabled) scale.value = withSpring(1, motion.spring.press);
  }, [disabled, scale, motion]);

  return (
    <Pressable
      style={containerStyle}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      disabled={disabled}
      hitSlop={hitSlop as never}
      pressRetentionOffset={16}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
    >
      <Animated.View style={[animatedStyle, style]}>
        {children}
        {pressedOverlayColor ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: pressedOverlayColor }, tintStyle]}
          />
        ) : null}
      </Animated.View>
    </Pressable>
  );
}
