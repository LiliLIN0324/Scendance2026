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

  it('rejects a blank or repeated event id', () => {
    const pending = createDialogueTurnTracker();
    expect(() => pending.begin('')).toThrow('INVALID_TURN');
    const release = pending.begin('evt-1');
    expect(() => pending.begin('evt-1')).toThrow('INVALID_TURN');
    release();
    expect(pending.size).toBe(0);
  });
});
