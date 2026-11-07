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

describe('use-plan-annotations — addDoorAnnotation（真门绘制）', () => {
  it('落一扇真门：kind=door、inferred 缺省、默认宽 0.9m，且 bump revision', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.startDraft());
    const r0 = result.current.revision;

    act(() => result.current.addDoorAnnotation({ wall: 'east', position: 1.5 }));
    expect(result.current.revision).toBe(r0 + 1);
    expect(result.current.annotations).toHaveLength(1);
    const door = result.current.annotations[0]!;
    expect(door.kind).toBe('door');
    expect(door.geometry).toEqual({ kind: 'door', wall: 'east', position: 1.5, widthM: 0.9 });
    expect((door.geometry as { inferred?: boolean }).inferred).toBeUndefined();
    // 评分层 verified 的判据：kind=door 且 !inferred（plan-scoring 真门过滤）。
    expect(door.kind === 'door' && !(door.geometry as { inferred?: boolean }).inferred).toBe(true);
  });

  it('没有 draft 时也能直接落（reducer 自动补空草案，同 ADD_ANNOTATION 语义）', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    expect(result.current.draft).toBeNull();
    act(() => result.current.addDoorAnnotation({ wall: 'south', position: -2 }));
    expect(result.current.draft).not.toBeNull();
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0]!.geometry).toMatchObject({ kind: 'door', wall: 'south', position: -2 });
  });

  it('widthM 可覆盖默认值', () => {
    const { result } = renderHook(() => usePlanAnnotations());
    act(() => result.current.addDoorAnnotation({ wall: 'north', position: 0, widthM: 1.5 }));
    expect(result.current.annotations[0]!.geometry).toMatchObject({ kind: 'door', widthM: 1.5 });
  });
});
