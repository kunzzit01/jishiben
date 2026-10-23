// TransactionRow.tsx
// 账单行（T04 / 计划 4.5、10.1）：全 App 的「交易行」统一用它（UI_RULES 第 7 节：列表行只有
// ListRow / TransactionRow 两种）。
//
// 三块结构
//   左：40 图标方块（类别色 12% 底 + 100% 类别色图标；全 App 同一种画法，不上大色块）
//   中：标题（有备注用备注，没备注用类别名，最多 2 行）+ 副标题（类别 · 账户 · 时间，1 行）
//   右：MoneyText（等宽数字、自带 flexShrink:0 —— 金额永不被挤压、永不换行）
//
// 中英文不撞（UI_RULES 第 6 节）
// - 不写固定高度，只给 minHeight（useLayout().rowMinHeight）+ 内边距；
// - 中间文字块 flex:1：长备注换行 / 变窄都行，金额始终被顶到行尾对齐；
// - 字号全部走 AppText / MoneyText 的令牌档位，不缩字、不省略（备注 2 行封顶是唯一上限）。
//
// 用法（副标题第三段 meta 只给「账户详情里的流水」补时间，其他调用点不传就不占位）
//   <TransactionRow note={tx.note} categoryName="餐饮" categoryIcon="restaurant-outline"
//                  categoryColor={cat.color} accountName="现金" amount={36.5} kind="expense"
//                  onPress={() => openDetail(tx)} />

import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from '../PressableScale';
import type { Layout, Radius, SemanticColors, Spacing } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import { useLayout } from '../../theme/useLayout';
import type { MoneyKind } from '../../utils/formatMoney';
import AppText from './AppText';
import MoneyText from './MoneyText';
import { withAlpha } from './color';

/** 左侧图标方块边长（UI_RULES 第 7 节：40 方块 + 类别色 12% 底）—— 纯图形常量 */
const ICON_BOX_SIZE = 40;
/** 方块内图标尺寸（20 / 24 两档里取小档）—— 纯图形常量 */
const ICON_SIZE = 20;
/** 类别图标缺省值：没有类别图标名时方块不能空着，用价签兜底 */
const FALLBACK_CATEGORY_ICON: React.ComponentProps<typeof Ionicons>['name'] = 'pricetag-outline';
/** 类别色淡底透明度（UI_RULES 第 1 节：类别色 12% 底 + 100% 图标） */
const CATEGORY_TINT_ALPHA = 0.12;
/** 按压反馈档：整行是大目标，用通用 0.98 */
const ROW_ACTIVE_SCALE = 0.98;

export interface TransactionRowProps {
  /** 备注；空 / 纯空白 → 标题改用类别名 */
  note?: string;
  categoryName: string;
  /** 类别图标（Ionicons；缺省用价签兜底） */
  categoryIcon?: React.ComponentProps<typeof Ionicons>['name'];
  /** 类别色 hex；缺省用 semantic.accent */
  categoryColor?: string;
  /** 账户名（副标题第二段） */
  accountName?: string;
  /** 副标题第三段（账户详情里的流水时间，如 10-23）；缺省不占位 */
  meta?: string;
  amount: number;
  /** 金额语义（默认 'expense'：中性色 + 真减号） */
  kind?: MoneyKind;
  /** 隐私模式隐藏金额（••••••） */
  hideAmount?: boolean;
  currency?: string;
  showCurrency?: boolean;
  currencyPosition?: 'prefix' | 'suffix';
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

export function TransactionRow({
  note,
  categoryName,
  categoryIcon,
  categoryColor,
  accountName,
  meta,
  amount,
  kind = 'expense',
  hideAmount,
  currency,
  showCurrency,
  currencyPosition,
  onPress,
  onLongPress,
  style,
  accessibilityLabel,
  testID,
}: TransactionRowProps) {
  const { semantic, spacing, layout, radius } = useTheme();
  const { rowMinHeight } = useLayout();

  const styles = useMemo(
    () => makeStyles(semantic, spacing, layout, radius, rowMinHeight),
    [semantic, spacing, layout, radius, rowMinHeight]
  );

  // 空备注（含纯空白）不算备注：空着一行反而显脏，这时标题给类别名
  const trimmedNote = note?.trim() ?? '';
  const title = trimmedNote.length > 0 ? trimmedNote : categoryName;
  // 副标题：类别 · 账户 · 时间（缺哪段就少哪段，不留下孤零零的分隔点）
  const subtitle = [categoryName, accountName, meta]
    .filter((part): part is string => !!part)
    .join(' · ');

  const tint = categoryColor ?? semantic.accent;
  const iconTint = categoryColor ?? semantic.accentText;

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      activeScale={ROW_ACTIVE_SCALE}
      // 行本身已经 ≥56 高，外扩 hitSlop 会抢到相邻行的手势，所以不外扩
      hitSlop={0}
      style={[styles.row, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {/* 左：类别图标方块（40×40 纯图形，允许定死边长；底色用类别色 12% 派生） */}
      <View style={[styles.iconBox, { backgroundColor: withAlpha(tint, CATEGORY_TINT_ALPHA) }]}>
        <Ionicons name={categoryIcon ?? FALLBACK_CATEGORY_ICON} size={ICON_SIZE} color={iconTint} />
      </View>

      {/* 中：flex:1 吃掉剩余宽度，把金额顶到行尾 */}
      <View style={styles.textBlock}>
        <AppText variant="headline" numberOfLines={2}>
          {title}
        </AppText>
        <AppText variant="footnote" color={semantic.textSecondary} numberOfLines={1}>
          {subtitle}
        </AppText>
      </View>

      {/* 右：金额（MoneyText 自带 flexShrink:0，不要在外面包固定宽度） */}
      <MoneyText
        value={amount}
        kind={kind}
        hidden={hideAmount}
        currency={currency}
        showCurrency={showCurrency}
        currencyPosition={currencyPosition}
        variant="body"
      />
    </PressableScale>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(
  semantic: SemanticColors,
  spacing: Spacing,
  layout: Layout,
  radius: Radius,
  rowMinHeight: number
) {
  return StyleSheet.create({
    row: {
      minHeight: rowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
    },
    iconBox: {
      width: ICON_BOX_SIZE,
      height: ICON_BOX_SIZE,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    // 文字块吃掉剩余宽度（flex:1 = 可长可缩、基宽 0）：标题换行只让行变高，
    // 金额永远被顶到行尾且不参与压缩
    textBlock: { flex: 1 },
  });
}

export default TransactionRow;
