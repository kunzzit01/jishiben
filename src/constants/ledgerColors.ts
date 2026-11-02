// ledgerColors.ts
// 账本色板与默认图标（从 LedgerScreen 搬出来）：开设账本页与「账本编辑」面板必须用同一套色，
// 两处各拷一份迟早会漂移成两张色表。

import { Ionicons } from '@expo/vector-icons';

export type LedgerIconName = keyof typeof Ionicons.glyphMap;

/** 图标选择行已移除：账本数据模型必须有 icon 字段，创建/编辑时统一用默认图标 */
export const LEDGER_DEFAULT_ICON: LedgerIconName = 'book-outline';

/** 预设 25 个账本颜色，固定 5 列 × 5 行：每行一个色系（蓝 / 橙红粉 / 紫 / 青绿 / 大地色） */
export const LEDGER_COLOR_OPTIONS = [
  '#4C9AFF', '#2F7BE0', '#1565C0', '#5C6BC0', '#7986CB',
  '#FF7A5C', '#FF9F43', '#F4511E', '#EF5DA8', '#FF6F91',
  '#B983FF', '#9575CD', '#6A1B9A', '#BA68C8', '#CE93D8',
  '#26C6DA', '#66BB6A', '#4DB6AC', '#81C784', '#558B2F',
  '#F9A825', '#8D6E63', '#A1887F', '#FFB300', '#795548',
];
