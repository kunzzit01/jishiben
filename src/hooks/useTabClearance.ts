// useTabClearance.ts
// 浮空 Tab 栏的几何常量（全项目唯一来源） + 页面底部避让高度。
//
// 组成（V2.4 定稿：贴底版 + 薄胶囊）：
//   栏身 48（胶囊，全圆角）+ 栏底距安全区上沿的缝隙 0（栏下沿紧贴系统导航栏，0dp 不留白）
//   + 设备底部安全区（⚠ 唯一来源 = useBottomSystemInset：手势条 0-34 / 安卓三键导航实测 ~48；
//     与 App.tsx 外壳的 bottom 偏移、NavBarScrim 遮罩高度是同一个数，只算一次）。
//   中央「+」58 圆**凸出栏顶 13**（圆钮顶与外壳顶齐平），外壳高度 = 栏身 + 凸起。
// 目标：滚到底时最后一项完整露在栏上方，又不留空白。
//
// ⚠ 这组常量被三处消费，改一处必须全部同步：
//   1. App.tsx 的外壳几何（栏身 / 圆钮位置 / 外壳高度）
//   2. 本文件的 useTabClearance（各页面滚动容器的底部 padding）
//   3. TabBarAutoHideContext 的收起距离（tabBarHideOffset）

import { useBottomSystemInset } from './useBottomSystemInset';

/** 栏身高度（App.tsx 外壳与 react-navigation 内层栏共用同一个值）——V2.4：48 = 内容 33 + 上下各 7.5 */
export const TAB_BAR_HEIGHT = 48;
/** 栏底距安全区上沿的缝隙（V2.2：贴底，0 = 下沿紧贴系统导航栏上方） */
export const TAB_BAR_GAP = 0;
/** 中央「+」圆钮凸出栏顶的高度（V2.4：23 → 13，圆钮整体再下移 10） */
export const TAB_BAR_RAISE = 13;
/** 外壳在栏身之上再加的触摸余量——圆钮已在栏内，无需余量 */
export const TAB_BAR_SHELL_PAD = 0;
/** 外壳完整高度（= 栏身 + 凸起 + 触摸余量）：App.tsx 用它当外壳高度 */
export const TAB_BAR_SHELL_HEIGHT = TAB_BAR_HEIGHT + TAB_BAR_RAISE + TAB_BAR_SHELL_PAD;
/** 中央「+」圆钮直径（58pt，V3 参考稿） */
export const TAB_CENTER_BUTTON_SIZE = 58;
/** 中央圆钮底边距外壳底边（V2.4：圆钮顶与外壳顶齐平，底边距 = 外壳高 − 圆径 = 3） */
export const TAB_CENTER_BUTTON_BOTTOM = TAB_BAR_SHELL_HEIGHT - TAB_CENTER_BUTTON_SIZE;

/**
 * 收起（滑出屏幕）需要的位移：外壳完整高度 + 距底 + 安全区 —— 整栏一起滑出；
 * 末尾 +4 抵消亚像素舍入，避免屏底残留一条缝。TabBarAutoHideContext 用它，不再写死 60。
 */
export function tabBarHideOffset(insetsBottom: number): number {
  return TAB_BAR_SHELL_HEIGHT + TAB_BAR_GAP + insetsBottom + 4;
}

/**
 * 页面滚动容器统一的底部留白：滚到底时最后一项完整露在 Tab 栏上方。
 *
 * ⚠ 底部 inset 必须与 App.tsx 外壳的 `bottom: TAB_BAR_GAP + <同一个值>` 同源，
 * 所以这里用 useBottomSystemInset（= max(insets.bottom, 安卓实测导航条)）而不是裸 insets.bottom：
 * - 手势导航 / iOS Home Indicator / web：两者相等，数值与改动前完全一致；
 * - 安卓三键导航且 insets.bottom 报 0（Expo Go / 部分 OEM）：栏身上移了而补白没涨，
 *   最后一项会被栏身盖住——同源后一起涨，比例始终是「栏身上沿高出屏幕底 edge 多少，内容就留多少」。
 */
export function useTabClearance(): number {
  const bottomInset = useBottomSystemInset();
  return TAB_BAR_HEIGHT + TAB_BAR_GAP + bottomInset;
}
