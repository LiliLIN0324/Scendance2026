import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { proposalScopeViolations } from './proposal-scope';
import type { RoomLayout } from './types';

const entranceId = '10000000-0000-4000-8000-000000000010';

function layoutWith(overrides: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout({
    roof: { style: 'none', color: '#5d3a23' },
    floors: [makeFloor({ items: [
      makeItem({ id: 'locked', locked: true }),
      makeItem({ id: 'chair', position: { x: 2, z: 0 } }),
    ] })],
    ...overrides,
  });
}

describe('proposal scope', () => {
  it('allows rearranging and adding material instances', () => {
    const current = layoutWith();
    const next: RoomLayout = {
      ...current,
      floors: [{ ...current.floors[0]!, items: [
        current.floors[0]!.items[0]!,
        makeItem({ id: 'chair', position: { x: 3, z: 1 } }),
        makeItem({ id: 'added' }),
      ] }],
    };

    expect(proposalScopeViolations(current, next)).toEqual([]);
  });

  it('locks the venue footprint', () => {
    const current = layoutWith();
    const issues = proposalScopeViolations(current, { ...current, width: 10 });

    expect(issues.map(issue => issue.code)).toEqual(['VENUE_LOCKED']);
    expect(issues[0]!.message).toContain('场地尺寸');
  });

  it('locks floors and interior walls', () => {
    const current = layoutWith();
    const wall = { id: 'wall-1', x1: -2, z1: 0, x2: 2, z2: 0 };
    const withWall: RoomLayout = {
      ...current,
      floors: [{ ...current.floors[0]!, interiorWalls: [wall] }],
    };
    const extraFloor = { ...current, floors: [...current.floors, makeFloor({ id: 'upper' })] };

    expect(proposalScopeViolations(current, withWall).map(issue => issue.code)).toEqual(['VENUE_LOCKED']);
    expect(proposalScopeViolations(current, extraFloor).map(issue => issue.code)).toEqual(['VENUE_LOCKED']);
  });

  it('refuses to drop or move locked and structural instances', () => {
    const current = layoutWith({
      floors: [makeFloor({ items: [
        makeItem({ id: 'locked', locked: true }),
        makeItem({ id: 'entrance', venueEntranceId: entranceId }),
      ] })],
    });
    const removed: RoomLayout = { ...current, floors: [{ ...current.floors[0]!, items: [] }] };
    const moved: RoomLayout = { ...current, floors: [{ ...current.floors[0]!, items: [
      current.floors[0]!.items[0]!,
      { ...current.floors[0]!.items[1]!, position: { x: 5, z: 5 } },
    ] }] };

    expect(proposalScopeViolations(current, removed)).toMatchObject([
      { code: 'STRUCTURE_ITEM_LOCKED', objectIds: ['locked', 'entrance'] },
    ]);
    expect(proposalScopeViolations(current, moved)).toMatchObject([
      { code: 'STRUCTURE_ITEM_LOCKED', objectIds: ['entrance'] },
    ]);
  });

  it('ignores object key order and business documents', () => {
    const venue = { width: 8, depth: 8, height: 3, shape: 'rectangle' as const, entrances: [] };
    const current = layoutWith({ backendVenue: venue });
    const reordered = { entrances: [], shape: 'rectangle' as const, height: 3, depth: 8, width: 8 };
    const next: RoomLayout = { ...current, backendVenue: reordered };

    expect(proposalScopeViolations(current, next)).toEqual([]);
  });
});
