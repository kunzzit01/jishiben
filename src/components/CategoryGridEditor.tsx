// CategoryGridEditor.tsx
// 分类网格编辑器（管理类别页 / 记一笔选择类别页共用一套）。
// 本组件从 CategoryManagementScreen 里抽出来，抽出来是为了两处行为与视觉完全一致。
//
// 两种状态（iOS 主屏幕那套时序）：
//   干净态：磁贴不抖、无删除角标；短按磁贴 = 选中该分类并返回
//   编辑态（长按任一磁贴 200ms 进入）：全体磁贴轻微摆动 + 删除角标淡入，
//          此时才可拖动；被拖的那一枚停抖、放大 1.06 跟手，其余磁贴用 transform 平移让位
//          （⚠ 绝不重排 DOM：重排会把按住的节点挪走、丢 pointer capture，手势中途断）
//          被拖走的那一格原位留空（内容隐身），不画任何占位框（用户明确不要虚线框）
//   退出编辑态：点空白区域 / 短按某个磁贴（只退出，不选中）/ 拖动松手后 1.5s 无操作
//   系统「减弱动态效果」时不抖动，删除角标照常出现
//
// 取舍（用户明确要求）：编辑态下短按磁贴不选中 —— 防止"想拖/想删却误选了分类并跳转"。
//
// 其它：删除 = 图标右上角红色角标；末尾虚线「＋」磁贴 = 新增入口（它不属于编辑态，平时常显）；
//      贴边自动滚动（窗口上下 140px 边缘带，16ms 步进 12px）。
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { ScrollView, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useTheme } from '../theme/useTheme';
import type { SemanticColors, Spacing } from '../theme/theme';
import { useT } from '../i18n/LanguageContext';
import { getCategoryLabel } from '../i18n/categories';
import type { Category } from '../types';
import type { CategoryIconName } from '../constants/categoryAddOptions';
import PressableScale from './PressableScale';
import AppText from './ui/AppText';
import IconCircle from './ui/IconCircle';

/** 长按多久进入编辑态并抬起（两处网格共用一个值，别各改各的） */
export const GRID_LONG_PRESS_MS = 200;
/** 被拖项放大倍数 */
export const GRID_DRAG_SCALE = 1.06;
/** 落位动画时长：幽灵滑到目标槽位后再把顺序写回 + 卸载幽灵 */
export const GRID_LAND_MS = 140;
/** 槽位固定高度：拖拽时"手指落在哪个槽位"要按像素直接算，所以不能靠内容撑高 */
export const GRID_SLOT_H = 96;
/** 贴边自动滚动：离窗口上/下边这么近开始滚，每 16ms 滚这么多 */
export const GRID_EDGE_ZONE = 140;
export const GRID_SCROLL_STEP = 12;
/** 手指移动不足这个距离就不再往 JS 送坐标（贴边判定用不到更细的粒度） */
export const GRID_FINGER_STEP = 20;
/** 编辑态抖动：单程 90ms（往返 180ms）、±1.3° */
const JIGGLE_DEG = 1.3;
const JIGGLE_HALF_MS = 90;
/** 编辑态视觉元素（虚线占位 + 删除角标）：进入淡入 120ms / 退出淡出 400ms */
const EDIT_IN_MS = 120;
const EDIT_OUT_MS = 400;
/** 拖动松手后无操作多久自动退出编辑态 */
const EDIT_IDLE_MS = 1500;

/** 组内排序：按持久化的 order 编号排（没编号的排最后），编号只在本组内比较 */
export function sortByOrder(items: Category[], order: Record<string, number>): Category[] {
  return [...items].sort((a, b) => (order[a.id] ?? 9999) - (order[b.id] ?? 9999));
}

/** 把 from 位上的元素搬到 to 位：拖拽中用它算"其余磁贴让位"后的展示顺序 */
export function moveInArray<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * 手指位置 → 落点槽位下标（手势 worklet 与 JS 自动滚动共用同一份算式）。
 * gridTop 是网格顶边在**内容坐标系**里的位置：减掉当前滚动量才是它在窗口里的位置。
 */
function gridIndexAt(
  x: number,
  y: number,
  gridLeft: number,
  gridTop: number,
  scrollDelta: number,
  slotW: number,
  count: number,
  cols: number,
  slotH: number
): number {
  'worklet';
  if (count <= 0 || slotW <= 0 || cols <= 0) return 0;
  const col = Math.min(cols - 1, Math.max(0, Math.floor((x - gridLeft) / slotW)));
  const row = Math.max(0, Math.floor((y - (gridTop - scrollDelta)) / slotH));
  return Math.min(count - 1, row * cols + col);
}

/** 拖拽位移量：worklet 里每帧写，不触发 React 重渲染 */
type GridDragShared = {
  moveX: SharedValue<number>;
  moveY: SharedValue<number>;
  scale: SharedValue<number>;
  slotW: SharedValue<number>;
  count: SharedValue<number>;
  from: SharedValue<number>;
  /** 上一次报告给 JS 的落点槽位（只在变化时报，避免每帧 setState） */
  cur: SharedValue<number>;
  baseY: SharedValue<number>;
  transY: SharedValue<number>;
  cols: SharedValue<number>;
  slotH: SharedValue<number>;
  /** 编辑态删除角标的不透明度（0 = 干净态） */
  reveal: SharedValue<number>;
};

/** 几何量：网格在窗口里的位置（内容坐标）、拖拽开始时的滚动量、上一次送去 JS 的手指坐标 */
type GridGeometryShared = {
  gridLeft: SharedValue<number>;
  gridTop: SharedValue<number>;
  scroll0: SharedValue<number>;
  lastX: SharedValue<number>;
  lastY: SharedValue<number>;
};

/** 磁贴外框（图标 + 删除角标 + 标签）：管理态和拖起的幽灵共用同一份外观 */
function GridTileFace({
  item,
  styles,
  semantic,
  reveal,
  editing,
  onDelete,
}: {
  item: Category;
  styles: ReturnType<typeof makeGridStyles>;
  semantic: SemanticColors;
  reveal: SharedValue<number>;
  editing: boolean;
  onDelete?: (id: string, name: string) => void;
}) {
  const t = useT();
  // 删除角标也属于编辑态：平时 opacity 0 且不吃指针事件
  const badgeStyle = useAnimatedStyle(() => ({ opacity: reveal.value }));
  return (
    <View style={styles.gridFace}>
      {/* 删除角标贴图标右上角：用行内负边距叠上去（绝对定位会锚到 PressableScale 那颗
          0 高的按钮上，角标会掉到标签那一行压住文字） */}
      <View style={styles.gridIconRow}>
        <IconCircle size={52} color={item.color} icon={item.icon as CategoryIconName} />
        {onDelete && (
          <Animated.View style={[styles.gridDeleteBadge, badgeStyle]} pointerEvents={editing ? 'auto' : 'none'}>
            <PressableScale
              activeScale={0.9}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => onDelete(item.id, item.name)}
              accessibilityLabel={t('common.delete')}
            >
              <Ionicons name="remove-circle" size={18} color={semantic.danger} />
            </PressableScale>
          </Animated.View>
        )}
      </View>
      <AppText variant="caption" numberOfLines={1} style={styles.gridLabel}>
        {getCategoryLabel(item, t)}
      </AppText>
    </View>
  );
}

/**
 * 单个磁贴：虚线占位与删除角标平时隐身；长按 200ms 进入编辑态并抬起拖动，编辑态全体抖动。
 * 干净态短按 = 选中并返回；编辑态短按 = 只退出编辑态（不选中）。
 */
function CategoryGridCell({
  item,
  index,
  hidden,
  jiggling,
  reduceMotion,
  editing,
  shiftXTarget,
  shiftYTarget,
  draggable,
  styles,
  semantic,
  onDelete,
  onCellPress,
  drag,
  geometry,
  scrollY,
  onDragStart,
  onDragHover,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onDraggingChange,
}: {
  item: Category;
  /** 抖动相位偏移用（每格错开，不要整齐划一） */
  index: number;
  hidden: boolean;
  /** 编辑态：全部磁贴轻微摆动（被拖的那一枚除外） */
  jiggling: boolean;
  reduceMotion: boolean;
  editing: boolean;
  /** 让位平移量（其余磁贴腾出/补上空位；被拖的那一枚永远是 0，原槽位只留虚线框） */
  shiftXTarget: number;
  shiftYTarget: number;
  draggable: boolean;
  styles: ReturnType<typeof makeGridStyles>;
  semantic: SemanticColors;
  onDelete?: (id: string, name: string) => void;
  /** 短按：干净态 = 选中；编辑态 = 退出编辑态（由父层决定） */
  onCellPress: (id: string) => void;
  drag: GridDragShared;
  geometry: GridGeometryShared;
  scrollY: SharedValue<number>;
  onDragStart: (id: string, absX: number, absY: number) => void;
  onDragHover: (index: number, absX: number, absY: number) => void;
  onDragMove: (absX: number, absY: number) => void;
  onDragEnd: (from: number, to: number) => void;
  onDragCancel: () => void;
  onDraggingChange?: (dragging: boolean) => void;
}) {
  const t = useT();
  const draggingCbRef = useRef(onDraggingChange);
  draggingCbRef.current = onDraggingChange;
  const reportDragging = useCallback((v: boolean) => {
    draggingCbRef.current?.(v);
  }, []);
  const { moveX, moveY, scale, slotW, count, from, cur, baseY, transY, cols, slotH, reveal } = drag;
  const { gridLeft, gridTop, scroll0, lastX, lastY } = geometry;

  // 让位用 transform 平移，绝不重排 DOM：重排会把按住的那个节点在 DOM 里挪走，
  // 浏览器的 pointer capture 随之丢失，拖到一半手势就断了
  const shiftX = useSharedValue(0);
  const shiftY = useSharedValue(0);
  useEffect(() => {
    shiftX.value = withTiming(shiftXTarget, { duration: 170 });
    shiftY.value = withTiming(shiftYTarget, { duration: 170 });
  }, [shiftXTarget, shiftYTarget, shiftX, shiftY]);

  // 编辑态抖动：每格独立相位（index 交错起点 + 正反交替），往返 180ms、±1.3°
  const jig = useSharedValue(0);
  useEffect(() => {
    if (jiggling && !reduceMotion) {
      const dir = index % 2 === 0 ? 1 : -1;
      jig.value = withDelay(
        (index % 4) * 25,
        withRepeat(withTiming(dir * JIGGLE_DEG, { duration: JIGGLE_HALF_MS, easing: Easing.inOut(Easing.ease) }), -1, true)
      );
    } else {
      jig.value = withTiming(0, { duration: 120 });
    }
  }, [jiggling, reduceMotion, index, jig]);

  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shiftX.value }, { translateY: shiftY.value }, { rotate: jig.value + 'deg' }],
  }));

  // 手势只在挂载时建一次：拖拽过程中本组会因落点变化重渲染，
  // 每次重建手势对象会把正在进行的拖拽打断
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(GRID_LONG_PRESS_MS)
        .onStart((e) => {
          'worklet';
          scroll0.value = scrollY.value;
          transY.value = 0;
          lastX.value = e.absoluteX;
          lastY.value = e.absoluteY;
          scale.value = withTiming(GRID_DRAG_SCALE, { duration: 130 });
          // 起始槽位交给 JS 用 items 数组算（量出来之前就准），这里只负责抬起
          runOnJS(onDragStart)(item.id, e.absoluteX, e.absoluteY);
          runOnJS(reportDragging)(true);
        })
        .onUpdate((e) => {
          'worklet';
          moveX.value = (from.value % cols.value) * slotW.value + e.translationX;
          transY.value = e.translationY;
          moveY.value = baseY.value + e.translationY + (scrollY.value - scroll0.value);
          const idx = gridIndexAt(
            e.absoluteX,
            e.absoluteY,
            gridLeft.value,
            gridTop.value,
            scrollY.value - scroll0.value,
            slotW.value,
            count.value,
            cols.value,
            slotH.value
          );
          if (idx !== cur.value) {
            cur.value = idx;
            runOnJS(onDragHover)(idx, e.absoluteX, e.absoluteY);
          }
          if (
            Math.abs(e.absoluteX - lastX.value) > GRID_FINGER_STEP ||
            Math.abs(e.absoluteY - lastY.value) > GRID_FINGER_STEP
          ) {
            lastX.value = e.absoluteX;
            lastY.value = e.absoluteY;
            runOnJS(onDragMove)(e.absoluteX, e.absoluteY);
          }
        })
        .onEnd((e) => {
          'worklet';
          const idx = gridIndexAt(
            e.absoluteX,
            e.absoluteY,
            gridLeft.value,
            gridTop.value,
            scrollY.value - scroll0.value,
            slotW.value,
            count.value,
            cols.value,
            slotH.value
          );
          // 落位：幽灵先滑到目标槽位再交差（幽灵坐标是内容坐标，直接用槽位原点）
          moveX.value = withTiming((idx % cols.value) * slotW.value, { duration: 140 });
          moveY.value = withTiming(Math.floor(idx / cols.value) * slotH.value, { duration: 140 });
          scale.value = withTiming(1, { duration: 140 });
          runOnJS(onDragEnd)(from.value, idx);
        })
        .onFinalize((_e, success) => {
          'worklet';
          runOnJS(reportDragging)(false);
          if (!success) {
            scale.value = withTiming(1, { duration: 120 });
            runOnJS(onDragCancel)();
          }
        }),
    []
  );

  return (
    <View style={styles.gridSlot}>
      {/* 内容层：让位/抖动只作用在这一层（父节点在 DOM 里始终不动，手势不会被指针捕获丢失打断） */}
      <Animated.View style={[styles.gridContent, shiftStyle, hidden && styles.gridHidden]}>
        {draggable ? (
          <GestureDetector gesture={gesture}>
            <View style={styles.gridHit}>
              <PressableScale
                style={styles.gridSelectWrap}
                activeScale={0.97}
                onPress={() => onCellPress(item.id)}
                accessibilityLabel={getCategoryLabel(item, t)}
              >
                <GridTileFace item={item} styles={styles} semantic={semantic} reveal={reveal} editing={editing} onDelete={onDelete} />
              </PressableScale>
            </View>
          </GestureDetector>
        ) : (
          <PressableScale
            style={styles.gridSelectWrap}
            activeScale={0.97}
            onPress={() => onCellPress(item.id)}
            accessibilityLabel={getCategoryLabel(item, t)}
          >
            <GridTileFace item={item} styles={styles} semantic={semantic} reveal={reveal} editing={editing} onDelete={onDelete} />
          </PressableScale>
        )}
      </Animated.View>
    </View>
  );
}

export type CategoryGridEditorProps = {
  items: Category[];
  /** 列数（管理类别 3 列 / 记一笔 4 列） */
  columns?: number;
  /** 槽位高度（拖拽按像素算落点，必须固定） */
  slotHeight?: number;
  /** 能否长按进入编辑态拖动（选择器形态关掉它，保持"点一下就返回"） */
  draggable?: boolean;
  /** 给了就整格可点 = 选中该分类（仅干净态；编辑态短按只退出） */
  onPick?: (id: string) => void;
  /** 给了就在图标右上角显示删除角标（仅编辑态可见） */
  onDelete?: (id: string, name: string) => void;
  /** 松手落位后把新顺序交回调用方（写库的键由调用方决定） */
  onReorder: (next: Category[]) => void;
  /** 给了就渲染网格末尾的虚线＋磁贴（新增入口） */
  onToggleAdd?: () => void;
  /** 新增磁贴的开关态（同时改图标与文案） */
  isAdding?: boolean;
  /** 外层 ScrollView（贴边自动滚动要它） */
  scrollRef: { current: ScrollView | null };
  /** 外层 ScrollView 的内容高度（自动滚动夹取用） */
  contentH: { current: number };
  /** 外层 ScrollView 的滚动量（内容坐标换算用，滚动时由页面写） */
  scrollY: SharedValue<number>;
  /** 图标拖拽开始/结束通告：页面据此锁住外层滚动，拖拽期间组卡保持不动 */
  onDraggingChange?: (dragging: boolean) => void;
  style?: ViewStyle;
};

/**
 * 一组分类的网格：槽位 = 本组分类 + 末尾的虚线「＋」磁贴。
 * 拖动时只把"展示顺序"做让位排列（真数据等松手才写回），被拖的磁贴内容隐藏、
 * 由一枚绝对定位的幽灵跟手 —— 与列表重排解耦，所以它不会跟着让位抖动。
 */
export function CategoryGridEditor({
  items,
  columns = 3,
  slotHeight = GRID_SLOT_H,
  draggable = true,
  onPick,
  onDelete,
  onReorder,
  onToggleAdd,
  isAdding = false,
  scrollRef,
  contentH,
  scrollY,
  style,
  onDraggingChange,
}: CategoryGridEditorProps) {
  const { height: windowH } = useWindowDimensions();
  const { semantic, spacing, glass, motion } = useTheme();
  const t = useT();
  const reduceMotion = !!motion?.reduceMotion;
  const [gridW, setGridW] = useState(0);
  /** 编辑态：长按进入；点空白 / 短按磁贴 / 拖动后 1.5s 无操作退出 */
  const [editing, setEditing] = useState(false);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [drag, setDrag] = useState<{ id: string; from: number; hover: number } | null>(null);

  const gridRef = useRef<View | null>(null);
  /** 网格左上角（内容坐标：top 里已经加回测量那一刻的滚动量，之后滚动不用再量） */
  const rectRef = useRef({ left: 0, top: 0 });
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;
  const fingerRef = useRef({ x: 0, y: 0, active: false });
  const draggingRef = useRef<string | null>(null);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<() => void>(() => {});
  /** 刚拖完的那一下松手不要当成点击（否则拖完会顺手把分类选走 / 返回） */
  const suppressPickRef = useRef(false);
  const suppressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 拖动松手后无操作自动退出编辑态 */
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const moveX = useSharedValue(0);
  const moveY = useSharedValue(0);
  const scale = useSharedValue(1);
  const slotW = useSharedValue(0);
  const count = useSharedValue(items.length);
  const from = useSharedValue(0);
  const cur = useSharedValue(0);
  const baseY = useSharedValue(0);
  const transY = useSharedValue(0);
  const gridLeft = useSharedValue(0);
  const gridTop = useSharedValue(0);
  const scroll0 = useSharedValue(0);
  const lastX = useSharedValue(0);
  const lastY = useSharedValue(0);
  const cols = useSharedValue(columns);
  const slotH = useSharedValue(slotHeight);
  /** 编辑态视觉元素（虚线占位 + 删除角标）：0 = 干净态 */
  const reveal = useSharedValue(0);

  const dragShared: GridDragShared = useMemo(
    () => ({ moveX, moveY, scale, slotW, count, from, cur, baseY, transY, cols, slotH, reveal }),
    [moveX, moveY, scale, slotW, count, from, cur, baseY, transY, cols, slotH, reveal]
  );
  const geometryShared: GridGeometryShared = useMemo(
    () => ({ gridLeft, gridTop, scroll0, lastX, lastY }),
    [gridLeft, gridTop, scroll0, lastX, lastY]
  );

  const slotWidth = gridW > 0 ? Math.max(0, gridW - spacing.sm * 2) / columns : 0;

  useEffect(() => {
    count.value = items.length;
    slotW.value = slotWidth;
    cols.value = columns;
    slotH.value = slotHeight;
  }, [items.length, slotWidth, columns, slotHeight, count, slotW, cols, slotH]);

  // 编辑态开关 → 虚线占位 + 删除角标淡入/淡出（120ms / 400ms，全在 UI 线程跑）
  useEffect(() => {
    reveal.value = withTiming(editing ? 1 : 0, { duration: editing ? EDIT_IN_MS : EDIT_OUT_MS });
  }, [editing, reveal]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const exitEditing = useCallback(() => {
    clearIdleTimer();
    setEditing(false);
  }, [clearIdleTimer]);

  const syncRect = useCallback(() => {
    gridRef.current?.measureInWindow((x, y) => {
      rectRef.current = { left: x, top: y + scrollY.value };
      gridLeft.value = x;
      gridTop.value = y + scrollY.value;
    });
  }, [gridLeft, gridTop, scrollY]);

  const stopLoop = useCallback(() => {
    if (loopRef.current != null) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
  }, []);

  const startLoop = useCallback(() => {
    if (loopRef.current == null) loopRef.current = setInterval(() => tickRef.current(), 16);
  }, []);

  // 贴边自动滚动：手指停在窗口上/下边缘带里，就每 16ms 滚一档；
  // 页面在手指下滚了，幽灵（内容坐标）要补回同样的量，落点槽位也要重算
  tickRef.current = () => {
    if (draggingRef.current == null) {
      stopLoop();
      return;
    }
    const f = fingerRef.current;
    const dir = f.y > windowH - GRID_EDGE_ZONE ? 1 : f.y < GRID_EDGE_ZONE ? -1 : 0;
    if (!dir) return;
    const max = Math.max(0, contentH.current - windowH);
    const current = scrollY.value;
    const next = Math.min(max, Math.max(0, current + dir * GRID_SCROLL_STEP));
    if (next === current) return;
    scrollRef.current?.scrollTo({ y: next, animated: false });
    moveY.value = baseY.value + transY.value + (next - scroll0.value);
    const idx = gridIndexAt(
      f.x,
      f.y,
      gridLeft.value,
      gridTop.value,
      next - scroll0.value,
      slotW.value,
      count.value,
      cols.value,
      slotH.value
    );
    if (idx !== cur.value) {
      cur.value = idx;
      setDrag((prev) => (prev && prev.hover !== idx ? { ...prev, hover: idx } : prev));
    }
  };

  const handleDragStart = useCallback(
    (id: string, absX: number, absY: number) => {
      const startIndex = Math.max(0, itemsRef.current.findIndex((c) => c.id === id));
      draggingRef.current = id;
      suppressPickRef.current = true;
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
      clearIdleTimer();
      fingerRef.current = { x: absX, y: absY, active: true };
      from.value = startIndex;
      cur.value = startIndex;
      baseY.value = Math.floor(startIndex / columns) * slotHeight;
      moveX.value = (startIndex % columns) * slotW.value;
      moveY.value = baseY.value;
      // 长按 200ms 抬起 = 进入编辑态（虚线占位 + 删除角标淡入）
      setEditing(true);
      setDrag({ id, from: startIndex, hover: startIndex });
      syncRect();
      startLoop();
    },
    [baseY, cur, from, moveX, moveY, slotW, startLoop, syncRect, clearIdleTimer, columns, slotHeight]
  );

  const clampHover = useCallback((index: number) => {
    const last = Math.max(0, itemsRef.current.length - 1);
    if (!Number.isFinite(index)) return 0;
    return Math.max(0, Math.min(last, Math.trunc(index)));
  }, []);

  const handleDragHover = useCallback(
    (index: number, absX: number, absY: number) => {
      fingerRef.current = { x: absX, y: absY, active: true };
      const safe = clampHover(index);
      setDrag((prev) => (prev && prev.hover !== safe ? { ...prev, hover: safe } : prev));
    },
    [clampHover]
  );

  const handleDragMove = useCallback((absX: number, absY: number) => {
    fingerRef.current = { x: absX, y: absY, active: true };
  }, []);

  const releasePickSuppression = useCallback(() => {
    if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
    // 松手后浏览器还会补一条 click：等它过去再放开
    suppressTimerRef.current = setTimeout(() => {
      suppressPickRef.current = false;
    }, 350);
  }, []);

  const handleDragEnd = useCallback(
    (fromIndex: number, toIndex: number) => {
      fingerRef.current.active = false;
      stopLoop();
      releasePickSuppression();
      // 等幽灵滑到目标槽位（GRID_LAND_MS）再收尾：改顺序 + 卸载幽灵在同一拍
      setTimeout(() => {
        draggingRef.current = null;
        setDrag(null);
        if (toIndex !== fromIndex) {
          reorderRef.current(moveInArray(itemsRef.current, fromIndex, toIndex));
        }
      }, GRID_LAND_MS);
      // 松手后停在编辑态，1.5s 无操作自动退出（回到干净态）
      clearIdleTimer();
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        setEditing(false);
      }, EDIT_IDLE_MS);
    },
    [stopLoop, releasePickSuppression, clearIdleTimer]
  );

  const handleDragCancel = useCallback(() => {
    draggingRef.current = null;
    fingerRef.current.active = false;
    stopLoop();
    releasePickSuppression();
    setDrag(null);
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      setEditing(false);
    }, EDIT_IDLE_MS);
  }, [stopLoop, releasePickSuppression, clearIdleTimer]);

  useEffect(() => () => stopLoop(), [stopLoop]);
  useEffect(
    () => () => {
      if (suppressTimerRef.current) clearTimeout(suppressTimerRef.current);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    },
    []
  );

  // 幽灵跟随：位移量全在 worklet 里写，拖拽期间不触发 React 重渲染
  const ghostStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: moveX.value }, { translateY: moveY.value }, { scale: scale.value }],
  }));

  // 让位算量：被拖的那一枚留在原槽位（内容隐身），其余磁贴平移到"腾出来的空位"。
  // 只在数据层算像素偏移、渲染顺序永远是 items 原序 —— 见 cell 里那段为什么不能重排 DOM 的注释。
  const cells = useMemo(() => {
    const naturals = items.map((_, i) => i);
    const startIndex = drag ? items.findIndex((c) => c.id === drag.id) : -1;
    const moved = drag && startIndex >= 0 ? moveInArray(naturals, startIndex, drag.hover) : naturals;
    const displayOf: number[] = new Array(items.length).fill(0);
    moved.forEach((natural, displayIndex) => {
      displayOf[natural] = displayIndex;
    });
    return items.map((item, natural) => {
      const isDragged = !!drag && drag.id === item.id;
      const display = isDragged ? natural : displayOf[natural];
      return {
        item,
        key: item.id,
        index: natural,
        isDragged,
        hidden: isDragged,
        // 让位（手机主屏幕手感）：其余磁贴滑向「腾出来的空位」，被拖的那一枚留在原槽位隐身。
        // 之前关掉它是因为组卡手势串台导致整卡被拖动；根因修好后由卡片自身承担裁切，不会画到卡外。
        shiftXTarget: ((display % columns) - (natural % columns)) * slotWidth,
        shiftYTarget: (Math.floor(display / columns) - Math.floor(natural / columns)) * slotHeight,
      };
    });
  }, [items, drag, slotWidth, columns, slotHeight]);

  const dragItem = drag ? items.find((c) => c.id === drag.id) : undefined;
  const styles = useMemo(
    () => makeGridStyles(columns, slotHeight, semantic, spacing),
    [columns, slotHeight, semantic, spacing]
  );

  // 短按：刚拖完那一下不算；编辑态只退出不选中；干净态才选中（选择页核心行为）
  const handleCellPress = useCallback(
    (id: string) => {
      if (suppressPickRef.current) return;
      if (editingRef.current) {
        exitEditing();
        return;
      }
      onPick?.(id);
    },
    [exitEditing, onPick]
  );

  return (
    <View
      ref={gridRef}
      onLayout={(e) => {
        setGridW(e.nativeEvent.layout.width);
        syncRect();
      }}
    >
      {/* 点空白区域退出编辑态（磁贴自己的短按由 handleCellPress 处理，冒泡到这里时 editing 已经关掉） */}
      <Pressable
        style={[styles.groupGrid, style]}
        onPress={() => {
          if (editingRef.current) exitEditing();
        }}
      >
      {cells.map((c) => (
        <CategoryGridCell
          key={c.key}
          item={c.item}
          index={c.index}
          hidden={c.hidden}
          jiggling={editing && !c.isDragged}
          reduceMotion={reduceMotion}
          editing={editing}
          onDraggingChange={onDraggingChange}
          shiftXTarget={c.shiftXTarget}
          shiftYTarget={c.shiftYTarget}
          draggable={draggable}
          styles={styles}
          semantic={semantic}
          onDelete={onDelete}
          onCellPress={handleCellPress}
          drag={dragShared}
          geometry={geometryShared}
          scrollY={scrollY}
          onDragStart={handleDragStart}
          onDragHover={handleDragHover}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        />
      ))}
      {/* 网格最后一项：虚线「＋」磁贴 = 新增入口（复用调用方的组内新增 handler）。
          它自带虚线边框——那是入口，不属于编辑态，平时常显 */}
      {onToggleAdd && (
        <View style={styles.gridSlot}>
          <PressableScale
            style={styles.gridAddTile}
            activeScale={0.92}
            onPress={onToggleAdd}
            accessibilityRole="button"
            accessibilityLabel={t('common.add')}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          >
            <Ionicons name={isAdding ? 'remove' : 'add'} size={26} color={semantic.accentText} />
          </PressableScale>
          <AppText variant="caption2" numberOfLines={1} color={semantic.accentText} style={styles.gridAddLabel}>
            {isAdding ? t('addTx.headerCollapse') : t('addTx.headerAdd')}
          </AppText>
        </View>
      )}
      {/* 被拖起的那一枚：跟手 + 1.06 放大 + 投影（落点槽位上原件内容已隐藏，只剩虚线框） */}
      {drag && dragItem && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.gridGhost,
            {
              width: slotWidth > 0 ? slotWidth : undefined,
              height: slotHeight,
              backgroundColor: glass.fill,
              boxShadow: glass.shadow,
            },
            ghostStyle,
          ]}
        >
          <GridTileFace item={dragItem} styles={styles} semantic={semantic} reveal={reveal} editing={false} />
        </Animated.View>
      )}
      </Pressable>
    </View>
  );
}

function makeGridStyles(columns: number, slotHeight: number, semantic: SemanticColors, spacing: Spacing) {
  const slotPct = 100 / columns + '%';
  return StyleSheet.create({
    // userSelect none：长按拖动时不要顺手把页面文字选中（web）
    groupGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.xs,
      userSelect: 'none',
    },
    // 一个磁贴槽位：columns 列等分 + 固定高度（拖拽要按像素算槽位，不能靠内容撑高）
    gridSlot: {
      width: slotPct as unknown as ViewStyle['width'],
      height: slotHeight,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 6,
    },
    // 内容层（让位/抖动只作用在这一层；父槽位在 DOM 里不动）
    gridContent: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' },
    // 长按可拖的命中区（铺满内容层，图标/标签在里面居中）
    gridHit: {
      flex: 1,
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      // Web 上必须关掉浏览器的原生手势：否则拖动图标会被浏览器当成页面滚动，
      // 整张组卡跟着手指走（RN 侧手势也在跑，只是浏览器先滚了）
      ...(Platform.OS === 'web' ? ({ touchAction: 'none' } as unknown as ViewStyle) : null),
    },
    // 包住图标+文字的可点区域（覆盖整格宽度，方便点按）
    gridSelectWrap: { alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' },
    gridFace: { alignItems: 'center', justifyContent: 'center' },
    // 拖走时原槽位只剩虚线框（内容整体隐身，保留占位与布局）
    gridHidden: { opacity: 0 },
    gridIconRow: { flexDirection: 'row', alignItems: 'flex-start' },
    gridDeleteBadge: { marginLeft: -12, marginTop: -2 },
    gridLabel: { marginTop: 5, textAlign: 'center' },
    // 网格最后一项：虚线 ＋ 磁贴（新增入口）——accentSoft 底 / accentText 图标 / accent 虚线边
    gridAddTile: {
      width: 52,
      height: 52,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: semantic.accent + '73',
      backgroundColor: semantic.accentSoft,
    },
    gridAddLabel: { marginTop: 5, textAlign: 'center' },
    // 被拖起的磁贴：绝对定位在网格内容坐标系里，跟手 + 投影（left/top 与网格内边距对齐）
    gridGhost: {
      position: 'absolute',
      left: spacing.sm,
      top: spacing.xs,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 22,
      zIndex: 20,
    },
  });
}

export default CategoryGridEditor;
