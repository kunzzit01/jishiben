// useBottomSystemInset.ts
// 底部系统栏高度（手势条 / 三键导航条）的唯一来源：底部自绘面板（计算器键盘）、
// App 的导航栏遮罩（NavBarScrim）、浮动 Tab 栏、底部抽屉的补白都从这里取，
// 保证「遮罩高度 == 面板让位高度 == 栏身上移量」。
//
// 计算规则与理由见 bottomSystemInsetCore.ts（纯函数，可单测）：
// 本项目在 Android 上恒为 edge-to-edge → insets.bottom 即真值；
// 键盘弹起时窗口被压缩，绝不拿 screen−window 推算高度。
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, Keyboard, Platform, StatusBar, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { computeBottomSystemInset } from './bottomSystemInsetCore';

/** 软键盘可见性（Android adjustResize 会压缩窗口，必须在算高度时排除） */
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => setVisible(true));
    const h = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);
  return visible;
}

export function useBottomSystemInset(): number {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const keyboardVisible = useKeyboardVisible();

  return useMemo(
    () =>
      computeBottomSystemInset({
        platform: Platform.OS,
        insetsBottom: insets.bottom,
        screenHeight: Dimensions.get('screen').height,
        windowHeight: Dimensions.get('window').height,
        statusBarHeight: StatusBar.currentHeight ?? 0,
        keyboardVisible,
      }),
    // win.height / win.width：旋转、分屏、导航方式切换时触发重算
    [insets.bottom, win.height, win.width, keyboardVisible]
  );
}
