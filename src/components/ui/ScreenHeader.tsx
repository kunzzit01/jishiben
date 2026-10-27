// ScreenHeader.tsx
// 统一页头（T03 / 计划 4.5、10.1 —— 取代现在 13 种各写各的页头）。
//
// 只有两种
//   root    Tab 根页：左对齐大标题（title1 28/700）、无返回键；可带一行说明
//   compact 二级页：返回键 + 居中标题 + 右侧动作
//
// 二级页的两种排法（2026-10-09 验收退回第 1 条定的规矩）
//   1) 常规：顶栏一条，[返回键] [居中标题] [右侧动作]，标题真居中
//      （两侧槽位 onLayout 实测各自内容宽、取最大值同步给两边 —— 纯 flex 做不到）；
//   2) **标题在居中栏里放不下一行时**：改 iOS 做法 —— 顶栏只留返回键与右侧动作，
//      标题移到顶栏下方、左对齐、占满整行宽度（最多 3 行）。
//      ⚠ 判定必须靠实测（标题实测高度 > 单行高）：窄中栏里英文会一行一个词、
//        甚至被 word-break 从单词中间劈开（真机/浏览器都见过 "breakdo/wn"）。
//   换标题或换屏幕宽度会重新判定。
//
// 中英文不撞（UI_RULES 第 6 节 / 计划 9.2）：容器只给 minHeight，永不写死高度；
// 标题最多 3 行（超过就截断，这是验收时用户点名的上限）。

import React, { useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, PixelRatio, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useLayout } from '../../theme/useLayout';
import { Spacing } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import AppText from './AppText';
import IconButton from './IconButton';

export interface ScreenHeaderProps {
  /** 页头形态：root = Tab 根页大标题 · compact = 二级页（默认） */
  variant?: 'root' | 'compact';
  title: string;
  /** 标题下方一行说明（可选，footnote） */
  subtitle?: string;
  /** 返回键回调；compact 且传了才显示返回键 */
  onBack?: () => void;
  /** 返回键的读屏标签（默认 i18n common.back） */
  backAccessibilityLabel?: string;
  /** 右侧动作（IconButton / Button，一个到两个） */
  right?: React.ReactNode;
  /** 自带左右页边距（默认 true：用 useLayout().pagePadding，平板自动 20） */
  padded?: boolean;
  /** 标题最多几行（默认 3 —— 超过 3 行的界面标题一律截断，用户定的上限） */
  titleNumberOfLines?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 两侧槽位初始宽（= 返回键一个触控区；实测到真实宽度后覆盖） */
const MIN_SIDE_WIDTH = 44;
/** 标题换行判定容差：实测高 > 单行高 × 1.5 才算「不止一行」 */
const WRAP_TOLERANCE = 1.5;
/** 标题默认行数上限 */
const DEFAULT_TITLE_LINES = 3;

export function ScreenHeader({
  variant = 'compact',
  title,
  subtitle,
  onBack,
  backAccessibilityLabel,
  right,
  padded = true,
  titleNumberOfLines = DEFAULT_TITLE_LINES,
  style,
  testID,
}: ScreenHeaderProps) {
  const { semantic, spacing, typography } = useTheme();
  const { pagePadding, width: layoutWidth } = useLayout();
  const tr = useT();
  const styles = useMemo(() => makeStyles(spacing), [spacing]);

  // 两侧各自实测「内容」宽度（量内容包装层，不量被 minWidth 撑过的槽位，避免自我放大）
  const [leftWidth, setLeftWidth] = useState(MIN_SIDE_WIDTH);
  const [rightWidth, setRightWidth] = useState(0);
  const sideWidth = Math.max(MIN_SIDE_WIDTH, leftWidth, rightWidth);

  // 标题是否放不下居中栏（实测高度超过一行）→ 切到「标题移到顶栏下方」的版式
  const [stacked, setStacked] = useState(false);
  const [titleHeight, setTitleHeight] = useState(0);
  // 单行高（跟着系统「大字」缩放走，并封顶在 AppText 的 maxFontSizeMultiplier）
  const fontScale = Math.min(PixelRatio.getFontScale(), typography.title3.maxFontSizeMultiplier);
  const singleLineHeight = typography.title3.lineHeight * fontScale;

  useEffect(() => {
    if (!stacked && titleHeight > singleLineHeight * WRAP_TOLERANCE) setStacked(true);
  }, [titleHeight, singleLineHeight, stacked]);

  // 换标题 / 换屏幕宽度（旋转、分屏、折叠屏展开）重新判定
  useEffect(() => {
    setStacked(false);
    setTitleHeight(0);
  }, [title, layoutWidth]);

  const onLeftLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== leftWidth) setLeftWidth(w);
  };
  const onRightLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w !== rightWidth) setRightWidth(w);
  };

  const paddingStyle = padded ? { paddingHorizontal: pagePadding } : null;

  if (variant === 'root') {
    return (
      <View style={[styles.root, paddingStyle, style]} testID={testID}>
        <AppText variant="title1" numberOfLines={titleNumberOfLines}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="footnote" color={semantic.textSecondary} style={styles.subtitle}>
            {subtitle}
          </AppText>
        )}
      </View>
    );
  }

  // 返回键：36 圆 + 浅底 + 发丝边（与首页顶部那组圆形工具键同一套语言）
  const backButton = onBack ? (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: semantic.surfaceElevated,
        borderWidth: 1,
        borderColor: semantic.hairline,
        boxShadow: '0 2px 8px rgba(7,28,73,0.10)',
      }}
    >
      <IconButton
        icon="chevron-back"
        accessibilityLabel={backAccessibilityLabel ?? tr('common.back')}
        onPress={onBack}
      />
    </View>
  ) : null;

  // 版式 2：顶栏只有返回键 + 右侧动作，标题在下方左对齐占满整行
  if (stacked) {
    return (
      <View style={[paddingStyle, style]} testID={testID}>
        <View style={styles.barRow}>
          <View style={styles.side}>
            <View style={styles.sideContent} onLayout={onLeftLayout}>
              {backButton}
            </View>
          </View>
          <View style={styles.barSpacer} />
          <View style={[styles.side, styles.sideRight]}>
            <View style={styles.sideContent} onLayout={onRightLayout}>
              {right}
            </View>
          </View>
        </View>
        <AppText variant="title3" numberOfLines={titleNumberOfLines} style={styles.stackedTitle}>
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="footnote" color={semantic.textSecondary} style={styles.subtitle}>
            {subtitle}
          </AppText>
        )}
      </View>
    );
  }

  // 版式 1：一条顶栏，标题居中（两侧槽位等宽，靠实测对齐）
  return (
    <View style={[styles.row, paddingStyle, style]} testID={testID}>
      <View style={[styles.side, { minWidth: sideWidth }]}>
        <View style={styles.sideContent} onLayout={onLeftLayout}>
          {backButton}
        </View>
      </View>

      <View style={styles.center}>
        <AppText
          variant="title3"
          align="center"
          numberOfLines={titleNumberOfLines}
          onLayout={(e) => setTitleHeight(e.nativeEvent.layout.height)}
        >
          {title}
        </AppText>
        {!!subtitle && (
          <AppText variant="footnote" color={semantic.textSecondary} align="center" style={styles.subtitle}>
            {subtitle}
          </AppText>
        )}
      </View>

      <View style={[styles.side, styles.sideRight, { minWidth: sideWidth }]}>
        <View style={styles.sideContent} onLayout={onRightLayout}>
          {right}
        </View>
      </View>
    </View>
  );
}

/** 令牌进、StyleSheet 出（间距走令牌，禁止写死数字；色值都在渲染期内联给） */
function makeStyles(spacing: Spacing) {
  return StyleSheet.create({
    root: { paddingTop: spacing.sm, paddingBottom: spacing.md, minHeight: 44, justifyContent: 'center' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      paddingVertical: spacing.sm,
    },
    // 版式 2 的顶栏：左右贴边、中间留空
    barRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingTop: spacing.sm },
    barSpacer: { flex: 1 },
    stackedTitle: { marginTop: spacing.xs },
    side: { flexShrink: 0, minHeight: 44, justifyContent: 'center', alignItems: 'flex-start' },
    sideRight: { alignItems: 'flex-end' },
    // 只包内容、不定宽：onLayout 量到的就是右侧动作的真实宽度
    sideContent: { flexDirection: 'row', alignItems: 'center' },
    center: { flex: 1, paddingHorizontal: spacing.sm, justifyContent: 'center' },
    subtitle: { marginTop: spacing.xs },
  });
}

export default ScreenHeader;
