import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE_MODE,
  parseAppearanceMode,
  readAppearanceMode,
  resolveAppearance,
  systemPrefersDark,
  writeAppearanceMode,
} from './appearance';

function mockStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    get length() { return map.size; },
  };
}

describe('appearance mode parsing', () => {
  it('falls back to system for missing / invalid values', () => {
    expect(parseAppearanceMode(null)).toBe(DEFAULT_APPEARANCE_MODE);
    expect(parseAppearanceMode(undefined)).toBe('system');
    expect(parseAppearanceMode('')).toBe('system');
    expect(parseAppearanceMode('follow-canvas')).toBe('system');
  });

  it('keeps the three legal modes', () => {
    expect(parseAppearanceMode('light')).toBe('light');
    expect(parseAppearanceMode('dark')).toBe('dark');
    expect(parseAppearanceMode('system')).toBe('system');
  });
});

describe('appearance persistence', () => {
  it('reads back a stored mode and ignores garbage', () => {
    expect(readAppearanceMode(mockStorage({ [APPEARANCE_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(readAppearanceMode(mockStorage({ [APPEARANCE_STORAGE_KEY]: 'purple' }))).toBe('system');
    expect(readAppearanceMode(mockStorage())).toBe('system');
  });

  it('writes the mode into the prefixed key', () => {
    const storage = mockStorage();
    writeAppearanceMode('light', storage);
    expect(readAppearanceMode(storage)).toBe('light');
    writeAppearanceMode('dark', storage);
    expect(readAppearanceMode(storage)).toBe('dark');
  });
});

describe('appearance resolution', () => {
  it('honours explicit light / dark regardless of system', () => {
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
  });

  it('follows the system scheme in system mode', () => {
    expect(resolveAppearance('system', false)).toBe('light');
    expect(resolveAppearance('system', true)).toBe('dark');
  });

  it('reads the media query match state', () => {
    const dark = { matches: true } as MediaQueryList;
    const light = { matches: false } as MediaQueryList;
    expect(systemPrefersDark(dark)).toBe(true);
    expect(systemPrefersDark(light)).toBe(false);
  });
});
