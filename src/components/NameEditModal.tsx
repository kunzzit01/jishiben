// NameEditModal.tsx —— 在 App 内修改昵称。提交走 PATCH /api/auth/me：
// 服务端会把 display_name_custom 置 true，之后 Google 登录不再用 Google 名称覆盖它。
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { AppText } from './ui';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';

export default function NameEditModal({
  visible,
  initial,
  busy,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initial: string;
  busy?: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const { semantic } = useTheme();
  const t = useT();
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (visible) setValue(initial);
  }, [visible, initial]);

  const canSave = value.trim().length > 0 && value.trim().length <= 40 && !busy;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[styles.card, { backgroundColor: semantic.surface }]}
          onPress={(e) => e.stopPropagation()}
        >
          <AppText variant="headline" weight="700">
            {t('auth.editNameTitle')}
          </AppText>
          <AppText variant="caption" color={semantic.textSecondary} style={styles.hint}>
            {t('auth.editNameHint')}
          </AppText>
          <TextInput
            style={[styles.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
            value={value}
            onChangeText={setValue}
            placeholder={t('auth.editNamePlaceholder')}
            placeholderTextColor={semantic.textSecondary}
            maxLength={40}
            autoFocus
            testID="name-edit-input"
          />
          <View style={styles.row}>
            <Pressable onPress={onCancel} style={styles.btn} accessibilityRole="button">
              <AppText variant="subhead" color={semantic.textSecondary}>{t('common.cancel')}</AppText>
            </Pressable>
            <Pressable
              onPress={() => onSave(value.trim())}
              disabled={!canSave}
              style={[styles.btn, styles.saveBtn, { backgroundColor: semantic.accent, opacity: canSave ? 1 : 0.5 }]}
              accessibilityRole="button"
              testID="name-edit-save"
            >
              <AppText variant="subhead" weight="600" color={semantic.onAccent}>
                {busy ? t('auth.busy') : t('common.save')}
              </AppText>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, borderRadius: 22, padding: 20, gap: 10 },
  hint: { marginTop: -4 },
  input: { height: 48, borderRadius: 14, paddingHorizontal: 14, fontSize: 17 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  btn: { minWidth: 84, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  saveBtn: { paddingHorizontal: 18 },
});
