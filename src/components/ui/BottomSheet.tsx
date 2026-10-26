// BottomSheet.tsx
// 全 App 唯一的底部抽屉（T05 / 计划 4.5、10.1 —— 取代现在 7 种弹层写法）。
//
// 统一提供
// - 面板底 = UI V2.1 §2 唯一玻璃材质（GlassView：填充 / 描边 / 顶部内高光 / 投影 / 模糊回退）；
// - 遮罩：全 App 唯一遮罩色 semantic.scrim，拖动时随下拉距离变淡；
// - 拖动把手 + 下拉关闭：跟手下拉，松手按「下拉超过 30% 或速度够快」收起，
//   **松手速度传给出场弹簧**（计划 4.3 的 velocity handoff），不会突然一顿；
// - 进出都走 motion.spring.sheet（400ms、0.85 阻尼）；
// - 安全区：底部自动加 insets.bottom（手势条 / 三键导航都不会压内容）；
// - 出场动画：关闭键、点遮罩、父级把 visible 改 false（选完选项）三条路径**都会先播出场动画再卸载**。
//
// 外壳写法（项目已有定论，别改回 RN Modal）：树内覆盖层 + Reanimated + Gesture.Pan。
// 理由见 DateRangePickerSheet.tsx 头注释：Modal 独立原生窗口会和 Reanimated 在安卓上出幽灵副本，
// 也接不了跟手下拉。
//
// 用法
//   <BottomSheet visible={open} onClose={() => setOpen(false)} title={tr('ledger.title')}>
//     <ListSection> … </ListSection>
//   </BottomSheet>
//
//   ⚠ 组件按 absoluteFill 铺满父容器，必须挂在页面（或屏幕级容器）的最后一个子节点上；
//     内容需要滚动时由调用方在 children 里放 ScrollView。
//   ⚠ 抽屉里的列表要「贴边」：用裸 ListRow（自带分隔线），或 ListSection 传
//     cardStyle={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }} ——
//     抽屉里再套一张四角圆角的卡，看起来会像浮起来的卡片（验收退回第 5 条）。

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomSystemInset } from '../../hooks/useBottomSystemInset';
import { Spacing } from '../../theme/theme';
import { useTheme } from '../../theme/useTheme';
import { useT } from '../../i18n/LanguageContext';
import { useTabBarForceHide } from '../../context/TabBarAutoHideContext';
import AppText from './AppText';
import GlassView from './GlassView';
import IconButton from './IconButton';

export interface BottomSheetProps {
  visible: boolean;
  /** 父级收到后把 visible 置 false（本组件负责播完出场动画再卸载） */
  onClose: () => void;
  children: React.ReactNode;
  /** 标题（传了才显示标题行） */
  title?: string;
  /** 拖动把手（默认显示） */
  handle?: boolean;
  /** 右上角关闭键（默认：有 title 时显示） */
  closeButton?: boolean;
  /** 允许下拉关闭（默认允许） */
  dismissible?: boolean;
  /** 内容最大高度（占屏高比，默认 0.85） */
  maxHeightRatio?: number;
  /** 面板底填充覆盖（默认 = V3 不透明卡色 semantic.homeCard）。传入的颜色须不透明，否则背后内容会透出 */
  fill?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** 标题行里给关闭键留的对位宽度（= 一个 44pt 触控区，标题因此严格居中） */
const HEADER_SLOT = 44;
/** 把手尺寸 */
const HANDLE_WIDTH = 40;
const HANDLE_HEIGHT = 5;
/** 下拉关闭阈值：位移超过卡高这个比例，或松手速度超过该值（px/s） */
const DISMISS_DISTANCE_RATIO = 0.3;
const DISMISS_VELOCITY = 800;
/** 出场起点下限：屏幕外的安全距离（任何屏高都完全滑出可视区） */
const OFFSCREEN_MIN = 900;

export function BottomSheet({
  visible,
  onClose,
  children,
  title,
  handle = true,
  closeButton,
  dismissible = true,
  maxHeightRatio = 0.85,
  fill,
  accessibilityLabel,
  style,
  testID,
}: BottomSheetProps) {
  const { semantic, spacing, radius, motion } = useTheme();
  const insets = useSafeAreaInsets();
  // 底部系统栏高度（安卓实测导航条兜底，见 useBottomSystemInset）
  const bottomInset = useBottomSystemInset();
  const { height: windowHeight } = useWindowDimensions();
  const tr = useT();
  const forceHideTabBar = useTabBarForceHide();
  const showClose = closeButton ?? !!title;
  const styles = useMemo(() => makeStyles(spacing), [spacing]);

  // 键盘避让：iOS 的系统键盘弹出时窗口高度不变（安卓是 adjustResize，窗口自己缩小、
  // 抽屉自然停在键盘上沿），所以只有 iOS 需要把抽屉整体抬到键盘上沿。
  // 高度取 keyboardDidShow 的真实 endCoordinates.height（与记一笔页同一套事件源，不另建一套）。
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  // 上抬量夹在「抽屉仍完整留在顶部安全区之下」的范围内：矮屏 + 高键盘不会把抽屉顶出屏幕
  const keyboardLift = Platform.OS === 'ios' ? Math.max(0, Math.min(keyboardHeight, windowHeight - insets.top)) : 0;
  // 面板最大高度 = min(屏高 × maxHeightRatio, 视口高 − 顶部安全区 − 键盘上抬量)。
  // 底部安全区由面板自己的 paddingBottom（bottomInset + spacing.lg）让出，不再从 maxHeight 里减一次，
  // 否则底部会多留一条空带。内容超高时由 children 里的 ScrollView（flexShrink: 1）内部滚动。
  const panelMaxHeight = Math.round(
    Math.max(0, Math.min(windowHeight * maxHeightRatio, windowHeight - insets.top - keyboardLift))
  );

  // 屏幕外起点：取屏高，保证任何尺寸的卡都从可视区外滑入
  // （首帧就画在屏外，不会先闪一帧「完整面板」再滑入）
  const offscreen = Math.max(OFFSCREEN_MIN, windowHeight);
  const [mounted, setMounted] = useState(visible);
  const translateY = useSharedValue(offscreen);
  const scrimOpacity = useSharedValue(0);
  const closing = useSharedValue(true);
  const sheetHeight = useSharedValue(0);
  const touchStartY = useSharedValue(0);

  // onClose 走 ref 转发：手势对象只建一次，不会随渲染重建
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const unmount = () => setMounted(false);

  const playExit = (velocity = 0) => {
    if (closing.value) return;
    closing.value = true;
    scrimOpacity.value = withTiming(0, { duration: motion.timing.fade, easing: motion.easing.out });
    translateY.value = withSpring(offscreen, { ...motion.spring.sheet, velocity }, (finished) => {
      'worklet';
      if (finished) runOnJS(unmount)();
    });
  };

  /** 用户主动关闭（关闭键 / 点遮罩 / 下拉到底）：先起出场动画（带松手速度），再同步父级状态 */
  const requestClose = (velocity = 0) => {
    playExit(velocity);
    onCloseRef.current();
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      closing.value = false;
      translateY.value = offscreen;
      scrimOpacity.value = 0;
      translateY.value = withSpring(0, motion.spring.sheet);
      scrimOpacity.value = withTiming(1, { duration: motion.timing.fade, easing: motion.easing.out });
    } else if (mounted) {
      // 父级直接把 visible 置 false（选完选项等）：照样播出场动画
      playExit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 安卓硬件返回键：抽屉开着时先收起抽屉（同点遮罩路径，播出场动画），不退出整页。
  // 用 ref 转发，监听只随 visible 挂拆；多层抽屉时 RN 按后注册先处理，返回 true 即拦截
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestCloseRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  // 抽屉盖住下半屏：打开期间强制收起底部 Tab 栏（同 DateRangePickerSheet）
  useEffect(() => {
    if (visible) forceHideTabBar(true);
    return () => {
      if (visible) forceHideTabBar(false);
    };
  }, [visible, forceHideTabBar]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        // 手动激活：默认不接管任何触摸（卡内的按钮 / 输入框零干扰），下拖 8px 才激活
        .manualActivation(true)
        .onTouchesDown((e) => {
          touchStartY.value = e.allTouches[0]?.absoluteY ?? 0;
        })
        .onTouchesMove((e, manager) => {
          if (e.allTouches.length === 0) return;
          const dy = e.allTouches[0].absoluteY - touchStartY.value;
          if (dy > 8) manager.activate();
        })
        .onUpdate((e) => {
          const next = Math.max(0, e.translationY);
          translateY.value = next;
          if (sheetHeight.value > 0) {
            scrimOpacity.value = Math.max(0, 1 - next / sheetHeight.value);
          }
        })
        .onEnd((e) => {
          const fast = e.velocityY > DISMISS_VELOCITY;
          const far = e.translationY > Math.max(80, sheetHeight.value * DISMISS_DISTANCE_RATIO);
          if (dismissible && (fast || far)) {
            // 松手速度进弹簧：从当前手指位置继续滑出，不重置、不顿
            runOnJS(requestClose)(e.velocityY);
          } else {
            translateY.value = withSpring(0, motion.spring.sheet);
            scrimOpacity.value = withTiming(1, { duration: motion.timing.fade });
          }
        })
        .onFinalize((_e, success) => {
          // 手势被系统 / 父级抢走（success=false）：回弹复位，别把卡片留在半空
          if (!success && !closing.value) {
            translateY.value = withSpring(0, motion.spring.sheet);
            scrimOpacity.value = withTiming(1, { duration: motion.timing.fade });
          }
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dismissible]
  );

  const sheetAnimStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const scrimAnimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));

  if (!mounted) return null;

  const dragArea = (
    <>
      {handle && <View style={[styles.handle, { backgroundColor: semantic.hairline }]} />}
      {(!!title || showClose) && (
        <View style={styles.header}>
          {showClose ? <View style={styles.headerSlot} /> : null}
          <AppText variant="title3" align="center" numberOfLines={2} style={styles.headerTitle}>
            {title ?? ''}
          </AppText>
          {showClose ? (
            <View style={styles.headerSlot}>
              <IconButton icon="close" accessibilityLabel={tr('common.close')} onPress={() => requestClose()} />
            </View>
          ) : null}
        </View>
      )}
    </>
  );

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} testID={testID}>
      {/* 遮罩：点空白收起 —— 同样先播出场动画 */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => requestClose()}
        accessibilityRole="button"
        accessibilityLabel={tr('common.close')}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: semantic.scrim }, scrimAnimStyle]}
          pointerEvents="none"
        />
      </Pressable>

      <Animated.View
        style={[
          styles.sheet,
          {
            // 只有顶部两个角是圆角（抽屉顶部 28）；底部直角、贴住屏幕底边（验收退回第 5 条）
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            // 内容底部留白 = 安全区 + 16（用户定版；不能用 max，否则三键导航机型会贴死）
            paddingBottom: bottomInset + spacing.lg,
            maxHeight: panelMaxHeight,
            // iOS 键盘弹起时整体抬到键盘上沿（安卓窗口已自行缩小，这里恒为 0）
            marginBottom: keyboardLift,
          },
          sheetAnimStyle,
          style,
        ]}
        onLayout={(e) => {
          sheetHeight.value = Math.round(e.nativeEvent.layout.height);
        }}
        // 面板本体也带 id（testID-panel）：测试 / 预览页要量的是这张卡，不是整屏覆盖层
        testID={testID ? `${testID}-panel` : undefined}
        accessibilityViewIsModal
        accessibilityLabel={accessibilityLabel}
      >
        {/* 面板底 = UI V2.1 §2 唯一玻璃材质（填充 + 描边 + 顶部内高光 + 投影 + 模糊回退）。
            背景层不吃触摸（pointerEvents none），交互全部交给内容 */}
        <GlassView
          radius={0}
          fill={fill ?? semantic.homeCard}
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              borderBottomWidth: 0,
            },
          ]}
        />
        {/* 手势只挂在把手 / 标题行：内容里有列表或横向滑动时不会跟内部滚动抢手势 */}
        <GestureDetector gesture={panGesture}>
          {/* collapsable=false：安卓视图拍平会把手势节点吃掉 */}
          <View collapsable={false}>{dragArea}</View>
        </GestureDetector>
        {children}
      </Animated.View>
    </View>
  );
}

/** 令牌进、StyleSheet 出（间距走令牌；色值 / 圆角 / 安全区都在渲染期内联给） */
function makeStyles(spacing: Spacing) {
  return StyleSheet.create({
    // 覆盖层：铺满父容器 + 底部对齐（浮层允许绝对定位，UI_RULES 第 4 节）
    root: { justifyContent: 'flex-end', zIndex: 90, elevation: 90 },
    sheet: { width: '100%', paddingTop: spacing.sm, overflow: 'hidden' },
    handle: {
      width: HANDLE_WIDTH,
      height: HANDLE_HEIGHT,
      borderRadius: HANDLE_HEIGHT / 2,
      alignSelf: 'center',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: HEADER_SLOT,
      paddingHorizontal: spacing.sm,
    },
    headerSlot: { width: HEADER_SLOT, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, paddingHorizontal: spacing.sm },
  });
}

export default BottomSheet;
