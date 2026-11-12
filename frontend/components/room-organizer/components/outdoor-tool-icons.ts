/**
 * 户外右轨三枚工具钮 + 对应卡片卡头的**统一图标口径**（2026-11-12 用户要求「图标统一」）。
 *
 * 之前一套用 Material Symbols（右轨圆钮：square_foot / edit_note / tune），
 * 一套用自绘 lucide 风格（卡头：ruler / sticky-note / sliders-horizontal），
 * 同一个功能两个样子。现在统一到 Material Symbols，右轨与卡头共用这里的名字。
 */
export type OutdoorToolKey = 'measure' | 'annotate' | 'selection';

export const OUTDOOR_TOOL_ICONS: Record<OutdoorToolKey, string> = {
  measure: 'straighten',
  annotate: 'edit_note',
  selection: 'tune',
};