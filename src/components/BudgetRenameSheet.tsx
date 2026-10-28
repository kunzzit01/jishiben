// BudgetRenameSheet.tsx
// 预算改名（用户 2026-10-29：预算名字不能改）。
//
// 设计口径：不做编辑小图标 —— 分类预算行「长按」进这个面板，面板里同时给出「清除这条预算」，
// 于是行上不需要任何额外按钮（与「总预算整卡可点」同一种交互语言）。
//
// 别名只存本地：云端 budgets 表只有 (categoryUid, amount, currency)，同步回来由
// AppContext 按 (categoryId|currency) 把名字贴回去；换设备会丢名字，额度不受影响。

import React, { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { AppText, BottomSheet, Button } from './ui';

export interface BudgetRenameSheetProps {
  visible: boolean;
  initialName: string;
  fallbackName: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
  onClear?: () => void;
}

export function BudgetRenameSheet({ visible, initialName, fallbackName, onClose, onSubmit, onClear }: BudgetRenameSheetProps) {
  const { semantic, spacing } = useTheme();
  const t = useT();
  const [text, setText] = useState(initialName);

  useEffect(() => {
    if (visible) setText(initialName);
  }, [visible, initialName]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('home.budgetRenameTitle')}>
      <View style={{ gap: spacing.sm, paddingBottom: spacing.md }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={fallbackName}
          placeholderTextColor={semantic.textTertiary}
          autoFocus
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={() => onSubmit(text)}
          style={[
            styles.input,
            {
              backgroundColor: semantic.surfaceSunken,
              color: semantic.textPrimary,
              borderRadius: 12,
              paddingHorizontal: spacing.md,
              minHeight: 48,
            },
          ]}
          testID="budget-rename-input"
        />
        <AppText variant="caption2" color={semantic.textTertiary}>
          {t('home.budgetRenameHint')}
        </AppText>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('common.cancel')} variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button title={t('common.save')} onPress={() => onSubmit(text)} style={{ flex: 1 }} testID="budget-rename-save" />
        </View>
        {onClear ? (
          <Button title={t('home.budgetClear')} variant="destructive" onPress={onClear} testID="budget-rename-clear" />
        ) : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  input: { fontSize: 16 },
});

export default BudgetRenameSheet;
