import { describe, expect, it, vi } from 'vitest';
import {
  VENUE_LIBRARY_STORAGE_KEY,
  VENUE_LIGHT_HINT,
  VENUE_TEMPLATES,
  emptyVenueLibrary,
  lightVenueLibrary,
  noteVenueThreeIntent,
  parseVenueLibrary,
  publishVenueLibrary,
  readVenueLibrary,
  saveVenueFromTemplate,
  venueEntryClassName,
  writeVenueLibrary,
} from './venue-library';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); },
    clear: () => { data.clear(); },
  };
}

describe('venue library', () => {
  it('starts empty and unlit, and keeps the 3D hint sentence', () => {
    const storage = memoryStorage();
    expect(readVenueLibrary(storage)).toEqual(emptyVenueLibrary());
    expect(VENUE_TEMPLATES.length).toBeGreaterThanOrEqual(2);
    expect(VENUE_TEMPLATES.length).toBeLessThanOrEqual(3);
    expect(VENUE_LIGHT_HINT).toBe('需要 3D 时会点亮场地');
  });

  it('drops corrupt payloads back to an empty library', () => {
    const storage = memoryStorage();
    storage.setItem(VENUE_LIBRARY_STORAGE_KEY, '{');
    expect(readVenueLibrary(storage)).toEqual(emptyVenueLibrary());
    storage.setItem(VENUE_LIBRARY_STORAGE_KEY, JSON.stringify({ version: 0, lit: true, venues: [] }));
    expect(readVenueLibrary(storage).lit).toBe(false);
    expect(parseVenueLibrary('null')).toBeNull();
  });

  it('lights once and saves a template into 我的场地 without duplicates', () => {
    const storage = memoryStorage();
    const lit = noteVenueThreeIntent(storage);
    expect(lit.lit).toBe(true);
    const raw = storage.getItem(VENUE_LIBRARY_STORAGE_KEY);
    expect(noteVenueThreeIntent(storage).lit).toBe(true);
    expect(storage.getItem(VENUE_LIBRARY_STORAGE_KEY)).toBe(raw);

    const saved = saveVenueFromTemplate(lit, 'tavern-night', 20);
    const again = saveVenueFromTemplate(saved, 'tavern-night', 30);
    expect(again).toBe(saved);
    expect(again.venues).toEqual([expect.objectContaining({ templateId: 'tavern-night', name: '夜市酒馆壳', savedAt: 20 })]);
    expect(saveVenueFromTemplate(again, 'missing', 40)).toBe(again);
    expect(writeVenueLibrary(again, storage)).toBe(true);
    expect(readVenueLibrary(storage).venues).toHaveLength(1);
  });

  it('publishes a change event when a browser window exists', () => {
    const storage = memoryStorage();
    const dispatch = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: dispatch });
    try {
      expect(publishVenueLibrary(lightVenueLibrary(emptyVenueLibrary()), storage)).toBe(true);
      expect(dispatch).toHaveBeenCalledOnce();
      expect(readVenueLibrary(storage).lit).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('marks the nav entry muted until it is lit, and active while the panel is open', () => {
    expect(venueEntryClassName('sc-rail-venue', false, false)).toBe('sc-rail-venue is-muted');
    expect(venueEntryClassName('sc-rail-venue', true, false)).toBe('sc-rail-venue');
    expect(venueEntryClassName('sc-venue-nav-item', true, true)).toBe('sc-venue-nav-item is-active');
    expect(lightVenueLibrary(emptyVenueLibrary()).lit).toBe(true);
    expect(lightVenueLibrary({ ...emptyVenueLibrary(), lit: true })).toMatchObject({ lit: true, venues: [] });
  });
});
