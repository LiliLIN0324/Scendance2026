import { describe, expect, it } from 'vitest';
import { applyOutdoorInspectorPanel, type OutdoorInspectorPanels } from './outdoor-inspector-panels';

const closed: OutdoorInspectorPanels = { measure: false, annotate: false, selection: false };

describe('applyOutdoorInspectorPanel', () => {
  it('opening 标注 closes 测量', () => {
    expect(applyOutdoorInspectorPanel({ ...closed, measure: true }, 'annotate', true)).toEqual({
      measure: false,
      annotate: true,
      selection: false,
    });
  });

  it('opening 测量 closes 标注', () => {
    expect(applyOutdoorInspectorPanel({ ...closed, annotate: true }, 'measure', true)).toEqual({
      measure: true,
      annotate: false,
      selection: false,
    });
  });

  it('属性卡不影响当前绘制工具卡', () => {
    const state = { ...closed, annotate: true };
    expect(applyOutdoorInspectorPanel(state, 'selection', true)).toEqual({ ...state, selection: true });
  });

  it('closing one card leaves the other card alone', () => {
    const state = { measure: true, annotate: false, selection: true };
    expect(applyOutdoorInspectorPanel(state, 'selection', false)).toEqual({ measure: true, annotate: false, selection: false });
  });

  it('returns the same object when nothing changes', () => {
    const state = { ...closed, annotate: true };
    expect(applyOutdoorInspectorPanel(state, 'annotate', true)).toBe(state);
    expect(applyOutdoorInspectorPanel(state, 'measure', false)).toBe(state);
  });
});
