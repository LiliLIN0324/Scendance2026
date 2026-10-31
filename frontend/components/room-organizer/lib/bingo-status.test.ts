import { describe, expect, it } from 'vitest';
import {
  BINGO_MARK_KEY,
  BINGO_RETURN_KEY,
  bingoBallLabel,
  bingoPhase,
  clearBingoReceipt,
  formatBingoTime,
  readBingoSnapshot,
  type BingoClearable,
  type BingoReadable,
} from './bingo-status';

const SHARE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function bucket(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  const storage = {
    getItem(key: string) { return map.get(key) ?? null; },
    removeItem(key: string) { map.delete(key); },
    set(key: string, value: unknown) { map.set(key, JSON.stringify(value)); },
    raw(key: string, value: string) { map.set(key, value); },
  };
  return storage;
}

function mark(shareId: string, extra: Record<string, unknown> = {}) {
  return {
    saved: true,
    status: 'needs-review',
    projectKey: 'local-draft',
    title: '发布会',
    shareId,
    reviewPlanKey: shareId,
    markedAt: '2026-10-31T00:00:00.000Z',
    ...extra,
  };
}

describe('bingoPhase', () => {
  it('待发 when nothing is collected and nothing has returned', () => {
    expect(bingoPhase(0, false)).toBe('to-send');
  });

  it('待评审 when a saved plan is waiting and there is no receipt', () => {
    expect(bingoPhase(2, false)).toBe('awaiting');
  });

  it('已回执 wins whenever a receipt is present', () => {
    expect(bingoPhase(0, true)).toBe('returned');
    expect(bingoPhase(3, true)).toBe('returned');
  });
});

describe('readBingoSnapshot', () => {
  it('reads an empty browser as 待发', () => {
    const snapshot = readBingoSnapshot(bucket());
    expect(snapshot).toEqual({ phase: 'to-send', plans: [], receipt: null });
    expect(bingoBallLabel(snapshot)).toBe('收反馈，待发');
  });

  it('lists needs-review marks and points each one at its review page', () => {
    const storage = bucket();
    storage.set(BINGO_MARK_KEY, [mark(SHARE, { title: '春季沙龙' }), mark(OTHER, { title: '夜场', projectKey: 'night' })]);
    const snapshot = readBingoSnapshot(storage);
    expect(snapshot.phase).toBe('awaiting');
    expect(snapshot.plans.map(plan => plan.title)).toEqual(['春季沙龙', '夜场']);
    expect(snapshot.plans.map(plan => plan.clientHref)).toEqual([`/review/${SHARE}`, `/review/${OTHER}`]);
    expect(snapshot.plans.every(plan => plan.returned === false)).toBe(true);
    expect(snapshot.receipt).toBeNull();
    expect(bingoBallLabel(snapshot)).toBe('收反馈，待评，2 份链接');
  });

  it('drops marks that are not the saved needs-review record', () => {
    const storage = bucket();
    storage.set(BINGO_MARK_KEY, [
      { saved: false, status: 'needs-review', projectKey: 'a', shareId: SHARE, markedAt: '2026-10-31T00:00:00.000Z' },
      { saved: true, status: 'sent', projectKey: 'a', shareId: SHARE, markedAt: '2026-10-31T00:00:00.000Z' },
      { saved: true, status: 'needs-review', projectKey: '', shareId: SHARE, markedAt: '2026-10-31T00:00:00.000Z' },
      { saved: true, status: 'needs-review', projectKey: 'a', shareId: 'not-a-uuid', markedAt: '2026-10-31T00:00:00.000Z' },
      mark(SHARE),
    ]);
    const snapshot = readBingoSnapshot(storage);
    expect(snapshot.plans).toHaveLength(2);
    expect(snapshot.plans.map(plan => plan.shareId).sort()).toEqual(['not-a-uuid', SHARE].sort());
  });

  it('turns the ball returned when the review page wrote a receipt', () => {
    const storage = bucket();
    storage.set(BINGO_RETURN_KEY, { version: 1, planKey: 'sample:initial', at: '2026-10-31T08:00:00.000Z' });
    const snapshot = readBingoSnapshot(storage);
    expect(snapshot.phase).toBe('returned');
    expect(snapshot.receipt).toEqual({
      planKey: 'sample:initial',
      at: '2026-10-31T08:00:00.000Z',
      href: '/review/',
    });
    expect(bingoBallLabel(snapshot)).toBe('收反馈，已回执');
  });

  it('marks only the plan whose id matches the receipt', () => {
    const storage = bucket();
    storage.set(BINGO_MARK_KEY, [mark(SHARE, { projectKey: 'hall' }), mark(OTHER)]);
    storage.set(BINGO_RETURN_KEY, { version: 1, planKey: SHARE, at: '2026-10-31T08:00:00.000Z' });
    const snapshot = readBingoSnapshot(storage);
    expect(snapshot.phase).toBe('returned');
    expect(snapshot.plans.map(plan => plan.returned)).toEqual([true, false]);
    expect(snapshot.receipt?.href).toBe(`/review/${SHARE}`);
  });

  it('ignores a broken or versioned-off receipt and still shows waiting plans', () => {
    const storage = bucket();
    storage.set(BINGO_MARK_KEY, [mark(SHARE)]);
    storage.set(BINGO_RETURN_KEY, { version: 2, planKey: 'sample:initial', at: '2026-10-31T08:00:00.000Z' });
    expect(readBingoSnapshot(storage).phase).toBe('awaiting');
    storage.raw(BINGO_RETURN_KEY, '{');
    const snapshot = readBingoSnapshot(storage);
    expect(snapshot.phase).toBe('awaiting');
    expect(snapshot.plans).toHaveLength(1);
    expect(snapshot.receipt).toBeNull();
  });

  it('treats a missing store as 待发', () => {
    expect(readBingoSnapshot(null).phase).toBe('to-send');
    const throwing: BingoReadable = { getItem() { throw new Error('blocked'); } };
    expect(readBingoSnapshot(throwing).phase).toBe('to-send');
  });
});

describe('clearBingoReceipt', () => {
  it('removes the return key and leaves the collection', () => {
    const storage = bucket();
    storage.set(BINGO_MARK_KEY, [mark(SHARE)]);
    storage.set(BINGO_RETURN_KEY, { version: 1, planKey: 'sample:initial', at: '2026-10-31T08:00:00.000Z' });
    clearBingoReceipt(storage);
    expect(storage.getItem(BINGO_RETURN_KEY)).toBeNull();
    expect(storage.getItem(BINGO_MARK_KEY)).toContain(SHARE);
    expect(readBingoSnapshot(storage).phase).toBe('awaiting');
  });

  it('is safe when there is no receipt', () => {
    const storage = bucket();
    clearBingoReceipt(storage satisfies BingoClearable);
    expect(readBingoSnapshot(storage).phase).toBe('to-send');
  });
});

describe('formatBingoTime', () => {
  it('prints the receipt clock in Shanghai time', () => {
    expect(formatBingoTime('2026-10-31T08:00:00.000Z')).toContain('16:00');
    expect(formatBingoTime('not-a-date')).toBe('');
  });
});
