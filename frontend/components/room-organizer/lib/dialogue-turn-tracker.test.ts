import {describe, expect, it} from 'vitest';
import {createDialogueTurnTracker} from './dialogue-turn-tracker';

describe('dialogue turn tracker', () => {
  it('captures only the single in-flight turn and releases it independently', () => {
    const pending = createDialogueTurnTracker();
    const first = 'evt-1';
    const second = 'evt-2';
    const releaseFirst = pending.begin(first);
    expect(pending.canCapture(first)).toBe(true);
    expect(pending.size).toBe(1);
    const releaseSecond = pending.begin(second);
    expect(pending.canCapture(first)).toBe(false);
    expect(pending.canCapture(second)).toBe(false);
    expect(pending.size).toBe(2);
    releaseFirst();
    expect(pending.canCapture(second)).toBe(true);
    expect(pending.canCapture(first)).toBe(false);
    releaseFirst();
    releaseSecond();
    expect(pending.size).toBe(0);
    expect(pending.canCapture(second)).toBe(false);
  });

  it('rejects a blank, padded, reused or non-string event id', () => {
    const pending = createDialogueTurnTracker();
    expect(() => pending.begin('')).toThrow('INVALID_TURN');
    expect(() => pending.begin(' evt-1')).toThrow('INVALID_TURN');
    expect(() => pending.begin(1 as unknown as string)).toThrow('INVALID_TURN');
    const release = pending.begin('evt-1');
    expect(() => pending.begin('evt-1')).toThrow('INVALID_TURN');
    release();
    expect(() => pending.begin('evt-1')).toThrow('INVALID_TURN');
    expect(pending.size).toBe(0);
    expect(pending.canCapture('evt-1')).toBe(false);
    expect(pending.canCapture('missing')).toBe(false);
  });

  it('keeps the remaining turns blocked when any other turn is still in flight', () => {
    const pending = createDialogueTurnTracker();
    const releaseFirst = pending.begin('evt-1');
    const releaseMiddle = pending.begin('evt-2');
    const releaseLast = pending.begin('evt-3');
    releaseMiddle();
    expect(pending.size).toBe(2);
    expect(pending.canCapture('evt-1')).toBe(false);
    expect(pending.canCapture('evt-2')).toBe(false);
    expect(pending.canCapture('evt-3')).toBe(false);
    releaseFirst();
    expect(pending.canCapture('evt-3')).toBe(true);
    releaseLast();
    expect(pending.size).toBe(0);
  });
});
