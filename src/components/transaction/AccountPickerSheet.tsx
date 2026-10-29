// AccountPickerSheet.tsx
// 账户选择抽屉（T13 抽取两份合一 / T14 用标准零件重做 —— 计划 10.1 画风统一）：
//   BottomSheet（全 App 唯一底部抽屉）+ ListSection / ListRow（统一列表）+ Chip（筛选）
//   + MoneyText（千分位金额）+ Badge + Button（新增账户）。
//
// 相对旧版的变化（按 T14 追加要求）
// - 币种分组头 = 币种代码方块（MYR / USD），不再用国旗 emoji（部分设备显示成「MY」「US」）；
// - 去掉紫色渐变分组大卡，改标准 Card（surface + hairline）；
// - 余额用 MoneyText（千分位）；信用卡行主数字 = 欠款（−402.29，expense 语义），
//   副行 = 可用额度（getAssetDisplayBalance），数据都取 utils/creditCard.ts 的现有函数；
// - 币种筛选从「锚定浮动下拉」改成与类型筛选同一排的标准 Chip（同一筛选语义、少一层浮层）。
//
// 保留的既有行为：搜索、账户类型筛选、币种筛选、币种分组折叠、选中态、
//   role 模式「再点已选 = 取消选择」、互斥排除对方账户、底部「添加新账户」、抽屉下滑收起。

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import { getAssetDisplayBalance, getAssetTransferBalance } from '../../utils/creditCard';
import { formatMoney } from '../../utils/formatMoney';
import AppText from '../ui/AppText';
import Badge from '../ui/Badge';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import Chip from '../ui/Chip';
import ListRow from '../ui/ListRow';
import ListSection from '../ui/ListSection';
import MoneyText from '../ui/MoneyText';
import PressableScale from '../PressableScale';
import { withAlpha } from '../ui/color';
import type { Layout, Radius, SemanticColors, Spacing, Typography } from '../../theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;
type AccountFilter = 'all' | 'cash' | 'bank' | 'credit' | 'ewallet';

/** 图标方块边长（UI_RULES 第 7 节：全 App 同一种 40 方块）—— 纯图形常量 */
const ICON_SQUARE = 40;
/** 币种代码方块比图标方块略窄（三个字母不长，40 会显得空）—— 纯图形常量 */
const CODE_SQUARE_W = 44;
const CODE_SQUARE_H = 32;

interface Props {
  /** 面板标题（支出/收入：选择账户；转账/兑换：选择转出/转入账户） */
  title: string;
  /** 当前选中账户 id（role 模式传当前角色的 from/to） */
  selectedId: string | null;
  /** 互斥排除的账户 id（role 模式传对方账户） */
  excludeId?: string | null;
  /** 点账户写回；随后由父层关闭弹层（保持既有"点完立即收起"行为） */
  onPickAsset: (assetId: string) => void;
  /** 金额显示币种（自定义币种列表用：没有账户的全局货币也要能选到） */
  currencyCode: string;
  /** 遮罩 / 关闭键 / 下拉收起 */
  onClose: () => void;
  /** 面板内「添加新账户」：父层负责关闭并跳转 */
  onAddAccount: () => void;
  /** 只列出该币种的账户（转账=同币种互转；兑换不传=允许跨币种） */
  restrictCurrency?: string | null;
}

export function AccountPickerSheet({
  title,
  selectedId,
  excludeId,
  onPickAsset,
  currencyCode,
  restrictCurrency,
  onClose,
  onAddAccount,
}: Props) {
  const { activeAssets, getAssetBalance } = useApp();
  const { semantic, typography, spacing, radius, layout } = useTheme();
  const t = useT();
  const styles = useMemo(
    () => makeStyles(semantic, typography, spacing, radius, layout),
    [semantic, typography, spacing, radius, layout]
  );

  // 面板内的临时状态：组件挂载（= 每次打开）时从初始值开始 —— 等价于原来"打开前父层逐一复位"
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  // 币种分组折叠：反向记录「被收起」的组，默认全展开
  const [pickerCollapsedGroups, setPickerCollapsedGroups] = useState<Set<string>>(new Set());
  const togglePickerGroup = (code: string) => {
    setPickerCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  // 用户已有账户出现过的币种（去重、ABC 字母序）+ 当前金额币种兜底（还没有账户的全局货币也要能选）
  const ownCurrencies = useMemo(() => {
    // 受限模式（转账同币种）下，币种筛选条只保留该币种，避免出现选了也筛不到东西的胶囊
    const source = restrictCurrency ? activeAssets.filter((a) => a.currency === restrictCurrency) : activeAssets;
    const codes: string[] = [];
    source.forEach((a) => {
      if (a.currency && !codes.includes(a.currency)) codes.push(a.currency);
    });
    if (!restrictCurrency && !codes.includes(currencyCode)) codes.push(currencyCode);
    return codes.sort((c1, c2) => c1.localeCompare(c2));
  }, [activeAssets, currencyCode, restrictCurrency]);

  // 过滤后的账户 → 按币种分组（组内保持 activeAssets 顺序）
  const groups = useMemo(() => {
    const keyword = accountSearch.trim().toLowerCase();
    const visible = activeAssets.filter((a) => {
      const matchSearch = !keyword || `${a.name} ${a.currency} ${a.type}`.toLowerCase().includes(keyword);
      // 币种筛选：点了 MYR / USD 之类后，列表只显示该币种的账户
      const matchCurrency = currencyFilter === 'all' || a.currency === currencyFilter;
      // 分类按账户类型精确匹配（现金/银行卡/信用卡/电子钱包）；投资等其他类型只在"全部"里出现
      const matchFilter = accountFilter === 'all' || a.type === accountFilter;
      // 转账的两个角色互相排除：选转出时不列转入账户，反之亦然
      const matchExclude = !excludeId || a.id !== excludeId;
      // 转账限定同币种（跨币种走「兑换」）：由父层传入对方账户币种，兑换传 null
      const matchRestrict = !restrictCurrency || a.currency === restrictCurrency;
      return matchSearch && matchCurrency && matchFilter && matchExclude && matchRestrict;
    });
    const byCurrency: Record<string, typeof visible> = {};
    visible.forEach((a) => {
      if (!byCurrency[a.currency]) byCurrency[a.currency] = [];
      byCurrency[a.currency].push(a);
    });
    return Object.entries(byCurrency).sort(([c1], [c2]) => c1.localeCompare(c2));
  }, [activeAssets, accountSearch, currencyFilter, accountFilter, excludeId, restrictCurrency]);

  const FILTERS: { key: AccountFilter; label: string }[] = [
    { key: 'all', label: t('common.all') },
    { key: 'cash', label: t('addTx.filterCash') },
    { key: 'bank', label: t('addTx.filterBank') },
    { key: 'credit', label: t('addTx.filterCredit') },
    { key: 'ewallet', label: t('addTx.filterEwallet') },
  ];

  return (
    <BottomSheet visible onClose={onClose} title={title} testID="account-picker">
      {/* 搜索框（令牌化的输入框容器 + 系统输入框；ui/ 暂无输入框零件的标准件） */}
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={20} color={semantic.textTertiary} />
        <TextInput
          style={styles.searchInput}
          value={accountSearch}
          onChangeText={setAccountSearch}
          placeholder={t('addTx.searchPlaceholder')}
          placeholderTextColor={semantic.textTertiary}
        />
      </View>

      {/* 筛选 Chip：账户类型一排 + 币种一排（放不下自动换行，不截断、不缩字） */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            selected={accountFilter === f.key}
            onPress={() => setAccountFilter(f.key)}
          />
        ))}
      </View>
      {ownCurrencies.length > 1 && (
        <View style={styles.filterRow}>
          <Chip
            label={t('addTx.allCurrencies')}
            selected={currencyFilter === 'all'}
            onPress={() => setCurrencyFilter('all')}
          />
          {ownCurrencies.map((code) => (
            <Chip
              key={code}
              label={code}
              selected={currencyFilter === code}
              onPress={() => setCurrencyFilter(code)}
            />
          ))}
        </View>
      )}

      {/* 账户列表：一币一组（ListSection），组头 = 币种代码方块 + 合计 */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {groups.map(([code, items]) => {
          const expanded = !pickerCollapsedGroups.has(code);
          const groupTotal = items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
          return (
            <ListSection key={`grp-${code}`} style={styles.group}>
              {/* 组头：币种代码方块（不用国旗 emoji）+ 合计（可点折叠） */}
              <PressableScale
                onPress={() => togglePickerGroup(code)}
                activeScale={0.98}
                hitSlop={0}
                style={styles.groupHeader}
                accessibilityRole="button"
                accessibilityLabel={`${code} ${formatMoney(groupTotal)}`}
                accessibilityState={{ expanded }}
              >
                <View style={styles.codeSquare}>
                  <AppText variant="caption" weight="600" color={semantic.textSecondary}>
                    {code}
                  </AppText>
                </View>
                <MoneyText value={groupTotal} variant="subhead" kind="plain" compactFallback={false} />
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={semantic.textTertiary}
                />
              </PressableScale>

              {expanded &&
                items.map((a) => {
                  const credit = a.type === 'credit';
                  const balance = getAssetBalance(a.id);
                  // 信用卡：主数字 = 欠款（expense 语义出 − 号）、副行 = 可用额度（既有函数，口径别搞混）
                  const owed = getAssetTransferBalance(a, balance);
                  const available = getAssetDisplayBalance(a, balance);
                  const selected = selectedId === a.id;
                  return (
                    <ListRow
                      key={a.id}
                      leading={
                        <View style={[styles.iconSquare, { backgroundColor: withAlpha(a.color, 0.12) }]}>
                          <Ionicons name={(a.icon as IconName) ?? 'wallet-outline'} size={20} color={a.color} />
                        </View>
                      }
                      title={a.name}
                      subtitle={
                        credit ? `${t('addTx.availableLimit')} ${formatMoney(available)}` : undefined
                      }
                      trailing={
                        <View style={styles.trailingRow}>
                          <View style={styles.valueColumn}>
                            {/* compactFallback=false：行 / 组头本身就是按钮，MoneyText 的长按兜底
                                会在里面再嵌一个按钮（web 控制台报 button 嵌套告警）；这里金额都很短，
                                按档位降级足够，不需要紧凑兜底 */}
                            <MoneyText
                              value={credit ? owed : balance}
                              kind="plain"
                              // 欠款以正数展示（与列表/详情一致）；红色单独给，kind 不能再用 expense（会给值加 − 号）
                              color={credit ? semantic.amountExpense : undefined}
                              variant="subhead"
                              compactFallback={false}
                            />
                            {a.isDefault && <Badge label={t('addTx.currentDefault')} tone="success" />}
                          </View>
                          {/* 选中指示：accent 对勾（行底同时是 accentSoft） */}
                          {selected && (
                            <Ionicons name="checkmark-circle" size={20} color={semantic.accent} />
                          )}
                        </View>
                      }
                      onPress={() => onPickAsset(a.id)}
                      accessibilityLabel={a.name}
                      style={selected ? styles.rowSelected : undefined}
                    />
                  );
                })}
            </ListSection>
          );
        })}
      </ScrollView>

      {/* 「添加新账户」固定在最底部，不随列表滚动 */}
      <View style={styles.footer}>
        <Button
          title={t('addTx.addAccount')}
          icon="add-circle-outline"
          variant="secondary"
          onPress={onAddAccount}
        />
      </View>
    </BottomSheet>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距 / 圆角） */
function makeStyles(
  semantic: SemanticColors,
  typography: Typography,
  spacing: Spacing,
  radius: Radius,
  layout: Layout
) {
  return StyleSheet.create({
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
      marginHorizontal: layout.page,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.md,
      columnGap: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: semantic.bg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: semantic.hairline,
    },
    searchInput: {
      flex: 1,
      fontSize: typography.subhead.fontSize,
      lineHeight: typography.subhead.lineHeight,
      color: semantic.textPrimary,
      includeFontPadding: false,
      paddingVertical: 0,
    },
    filterRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      columnGap: spacing.xs,
      rowGap: spacing.xs,
      paddingHorizontal: layout.page,
      marginTop: spacing.xs,
    },
    list: { flexShrink: 1 },
    listContent: { paddingHorizontal: layout.page, paddingTop: spacing.sm, paddingBottom: spacing.xs },
    group: { marginBottom: spacing.md },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.md,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.md,
    },
    codeSquare: {
      width: CODE_SQUARE_W,
      height: CODE_SQUARE_H,
      borderRadius: radius.sm,
      backgroundColor: semantic.bg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconSquare: {
      width: ICON_SQUARE,
      height: ICON_SQUARE,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 选中行：accentSoft 底（与 Chip 选中态同一档）
    rowSelected: { backgroundColor: semantic.accentSoft },
    // 行尾：金额 + 默认徽章（右对齐竖排）+ 选中对勾
    trailingRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
    valueColumn: { alignItems: 'flex-end', rowGap: spacing.xs },
    footer: {
      paddingHorizontal: layout.page,
      paddingTop: spacing.sm,
    },
  });
}

export default AccountPickerSheet;
