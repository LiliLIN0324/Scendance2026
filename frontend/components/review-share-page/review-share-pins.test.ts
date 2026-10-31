import { describe, expect, it } from 'vitest';
import { addReviewSharePin, readReviewSharePins, REVIEW_SHARE_PINS_KEY } from './review-share-pins';

describe('review share pins', () => {
  it('stores pins by planKey and remembers last author', () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    const first = addReviewSharePin(store, {
      planKey: 'sample:initial',
      floorId: 'f0',
      itemId: null,
      x: 1,
      z: 2,
      author: '甲方',
      text: '主舞台偏左',
      id: 'pin-1',
      now: new Date('2026-10-31T12:00:00.000Z'),
    });
    expect(first.ok).toBe(true);
    expect(readReviewSharePins('sample:initial', store).pins).toHaveLength(1);
    expect(readReviewSharePins('sample:initial', store).lastAuthor).toBe('甲方');
    expect(storage.get(REVIEW_SHARE_PINS_KEY)).toContain('主舞台偏左');
  });

  it('requires author and text', () => {
    const storage = new Map<string, string>();
    const store = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    expect(addReviewSharePin(store, {
      planKey: 'sample:initial',
      floorId: 'f0',
      itemId: null,
      x: 0,
      z: 0,
      author: '',
      text: '意见',
    }).ok).toBe(false);
  });
});
