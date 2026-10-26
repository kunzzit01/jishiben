// TabBarAutoHideContext.tsx
// 浮空 Tab 栏的滚动收起/展开共享状态。
//
// 用法：
// - App 里用 useCreateTabBarAutoHide() 创建一份 value，包在 Tab.Navigator 外层；
//   同一个 value 喂给 TabBarAutoHideProvider 和 NavigationContainer 的 onStateChange。
// - 各页面（含嵌套 Stack 内的子页面）调 useTabBarScrollHandler() 拿 onScroll，
//   挂到自己的 ScrollView/FlatList 上：onScroll={onTabScroll} scrollEventThrottle={16}。
//
// 设计要点：
// - 方向判断用"锚点迟滞"：沿同方向持续滚过 60px 才触发收起/展开，
//   方向一反转就重置锚点——轻微抖动不会让栏来回闪烁。
// - 顶部 50px 以内强制显示（列表刚下拉/回顶时栏必须可见）。
// - 位移和淡出动画用原生驱动（web 除外），JS 里只做每帧几次的比较，无 setState。

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform } from 'react-native';
// 收起距离跟外壳几何同源（T07）：不再写死 60 + 8 + 30；
// 底部 inset 也必须与外壳的 bottom 偏移同源（useBottomSystemInset，含安卓三键导航实测值），
// 否则收起后整栏露不出屏外 / 多滑一截
import { useBottomSystemInset } from '../hooks/useBottomSystemInset';
import { tabBarHideOffset } from '../hooks/useTabClearance';

type TabBarAutoHideValue = {
  translateY: Animated.Value;
  opacity: Animated.Value;
  onScroll: (e: any) => void;
  reset: () => void;
  // 外部强制隐藏/恢复（比如页面里弹出了自绘键盘、跟Tab bar在同一块屏幕区域相撞时用）。
  // 优先级高于滚动：forced 为 true 期间，onScroll/reset 都不会再改变显隐状态。
  // 多个持有者（页面 / 弹层 / 日期选择器）各用自己的 owner 标识：只要还有任一 owner 持有，栏就保持隐藏；
  // 最后一个 owner 释放时才弹出。不传 owner = 共用默认 owner（旧调用方式，行为同以前）。
  setForceHidden: (hidden: boolean, owner?: unknown) => void;
};

const TabBarAutoHideContext = createContext<TabBarAutoHideValue | null>(null);

const HIDE_DISTANCE = 60; // 同方向滚动 60px 才切换状态
const TOP_ZONE = 50; // 距顶部 50px 以内强制显示
const ANIM_MS = 240; // UI 动画 240ms ease-out（<300ms 原则）

type AutoHideState = {
  translateY: Animated.Value;
  opacity: Animated.Value;
  hidden: boolean;
  lastY: number;
  anchor: number;
  lastDirDown: boolean;
  /** 强制隐藏的持有者集合（必须跨 insets 变化保留，否则会丢掉仍在用的持有者） */
  owners: Set<unknown>;
  /** = owners.size > 0；true 期间，滚动/导航跳转都不再决定显隐，只听 setForceHidden */
  forced: boolean;
  /** 位置待同步：reset()/解除强制隐藏后，下一个 onScroll 只校准真实位置、不做方向判断 */
  pendingSync: boolean;
};

export function useCreateTabBarAutoHide(): TabBarAutoHideValue {
  // 底部 inset 的唯一来源（= max(insets.bottom, 安卓实测导航条)）：收起位移必须跟外壳
  // 实际贴的位置同源，否则三键导航下栏会停在屏幕里露出半截
  const bottomInset = useBottomSystemInset();
  // 底部安全区只通过 ref 读取：变化时不重建 owners / forced / 动画值（以前放在 useMemo 里，
  // insets.bottom 一变就整套重建，丢掉仍然活着的 owner，栏可能被错误弹出）
  const bottomRef = useRef(bottomInset);
  bottomRef.current = bottomInset;
  const stateRef = useRef<AutoHideState | null>(null);
  if (stateRef.current === null) {
    stateRef.current = {
      translateY: new Animated.Value(0),
      opacity: new Animated.Value(1),
      hidden: false,
      lastY: 0,
      anchor: 0,
      lastDirDown: true,
      owners: new Set<unknown>(),
      forced: false,
      pendingSync: false,
    };
  }

  return useMemo(() => {
    const st = stateRef.current as AutoHideState;

    const toggle = (hide: boolean) => {
      if (hide === st.hidden) return;
      st.hidden = hide;
      // 收起位移 = 外壳完整高度 + 距底 + 安全区（tabBarHideOffset 从 useTabClearance
      // 的同一组常量推导）——保证整栏连中央凸起的圆钮一起滑出屏幕之外
      const off = tabBarHideOffset(bottomRef.current);
      const anim = { duration: ANIM_MS, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' };
      Animated.parallel([
        Animated.timing(st.translateY, { toValue: hide ? off : 0, ...anim }),
        Animated.timing(st.opacity, { toValue: hide ? 0 : 1, ...anim }),
      ]).start();
    };

    const onScroll = (e: any) => {
      if (st.forced) return; // 键盘等弹层开着的时候，滚动不应该把栏重新弹出来
      const y = e?.nativeEvent?.contentOffset?.y ?? 0;
      if (st.pendingSync) {
        // 面板刚关闭/刚切回来：先校准到列表真实位置，不做方向判断
        st.pendingSync = false;
        st.lastY = y;
        st.anchor = y;
        return;
      }
      const dy = y - st.lastY;
      st.lastY = y;
      if (Math.abs(dy) < 0.5) return;
      const goingDown = dy > 0;

      // 顶部区域常显
      if (y <= TOP_ZONE) {
        st.anchor = y;
        st.lastDirDown = goingDown;
        toggle(false);
        return;
      }
      // 方向反转：只更新方向标记。锚点保留——这样快滑一大步（一次事件跨过
      // 整个迟滞距离）也能立即触发，而不是只"重新武装"等下一次滚动
      if (goingDown !== st.lastDirDown) {
        st.lastDirDown = goingDown;
      }
      const travelled = goingDown ? y - st.anchor : st.anchor - y;
      if (travelled >= HIDE_DISTANCE) {
        st.anchor = y;
        toggle(goingDown);
      }
    };

    const reset = () => {
      if (st.forced) return; // 强制隐藏期间，导航状态变化（切Tab/push/pop）也不该把栏拉出来
      // 不再把 lastY/anchor 归零（列表可能停在中途位置）：交给下一个 onScroll 校准
      st.pendingSync = true;
      toggle(false);
    };

    const DEFAULT_OWNER = 'default';
    const setForceHidden = (hide: boolean, owner: unknown = DEFAULT_OWNER) => {
      if (hide) {
        st.owners.add(owner);
        st.forced = true;
        toggle(true);
      } else {
        // 没持有过的 owner 释放（如卸载清理）不产生任何效果，也不会把别人的隐藏打断
        if (!st.owners.delete(owner)) return;
        st.forced = st.owners.size > 0;
        if (st.forced) return; // 还有别的 owner 在用：继续隐藏
        // 交还给滚动逻辑：先按"不隐藏"处理并把栏弹出来；下一个 onScroll 只校准
        // 真实滚动位置，不会把"位置跳变"误判成向下滚动（修复选完日期栏又缩回去的 bug）
        st.pendingSync = true;
        toggle(false);
      }
    };

    return { translateY: st.translateY, opacity: st.opacity, onScroll, reset, setForceHidden };
  }, []);
}

export function TabBarAutoHideProvider({
  value,
  children,
}: {
  value: TabBarAutoHideValue;
  children: React.ReactNode;
}) {
  return <TabBarAutoHideContext.Provider value={value}>{children}</TabBarAutoHideContext.Provider>;
}

// 页面里用：拿滚动 handler（在 Provider 外时返回 null，页面侧 ?? undefined 兜底）
export function useTabBarScrollHandler(): ((e: any) => void) | null {
  return useContext(TabBarAutoHideContext)?.onScroll ?? null;
}

// 页面里用：拿强制隐藏/恢复开关（自绘键盘、全屏弹层等跟Tab bar打架的场景用）。
// Provider 外调用给个 no-op，不会报错，方便页面不关心"是否真的在Provider里"。
export function useTabBarForceHide(): (hidden: boolean) => void {
  const ctx = useContext(TabBarAutoHideContext);
  // 每个 hook 实例一个稳定的 owner（嵌套的页面 / 弹层互不覆盖）
  const ownerRef = useRef<symbol>(Symbol('tabBarForceHideOwner'));
  const setForceHidden = ctx?.setForceHidden;
  // 卸载时释放自己持有的隐藏（没持有则无效果）
  useEffect(() => {
    const owner = ownerRef.current;
    return () => {
      setForceHidden?.(false, owner);
    };
  }, [setForceHidden]);
  return useCallback(
    (hidden: boolean) => {
      setForceHidden?.(hidden, ownerRef.current);
    },
    [setForceHidden]
  );
}

// Tab 栏外壳用：拿 translateY/opacity 驱动收起/展开动画
export function useTabBarAutoHide(): TabBarAutoHideValue {
  const ctx = useContext(TabBarAutoHideContext);
  if (!ctx) throw new Error('useTabBarAutoHide must be used within TabBarAutoHideProvider');
  return ctx;
}
