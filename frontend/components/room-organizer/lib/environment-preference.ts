import type { FurnitureItem } from './types';

/**
 * 项目里的高斯空间列表、摆放位置和各场地的物料布置记在本机：不写入结构场景文件，
 * 也不参与云端保存；同一个项目下次打开时会按楼层和坐标重新挂回这些点云。
 * 资产号来自随站点发布的样例或本机取回的环境包，名字只用于抽屉里的那行说明。
 */
export interface StoredEnvironment {
  assetId: string;
  name: string;
  position?: Readonly<{ x: number; y: number; z: number }>;
  /** Zero-based building storey this scanned space belongs to. */
  floorIndex?: number;
  /** Per-floor furniture placement for this Gaussian venue; local project data only. */
  itemsByFloor?: readonly (readonly FurnitureItem[])[];
}

const STORAGE_KEY = 'scendance:environment:v1';
const MAX_ENTRIES = 200;

function isStoredEnvironment(value: unknown): value is StoredEnvironment {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  const position = entry.position;
  const itemsByFloor = entry.itemsByFloor;
  const validPosition = position === undefined || (typeof position === 'object' && position !== null &&
    ['x', 'y', 'z'].every(axis => typeof (position as Record<string, unknown>)[axis] === 'number' && Number.isFinite((position as Record<string, number>)[axis])));
  const validItems = itemsByFloor === undefined || (Array.isArray(itemsByFloor) && itemsByFloor.length <= 8 &&
    itemsByFloor.every(floor => Array.isArray(floor) && floor.length <= 1000 && floor.every(item => {
      if (typeof item !== 'object' || item === null) return false;
      const candidate = item as Record<string, unknown>;
      const itemPosition = candidate.position;
      return typeof candidate.id === 'string' && typeof candidate.type === 'string' &&
        ['width', 'depth', 'height'].every(key => typeof candidate[key] === 'number' && Number.isFinite(candidate[key])) &&
        (itemPosition === undefined || (typeof itemPosition === 'object' && itemPosition !== null &&
          ['x', 'z'].every(axis => typeof (itemPosition as Record<string, unknown>)[axis] === 'number' && Number.isFinite((itemPosition as Record<string, number>)[axis]))));
    })));
  return typeof entry.assetId === 'string' && entry.assetId.length > 0 && entry.assetId.length <= 120 &&
    typeof entry.name === 'string' && entry.name.length <= 120 && validPosition && validItems &&
    (entry.floorIndex === undefined || (Number.isInteger(entry.floorIndex) && (entry.floorIndex as number) >= 0 && (entry.floorIndex as number) < 8));
}

type EnvironmentChoice = StoredEnvironment | StoredEnvironment[] | null;

function isEnvironmentList(value: unknown): value is StoredEnvironment[] {
  return Array.isArray(value) && value.length <= 24 && value.every(isStoredEnvironment);
}

function readAll(): Record<string, EnvironmentChoice> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, EnvironmentChoice] =>
      entry[1] === null || isStoredEnvironment(entry[1]) || isEnvironmentList(entry[1])));
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, EnvironmentChoice>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // 配额满了只是这次记不住环境，画布照常挂，不打断编辑。
  }
}

export function environmentPreferenceKey(layoutId: string | undefined): string {
  return layoutId ?? 'draft';
}

export function readEnvironment(layoutId: string | undefined): StoredEnvironment | null {
  const value = readAll()[environmentPreferenceKey(layoutId)];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

/** Read multiple scanned spaces while migrating the previous single-space record transparently. */
export function readEnvironments(layoutId: string | undefined): StoredEnvironment[] {
  const value = readAll()[environmentPreferenceKey(layoutId)];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** distinguishes a first visit (use the project default) from an intentional clear. */
export function hasEnvironmentPreference(layoutId: string | undefined): boolean {
  return Object.hasOwn(readAll(), environmentPreferenceKey(layoutId));
}

export function writeEnvironment(layoutId: string | undefined, value: StoredEnvironment): void {
  writeEnvironments(layoutId, [value]);
}

export function writeEnvironments(layoutId: string | undefined, values: readonly StoredEnvironment[]): void {
  const all = readAll();
  const key = environmentPreferenceKey(layoutId);
  const entries = { ...all, [key]: [...values].slice(0, 24) };
  const keys = Object.keys(entries);
  if (keys.length > MAX_ENTRIES) {
    for (const stale of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[stale];
  }
  writeAll(entries);
}

export function clearEnvironment(layoutId: string | undefined): void {
  const all = readAll();
  const key = environmentPreferenceKey(layoutId);
  if (Object.hasOwn(all, key) && all[key] === null) return;
  // Keep a tombstone so an explicitly cleared project does not get the default scene back on reload.
  all[key] = null;
  writeAll(all);
}
