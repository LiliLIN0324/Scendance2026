// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useRef } from 'react';
import { applyVenueHistorySnapshot } from '../lib/venue-history';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { useHistory } from './use-history';
import { useLayoutState } from './use-layout-state';
import { layoutStore } from './use-layout-store';
import { INITIAL_LAYOUT } from './layout-reducer';
import type { RoomLayout } from '../lib/types';

afterEach(() => { cleanup(); layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 }); });

it('restores the original venue repeatedly despite reducer-normalised snapshot identities', () => {
  const a = makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'chair-a', type: 'chair' })] })] });
  const b: RoomLayout = { ...a, width: a.width + 1, venueScan: { assetId: 'b', name: '场地 B' },
    floors: [makeFloor({ items: [makeItem({ id: 'table-b', type: 'table' })] })] };
  layoutStore.setState({ layout: a, activeFloorIndex: 0 });
  let activeVenue = 'a';
  const saved = new Map<string, string[]>();
  const { result } = renderHook(() => {
    const state = useLayoutState();
    const associations = useRef(new WeakMap<RoomLayout, { assetId: string; name: string }>());
    const history = useHistory(state.layout, snapshot => applyVenueHistorySnapshot(
      snapshot, associations.current, () => layoutStore.getState().layout, state.actions.applyLayout,
      () => activeVenue, (venue, previous) => {
        saved.set(activeVenue, previous.floors[0]!.items.map(item => item.id));
        activeVenue = venue.assetId;
      },
    ), { debounceMs: 10 });
    return { state, history, associations };
  });
  act(() => {
    result.current.history.commitNow();
    result.current.state.actions.applyLayout(b);
    result.current.associations.current.set(a, { assetId: 'a', name: '场地 A' });
    activeVenue = 'b';
  });
  act(() => result.current.history.undo());
  expect(activeVenue).toBe('a');
  expect(saved.get('b')).toEqual(['table-b']);
  act(() => result.current.history.redo());
  expect(activeVenue).toBe('b');
  expect(saved.get('a')).toEqual(['chair-a']);
  act(() => result.current.history.undo());
  expect(activeVenue).toBe('a');
  expect(layoutStore.getState().layout.floors[0]!.items.map(item => item.id)).toEqual(['chair-a']);
  expect(saved.get('b')).toEqual(['table-b']);
});
