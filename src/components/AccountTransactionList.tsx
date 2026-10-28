// AccountTransactionList.tsx
// 账户详情里的「该账户交易流水」（设计稿有、原代码没有的缺口之一）。
//
// 数据来源（只读，不改任何记账规则）
//   AppContext.transactions 里与这个账户相关的记录：
//     - expense / income：assetId === 账户 id
//     - transfer：fromAssetId（转出，金额 = amount + fee）或 toAssetId（转入，金额 = convertedAmount ?? amount）
//   这与 AssetScreen 顶部「本月流入/流出」（computeAssetFlowStats）用的是同一套账户归属口径，
//   只是不再只看本月、也不再只求合计。
//
// 渲染复用 ui/TransactionRow（全 App 唯一的交易行），金额颜色走 MoneyText 的语义色：
// 支出 = amount.expense（红）。

import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import type { Category, Transaction } from '../types';
import type { MoneyKind } from '../utils/formatMoney';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import AppText from './ui/AppText';
import EmptyState from './ui/EmptyState';
import TransactionRow from './ui/TransactionRow';

/**
 * 行副标题里的时间：流水只有日期（YYYY-MM-DD）→ 本年只印 MM-DD，跨年补年份。
 * 纯展示，不参与排序 / 归属口径（那两件仍在 AssetScreen 的 accountTransactions 里）。
 */
function rowDateLabel(date: string): string {
  const [y, m, d] = date.split('-');
  if (!m || !d) return date;
  return y === String(new Date().getFullYear()) ? `${m}-${d}` : `${y}-${m}-${d}`;
}

export interface AccountTransactionListProps {
  /** 已按账户筛好的交易（新的在前） */
  transactions: Transaction[];
  /**
   * 正在查看的账户 id。必需：转账要判断「本账户是转出方还是转入方」——
   * 转出方显示 −(amount+fee)，转入方显示 +(convertedAmount)，两边金额本来就不一样。
   */
  assetId?: string;
  /** 本账户币种（转账明细里跟金额一起显示，避免两个币种的数字看起来一样） */
  currency?: string;
  /** 点某一行（传出去跳账单详情；不传则整行不可点，行为与以前一致） */
  onPressTx?: (tx: Transaction) => void;
  categories: Category[];
  /** 最多显示多少条（其余只报数量，不做分页——账户详情是抽屉，不是流水页面） */
  limit?: number;
  hideAmount?: boolean;
  /**
   * 不画本组标题行（抽屉里的「交易记录」分段已经给了段名，避免标题重复）；
   * 默认 false = 保留「账户流水 + 条数」，其他调用点外观不变。
   */
  hideHeader?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const FEE_LABEL_KEY = 'asset.txFee';

export function AccountTransactionList({
  transactions,
  categories,
  assetId,
  currency,
  onPressTx,
  limit = 8,
  hideAmount,
  hideHeader,
  style,
  testID,
}: AccountTransactionListProps) {
  const { semantic, spacing } = useTheme();
  const t = useT();
  const categoryById = useMemo(() => {
    const m = new Map<string, Category>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  const shown = transactions.slice(0, limit);
  const rest = Math.max(0, transactions.length - shown.length);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: spacing.xs },
        head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
        divider: { height: StyleSheet.hairlineWidth, backgroundColor: semantic.hairline },
        rest: { paddingTop: spacing.xs },
      }),
    [semantic, spacing]
  );

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      {!hideHeader && (
        <>
          <View style={styles.head}>
            <AppText variant="headline" color={semantic.textPrimary}>
              {t('asset.recentTransactions')}
            </AppText>
            <AppText variant="caption" color={semantic.textTertiary}>
              {transactions.length}
            </AppText>
          </View>
          <View style={styles.divider} />
        </>
      )}
      {shown.length === 0 ? (
        /* 空态统一走 ui/EmptyState（全 App 只有这一种空状态画法） */
        <EmptyState
          icon="receipt-outline"
          title={t('asset.transactionsEmpty')}
          testID={testID ? `${testID}-empty` : undefined}
        />
      ) : (
        shown.map((tx) => {
          const cat = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
          // 转账按「本账户是哪一侧」来算：
          //   转出方 → −(amount + fee)（与 computeAssetFlowStats 的流出口径一致）
          //   转入方 → +(convertedAmount)
          // 以前一律取 convertedAmount，导致转出账户的明细里显示的是到账额（用户 2026-10-28 反馈）。
          const isTransfer = tx.type === 'transfer';
          const isOutgoing = isTransfer && !!assetId && tx.fromAssetId === assetId;
          const kind: MoneyKind = !isTransfer
            ? tx.type === 'expense'
              ? 'expense'
              : 'income'
            : isOutgoing
              ? 'expense'
              : 'income';
          const amount = !isTransfer
            ? tx.amount
            : isOutgoing
              ? tx.amount + (tx.fee ?? 0)
              : (tx.convertedAmount ?? tx.amount);
          return (
            <TransactionRow
              key={tx.id}
              note={tx.note || tx.displayName}
              categoryName={
                cat?.name ??
                (tx.type === 'transfer' ? t('addTx.transfer') : (tx.displayName ?? t(FEE_LABEL_KEY)))
              }
              categoryIcon={cat?.icon as React.ComponentProps<typeof TransactionRow>['categoryIcon']}
              categoryColor={cat?.color}
              amount={amount}
              kind={kind}
              currency={isTransfer ? currency : undefined}
              showCurrency={!!currency && isTransfer}
              currencyPosition="suffix"
              meta={rowDateLabel(tx.date)}
              hideAmount={hideAmount}
              onPress={onPressTx ? () => onPressTx(tx) : undefined}
              testID={`asset-tx-${tx.id}`}
            />
          );
        })
      )}
      {rest > 0 && (
        <AppText variant="caption2" color={semantic.textTertiary} style={styles.rest}>
          {t('asset.transactionsMore', { n: rest })}
        </AppText>
      )}
    </View>
  );
}

export default AccountTransactionList;
