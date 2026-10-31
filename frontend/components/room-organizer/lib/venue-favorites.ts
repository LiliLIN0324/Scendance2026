/** 场地库里标过收藏的模板场馆。只记预设 key，空白场地不进收藏。 */
import { SCENE_PRESET_KEYS, type ScenePresetKey } from './scene-presets';

export const VENUE_FAVORITE_KEY = 'scendance.venueFavorites.v1';

const KNOWN = new Set<string>(SCENE_PRESET_KEYS);

type FavoriteStore = Pick<Storage, 'getItem' | 'setItem'>;

export function readVenueFavorites(storage: Pick<Storage, 'getItem'> | null): ScenePresetKey[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(VENUE_FAVORITE_KEY) ?? 'null');
    if (!Array.isArray(parsed)) return [];
    const keys: ScenePresetKey[] = [];
    for (const value of parsed) {
      if (typeof value === 'string' && KNOWN.has(value)) keys.push(value as ScenePresetKey);
    }
    return keys;
  } catch {
    return [];
  }
}

export function toggleVenueFavorite(storage: FavoriteStore, key: ScenePresetKey): ScenePresetKey[] {
  if (!KNOWN.has(key)) return readVenueFavorites(storage);
  const current = readVenueFavorites(storage);
  const next = current.includes(key) ? current.filter(item => item !== key) : [key, ...current];
  try {
    storage.setItem(VENUE_FAVORITE_KEY, JSON.stringify(next));
  } catch {
    return current;
  }
  return next;
}
