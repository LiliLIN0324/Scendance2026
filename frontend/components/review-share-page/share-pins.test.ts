import { describe, expect, it } from 'vitest';
import {
  appendReviewSharePin,
  readReviewSharePins,
  REVIEW_SHARE_PIN_STORAGE_KEY,
} from './share-pins';

const draft = {
  itemId: null,
  x: 1,
  y: 0,
  z: -2,
  offset: null,
  camera: {
    position: [3.4, 2.8, 0.4] as const,
    target: [1, 0, -2] as const,
  },
};

describe('review share pins', () => {
  it('stores pins per plan key', () => {
    const storage = memoryStorage();
    const first = appendReviewSharePin(storage, { planKey: 'sample:initial', text: '通道窄', draft });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(readReviewSharePins('sample:initial', storage)).toHaveLength(1);
    expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY)).toContain('通道窄');
  });

  it('rejects empty text', () => {
    const storage = memoryStorage();
    expect(appendReviewSharePin(storage, { planKey: 'a', text: '   ', draft }).ok).toBe(false);
  });
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}
