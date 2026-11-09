import { describe, expect, it } from 'vitest';
import { selectionBoundedReviseAvailable } from './selection-edit';

describe('selection-bounded edit', () => {
  it('stays unwired so a named move is not silently dropped', () => {
    expect(selectionBoundedReviseAvailable()).toBe(false);
  });
});
