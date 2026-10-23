// Button.tsx
// 统一按钮（T03 / 计划 4.5 —— 取代现在 8 种主按钮写法）。
//
// 四种（UI_RULES 第 7 节「按钮只有 4 种」）
//   primary     实心紫（accent 底 + 白字）—— 页面主操作
//   secondary   accentSoft 淡紫底 + 紫字 —— 次一级操作
//   destructive 红字 + 极淡红底 —— 删除 / 清空（红字是规矩，淡底只是为了它像个按钮）
//   ghost       文字按钮（紫字、无底）—— 取消 / 跳过
//   gradient    accent 品牌渐变底 + 白字（V2.2c：与首页渐变主按钮同一套令牌），
//               用于「保存」这类最重要的主操作；禁用态与 primary 一致（变灰）
//
// 尺寸：高 50（sm 44）、圆角 14（radius.md）、文字 headline 17/600。
// 状态：disabled（变灰 + 点了没反应）· loading（转圈 + 宽度不变，不闪空状态）。
//
// 用法
//   <Button title={tr('common.save')} onPress={save} />
//   <Button title={tr('common.cancel')} variant="ghost" onPress={close} />
//   <Button title={tr('common.delete')} variant="destructive" loading={deleting} onPress={del} />

import React from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import PressableScale from '../PressableScale';
import { useTheme } from '../../theme/useTheme';

import AppText from './AppText';
import { withAlpha } from './color';

/** 主按钮高度；sm 档 44（触控下限） */
const HEIGHT_MD = 50;
const HEIGHT_SM = 44;

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'gradient';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  onLongPress?: () => void;
  variant?: ButtonVariant;
  /** 文字左侧图标（Ionicons，可选） */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  /** 加载中：显示转圈，文字隐藏但占位不变（按钮宽度不跳） */
  loading?: boolean;
  /** 占满父容器宽度（默认 true） */
  fullWidth?: boolean;
  /** md = 50（默认）· sm = 44 */
  size?: 'md' | 'sm';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  title,
  onPress,
  onLongPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  fullWidth = true,
  size = 'md',
  accessibilityLabel,
  style,
  testID,
}: ButtonProps) {
  const { semantic, radius, spacing, gradients } = useTheme();
  // disabled 与 loading 分开：loading 不是「变灰」，是「正在忙」——
  // 保留本档配色（主按钮仍是实心紫），只把文字换成同色转圈，否则夜间灰底上的转圈几乎看不见
  const isBusy = !!loading;
  const isDisabled = !!disabled;
  const blocked = isBusy || isDisabled;
  const filled = variant !== 'ghost';

  // 禁用：填充钮换成中性淡底 + 弱文字（真的「变灰」），文字钮只把字变弱
  const background = isDisabled
    ? filled
      ? semantic.hairline
      : 'transparent'
    : variant === 'primary'
      ? semantic.accent
      : variant === 'secondary'
        ? semantic.accentSoft
        : variant === 'destructive'
          ? withAlpha(semantic.danger, 0.1)
          : 'transparent';

  const isGradient = variant === 'gradient';
  const foreground = isDisabled
    ? semantic.textTertiary
    : variant === 'primary' || isGradient
      ? semantic.onAccent
      : variant === 'destructive'
        ? semantic.danger
        : semantic.accentText;

  const height = size === 'sm' ? HEIGHT_SM : HEIGHT_MD;
  const label = (
    <AppText variant="headline" color={foreground} align="center" style={styles.label}>
      {title}
    </AppText>
  );

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={blocked}
      activeScale={0.97}
      style={[
        styles.button,
        {
          backgroundColor: background,
          minHeight: height,
          borderRadius: radius.md,
          paddingHorizontal: spacing.xl,
          paddingVertical: spacing.md,
        },
        fullWidth ? styles.fullWidth : styles.hug,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: blocked || undefined, busy: isBusy || undefined }}
      testID={testID}
    >
      {/* accent 渐变底（gradient 档）：铺满按钮、压在文字下面；色值只从令牌取 */}
      {isGradient && !isDisabled && (
        <LinearGradient
          colors={gradients.accent.colors}
          locations={gradients.accent.locations as [number, number, ...number[]]}
          start={gradients.accent.start}
          end={gradients.accent.end}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      <View style={styles.content} pointerEvents="none">
        {/* 加载中：文字保留占位（透明）+ 转圈绝对居中 —— 宽度与静止态完全一致 */}
        <View style={[styles.row, isBusy && styles.hidden]}>
          {icon && <Ionicons name={icon} size={20} color={foreground} style={styles.icon} />}
          {label}
        </View>
        {isBusy && (
          <View style={styles.spinner} pointerEvents="none">
            <ActivityIndicator size="small" color={foreground} />
          </View>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // 几何常量（颜色 / 圆角 / 间距 / 字号全部在渲染期从令牌取，见上）
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: { alignSelf: 'stretch' },
  hug: { alignSelf: 'center' },
  content: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { flexShrink: 1 },
  // 图标与文字间距：令牌 spacing.sm（在渲染期给，避免 StyleSheet 静态值绕过令牌）
  icon: { marginRight: 8 },
  hidden: { opacity: 0 },
  spinner: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});

export default Button;
