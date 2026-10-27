// useTabClearance.ts
// 贴底通栏 Tab 栏的几何常量（全项目唯一来源） + 页面底部避让高度。
//
// 组成（参照 design/reference/home-day.png / home-night.png 定稿）：
//   栏身 58 + 设备底部安全区（⚠ 唯一来源 = useBottomSystemInset：手势条 0-34 / 安卓三键导航实测 ~48；
//     与 App.tsx 外壳高度、NavBarScrim 遮罩高度是同一个数，只算一次）。
//   中央「+」圆钮 52（= 2 × 凹槽半径 26）坐在栏顶上边缘的凹槽里，顶上只露出 6.37。
// 目标：滚到底时最后一项完整露在栏上方，又不留空白。
//
// ⚠ 这组常量被三处消费，改一处必须全部同步：
//   1. App.tsx 的外壳几何（栏身 / 凹槽 / 圆钮位置）
//   2. 本文件的 useTabClearance（各页面滚动容器的底部 padding）
//   3. TabBarAutoHideContext 的收起距离（tabBarHideOffset）

import { useBottomSystemInset } from './useBottomSystemInset';

/** 栏身内容高度（不含底部安全区）——58：图标 20 + 间距 + 11pt 标签，上下留白比浮空胶囊时代更足 */
export const TAB_BAR_HEIGHT = 58;
/** 栏底距安全区上沿的缝隙：贴底通栏（底板铺到屏幕底边），恒为 0 */
export const TAB_BAR_GAP = 0;
/** 中央凹槽半径（底板坐标，与 NotchTabBar.tsx 的 notchR 同一个数） */
export const TAB_BAR_NOTCH_R = 26;
/** 圆钮与凹槽之间的缝宽（底板路径里的 notchGap） */
export const TAB_BAR_NOTCH_GAP = 6;
/**
 * 圆钮圆心落在栏顶上边缘下方的深度系数：cy = notchR × 该值。
 * ⚠ 必须与 NotchTabBar.tsx 的 BUTTON_DROP_RATIO 完全一致：那边画凹槽、这边摆圆钮，
 * 不同步就会露出忽宽忽窄的缝。
 */
export const TAB_CENTER_BUTTON_DROP_RATIO = 0.755;
/** 圆钮圆心相对栏顶上边缘的深度（26 × 0.755 = 19.63） */
export const TAB_CENTER_BUTTON_CY = TAB_BAR_NOTCH_R * TAB_CENTER_BUTTON_DROP_RATIO;
/** 中央「+」圆钮直径 = 2 × 凹槽半径（52） */
export const TAB_CENTER_BUTTON_SIZE = TAB_BAR_NOTCH_R * 2;
/** 圆钮顶部露出栏顶上边缘的高度（半径 26 − 圆心深度 19.63 = 6.37）：外壳要额外高这么多 */
export const TAB_BAR_RAISE = TAB_CENTER_BUTTON_SIZE / 2 - TAB_CENTER_BUTTON_CY;
/** 外壳在栏身之上再加的触摸余量——圆钮整圆已在栏身 + 凸起之内，无需余量 */
export const TAB_BAR_SHELL_PAD = 0;
/** 外壳完整高度（不含底部安全区）= 栏身 58 + 凸起 6.37 */
export const TAB_BAR_SHELL_HEIGHT = TAB_BAR_HEIGHT + TAB_BAR_RAISE + TAB_BAR_SHELL_PAD;

/**
 * 收起（滑出屏幕）需要的位移：外壳完整高度 + 距底 + 安全区 —— 整栏连圆钮一起滑出；
 * 末尾 +4 抵消亚像素舍入，避免屏底残留一条缝。TabBarAutoHideContext 用它，不再写死 60。
 */
export function tabBarHideOffset(insetsBottom: number): number {
  return TAB_BAR_SHELL_HEIGHT + TAB_BAR_GAP + insetsBottom + 4;
}

/**
 * 页面滚动容器统一的底部留白：滚到底时最后一项完整露在 Tab 栏上方。
 *
 * ⚠ 底部 inset 必须与 App.tsx 外壳的栏身高度（TAB_BAR_HEIGHT + <同一个值>）同源，
 * 所以这里用 useBottomSystemInset（= max(insets.bottom, 安卓实测导航条)）而不是裸 insets.bottom：
 * - 手势导航 / iOS Home Indicator / web：两者相等；
 * - 安卓三键导航且 insets.bottom 报 0（Expo Go / 部分 OEM）：栏身变矮了而补白没涨，
 *   最后一项会被栏身盖住——同源后一起涨，比例始终是「栏身占多高，内容就留多少」。
 *
 * 贴底通栏后栏身 58 已经把底部安全区算在栏身之外（栏身铺到屏幕底边），
 * 所以公式与改造前完全一样，只是 TAB_BAR_HEIGHT 从 48 变成 58。
 */
export function useTabClearance(): number {
  const bottomInset = useBottomSystemInset();
  return TAB_BAR_HEIGHT + TAB_BAR_GAP + bottomInset;
}
