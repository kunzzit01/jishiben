// CategoryPage.tsx
// 「类别分类 / 选择类别」共享整页 —— 由 src/screens/CategoryManagementScreen.tsx 整页搬入并参数化。
// 两个入口：财务规划计划表单 → 独立路由「类别分类」(selectMode)；记一笔 → step === 'category'（不带支出/收入切换栏）。
// 视觉基准：UI V2.1 玻璃（HeroGradient 铺底 + GlassView radius=26 组卡 + 玻璃返回圆钮）。
// 组内磁贴网格仍是 ../CategoryGridEditor（两页共用一套手势）；本文件负责分节 / 组拖拽 / 内联新增 / 图标弹层。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Keyboard,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  Modal,
  PanResponder,
  Platform,
  useWindowDimensions,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewStyle } from 'react-native';

/**
 * 玻璃材质（UI V2.1 §2）在 web 上的偏差修正：expo-blur 的 web 实现用「tint 底色」模拟模糊——
 * tint default + intensity 100 → 叠一层 rgba(255,255,255,.30) 的白，夜间玻璃被洗成中紫，
 * 规范里的 text.secondary / income / danger 全部跌破 §4 硬指标（实测 2.7–4.2）。
 * 这里把 web 强度降到 8（白底 2.4%，模糊 1.6px ≈ 不可见），玻璃回到稿里的 rgba(14,10,30,.46) 实色；
 * iOS 仍用 GlassView 默认 100（真材质），Android 本来就没有模糊。
 */
const WEB_GLASS_INTENSITY = Platform.OS === 'web' ? 8 : undefined;
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { useApp } from '../../context/AppContext';
import { useDialog } from '../AppDialog';
import { useTheme } from '../../theme/useTheme';
import { useLayout } from '../../theme/useLayout';
import { useTabClearance } from '../../hooks/useTabClearance';
import { useTabBarScrollHandler } from '../../context/TabBarAutoHideContext';
import { EXPENSE_CATEGORY_GROUPS, INCOME_CATEGORY_GROUPS } from '../../utils/defaultCategories';
import { Spacing } from '../../theme/theme';
import { Category } from '../../types';
import { useT } from '../../i18n/LanguageContext';
import { getCategoryLabel, getGroupLabel } from '../../i18n/categories';
import { hapticLight, hapticSelection, hapticSuccess, hapticWarning } from '../../utils/haptics';
import PressableScale from '../PressableScale';
import SegmentedControl from '../SegmentedControl';
import { AppText, GlassView, HeroGradient, IconCircle, ScreenHeader } from '../ui';
// 图标/颜色池抽到公共常量（选择类别页的内联添加也用同一份，防两处漂移）
import { CATEGORY_ICON_OPTIONS, CATEGORY_COLOR_OPTIONS, CategoryIconName } from '../../constants/categoryAddOptions';
// 网格编辑器（虚线占位框 / 长按 200ms 拖拽 / 虚线＋新增磁贴 / 删除角标）与记一笔选择类别页共用一套
import {
  CategoryGridEditor,
  GRID_EDGE_ZONE,
  GRID_FINGER_STEP,
  GRID_LAND_MS,
  GRID_SCROLL_STEP,
  GRID_SLOT_H,
  moveInArray,
  sortByOrder,
} from '../CategoryGridEditor';

const ICON_OPTIONS: CategoryIconName[] = CATEGORY_ICON_OPTIONS;
const COLOR_OPTIONS = CATEGORY_COLOR_OPTIONS;
const CAT_ORDER_KEY = '@jizhang/categoryOrder';
const GROUP_ORDER_KEY = '@jizhang/categoryGroupOrder';

type CategorySection = { group: string; items: Category[]; custom?: boolean };

/** UI V2.1 玻璃二级页头：ScreenHeader 的返回键是透明 44 触控区，这里在它底下垫一枚 44 玻璃圆钮（稿） */
function GlassBackHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  const { spacing } = useTheme();
  const { pagePadding } = useLayout();
  return (
    <View>
      <View pointerEvents="none" style={[glassHeaderStyles.glass, { left: pagePadding, top: spacing.sm }]}>
        <GlassView intensity={WEB_GLASS_INTENSITY} radius={999} style={glassHeaderStyles.glassInner} />
      </View>
      <ScreenHeader variant="compact" title={title} onBack={onBack} right={right} />
    </View>
  );
}

/** 玻璃页头里那枚 44 圆钮的纯几何（与 ScreenHeader 左侧槽位对齐；颜色/材质在 GlassView 内） */
const glassHeaderStyles = StyleSheet.create({
  glass: { position: 'absolute', width: 44, height: 44 },
  glassInner: { width: 44, height: 44 },
});

// ---------- 大分组拖拽（与新网格同一套手势语言：长按 200ms + 幽灵跟手 + 让位动画） ----------
/** 一张组卡在列表坐标系里的顶/底（onLayout 上报，顶边用来算槽位、底边用来算中线阈值） */
type GroupBox = { top: number; bottom: number };

type GroupDragShared = {
  moveY: SharedValue<number>;
  scale: SharedValue<number>;
  from: SharedValue<number>;
  /** 上一次报告给 JS 的落点下标（只在变化时报） */
  cur: SharedValue<number>;
  baseY: SharedValue<number>;
  transY: SharedValue<number>;
  count: SharedValue<number>;
  tops: SharedValue<number[]>;
  ends: SharedValue<number[]>;
  /** 列表顶边在窗口里的位置（拖拽开始那一刻的量测） */
  listTop: SharedValue<number>;
  scroll0: SharedValue<number>;
  lastY: SharedValue<number>;
};

/**
 * 手指位置 → 落点分组下标：按每张卡的中线判定（越过中线才让位），
 * worklet 与 JS 自动滚动共用同一份算式。
 */
function groupIndexAt(
  y: number,
  listTop: number,
  scrollDelta: number,
  tops: number[],
  ends: number[],
  count: number
): number {
  'worklet';
  if (count <= 0 || tops.length < count) return 0;
  const local = y - (listTop - scrollDelta);
  let idx = 0;
  for (let i = 0; i < count; i++) {
    if (local >= tops[i] + (ends[i] - tops[i]) / 2) idx = i + 1;
  }
  return Math.min(count - 1, idx);
}

/**
 * 一格「槽位跨度」：整组换位时，中间那些卡要挪动的量 = 被拖卡自身高度 + 卡间距。
 * 等价于相邻两卡 top 之差（无论 onLayout 报的高度是否已含 marginBottom，这个差都成立），
 * 所以优先量下一对；被拖卡在最后一张时改用上一对的间距换算自身跨度。
 */
function groupSlotSpan(index: number, count: number, boxAt: (i: number) => GroupBox): number {
  const heightOf = (i: number) => Math.max(0, boxAt(i).bottom - boxAt(i).top);
  if (index + 1 < count) {
    const pitch = boxAt(index + 1).top - boxAt(index).top;
    if (pitch > 0) return pitch;
  }
  if (index > 0) {
    const prevPitch = boxAt(index).top - boxAt(index - 1).top;
    if (prevPitch > 0) return Math.max(0, heightOf(index) + prevPitch - heightOf(index - 1));
  }
  return heightOf(index);
}

/**
 * 幽灵落点 = 让位后留给被拖卡的那块空位的顶边（必须和 groupShifts 画出来的空位一致，
 * 否则幽灵会飞进让位后的某张卡身上）。两种情形都等于提交后这张卡的最终 top：
 * · 往下拖（to > from）：中间卡整段上移一格跨度，空位落在这一段**下方**
 *   → tops[to] + h_to - h_from（= 让位后目标卡的底边 + 间距）；
 * · 往上拖 / 原位：空位就在目标卡原来的位置上 → tops[to]。
 */
function groupLandTop(from: number, to: number, tops: number[], ends: number[]): number {
  const top = tops[to] ?? 0;
  if (to <= from) return top;
  const fromH = Math.max(0, (ends[from] ?? 0) - (tops[from] ?? 0));
  const toH = Math.max(0, (ends[to] ?? 0) - top);
  return top + toH - fromH;
}

const GROUP_DRAG_SCALE = 1.03;
/**
 * web 专用：把手行上必须让浏览器**别**接管滚动。
 * responder 被我们拿到也拦不住浏览器的原生滚动（实测：按下即向上拖 220px 时页面自己滚了 205px，
 * 手指相对内容只挪了 15px → 落点算出来还是原槽位，顺序不动）；而 GestureDetector 当初正是靠
 * 自己那层 `touch-action:none` 才没滚动，代价却是内层 Pressable 抢先。这里把 touch-action
 * 放回把手行本身，滚动与手势就不再互相打岔。native 不认识这个样式键，传 undefined。
 */
const GROUP_DRAG_HANDLE_WEB_STYLE: ViewStyle | undefined =
  Platform.OS === 'web' ? ({ touchAction: 'none' } as unknown as ViewStyle) : undefined;
/** 长按多久之后纵向移动就算拖整组（闸门：没满这个时长、位移也不大的按下一律当点按） */
const GROUP_DRAG_HOLD_MS = 250;
/** 长按闸门开启后，纵向位移超过多少就抬起整组 */
const GROUP_DRAG_START_DIST = 6;
/** 没停够长按时长，但纵向已经拖这么远——只能是拖拽，不会被当成点按 */
const GROUP_DRAG_FAST_DIST = 12;
/**
 * 拖拽收尾后屏蔽组头点击的时长：web 上 mouseup 会补一个 click（实测 click@组头），
 * 不挡就会「一松手整组自己折叠 / 手指停在垃圾桶上顺手把整组删了」。
 */
const GROUP_TAP_BLOCK_MS = 500;

/**
 * 一张大组卡的外壳：让位平移量包在外面，拖动挂在组头那一行上
 * （组名 / 项数 / 垃圾桶都在组头里，短按照旧、纵向拖动才抬起整组）。
 */
function GroupCardSlot({
  group,
  dimmed,
  shiftYTarget,
  header,
  children,
  drag,
  scrollY,
  styles,
  onCardLayout,
  onDragStart,
  onDragHover,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  group: string;
  dimmed: boolean;
  shiftYTarget: number;
  header: React.ReactNode;
  children: React.ReactNode;
  drag: GroupDragShared;
  scrollY: SharedValue<number>;
  styles: ReturnType<typeof makeStyles>;
  onCardLayout: (group: string, top: number, height: number) => void;
  onDragStart: (group: string, absY: number) => void;
  onDragHover: (index: number, absY: number) => void;
  onDragMove: (absY: number) => void;
  onDragEnd: (from: number, to: number) => void;
  onDragCancel: () => void;
}) {
  const { moveY, scale, from, cur, baseY, transY, count, tops, ends, listTop, scroll0, lastY } = drag;
  const { semantic } = useTheme();
  /** 把手：贴在组头右侧、垃圾桶左边（垃圾桶占右内衬 16 + 18 图标） */
  const dragHandleStyle: ViewStyle = {
    position: 'absolute',
    top: 4,
    right: 40,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    ...(Platform.OS === 'web' ? ({ touchAction: 'none' } as unknown as ViewStyle) : null),
  };


  const shiftY = useSharedValue(0);
  useEffect(() => {
    shiftY.value = withTiming(shiftYTarget, { duration: 180 });
  }, [shiftYTarget, shiftY]);
  const shiftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: shiftY.value }] }));

  // 拖拽手势只在挂载时建一次（拖拽中重渲染不打断），回调经 ref 取最新闭包
  const cbs = useRef({ onDragStart, onDragHover, onDragMove, onDragEnd, onDragCancel });
  cbs.current = { onDragStart, onDragHover, onDragMove, onDragEnd, onDragCancel };
  /** 本次按下的时刻：长按闸门用它区分「点按」与「长按后拖动」 */
  const pressAtRef = useRef(0);

  /**
   * 组头（= 整卡把手行；收起态整张卡就是这一行）拖拽用 RN 自带 PanResponder，
   * 并且走 **capture 阶段 + 长按闸门**，而不是 RNGH：
   *
   * 1) 为什么 RNGH 在这条组头上不可能好用：
   *    · GestureDetector 在 web 上把 pointerdown/pointermove 直接挂在自己生成的包装 DOM 上
   *      （react-native-gesture-handler/src/web/tools/PointerEventManager.ts:175/193
   *       `this.view.addEventListener('pointermove', ...)`），它完全不参与 React 的 responder 协商；
   *    · 组头里那层 Pressable 在按下那一刻就自封为 RNW 的 responder
   *      （react-native-web/dist/cjs/modules/usePressEvents/PressResponder.js:228
   *       `onStartShouldSetResponder: … return !disabled` → true），这条指针序列的语义归
   *      responder 系统所有，DOM 层那套 RNGH 监听拿不到可用的拖拽序列 →「按住一拖」什么都不发生。
   *    · 顺带纠正上一轮的猜测：`.activeOffsetY([a,b])` 在 RNGH 里**确实**会被拆成
   *      activeOffsetYStart/End（src/handlers/gestures/panGesture.ts:49-58），阈值写法不是根因。
   *
   * 2) 为什么 capture 而不是 bubble：RNW 的 ResponderSystem 在 move 时按 LCA 剪枝后从根往叶子
   *    问 capture、再从叶子往根问 bubble（ResponderSystem.js:394-446）。内层 Pressable 已经是
   *    responder，capture 先问祖先，我们在这里返回 true 就直接发起移交，再由 Pressable 的
   *    onResponderTerminationRequest（cancelable ?? true）让位——它抢不走纵向拖拽。
   *
   * 3) 长按闸门：按下只记录时刻、返回 false（点按照旧落到组头自己的 onPress：折叠/展开、垃圾桶）；
   *    长按满 GROUP_DRAG_HOLD_MS 之后再纵向移动 → 接管；没停够就果断纵向拖过
   *    GROUP_DRAG_FAST_DIST 也接管（够大就不可能是点按），两条路都不会吞掉短按。
   */
  const panResponder = useMemo(() => {
    /** 落位：幽灵滑到目标槽位顶边，再交差写回顺序（释放与中断共用同一套几何） */
    const land = (fingerY: number) => {
      const idx = groupIndexAt(
        fingerY,
        listTop.value,
        scrollY.value - scroll0.value,
        tops.value,
        ends.value,
        count.value
      );
      const landY =
        tops.value[idx] == null ? baseY.value : groupLandTop(from.value, idx, tops.value, ends.value);
      moveY.value = withTiming(landY, { duration: 150 });
      scale.value = withTiming(1, { duration: 150 });
      cbs.current.onDragEnd(from.value, idx);
    };
    return PanResponder.create({
      // 用户定版：拖拽只从**显式把手**（组头右侧那枚 ≡）发起。
      // 把手是一个没有任何子节点的普通 View —— 它和组头里那些 Pressable 不在一条竞争链上，
      // 所以按下即接管，不需要 capture、不需要长按闸门，也就不存在「被内层控件吃掉」这回事。
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponderCapture: () => false,
      // 拖动中不许别人（内层 Pressable / 页面滚动）抢走
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_e, g) => {
        scroll0.value = scrollY.value;
        transY.value = 0;
        lastY.value = g.y0;
        scale.value = withTiming(GROUP_DRAG_SCALE, { duration: 130 });
        cbs.current.onDragStart(group, g.y0);
      },
      onPanResponderMove: (_e, g) => {
        moveY.value = baseY.value + g.dy + (scrollY.value - scroll0.value);
        transY.value = g.dy;
        // g.moveY = 手指在窗口里的绝对纵坐标（与旧实现的 absoluteY 同义）
        const fingerY = g.moveY;
        const idx = groupIndexAt(
          fingerY,
          listTop.value,
          scrollY.value - scroll0.value,
          tops.value,
          ends.value,
          count.value
        );
        if (idx !== cur.value) {
          cur.value = idx;
          cbs.current.onDragHover(idx, fingerY);
        }
        if (Math.abs(fingerY - lastY.value) > GRID_FINGER_STEP) {
          lastY.value = fingerY;
          cbs.current.onDragMove(fingerY);
        }
      },
      onPanResponderRelease: (_e, g) => land(g.moveY),
      onPanResponderTerminate: () => {
        scale.value = withTiming(1, { duration: 120 });
        cbs.current.onDragCancel();
      },
    });
  }, []);


  return (
    <Animated.View
      /* 让位动画只由组拖拽驱动（shiftY 在 groupDrag 为空时恒为 0）；
         拖图标期间 groupDrag 恒为 null，所以组卡不会位移 */
      style={[shiftStyle, dimmed && styles.groupDragging]}
      onLayout={(e) => onCardLayout(group, e.nativeEvent.layout.y, e.nativeEvent.layout.height)}
    >
      <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={styles.groupCard}>
        {header}
        {children}
      </GlassView>
    </Animated.View>
  );
}
/** 共享页的对外契约（两个入口只传这些，内部状态全在组件里） */
export type CategoryPageProps = {
  /** true = 选择类别（财务规划计划表单 / 记一笔选类别步骤）：点磁贴回传 onPickCategory 再 onBack */
  selectMode?: boolean;
  /** 返回：玻璃返回圆钮与返回手势都走它（导航栈由调用方持有） */
  onBack: () => void;
  /** 选中分类回传（仅 selectMode 生效） */
  onPickCategory?: (id: string) => void;
  /** 首屏落在哪个类型（记一笔按当前类型进来） */
  initialType?: 'expense' | 'income';
  /** 网格列数（两页统一 3 列） */
  columns?: number;
  /** 每次排序落库后回调：类目编号 + 大组名的有序列表（供记一笔同步快捷格顺序） */
  onOrderChange?: (order: { categoryOrder: Record<string, number>; groupOrder: string[] }) => void;
  /** 是否显示 PERF 调试白字（首帧 / 满载 / 渲染次数 / 帧间隔）。默认关：只在定位卡顿时临时打开 */
  showPerf?: boolean;
};

export default function CategoryPage({
  selectMode = false,
  onBack,
  onPickCategory,
  initialType,
  columns = 3,
  onOrderChange,
  showPerf = false,
}: CategoryPageProps) {
  const { categories, categoryGroups, addCategory, addCategoryGroup, updateCategory, deleteCategory, deleteCategoryGroup } = useApp();
  const { semantic, spacing, gradients, glass, isDark } = useTheme();
  const { pagePadding } = useLayout();
  // 玻璃卡上的次要字色（§4 硬指标）：夜间玻璃被 web BlurView 洗亮，70% 白的 text.secondary 只有 ~4.2
  const t = useT();
  const dialog = useDialog(); // 主题化弹窗（替代系统 Alert）
  const tabClearance = useTabClearance();
  const onTabScroll = useTabBarScrollHandler();
  // 外层 ScrollView：贴边自动滚动要它 + 当前滚动量 / 内容高度
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollYSV = useSharedValue(0);
  const contentHRef = useRef(0);
  const { height: windowH } = useWindowDimensions();

  /* —— 内联新增小卡的聚焦滚动（原在记一笔，两处入口共用一套） ——
   * 系统键盘弹起会盖住小卡输入框。Fabric 下 measureLayout 要求原生 ref，这里改用
   * 「布局表」：卡片是列表容器的直接子节点，onLayout 的 y 就是内容坐标（零测量歧义），
   * 聚焦时按组名查表 → 滚到「组卡 y + 小卡在组卡内的偏移」正好露在键盘上方。 */
  const groupContentYRef = useRef<Record<string, number>>({});
  const inlineCardOffsetRef = useRef<Record<string, number>>({});
  /** 正在编辑内联小卡的组名：键盘弹起（keyboardDidShow）时按真实高度补滚一次 */
  const inlineFocusGroupRef = useRef<string | null>(null);
  const keyboardHeightRef = useRef(0);
  /** 列表容器在滚动内容里的 y（卡片 y 相对它，滚动量要的是内容坐标） */
  const listContentYRef = useRef(0);
  const scrollInlineInputIntoView = useCallback((groupName: string, keyboardH?: number) => {
    requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const cardY = groupContentYRef.current[groupName];
      if (cardY === undefined) return;
      const inlineY = inlineCardOffsetRef.current[groupName] ?? 0;
      // 留白 = 键盘高度的一半再减 60：键盘矮时输入框大致落在视口中部，键盘高时相应多滚。
      // keyboardH 不传按当前 ref（autoFocus 时键盘还没弹，高度为 0，先滚一版）
      const kb = keyboardH ?? keyboardHeightRef.current;
      scroll.scrollTo({
        y: Math.max(0, listContentYRef.current + cardY + inlineY - Math.max(60, kb / 2)),
        animated: true,
      });
    });
  }, []);
  // autoFocus 发生在键盘高度已知之前：先按 0 滚一版，键盘弹起后按真实高度校正
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      keyboardHeightRef.current = e?.endCoordinates?.height ?? 0;
      if (inlineFocusGroupRef.current) {
        scrollInlineInputIntoView(inlineFocusGroupRef.current, keyboardHeightRef.current);
      }
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardHeightRef.current = 0;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollInlineInputIntoView]);

  // —— 大分组拖拽状态（长按组头整组移动，落库仍走 GROUP_ORDER_KEY，不新造存储键） ——
  const [groupDrag, setGroupDrag] = useState<{ group: string; from: number; hover: number } | null>(null);
  // 图标拖拽进行中：锁住外层滚动，组卡必须定住（用户定版）
  const [gridDragging, setGridDragging] = useState(false);
  // ref 版本：组把手的 PanResponder 在缓存里持有闭包，读 state 会读到旧值
  const gridDraggingRef = useRef(false);
  const handleGridDragging = useCallback((v: boolean) => {
    gridDraggingRef.current = v;
    setGridDragging(v);
  }, []);
  const listRef = useRef<View | null>(null);
  const groupBoxRef = useRef<Map<string, GroupBox>>(new Map());
  const sectionsRef = useRef<CategorySection[]>([]);
  const groupDragRef = useRef<string | null>(null);
  /** 到这个时刻之前，组头上的点击一律忽略（拖拽抬起后浏览器补的那一下 click） */
  const groupTapBlockUntilRef = useRef(0);
  const groupFingerYRef = useRef(-1);
  const groupLoopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const groupTickRef = useRef<() => void>(() => {});
  const gMoveY = useSharedValue(0);
  const gScale = useSharedValue(1);
  const gFrom = useSharedValue(0);
  const gCur = useSharedValue(0);
  const gBaseY = useSharedValue(0);
  const gTransY = useSharedValue(0);
  const gCount = useSharedValue(0);
  const gTops = useSharedValue<number[]>([]);
  const gEnds = useSharedValue<number[]>([]);
  const gListTop = useSharedValue(0);
  const gScroll0 = useSharedValue(0);
  const gLastY = useSharedValue(0);
  const groupDragShared: GroupDragShared = useMemo(
    () => ({
      moveY: gMoveY,
      scale: gScale,
      from: gFrom,
      cur: gCur,
      baseY: gBaseY,
      transY: gTransY,
      count: gCount,
      tops: gTops,
      ends: gEnds,
      listTop: gListTop,
      scroll0: gScroll0,
      lastY: gLastY,
    }),
    [gMoveY, gScale, gFrom, gCur, gBaseY, gTransY, gCount, gTops, gEnds, gListTop, gScroll0, gLastY]
  );
  // 页面滚动：既要喂浮空 Tab 栏的收起逻辑，也要记下滚动量（网格拖拽把绝对坐标换算成内容坐标用）
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollYSV.value = e.nativeEvent.contentOffset.y;
      onTabScroll?.(e);
    },
    [onTabScroll, scrollYSV]
  );
  // 样式表记忆化：转场期间 blur/focus 重渲染不再重建 60+ 条样式
  const styles = useMemo(() => makeStyles(semantic, spacing), [semantic, spacing]);
  // 选择模式（props）：财务规划的计划表单 / 记一笔选类别步骤进来时 selectMode=true——此时点磁贴是
  // 「选中并返回」（onPickCategory 回传 id，再 onBack 弹栈）。权限取并集：selectMode 下图标与组卡
  // 照常可拖、类别可删（仍走二次确认）、可增，不再降级成只读选择器。
  // 顶部支出/收入切换：只显示并编辑对应类型的大组；跳转方可带 initialType 直接落到对应类型
  /* 分组卡里的可拖拽网格很重：每个实例 14 个动画值 + 手势识别 + 定时器，40 多个渐变球。
   * 一次性挂 10 多组会让首帧被堵住（用户 2026-10-30：点进管理类别要等 1~3 秒）。
   * 做法：首帧只挂前 2 组，其余按帧补齐（每 60ms 加 3 组），占位高度按行数精确预留 → 不跳版。 */
  const [manageType, setManageType] = useState<'expense' | 'income'>(
    initialType === 'income' ? 'income' : 'expense'
  );
  /* ⚠️ 临时性能计时（2026-10-30，定位安卓管理类别卡顿）：定位完成即删。
   * 在真机上取三个数：首帧耗时 / 全部组挂满耗时 / 渲染次数，
   * 用来区分「JS 渲染慢」还是「绘制慢」，不再靠猜。 */
  const perfT0Ref = useRef(Date.now());
  const perfRendersRef = useRef(0);
  perfRendersRef.current += 1;
  const [perf, setPerf] = useState<{ first: number; full: number | null; renders: number } | null>(null);
  const [frameStats, setFrameStats] = useState<{ avg: number; max: number } | null>(null);

  const [mountedSections, setMountedSections] = useState(2);
  // 切「支出 / 收入」→ 重新从 2 组开始挂
  useEffect(() => {
    setMountedSections(2);
  }, [manageType]);
  // 组内排序编号（按分类 id 存，跟资产页 assetOrder 同一套思路）
  const [catOrder, setCatOrder] = useState<Record<string, number>>({});
  // 大分组排列顺序（按组名存）
  const [groupOrder, setGroupOrder] = useState<Record<string, number>>({});
  // 每张大组卡片自带内联添加：正在添加的组名 + 输入的名称 + 选择的图标/颜色
  const [addingGroupName, setAddingGroupName] = useState<string | null>(null);
  const [inlineName, setInlineName] = useState('');
  const [inlineIcon, setInlineIcon] = useState<CategoryIconName>(ICON_OPTIONS[0]);
  const [inlineColor, setInlineColor] = useState(COLOR_OPTIONS[0]);
  // 新增大分类（底部）
  const [newGroupFormOpen, setNewGroupFormOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  // TASK-020③（selectMode 照搬记一笔整套交互）：折叠的组名集合（默认全展开，点头部行收/展）
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // 两步小卡第二步：119 图标选择底部弹层开关
  const [iconPickerOpen, setIconPickerOpen] = useState(false);

  // 载入组内排序编号 + 大分组排列顺序
  useEffect(() => {
    // 两个键一起读、一次提交：分两次 setState 会触发两轮重渲，而每轮都会重算 sections
    // → 10 个网格的 items 引用全变 → memo 失效（安卓进页面卡顿的一半原因）。
    Promise.all([AsyncStorage.getItem(CAT_ORDER_KEY), AsyncStorage.getItem(GROUP_ORDER_KEY)])
      .then(([rawCat, rawGroup]) => {
        if (rawCat) setCatOrder(JSON.parse(rawCat) as Record<string, number>);
        if (rawGroup) setGroupOrder(JSON.parse(rawGroup) as Record<string, number>);
      })
      .catch(() => {});
  }, []);

  // 排序回调 / 当前组内编号：组把手 responder 与「落位后改顺序」的定时器都是缓存闭包，
  // 直接读 state 会读到首次渲染的空表，这两个 ref 永远指向最新值
  const onOrderChangeRef = useRef(onOrderChange);
  onOrderChangeRef.current = onOrderChange;
  const catOrderRef = useRef(catOrder);
  catOrderRef.current = catOrder;

  const persistCatOrder = (next: Record<string, number>) => {
    setCatOrder(next);
    AsyncStorage.setItem(CAT_ORDER_KEY, JSON.stringify(next)).catch(() => {});
    // 落库之后再回调：调用方（记一笔）按同一份编号重排它的快捷格
    onOrderChangeRef.current?.({
      categoryOrder: next,
      groupOrder: sectionsRef.current.map((s) => s.group),
    });
  };

  // 大分组本身拖拽结束：按新顺序把 0..n-1 写回每个大分组的编号（沿用旧的存储键）
  const persistGroupOrder = (next: Record<string, number>) => {
    setGroupOrder(next);
    AsyncStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(next)).catch(() => {});
    // 组名按新编号升序给出（没编号的殿后），组内编号取最新值
    onOrderChangeRef.current?.({
      categoryOrder: catOrderRef.current,
      groupOrder: Object.keys(next).sort((a, b) => (next[a] ?? 9999) - (next[b] ?? 9999)),
    });
  };

  // 某个大组内拖拽结束：按新顺序把 0..n-1 写回该组这些分类的编号
  const handleCatGroupReorder = (groupName: string, groupItems: { id: string }[]) => {
    const next = { ...catOrder };
    groupItems.forEach((item, index) => {
      next[item.id] = index;
    });
    persistCatOrder(next);
    hapticSelection();
  };

  // 组列表：默认5组 + 自定义组（空组也显示，方便直接往里加），组内按排序编号排列
  const sections = useMemo(() => {
    const pool = categories.filter((c) => c.type === manageType);
    const isExpense = manageType === 'expense';
    const defaultGroups: string[] = isExpense ? [...EXPENSE_CATEGORY_GROUPS] : [...INCOME_CATEGORY_GROUPS];
    const customGroups = categoryGroups.filter((g) => g.type === manageType);
    const known = [...defaultGroups, ...customGroups.map((g) => g.name)];
    const out: CategorySection[] = defaultGroups.map((group) => ({
      group,
      items: sortByOrder(
        pool.filter((c) => c.group === group),
        catOrder
      ),
    }));
    customGroups.forEach((cg) => {
      out.push({
        group: cg.name,
        items: sortByOrder(
          pool.filter((c) => c.group === cg.name),
          catOrder
        ),
        custom: true,
      });
    });
    const rest = pool.filter((c) => !known.includes(c.group as any));
    if (rest.length) out.push({ group: isExpense ? t('group.other') : t('cat.other_income'), items: sortByOrder(rest, catOrder) });

    // 大分组按持久化的排列顺序排（没编号的排最后，保持原有相对顺序）
    return out.sort((a, b) => (groupOrder[a.group] ?? 9999) - (groupOrder[b.group] ?? 9999));
  }, [categories, categoryGroups, catOrder, groupOrder, manageType]);
  // 手势回调是稳定闭包，读"当前渲染顺序"走 ref
  sectionsRef.current = sections;

  /* 帧间隔采样：进页面后连采 70 帧，报平均 / 最差。
   * 绘制卡顿会直接体现为 rAF 回调被推迟 —— 这是真机上能量化「绘制到底慢不慢」的信号。 */
  useEffect(() => {
    let last = Date.now();
    const deltas: number[] = [];
    let raf = 0;
    const loop = () => {
      const now = Date.now();
      deltas.push(now - last);
      last = now;
      if (deltas.length < 70) {
        raf = requestAnimationFrame(loop);
      } else {
        const avg = Math.round(deltas.reduce((s, v) => s + v, 0) / deltas.length);
        let max = 0;
        for (const d of deltas) if (d > max) max = d;
        setFrameStats({ avg, max: Math.round(max) });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 首帧耗时：mount → 第二帧（第一帧真正画出来的时刻）
  useEffect(() => {
    const t0 = perfT0Ref.current;
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPerf((prev) => ({
          first: Date.now() - t0,
          full: prev ? prev.full : null,
          renders: perfRendersRef.current,
        }));
      });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // 全部分组挂满的时刻
  useEffect(() => {
    if (mountedSections < sections.length) return;
    const full = Date.now() - perfT0Ref.current;
    setPerf((prev) => (prev ? { ...prev, full, renders: perfRendersRef.current } : prev));
  }, [mountedSections, sections.length]);

  // 分批把分组卡里的可拖拽网格挂上（每 60ms 补 3 组），首帧就不会被 10 多组一起堵住
  useEffect(() => {
    const total = sections.length;
    if (mountedSections >= total) return;
    const id = setTimeout(() => setMountedSections((n) => Math.min(n + 3, total)), 60);
    return () => clearTimeout(id);
  }, [mountedSections, sections.length]);

  // —— 大分组拖拽：JS 侧控制器（量测、落点、自动滚动、落库） ——
  const readGroupBoxes = useCallback(() => {
    const list = sectionsRef.current;
    return {
      tops: list.map((s) => groupBoxRef.current.get(s.group)?.top ?? 0),
      ends: list.map((s) => {
        const box = groupBoxRef.current.get(s.group);
        return box ? box.bottom : 0;
      }),
    };
  }, []);

  const handleGroupCardLayout = useCallback(
    (group: string, top: number, height: number) => {
      groupBoxRef.current.set(group, { top, bottom: top + height });
      // 聚焦滚动：卡片 layout.y 相对列表容器，滚动时再由 listContentYRef 补上容器偏移
      groupContentYRef.current[group] = top;
      const boxes = readGroupBoxes();
      gTops.value = boxes.tops;
      gEnds.value = boxes.ends;
    },
    [gEnds, gTops, readGroupBoxes]
  );

  const stopGroupLoop = useCallback(() => {
    if (groupLoopRef.current != null) {
      clearInterval(groupLoopRef.current);
      groupLoopRef.current = null;
    }
  }, []);

  const startGroupLoop = useCallback(() => {
    if (groupLoopRef.current == null) groupLoopRef.current = setInterval(() => groupTickRef.current(), 16);
  }, []);

  // 贴边自动滚动（与网格同一套阈值/步长）：页面在手指下滚了，幽灵（列表坐标）补回同样的量，落点重算
  groupTickRef.current = () => {
    if (groupDragRef.current == null) {
      stopGroupLoop();
      return;
    }
    const fingerY = groupFingerYRef.current;
    const dir = fingerY > windowH - GRID_EDGE_ZONE ? 1 : fingerY < GRID_EDGE_ZONE ? -1 : 0;
    if (!dir) return;
    const max = Math.max(0, contentHRef.current - windowH);
    const current = scrollYSV.value;
    const next = Math.min(max, Math.max(0, current + dir * GRID_SCROLL_STEP));
    if (next === current) return;
    scrollRef.current?.scrollTo({ y: next, animated: false });
    gMoveY.value = gBaseY.value + gTransY.value + (next - gScroll0.value);
    const idx = groupIndexAt(
      fingerY,
      gListTop.value,
      next - gScroll0.value,
      gTops.value,
      gEnds.value,
      gCount.value
    );
    if (idx !== gCur.value) {
      gCur.value = idx;
      setGroupDrag((prev) => (prev && prev.hover !== idx ? { ...prev, hover: idx } : prev));
    }
  };

  const handleGroupDragStart = useCallback(
    (group: string, absY: number) => {
      const list = sectionsRef.current;
      const from = Math.max(0, list.findIndex((s) => s.group === group));
      const boxes = readGroupBoxes();
      hapticLight();
      groupDragRef.current = group;
      groupTapBlockUntilRef.current = Number.MAX_SAFE_INTEGER;
      groupFingerYRef.current = absY;
      gFrom.value = from;
      gCur.value = from;
      gCount.value = list.length;
      gTops.value = boxes.tops;
      gEnds.value = boxes.ends;
      gBaseY.value = boxes.tops[from] ?? 0;
      gScroll0.value = scrollYSV.value;
      gMoveY.value = gBaseY.value;
      setGroupDrag({ group, from, hover: from });
      listRef.current?.measureInWindow((_x, y) => {
        gListTop.value = y;
      });
      startGroupLoop();
    },
    [gBaseY, gCount, gCur, gEnds, gFrom, gMoveY, gScroll0, gTops, readGroupBoxes, scrollYSV, startGroupLoop]
  );

  const handleGroupDragHover = useCallback((index: number, absY: number) => {
    groupFingerYRef.current = absY;
    setGroupDrag((prev) => (prev && prev.hover !== index ? { ...prev, hover: index } : prev));
  }, []);

  const handleGroupDragMove = useCallback((absY: number) => {
    groupFingerYRef.current = absY;
  }, []);

  const handleGroupDragEnd = useCallback(
    (from: number, to: number) => {
      groupFingerYRef.current = -1;
      groupTapBlockUntilRef.current = Date.now() + GROUP_TAP_BLOCK_MS;
      stopGroupLoop();
      // 等幽灵滑到目标槽位再改顺序 + 卸载幽灵
      setTimeout(() => {
        groupDragRef.current = null;
        setGroupDrag(null);
        if (to !== from) {
          hapticSelection();
          const list = sectionsRef.current;
          const moved = moveInArray(
            list.map((_, i) => i),
            from,
            to
          );
          const next: Record<string, number> = {};
          moved.forEach((natural, order) => {
            next[list[natural].group] = order;
          });
          persistGroupOrder(next);
        }
      }, GRID_LAND_MS);
    },
    [stopGroupLoop]
  );

  const handleGroupDragCancel = useCallback(() => {
    // 普通点按也会走 onFinalize(false)：只有真的抬起过整组才需要挡住随后补的那一下 click，
    // 否则会把组头自己的折叠点击一起吃掉（实测 TILES 5→5）
    groupTapBlockUntilRef.current = groupDragRef.current != null ? Date.now() + GROUP_TAP_BLOCK_MS : 0;
    groupDragRef.current = null;
    groupFingerYRef.current = -1;
    stopGroupLoop();
    setGroupDrag(null);
  }, [stopGroupLoop]);

  useEffect(() => () => stopGroupLoop(), [stopGroupLoop]);

  /**
   * 组序拖拽把手（组头里的 ≡）：
   * 用 RN 的 PanResponder —— 它走 React 的 responder 协商，按下即接管，不依赖 RNGH 的 DOM 监听；
   * 把手是组头里的普通行内子节点（不是绝对定位），既一定可见，也不与标题/垃圾桶抢同一块区域。
   * 每个组缓存一份 responder（拖拽中重渲染不会重建、不会打断手势）。
   */
  const groupPanCache = useRef<Record<string, ReturnType<typeof PanResponder.create>>>({});
  const getGroupPanHandlers = useCallback((group: string) => {
    const cached = groupPanCache.current[group];
    if (cached) return cached.panHandlers;
    const responder = PanResponder.create({
      // 不在一按下就接管：只认「明显的竖直拖动」。
      // 否则这枚把手的 44×44 绝对定位盒会连同其下方的图标一起被吞掉 ——
      // 表现就是拖图标时整张组卡被抬起来（用户实测）。
      // 不在一按下就接管：只认「明显的竖直拖动」，避免与图标的拖拽抢手势
      // 互斥：正在拖图标时，组把手一律不接管手势
      onStartShouldSetPanResponder: () => !gridDraggingRef.current,
      onMoveShouldSetPanResponder: () => !gridDraggingRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_e, g) => {
        gScroll0.value = scrollYSV.value;
        gTransY.value = 0;
        gLastY.value = g.y0;
        gScale.value = withTiming(GROUP_DRAG_SCALE, { duration: 130 });
        handleGroupDragStart(group, g.y0);
      },
      onPanResponderMove: (_e, g) => {
        gMoveY.value = gBaseY.value + g.dy + (scrollYSV.value - gScroll0.value);
        gTransY.value = g.dy;
        const fingerY = g.moveY;
        const idx = groupIndexAt(
          fingerY,
          gListTop.value,
          scrollYSV.value - gScroll0.value,
          gTops.value,
          gEnds.value,
          gCount.value
        );
        if (idx !== gCur.value) {
          gCur.value = idx;
          handleGroupDragHover(idx, fingerY);
        }
        if (Math.abs(fingerY - gLastY.value) > GRID_FINGER_STEP) {
          gLastY.value = fingerY;
          handleGroupDragMove(fingerY);
        }
      },
      onPanResponderRelease: (_e, g) => {
        const idx = groupIndexAt(
          g.moveY,
          gListTop.value,
          scrollYSV.value - gScroll0.value,
          gTops.value,
          gEnds.value,
          gCount.value
        );
        const landY =
          gTops.value[idx] == null ? gBaseY.value : groupLandTop(gFrom.value, idx, gTops.value, gEnds.value);
        gMoveY.value = withTiming(landY, { duration: 150 });
        gScale.value = withTiming(1, { duration: 150 });
        handleGroupDragEnd(gFrom.value, idx);
      },
      onPanResponderTerminate: () => handleGroupDragCancel(),
    });
    groupPanCache.current[group] = responder;
    return responder.panHandlers;
  }, [handleGroupDragStart, handleGroupDragHover, handleGroupDragMove, handleGroupDragEnd, handleGroupDragCancel, scrollYSV,
      gScroll0, gTransY, gLastY, gScale, gMoveY, gBaseY, gListTop, gTops, gEnds, gCount, gCur, gFrom]);

  // 让位算量：被拖整组留在原槽位（变淡），其余组卡按"腾出来的空位"上下平移
  const groupShifts = useMemo(() => {
    const map = new Map<string, number>();
    if (!groupDrag) return map;
    const from = sections.findIndex((s) => s.group === groupDrag.group);
    if (from < 0) return map;
    const last = sections.length - 1;
    const to = Math.max(0, Math.min(last, Math.trunc(groupDrag.hover) || 0));
    if (to === from) return map;
    // 每张卡高度不同（展开的组比收起的组高得多），所以让位量不能用「槽位 top 之差」逐张推，
    // 那样只对等高卡片成立：收起的卡被拖到展开卡中间时腾不出位置（用户实测）。
    // 正确量 = 被拖卡自己那一格的跨度（自身高度 + 卡间距）：整段平移这个量，
    // 正好等于换位完成后的最终位置，空位高度恰好等于被拖卡高度。
    const boxAt = (i: number): GroupBox => groupBoxRef.current.get(sections[i]?.group) ?? { top: 0, bottom: 0 };
    const span = groupSlotSpan(from, sections.length, boxAt);
    sections.forEach((s, i) => {
      if (i === from) {
        map.set(s.group, 0);
        return;
      }
      let delta = 0;
      if (from < to && i > from && i <= to) delta = -span;
      else if (from > to && i >= to && i < from) delta = span;
      map.set(s.group, delta);
    });
    return map;
  }, [sections, groupDrag]);

  const groupGhostStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: gMoveY.value }, { scale: gScale.value }],
  }));

  const ghostSection = groupDrag ? sections.find((s) => s.group === groupDrag.group) : undefined;


  const handleInlineAdd = async (groupName: string) => {
    const name = inlineName.trim();
    if (!name) return;
    // 当前管理页在哪个类型下，添加的就是哪个类型的分类
    await addCategory({ name, icon: inlineIcon, color: inlineColor, type: manageType, group: groupName });
    // TASK-020③：选择模式照搬记一笔——加完静默收起（新分类立即可见可选，不弹窗打断）；
    // 管理模式保留原弹窗反馈
    if (selectMode) {
      hapticSuccess();
      setInlineName('');
      setInlineIcon(ICON_OPTIONS[0]);
      setInlineColor(COLOR_OPTIONS[0]);
      setAddingGroupName(null);
      return;
    }
    // 明确反馈，并收起输入区
    dialog.alert({ title: t('addTx.addSuccess'), message: t('addTx.addedToGroup', { name: groupName }) });
    setInlineName('');
    setInlineIcon(ICON_OPTIONS[0]);
    setInlineColor(COLOR_OPTIONS[0]);
    setAddingGroupName(null);
  };

  const handleDeleteCategory = (id: string, name: string) => {
    dialog.alert({
      title: t('addTx.deleteCategoryConfirm', { name }),
      message: t('addTx.deleteCategoryKeepMsg'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('common.delete'), style: 'destructive', onPress: () => { hapticWarning(); deleteCategory(id); } },
      ],
    });
  };

  const handleDeleteGroup = (groupName: string, items: Category[]) => {
    const isCustom = categoryGroups.some((g) => g.name === groupName);
    dialog.alert({
      title: t('addTx.deleteGroupTitle', { name: groupName }),
      message: items.length > 0 ? t('addTx.deleteGroupMoveMsg', { count: items.length }) : t('addTx.emptyGroup'),
      buttons: [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            hapticWarning();
            if (isCustom) {
              deleteCategoryGroup(groupName);
            } else {
              // 默认大组：保留分类，只把它们的 group 清空（归入"其他"节）
              items.forEach((c) => updateCategory(c.id, { group: undefined }));
            }
          },
        },
      ],
    });
  };

  // 选择模式：回调把选中 id 交回表单 + goBack 弹栈返回——
  // 之前用 navigate(merge:true) 跳转，跨栈找不到目标时会再压一个新页面，反复点就无限套娃
  // 选中回调必须**恒定身份**：它经 onPick 传给每张网格，CategoryGridEditor 有 React.memo，
  // 每次渲染新建一个箭头函数会让所有网格全量重渲（见下方 getEditorCbs 的同一约定）
  const pickCbsRef = useRef({ onPickCategory, onBack });
  pickCbsRef.current = { onPickCategory, onBack };
  const handlePickCategory = useCallback((id: string) => {
    pickCbsRef.current.onPickCategory?.(id);
    pickCbsRef.current.onBack();
  }, []);

  // 网格最后一项的虚线「＋」磁贴：开/收本组的新增小卡（管理态长表单 / 选择态两步小卡共用这一份开关）
  const handleToggleAdd = useCallback(
    (groupName: string) => {
      hapticLight();
      if (addingGroupName === groupName) {
        setAddingGroupName(null);
        setInlineName('');
        return;
      }
      setInlineName('');
      setInlineIcon(ICON_OPTIONS[0]);
      setInlineColor(COLOR_OPTIONS[0]);
      setAddingGroupName(groupName);
    },
    [addingGroupName]
  );

  /* 分组网格的回调必须**按组稳定**：CategoryGridEditor 已用 React.memo 包住，
   * 若每次渲染都传新的箭头函数，memo 形同虚设 → 10 个网格 × 40 多磁贴全量重渲（安卓卡顿的成因）。
   * 这里按组名缓存一份，内部经 ref 永远调用最新的处理函数。 */
  const editorHandlersRef = useRef({ reorder: handleCatGroupReorder, toggleAdd: handleToggleAdd });
  editorHandlersRef.current = { reorder: handleCatGroupReorder, toggleAdd: handleToggleAdd };
  const editorCbsRef = useRef(
    new Map<string, { onReorder: (next: { id: string }[]) => void; onToggleAdd: () => void }>()
  );
  const getEditorCbs = useCallback((group: string) => {
    let cbs = editorCbsRef.current.get(group);
    if (!cbs) {
      cbs = {
        onReorder: (next) => editorHandlersRef.current.reorder(group, next),
        onToggleAdd: () => editorHandlersRef.current.toggleAdd(group),
      };
      editorCbsRef.current.set(group, cbs);
    }
    return cbs;
  }, []);

  // PERF 调试白字只在 showPerf 打开时画（两个入口都不传）；采样与状态照旧，不删
  const perfText = showPerf && perf
    ? 'PERF 首帧 ' +
      perf.first +
      'ms · 满载 ' +
      (perf.full == null ? '…' : perf.full + 'ms') +
      ' · 渲染 ' +
      perf.renders +
      ' 次 · 帧 ' +
      (frameStats ? '均 ' + frameStats.avg + ' / 最差 ' + frameStats.max + 'ms' : '采样中')
    : '';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: semantic.bg }]} edges={['top']}
      onTouchStart={() => { Keyboard.dismiss(); }}
    >
      {/* UI V2.1 §1：渐变铺满整页，一切卡片浮在渐变上 */}
      <HeroGradient fill />
      {/* 玻璃二级页头：返回 + 居中标题（本页进入即编辑态，不再有「编辑 / 完成」开关） */}
      <GlassBackHeader
        title={selectMode ? t('addTx.selectCategory') : t('addTx.categoryMgmt')}
        onBack={onBack}
      />
      {perfText ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 96, left: 0, right: 0, alignItems: 'center', zIndex: 999 }}
        >
          <AppText variant="caption2" color={semantic.accent}>
            {perfText}
          </AppText>
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        scrollEnabled={!gridDragging}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => {
          contentHRef.current = h;
        }}
        contentContainerStyle={{ paddingBottom: tabClearance, paddingTop: 2, paddingHorizontal: pagePadding }}
      >
        {/* 内容包一层：组卡 onLayout 的 y 与"列表顶边量测"用同一个参照系（整组拖拽的坐标换算） */}
        <View
          ref={listRef}
          onLayout={(e) => {
            listContentYRef.current = e.nativeEvent.layout.y;
          }}
        >
          {/* 顶部 支出/收入 切换：玻璃分段控件（V2.1 §2：夜白胶囊 / 日紫胶囊），带各自类别数（稿） */}
          {!selectMode && (
            <View style={styles.typeSegWrap}>
              <SegmentedControl
                stretch
                appearance="glass"
                options={[
                  { label: t('addTx.expenseTabCount', { count: categories.filter((c) => c.type === 'expense').length }), value: 'expense' },
                  { label: t('addTx.incomeTabCount', { count: categories.filter((c) => c.type === 'income').length }), value: 'income' },
                ]}
                selected={manageType}
                onSelect={(v) => setManageType(v as 'expense' | 'income')}
              />
            </View>
          )}

          {/* 每张大组一张玻璃卡：组内成员 + 该组自己的添加入口；自定义组可删除 */}
          {sections.map(({ group, items }, sectionIndex) => {
            const isAdding = addingGroupName === group;
            // TASK-020③：selectMode 照搬记一笔——折叠状态在 Set 里，点头部行收/展（管理模式不受影响）
            const expanded = !selectMode || !collapsedGroups.has(group);
            return (
            /* 组头整行 = 长按拖动整组的把手（短按行为不变：selectMode 收/展，管理态垃圾桶可点） */
            <GroupCardSlot
              key={group}
              group={group}
              dimmed={!!groupDrag && groupDrag.group === group}
              shiftYTarget={groupShifts.get(group) ?? 0}
              styles={styles}
              drag={groupDragShared}
              scrollY={scrollYSV}
              onCardLayout={handleGroupCardLayout}
              onDragStart={handleGroupDragStart}
              onDragHover={handleGroupDragHover}
              onDragMove={handleGroupDragMove}
              onDragEnd={handleGroupDragEnd}
              onDragCancel={handleGroupDragCancel}
              header={selectMode ? (
                <Pressable
                  style={styles.groupHeader}
                  onPress={() => {
                    // 拖拽抬起后浏览器补的 click 不算"短按"（否则一松手整组自己折叠）
                    if (Date.now() < groupTapBlockUntilRef.current) return;
                    setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group)) next.delete(group);
                      else next.add(group);
                      return next;
                    });
                  }}
                  hitSlop={{ top: 6, bottom: 6 }}
                >
                  <Ionicons name={expanded ? 'chevron-down' : 'chevron-forward'} size={14} color={semantic.textPrimary} />
                  <AppText variant="subhead" weight="600" style={styles.groupTitle}>{getGroupLabel(group, t)}</AppText>
                  <AppText variant="caption2" color={semantic.textSecondary} style={styles.groupCount}>
                    {t('addTx.itemsUnit', { count: items.length })}
                  </AppText>
                  {/* 组序拖拽把手（≡）：组头里的普通行内子节点 —— 一定渲染、一定可见，
                      且与标题/垃圾桶不是同一块区域。按住它上下拖 = 抬起整组换位。 */}
                  <View
                    testID="group-drag-handle"
                    {...getGroupPanHandlers(group)}
                    accessibilityRole="button"
                    accessibilityLabel={group + ' reorder'}
                    style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: 2 }}
                  >
                    <Ionicons name="reorder-three-outline" size={18} color={semantic.textTertiary} />
                  </View>
                  {/* 整组删除入口（记一笔同款：垃圾桶贴数量胶囊右侧；默认组自定义组都可删） */}
                  <PressableScale
                    style={styles.catHeaderDeleteBtn}
                    activeScale={0.90}
                    onPress={() => {
                      if (Date.now() < groupTapBlockUntilRef.current) return;
                      handleDeleteGroup(group, items);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={18} color={semantic.danger} />
                  </PressableScale>
                </Pressable>
              ) : (
              <View style={styles.groupHeader}>
                <AppText variant="subhead" weight="600" style={styles.groupTitle}>{getGroupLabel(group, t)}</AppText>
                <PressableScale
                  style={styles.groupDeleteBtn}
                  activeScale={0.90}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  onPress={() => {
                    if (Date.now() < groupTapBlockUntilRef.current) return;
                    handleDeleteGroup(group, items);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={semantic.danger} />
                </PressableScale>
                <AppText variant="caption2" color={semantic.textSecondary} style={styles.groupCount}>
                  {t('addTx.itemsUnit', { count: items.length })}
                </AppText>
              </View>
              )}>

              {/* TASK-020③：selectMode 折叠时组内容不渲染（记一笔同款）；管理模式永远显示。
                  网格最后一项是虚线「＋」磁贴（新增入口），其余磁贴长按即拖 */}
              {(expanded || !selectMode) && (
                <>
                  {items.length === 0 && (
                    <AppText variant="footnote" color={semantic.textSecondary} style={styles.groupEmpty}>
                      {t('addTx.noCatsAddHint')}
                    </AppText>
                  )}
                  {sectionIndex < mountedSections ? (
                  <CategoryGridEditor
                    items={items}
                    columns={columns}
                    draggable
                    isAdding={isAdding}
                    scrollRef={scrollRef}
                    contentH={contentHRef}
                    scrollY={scrollYSV}
                    onDraggingChange={handleGridDragging}
                    onReorder={getEditorCbs(group).onReorder}
                    onDelete={handleDeleteCategory}
                    onPick={selectMode ? handlePickCategory : undefined}
                    onToggleAdd={getEditorCbs(group).onToggleAdd}
                  />
                  ) : (
                    /* 还没轮到挂载：按「行数 × 格高」预留精确高度，避免内容长出来时版面跳动 */
                    <View style={{ height: Math.ceil(items.length / columns) * GRID_SLOT_H }} />
                  )}
                </>
              )}

              {/* 该组的添加入口：TASK-020③ selectMode 照搬记一笔两步小卡（图标预览+名称+✓ + 16 色格，
                  图标在弹层里选）；管理模式保持原长表单不变 */}
              {isAdding && selectMode ? (
                <View
                  style={styles.catInlineCard}
                  // 聚焦滚动 = 组卡 y + 小卡在组卡内的偏移（网格可能占多行，只滚到卡顶会盖住输入框）
                  onLayout={(e) => {
                    inlineCardOffsetRef.current[group] = e.nativeEvent.layout.y;
                  }}
                >
                  <View style={styles.catInlineNameRow}>
                    <PressableScale
                      style={[styles.catIconPreviewBtn, { backgroundColor: semantic.accentSoft }]}
                      activeScale={0.94}
                      onPress={() => {
                        hapticLight();
                        setIconPickerOpen(true);
                      }}
                    >
                      <Ionicons name={inlineIcon} size={22} color={semantic.textPrimary} />
                    </PressableScale>
                    <TextInput
                      style={[styles.catInlineInput, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                      value={inlineName}
                      onChangeText={setInlineName}
                      placeholder={t('addTx.inlineAddPlaceholder', { group })}
                      placeholderTextColor={semantic.textSecondary}
                      maxLength={10}
                      autoFocus
                      onFocus={() => {
                        inlineFocusGroupRef.current = group;
                        scrollInlineInputIntoView(group);
                      }}
                      onBlur={() => {
                        if (inlineFocusGroupRef.current === group) inlineFocusGroupRef.current = null;
                      }}
                    />
                    {/* 保存方键 = accent 渐变（§3：渐变实心按钮保持白字） */}
                    <PressableScale
                      activeScale={0.94}
                      disabled={!inlineName.trim()}
                      onPress={() => handleInlineAdd(group)}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.done')}
                    >
                      <LinearGradient
                        colors={gradients.accent.colors}
                        locations={gradients.accent.locations as [number, number, ...number[]]}
                        start={gradients.accent.start}
                        end={gradients.accent.end}
                        style={[styles.catInlineSaveSquare, !inlineName.trim() && { opacity: 0.45 }]}
                      >
                        <Ionicons name="checkmark" size={20} color={semantic.onAccent} />
                      </LinearGradient>
                    </PressableScale>
                  </View>
                  {/* 16 色直接铺 2 排（每排 8 个）——记一笔同款 */}
                  <View style={styles.catMiniColorsGrid}>
                    {COLOR_OPTIONS.map((color) => (
                      <PressableScale
                        key={color}
                        style={[
                          styles.catMiniColorDot,
                          { backgroundColor: color },
                          inlineColor === color && {
                            boxShadow: `0px 0px 0px 2px ${semantic.bg}, 0px 0px 0px 4px ${color}`,
                          },
                        ]}
                        activeScale={0.92}
                        onPress={() => setInlineColor(color)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: inlineColor === color }}
                        accessibilityLabel={color}
                      />
                    ))}
                  </View>
                </View>
              ) : isAdding ? (
                <View style={styles.inlineAddCard}>
                  <TextInput
                    style={[styles.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                    value={inlineName}
                    onChangeText={setInlineName}
                    placeholder={t('addTx.inlineAddPlaceholder', { group })}
                    placeholderTextColor={semantic.textSecondary}
                    maxLength={10}
                    autoFocus
                  />
                  <AppText variant="caption" color={semantic.textSecondary} style={styles.pickerLabel}>
                    {t('ledger.iconLabel')}
                  </AppText>
                  <View style={styles.pickerRow}>
                    {ICON_OPTIONS.map((icon) => (
                      <PressableScale
                        key={icon}
                        style={[
                          styles.iconOption,
                          { backgroundColor: semantic.accentSoft },
                          inlineIcon === icon && { borderWidth: 2, borderColor: semantic.accentText },
                        ]}
                        activeScale={0.92}
                        onPress={() => setInlineIcon(icon)}
                      >
                        <Ionicons name={icon} size={16} color={semantic.textPrimary} />
                      </PressableScale>
                    ))}
                  </View>
                  <AppText variant="caption" color={semantic.textSecondary} style={styles.pickerLabel}>
                    {t('ledger.colorLabel')}
                  </AppText>
                  <View style={styles.pickerRow}>
                    {COLOR_OPTIONS.map((color) => (
                      <PressableScale
                        key={color}
                        style={[
                          styles.colorOption,
                          { backgroundColor: color },
                          inlineColor === color && {
                            boxShadow: `0px 0px 0px 2px ${semantic.bg}, 0px 0px 0px 4px ${color}`,
                          },
                        ]}
                        activeScale={0.92}
                        onPress={() => setInlineColor(color)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: inlineColor === color }}
                        accessibilityLabel={color}
                      />
                    ))}
                  </View>
                  <View style={styles.inlineBtnRow}>
                    <PressableScale style={styles.cancelBtn} activeScale={0.94} onPress={() => setAddingGroupName(null)}>
                      <AppText variant="subhead" color={semantic.textSecondary}>{t('common.cancel')}</AppText>
                    </PressableScale>
                    <PressableScale
                      style={{ flex: 1, opacity: !inlineName.trim() ? 0.45 : 1 }}
                      activeScale={0.97}
                      disabled={!inlineName.trim()}
                      onPress={() => handleInlineAdd(group)}
                      accessibilityRole="button"
                      accessibilityLabel={t('addTx.addToGroup', { group })}
                    >
                      <LinearGradient
                        colors={gradients.accent.colors}
                        locations={gradients.accent.locations as [number, number, ...number[]]}
                        start={gradients.accent.start}
                        end={gradients.accent.end}
                        style={styles.saveBtnFill}
                      >
                        <AppText variant="subhead" weight="600" color={semantic.onAccent} numberOfLines={1}>
                          {t('addTx.addToGroup', { group })}
                        </AppText>
                      </LinearGradient>
                    </PressableScale>
                  </View>
                </View>
              ) : null}
            </GroupCardSlot>
          );
          })
          }
          {/* 新增大分类 */}
          {newGroupFormOpen ? (
            <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={[styles.groupCard, styles.newGroupCard]}>
              <AppText variant="subhead" weight="600" style={styles.newCatTitle}>
                {t('addTx.addGroup')}
              </AppText>
              <TextInput
                style={[styles.input, { backgroundColor: semantic.accentSoft, color: semantic.textPrimary }]}
                value={newGroupName}
                onChangeText={setNewGroupName}
                placeholder={t('addTx.groupNamePlaceholder')}
                placeholderTextColor={semantic.textSecondary}
                maxLength={10}
                autoFocus
              />
              <View style={styles.inlineBtnRow}>
                <PressableScale style={styles.cancelBtn} activeScale={0.94} onPress={() => setNewGroupFormOpen(false)}>
                  <AppText variant="subhead" color={semantic.textSecondary}>{t('common.cancel')}</AppText>
                </PressableScale>
                <PressableScale
                  style={{ flex: 1, opacity: !newGroupName.trim() ? 0.45 : 1 }}
                  activeScale={0.97}
                  disabled={!newGroupName.trim()}
                  onPress={() => {
                    const name = newGroupName.trim();
                    if (!name) return;
                    addCategoryGroup({ name, icon: 'folder-outline', type: 'expense' });
                    setNewGroupName('');
                    setNewGroupFormOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('addTx.createGroup')}
                >
                  <LinearGradient
                    colors={gradients.accent.colors}
                    locations={gradients.accent.locations as [number, number, ...number[]]}
                    start={gradients.accent.start}
                    end={gradients.accent.end}
                    style={styles.saveBtnFill}
                  >
                    <AppText variant="subhead" weight="600" color={semantic.onAccent} numberOfLines={1}>
                      {t('addTx.createGroup')}
                    </AppText>
                  </LinearGradient>
                </PressableScale>
              </View>
            </GlassView>
          ) : (
            <PressableScale
              activeScale={0.97}
              onPress={() => setNewGroupFormOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('addTx.addGroup')}
            >
              <GlassView intensity={WEB_GLASS_INTENSITY} radius={26} style={[styles.groupCard, styles.newGroupCard]}>
                <View style={styles.newGroupEntry}>
                  <Ionicons name="add-circle-outline" size={18} color={semantic.textPrimary} />
                  <AppText variant="subhead" weight="600" color={semantic.textPrimary} style={styles.newGroupEntryText}>
                    {t('addTx.addGroup')}
                  </AppText>
                </View>
              </GlassView>
            </PressableScale>
          )}

          {/* 被拖起的整组：跟手的组头胶囊（组名 + 项数）。
              只在 groupDrag 非空时渲染 —— 拖图标时它是 null，不会出现 */}
          {groupDrag && ghostSection && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.groupGhost,
                { backgroundColor: glass.fill, boxShadow: glass.shadow },
                groupGhostStyle,
              ]}
            >
              <Ionicons name="reorder-three-outline" size={16} color={semantic.textTertiary} style={styles.groupGhostHandle} />
              <AppText variant="subhead" weight="600" style={styles.groupTitle}>
                {getGroupLabel(groupDrag.group, t)}
              </AppText>
              <AppText variant="caption2" color={semantic.textSecondary} style={styles.groupCount}>
                {t('addTx.itemsUnit', { count: ghostSection.items.length })}
              </AppText>
            </Animated.View>
          )}
        </View>
      </ScrollView>

      {/* TASK-020③：图标选择底部弹层（两步小卡第二步）——119 个图标 6 列网格，
          点选回填小卡预览方块；记一笔同款（JSX 与样式整套照搬，防两处漂移） */}
      <Modal
        visible={iconPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIconPickerOpen(false)}
      >
        <Pressable style={styles.iconPickerOverlay} onPress={() => setIconPickerOpen(false)}>
          <Pressable style={{ width: '100%' }} onPress={() => {}}>
            {/* 弹层面板用不透明卡色（Android 无模糊，玻璃 fill 会透出底下内容） */}
            <GlassView intensity={WEB_GLASS_INTENSITY} radius={0} fill={semantic.homeCard} style={styles.iconPickerSheet}>
              <View style={styles.iconPickerHeader}>
                <AppText variant="headline">{t('addTx.pickIconTitle')}</AppText>
                <PressableScale
                  style={[styles.iconPickerClose, { backgroundColor: semantic.accentSoft }]}
                  activeScale={0.92}
                  onPress={() => setIconPickerOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={18} color={semantic.textSecondary} />
                </PressableScale>
              </View>
              <ScrollView style={styles.iconPickerGrid} keyboardShouldPersistTaps="handled">
                <View style={styles.iconPickerGridInner}>
                  {ICON_OPTIONS.map((icon) => (
                    <PressableScale
                      key={icon}
                      style={[
                        styles.iconPickerCell,
                        inlineIcon === icon && { backgroundColor: semantic.accentSoft },
                      ]}
                      activeScale={0.9}
                      onPress={() => {
                        setInlineIcon(icon);
                        setIconPickerOpen(false);
                      }}
                    >
                      <Ionicons name={icon} size={22} color={inlineIcon === icon ? semantic.accentText : semantic.textPrimary} />
                    </PressableScale>
                  ))}
                </View>
              </ScrollView>
            </GlassView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
function makeStyles(semantic: ReturnType<typeof useTheme>['semantic'], spacing: Spacing) {
  return StyleSheet.create({
    container: { flex: 1 },
    // 玻璃页头：透明返回键底下那枚 44 玻璃圆钮（与 ScreenHeader 左侧槽位对齐）
    headerGlass: { position: 'absolute', width: 44, height: 44 },
    headerGlassInner: { width: 44, height: 44 },
    // 顶部 支出/收入 分段：贴紧页头（上移），玻璃槽自带圆角
    typeSegWrap: { marginBottom: spacing.md },
    groupCard: {
      marginBottom: spacing.md,
      paddingBottom: spacing.xs + 2,
    },
    groupHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 3 },
    groupTitle: { flexShrink: 1 },
    groupDeleteBtn: { marginLeft: spacing.sm },
    groupCount: { marginLeft: 'auto' },
    // 正在被拖走的那张组卡：留在原位变淡（幽灵在手指底下），其余组卡让位平移
    groupDragging: { opacity: 0.35 },
    groupGhostHandle: { marginRight: spacing.xs + 2 },
    // 整组拖拽的幽灵（跟手的组头胶囊）：与组卡同宽（内容包了 padding，这里 left/right 0 即对齐卡片）
    groupGhost: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      height: 56,
      borderRadius: 20,
      paddingHorizontal: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      zIndex: 30,
    },
    groupEmpty: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
    // ---------- TASK-020③：selectMode 照搬记一笔的两步小卡 + 图标弹层样式（原样搬，防两处漂移） ----------
    catInlineCard: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.xs },
    catInlineInput: {
      flex: 1,
      minWidth: 0,
      borderRadius: 999,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 14,
      textAlign: 'center',
    },
    catIconPreviewBtn: {
      width: 44,
      height: 44,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm,
    },
    catInlineSaveSquare: {
      marginLeft: spacing.sm,
      width: 38,
      height: 38,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden',
    },
    catInlineNameRow: { flexDirection: 'row', alignItems: 'center' },
    catMiniColorsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginTop: spacing.sm + 2,
      paddingHorizontal: 2,
    },
    catMiniColorDot: { width: 26, height: 26, borderRadius: 999, marginRight: 10, marginBottom: spacing.sm },
    // selectMode 头部行的垃圾桶（新增入口已移到网格最后一项的虚线磁贴）
    catHeaderDeleteBtn: { marginLeft: spacing.sm, padding: 2 },
    iconPickerOverlay: {
      flex: 1,
      backgroundColor: semantic.scrim,
      justifyContent: 'flex-end',
    },
    iconPickerSheet: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      maxHeight: 520,
      paddingBottom: spacing.lg,
    },
    iconPickerHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md + 2,
      paddingBottom: spacing.sm,
    },
    iconPickerClose: {
      width: 30,
      height: 30,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconPickerGrid: { paddingHorizontal: 10 },
    iconPickerGridInner: { flexDirection: 'row', flexWrap: 'wrap' },
    iconPickerCell: {
      width: `${100 / 6}%` as unknown as `${number}%`,
      aspectRatio: 1.15,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 12,
    },
    // 组内联添加
    inlineAddCard: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    inlineBtnRow: { flexDirection: 'row', marginTop: spacing.md, alignItems: 'center' },
    cancelBtn: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, marginRight: spacing.sm },
    // 新增大分类
    newGroupCard: { marginTop: spacing.xs, padding: spacing.lg },
    newCatTitle: { marginBottom: 10 },
    newGroupEntry: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'center',
      paddingVertical: 9,
      paddingHorizontal: 18,
      borderRadius: 999,
    },
    newGroupEntryText: { marginLeft: spacing.xs + 2 },
    input: {
      borderRadius: 999,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontSize: 14,
      marginBottom: spacing.md,
    },
    pickerLabel: { marginBottom: spacing.sm },
    pickerRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
    iconOption: {
      width: 32,
      height: 32,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: spacing.sm - 2,
      marginBottom: spacing.sm - 2,
    },
    colorOption: { width: 26, height: 26, borderRadius: 999, marginRight: spacing.sm, marginBottom: spacing.sm - 2 },
    // 渐变主按钮的填充层（圆角 999 胶囊；文字白字压在上面）
    saveBtnFill: {
      minHeight: 44,
      borderRadius: 999,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
  });
}
