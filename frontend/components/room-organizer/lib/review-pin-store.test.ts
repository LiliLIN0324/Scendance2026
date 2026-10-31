import { describe, expect, it } from 'vitest';
import { createReviewPin, type ReviewPinDraft } from './review-pins';
import {
  appendPlanPin,
  mergeFloorPins,
  PLAN_PIN_STORAGE_KEY,
  planPinToReviewPin,
  readPlanPins,
  replaceFloorPins,
} from './review-pin-store';

function memory(): Storage {
  const bag = new Map<string, string>();
  return {
    getItem: (key) => bag.get(key) ?? null,
    setItem: (key, value) => { bag.set(key, value); },
    removeItem: (key) => { bag.delete(key); },
    clear: () => { bag.clear(); },
    key: () => null,
    length: 0,
  };
}

const draft: ReviewPinDraft = {
  itemId: null,
  x: 1,
  y: 0,
  z: 2,
  offset: null,
  camera: { position: [3, 3, 4], target: [1, 0, 2] },
};

describe('review pin store', () => {
  it('appends a pin for one plan and leaves another plan alone', () => {
    const storage = memory();
    const saved = appendPlanPin(storage, {
      planKey: 'sample:initial', id: 'pin-1', text: '  桌子挡了通道  ', x: 1, y: 0, z: -1, itemId: 'desk', floorId: 'ground',
    });
    expect(saved.ok).toBe(true);
    expect(readPlanPins('sample:initial', storage)).toMatchObject([{ id: 'pin-1', text: '桌子挡了通道', itemId: 'desk' }]);
    expect(readPlanPins('other', storage)).toEqual([]);
    expect(storage.getItem(PLAN_PIN_STORAGE_KEY)).toContain('桌子挡了通道');
    expect(appendPlanPin(storage, { planKey: 'sample:initial', id: 'pin-2', text: '   ', x: 0, y: 0, z: 0, itemId: null, floorId: 'ground' }).ok).toBe(false);
  });

  it('replaces one floor and round-trips into a review pin', () => {
    const storage = memory();
    appendPlanPin(storage, { planKey: 'local:house', id: 'keep', text: '二层', x: 0, y: 1, z: 0, itemId: null, floorId: 'loft' });
    const pin = createReviewPin({ id: 'ground-1', text: '通道窄', draft })!;
    const replaced = replaceFloorPins(storage, 'local:house', 'ground', [pin]);
    expect(replaced.ok).toBe(true);
    const stored = readPlanPins('local:house', storage);
    expect(stored.map(item => item.floorId).sort()).toEqual(['ground', 'loft']);
    const merged = mergeFloorPins([], stored, 'ground');
    expect(merged).toHaveLength(1);
    expect(planPinToReviewPin(stored.find(item => item.id === 'ground-1')!).text).toBe('通道窄');
    expect(merged[0]?.camera.target).toEqual([1, 0, 2]);
  });

  it('reads a broken file as empty', () => {
    const storage = memory();
    storage.setItem(PLAN_PIN_STORAGE_KEY, '{');
    expect(readPlanPins('sample:initial', storage)).toEqual([]);
  });
});
