import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UseHistoryResult } from './use-history';
import type { LayoutActions } from './use-layout-state';
import type { PlanFacility } from '../../../../supabase/functions/_shared/site-plan';
import type { PlanActions } from '../lib/plan-facility-actions';
import type { CatalogItem, RoomLayout } from '../lib/types';
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

/**
 * Keyboard-driven placement (#168): Enter on a focused catalog tile drops the
 * item at the room centre through the ordinary `placeCatalogItem` path, then
 * keeps it UNLOCKED and selected as a "placing" session so the existing arrow
 * nudge / R rotate shortcuts can position it. Enter locks it (the same
 * lock-on-release a drag performs); Escape takes it back out, leaving no trace
 * in history.
 *
 * The tiles can't tell the orchestrator "this add came from the keyboard" —
 * their `onAdd` is owned by the HUD panels and stays a plain
 * `(item) => void`. Instead the tile arms a one-shot flag right before it
 * calls `onAdd`, and the wrapped `placeCatalogItem` below consumes it in the
 * same synchronous call chain. A microtask disarms it again so an add that
 * never reaches the wrapper (declined budget confirm, a refused outdoor
 * placement on an upper floor) can't leak into the next mouse click.
 */
let keyboardArmed = false;

/** Called by a catalog tile on Enter/Space, immediately before its `onAdd`. */
export function armKeyboardPlacement(): void {
  keyboardArmed = true;
  queueMicrotask(() => {
    keyboardArmed = false;
  });
}

function consumeKeyboardPlacement(): boolean {
  const armed = keyboardArmed;
  keyboardArmed = false;
  return armed;
}

/** Where an arrow/Home/End press moves the focus in a `columns`-wide tile grid. */
export function nextTileIndex(key: string, index: number, count: number, columns: number): number | null {
  const last = Math.max(0, count - 1);
  switch (key) {
    case 'ArrowRight':
      return Math.min(last, index + 1);
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'ArrowDown':
      return Math.min(last, index + columns);
    case 'ArrowUp':
      return Math.max(0, index - columns);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

export interface RovingTileProps {
  tabIndex: 0 | -1;
  'data-catalog-tile': true;
  onFocus(): void;
  onKeyDown(event: ReactKeyboardEvent<HTMLElement>): void;
}

export interface UseRovingTilesResult {
  /** Attach to the element that directly wraps the tiles. */
  gridRef: RefObject<HTMLDivElement>;
  /** Spread onto tile `index`; `activate` runs on Enter/Space with placement armed. */
  tileProps(index: number, activate: () => void): RovingTileProps;
}

/**
 * Roving tabindex for a catalog tile grid (#168): one tile is in the Tab
 * order, arrows/Home/End move the focus between tiles, and Enter/Space arm a
 * keyboard placement and activate the tile. Arrows are swallowed even at the
 * grid's edge so they never fall through to the window-level nudge shortcut.
 */
export function useRovingTiles(count: number, columns: number): UseRovingTilesResult {
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const current = Math.min(focusIndex, Math.max(0, count - 1));

  const tileProps = useCallback(
    (index: number, activate: () => void): RovingTileProps => ({
      tabIndex: index === current ? 0 : -1,
      'data-catalog-tile': true,
      onFocus: () => setFocusIndex(index),
      onKeyDown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          armKeyboardPlacement();
          activate();
          // Hand the keyboard to the pending item: with the tile still focused
          // the arrows would keep roving the grid instead of nudging it.
          event.currentTarget.blur();
          return;
        }
        const next = nextTileIndex(event.key, index, count, columns);
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        setFocusIndex(next);
        gridRef.current?.querySelectorAll<HTMLElement>('[data-catalog-tile]')[next]?.focus();
      },
    }),
    [current, count, columns]
  );

  return useMemo(() => ({ gridRef, tileProps }), [tileProps]);
}

export interface UseKeyboardPlacementParams {
  layout: RoomLayout;
  selectedItemId: string | null;
  actions: Pick<LayoutActions, 'setLocked' | 'applyLayout'>;
  history: Pick<UseHistoryResult<RoomLayout>, 'commitNow' | 'truncateTo'>;
  selectOnly(id: string | null): void;
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
  /**
   * B-2b：绑定 plan 时的 facility 写通道；缺省 / null = legacy 草稿，解锁落锁、
   * 撤件与存在性判定全部走旧 actions / layout，行为与未接入前逐字等价。
   */
  planActions?: PlanActions | null;
  /** B-2b：当前 plan facilities，会话存在性判定用；legacy 草稿不传。 */
  planFacilities?: readonly PlanFacility[];
}

export interface UseKeyboardPlacementResult {
  /** Id of the item being positioned from the keyboard, or null. */
  placingId: string | null;
  /**
   * Drop-in replacement for `placeCatalogItem`: same signature, but an add the
   * tile armed as keyboard-driven starts a placing session on the new item.
   */
  placeCatalogItem(catalogItem: CatalogItem, position?: { x: number; z: number }): string;
  /** Enter: lock the item in place (matching drag release) and end the session. */
  confirmPlacement(): void;
  /** Escape: take the item back out and end the session. */
  cancelPlacement(): void;
}

function withoutItem(layout: RoomLayout, id: string): RoomLayout {
  return {
    ...layout,
    floors: layout.floors.map((floor) =>
      floor.items.some((item) => item.id === id)
        ? { ...floor, items: floor.items.filter((item) => item.id !== id) }
        : floor
    ),
  };
}

function hasItem(layout: RoomLayout, id: string): boolean {
  return layout.floors.some((floor) => floor.items.some((item) => item.id === id));
}

function facilityExists(facilities: readonly PlanFacility[], id: string): boolean {
  return facilities.some((facility) => facility.id === id);
}

export function useKeyboardPlacement({
  layout,
  selectedItemId,
  actions,
  history,
  selectOnly,
  placeCatalogItem,
  planActions = null,
  planFacilities,
}: UseKeyboardPlacementParams): UseKeyboardPlacementResult {
  const [placingId, setPlacingId] = useState<string | null>(null);
  const { commitNow, truncateTo } = history;
  // The layout the session started from, i.e. the history entry the add was
  // committed on top of. Cancel truncates history back to it (#356).
  const sessionStartRef = useRef<RoomLayout | null>(null);

  const placeTracked = useCallback(
    (catalogItem: CatalogItem, position?: { x: number; z: number }): string => {
      const armed = consumeKeyboardPlacement();
      // The add must be an entry of its own, so the session has a clean start
      // to truncate back to.
      if (armed) commitNow();
      const id = placeCatalogItem(catalogItem, position);
      if (!id || !armed) return id;
      // Catalog items are born locked (#11); a locked item ignores the arrow
      // nudges and R, so the pending item has to be unlocked for the session.
      if (planActions) {
        // B-2b：绑定 plan 时解锁走 facility 通道；通道拒收（not-found 等）不抛错，
        // 会话存在性由下方 effect 按失效收尾。
        planActions.applyFacility({ kind: 'setLocked', id, locked: false });
      } else {
        actions.setLocked(id, false);
      }
      sessionStartRef.current = layout;
      setPlacingId(id);
      return id;
    },
    [placeCatalogItem, actions, commitNow, layout, planActions]
  );

  // The session is tied to the pending item staying the sole selection:
  // clicking elsewhere, switching floors, deleting it or undoing past its
  // creation all end the session without touching the layout further.
  useEffect(() => {
    if (placingId === null) return;
    const exists = planActions
      ? facilityExists(planFacilities ?? [], placingId)
      : hasItem(layout, placingId);
    if (selectedItemId !== placingId || !exists) setPlacingId(null);
  }, [placingId, selectedItemId, layout, planActions, planFacilities]);

  const confirmPlacement = useCallback(() => {
    if (placingId === null) return;
    if (planActions) {
      planActions.applyFacility({ kind: 'setLocked', id: placingId, locked: true });
    } else {
      actions.setLocked(placingId, true);
    }
    setPlacingId(null);
  }, [placingId, actions, planActions]);

  // Escape takes the item out and erases the session from history: the add
  // and every nudge since are dropped, so neither undo nor redo can bring the
  // cancelled item back (#356). applyLayout rather than removeItem: the
  // replacement must always change the value, which truncateTo relies on.
  // B-2b：绑定 plan 时撤件走 facility remove；通道拒收不抛错，会话照常收尾。
  const cancelPlacement = useCallback(() => {
    if (placingId === null) return;
    setPlacingId(null);
    const start = sessionStartRef.current;
    sessionStartRef.current = null;
    const exists = planActions
      ? facilityExists(planFacilities ?? [], placingId)
      : hasItem(layout, placingId);
    if (!exists) return;
    selectOnly(null);
    if (start) truncateTo(start);
    if (planActions) {
      planActions.applyFacility({ kind: 'remove', id: placingId });
    } else {
      actions.applyLayout(withoutItem(layout, placingId));
    }
  }, [placingId, layout, truncateTo, actions, selectOnly, planActions, planFacilities]);

  return useMemo(
    () => ({
      placingId,
      placeCatalogItem: placeTracked,
      confirmPlacement,
      cancelPlacement,
    }),
    [placingId, placeTracked, confirmPlacement, cancelPlacement]
  );
}
