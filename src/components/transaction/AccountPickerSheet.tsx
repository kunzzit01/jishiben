// AccountPickerSheet.tsx
// 账户选择抽屉（T13 抽取两份合一 / T14 用标准零件重做 —— 计划 10.1 画风统一）：
//   BottomSheet（全 App 唯一底部抽屉）+ 单卡分区列表（币种分段）+ Chip（筛选）
//   + MoneyText（千分位金额）+ Badge + Button（新增账户）。
//
// 相对旧版的变化（按 T14 追加要求）
// - 币种段头 = 币种码小胶囊（MYR / USD），不再用国旗 emoji（部分设备显示成「MY」「US」）；
// - 全部币种分组装在同一张 surface 卡里（radius.lg + 发丝描边、无阴影），段与段之间只用一条发丝线，
//   不再每组一张卡；段头只在「该币种 ≥2 个账户」时才显示合计（1 行时合计与那一行金额完全重复）；
// - 余额用 MoneyText（千分位）；信用卡行主数字 = 欠款（−402.29，expense 语义），
//   副行 = 可用额度（getAssetDisplayBalance），数据都取 utils/creditCard.ts 的现有函数；
// - 币种筛选默认与类型筛选同一排的标准 Chip（同一筛选语义、少一层浮层）；
//   showCurrencyFilter 打开时才换成「币种直选键 + 悬浮面板」（面板绝对定位、不参与布局）。
//
// 四个可选外观开关（默认值 = 现有两处调用点（记一笔支出/收入、转账/兑换）的行为完全不变）
//   showTypeFilter      搜索框 + 类型筛选芯片        默认 true
//   showCurrencyFilter  币种直选键 + 下拉面板        默认 false（false 时沿用下面那排币种 Chip）
//   amountWithCurrency  行金额前带币种代码            默认 false
//   onAddAccount        底部「添加新账户」按钮        缺省时不渲染该按钮
//
// 保留的既有行为：搜索、账户类型筛选、币种筛选、币种分组折叠、选中态、
//   role 模式「再点已选 = 取消选择」、互斥排除对方账户、底部「添加新账户」、抽屉下滑收起。
//
// 外壳（遮罩 / 下滑收起 / 安卓返回键）全在 BottomSheet 里，调用方只要 visible 条件渲染即可。
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../../context/AppContext';
import { useTheme } from '../../theme/useTheme';
import { useLayout } from '../../theme/useLayout';
import { useT } from '../../i18n/LanguageContext';
import { getAssetDisplayBalance, getAssetTransferBalance } from '../../utils/creditCard';
import { formatMoney } from '../../utils/formatMoney';
import AppText from '../ui/AppText';
import Badge from '../ui/Badge';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import Chip from '../ui/Chip';
import MoneyText from '../ui/MoneyText';
import PressableScale from '../PressableScale';
import { withAlpha } from '../ui/color';
import type { Layout, Radius, SemanticColors, Spacing, Typography } from '../../theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;
type AccountFilter = 'all' | 'cash' | 'bank' | 'credit' | 'ewallet';

/** 账户行的图标方块边长 —— 纯图形常量 */
const ICON_SQUARE = 32;
/** 段头里的币种码小胶囊（不超过 32×20）—— 纯图形常量 */
const CODE_CHIP_W = 32;
const CODE_CHIP_H = 20;
/** 段头高度（比账户行矮一档，段头只承担"这是哪个币种"）—— 纯图形常量 */
const SEGMENT_HEADER_H = 40;
/** 账户行高下限（低于布局令牌时以 56 兜底）—— 纯图形常量 */
const ROW_MIN_H = 56;
/** 币种下拉面板最大高度（超出后在面板内部滚动，不把抽屉顶穿）—— 纯图形常量 */
const CURRENCY_PANEL_MAX_HEIGHT = 264;
/** 币种直选键的对外文案：未筛选时显示「全部」 */
const ALL_CURRENCIES = 'all';
/**
 * 抽屉内的浮层阶梯（这些是同一父容器的直接子节点，所以能互相比较）：
 * catcher（压在搜索框 / 芯片 / 列表上）< 底部按钮（不能被 catcher 拦住）< 悬浮面板（浮在最上）。
 * zIndex 与 elevation 同值 —— iOS 只认 zIndex，安卓的绘制顺序还要看 elevation。
 */
const Z_CATCHER = 1;
const Z_FOOTER = 2;
const Z_PANEL = 3;

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
  /**
   * 面板内「添加新账户」：父层负责关闭并跳转。
   * 缺省（不传）= 不渲染底部按钮；现有两处调用点都传了，行为不变。
   */
  onAddAccount?: () => void;
  /** 只列出该币种的账户（转账=同币种互转；兑换不传=允许跨币种） */
  restrictCurrency?: string | null;
  /**
   * 币种直选键 + 下拉面板（全部 / 各币种），放在面板顶部。
   * 默认 false = 沿用现有那一排币种 Chip；开启后由直选键取代 Chip 排（同一筛选不给两套入口）。
   */
  showCurrencyFilter?: boolean;
  /** 搜索框 + 类型筛选芯片（全部/现金/银行卡/信用卡/电子钱包）；默认 true */
  showTypeFilter?: boolean;
  /** 行金额前带币种代码（如 MYR 1,234.00）；默认 false */
  amountWithCurrency?: boolean;
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
  showCurrencyFilter = false,
  showTypeFilter = true,
  amountWithCurrency = false,
}: Props) {
  const { activeAssets, getAssetBalance } = useApp();
  const { semantic, typography, spacing, radius, layout } = useTheme();
  const { rowMinHeight } = useLayout();
  const t = useT();
  const styles = useMemo(
    () => makeStyles(semantic, typography, spacing, radius, layout, rowMinHeight),
    [semantic, typography, spacing, radius, layout, rowMinHeight]
  );

  // 面板内的临时状态：组件挂载（= 每次打开）时从初始值开始 —— 等价于原来"打开前父层逐一复位"
  const [accountSearch, setAccountSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>(ALL_CURRENCIES);
  // 币种直选的下拉面板（只有 showCurrencyFilter 时才有入口）
  const [currencyDropOpen, setCurrencyDropOpen] = useState(false);
  // 币种直选键底边在抽屉内的真实 y（onLayout 量的）：悬浮面板与 catcher 都拿它当 top，不用推测头部高度
  const [currencyBtnBottom, setCurrencyBtnBottom] = useState<number | null>(null);
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
      const matchCurrency = currencyFilter === ALL_CURRENCIES || a.currency === currencyFilter;
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

  // 直选键的面板选项：全部 + 各币种（与 Chip 排同一份数据）
  const currencyOptions: { code: string; label: string }[] = [
    { code: ALL_CURRENCIES, label: t('addTx.allCurrencies') },
    ...ownCurrencies.map((code) => ({ code, label: code })),
  ];
  const currencyButtonLabel = currencyFilter === ALL_CURRENCIES ? t('common.all') : currencyFilter;

  return (
    <BottomSheet visible onClose={onClose} title={title} testID="account-picker">
      {/* 币种直选键：点开悬浮面板，只显示该币种的账户（键上文字跟随当前筛选：全部 → ALL）。
          onLayout 量出键底边交给面板 / catcher 当 top —— 面板正好贴在键正下方，不猜头部高度 */}
      {showCurrencyFilter && (
        <View
          style={styles.currencyRow}
          onLayout={(e) => setCurrencyBtnBottom(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}
        >
          <PressableScale
            style={styles.currencyBtn}
            activeScale={0.92}
            onPress={() => setCurrencyDropOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={currencyButtonLabel}
            accessibilityState={{ expanded: currencyDropOpen }}
          >
            <AppText variant="caption" weight="700" color={semantic.accentText}>
              {currencyButtonLabel}
            </AppText>
            <Ionicons
              name={currencyDropOpen ? 'chevron-up' : 'chevron-down'}
              size={12}
              color={semantic.accentText}
            />
          </PressableScale>
        </View>
      )}

      {/* 搜索框（令牌化的输入框容器 + 系统输入框；ui/ 暂无输入框零件的标准件） */}
      {showTypeFilter && (
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
      )}

      {/* 筛选 Chip：账户类型一排（showCurrencyFilter 关闭时再加币种一排；放不下自动换行，不截断、不缩字） */}
      {showTypeFilter && (
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
      )}
      {!showCurrencyFilter && ownCurrencies.length > 1 && (
        <View style={styles.filterRow}>
          <Chip
            label={t('addTx.allCurrencies')}
            selected={currencyFilter === ALL_CURRENCIES}
            onPress={() => setCurrencyFilter(ALL_CURRENCIES)}
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

      {/* 账户列表：单卡分区 —— 一张卡内按币种分段，段头可点折叠 */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 空态：搜索 / 类型 / 币种任一筛选把列表筛空（含账户本就是 0 个）时的提示，非空时不渲染。
            文案按"是筛空还是本来就没有"分流——addTx.noAccount 的语义是"不关联具体账户"，用作空列表提示是错的 */}
        {groups.length === 0 && (
          <AppText variant="footnote" align="center" color={semantic.textTertiary} style={styles.emptyList}>
            {accountSearch.trim() !== '' || accountFilter !== 'all' || currencyFilter !== ALL_CURRENCIES
              ? t('asset.emptyFilteredTitle')
              : t('asset.emptyTitle')}
          </AppText>
        )}
        {/* 单卡分区：所有币种分组共用一张 surface 卡，段与段之间只用 1px 发丝线分隔 */}
        {groups.length > 0 && (
          <View style={styles.card}>
            {groups.map(([code, items], groupIndex) => {
              const expanded = !pickerCollapsedGroups.has(code);
              const groupTotal = items.reduce((sum, a) => sum + getAssetBalance(a.id), 0);
              return (
                <View key={`grp-${code}`}>
                  {/* 段头（40 高）：币种码 + 合计（仅该币种 ≥2 个账户时才显示）+ 折叠箭头 */}
                  <PressableScale
                    onPress={() => togglePickerGroup(code)}
                    activeScale={0.98}
                    hitSlop={{ top: 2, bottom: 2 }}
                    style={[styles.segmentHeader, groupIndex > 0 && styles.segmentDivided]}
                    accessibilityRole="button"
                    accessibilityLabel={items.length >= 2 ? `${code} ${formatMoney(groupTotal)}` : code}
                    accessibilityState={{ expanded }}
                  >
                    <View style={styles.codeChip}>
                      <AppText variant="caption" weight="600" color={semantic.textSecondary}>
                        {code}
                      </AppText>
                    </View>
                    <View style={styles.segmentRight}>
                      {/* 合计只在该币种有 ≥2 个账户时显示：只有 1 行时它与那一行的金额完全重复 */}
                      {items.length >= 2 && (
                        <MoneyText value={groupTotal} variant="subhead" kind="plain" compactFallback={false} />
                      )}
                      <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={semantic.textTertiary}
                      />
                    </View>
                  </PressableScale>

                  {expanded &&
                    items.map((a, index) => {
                      const credit = a.type === 'credit';
                      const balance = getAssetBalance(a.id);
                      // 信用卡：主数字 = 欠款（expense 语义出 − 号）、副行 = 可用额度（既有函数，口径别搞混）
                      const owed = getAssetTransferBalance(a, balance);
                      const available = getAssetDisplayBalance(a, balance);
                      const selected = selectedId === a.id;
                      return (
                        <View key={a.id}>
                          {/* 行与行之间一条发丝线（每段最后一行不画） */}
                          {index > 0 && <View style={styles.rowSeparator} />}
                          <PressableScale
                            style={[styles.accountRow, selected && styles.rowSelected]}
                            activeScale={0.98}
                            hitSlop={0}
                            onPress={() => onPickAsset(a.id)}
                            accessibilityRole="button"
                            accessibilityLabel={a.name}
                            accessibilityState={{ selected }}
                          >
                            <View style={[styles.iconSquare, { backgroundColor: withAlpha(a.color, 0.12) }]}>
                              <Ionicons name={(a.icon as IconName) ?? 'wallet-outline'} size={20} color={a.color} />
                            </View>
                            <View style={styles.rowText}>
                              <AppText variant="subhead" numberOfLines={1}>
                                {a.name}
                              </AppText>
                              {credit && (
                                <AppText variant="footnote" color={semantic.textSecondary} numberOfLines={1}>
                                  {`${t('addTx.availableLimit')} ${formatMoney(available)}`}
                                </AppText>
                              )}
                            </View>
                            <View style={styles.trailingRow}>
                              <View style={styles.valueColumn}>
                                {/* 币种代码前缀（可选）：段头已有币种码，行内再标一次是为了
                                    多币种混排时每行自己说得清是什么钱 */}
                                <View style={styles.amountRow}>
                                  {amountWithCurrency && (
                                    <AppText variant="caption" weight="600" color={semantic.textSecondary}>
                                      {a.currency}
                                    </AppText>
                                  )}
                                  {/* compactFallback=false：行 / 段头本身就是按钮，MoneyText 的长按兜底
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
                                </View>
                                {a.isDefault && <Badge label={t('addTx.currentDefault')} tone="success" />}
                              </View>
                              {/* 选中指示：accent 对勾（行底同时是 accentSoft） */}
                              {selected && (
                                <Ionicons name="checkmark-circle" size={20} color={semantic.accent} />
                              )}
                            </View>
                          </PressableScale>
                        </View>
                      );
                    })}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* 点面板外收起 + 悬浮面板：两者都是抽屉的直接子节点且绝对定位，
          所以开关面板不占用任何布局空间 —— 搜索框 / 芯片 / 列表一动不动 */}
      {showCurrencyFilter && currencyDropOpen && currencyBtnBottom !== null && (
        <>
          {/* catcher：透明全区域层（absoluteFill，top 覆盖到直选键底边）。
              压在列表之上，面板（Z_PANEL）与底部按钮（Z_FOOTER）都压在它之上，所以那两处照常可点 */}
          <Pressable
            style={[StyleSheet.absoluteFill, styles.currencyCatcher, { top: currencyBtnBottom }]}
            onPress={() => setCurrencyDropOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          />
          {/* 面板：贴键底边悬浮，超出 maxHeight 后自己内部滚动 */}
          <ScrollView
            style={[styles.currencyPanel, { top: currencyBtnBottom }]}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {currencyOptions.map((item, index) => {
              const picked = currencyFilter === item.code;
              return (
                <PressableScale
                  key={item.code}
                  style={[styles.currencyItem, index > 0 && styles.currencyItemDivided]}
                  activeScale={0.97}
                  onPress={() => {
                    setCurrencyFilter(item.code);
                    setCurrencyDropOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: picked }}
                >
                  <AppText
                    variant="subhead"
                    weight={picked ? '600' : '400'}
                    color={picked ? semantic.accentText : semantic.textPrimary}
                  >
                    {item.label}
                  </AppText>
                  {picked && <Ionicons name="checkmark" size={18} color={semantic.accent} />}
                </PressableScale>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* 「添加新账户」固定在最底部，不随列表滚动（不传 onAddAccount 则整块不渲染） */}
      {onAddAccount && (
        <View style={styles.footer}>
          <Button
            title={t('addTx.addAccount')}
            icon="add-circle-outline"
            variant="secondary"
            onPress={onAddAccount}
          />
        </View>
      )}
    </BottomSheet>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 字号 / 间距 / 圆角） */
function makeStyles(
  semantic: SemanticColors,
  typography: Typography,
  spacing: Spacing,
  radius: Radius,
  layout: Layout,
  rowMinHeight: number
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
    // 币种直选键（只有 showCurrencyFilter 才出现）：accentSoft 底 + 12 号字，比列表行轻一档
    currencyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: layout.page,
      marginTop: spacing.sm,
    },
    currencyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.xs,
      minHeight: 32,
      paddingHorizontal: spacing.md,
      borderRadius: radius.sm,
      backgroundColor: semantic.accentSoft,
    },
    // 悬浮面板：绝对定位（抽屉的直接子节点），top 在渲染期取量到的直选键底边 ——
    // 它不占布局，所以开关面板时搜索框 / 芯片 / 列表一动不动；超长时在面板内部滚动
    currencyPanel: {
      position: 'absolute',
      left: layout.page,
      right: layout.page,
      maxHeight: CURRENCY_PANEL_MAX_HEIGHT,
      zIndex: Z_PANEL,
      elevation: Z_PANEL,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: semantic.hairline,
      backgroundColor: semantic.surface,
      overflow: 'hidden',
    },
    // 点面板外收起：透明全区域层（absoluteFill，top 在渲染期覆盖到直选键底边）
    currencyCatcher: {
      zIndex: Z_CATCHER,
      elevation: Z_CATCHER,
      backgroundColor: 'transparent',
    },
    currencyItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: rowMinHeight,
      paddingHorizontal: spacing.md,
    },
    currencyItemDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: semantic.hairline,
    },
    list: { flexShrink: 1 },
    listContent: { paddingHorizontal: layout.page, paddingTop: spacing.sm, paddingBottom: spacing.xs },
    // 空态提示：在列表区域内居中一行（横向留白由 listContent 的 layout.page 给）
    emptyList: { paddingVertical: spacing.lg },
    // 单卡：所有币种分组装在这一张卡里（surface 底 + radius.lg + 发丝描边，不带阴影），
    // 圆角靠 overflow 裁掉首尾行的选中底色
    card: {
      backgroundColor: semantic.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: semantic.hairline,
      overflow: 'hidden',
    },
    // 段头：40 高，左币种码 / 右合计 + 箭头，不再用间距 + 阴影分层
    segmentHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: spacing.sm,
      minHeight: SEGMENT_HEADER_H,
      paddingHorizontal: layout.card,
      paddingVertical: spacing.xs,
    },
    // 段与段之间：1px 发丝线（画在后一段段头的上边，折叠时也照样分隔）
    segmentDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: semantic.hairline,
    },
    segmentRight: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.sm,
      flexShrink: 0,
    },
    // 币种码小胶囊（≤32×20）：surfaceSunken 底，比段头轻一档
    codeChip: {
      minWidth: CODE_CHIP_W,
      height: CODE_CHIP_H,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.xs,
      backgroundColor: semantic.surfaceSunken,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 账户行：≥56 高，图标方块 32 → 名称（可换行）→ 金额 / 对勾
    accountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      columnGap: spacing.sm,
      minHeight: Math.max(ROW_MIN_H, rowMinHeight),
      paddingHorizontal: layout.card,
      paddingVertical: spacing.sm,
    },
    rowText: { flexShrink: 1, flexGrow: 1 },
    // 行与行之间的发丝线：左右缩进到卡内边距，与文字对齐
    rowSeparator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: semantic.hairline,
      marginHorizontal: layout.card,
    },
    iconSquare: {
      width: ICON_SQUARE,
      height: ICON_SQUARE,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 选中行：accentSoft 底（与 Chip 选中态同一档）
    rowSelected: { backgroundColor: semantic.accentSoft },
    // 行尾：金额 + 默认徽章（右对齐竖排）+ 选中对勾
    trailingRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.sm },
    valueColumn: { alignItems: 'flex-end', rowGap: spacing.xs },
    // 金额行：可选币种代码前缀 + 金额（同一基线，右对齐由 valueColumn 负责）
    amountRow: { flexDirection: 'row', alignItems: 'center', columnGap: spacing.xs },
    // 底部按钮：压在 catcher 之上（catcher 铺到抽屉底，但按钮照常可点）
    footer: {
      paddingHorizontal: layout.page,
      paddingTop: spacing.sm,
      zIndex: Z_FOOTER,
      elevation: Z_FOOTER,
    },
  });
}

export default AccountPickerSheet;
