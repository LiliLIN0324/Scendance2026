import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INTERACT_DISTANCE,
  INTERACT_ACTION_KEY,
  InteractRegistry,
  distance3,
  makeInteractableEntry,
  nearestNearbyEntry,
  nearbyEntries,
  type InteractableEntry,
} from './interact-registry';

function entry(overrides: Partial<InteractableEntry> = {}): InteractableEntry {
  return makeInteractableEntry({
    id: overrides.id ?? 'facility-a',
    kind: overrides.kind ?? 'facility',
    label: overrides.label ?? '签到岗亭',
    ...overrides,
  });
}

describe('interact entry defaults', () => {
  it('fills action key, radius and enabled flag', () => {
    const e = makeInteractableEntry({ id: 'x', kind: 'npc', label: '保安' });
    expect(e.actionKey).toBe(INTERACT_ACTION_KEY);
    expect(e.maxDistance).toBe(DEFAULT_INTERACT_DISTANCE);
    expect(e.enabled).toBe(true);
    expect(e.subtitle).toBeUndefined();
  });

  it('keeps explicit overrides', () => {
    const e = entry({ maxDistance: 1.5, enabled: false, subtitle: '东门' });
    expect(e.maxDistance).toBe(1.5);
    expect(e.enabled).toBe(false);
    expect(e.subtitle).toBe('东门');
  });
});

describe('distance3', () => {
  it('measures Euclidean distance in meters', () => {
    expect(distance3({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 })).toBe(5);
  });
});

describe('nearbyEntries', () => {
  const player = { x: 0, y: 0, z: 0 };

  it('keeps enabled entries within their own radius, nearest first', () => {
    const near = entry({ id: 'near', position: { x: 1, y: 0, z: 0 } });
    const far = entry({ id: 'far', position: { x: 2, y: 0, z: 0 } });
    const out = entry({ id: 'out', position: { x: 9, y: 0, z: 0 } });
    const result = nearbyEntries([far, near, out], player);
    expect(result.map(e => e.id)).toEqual(['near', 'far']);
  });

  it('drops disabled and position-less entries', () => {
    const disabled = entry({ id: 'disabled', enabled: false, position: { x: 0.5, y: 0, z: 0 } });
    const noPosition = entry({ id: 'no-position' });
    const ok = entry({ id: 'ok', position: { x: 0.5, y: 0, z: 0 } });
    expect(nearbyEntries([disabled, noPosition, ok], player).map(e => e.id)).toEqual(['ok']);
  });

  it('honours an external reach cap smaller than entry radius', () => {
    const e = entry({ id: 'e', maxDistance: 5, position: { x: 3, y: 0, z: 0 } });
    expect(nearbyEntries([e], player, 2).map(x => x.id)).toEqual([]);
    expect(nearbyEntries([e], player, 3).map(x => x.id)).toEqual(['e']);
  });

  it('treats the radius boundary as inclusive', () => {
    const e = entry({ id: 'edge', maxDistance: 2.2, position: { x: 2.2, y: 0, z: 0 } });
    expect(nearbyEntries([e], player)).toHaveLength(1);
  });
});

describe('nearestNearbyEntry', () => {
  it('returns the closest candidate or null', () => {
    const a = entry({ id: 'a', position: { x: 1.2, y: 0, z: 0 } });
    const b = entry({ id: 'b', position: { x: 0.4, y: 0, z: 0 } });
    expect(nearestNearbyEntry([a, b], { x: 0, y: 0, z: 0 })?.id).toBe('b');
    expect(nearestNearbyEntry([], { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('InteractRegistry', () => {
  it('registers, looks up, filters by kind and deregisters', () => {
    const registry = new InteractRegistry();
    const facility = entry({ id: 'f1', kind: 'facility' });
    const npc = entry({ id: 'n1', kind: 'npc' });
    registry.register(facility);
    registry.register(npc);
    expect(registry.size).toBe(2);
    expect(registry.list('facility').map(e => e.id)).toEqual(['f1']);
    expect(registry.get('n1')?.kind).toBe('npc');
    registry.deregister('f1');
    expect(registry.size).toBe(1);
    registry.clear();
    expect(registry.size).toBe(0);
  });

  it('stores an action callback and passes the entry through context', () => {
    const registry = new InteractRegistry();
    const act = vi.fn();
    const e = entry({ id: 'k1', label: '岗亭' });
    registry.register(e, act);
    registry.actionFor('k1')?.({ entry: e });
    expect(act).toHaveBeenCalledOnce();
    expect(act.mock.calls[0]![0].entry.id).toBe('k1');
  });

  it('returns no action for an unregistered id', () => {
    const registry = new InteractRegistry();
    expect(registry.actionFor('missing')).toBeUndefined();
  });
});
