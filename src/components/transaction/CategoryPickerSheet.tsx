// CategoryPickerSheet.tsx
// 「全部」类别抽屉（T15 / 计划 A3：「全部」打开 BottomSheet 显示完整列表）。
//
// 职责
// - 记一笔页的类别网格只铺「本次选过 + 最近用过 + 补齐」的快捷格；这一个抽屉负责完整列表：
//   按大组分节（ListSection，组名 = 大组标签）+ 组内网格（立体球 + 名称），列数随可用宽度伸缩（3 或 4 列）；
// - 点某个类别 = 走父层同一套 handlePickCategory（写回 + 最近用过 / 固定格持久化 + 收起）；
// - 组内「新增 / 拖动排序 / 删除」这些管理动作留在原「选择类别页」（T15 换成二级页 ScreenHeader），
//   抽屉底部给一个「管理类别」入口 —— 既有功能不删除，只是入口收敛到一处。

import React, { useEffect, useMemo, useState } from 'react';
import { InteractionManager, ScrollView, StyleSheet, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import { getCategoryLabel, getGroupLabel } from '../../i18n/categories';
import type { Category } from '../../types';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import AppText from '../ui/AppText';
import PressableScale from '../PressableScale';
import IconCircle from '../ui/IconCircle';
import ListSection from '../ui/ListSection';
import type { Layout, Radius, SemanticColors, Spacing } from '../../theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/** 一格最小宽：放得下 44 球 + 4 个汉字标签。可用宽 ÷ 它 = 列数，夹在 3~4 列之间 */
const CELL_MIN_WIDTH = 72;
const MIN_COLUMNS = 3;
const MAX_COLUMNS = 4;
/** 网格在卡片里的左右内衬（格子之间不再额外留缝，间距由格宽自然分出） */
const GRID_PAD_X = 8;

/** 一个大组分节（与记一笔页的 groupedExpenseSections 同形，直接透传，不在抽屉里重复分组逻辑） */
export interface CategorySection {
  group: string;
  items: Category[];
  custom?: boolean;
}

interface Props {
  sections: CategorySection[];
  /** 当前选中类别 id（对应行尾打勾） */
  selectedId: string | null;
  /** 点类别：父层 handlePickCategory（选择 + 持久化 + 关闭） */
  onPickCategory: (id: string) => void;
  /** 「管理类别」：打开选择类别页（编辑 / 组内新增 / 拖动排序都在那一页） */
  onManage: () => void;
  onClose: () => void;
}

export function CategoryPickerSheet({ sections, selectedId, onPickCategory, onManage, onClose }: Props) {
  const { semantic, spacing, radius, layout } = useTheme();
  const t = useT();
  const styles = useMemo(
    () => makeStyles(semantic, spacing, radius, layout),
    [semantic, spacing, radius, layout]
  );

  // 抽屉是「选择器」：空分组（自定义空组，编辑模式才需要）不显示
  const visibleSections = useMemo(() => sections.filter((s) => s.items.length > 0), [sections]);

  /* 一次性把 10 个分节、40 多行（每行一个渐变球）全部建出来，会让**抽屉的打开动画**掉帧
   * （用户 2026-10-30：点「全部」就开始卡）。改成：先只建 2 个分节，等打开动画结束
   * （InteractionManager）再每 48ms 补 2 个分节 —— 动画期间几乎零成本，视觉上只是列表继续往下长。 */
  const [renderedCount, setRenderedCount] = useState(2);
  useEffect(() => {
    const total = visibleSections.length;
    if (renderedCount >= total) return;
    let cancelled = false;
    let fired = false;
    const bump = () => {
      if (cancelled || fired) return;
      fired = true;
      setRenderedCount((n) => Math.min(n + 3, total));
    };
    // 正常路径：等打开动画结束再补
    const handle = InteractionManager.runAfterInteractions(() => {
      setTimeout(bump, 32);
    });
    // 兜底：InteractionManager 在某些情况下不回调（例如动画由 reanimated 驱动），
    // 220ms 后无论如何继续补，避免抽屉永远只显示前 2 个分节
    const fallback = setTimeout(bump, 160);
    return () => {
      cancelled = true;
      handle.cancel();
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderedCount, visibleSections.length]);

  // 网格可用宽（实测，卡片内衬内侧）：决定 3 列还是 4 列，格宽 = 可用宽 ÷ 列数（不用百分比 —— RN Web 百分比宽要落在 flex 直接子项上才可靠）
  const [gridW, setGridW] = useState(0);
  const onGridLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && Math.abs(w - gridW) > 1) setGridW(w);
  };
  const innerW = Math.max(0, gridW - GRID_PAD_X * 2);
  const columns = innerW > 0 ? Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.floor(innerW / CELL_MIN_WIDTH))) : MAX_COLUMNS;
  const cellW = innerW > 0 ? Math.floor(innerW / columns) : undefined;

  const shownSections = useMemo(
    () => visibleSections.slice(0, Math.max(2, renderedCount)),
    [visibleSections, renderedCount]
  );

  return (
    <BottomSheet visible onClose={onClose} title={t('addTx.selectCategory')} testID="category-picker">
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {shownSections.map(({ group, items }) => (
          <ListSection key={group} title={getGroupLabel(group, t)} style={styles.group}>
            <View style={styles.grid} onLayout={onGridLayout}>
              {items.map((c) => {
                const selected = selectedId === c.id;
                return (
                  <PressableScale
                    key={c.id}
                    onPress={() => onPickCategory(c.id)}
                    containerStyle={cellW ? { width: cellW } : styles.cellFallback}
                    style={styles.cell}
                    accessibilityRole="button"
                    accessibilityLabel={getCategoryLabel(c, t)}
                    accessibilityState={{ selected }}
                  >
                    {/* 与记一笔类别格同一套立体球 + 选中态（球体浮起 + 外圈），不再用行尾打勾 */}
                    <IconCircle
                      size={44}
                      color={c.color}
                      icon={(c.icon as IconName) ?? 'pricetag-outline'}
                      selected={selected}
                    />
                    <AppText
                      variant="caption"
                      weight={selected ? '600' : '400'}
                      color={selected ? semantic.accent : semantic.textPrimary}
                      numberOfLines={2}
                      style={styles.cellLabel}
                    >
                      {getCategoryLabel(c, t)}
                    </AppText>
                  </PressableScale>
                );
              })}
            </View>
          </ListSection>
        ))}
      </ScrollView>

      {/* 管理入口固定在底部：编辑 / 组内新增 / 拖动排序都在选择类别页 */}
      <View style={styles.footer}>
        <Button
          title={t('addTx.manageCategories')}
          icon="create-outline"
          variant="secondary"
          onPress={onManage}
        />
      </View>
    </BottomSheet>
  );
}

/** 令牌进、StyleSheet 出（禁止写死色值 / 圆角 / 间距） */
function makeStyles(semantic: SemanticColors, spacing: Spacing, radius: Radius, layout: Layout) {
  return StyleSheet.create({
    list: { flexShrink: 1 },
    listContent: { paddingHorizontal: layout.page, paddingTop: spacing.sm, paddingBottom: spacing.xs },
    group: { marginBottom: spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: GRID_PAD_X, paddingVertical: spacing.sm },
    // 宽度未测得前的兜底（首帧）：按 4 列估，测得后立即换成实测格宽
    cellFallback: { width: '25%' },
    // 顶部留 8：选中态外圈向外溢出 8，要有地方露出来
    cell: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm, paddingHorizontal: 2 },
    cellLabel: { marginTop: spacing.xs, textAlign: 'center' },
    footer: { paddingHorizontal: layout.page, paddingTop: spacing.sm },
  });
}

export default CategoryPickerSheet;
