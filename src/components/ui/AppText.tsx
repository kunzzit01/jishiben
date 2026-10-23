// AppText.tsx
// 全 App 唯一文字组件（T03 / 计划 4.5、4.2 —— 取代散落的 26 种字号写法）。
//
// 职责
// - variant 对应 typography 11 档：字号 / 行高 / 字重 / 字距 / 系统缩放上限全部取令牌；
// - 字体自动分流（V2.2c）：整段是数字 / 拉丁（含 RM、逗号、减号这类拉丁符号）→ 走打包的
//   **Inter**；整段是拉丁 + 中文 / 全角标点 → 走打包的 **Noto Sans SC** 子集；
//   只要含 emoji、假名、谚文或子集外的生僻字 → 回退系统字体（打包字体没有这些字形，
//   强套会渲染成方框，见 theme.ts 的 canUseLatinText / canUseCjkText）；
// - Android 统一 includeFontPadding:false（计划 8.2 第 4 条），配合令牌里的明确 lineHeight，
//   不同品牌安卓机上的垂直位置才一致；
// - 字距：令牌里的负字距只对数字 / 拉丁有意义，中文 / 混合文本一律按 0 处理（UI_RULES 第 2 节）；
// - 等宽数字：统一加 fontVariant ['tabular-nums']，列表里的数字列才对得齐。
//
// 用法
//   <AppText variant="headline">午餐</AppText>
//   <AppText variant="subhead" color={semantic.textSecondary}>类别 · 现金</AppText>
//   <AppText variant="display" color={semantic.textPrimary}>28,797.59</AppText>
//
// ⚠ 页面里不要再直接用 RN 的 Text + 写死 fontSize（UI_RULES 第 7 节：令牌外的字号一律退回重做）。

import React, { useMemo } from 'react';
import { StyleProp, Text, TextProps, TextStyle } from 'react-native';
import {
  canUseCjkText,
  canUseLatinText,
  FontWeightKey,
  TypographyVariant,
} from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';

export interface AppTextProps extends TextProps {
  /** 字号档位（默认 body） */
  variant?: TypographyVariant;
  /** 文字颜色（默认 semantic.textPrimary；页面按语义传 accentText / textSecondary / danger …） */
  color?: string;
  /** 字重覆盖（默认用 variant 自带档位；只有确实需要时用，如 subhead 加粗到 500） */
  weight?: FontWeightKey;
  /** 水平对齐（等价写法，省得到处写 style={{ textAlign }}） */
  align?: TextStyle['textAlign'];
  /**
   * 字体分流：'auto'（默认）数字 / 拉丁走 Inter、含中文走 Noto Sans SC、
   * 含 emoji / 假名 / 子集外生僻字回退系统字体；'system' 强制系统字体
   * （段落里混排、需要和系统字形一致时用）。
   */
  font?: 'auto' | 'system';
  style?: StyleProp<TextStyle>;
  children?: React.ReactNode;
}

/**
 * 取出 children 的纯文本（只认字符串 / 数字）。
 * 里面套了别的元素（嵌套 Text、图标组件等）拿不准是什么字形 → 返回 null，
 * 调用方按「回退系统字体」处理（系统字体中英文都有，最安全）。
 */
function flattenText(children: React.ReactNode): string | null {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (children === null || children === undefined || typeof children === 'boolean') return '';

  let text = '';
  let known = true;
  React.Children.forEach(children, (child) => {
    if (!known) return;
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child);
    } else if (child === null || child === undefined || typeof child === 'boolean') {
      // 跳过
    } else {
      known = false;
    }
  });
  return known ? text : null;
}

export function AppText({
  variant = 'body',
  color,
  weight,
  align,
  font = 'auto',
  style,
  children,
  ...rest
}: AppTextProps) {
  const { typography, semantic, fontFamilyByWeight, fontFamilyCjkByWeight } = useTheme();
  const token = typography[variant];

  // 字体分流（V2.2c）：纯拉丁/数字 → Inter；拉丁 + 中文/全角 → Noto Sans SC 子集；
  // 其余（emoji、假名、谚文、生僻字…）→ 系统字体（打包字体没这些字形，强套会变方框）
  const rawText = useMemo(() => flattenText(children), [children]);
  const useLatinFont = font === 'auto' && rawText !== null && canUseLatinText(rawText);
  const useCjkFont = font === 'auto' && rawText !== null && !useLatinFont && canUseCjkText(rawText);
  const resolvedWeight = (weight ?? String(token.fontWeight)) as FontWeightKey;
  const packedFamily = useLatinFont
    ? fontFamilyByWeight[resolvedWeight]
    : useCjkFont
      ? fontFamilyCjkByWeight[resolvedWeight]
      : undefined;

  const textStyle: TextStyle = {
    fontSize: token.fontSize,
    // 中文行高 ≥1.30（tokens: typography.variants[x].lineHeightCjk）：
    // 判定为 CJK 字体分流时用中文档，纯数字 / 拉丁仍用更紧的拉丁档
    lineHeight: useCjkFont ? token.lineHeightCjk : token.lineHeight,
    // 打包的是静态字重字体（Inter-SemiBold / NotoSansSC-Bold 等），不能再给 fontWeight，
    // 否则安卓会去合成加粗 / iOS 会二次加粗（约定：家族名即字重）
    fontWeight: packedFamily ? 'normal' : token.fontWeight,
    fontFamily: packedFamily,
    // 负字距只对数字 / 拉丁有意义：中文文本（含中英混排）一律 0
    letterSpacing: useLatinFont ? token.letterSpacing : 0,
    // 等宽数字：金额列 / 日期列 / 统计数字不会左右晃
    fontVariant: ['tabular-nums'],
    // 安卓默认给文字加额外上下内边距（中英文基线上浮），统一关掉，垂直位置只由 lineHeight 决定
    includeFontPadding: false,
    color: color ?? semantic.textPrimary,
  };

  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={rest.maxFontSizeMultiplier ?? token.maxFontSizeMultiplier}
      style={[textStyle, align ? { textAlign: align } : null, style]}
    >
      {children}
    </Text>
  );
}

export default AppText;
