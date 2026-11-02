import React, { useCallback, useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PressableScale from './PressableScale';
import { useTheme } from '../theme/useTheme';
import { useT } from '../i18n/LanguageContext';
import { useAppLock } from '../context/AppLockContext';
import { hapticLight, hapticSuccess } from '../utils/haptics';

/**
 * 二级密码（6 位 PIN）键盘弹层。
 *
 * 三种模式：
 * - verify：验证已设置的 PIN（onSuccess 回调）
 * - create：直接设置新 PIN——输入两遍一致即创建（用户定版：不再要求生物识别前置）
 * - change：同 create，但开始前先验证原 PIN
 *
 * 用户定版规则：删除账本等敏感操作【只认 PIN】；生物识别锁解锁失败时可用 PIN 兜底
 * （兜底在 AppLockOverlay 内处理，不走本组件）。
 * 写法：纯 RN Modal + fade（同 HomeScreen 预算弹窗模式），不掺 Reanimated，
 * 避免 Android 独立窗口幽灵副本问题。
 */

export type PinSheetMode = 'verify' | 'create' | 'change';

interface PinSheetProps {
  visible: boolean;
  mode: PinSheetMode;
  onClose: () => void;
  /** verify/change 模式验证通过 / create 模式创建完成 */
  onSuccess: () => void;
  /** change 模式：旧 PIN 验证通过时回调（供外部在验证后中断流程，如「清除」场景） */
  onVerified?: () => void;
}

const PIN_LENGTH = 6;
/** 3 列标准数字盘（1-2-3 / 4-5-6 / 7-8-9）：与所有手机拨号盘一致，底行 C / 0 / ⌫ 单独渲染 */
const KEY_ROWS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

export default function PinSheet({ visible, mode, onClose, onSuccess, onVerified }: PinSheetProps) {
  const { semantic } = useTheme();
  const insets = useSafeAreaInsets();
  const tr = useT();
  const { verifyPin, setPin } = useAppLock();

  // 阶段：change 模式 = 先验旧 PIN 再走 create 流程；其余模式固定
  const [stage, setStage] = useState<'verify' | 'create' | 'confirm'>(mode === 'create' ? 'create' : 'verify');
  const [pinValue, setPinValue] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 每次打开重置状态
  useEffect(() => {
    if (visible) {
      setStage(mode === 'create' ? 'create' : 'verify');
      setPinValue('');
      setFirstPin('');
      setError(null);
      setBusy(false);
    }
  }, [visible, mode]);

  const title =
    error
      ? error
      : stage === 'verify'
        ? tr('pin.verifyTitle')
        : stage === 'create'
          ? tr('pin.createTitle')
          : tr('pin.confirmTitle');

  const finishCreate = useCallback(
    async (finalPin: string) => {
      setBusy(true);
      await setPin(finalPin);
      setBusy(false);
      hapticSuccess();
      onSuccess();
      onClose();
    },
    [setPin, onSuccess, onClose]
  );

  const handleDigit = useCallback(
    (d: string) => {
      if (busy || pinValue.length >= PIN_LENGTH) return;
      setError(null);
      hapticLight();
      const next = pinValue + d;
      setPinValue(next);
      if (next.length < PIN_LENGTH) return;

      if (stage === 'verify') {
        // 验证旧 PIN（verify 模式=直接回调；change 模式=通过后进入创建阶段）
        setBusy(true);
        void (async () => {
          const ok = await verifyPin(next);
          setBusy(false);
          if (!ok) {
            setError(tr('pin.wrong'));
            setPinValue('');
            return;
          }
          if (mode === 'change') {
            onVerified?.();
            setFirstPin('');
            setPinValue('');
            setStage('create');
          } else {
            hapticSuccess();
            onSuccess();
            onClose();
          }
        })();
      } else if (stage === 'create') {
        setFirstPin(next);
        setPinValue('');
        setStage('confirm');
      } else {
        // confirm 阶段：两遍一致才创建
        if (next === firstPin) {
          void finishCreate(next);
        } else {
          setError(tr('pin.mismatch'));
          setPinValue('');
          setStage('create');
          setFirstPin('');
        }
      }
    },
    [pinValue, stage, mode, firstPin, busy, verifyPin, finishCreate, onSuccess, onVerified, onClose, tr]
  );

  const handleBackspace = useCallback(() => {
    if (busy) return;
    hapticLight();
    setPinValue((p: string) => p.slice(0, -1));
  }, [busy]);

  const handleClearPress = useCallback(() => {
    if (busy) return;
    hapticLight();
    setPinValue('');
    setError(null);
  }, [busy]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={[styles.overlay, { backgroundColor: semantic.scrim }]} activeOpacity={1} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: semantic.homeCard,
              borderColor: semantic.hairline,
              // 底部跟随安全区：手势条机型上最下面一排键不会被压住
              paddingBottom: insets.bottom + 16,
            },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handle} />
          {/* 右上角 ✕ 关闭钮（用户定版：取消改为 ✕ 并放到右侧上方，与账本弹层/账户弹层同语言） */}
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: semantic.surfaceSunken }]}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={tr('common.cancel')}
          >
            <Ionicons name="close" size={18} color={semantic.textSecondary} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: semantic.textPrimary }]}>
            {title}
          </Text>
          {error ? null : (
            <Text style={[styles.subtitle, { color: semantic.textSecondary }]}>{tr('pin.subtitle')}</Text>
          )}

          {/* 6 位圆点 */}
          <View style={styles.dotsRow}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { borderColor: semantic.accent },
                  i < pinValue.length && { backgroundColor: semantic.accent },
                ]}
              />
            ))}
          </View>

          {/* 键盘：3 列标准数字盘。原来是 4 列（1-2-3-4…），与手机拨号盘的肌肉记忆相反，
              C（清空）还夹在 9 和 0 之间 —— 想按 0 容易误触清空，这是"卡手"的主因 */}
          <View style={styles.keypad}>
            {KEY_ROWS.map((row) => (
              <View key={row.join('')} style={styles.keyRow}>
                {row.map((k) => (
                  <PressableScale
                    key={k}
                    style={[styles.key, { backgroundColor: semantic.surfaceElevated, borderColor: semantic.hairline }]}
                    activeScale={0.96}
                    onPress={() => handleDigit(k)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={k}
                  >
                    <Text style={[styles.keyText, { color: semantic.textPrimary }]}>{k}</Text>
                  </PressableScale>
                ))}
              </View>
            ))}
            <View style={styles.keyRow}>
              <PressableScale
                style={styles.keyGhost}
                activeScale={0.9}
                onPress={handleClearPress}
                disabled={busy || pinValue.length === 0}
                accessibilityRole="button"
                accessibilityLabel="clear"
              >
                <Text style={[styles.keyGhostText, { color: semantic.textSecondary }]}>C</Text>
              </PressableScale>
              <PressableScale
                style={[styles.key, { backgroundColor: semantic.surfaceElevated, borderColor: semantic.hairline }]}
                activeScale={0.96}
                onPress={() => handleDigit('0')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="0"
              >
                <Text style={[styles.keyText, { color: semantic.textPrimary }]}>0</Text>
              </PressableScale>
              <PressableScale
                style={styles.keyGhost}
                activeScale={0.9}
                onPress={handleBackspace}
                disabled={busy || pinValue.length === 0}
                accessibilityRole="button"
                accessibilityLabel="backspace"
              >
                <Ionicons name="backspace-outline" size={24} color={semantic.textSecondary} />
              </PressableScale>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    // 左右 20：键盘总宽 3×84 + 2×12 = 276，390 屏上两侧各留 57 —— 拇指不用横向跨
    // 底部内衬改在渲染期给（insets.bottom + 16），手势条机型最下面一排键不会被压住
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(128,128,140,0.4)',
    marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 12, marginTop: 4, textAlign: 'center' },
  // 右上角 ✕ 关闭钮（账户弹层 accountPickerClose 同款规格：30×30 圆底）
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 16,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 16,
    marginBottom: 24,
  },
  // 14 圆点：比 12 更清楚看出「已输入几位」，又不会喧宾夺主
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
  },
  // 三列盘：行距 / 列距都是 12（spacing.md），不再用 flexWrap 让 4 列自己折行
  keypad: { gap: 12 },
  keyRow: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  key: {
    width: 84,
    height: 60,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // C / ⌫ 不做底：数字盘两侧留白，误触概率更低（按下去只有触感）
  keyGhost: { width: 84, height: 60, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 24, fontWeight: '600' },
  keyGhostText: { fontSize: 18, fontWeight: '700' },
});
