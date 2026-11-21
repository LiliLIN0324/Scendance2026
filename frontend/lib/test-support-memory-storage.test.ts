import { describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from './test-support-memory-storage';

describe('MemoryStorage', () => {
  it('stores and reads back string values', () => {
    const storage = new MemoryStorage();
    storage.setItem('a:1', 'hello');
    expect(storage.getItem('a:1')).toBe('hello');
    expect(storage.getItem('missing')).toBeNull();
    expect(storage.length).toBe(1);
  });

  it('coerces stored values to strings', () => {
    const storage = new MemoryStorage();
    storage.setItem('num', 42 as unknown as string);
    expect(storage.getItem('num')).toBe('42');
  });

  it('removes items and reports length/key order', () => {
    const storage = new MemoryStorage();
    storage.setItem('k1', '1');
    storage.setItem('k2', '2');
    storage.removeItem('k1');
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe('k2');
    expect(storage.key(5)).toBeNull();
    storage.clear();
    expect(storage.length).toBe(0);
    expect(storage.key(0)).toBeNull();
  });

  it('exposes stored keys as enumerable own properties for Object.keys', () => {
    const storage = new MemoryStorage();
    storage.setItem('scendance:agent-run:alpha', '{ok:true}');
    storage.setItem('scendance:agent-run:beta', '{ok:false}');
    const found = Object.keys(storage).find((key) => key.startsWith('scendance:agent-run:'));
    expect(found).toBe('scendance:agent-run:alpha');
    expect(Object.keys(storage)).toHaveLength(2);
    storage.removeItem('scendance:agent-run:alpha');
    expect(Object.keys(storage)).toEqual(['scendance:agent-run:beta']);
  });

  it('allows spying on prototype methods; original.call(this) still operates on the instance', () => {
    const storage = new MemoryStorage();
    storage.setItem('scendance:agent-run:mark', 'before');
    const originalGetItem = MemoryStorage.prototype.getItem;
    const spy = vi
      .spyOn(MemoryStorage.prototype, 'getItem')
      .mockImplementation(function (this: MemoryStorage, key: string) {
        if (key === 'blocked') throw new Error('unavailable');
        return originalGetItem.call(this, key);
      });
    expect(() => storage.getItem('blocked')).toThrow('unavailable');
    expect(storage.getItem('scendance:agent-run:mark')).toBe('before');
    spy.mockRestore();
    expect(storage.getItem('scendance:agent-run:mark')).toBe('before');
  });
});
