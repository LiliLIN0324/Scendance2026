// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePlanAnnotations } from './use-plan-annotations';

describe('use-plan-annotations — 结论失效计数器 revision', () => {
  it('初始 revision 为 0，draft 为 null', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    expect(result.current.revision).toBe(0);
    expect(result.current.draft).toBeNull();
  });

  it('startDraft / addZoneRects / addAnnotationFromPoints 都 bump revision', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    const r0 = result.current.revision;

    act(() => result.current.startDraft());
    expect(result.current.revision).toBe(r0 + 1);

    const r1 = result.current.revision;
    act(() =>
      result.current.addZoneRects([
        {
          zoneType: 'checkin',
          label: '签到区',
          rect: { x: 0, z: 3, width: 3, depth: 2 },
        },
        {
          zoneType: 'rest',
          label: '休息区',
          rect: { x: 0, z: -3, width: 4, depth: 3 },
        },
      ]),
    );
    expect(result.current.revision).toBe(r1 + 1);
    expect(result.current.annotations).toHaveLength(2);

    const r2 = result.current.revision;
    act(() =>
      result.current.addAnnotationFromPoints(
        [{ x: -1, z: -1 }, { x: 1, z: 1 }],
        'measure',
        '测距',
      ),
    );
    expect(result.current.revision).toBe(r2 + 1);
    expect(result.current.annotations).toHaveLength(3);
  });

  it('TOGGLE_VISIBLE / SET_DRAW_MODE 是 UI 偏好，不 bump revision', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.startDraft());
    const r0 = result.current.revision;

    act(() => result.current.toggleVisible());
    expect(result.current.revision).toBe(r0);

    act(() => result.current.setDrawMode('zone'));
    expect(result.current.revision).toBe(r0);

    act(() => result.current.setDrawMode('off'));
    expect(result.current.revision).toBe(r0);
  });

  it('CLEAR_DRAFT 也 bump revision（旧标注结论一并失效）', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.startDraft());
    act(() =>
      result.current.addZoneRects([
        { zoneType: 'checkin', label: '签到区', rect: { x: 0, z: 3, width: 3, depth: 2 } },
      ]),
    );
    const r0 = result.current.revision;

    act(() => result.current.clearDraft());
    expect(result.current.revision).toBe(r0 + 1);
    expect(result.current.draft).toBeNull();
  });
});
