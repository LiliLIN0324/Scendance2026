import { describe, expect, it } from 'vitest';
import {
  ANNOTATE_DRAW_SHORTCUT,
  annotateDrawSelectionLabel,
  annotateDrawToolFromKey,
  resolveAnnotateDrawShortcut,
  resolveAnnotateDrawToolClick,
  type AnnotateDrawToolId,
} from './annotate-draw-shortcuts';
import type { PlanShapeKind } from './site-plan-annotate';

const base = {
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  typing: false,
  mode: 'view' as const,
  shape: 'rect' as PlanShapeKind,
};

describe('annotate draw shortcuts', () => {
  it('maps the five Figma-style keys and no hand, select, or walk keys', () => {
    expect(annotateDrawToolFromKey('t')).toBe('note');
    expect(annotateDrawToolFromKey('T')).toBe('note');
    expect(annotateDrawToolFromKey('r')).toBe('rect');
    expect(annotateDrawToolFromKey('O')).toBe('circle');
    expect(annotateDrawToolFromKey('y')).toBe('triangle');
    expect(annotateDrawToolFromKey('L')).toBe('line');
    expect(annotateDrawToolFromKey('h')).toBeNull();
    expect(annotateDrawToolFromKey('s')).toBeNull();
    expect(annotateDrawToolFromKey('w')).toBeNull();
    expect(annotateDrawToolFromKey('a')).toBeNull();
    expect(annotateDrawToolFromKey('d')).toBeNull();
    expect(annotateDrawToolFromKey('Enter')).toBeNull();
    const tools: AnnotateDrawToolId[] = ['note', 'rect', 'circle', 'triangle', 'line'];
    expect(Object.keys(ANNOTATE_DRAW_SHORTCUT).sort()).toEqual([...tools].sort());
    expect(new Set(Object.values(ANNOTATE_DRAW_SHORTCUT)).size).toBe(5);
  });

  it('selects a tool, keeps the in-progress draft on the same key, and yields R while placing a facility', () => {
    expect(resolveAnnotateDrawShortcut({ ...base, key: 't' })).toEqual({ action: 'select', tool: 'note', keepDraft: false });
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'R' })).toEqual({ action: 'select', tool: 'rect', keepDraft: false });
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'o', mode: 'shape', shape: 'rect' })).toEqual({
      action: 'select', tool: 'circle', keepDraft: false,
    });
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'y', mode: 'note' })).toEqual({
      action: 'select', tool: 'triangle', keepDraft: false,
    });
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'l', mode: 'shape', shape: 'line' })).toEqual({
      action: 'select', tool: 'line', keepDraft: true,
    });
    expect(resolveAnnotateDrawShortcut({ ...base, key: 't', mode: 'note' })).toEqual({
      action: 'select', tool: 'note', keepDraft: true,
    });
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'r', mode: 'facility' }).action).toBe('ignore');
    expect(resolveAnnotateDrawShortcut({ ...base, key: 't', mode: 'facility' })).toEqual({
      action: 'select', tool: 'note', keepDraft: false,
    });
  });

  it('ignores chords, shift, and typing so reload, rotate, and text entry keep their keys', () => {
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'r', ctrlKey: true }).action).toBe('ignore');
    expect(resolveAnnotateDrawShortcut({ ...base, key: 't', metaKey: true }).action).toBe('ignore');
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'o', altKey: true }).action).toBe('ignore');
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'R', shiftKey: true }).action).toBe('ignore');
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'l', typing: true }).action).toBe('ignore');
    expect(resolveAnnotateDrawShortcut({ ...base, key: 'h' }).action).toBe('ignore');
  });

  it('exits when the active tool button is clicked again, but selects a different tool', () => {
    expect(resolveAnnotateDrawToolClick({ tool: 'note', mode: 'note', shape: 'rect' })).toBe('exit');
    expect(resolveAnnotateDrawToolClick({ tool: 'rect', mode: 'shape', shape: 'rect' })).toBe('exit');
    expect(resolveAnnotateDrawToolClick({ tool: 'circle', mode: 'shape', shape: 'rect' })).toBe('select');
    expect(resolveAnnotateDrawToolClick({ tool: 'rect', mode: 'view', shape: 'rect' })).toBe('select');
    expect(resolveAnnotateDrawToolClick({ tool: 'note', mode: 'shape', shape: 'line' })).toBe('select');
  });

  it('names the selected draw tool for the canvas chip', () => {
    expect(annotateDrawSelectionLabel('note', 'rect')).toBe('文本 T');
    expect(annotateDrawSelectionLabel('shape', 'circle')).toBe('圆形 O');
    expect(annotateDrawSelectionLabel('shape', 'triangle')).toBe('三角形 Y');
    expect(annotateDrawSelectionLabel('shape', 'line')).toBe('线段 L');
    expect(annotateDrawSelectionLabel('shape', 'rect')).toBe('矩形 R');
    expect(annotateDrawSelectionLabel('view', 'rect')).toBeNull();
    expect(annotateDrawSelectionLabel('facility', 'rect')).toBeNull();
  });
});
