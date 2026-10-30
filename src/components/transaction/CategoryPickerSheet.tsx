// CategoryPickerSheet.tsx
// 「全部」类别抽屉（T15 / 计划 A3：「全部」打开 BottomSheet 显示完整列表）。
//
// 职责
// - 记一笔页的类别网格只铺「本次选过 + 最近用过 + 补齐」的快捷格；这一个抽屉负责完整列表：
//   按大组分节（ListSection，组名 = 大组标签）+ 每行一个类别（ListRow，行首 44 图标方块）；
// - 点某个类别 = 走父层同一套 handlePickCategory（写回 + 最近用过 / 固定格持久化 + 收起）；
// - 组内「新增 / 拖动排序 / 删除」这些管理动作留在原「选择类别页」（T15 换成二级页 ScreenHeader），
//   抽屉底部给一个「管理类别」入口 —— 既有功能不删除，只是入口收敛到一处。

import React, { useEffect, useMemo, useState } from 'react';
import { InteractionManager, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import { getCategoryLabel, getGroupLabel } from '../../i18n/categories';
import type { Category } from '../../types';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import ListRow from '../ui/ListRow';
import IconCircle from '../ui/IconCircle';
import ListSection from '../ui/ListSection';
import type { Layout, Radius, SemanticColors, Spacing } from '../../theme/theme';

type IconName = keyof typeof Ionicons.glyphMap;

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
            {items.map((c) => (
              <ListRow
                key={c.id}
                // 与记一笔类别格 / 设置页 / 类别管理页同一套立体球（IconCircle 默认形态）。
                // 原来是 20dp 扁平图标压在 12% 淡色方底上 —— 上一代写法，与球体不是一套语言。
                leading={<IconCircle size={36} color={c.color} icon={(c.icon as IconName) ?? 'pricetag-outline'} />}
                title={getCategoryLabel(c, t)}
                onPress={() => onPickCategory(c.id)}
                trailing={
                  selectedId === c.id ? (
                    <Ionicons name="checkmark-circle" size={20} color={semantic.accent} />
                  ) : undefined
                }
              />
            ))}
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
    footer: { paddingHorizontal: layout.page, paddingTop: spacing.sm },
  });
}

export default CategoryPickerSheet;
