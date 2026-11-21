// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { safeGetItem, safeRemoveItem, safeSetItem } from './safe-storage';

function throwingStorage(): Storage {
  const fail = (): never => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}

let mem: MemoryStorage;
describe('safe-storage (#396)', () => {
  beforeEach(() => {
    mem = new MemoryStorage();
    vi.stubGlobal('Storage', MemoryStorage);
    vi.stubGlobal('localStorage', mem);
    window.localStorage = mem;
    window.localStorage.clear();
  });

  afterEach(() => {
    mem?.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads, writes and removes through window.localStorage by default', () => {
    expect(safeGetItem('k')).toBeNull();
    expect(safeSetItem('k', 'v')).toBe(true);
    expect(window.localStorage.getItem('k')).toBe('v');
    expect(safeGetItem('k')).toBe('v');
    expect(safeRemoveItem('k')).toBe(true);
    expect(window.localStorage.getItem('k')).toBeNull();
  });

  it('swallows a storage whose every call throws', () => {
    const storage = throwingStorage();
    expect(safeGetItem('k', storage)).toBeNull();
    expect(safeSetItem('k', 'v', storage)).toBe(false);
    expect(safeRemoveItem('k', storage)).toBe(false);
  });

  it('swallows a throwing window.localStorage getter (blocked storage)', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access is denied for this document.', 'SecurityError');
    });
    expect(safeGetItem('k')).toBeNull();
    expect(safeSetItem('k', 'v')).toBe(false);
    expect(safeRemoveItem('k')).toBe(false);
  });
});
