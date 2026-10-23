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
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import AppText from './ui/AppText';
import TransactionRow from './ui/TransactionRow';

export interface AccountTransactionListProps {
  /** 已按账户筛好的交易（新的在前） */
  transactions: Transaction[];
  categories: Category[];
  /** 最多显示多少条（其余只报数量，不做分页——账户详情是抽屉，不是流水页面） */
  limit?: number;
  hideAmount?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const FEE_LABEL_KEY = 'asset.txFee';

export function AccountTransactionList({
  transactions,
  categories,
  limit = 8,
  hideAmount,
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
        empty: { paddingVertical: spacing.sm },
        rest: { paddingTop: spacing.xs },
      }),
    [semantic, spacing]
  );

  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <View style={styles.head}>
        <AppText variant="headline" color={semantic.textPrimary}>
          {t('asset.recentTransactions')}
        </AppText>
        <AppText variant="caption" color={semantic.textTertiary}>
          {transactions.length}
        </AppText>
      </View>
      <View style={styles.divider} />
      {shown.length === 0 ? (
        <AppText variant="footnote" color={semantic.textTertiary} style={styles.empty}>
          {t('asset.transactionsEmpty')}
        </AppText>
      ) : (
        shown.map((tx) => {
          const cat = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
          const kind = tx.type === 'expense' ? 'expense' : tx.type === 'income' ? 'income' : 'transfer';
          // 转账：转出计 amount + fee（与 computeAssetFlowStats 的流出口径一致）
          const amount =
            tx.type === 'transfer' ? (tx.convertedAmount ?? tx.amount) + (tx.fee ?? 0) : tx.amount;
          return (
            <TransactionRow
              key={tx.id}
              note={tx.note || tx.displayName}
              categoryName={
                cat?.name ??
                (tx.type === 'transfer' ? t('home.transfer') : (tx.displayName ?? t(FEE_LABEL_KEY)))
              }
              categoryIcon={cat?.icon as React.ComponentProps<typeof TransactionRow>['categoryIcon']}
              categoryColor={cat?.color}
              amount={amount}
              kind={kind}
              hideAmount={hideAmount}
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
