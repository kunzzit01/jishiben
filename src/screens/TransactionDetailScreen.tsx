// TransactionDetailScreen.tsx
// 账单详情（只读）：点列表里的一条账 → 先看「这笔记录了什么」，要改再进编辑页。
//
// 用户 2026-10-28 定版：以前点一条账直接跳到「记一笔」编辑态（金额键盘/分类网格全开着），
// 想核对该笔的账户/日期/备注要在一堆可编辑控件里找。现在：详情（只读）→ 点「编辑这笔」→ 编辑页。

import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import { formatMoney } from '../utils/formatMoney';
import { useTabClearance } from '../hooks/useTabClearance';
import { useDialog } from '../components/AppDialog';
import { AppText, Button, Card, HeroGradient, IconButton, ListRow, ListSection, MoneyText, ScreenHeader } from '../components/ui';
import { ROUTES } from '../navigation/routes';

/** 汇率反向写法用：1.6000 → 1.6（最多 4 位小数，去掉尾零） */
function trimZeros(n: number): string {
  return String(Number(n.toFixed(4)));
}

const CATEGORY_ICON_SIZE = 56;
const CATEGORY_GLYPH_SIZE = 26;

export default function TransactionDetailScreen({ navigation, route }: any) {
  const { semantic, spacing, radius } = useTheme();
  const { pagePadding } = useLayout();
  const t = useT();
  const dialog = useDialog();
  const tabClearance = useTabClearance();
  const { transactions, categories, ledgers, getAssetById, currencySymbol, deleteTransaction, currency: activeCurrency } = useApp();

  const transactionId: string | undefined = route?.params?.transactionId;
  const tx = useMemo(() => transactions.find((item) => item.id === transactionId), [transactions, transactionId]);
  const category = useMemo(() => (tx ? categories.find((c) => c.id === tx.categoryId) : undefined), [categories, tx]);

  if (!tx) {
    return (
      <SafeAreaView style={[styles.flex, { backgroundColor: semantic.bg }]} edges={['top']}>
        <HeroGradient fill />
        <ScreenHeader variant="compact" title={t('txDetail.title')} onBack={() => navigation.goBack()} />
        <View style={[styles.flex, styles.center, { padding: pagePadding }]}>
          <AppText variant="headline" color={semantic.textPrimary}>
            {t('txDetail.notFound')}
          </AppText>
        </View>
      </SafeAreaView>
    );
  }

  const isTransfer = tx.type === 'transfer';
  const isIncome = tx.type === 'income';
  // MoneyText 按 kind 自带符号（expense 负号 / income 正号 / transfer 无符号），不用再拼前缀
  const kind = isTransfer ? 'plain' : isIncome ? 'income' : 'expense';

  const asset = tx.assetId ? getAssetById(tx.assetId) : undefined;
  const fromAsset = tx.fromAssetId ? getAssetById(tx.fromAssetId) : undefined;
  const toAsset = tx.toAssetId ? getAssetById(tx.toAssetId) : undefined;
  const ledger = ledgers.find((l) => l.id === tx.ledgerId);

  // 跨币种的两侧币种不同 → 这笔就是「兑换」；同币种才是「转账」（与记一笔的两个入口一致）
  const isExchangeTx = isTransfer && !!fromAsset?.currency && !!toAsset?.currency && fromAsset.currency !== toAsset.currency;
  const transferKindLabel = isExchangeTx ? t('txDetail.typeExchange') : t('txDetail.typeTransfer');
  // 转账没有类别：这里直接显示「转账」+ 换向箭头，不再落到「未分类」（用户 2026-10-28 反馈）
  const categoryName = isTransfer
    ? transferKindLabel
    : category
      ? getCategoryLabel(category, t)
      : tx.displayName || t('txDetail.uncategorized');
  const categoryIcon = (isTransfer
    ? isExchangeTx ? 'repeat-outline' : 'swap-horizontal'
    : category?.icon ?? 'apps-outline') as React.ComponentProps<typeof Ionicons>['name'];
  const categoryColor = isTransfer ? semantic.accent : category?.color ?? semantic.accent;

  const typeLabel = isTransfer ? transferKindLabel : isIncome ? t('txDetail.typeIncome') : t('txDetail.typeExpense');

  /**
   * 转账的「本钱包视角」：
   * - 从某个钱包的流水点进来 → 路由带 perspectiveAssetId，直接用它
   * - 从首页点进来 → 看当前币种视图：命中转出币种就是转出视角，否则转入视角
   * 决定 hero 显示 −30（红）还是 +18.75（绿）——与首页那一行完全同一套口径。
   */
  const perspective: 'out' | 'in' = (() => {
    if (!isTransfer) return 'out';
    const pid: string | undefined = route?.params?.perspectiveAssetId;
    if (pid) return pid === tx.fromAssetId ? 'out' : 'in';
    const code = fromAsset?.currency;
    return activeCurrency && code && activeCurrency !== code ? 'in' : 'out';
  })();

  const heroTitle = isTransfer
    ? perspective === 'in'
      ? toAsset?.name ?? transferKindLabel
      : fromAsset?.name ?? transferKindLabel
    : categoryName;
  const heroAmount = isTransfer
    ? perspective === 'in'
      ? tx.convertedAmount ?? tx.amount
      : tx.amount + (tx.fee ?? 0)
    : tx.amount;
  const heroKind = isTransfer ? (perspective === 'in' ? 'income' : 'expense') : kind;
  // 与首页行一致：金额是本钱包币种，标注「另一侧」的币种（转入视角标转出币种，反之亦然）
  const heroCurrency = isTransfer
    ? `${transferKindLabel} · ${perspective === 'in' ? fromAsset?.currency ?? '' : toAsset?.currency ?? ''}`
    : '';
  const feeText = currencySymbol + String(tx.fee);

  const openEdit = () => navigation.navigate(ROUTES.ADD_TX, { editTransaction: tx });

  const confirmDelete = () => {
    dialog.alert({
      title: t('addTx.deleteTxTitle'),
      message: t('addTx.deleteTxMsg'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            deleteTransaction(tx.id);
            navigation.goBack();
          },
        },
      ],
    });
  };

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: semantic.bg }]} edges={['top', 'left', 'right']}>
      <HeroGradient fill />
      <ScreenHeader
        variant="compact"
        title={t('txDetail.title')}
        onBack={() => navigation.goBack()}
        right={
          <IconButton icon="create-outline" accessibilityLabel={t('txDetail.edit')} onPress={openEdit} testID="tx-detail-edit" />
        }
      />

      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: tabClearance + 24 }}
        showsVerticalScrollIndicator={false}
      >
        {/* hero 与其它交易完全同构：圆图标 + 名称 + 一个金额。
            转账只换「金额取哪一侧」：转出钱包 −30（红），转入钱包 +18.75（绿）。 */}
        <Card style={{ marginTop: spacing.sm }}>
          <View style={styles.heroBox}>
            <View style={[styles.catCircle, { backgroundColor: categoryColor + '22', borderRadius: radius.full }]}>
              <Ionicons name={categoryIcon} size={CATEGORY_GLYPH_SIZE} color={categoryColor} />
            </View>
            <AppText variant="subhead" weight="600" color={semantic.textSecondary} style={styles.catName}>
              {heroTitle}
            </AppText>
            <View style={styles.amountRow}>
              <MoneyText value={heroAmount} kind={heroKind} variant="title1" />
            </View>
            {isTransfer ? (
              <AppText variant="caption" color={semantic.textTertiary} style={styles.heroSub}>
                {heroCurrency}
              </AppText>
            ) : null}
          </View>
        </Card>

        <ListSection title={t('txDetail.sectionDetail')} style={{ marginTop: spacing.md }}>
          {isTransfer ? (
            <>
              {typeof tx.fee === 'number' && tx.fee > 0 ? (
                <ListRow icon="pricetag-outline" title={t('txDetail.fee')} value={feeText} />
              ) : null}
              {typeof tx.exchangeRate === 'number' && tx.exchangeRate > 0 ? (
                <ListRow
                  icon="swap-horizontal-outline"
                  title={t('txDetail.rate')}
                  value={`1 ${fromAsset ? String(fromAsset.currency) : ''} = ${tx.exchangeRate} ${toAsset ? String(toAsset.currency) : ''}`}
                  // 反向写法一起给：用户心里的报价常常是「1 MYR = 1.60 CNY」那种
                  subtitle={
                    tx.exchangeRate && tx.exchangeRate > 0
                      ? `1 ${toAsset ? String(toAsset.currency) : ''} = ${trimZeros(1 / tx.exchangeRate)} ${fromAsset ? String(fromAsset.currency) : ''}`
                      : undefined
                  }
                />
              ) : null}
            </>
          ) : (
            <ListRow icon="wallet-outline" title={t('txDetail.account')} value={asset?.name ?? '-'} />
          )}
          <ListRow icon="calendar-outline" title={t('txDetail.date')} value={tx.date} />
          <ListRow
            icon="document-text-outline"
            title={t('txDetail.note')}
            subtitle={tx.note?.trim() || t('txDetail.noteEmpty')}
          />
          {ledger ? <ListRow icon="book-outline" title={t('txDetail.ledger')} value={ledger.name} /> : null}
          {tx.receiptUri ? (
            <ListRow icon="receipt-outline" title={t('txDetail.receipt')} value={t('txDetail.receiptAttached')} />
          ) : null}
        </ListSection>

        <View style={styles.actions}>
          <Button title={t('txDetail.edit')} onPress={openEdit} testID="tx-detail-edit-primary" />
          <Button title={t('txDetail.delete')} variant="destructive" onPress={confirmDelete} testID="tx-detail-delete" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  heroBox: { alignItems: 'center' },
  catCircle: { width: CATEGORY_ICON_SIZE, height: CATEGORY_ICON_SIZE, alignItems: 'center', justifyContent: 'center' },
  catName: { marginTop: 10 },
  amountRow: { marginTop: 6 },
  heroSub: { marginTop: 2 },
  // 转账 hero：左「谁扣钱 + 扣多少」、右「谁收钱 + 收多少」，中间箭头表示方向。
  // 账户名紧贴自己的金额（不再分居卡片两端），两列等宽，金额用 tabular 数字。
  flowGrid: { flexDirection: 'row', alignItems: 'flex-start', columnGap: 8 },
  flowCol: { flex: 1, rowGap: 2 },
  flowColRight: { alignItems: 'flex-end' },
  flowAccount: { flexDirection: 'row', alignItems: 'center', columnGap: 6, maxWidth: '100%' },
  flowAccountRight: { flexDirection: 'row-reverse' },
  flowDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flowName: { flexShrink: 1 },
  flowMidArrow: { marginTop: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', columnGap: 6, marginTop: 4 },
  actions: { marginTop: 20, rowGap: 10 },
});
