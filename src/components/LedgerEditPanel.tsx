// LedgerEditPanel.tsx
// 「账本编辑」面板的**内容**（不是独立浮层）：由首页那个唯一的账本抽屉在编辑态渲染。
//
// 为什么不做成第二个 BottomSheet：点编辑时抽屉要播出场动画，新抽屉同时播入场动画，
// 两层遮罩同屏；表单 autoFocus 还会在入场途中弹键盘，安卓 adjustResize 会当场改 windowHeight →
// BottomSheet 重算 maxHeight，面板在动画中跳高跳位。同一个抽屉换内容 = 一次布局变化。
//
// 版式与「开设账本」页同一张表单卡（同一套组件规格，见 LedgerScreen.addCard / input / colorOption）：
//   表单卡（surfaceSunken + 发丝边 + 20 圆角 + 20 内衬）
//     ├ 账本名称 label + 输入框（surfaceElevated + 发丝边 + 高 48 / 14 圆角）
//     └ 选颜色 label + 5×5 色格（38 圆点，等分五列居中）
//   取消 / 保存（并排等宽，secondary + primary）
//   删除账本（destructive 整条 —— 与上面两个按钮同一套按钮规格，不再是一条飘着的红字）
//
// 尺寸只取 spacing 8 档（4/8/12/16/20/24/32/40）与 radius 档，不写散值；颜色全部走 semantic。

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useT } from '../i18n/LanguageContext';
import { LEDGER_COLOR_OPTIONS } from '../constants/ledgerColors';
import PressableScale from './PressableScale';
import { AppText, Button } from './ui';

export interface LedgerEditPanelProps {
  ledger: { id: string; name: string; color?: string } | null;
  /** 返回账本列表（不清空抽屉） */
  onCancel: () => void;
  onSubmit: (name: string, color: string) => void;
  onDelete: () => void;
}

export function LedgerEditPanel({ ledger, onCancel, onSubmit, onDelete }: LedgerEditPanelProps) {
  const { semantic, spacing, radius } = useTheme();
  const { pagePadding } = useLayout();
  const t = useT();
  const [name, setName] = useState(ledger?.name ?? '');
  const [color, setColor] = useState<string>(ledger?.color ?? LEDGER_COLOR_OPTIONS[0]);

  // 只按账本 id 回填：跟着 ledger 对象回填会打断正在打字的人
  useEffect(() => {
    setName(ledger?.name ?? '');
    setColor(ledger?.color ?? LEDGER_COLOR_OPTIONS[0]);
  }, [ledger?.id]);

  // 空名字会被 updateLedger 直接忽略（表面像保存成功，实际什么都没改），所以先禁掉保存键
  const canSave = name.trim().length > 0;

  if (!ledger) return null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={{ paddingHorizontal: pagePadding, paddingBottom: spacing.md, gap: spacing.md }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[
          styles.card,
          { backgroundColor: semantic.surfaceSunken, borderColor: semantic.hairline, borderRadius: radius.xl },
        ]}
      >
        <AppText variant="caption" color={semantic.textSecondary} style={{ marginBottom: spacing.sm }}>
          {t('ledger.editNameLabel')}
        </AppText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('ledger.namePlaceholder')}
          placeholderTextColor={semantic.textTertiary}
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (canSave) onSubmit(name.trim(), color);
          }}
          style={[
            styles.input,
            {
              // 输入框比卡片亮一档（夜间）/ 白底（日间）：否则同色叠同色，看着像没有框
              backgroundColor: semantic.surfaceElevated,
              borderColor: semantic.hairline,
              color: semantic.textPrimary,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
            },
          ]}
          testID="ledger-edit-name"
        />

        <AppText
          variant="caption"
          color={semantic.textSecondary}
          style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}
        >
          {t('ledger.colorLabel')}
        </AppText>
        {[0, 1, 2, 3, 4].map((row) => (
          <View key={row} style={[styles.colorRow, row === 4 && { marginBottom: 0 }]}>
            {LEDGER_COLOR_OPTIONS.slice(row * 5, row * 5 + 5).map((option) => (
              <View key={option} style={styles.colorCell}>
                <PressableScale
                  style={[
                    styles.colorOption,
                    { backgroundColor: option },
                    // 选中：卡片底色留缝 + 本色外环（与开设账本页同一套色环）
                    color === option && {
                      boxShadow: `0px 0px 0px 3px ${semantic.surfaceSunken}, 0px 0px 0px 5px ${option}`,
                    },
                  ]}
                  activeScale={0.9}
                  onPress={() => setColor(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: color === option }}
                  accessibilityLabel={option}
                />
              </View>
            ))}
          </View>
        ))}
      </View>

      {/* ⚠ Button 的 style 落在 PressableScale 内层，flex:1 管不到外层按压容器（按钮会缩成文字宽）。
          外层包一层 flex:1 的 View 才是被约束的那一层，Button 默认 fullWidth=stretch 正好铺满它 */}
      <View style={styles.actionRow}>
        <View style={styles.actionSlot}>
          <Button
            title={t('common.cancel')}
            variant="secondary"
            onPress={onCancel}
            testID="ledger-edit-cancel"
          />
        </View>
        <View style={styles.actionSlot}>
          <Button
            title={t('common.save')}
            onPress={() => onSubmit(name.trim(), color)}
            disabled={!canSave}
            testID="ledger-edit-save"
          />
        </View>
      </View>

      <Button
        title={t('home.deleteLedger')}
        variant="destructive"
        onPress={onDelete}
        testID="ledger-edit-delete"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // 内容超高时内部滚动（与账本抽屉列表同一套：flexGrow 0 让短内容不被拉高）
  scroll: { flexGrow: 0, flexShrink: 1 },
  card: { padding: 20, borderWidth: 1 },
  input: { height: 48, borderWidth: 1, fontSize: 15 },
  colorRow: { flexDirection: 'row', marginBottom: 12 },
  // 五列等分 + 居中：色点左右不会因为行宽变化而漂（与开设账本页同一套）
  colorCell: { flex: 1, alignItems: 'center' },
  colorOption: { width: 38, height: 38, borderRadius: 19 },
  actionRow: { flexDirection: 'row', gap: 12 },
  actionSlot: { flex: 1 },
});

export default LedgerEditPanel;
