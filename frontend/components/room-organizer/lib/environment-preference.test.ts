// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearEnvironment, environmentPreferenceKey, readEnvironment, writeEnvironment } from './environment-preference';
import { MemoryStorage } from '@/lib/test-support-memory-storage';

let memStorage: MemoryStorage;
beforeEach(() => {
  memStorage = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', memStorage);
  window.localStorage = memStorage;
  localStorage.clear();
});
afterEach(() => {
  memStorage?.clear();
  vi.unstubAllGlobals();
});

describe('environment preference', () => {
  it('remembers one environment per project and keeps the draft separate', () => {
    writeEnvironment('project-a', { assetId: 'asset-a', name: '午后咖啡馆' });
    writeEnvironment(undefined, { assetId: 'asset-draft', name: '草稿场地' });
    expect(readEnvironment('project-a')).toEqual({ assetId: 'asset-a', name: '午后咖啡馆' });
    expect(readEnvironment(undefined)).toEqual({ assetId: 'asset-draft', name: '草稿场地' });
    expect(readEnvironment('project-b')).toBeNull();
    expect(environmentPreferenceKey(undefined)).toBe('draft');
  });

  it('ignores unreadable or malformed entries instead of failing the workbench', () => {
    localStorage.setItem('scendance:environment:v1', JSON.stringify({
      good: { assetId: 'asset-a', name: '好的一条' },
      missingName: { assetId: 'asset-b' },
      tooLong: { assetId: 'x'.repeat(121), name: '太长' },
    }));
    expect(readEnvironment('good')).toEqual({ assetId: 'asset-a', name: '好的一条' });
    expect(readEnvironment('missingName')).toBeNull();
    expect(readEnvironment('tooLong')).toBeNull();
    localStorage.setItem('scendance:environment:v1', '{not json');
    expect(readEnvironment('good')).toBeNull();
  });

  it('clears only the project asked for', () => {
    writeEnvironment('project-a', { assetId: 'asset-a', name: 'A' });
    writeEnvironment('project-b', { assetId: 'asset-b', name: 'B' });
    clearEnvironment('project-a');
    expect(readEnvironment('project-a')).toBeNull();
    expect(readEnvironment('project-b')).toEqual({ assetId: 'asset-b', name: 'B' });
  });

  it('keeps the newest entries when the map grows past its cap', () => {
    for (let index = 0; index < 205; index += 1) {
      writeEnvironment(`project-${index}`, { assetId: `asset-${index}`, name: `场地 ${index}` });
    }
    expect(readEnvironment('project-0')).toBeNull();
    expect(readEnvironment('project-204')).toEqual({ assetId: 'asset-204', name: '场地 204' });
  });
});
