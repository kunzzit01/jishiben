// 分类添加表单的公共常量：选择类别页（AddTransactionScreen 内联添加）与类别分类页
// （CategoryManagementScreen 内联添加）共用，避免两份图标/颜色池漂移。
// 图标名全部是 Ionicons 有效名（改前先跑 glyphmap 校验，防止 pills-outline 那类警告复发）。
// TASK-008：图标池扩到 75 个、颜色池扩到 16 色（验收标准）。
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export type CategoryIconName = ComponentProps<typeof Ionicons>['name'];

const RAW_ICON_OPTIONS: CategoryIconName[] = [
  // 餐饮饮品
  'restaurant-outline', 'fast-food-outline', 'nutrition-outline', 'leaf-outline', 'ice-cream-outline', 'wine-outline', 'cafe-outline', 'pint-outline', 'beer-outline', 'pizza-outline',
  // 购物日用
  'bag-handle-outline', 'basket-outline', 'cart-outline', 'shirt-outline', 'sparkles-outline', 'cube-outline', 'pricetag-outline', 'diamond-outline', 'gift-outline',
  // 居住家装
  'home-outline', 'bed-outline', 'build-outline', 'construct-outline', 'hammer-outline', 'brush-outline', 'color-palette-outline', 'color-filter-outline', 'color-wand-outline',
  // 交通出行
  'car-outline', 'car-sport-outline', 'airplane-outline', 'bus-outline', 'train-outline', 'boat-outline', 'bicycle-outline', 'speedometer-outline', 'location-outline', 'map-outline', 'compass-outline', 'earth-outline', 'flag-outline', 'navigate-outline',
  // 通讯电子
  'call-outline', 'phone-portrait-outline', 'watch-outline', 'laptop-outline', 'desktop-outline', 'hardware-chip-outline', 'tv-outline', 'radio-outline', 'headset-outline', 'print-outline', 'save-outline', 'server-outline', 'bluetooth-outline', 'wifi-outline',
  // 健康运动
  'medkit-outline', 'fitness-outline', 'barbell-outline', 'basketball-outline', 'football-outline', 'pulse-outline', 'thermometer-outline', 'bandage-outline', 'body-outline', 'accessibility-outline',
  // 学习工作
  'book-outline', 'school-outline', 'library-outline', 'newspaper-outline', 'bookmark-outline', 'briefcase-outline', 'clipboard-outline', 'document-text-outline', 'folder-open-outline', 'archive-outline', 'terminal-outline', 'code-slash-outline', 'key-outline', 'lock-closed-outline', 'shield-checkmark-outline',
  // 娱乐社交
  'game-controller-outline', 'dice-outline', 'extension-puzzle-outline', 'film-outline', 'musical-notes-outline', 'mic-outline', 'videocam-outline', 'camera-outline', 'image-outline', 'images-outline', 'aperture-outline', 'happy-outline', 'people-outline', 'balloon-outline',
  // 财务自然
  'cash-outline', 'wallet-outline', 'card-outline', 'logo-bitcoin', 'trending-up-outline', 'stats-chart-outline', 'pie-chart-outline', 'bar-chart-outline', 'paw-outline', 'fish-outline', 'flower-outline', 'rose-outline', 'sunny-outline', 'moon-outline', 'partly-sunny-outline', 'water-outline', 'planet-outline', 'star-outline', 'heart-outline', 'snow-outline', 'time-outline', 'calendar-outline', 'alarm-outline', 'stopwatch-outline',
];

/**
 * 对外暴露的图标清单：按本机 Ionicons 的 glyphMap 过滤一次。
 * 为什么：清单里混入过本版本没有的字形名（'extension-puzzle-outline' 之类），
 * <Ionicons name=未知名> 会画成 .notdef 豆腐块（截图里的乱码方块），过滤后只剩真实可画的图标。
 */
const IONICON_GLYPHS = Ionicons.glyphMap as unknown as Record<string, number | undefined>;

export const CATEGORY_ICON_OPTIONS: CategoryIconName[] = RAW_ICON_OPTIONS.filter(
  (name) => IONICON_GLYPHS[name] != null
);

export const CATEGORY_COLOR_OPTIONS = [
  '#FF7A5C', // 珊瑚橙
  '#EF5350', // 红
  '#F06292', // 玫红
  '#EC407A', // 桃粉
  '#FF9F43', // 橙
  '#FFA726', // 杏橙
  '#F9A825', // 金黄
  '#FFEB3B', // 柠檬黄
  '#8BC34A', // 草绿
  '#66BB6A', // 绿
  '#26A69A', // 青绿
  '#26C6DA', // 青
  '#29B6F6', // 天蓝
  '#4C9AFF', // 蓝
  '#5C6BC0', // 靛蓝
  '#AB47BC', // 紫
];
