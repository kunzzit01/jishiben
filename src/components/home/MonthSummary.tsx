// MonthSummary.tsx
// 首页「本月收入 / 本月支出」横向汇总面板（design/reference/home-day.png 与 home-night.png
// 里 Hero 卡下方那条两列汇总）。
//
// 结构：一个圆角面板 = 两个等宽列（各 flex 1）+ 中间 1px 竖向发丝线。
// 每列 = 左侧 38 圆形底板（收入 incomeSoft / 支出 expenseSoft，圈内箭头用 react-native-svg 画）
//        + 右侧上下两行（标签 12/500、金额 20/700，小数段小一号）。
//
// 为什么金额要自己判档位（而不是固定 20 号）：
//   面板宽 = 屏宽 − 32（HomeScreen 区块统一 paddingHorizontal: layout.page），减掉面板内边距 32
//   与分隔线后一列只剩 ~118px（320 屏）/ ~154px（390 屏），再减 38 圆与间距；
//   20 号字下 "8,500.00" 实测 87px、加 "RM " 前缀 118px —— 320/390 上直接画会溢出被裁。
//   adjustsFontSizeToFit 明确不用（连续压缩、字重观感漂移），改成离散档位 20 → 17 → 15
//   （全部落在 typography 令牌上）+ 逐字符估宽选档；同档位放不下时先让位「币种前缀」
//   （装饰），金额（数据）优先保住。估宽表的 em 值实测自 assets/fonts/Inter-Bold.ttf。
//
// 颜色一律 useHomePalette()（本文件 0 个 hex 字面量），几何只用 spacing / radius 令牌。

import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import AppText from '../ui/AppText';
import { useHomePalette } from '../../theme/homePalette';
import { useTheme } from '../../theme/useTheme';
import { canUseLatinText, layout, typography } from '../../theme/theme';

/** 圆形底板直径（参考图实测约 35–38）与圈内箭头尺寸 */
const ICON_DIAMETER = 38;
const ARROW_SIZE = 24;

/** 一个档位内各段的字号（dp）：整数段 / 小数段（小一号）/ 币种前缀（比整数段小 3） */
type AmountTier = {
  size: number;
  lineHeight: number;
  decimal: number;
  symbol: number;
};

const AMOUNT_TIERS: readonly AmountTier[] = [
  // 20 / 17 / 17 —— 默认档
  {
    size: typography.title3.fontSize,
    lineHeight: typography.title3.lineHeight,
    decimal: typography.headline.fontSize,
    symbol: typography.title3.fontSize - 3,
  },
  // 17 / 15 / 14 —— 窄屏档
  {
    size: typography.headline.fontSize,
    lineHeight: typography.headline.lineHeight,
    decimal: typography.subhead.fontSize,
    symbol: typography.headline.fontSize - 3,
  },
  // 15 / 13 / 12 —— 兜底档（超长金额时才会出现，保证任何情况都不裁字）
  {
    size: typography.subhead.fontSize,
    lineHeight: typography.subhead.lineHeight,
    decimal: typography.footnote.fontSize,
    symbol: typography.subhead.fontSize - 3,
  },
];

const FALLBACK_TIER = AMOUNT_TIERS[AMOUNT_TIERS.length - 1] ?? {
  size: typography.subhead.fontSize,
  lineHeight: typography.subhead.lineHeight,
  decimal: typography.footnote.fontSize,
  symbol: typography.subhead.fontSize - 3,
};

/* ───────────────────────────── 宽度估算（只判放不放得下，不参与排版） ─────────────────────────────
 * em 值 = 用 assets/fonts/Inter-Bold.ttf 以 100px 量出的 getlength / 100：
 *   数字 0.67 · ',' '.' 0.33 · 空格 0.24 · 'R' 0.66 · 'M' 0.93。
 * 大写字母取 0.85（介于最窄 I 0.28 与最宽 M 0.93 之间偏大，宁可多算）；
 * 其余未知字符按 1.02（最宽字形）估。排版永远交给 flex。
 */
const DIGIT_EM = 0.67;
const SEPARATOR_EM = 0.33;
const SPACE_EM = 0.24;
const UPPER_EM = 0.85;
const LOWER_EM = 0.6;
const UNKNOWN_EM = 1.02;
/** 估算余量（3%）：宁可早降一档，也不能把最后一位数字挤出列外 */
const FIT_SAFETY = 1.03;

function estimateEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') em += DIGIT_EM;
    else if (ch === ',' || ch === '.') em += SEPARATOR_EM;
    else if (ch === ' ') em += SPACE_EM;
    else if (ch >= 'A' && ch <= 'Z') em += UPPER_EM;
    else if (ch >= 'a' && ch <= 'z') em += LOWER_EM;
    else em += UNKNOWN_EM;
  }
  return em;
}

/** 金额行在某个档位下的估算宽度（px）：币种前缀 + 空格 + 整数段 + 小数段 */
function estimateLineWidth(integer: string, decimal: string, prefix: string, tier: AmountTier): number {
  const integerWidth = estimateEm(integer) * tier.size;
  const decimalWidth = estimateEm(decimal) * tier.decimal;
  const prefixWidth = prefix.length > 0 ? (estimateEm(prefix) + SPACE_EM) * tier.symbol : 0;
  return (integerWidth + decimalWidth + prefixWidth) * FIT_SAFETY;
}

/** 拆出小数段（含小数点）：金额是外部格式化好的字符串，这里只负责分段渲染 */
function splitAmount(amount: string): { integer: string; decimal: string } {
  const text = amount.trim();
  const dot = text.indexOf('.');
  return dot === -1
    ? { integer: text, decimal: '' }
    : { integer: text.slice(0, dot), decimal: text.slice(dot) };
}

/* ───────────────────────────── 圈内箭头（单笔画，24 栅格） ───────────────────────────── */

function ArrowUp({ color }: { color: string }) {
  return (
    <Svg width={ARROW_SIZE} height={ARROW_SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 19V5M5 12l7-7 7 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ArrowDown({ color }: { color: string }) {
  return (
    <Svg width={ARROW_SIZE} height={ARROW_SIZE} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 5v14M5 12l7 7 7-7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* ───────────────────────────── 金额行：三段字号、同一基线 ───────────────────────────── */

type AmountLineProps = {
  amount: string;
  symbol: string;
  showSymbol: boolean;
  symbolColor: string;
  primaryColor: string;
  decimalColor: string;
  tier: AmountTier;
  amountFont: string;
  symbolFont: string;
};

function AmountLine({
  amount,
  symbol,
  showSymbol,
  symbolColor,
  primaryColor,
  decimalColor,
  tier,
  amountFont,
  symbolFont,
}: AmountLineProps) {
  const { integer, decimal } = splitAmount(amount);

  return (
    /*
      三段不同字号必须画成「一个 Text 里的嵌套 Text」：RN 文本布局沿同一基线排下去。
      若拆成三个并列 <Text> 再靠 alignItems: 'baseline' 对齐，iOS / Android / Web 三端
      取基线的方式不一致，小数段会上下错位。
    */
    <Text
      style={{
        fontFamily: amountFont,
        fontSize: tier.size,
        lineHeight: tier.lineHeight,
        color: primaryColor,
        fontVariant: ['tabular-nums'],
        includeFontPadding: false,
      }}
      numberOfLines={1}
      maxFontSizeMultiplier={1.15}
    >
      {showSymbol ? (
        <Text
          style={{
            fontFamily: symbolFont,
            fontSize: tier.symbol,
            lineHeight: tier.lineHeight,
            color: symbolColor,
          }}
        >
          {symbol + ' '}
        </Text>
      ) : null}
      <Text style={{ fontSize: tier.size, lineHeight: tier.lineHeight, color: primaryColor }}>
        {integer}
      </Text>
      {decimal.length > 0 ? (
        <Text style={{ fontSize: tier.decimal, lineHeight: tier.lineHeight, color: decimalColor }}>
          {decimal}
        </Text>
      ) : null}
    </Text>
  );
}

/* ──────────────────────────────────────── 组件 ──────────────────────────────────────── */

export function MonthSummary(props: {
  income: string;          // 已格式化的金额字符串（不含正负号、不含币种）
  expense: string;
  incomeLabel: string;
  expenseLabel: string;
  symbol: string;          // 币种符号，如 "RM"，画在金额前、比金额小一号
  onPressIncome?: () => void;
  onPressExpense?: () => void;
}): React.ReactElement {
  const {
    income,
    expense,
    incomeLabel,
    expenseLabel,
    symbol,
    onPressIncome,
    onPressExpense,
  } = props;
  const palette = useHomePalette();
  const { spacing, radius, fontFamilyByWeight, fontFamilyCjkByWeight } = useTheme();
  const { width: windowWidth } = useWindowDimensions();

  // 窄屏收紧横向间距，把宽度让给金额（320 屏上这两项共让出 8px，正是 17 号档放得下的关键）
  const compact = windowWidth < 340;
  const iconGap = compact ? spacing.xs : spacing.sm;
  const dividerMargin = compact ? spacing.xs : spacing.sm;

  // 首帧还没拿到实测宽时，用「屏宽 − 页面边距 − 面板内边距 − 分隔线」推导，
  // 免得先按大档位画一帧再缩回来
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const seedWidth =
    (windowWidth - layout.page * 2 - 2 - spacing.lg * 2 - (1 + dividerMargin * 2)) / 2 -
    ICON_DIAMETER -
    iconGap;
  const availableWidth = measuredWidth > 0 ? measuredWidth : Math.max(seedWidth, 0);

  const incomeParts = splitAmount(income);
  const expenseParts = splitAmount(expense);

  // 两列金额共用一档（左右字号必须一致），按较宽的那一列选档
  const { tier, showSymbol } = useMemo(() => {
    const widthsFor = (prefix: string, candidate: AmountTier) => {
      const incomeWidth = estimateLineWidth(
        incomeParts.integer,
        incomeParts.decimal,
        prefix,
        candidate
      );
      const expenseWidth = estimateLineWidth(
        expenseParts.integer,
        expenseParts.decimal,
        prefix,
        candidate
      );
      return Math.max(incomeWidth, expenseWidth);
    };

    for (const candidate of AMOUNT_TIERS) {
      if (widthsFor(symbol, candidate) <= availableWidth) {
        return { tier: candidate, showSymbol: symbol.length > 0 };
      }
      // 币种前缀是装饰、金额是数据：放不下前缀就先把它让掉，同一档位仍保持金额完整
      if (widthsFor('', candidate) <= availableWidth) {
        return { tier: candidate, showSymbol: false };
      }
    }
    // 连兜底档都放不下（超长金额）：停在兜底档 + 不带前缀，由 numberOfLines 兜住不换行
    return { tier: FALLBACK_TIER, showSymbol: false };
  }, [incomeParts, expenseParts, symbol, availableWidth]);

  const amountFont = fontFamilyByWeight['700'];
  // 币种前缀可能不是拉丁字形（如「元」），Inter 没有就用中文子集，避免豆腐块
  const symbolFont = canUseLatinText(symbol) ? amountFont : fontFamilyCjkByWeight['700'];

  // 金额列的实测宽 = 金额可用宽（两列等宽，量任意一列即可；列宽由 flex 决定，不随字号变化，
  // 不会有「量出来 → 换档 → 再量」的抖动）
  const handleColumnLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    if (next > 0 && Math.abs(next - measuredWidth) > 0.5) setMeasuredWidth(next);
  };

  const columns = [
    {
      key: 'income',
      label: incomeLabel,
      amount: income,
      soft: palette.incomeSoft,
      arrow: <ArrowUp color={palette.income} />,
      onPress: onPressIncome,
      onLayout: handleColumnLayout,
    },
    {
      key: 'expense',
      label: expenseLabel,
      amount: expense,
      soft: palette.expenseSoft,
      arrow: <ArrowDown color={palette.expense} />,
      onPress: onPressExpense,
      onLayout: undefined,
    },
  ];

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: palette.panel,
          borderColor: palette.border,
          borderRadius: radius.lg,
          padding: spacing.lg,
        },
      ]}
    >
      {/* 竖向分隔线：1px，竖跨面板 60%（上下各留 20%），无位移 */}
      <View pointerEvents="none" style={[styles.dividerLine, { backgroundColor: palette.hairline }]} />

      {columns.map((column, index) => (
        <React.Fragment key={column.key}>
          {index === 1 ? (
            // 等宽占位（不画线）：两列各 flex 1，线在占位处居中
            <View style={[styles.dividerTrack, { marginHorizontal: dividerMargin }]} />
          ) : null}
          <Pressable
            style={({ pressed }) => [
              styles.column,
              {
                borderRadius: radius.md,
                backgroundColor: pressed ? palette.surfaceSunken : 'transparent',
              },
            ]}
            onPress={column.onPress}
            disabled={!column.onPress}
            accessibilityRole={column.onPress ? 'button' : undefined}
            accessibilityLabel={`${column.label} ${showSymbol ? symbol : ''}${column.amount}`}
          >
            <View
              style={[
                styles.iconCircle,
                {
                  backgroundColor: column.soft,
                  borderRadius: radius.full,
                  marginRight: iconGap,
                },
              ]}
            >
              {column.arrow}
            </View>
            <View style={styles.textColumn} onLayout={column.onLayout}>
              <AppText variant="caption" color={palette.textSecondary} numberOfLines={1}>
                {column.label}
              </AppText>
              <AmountLine
                amount={column.amount}
                symbol={symbol}
                showSymbol={showSymbol}
                symbolColor={palette.textSecondary}
                primaryColor={palette.textPrimary}
                decimalColor={palette.textSecondary}
                tier={tier}
                amountFont={amountFont}
                symbolFont={symbolFont}
              />
            </View>
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    // relative：竖向分隔线按「面板高度」取 60%，而不是只按内容高
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
  },
  column: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconCircle: {
    width: ICON_DIAMETER,
    height: ICON_DIAMETER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  // 只占位、不画线：让两列严格等宽（线本体按面板高度绝对定位，见 dividerLine）
  dividerTrack: {
    width: 1,
  },
  dividerLine: {
    position: 'absolute',
    // 50% 处的 1px 线：左移半像素让它的中心压在列边界上
    left: '50%',
    marginLeft: -0.5,
    top: '20%',
    bottom: '20%',
    width: 1,
  },
});

export default MonthSummary;
