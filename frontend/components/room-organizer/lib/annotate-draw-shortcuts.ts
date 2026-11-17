/**
 * 2026-11-16 绘图五工具快捷键（Figma）：
 * T 文本、R 矩形、O 圆形、L 线段。
 * Figma 的多边形没有默认键（Shift+P 是铅笔），三角形用相邻且空闲的 Y，
 * 避开 H/S（浏览/选择）、WASD（漫游）和落位旋转的 R。
 * 选中态仍由工具条的 active / aria-pressed 表达；这里只决定按键该切到哪一个。
 */
import type { PlanningEditMode } from '@/lib/outdoor-plan-tokens';
import { planAnnotationKindLabels } from '../../../../supabase/functions/_shared/site-plan';
import type { PlanShapeKind } from './site-plan-annotate';

export type AnnotateDrawToolId = 'note' | PlanShapeKind;

export const ANNOTATE_DRAW_SHORTCUT: Record<AnnotateDrawToolId, string> = {
  note: 'T',
  rect: 'R',
  circle: 'O',
  triangle: 'Y',
  line: 'L',
};

const TOOL_BY_KEY: Record<string, AnnotateDrawToolId> = {
  t: 'note',
  r: 'rect',
  o: 'circle',
  y: 'triangle',
  l: 'line',
};

export function annotateDrawToolFromKey(key: string): AnnotateDrawToolId | null {
  if (key.length !== 1) return null;
  return TOOL_BY_KEY[key.toLowerCase()] ?? null;
}

export type AnnotateDrawShortcutResolution =
  | { action: 'ignore' }
  | { action: 'select'; tool: AnnotateDrawToolId; keepDraft: boolean };

export function resolveAnnotateDrawShortcut(input: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  typing: boolean;
  mode: PlanningEditMode;
  shape: PlanShapeKind;
}): AnnotateDrawShortcutResolution {
  if (input.typing || input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) {
    return { action: 'ignore' };
  }
  const tool = annotateDrawToolFromKey(input.key);
  if (!tool) return { action: 'ignore' };
  // 设施还没放下时 R / Shift+R 负责旋转，矩形快捷键让开。
  if (tool === 'rect' && input.mode === 'facility') return { action: 'ignore' };
  const keepDraft = tool === 'note'
    ? input.mode === 'note'
    : input.mode === 'shape' && input.shape === tool;
  return { action: 'select', tool, keepDraft };
}

/**
 * 2026-11-17 用户：再点当前工具按钮 = 退出回浏览（Figma / Keynote 的开关手感）。
 * 键盘按同一个键仍保持 keepDraft，避免连按或输入法误清半成品；键盘退出走 Esc。
 */
export function resolveAnnotateDrawToolClick(input: {
  tool: AnnotateDrawToolId;
  mode: PlanningEditMode;
  shape: PlanShapeKind;
}): 'exit' | 'select' {
  if (input.tool === 'note') return input.mode === 'note' ? 'exit' : 'select';
  return input.mode === 'shape' && input.shape === input.tool ? 'exit' : 'select';
}

/** 画布模式条上的当前绘图工具。其它模式返回 null，沿用原模式文案。 */
export function annotateDrawSelectionLabel(mode: PlanningEditMode, shape: PlanShapeKind): string | null {
  if (mode === 'note') return `${planAnnotationKindLabels.note} ${ANNOTATE_DRAW_SHORTCUT.note}`;
  if (mode === 'shape') return `${planAnnotationKindLabels[shape]} ${ANNOTATE_DRAW_SHORTCUT[shape]}`;
  return null;
}
