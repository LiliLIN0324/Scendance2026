// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCatalogItem } from '../lib/__testfixtures__/fixtures';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';
import { applyFacilityAction, type FacilityAction, type PlanActions } from '../lib/plan-facility-actions';
import { INITIAL_LAYOUT } from './layout-reducer';
import { useHistory } from './use-history';
import { armKeyboardPlacement, nextTileIndex, useKeyboardPlacement } from './use-keyboard-placement';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';
import type { LayoutActions } from './use-layout-state';
import type { PlanFacility, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { PlanEditResult } from '../lib/site-plan-editing';
import type { CatalogItem } from '../lib/types';

const HISTORY_DEBOUNCE_MS = 600;

function activeItems() {
  const { layout, activeFloorIndex } = layoutStore.getState();
  return layout.floors[activeFloorIndex]!.items;
}

// Mirrors the orchestrator: the store-backed layout/actions, the real
// snapshot history, a selection the HUD's onAdd sets right after the
// (wrapped) placement, and the real reducer.
function mount() {
  return renderHook(() => {
    const { layout, actions } = useLayoutState();
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const history = useHistory(layout, actions.applyLayout);
    const placement = useKeyboardPlacement({
      layout,
      selectedItemId,
      actions,
      history,
      selectOnly: setSelectedItemId,
      placeCatalogItem: (catalogItem, position) => actions.addCatalogItem(catalogItem, position),
    });
    const add = (armed: boolean): string => {
      if (armed) armKeyboardPlacement();
      const id = placement.placeCatalogItem(makeCatalogItem());
      if (id) setSelectedItemId(id);
      return id;
    };
    return { ...placement, add, selectedItemId, setSelectedItemId, actions, history, layout };
  });
}

describe('useKeyboardPlacement (#168)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    layoutStore.setState({ layout: { ...INITIAL_LAYOUT, id: 'house-test' }, activeFloorIndex: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const settleHistory = () => {
    act(() => {
      vi.advanceTimersByTime(HISTORY_DEBOUNCE_MS + 50);
    });
  };

  it('a plain (mouse) add stays locked and starts no session', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.add(false);
    });
    expect(activeItems().find((item) => item.id === id)?.locked).toBe(true);
    expect(result.current.placingId).toBeNull();
  });

  it('an armed add places the item unlocked, selected, and pending', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    expect(activeItems().find((item) => item.id === id)?.locked).toBe(false);
    expect(result.current.selectedItemId).toBe(id);
    expect(result.current.placingId).toBe(id);
  });

  it('the arm flag is one-shot: it never leaks into the next add', async () => {
    const { result } = mount();
    // A tile whose add never reaches the wrapper (declined placement); the
    // browser drains microtasks before the next event can fire.
    armKeyboardPlacement();
    await Promise.resolve();
    let id = '';
    act(() => {
      id = result.current.add(false);
    });
    expect(activeItems().find((item) => item.id === id)?.locked).toBe(true);
    expect(result.current.placingId).toBeNull();
  });

  it('confirm locks the item in place (like drag release) and keeps it selected', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    act(() => {
      result.current.actions.moveItem(id, 1.5, -0.5);
    });
    act(() => {
      result.current.confirmPlacement();
    });
    const item = activeItems().find((entry) => entry.id === id);
    expect(item?.locked).toBe(true);
    expect(item?.position).toEqual({ x: 1.5, z: -0.5 });
    expect(result.current.placingId).toBeNull();
    expect(result.current.selectedItemId).toBe(id);
  });

  it('a quick place-nudge-cancel leaves nothing to undo or redo', () => {
    const { result } = mount();
    const before = layoutStore.getState().layout;
    act(() => {
      result.current.add(true);
    });
    act(() => {
      result.current.actions.moveItem(result.current.placingId!, 2, 2);
      result.current.actions.setRotation(result.current.placingId!, Math.PI / 2);
    });
    act(() => {
      result.current.cancelPlacement();
    });
    expect(layoutStore.getState().layout).toStrictEqual(before);
    expect(result.current.placingId).toBeNull();
    expect(result.current.selectedItemId).toBeNull();
    settleHistory();
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(false);
  });

  // #356: nudges committed as entries of their own used to survive the
  // cancel in the past stack, so Ctrl+Z resurrected the item.
  it('undo after place → nudge → nudge → Escape does not resurrect the item', () => {
    const { result } = mount();
    const before = layoutStore.getState().layout;
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    settleHistory();
    act(() => {
      result.current.actions.moveItem(id, 2, 2);
    });
    settleHistory();
    act(() => {
      result.current.actions.moveItem(id, 2.5, 2);
    });
    settleHistory();
    act(() => {
      result.current.cancelPlacement();
    });
    settleHistory();
    expect(activeItems().some((item) => item.id === id)).toBe(false);
    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(false);
    act(() => {
      result.current.history.undo();
    });
    act(() => {
      result.current.history.redo();
    });
    settleHistory();
    expect(activeItems().some((item) => item.id === id)).toBe(false);
    expect(layoutStore.getState().layout.floors).toStrictEqual(before.floors);
  });

  it('cancel keeps the history from before the session undoable', () => {
    const { result } = mount();
    act(() => {
      result.current.actions.setFloorColor('#abcdef');
    });
    settleHistory();
    const coloured = layoutStore.getState().layout;
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    settleHistory();
    act(() => {
      result.current.actions.moveItem(id, 2, 2);
    });
    settleHistory();
    act(() => {
      result.current.cancelPlacement();
    });
    settleHistory();
    expect(result.current.history.canUndo).toBe(true);
    act(() => {
      result.current.history.undo();
    });
    const { layout, activeFloorIndex } = layoutStore.getState();
    expect(layout.floors[activeFloorIndex]!.floorColor).not.toBe('#abcdef');
    expect(layout.floors[activeFloorIndex]!.items).toStrictEqual(coloured.floors[activeFloorIndex]!.items);
  });

  it('cancel still removes the item when later nudges committed as their own entries', () => {
    const { result } = mount();
    const countBefore = activeItems().length;
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    settleHistory();
    act(() => {
      result.current.actions.moveItem(id, 2, 2);
    });
    settleHistory();
    // An unrelated edit made mid-session must survive the cancel.
    act(() => {
      result.current.actions.setFloorColor('#123456');
    });
    act(() => {
      result.current.cancelPlacement();
    });
    const { layout, activeFloorIndex } = layoutStore.getState();
    expect(activeItems().length).toBe(countBefore);
    expect(activeItems().some((item) => item.id === id)).toBe(false);
    expect(layout.floors[activeFloorIndex]!.floorColor).toBe('#123456');
    expect(result.current.placingId).toBeNull();
    expect(result.current.selectedItemId).toBeNull();
  });

  it('ends the session when the pending item stops being the selection', () => {
    const { result } = mount();
    act(() => {
      result.current.add(true);
    });
    act(() => {
      result.current.setSelectedItemId(null);
    });
    expect(result.current.placingId).toBeNull();
  });

  it('ends the session when the pending item disappears from the layout', () => {
    const { result } = mount();
    let id = '';
    act(() => {
      id = result.current.add(true);
    });
    act(() => {
      result.current.actions.removeItem(id);
    });
    expect(result.current.placingId).toBeNull();
    // Nothing left to take out: cancel is a no-op rather than a stale restore.
    act(() => {
      result.current.cancelPlacement();
    });
    expect(activeItems().length).toBe(INITIAL_LAYOUT.floors[0]!.items.length);
  });
});

describe('useKeyboardPlacement — bound plan channel (B-2b)', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
    vi.useFakeTimers();
    layoutStore.setState({ layout: { ...INITIAL_LAYOUT, id: 'house-plan-test' }, activeFloorIndex: 0 });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function boundChannel() {
    let plan: SitePlanData = createStarterOutdoorPlan();
    const applyFacility = vi.fn((action: FacilityAction) => {
      const result = applyFacilityAction(plan, action);
      if (result.ok) plan = result.value;
      return result;
    });
    const planActions: PlanActions = {
      applyFacility,
      applyZone: () => ({
        ok: false,
        issue: { code: 'not-found' as const, message: 'zone 通道未在本夹具绑定。' },
      }),
    };
    return { planActions, applyFacility, getPlan: () => plan };
  }

  function placeFacilityViaPlan(channel: ReturnType<typeof boundChannel>): string {
    const result = channel.planActions.applyFacility({
      kind: 'add',
      input: { templateId: 'booth-2x2', position: { x: 1, y: 1 } },
    });
    return result.ok ? result.value.facilities[result.value.facilities.length - 1]!.id : '';
  }

  function mountBound(
    channel: ReturnType<typeof boundChannel>,
    place: (item: CatalogItem, position?: { x: number; z: number }) => string,
  ) {
    const legacyActions = {
      setLocked: vi.fn(),
      applyLayout: vi.fn(),
    } as unknown as Pick<LayoutActions, 'setLocked' | 'applyLayout'>;
    const history = { commitNow: vi.fn(), truncateTo: vi.fn() };
    return renderHook(() => {
      const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
      const placement = useKeyboardPlacement({
        layout: layoutStore.getState().layout,
        selectedItemId,
        actions: legacyActions,
        history,
        selectOnly: setSelectedItemId,
        placeCatalogItem: place,
        planActions: channel.planActions,
        planFacilities: channel.getPlan().facilities,
      });
      const add = (armed: boolean): string => {
        if (armed) armKeyboardPlacement();
        const id = placement.placeCatalogItem(makeCatalogItem());
        if (id) setSelectedItemId(id);
        return id;
      };
      return { ...placement, add, selectedItemId, legacyActions, history };
    });
  }

  it('an armed add unlocks through the plan setLocked channel and leaves the legacy reducer alone', () => {
    const channel = boundChannel();
    const { result } = mountBound(channel, () => placeFacilityViaPlan(channel));

    let id = '';
    act(() => { id = result.current.add(true); });

    expect(id).toBeTruthy();
    expect(channel.applyFacility).toHaveBeenCalledWith({ kind: 'setLocked', id, locked: false });
    expect(result.current.legacyActions.setLocked).not.toHaveBeenCalled();
    expect(result.current.placingId).toBe(id);
    expect(result.current.selectedItemId).toBe(id);
  });

  it('confirm locks the pending facility through the plan setLocked channel', () => {
    const channel = boundChannel();
    const { result } = mountBound(channel, () => placeFacilityViaPlan(channel));

    let id = '';
    act(() => { id = result.current.add(true); });
    act(() => { result.current.confirmPlacement(); });

    expect(channel.applyFacility).toHaveBeenCalledWith({ kind: 'setLocked', id, locked: true });
    expect(result.current.legacyActions.setLocked).not.toHaveBeenCalled();
    expect(result.current.placingId).toBeNull();
    expect(result.current.selectedItemId).toBe(id);
  });

  it('cancel removes the facility through the plan remove channel without touching the legacy layout', () => {
    const channel = boundChannel();
    const { result } = mountBound(channel, () => placeFacilityViaPlan(channel));

    let id = '';
    act(() => { id = result.current.add(true); });
    act(() => { result.current.cancelPlacement(); });

    expect(channel.applyFacility).toHaveBeenCalledWith({ kind: 'remove', id });
    expect(result.current.legacyActions.applyLayout).not.toHaveBeenCalled();
    expect(channel.getPlan().facilities.some((facility) => facility.id === id)).toBe(false);
    expect(result.current.placingId).toBeNull();
    expect(result.current.selectedItemId).toBeNull();
  });

  it('ends the session when the pending id is absent from the plan facilities', () => {
    const channel = boundChannel();
    const { result } = mountBound(channel, () => 'dangling-facility-id');

    act(() => { result.current.add(true); });

    expect(result.current.placingId).toBeNull();
    // 解锁尝试先落到通道；悬空 id 被通道拒收（not-found）不抛错，会话由存在性判定收尾。
    expect(channel.applyFacility).toHaveBeenCalledWith({
      kind: 'setLocked',
      id: 'dangling-facility-id',
      locked: false,
    });
  });

  it('a not-found channel refusal on cancel does not throw and just ends the session', () => {
    const seeded: PlanFacility = {
      id: 'fac-seeded',
      templateId: 'booth-2x2',
      position: { x: 1, y: 1 },
    } as PlanFacility;
    const plan: SitePlanData = { ...createStarterOutdoorPlan(), facilities: [seeded] };
    const applyFacility = vi.fn((): PlanEditResult<SitePlanData> => ({
      ok: false,
      issue: { code: 'not-found' as const, message: '设施不存在。' },
    }));
    const planActions: PlanActions = {
      applyFacility,
      applyZone: () => ({
        ok: false,
        issue: { code: 'not-found' as const, message: 'zone 通道未在本夹具绑定。' },
      }),
    };
    const legacyActions = { setLocked: vi.fn(), applyLayout: vi.fn() };
    const history = { commitNow: vi.fn(), truncateTo: vi.fn() };
    const { result } = renderHook(() => {
      const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
      const placement = useKeyboardPlacement({
        layout: layoutStore.getState().layout,
        selectedItemId,
        actions: legacyActions as unknown as Pick<LayoutActions, 'setLocked' | 'applyLayout'>,
        history,
        selectOnly: setSelectedItemId,
        placeCatalogItem: () => seeded.id,
        planActions,
        planFacilities: plan.facilities,
      });
      const add = (armed: boolean) => {
        if (armed) armKeyboardPlacement();
        placement.placeCatalogItem(makeCatalogItem());
        setSelectedItemId(seeded.id);
      };
      return { ...placement, add, legacyActions };
    });

    act(() => { result.current.add(true); });
    expect(result.current.placingId).toBe(seeded.id);
    expect(() => act(() => result.current.cancelPlacement())).not.toThrow();
    expect(result.current.placingId).toBeNull();
    expect(legacyActions.applyLayout).not.toHaveBeenCalled();
  });
});

describe('nextTileIndex — roving focus across a tile grid (#168)', () => {
  it('moves along rows and columns and clamps at the edges', () => {
    expect(nextTileIndex('ArrowRight', 0, 8, 4)).toBe(1);
    expect(nextTileIndex('ArrowRight', 7, 8, 4)).toBe(7);
    expect(nextTileIndex('ArrowLeft', 0, 8, 4)).toBe(0);
    expect(nextTileIndex('ArrowDown', 1, 8, 4)).toBe(5);
    expect(nextTileIndex('ArrowDown', 5, 8, 4)).toBe(7);
    expect(nextTileIndex('ArrowUp', 5, 8, 4)).toBe(1);
    expect(nextTileIndex('ArrowUp', 1, 8, 4)).toBe(0);
    expect(nextTileIndex('Home', 6, 8, 4)).toBe(0);
    expect(nextTileIndex('End', 0, 8, 4)).toBe(7);
  });

  it('leaves every other key alone', () => {
    expect(nextTileIndex('Enter', 2, 8, 4)).toBeNull();
    expect(nextTileIndex('r', 2, 8, 4)).toBeNull();
    expect(nextTileIndex('Tab', 2, 8, 4)).toBeNull();
  });
});
