// DateRangePickerSheet.tsx
// 标准日期范围选择器：底部上滑面板 = 快捷预设(今天/昨天/本周…) + 月历点选起止日期。
// ReportScreen 共用这份日历，保证日期选择交互/样式完全一致。

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, PanResponder, Pressable, BackHandler, useWindowDimensions } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';
import PressableScale from './PressableScale';
import { useT } from '../i18n/LanguageContext';
import { useTabBarForceHide } from '../context/TabBarAutoHideContext';
import { ThemeColors } from '../theme/theme';

export type DateRange = { start: string; end: string };

function fmt(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfWeek(d: Date) {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday;
}

function addDays(d: Date, n: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

const PRESETS: { label: string; range: (now: Date) => DateRange }[] = [
  { label: '今天', range: (now) => ({ start: fmt(now), end: fmt(now) }) }, // label 走 QUICK translate
  {
    label: '昨天',
    range: (now) => {
      const d = addDays(now, -1);
      return { start: fmt(d), end: fmt(d) };
    },
  },
  { label: '本星期', range: (now) => ({ start: fmt(startOfWeek(now)), end: fmt(addDays(startOfWeek(now), 6)) }) },
  {
    label: '上星期',
    range: (now) => ({ start: fmt(addDays(startOfWeek(now), -7)), end: fmt(addDays(startOfWeek(now), -1)) }),
  },
  {
    label: '本月',
    range: (now) => ({
      start: fmt(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: fmt(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    }),
  },
  {
    label: '上月',
    range: (now) => ({
      start: fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: fmt(new Date(now.getFullYear(), now.getMonth(), 0)),
    }),
  },
  { label: '今年', range: (now) => ({ start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` }) },
];

// 周表头与快捷标签在组件内用 t() 翻译（zh/en 字典 addTx.*）
const QUICK_KEYS: Record<string, string> = {
  '今天': 'addTx.quickToday',
  '昨天': 'addTx.quickYesterday',
  '本星期': 'addTx.quickThisWeek',
  '上星期': 'addTx.quickLastWeek',
  '本月': 'addTx.quickThisMonth',
  '上月': 'addTx.quickLastMonth',
  '今年': 'addTx.quickThisYear',
};

type Props = {
  visible: boolean;
  start: string;
  end: string;
  onClose: () => void;
  onApply: (start: string, end: string) => void;
  /** single = 只选单日（点一天立即应用）；默认 range = 选起止区间 */
  mode?: 'range' | 'single';
};

export default function DateRangePickerSheet({ visible, start, end, onClose, onApply, mode = 'range' }: Props) {
  const theme = useTheme();
  const { colors } = theme as { colors: ThemeColors };
  // 遮罩 = 全 App 唯一遮罩色 semantic.scrim；下面 scrimOpacity 是 0..1 的比例（实际透明度 = scrim 的 alpha × 比例）
  const scrimColor = theme.semantic.scrim;
  // 底部弹层贴屏幕底：底部补白要让出系统导航栏（原来写死 38，不认真机导航条）
  const bottomInset = useBottomSystemInset();
  // 窗口尺寸走 useWindowDimensions：旋转 / 分屏 / 折叠屏展开 / RN Web 改窗口时重算
  // （原来的 Dimensions.get 只在启动时取一次，翻页距离与面板高度都会停在旧尺寸）
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const t = useT();
  const now = new Date();
  const [viewMonth, setViewMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);

  // 打开时以当前范围初始化选择和视图月份
  useEffect(() => {
    if (visible) {
      setSelStart(start);
      setSelEnd(end);
      setViewMonth(new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, 1));
    }
  }, [visible, start, end]);

  const calCells = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // 周一=0
    const startDay = new Date(first);
    startDay.setDate(1 - offset);
    const cells: { key: string; day: number; muted: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(startDay);
      d.setDate(startDay.getDate() + i);
      cells.push({ key: fmt(d), day: d.getDate(), muted: d.getMonth() !== viewMonth.getMonth() });
    }
    return cells;
  }, [viewMonth]);

  const onCalTap = (key: string) => {
    if (mode === 'single') {
      // 单日模式：点一天立即应用并关闭
      onApply(key, key);
      onClose();
      return;
    }
    if (!selStart || (selStart && selEnd)) {
      setSelStart(key);
      setSelEnd(null);
      return;
    }
    if (key === selStart) {
      setSelEnd(key);
      return;
    }
    if (key < selStart) {
      setSelStart(key);
      return;
    }
    setSelEnd(key);
  };

  const confirm = () => {
    if (!selStart || !selEnd) return;
    onApply(selStart, selEnd);
    onClose();
  };

  // 单日模式下只保留"今天/昨天"——本周/上周/本月/上月/今年/去年本质上都是"日期范围"，
  // 跟单日选择的场景对不上，所以一起过滤掉，不只是过滤"整月整年"这几个
  // 单日模式(图1 标准):不显示预设,直接月历点选
  const presetsToShow = mode === 'range' ? PRESETS : [];

  // 月历左右滑动切换月份：横向拖动时月历轻微跟手（最多70px），
  // 松手超过60px且横向占主导就触发"翻页"——当前月整页滑出，新月份从另一侧滑入
  const swipeTranslate = useRef(new Animated.Value(0)).current;
  const viewMonthRef = useRef(viewMonth);
  viewMonthRef.current = viewMonth;
  // 翻页距离用"面板内容宽度"（窗口宽 - sheet左右padding），旧页完全滑出画面
  const flipDistance = windowWidth - 40 - (mode === 'range' ? 116 : 0);

  // dir=1 翻到下个月（内容向左滑出、新月从右侧进），dir=-1 翻到上个月
  const flipMonth = (dir: 1 | -1) => {
    Animated.timing(swipeTranslate, { toValue: -dir * flipDistance, duration: 130, useNativeDriver: true }).start(() => {
      const m = viewMonthRef.current;
      setViewMonth(new Date(m.getFullYear(), m.getMonth() + dir, 1));
      // 新月份瞬间摆到滑入起点，再弹回原位
      swipeTranslate.setValue(dir * flipDistance);
      Animated.spring(swipeTranslate, { toValue: 0, friction: 7, tension: 70, useNativeDriver: true }).start();
    });
  };

  const swipeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (_e, g) => {
        swipeTranslate.setValue(Math.max(-70, Math.min(70, g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -60) flipMonth(1);
        else if (g.dx > 60) flipMonth(-1);
        else Animated.spring(swipeTranslate, { toValue: 0, friction: 6, tension: 60, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(swipeTranslate, { toValue: 0, friction: 6, tension: 60, useNativeDriver: true }).start();
      },
    })
  ).current;

  const s = makeStyles(colors);

  // ---------- 外壳:与"选择账本"同款的树内覆盖层(不再用 RN Modal——
  // Modal 独立原生窗口会和 Reanimated 在安卓上出幽灵副本,也接不了跟手下拉) ----------
  const forceHideTabBar = useTabBarForceHide();
  useEffect(() => {
    if (visible) forceHideTabBar(true);
    return () => {
      // 只有面板此前是打开的才放栏：父页面（记一笔）在支出/收入 ↔ 转账/兑换之间切换时
      // 会卸载旧分支的本组件（此时 visible=false、父页面的计算器键盘还开着，Tab 栏本该
      // 保持隐藏）——无条件放栏会让底部导航栏在切到转账/兑换时跑出来。
      if (visible) forceHideTabBar(false);
    };
  }, [visible, forceHideTabBar]);

  // onClose 用 ref 转发,保证手势对象稳定不随渲染重建
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 初始值=屏幕外(900)：首帧面板不可见，入场动画从正确起点滑入，
  // 否则 useEffect 设起点前会先画出一帧"完整面板"（闪现 bug）
  const sheetPanY = useSharedValue(900);
  const scrimOpacity = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const closingRef = useRef(false);

  // 入场:卡片从屏幕外滑入 + 遮罩淡入(panY 复位也在这里做)
  useEffect(() => {
    if (visible) {
      closingRef.current = false;
      sheetPanY.value = 900;
      scrimOpacity.value = 0;
      sheetPanY.value = withTiming(0, { duration: 260 });
      scrimOpacity.value = withTiming(1, { duration: 260 });
    }
  }, [visible, sheetPanY, scrimOpacity]);

  const finishClose = () => {
    onCloseRef.current();
  };

  // 安卓硬件返回键：面板开着时先收起面板（播出场动画），不让返回键退出整页
  const dismissRef = useRef<() => void>(() => undefined);
  dismissRef.current = () => dismissSheet();
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      dismissRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  const dismissSheet = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    scrimOpacity.value = withTiming(0, { duration: 180 });
    sheetPanY.value = withTiming(
      900,
      { duration: 220 },
      (finished) => {
        if (finished) runOnJS(finishClose)();
      }
    );
  };

  // 手势:manualActivation 模式(默认不接管任何触摸,日期格点击/月份翻页零干扰),
  // 下拖 12px 才激活;onUpdate 跟手;松手只要向下就收起(无阈值),向上则回弹
  const sheetPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e) => {
          dragStartY.value = e.allTouches[0]?.absoluteY ?? 0;
        })
        .onTouchesMove((e, stateManager) => {
          if (e.allTouches.length === 0) return;
          const dy = e.allTouches[0].absoluteY - dragStartY.value;
          if (dy > 12) stateManager.activate();
        })
        .onUpdate((e) => {
          sheetPanY.value = Math.max(0, e.translationY);
          scrimOpacity.value = Math.min(1, (Math.max(0, e.translationY) / 500 + 0.15) / 0.4);
        })
        .onEnd((e) => {
          if (e.translationY > 0 || e.velocityY > 200) {
            runOnJS(dismissSheet)();
          } else {
            sheetPanY.value = withSpring(0, { damping: 22, stiffness: 320 });
            scrimOpacity.value = withTiming(1, { duration: 150 });
          }
        })
        .onFinalize(() => {
          // 手势被打断时兜底回弹(已激活但没走 onEnd 的情况)
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const sheetAnimStyle = useAnimatedStyle(() => ({ transform: [{ translateY: sheetPanY.value }] }), []);
  const scrimAnimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }), []);

  // 面板最大高度 = min(屏高 × 0.85, 视口高 − 顶部安全区)：px 值随窗口重算，不再写死 '85%'。
  // 底部安全区由 paddingBottom（max(20, bottomInset + 16)）让出，不在这里重复扣，
  // 否则底部会多出一条空带。面板自身没有输入框，不需要键盘上抬。
  const sheetMaxHeight = Math.round(Math.max(0, Math.min(windowHeight * 0.85, windowHeight - insets.top)));

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 90, elevation: 90 }]}>
      {/* 遮罩:点空白处收起;透明度随拖动变深 */}
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose}>
        <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }, scrimAnimStyle]} />
      </Pressable>

      {/* 底部卡片:底部锚定、圆角 24、最高 85% 屏高;整体跟手下拉 */}
      <GestureDetector gesture={sheetPanGesture}>
        <Reanimated.View
          style={[s.sheet, { paddingBottom: Math.max(20, bottomInset + 16), maxHeight: sheetMaxHeight }, sheetAnimStyle]}
        >
          <View style={s.grabber} />
          {/* 标题栏:✕ 关闭移到右侧 + 标题居中(与选择账本头部同款) */}
          <View style={s.sheetHeader}>
            <View style={{ width: 20 }} />
            {mode !== 'single' && <Text style={s.title}>{t('addTx.dateSheetTitle')}</Text>}
            <PressableScale onPress={onClose} activeScale={0.90} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </PressableScale>
          </View>

          {mode === 'single' ? (
            <>
            {/* 单日模式：无预设列，月历通栏（排版不变） */}
            <Animated.View
              style={{ transform: [{ translateX: swipeTranslate }] }}
              {...swipeResponder.panHandlers}
            >
          <View style={s.calHeader}>
            <PressableScale onPress={() => flipMonth(-1)} hitSlop={8} activeScale={0.90}>
              <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
            </PressableScale>
            <Text style={s.calTitle}>{t('addTx.calTitle', { y: viewMonth.getFullYear(), m: viewMonth.getMonth() + 1 })}</Text>
            <PressableScale onPress={() => flipMonth(1)} hitSlop={8} activeScale={0.90}>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </PressableScale>
          </View>
          <View style={s.calWeekRow}>
            {t('home.weekdays').split(',').map((w) => (
              <Text key={w} style={s.calWeekCell}>{w}</Text>
            ))}
          </View>
          <View style={s.calGrid}>
            {calCells.map((cell) => {
              const isStart = selStart === cell.key;
              const isEnd = selEnd === cell.key;
              const inRange = !!selStart && !!selEnd && cell.key > selStart && cell.key < selEnd;
              const isToday = cell.key === fmt(now);
              return (
                <PressableScale key={cell.key} style={s.calCell} activeScale={0.92} onPress={() => onCalTap(cell.key)}>
                  <View style={[s.calDay, inRange && s.calDayInRange, (isStart || isEnd) && s.calDaySelected]}>
                    <Text
                      style={[
                        s.calDayText,
                        cell.muted && s.calDayMuted,
                        isToday && !isStart && !isEnd && s.calDayToday,
                        (isStart || isEnd) && s.calDayTextSelected,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
          </View>
          </Animated.View>
            </>
          ) : (
            <>
            {/* range 模式（图1排版）：左边竖排预设列，右边月历；行为与原来完全一致 */}
            <View style={s.rangeLayout}>
              <View style={s.presetColumn}>
                {presetsToShow.map((p) => {
                  const r = p.range(now);
                  const active = selStart === r.start && selEnd === r.end;
                  return (
                    <PressableScale
                      key={p.label}
                      style={[s.presetItem, active && s.presetChipActive]}
                      activeScale={0.95}
                      onPress={() => {
                        setSelStart(r.start);
                        setSelEnd(r.end);
                      }}
                    >
                      <Text style={[s.presetText, active && s.presetTextActive]}>{QUICK_KEYS[p.label] ? t(QUICK_KEYS[p.label]) : p.label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              <View style={s.calPane}>
                <Animated.View
                  style={{ transform: [{ translateX: swipeTranslate }] }}
                  {...swipeResponder.panHandlers}
                >
                  <View style={s.calHeader}>
                    <PressableScale onPress={() => flipMonth(-1)} hitSlop={8} activeScale={0.90}>
                      <Ionicons name="chevron-back" size={16} color={colors.textSecondary} />
                    </PressableScale>
                    <Text style={s.calTitle}>{t('addTx.calTitle', { y: viewMonth.getFullYear(), m: viewMonth.getMonth() + 1 })}</Text>
                    <PressableScale onPress={() => flipMonth(1)} hitSlop={8} activeScale={0.90}>
                      <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                    </PressableScale>
                  </View>
                  <View style={s.calWeekRow}>
                    {t('home.weekdays').split(',').map((w) => (
                      <Text key={w} style={s.calWeekCell}>{w}</Text>
                    ))}
                  </View>
                  <View style={s.calGrid}>
                    {calCells.map((cell) => {
                      const isStart = selStart === cell.key;
                      const isEnd = selEnd === cell.key;
                      const inRange = !!selStart && !!selEnd && cell.key > selStart && cell.key < selEnd;
                      const isToday = cell.key === fmt(now);
                      return (
                        <PressableScale key={cell.key} style={s.calCell} activeScale={0.92} onPress={() => onCalTap(cell.key)}>
                          <View style={[s.calDay, inRange && s.calDayInRange, (isStart || isEnd) && s.calDaySelected]}>
                            <Text
                              style={[
                                s.calDayText,
                                cell.muted && s.calDayMuted,
                                isToday && !isStart && !isEnd && s.calDayToday,
                                (isStart || isEnd) && s.calDayTextSelected,
                              ]}
                            >
                              {cell.day}
                            </Text>
                          </View>
                        </PressableScale>
                      );
                    })}
                  </View>
                </Animated.View>
              </View>
            </View>
            <PressableScale
              style={[s.confirmBtn, (!selStart || !selEnd) && s.confirmDisabled]}
              activeScale={0.97}
              onPress={confirm}
              disabled={!selStart || !selEnd}
            >
              <Text style={s.confirmText}>
                {selStart && selEnd ? t('addTx.dateSheetApply', { range: `${selStart} ~ ${selEnd}` }) : t('addTx.dateSheetSelectEnd')}
              </Text>
            </PressableScale>
            </>
          )}
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingTop: 16,
      paddingBottom: 38,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    grabber: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      marginBottom: 10,
      borderRadius: 3,
      backgroundColor: colors.divider,
    },
    title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: 14 },
    // range 模式（图1）：左侧竖排预设列 + 右侧月历
    rangeLayout: { flexDirection: 'row' },
    presetColumn: { width: '15%', borderRightWidth: 1, borderRightColor: colors.divider, paddingRight: 2, gap: 2 },
    presetItem: { paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
    calPane: { flex: 1, paddingLeft: 12 },
    presetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
    presetChip: {
      width: '23%',
      alignItems: 'center',
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: colors.summaryCard,
    },
    // 单日模式只剩"今天/昨天"两个预设，沿用range模式24%的窄格子会显得很空，改成两列平分
    presetChipSingle: { width: '48%' },
    presetChipActive: { backgroundColor: colors.link + '1A' },
    presetText: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' },
    presetTextActive: { color: colors.link, fontWeight: '700' },
    calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    calTitle: { fontSize: 17, fontWeight: '700', color: colors.textPrimary },
    calWeekRow: { flexDirection: 'row', marginBottom: 4 },
    calWeekCell: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '600', color: colors.textTertiary },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calCell: { width: `${100 / 7}%` as any, alignItems: 'center', paddingVertical: 3 },
    calDay: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
    calDayInRange: { backgroundColor: colors.link + '1A', borderRadius: 0 },
    calDaySelected: { backgroundColor: colors.link },
    calDayText: { fontSize: 15, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    calDayMuted: { color: colors.divider },
    calDayToday: { color: colors.link, fontWeight: '700' },
    calDayTextSelected: { color: colors.fabIcon, fontWeight: '700' },
    confirmBtn: {
      backgroundColor: colors.fabBg,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 10,
    },
    confirmDisabled: { backgroundColor: colors.dividerHair },
    confirmText: { color: colors.fabIcon, fontWeight: '700', fontSize: 15 },
  });
