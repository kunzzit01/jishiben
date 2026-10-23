// AmountCalculatorKeypad.tsx
// 自绘金额计算器键盘（记一笔 / 资产 / 计划 / 预算面板共用）。
//
// 版型（用户参考图「分格」，2026-10-12）：
//   - 面板：浅薰衣草（日）/ #121219（夜）= semantic.keypadPanel，顶部 30 圆角；
//   - 键 = 各自独立的圆角方块（圆角 18，键与键之间 8pt 缝）：
//     左 3 列 = 1–9 / C 0 . （4 行）；右列 = ⌫（上，淡紫实底）/ 日期（中）/ 完成（下，占 2 行，accent 渐变）；
//   - 键色全部取 semantic.keyTile / keyTilePressed（日白 / 夜 #1E1B2A），按下 = 略深的底色；
//   - 备注行：胶囊输入框 + 「收据」小芯片（相机图标 + 文字，淡紫底）。
//
// 行为一律未变：退格长按连删、完成/长按完成、震动分级、日期键打开日期选择、备注与小票的读写路径。
// 高度：每个键的高度 = useLayout().keypadKeyHeight；键之间 8pt 缝由「键外边距 4」实现。
// 面板总高用 keypadPanelHeight() 算（调用方的遮挡高度 / 滚动停止线用它，不再用写死的常量）。

import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/useTheme';
import { useLayout } from '../theme/useLayout';
import { useT, useLanguage } from '../i18n/LanguageContext';
import { PRESS_TRANSITION } from './PressableScale';
import { hapticLight, hapticSelection } from '../utils/haptics';
import { formatDate } from '../utils/formatDate';

/** 键之间的缝（每个键四周留 KEY_GAP / 2，相邻两键之间正好 KEY_GAP） */
const KEY_GAP = 8;
const KEY_HALF_GAP = KEY_GAP / 2;
/** 键圆角（稿：18） */
const KEY_RADIUS = 18;

/** 备注胶囊高（矮屏 36 / 常规 42） */
function notePillHeightOf(isShort: boolean): number {
  return isShort ? 36 : 42;
}

/**
 * 键盘面板总高（含顶部圆角区、备注行、4 行键与缝，不含底部安全区补白）。
 * 调用方（记一笔）用它算遮挡高度，与键盘真实渲染高度保持一致。
 */
export function keypadPanelHeight(keyHeight: number, isShort: boolean, withNote: boolean): number {
  const top = isShort ? 4 : 8;
  const bottom = isShort ? 4 : 12;
  // 备注行：上 2 + 胶囊 + 下 6（矮屏下 4）
  const note = withNote ? 2 + notePillHeightOf(isShort) + (isShort ? 4 : 6) : 0;
  // 4 行键，每行 = 键高 + 缝
  return top + note + 4 * (keyHeight + KEY_GAP) + bottom;
}

interface AmountCalculatorKeypadProps {
  onPressKey: (key: string) => void;
  onPressToday: () => void;
  onConfirm: () => void;
  /** "C" 键：清空当前正在输入的算式，回到 0 */
  onClear: () => void;
  /** 长按"完成"＝保存这一笔后不退出，留在原页面继续记下一笔；不传就只支持单击保存 */
  onConfirmLongPress?: () => void;
  /** 备注 + 小票：常驻在数字区上方。不传 onNoteChange 就不渲染这一条（转账/兑换用自己的备注字段） */
  note?: string;
  onNoteChange?: (text: string) => void;
  /** 备注输入框的占位文案；不传就用默认的"添加备注（选填）..." */
  notePlaceholder?: string;
  receiptUri?: string | null;
  onAttachReceipt?: () => void;
  onRemoveReceipt?: () => void;
  onPreviewReceipt?: () => void;
  /** 备注框现在长在这个组件里了，外部想用 ref.current?.focus() 跳过来，得靠这个转发进来的 ref */
  noteInputRef?: React.RefObject<TextInput | null>;
  /** 备注框聚焦/失焦回调：父层用它区分"系统键盘是备注弹的"和"系统键盘来自别的输入" */
  onNoteFocus?: () => void;
  onNoteBlur?: () => void;
  /** 表单当前已选日期（YYYY-MM-DD）：日期键显示它；等于今天或不传时才标注"今天" */
  selectedDate?: string;
}

export function AmountCalculatorKeypad({
  onPressKey,
  onPressToday,
  onConfirm,
  onClear,
  onConfirmLongPress,
  note,
  onNoteChange,
  notePlaceholder,
  receiptUri,
  onAttachReceipt,
  onRemoveReceipt,
  onPreviewReceipt,
  noteInputRef,
  onNoteFocus,
  onNoteBlur,
  selectedDate,
}: AmountCalculatorKeypadProps) {
  const { semantic, gradients } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  // 键高按版型分级（窄 48 / 常规 56 / 大 60；矮屏统一 48）
  const { keypadKeyHeight: keyH, isShort } = useLayout();
  const notePillHeight = notePillHeightOf(isShort);

  // 日期键实时显示表单选中的日期；只有选中的就是今天时才标注"今天"
  const [today] = useState(() => new Date());
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = !selectedDate || selectedDate === todayStr;
  const parsedSelected = isToday ? today : new Date(`${selectedDate}T00:00:00`);
  const shownDate = isNaN(parsedSelected.getTime()) ? today : parsedSelected;
  // 日期显示统一走 formatDate（中文 10月9日 / 英文 Oct 9），恒定绝对月日
  const dateLabel = formatDate(shownDate, langMode, { style: 'monthDay', relative: false });

  // 左侧 3 列数据（行优先）：1-9 / C 0 .
  const leftKeys = [
    { key: '1' }, { key: '2' }, { key: '3' },
    { key: '4' }, { key: '5' }, { key: '6' },
    { key: '7' }, { key: '8' }, { key: '9' },
    { key: 'C', type: 'clear' }, { key: '0' }, { key: '.', type: 'dot' },
  ];

  const handlePress = (key: string, type?: string) => {
    // 震动分级：数字键 = selection；退格 / C / 小数点 / 日期键 = light；「完成」不震（成功震动由调用方发）
    if (type === 'confirm') {
      // 完成键：不震
    } else if (!type) {
      hapticSelection(); // 数字键 0-9
    } else {
      hapticLight(); // 退格 / C / 小数点 / 日期键
    }
    if (type === 'today') return onPressToday();
    if (type === 'confirm') return onConfirm();
    if (type === 'clear') return onClear();
    if (type === 'dot') return onPressKey('.');
    if (type === 'backspace') return onPressKey('backspace');
    onPressKey(key);
  };

  // ---------- 退格长按连删：长按 350ms 后每 60ms 删一位，松手即停 ----------
  const deleteIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 连删必须每次拿最新的 onPressKey（父层 pressKeyAt 依赖当前算式 state），否则第 2 位起算出旧结果
  const onPressKeyRef = useRef(onPressKey);
  onPressKeyRef.current = onPressKey;
  const stopRepeatDelete = () => {
    if (deleteIntervalRef.current) {
      clearInterval(deleteIntervalRef.current);
      deleteIntervalRef.current = null;
    }
  };
  const startRepeatDelete = () => {
    stopRepeatDelete();
    deleteIntervalRef.current = setInterval(() => onPressKeyRef.current('backspace'), 60);
  };
  // 组件卸载时兜底清理，防止定时器泄漏
  useEffect(() => stopRepeatDelete, []);

  // 键的底色：按下时换成 keyTilePressed（只换色，不缩放、不位移）
  const tileBg = (pressed: boolean) => (pressed ? semantic.keyTilePressed : semantic.keyTile);
  // 键外层：四周 KEY_HALF_GAP 留白，相邻键之间正好 KEY_GAP
  const cellStyle = { height: keyH + KEY_GAP, padding: KEY_HALF_GAP };

  return (
    <View style={[styles.panel, isShort && styles.panelShort, { backgroundColor: semantic.keypadPanel }]}>
      {/* 顶部细亮线（夜：稿里的 inset 高光；日：发丝分割）——贴顶、随圆角裁切 */}
      <View pointerEvents="none" style={[styles.panelTopLine, { backgroundColor: semantic.hairline }]} />

      {/* 备注 + 收据芯片：常驻在数字区上方。没传 onNoteChange 的调用方不显示这一条 */}
      {onNoteChange && (
        <View style={[styles.noteRow, isShort && styles.noteRowShort]}>
          <View style={[styles.noteInputPill, { height: notePillHeight, backgroundColor: semantic.keyTile }]}>
            <Ionicons name="create-outline" size={17} color={semantic.textTertiary} />
            <TextInput
              ref={noteInputRef}
              style={[styles.noteInputPillText, { color: semantic.textPrimary }]}
              value={note}
              onChangeText={onNoteChange}
              onFocus={onNoteFocus}
              onBlur={onNoteBlur}
              placeholder={notePlaceholder ?? t('addTx.keypadNotePlaceholder')}
              placeholderTextColor={semantic.textTertiary}
            />
          </View>
          {receiptUri ? (
            <Pressable
              style={({ pressed }) => [
                styles.receiptThumbPill,
                { height: notePillHeight, backgroundColor: semantic.keyTile },
                PRESS_TRANSITION,
                pressed && { transform: [{ scale: 0.94 }] },
              ]}
              onPress={onPreviewReceipt}
              onLongPress={onAttachReceipt}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.keypadReceipt')}
            >
              <Image source={{ uri: receiptUri }} style={[styles.receiptThumb, { backgroundColor: semantic.hairline }]} />
              <Pressable onPress={onRemoveReceipt} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle" size={17} color={semantic.textSecondary} />
              </Pressable>
            </Pressable>
          ) : (
            // 收据芯片（替代原来的纯图标圆钮；动作不变：点 = 选收据）
            <Pressable
              style={({ pressed }) => [
                styles.receiptChip,
                { height: notePillHeight, backgroundColor: semantic.keyAccentTile },
                PRESS_TRANSITION,
                pressed && { transform: [{ scale: 0.96 }] },
              ]}
              onPress={onAttachReceipt}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.keypadReceipt')}
            >
              <Ionicons name="camera-outline" size={16} color={semantic.keyAccentText} />
              <Text style={[styles.receiptChipText, { color: semantic.keyAccentText }]}>{t('addTx.keypadReceipt')}</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.container}>
        {/* 左侧 3 列 × 4 行：数字键 + C + 0 + 小数点，每个键是独立圆角块 */}
        <View style={styles.leftGrid}>
          {leftKeys.map((item, idx) => (
            <View key={idx} style={[styles.gridCell, cellStyle]}>
              <Pressable
                onPress={() => handlePress(item.key, item.type)}
                style={({ pressed }) => [styles.tile, { backgroundColor: tileBg(pressed) }]}
              >
                {item.type === 'clear' ? (
                  <Text style={[styles.keyText, styles.keyTextClear, { color: semantic.textSecondary }]}>C</Text>
                ) : (
                  <Text style={[styles.keyText, { color: semantic.textPrimary }]}>{item.key}</Text>
                )}
              </Pressable>
            </View>
          ))}
        </View>

        {/* 右侧 1 列：⌫（上）/ 日期（中）/ 完成（下，占 2 行） */}
        <View style={styles.rightColumn}>
          <View style={[styles.rightCell, cellStyle]}>
            <Pressable
              onPress={() => {
                stopRepeatDelete();
                handlePress('backspace', 'backspace');
              }}
              onLongPress={startRepeatDelete}
              onPressOut={stopRepeatDelete}
              delayLongPress={350}
              style={({ pressed }) => [
                styles.tile,
                // 退格：淡紫实底（keyAccentTile），按下略深
                { backgroundColor: pressed ? semantic.keyTilePressed : semantic.keyAccentTile },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.keypadBackspace')}
            >
              <Ionicons name="backspace-outline" size={24} color={semantic.keyAccentText} />
            </Pressable>
          </View>

          <View style={[styles.rightCell, cellStyle]}>
            <Pressable
              onPress={() => handlePress('today', 'today')}
              style={({ pressed }) => [styles.tile, styles.dateTile, { backgroundColor: tileBg(pressed) }]}
              accessibilityRole="button"
              accessibilityLabel={isToday ? t('addTx.keypadToday') : dateLabel}
            >
              <Ionicons name="calendar-outline" size={14} color={semantic.accentText} />
              <Text style={[styles.dateLabelText, { color: semantic.textPrimary }]}>
                {isToday ? t('addTx.keypadToday') : t('addTx.keypadDate')}
              </Text>
              <Text style={[styles.dateValueText, { color: semantic.textSecondary }]} numberOfLines={1}>
                {dateLabel}
              </Text>
            </Pressable>
          </View>

          {/* 完成：占第 3、4 行，accent 渐变，长按 = 保存后继续记下一笔 */}
          <View style={[styles.rightCell, { height: 2 * (keyH + KEY_GAP), padding: KEY_HALF_GAP }]}>
            <Pressable
              onPress={() => handlePress('confirm', 'confirm')}
              onLongPress={onConfirmLongPress}
              delayLongPress={350}
              style={({ pressed }) => [styles.tile, styles.confirmTile, pressed && styles.confirmPressed]}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.keypadConfirm')}
            >
              <LinearGradient
                colors={gradients.keyConfirm.colors}
                locations={gradients.keyConfirm.locations as [number, number, ...number[]]}
                start={gradients.keyConfirm.start}
                end={gradients.keyConfirm.end}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Ionicons name="checkmark-circle-outline" size={26} color={semantic.onAccent} />
              <Text style={[styles.confirmText, { color: semantic.onAccent }]}>{t('addTx.keypadConfirm')}</Text>
              {!!onConfirmLongPress && (
                <Text style={[styles.confirmHint, { color: semantic.onAccent }]}>{t('addTx.keypadConfirmHint')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 面板：顶部 30 圆角；上下留白 8 / 12（矮屏 4 / 4），与 keypadPanelHeight() 一致
  panel: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    overflow: 'hidden',
  },
  // 矮屏：上下留白各收一档
  panelShort: { paddingTop: 4, paddingBottom: 4 },
  panelTopLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
  },
  // 备注行：上 2 / 下 6（矮屏下 4），与 keypadPanelHeight() 一致
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: 6,
    paddingHorizontal: 4,
    columnGap: 10,
  },
  noteRowShort: { paddingBottom: 4 },
  // 备注胶囊：全圆角，左图标 + 输入框
  noteInputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    columnGap: 8,
  },
  noteInputPillText: {
    flex: 1,
    fontSize: 14,
    padding: 0,
    height: 28,
    textAlignVertical: 'center',
  },
  // 收据芯片（空态）：相机图标 + 「收据」，淡紫底
  receiptChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 12,
    columnGap: 6,
    flexShrink: 0,
  },
  receiptChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // 收据缩略胶囊（有凭证时）
  receiptThumbPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    columnGap: 7,
    flexShrink: 0,
  },
  receiptThumb: {
    width: 26,
    height: 26,
    borderRadius: 7,
  },
  container: {
    flexDirection: 'row',
  },
  leftGrid: {
    width: '75%',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  rightColumn: {
    width: '25%',
    flexDirection: 'column',
  },
  // 键外层（列宽 1/3 或 1/4；高度 = 键高 + 缝，内边距 = 半缝）
  gridCell: {
    width: '33.33%',
  },
  rightCell: {
    width: '100%',
  },
  // 键本体：圆角块，内容居中
  tile: {
    flex: 1,
    borderRadius: KEY_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // 日期键：图标 + 标签 + 日期，竖排居中
  dateTile: {
    rowGap: 1,
    paddingHorizontal: 4,
  },
  dateLabelText: {
    fontSize: 12,
    fontWeight: '700',
  },
  dateValueText: {
    fontSize: 11,
    fontWeight: '500',
  },
  // 完成键：渐变底（JSX 里 LinearGradient 铺满），白字
  confirmTile: {
    rowGap: 2,
  },
  confirmPressed: {
    opacity: 0.92,
  },
  confirmText: {
    fontSize: 20,
    fontWeight: '700',
    // 颜色由组件内联给 semantic.onAccent（渐变底上的白字，走令牌）
    textAlign: 'center',
  },
  // 长按提示：14/700 满白（11pt 白字在渐变末端对比不足 4.5，见下方说明）
  confirmHint: {
    fontSize: 14,
    fontWeight: '700',
    // 颜色由组件内联给 semantic.onAccent
    textAlign: 'center',
  },
  // 数字键：22/500（稿）；C 同字号、次要色
  keyText: {
    fontSize: 22,
    fontWeight: '500',
    textAlign: 'center',
  },
  keyTextClear: {
    fontWeight: '500',
  },
});

export default AmountCalculatorKeypad;
