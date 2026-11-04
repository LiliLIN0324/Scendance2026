import { describe, expect, it } from 'vitest';
import {
  markReviewReturned,
  readReviewReturn,
  REVIEW_RETURN_STORAGE_KEY,
  reviewOrbClass,
  reviewOrbShouldTurnRed,
} from './review-return';

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe('review return hook', () => {
  it('marks a plan returned and tells the creator orb to turn red', () => {
    const storage = memory();
    expect(reviewOrbShouldTurnRed(readReviewReturn(storage))).toBe(false);
    expect(reviewOrbClass(false)).toBe('');
    const marked = markReviewReturned(storage, { planKey: 'sample:initial', now: new Date('2026-10-31T08:00:00Z') });
    expect(marked.ok).toBe(true);
    const record = readReviewReturn(storage);
    expect(record).toEqual({ planKey: 'sample:initial', at: '2026-10-31T08:00:00.000Z' });
    // R2：缺当前方案键时兜底即亮（旧行为）。
    expect(reviewOrbShouldTurnRed(record)).toBe(true);
    // R2：当前方案不是 sample:initial 时，sample demo 回执不点亮本方案的球。
    expect(reviewOrbShouldTurnRed(record, 'local:current-plan')).toBe(false);
    // R2：本方案回执才亮。
    expect(reviewOrbShouldTurnRed(record, 'sample:initial')).toBe(true);
    expect(reviewOrbClass(true)).toBe(' is-review-returned');
    expect(storage.getItem(REVIEW_RETURN_STORAGE_KEY)).toContain('sample:initial');
  });

  it('ignores a damaged receipt and a storage failure', () => {
    const storage = memory();
    storage.setItem(REVIEW_RETURN_STORAGE_KEY, '{');
    expect(readReviewReturn(storage)).toBeNull();
    storage.setItem = () => { throw new Error('quota'); };
    expect(markReviewReturned(storage, { planKey: 'sample:initial' })).toEqual({ ok: false, reason: 'storage' });
    expect(markReviewReturned(storage, { planKey: '' })).toEqual({ ok: false, reason: 'plan' });
  });
});
