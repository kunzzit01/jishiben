/**
 * 底部系统栏 inset 的纯函数核心（无 React 依赖，可单测）。
 *
 * 背景事实（决定了公式该长什么样）：
 *   Expo SDK 57 / React Native 0.86 在 Android 上**恒为 edge-to-edge**
 *   （工具链里已没有 edgeToEdgeEnabled 开关，react-native-edge-to-edge 也未安装）。
 *   也就是说：应用窗口覆盖系统导航栏区域，react-native-safe-area-context 的
 *   insets.bottom 就是导航栏 / 手势条的真实高度。
 *
 * 因此旧的 「max(insets.bottom, screenHeight − windowHeight − statusBarHeight)」有两个错：
 *   1. 键盘弹起时（Android adjustResize 会把窗口压小），screen−window 里混进了键盘高度，
 *      实测值变成「导航条 + 键盘 ≈ 348」，max 取到 348 → 浮空栏被顶飞、遮罩盖住键盘。
 *   2. 非 edge-to-edge 机型（老系统）窗口本来就不含导航条，再叠加一次就是重复计算。
 *
 * 新规则（优先级从高到低）：
 *   a. insets.bottom > 0 → 直接采信（edge-to-edge 下的唯一真值）；
 *   b. 键盘可见 → 0（此时窗口被键盘压缩，任何 screen−window 推算都不可信）；
 *   c. insets 报 0 且窗口未被键盘压缩 → 用 screen−window−status 兜底，
 *      但**只在该值落在导航条合理量级内**时采信（个别 OEM 会漏报 inset）；
 *   d. 其余情况 → 0（宁可不留白，也不凭空造出一个高度）。
 */

/** 兜底值的合理性上限（dp）：仅用于「排除键盘/分屏等异常压缩」，它不是任何设备的导航栏高度 */
export const NAV_BAR_PLAUSIBLE_MAX = 80;

export interface BottomInsetInput {
  /** 'android' | 'ios' | 'web' */
  platform: string;
  /** react-native-safe-area-context 报告的底部 inset */
  insetsBottom: number;
  /** Dimensions.get('screen').height */
  screenHeight: number;
  /** Dimensions.get('window').height（键盘弹起时会被 adjustResize 压缩） */
  windowHeight: number;
  /** StatusBar.currentHeight（Android） */
  statusBarHeight: number;
  /** 软键盘是否可见 */
  keyboardVisible: boolean;
}

export function computeBottomSystemInset(input: BottomInsetInput): number {
  const insets = Math.max(0, input.insetsBottom || 0);

  // iOS / Web：safe-area-context 已是真值（Home Indicator / 浏览器视口）
  if (input.platform !== 'android') return insets;

  // a. edge-to-edge 下 insets 就是导航栏真值
  if (insets > 0) return insets;

  // b. 键盘可见：screen−window 里混入了键盘高度，绝不能用
  if (input.keyboardVisible) return 0;

  // c. OEM 漏报 inset 时的兜底，限制在合理量级内
  const measured = input.screenHeight - input.windowHeight - input.statusBarHeight;
  if (measured > 0 && measured <= NAV_BAR_PLAUSIBLE_MAX) return measured;

  // d. 不猜
  return 0;
}
