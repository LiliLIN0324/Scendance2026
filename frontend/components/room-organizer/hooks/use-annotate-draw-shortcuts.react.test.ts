// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningEditMode } from '@/lib/outdoor-plan-tokens';
import type { PlanShapeKind } from '../lib/site-plan-annotate';
import { useAnnotateDrawShortcuts } from './use-annotate-draw-shortcuts';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function setup() {
  let mode: PlanningEditMode = 'view';
  let shape: PlanShapeKind = 'rect';
  const onNote = vi.fn(() => { mode = 'note'; });
  const onShape = vi.fn((kind: PlanShapeKind) => { mode = 'shape'; shape = kind; });
  const onReveal = vi.fn();
  renderHook(() => useAnnotateDrawShortcuts({
    enabled: true,
    getMode: () => mode,
    getShape: () => shape,
    onNote,
    onShape,
    onReveal,
  }));
  return {
    onNote,
    onShape,
    onReveal,
    setMode: (next: PlanningEditMode) => { mode = next; },
    setShape: (next: PlanShapeKind) => { shape = next; },
  };
}

describe('useAnnotateDrawShortcuts', () => {
  it('selects each of the five tools and reveals the toolbar', () => {
    const { onNote, onShape, onReveal } = setup();
    expect(press(window, 't').defaultPrevented).toBe(true);
    expect(press(window, 'r').defaultPrevented).toBe(true);
    expect(press(window, 'O').defaultPrevented).toBe(true);
    expect(press(window, 'y').defaultPrevented).toBe(true);
    expect(press(window, 'L').defaultPrevented).toBe(true);
    expect(onNote).toHaveBeenCalledTimes(1);
    expect(onShape.mock.calls.map(call => call[0])).toEqual(['rect', 'circle', 'triangle', 'line']);
    expect(onReveal).toHaveBeenCalledTimes(5);
  });

  it('does not restart a draft when the same tool is pressed again', () => {
    const { onNote, onShape, onReveal, setMode, setShape } = setup();
    setMode('shape');
    setShape('circle');
    press(window, 'o');
    setMode('note');
    press(window, 'T');
    expect(onShape).not.toHaveBeenCalled();
    expect(onNote).not.toHaveBeenCalled();
    expect(onReveal).toHaveBeenCalledTimes(2);
  });

  it('leaves facility rotation, chords, and text fields alone', () => {
    const { onNote, onShape, setMode } = setup();
    setMode('facility');
    expect(press(window, 'r').defaultPrevented).toBe(false);
    expect(press(window, 't', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(window, 'R', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(window, 'o', { metaKey: true }).defaultPrevented).toBe(false);
    expect(press(window, 'l', { altKey: true }).defaultPrevented).toBe(false);

    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.append(input, area, select, editable);
    press(input, 't');
    press(area, 'r');
    press(select, 'o');
    press(editable, 'y');
    expect(onNote).not.toHaveBeenCalled();
    expect(onShape).not.toHaveBeenCalled();
  });

  it('stays quiet when the canvas is read-only', () => {
    const onNote = vi.fn();
    const onShape = vi.fn();
    renderHook(() => useAnnotateDrawShortcuts({
      enabled: false,
      getMode: () => 'view',
      getShape: () => 'rect',
      onNote,
      onShape,
      onReveal: vi.fn(),
    }));
    expect(press(window, 't').defaultPrevented).toBe(false);
    expect(onNote).not.toHaveBeenCalled();
    expect(onShape).not.toHaveBeenCalled();
  });

  it('is wired to the canvas mode switch, beside the existing hand and select keys', () => {
    const src = readFileSync(join(process.cwd(), 'components/room-organizer/components/outdoor-plan-canvas.tsx'), 'utf8');
    const hookAt = src.indexOf('useAnnotateDrawShortcuts(');
    const handAt = src.indexOf("event.key === 'h' || event.key === 'H'");
    expect(hookAt).toBeGreaterThan(handAt);
    const call = src.slice(hookAt, hookAt + 500);
    expect(call).toContain("setMode('note')");
    expect(call).toContain("setMode('shape')");
    expect(call).toContain('setAnnotateShape(kind)');
    expect(call).toContain("setInspectorPanel('annotate', true)");
    expect(src).toContain('annotateDrawSelectionLabel(mode, annotateShape)');
  });
});
