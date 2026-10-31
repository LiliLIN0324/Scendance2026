// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { mergeLayoutLaneSnapshot } from '../lib/layout-lanes';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useLayoutHistory } from './use-layout-history';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';
import type { RoomLayout } from '../lib/types';

const operations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{
  id: 'a1000000-0000-4000-8000-000000000001', title: '布场', phase: 'setup', objectIds: ['item-1'],
  ownerName: '现场团队', acceptance: '位置核对', status: 'accepted', evidenceNote: '现场核对通过',
  actualStartedAt: '2026-10-09T09:00:00+08:00', actualFinishedAt: '2026-10-09T09:30:00+08:00',
  reviewedBasis: `sha256:${'a'.repeat(64)}`,
}] });

function mount(initial: RoomLayout) {
  layoutStore.setState({ layout: initial, activeFloorIndex: 0 });
  return renderHook(() => {
    const state = useLayoutState();
    const history = useLayoutHistory(
      state.layout,
      (entry) => state.actions.applyLayout(mergeLayoutLaneSnapshot(layoutStore.getState().layout, entry)),
      { debounceMs: 10 }
    );
    return { ...state, history };
  });
}

describe('useLayoutHistory — scene and business documents are separate lanes', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  });

  it('undoing a move keeps the production plan and event operations', () => {
    const initial = makeLayout({ id: 'lanes-1', floors: [makeFloor({ items: [makeItem()] })] });
    const { result } = mount(initial);

    act(() => result.current.actions.moveItem('item-1', 2, 1));
    act(() => { vi.advanceTimersByTime(10); });
    act(() => result.current.history.commitNow());
    act(() => result.current.actions.setEventOperations(operations));
    act(() => { vi.advanceTimersByTime(10); });

    expect(layoutStore.getState().layout.eventOperations).toEqual(operations);

    act(() => result.current.history.undo());
    expect(layoutStore.getState().layout.eventOperations).toBeUndefined();
    expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({ x: 2, z: 1 });

    act(() => result.current.history.redo());
    expect(layoutStore.getState().layout.eventOperations).toEqual(operations);
    expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({ x: 2, z: 1 });
  });

  it('undoing a document edit keeps the geometry', () => {
    const initial = makeLayout({ id: 'lanes-2', floors: [makeFloor({ items: [makeItem()] })] });
    const { result } = mount(initial);

    act(() => result.current.actions.moveItem('item-1', 2, 1));
    act(() => { vi.advanceTimersByTime(10); });
    act(() => result.current.history.commitNow());
    act(() => result.current.actions.setEventOperations(operations));
    act(() => { vi.advanceTimersByTime(10); });

    act(() => result.current.history.undo());
    expect(layoutStore.getState().layout.eventOperations).toBeUndefined();
    expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({ x: 2, z: 1 });

    act(() => result.current.history.undo());
    expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({ x: 0, z: 0 });

    act(() => result.current.history.redo());
    expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({ x: 2, z: 1 });
  });

  it('applying an AI scene is one undo step and never rolls back business documents', () => {
    const initial = makeLayout({ id: 'lanes-3', floors: [makeFloor({ items: [makeItem()] })] });
    const { result } = mount(initial);

    act(() => result.current.history.commitNow());
    act(() => result.current.actions.setEventOperations(operations));
    act(() => { vi.advanceTimersByTime(10); });

    const proposal = makeLayout({ id: 'lanes-3', name: 'AI 方案', width: 12, floors: [makeFloor({ items: [] })] });
    act(() => result.current.history.commitNow());
    act(() => result.current.actions.applySceneLayout(proposal));
    act(() => { vi.advanceTimersByTime(10); });

    expect(layoutStore.getState().layout.name).toBe('AI 方案');
    expect(layoutStore.getState().layout.eventOperations).toEqual(operations);

    act(() => result.current.history.undo());
    expect(layoutStore.getState().layout.name).toBe('My Home');
    expect(layoutStore.getState().layout.eventOperations).toEqual(operations);

    act(() => result.current.history.undo());
    expect(layoutStore.getState().layout.eventOperations).toBeUndefined();
  });

  it('truncateTo drops the placement session from history', () => {
    const initial = makeLayout({ id: 'lanes-4', floors: [makeFloor({ items: [makeItem()] })] });
    const { result } = mount(initial);

    act(() => result.current.history.commitNow());
    act(() => result.current.actions.moveItem('item-1', 2, 1));
    act(() => { vi.advanceTimersByTime(10); });

    act(() => result.current.history.truncateTo(initial));
    act(() => result.current.actions.applyLayout(initial));

    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(false);
    expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({ x: 0, z: 0 });
  });
});
