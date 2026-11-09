import {captureWorkspaceWriteFence,resolveWorkspaceWriteCapability} from '@/lib/workspace-write-fence';
import { localWriteCapabilityGuard, type LocalWriteCapability } from '@/lib/local-write-lease';
import { LIBRARY_PENDING_KEY } from '@/lib/library-pending';
import { safeGetItem, safeRemoveItem } from './safe-storage';
import { MAX_NAME_LENGTH, capText, parseStoredLayout } from './schema';
import { setItemEvictingSnapshots } from './version-history';
import type { RoomLayout, SavedLayoutEntry } from './types';

const LIBRARY_KEY_PREFIX = 'standalone-room-organizer-library:';
const LIBRARY_INDEX_KEY = `${LIBRARY_KEY_PREFIX}_index`;

interface LibraryIndex {
  entries: SavedLayoutEntry[];
  /**
   * Index values that aren't a valid entry, kept verbatim (#348): the panel
   * never sees them, and every rewrite carries them through so the raw index
   * stays recoverable. An index of the wrong shape is kept as one such value
   * (the raw string when it isn't even JSON).
   */
  unreadable: unknown[];
  /** Other top-level fields of the stored index, written back untouched. */
  rest: Record<string, unknown>;
  /**
   * The stored object behind each listed entry, by id: fields this version
   * doesn't know survive a rewrite instead of being rebuilt away.
   */
  raw: Map<string, Record<string, unknown>>;
}

function emptyIndex(): LibraryIndex {
  return { entries: [], unreadable: [], rest: {}, raw: new Map() };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** One index entry, or null when it can't be listed without throwing (#348). */
export function parseSavedLayoutEntry(value: unknown): SavedLayoutEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id === '') return null;
  if (typeof v.name !== 'string') return null;
  if (!isFiniteNumber(v.savedAt) || !isFiniteNumber(v.itemCount) || !isFiniteNumber(v.floorCount)) {
    return null;
  }
  return { id: v.id, name: v.name, savedAt: v.savedAt, itemCount: v.itemCount, floorCount: v.floorCount };
}

/** Pure half of `readIndex`, exported for tests. */
export function parseLibraryIndex(raw: string | null): LibraryIndex {
  if (!raw) return emptyIndex();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...emptyIndex(), unreadable: [raw] };
  }
  if (parsed === null) return emptyIndex();
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...emptyIndex(), unreadable: [parsed] };
  }
  const { entries: stored, ...rest } = parsed as Record<string, unknown>;
  if (!Array.isArray(stored)) return { ...emptyIndex(), unreadable: [parsed] };
  const entries: SavedLayoutEntry[] = [];
  const unreadable: unknown[] = [];
  const rawById = new Map<string, Record<string, unknown>>();
  for (const candidate of stored as unknown[]) {
    const entry = parseSavedLayoutEntry(candidate);
    if (!entry || rawById.has(entry.id)) {
      unreadable.push(candidate);
      continue;
    }
    rawById.set(entry.id, candidate as Record<string, unknown>);
    entries.push(entry);
  }
  return { entries, unreadable, rest, raw: rawById };
}

function readIndex(): LibraryIndex {
  if (typeof window === 'undefined') return emptyIndex();
  return parseLibraryIndex(safeGetItem(LIBRARY_INDEX_KEY));
}

function indexText(index: LibraryIndex): string {
  const entries: unknown[] = [
    ...index.entries.map((entry) => ({ ...index.raw.get(entry.id), ...entry })),
    ...index.unreadable,
  ];
  return JSON.stringify({ ...index.rest, entries });
}
function writeIndex(index: LibraryIndex): void {
  if (typeof window === 'undefined') return;
  setItemEvictingSnapshots(window.localStorage, LIBRARY_INDEX_KEY, indexText(index));
}

const PENDING_KEY = LIBRARY_PENDING_KEY;
type PendingLibraryChange = { version: 1; key: string; beforeBlob: string | null; beforeIndex: string | null; afterBlob: string | null; afterIndex: string };
function checkedChange(value: unknown): value is PendingLibraryChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  return x.version === 1 && typeof x.key === 'string' && x.key.startsWith(LIBRARY_KEY_PREFIX) && x.key !== LIBRARY_INDEX_KEY && x.key !== PENDING_KEY &&
    nullableString(x.beforeBlob) && nullableString(x.beforeIndex) && nullableString(x.afterBlob) && typeof x.afterIndex === 'string';
}
function guardedStorage(capability: LocalWriteCapability) {
  const guard = localWriteCapabilityGuard(capability);
  const fence=captureWorkspaceWriteFence(capability);
  return { check: () => { fence?.(); guard.assertStillHeld(); if (guard.signal.aborted) throw new Error('本机编辑权已失效'); } };
}
/** Return a partial guarded save/delete to its prior state without touching a newer conflicting edit. */
export function recoverNamedLayoutChange(capability: LocalWriteCapability): boolean {
  try {
    const { check } = guardedStorage(capability); check();
    const storage = window.localStorage, raw = storage.getItem(PENDING_KEY);
    if (raw === null) return true;
    const change: unknown = JSON.parse(raw);
    if (!checkedChange(change)) return false;
    const blob = storage.getItem(change.key), index = storage.getItem(LIBRARY_INDEX_KEY);
    if ((blob !== change.beforeBlob && blob !== change.afterBlob) || (index !== change.beforeIndex && index !== change.afterIndex)) return false;
    const restore = (key: string, value: string | null) => { check(); if (value === null) storage.removeItem(key); else storage.setItem(key, value); check(); };
    restore(change.key, change.beforeBlob); restore(LIBRARY_INDEX_KEY, change.beforeIndex);
    check(); storage.removeItem(PENDING_KEY);
    return true;
  } catch { return false; }
}
function guardedChange(change: PendingLibraryChange, capability: LocalWriteCapability): boolean {
  try {
    const { check } = guardedStorage(capability), storage = window.localStorage;
    check(); if (storage.getItem(PENDING_KEY) !== null || storage.getItem(change.key) !== change.beforeBlob || storage.getItem(LIBRARY_INDEX_KEY) !== change.beforeIndex) return false;
    const marker = JSON.stringify(change);
    check(); storage.setItem(PENDING_KEY, marker); check();
    if (storage.getItem(PENDING_KEY) !== marker) throw new Error('方案库核对记录未能读回');
    if (change.afterBlob === null) storage.removeItem(change.key); else storage.setItem(change.key, change.afterBlob);
    check(); storage.setItem(LIBRARY_INDEX_KEY, change.afterIndex); check();
    storage.removeItem(PENDING_KEY);
    return true;
  } catch { return false; }
}

/** The id an unreadable index value still names, if any. */
function unreadableId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && id !== '' ? id : null;
}

function layoutKey(id: string): string {
  return `${LIBRARY_KEY_PREFIX}${id}`;
}

const SLUG_MAX_LENGTH = 40;

/**
 * Deterministic 6-char base36 digest, used to keep truncated slugs distinct.
 * Not cryptographic — just enough that two long names sharing a 40-char
 * prefix don't silently map to the same save slot.
 */
function shortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

export function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return `layout-${Date.now()}`;
  // Short names keep their historical slug unchanged, so existing library
  // saves are unaffected. Only when truncation would discard part of the name
  // do we append a hash of the FULL name to disambiguate.
  if (base.length <= SLUG_MAX_LENGTH) return base;
  return `${base.slice(0, SLUG_MAX_LENGTH)}-${shortHash(base)}`;
}

/**
 * Whether saving under `name` would overwrite a stored blob — including one
 * whose index entry is unreadable, so a hidden house is never replaced
 * without the overwrite prompt.
 */
export function layoutSlugExists(name: string): boolean {
  const id = slugify(name);
  const index = readIndex();
  return (
    index.entries.some((entry) => entry.id === id) ||
    index.unreadable.some((value) => unreadableId(value) === id)
  );
}

/** Saved layouts, newest first; malformed index entries are left out (#348). Never throws. */
export function listSavedLayouts(): SavedLayoutEntry[] {
  return readIndex().entries.sort((a, b) => b.savedAt - a.savedAt);
}

/** How many index values the library can't list (#348); they stay in storage. */
export function countUnreadableSavedLayouts(): number {
  return readIndex().unreadable.length;
}

export interface SaveResult {
  entry: SavedLayoutEntry;
  overwrote: boolean;
}

function totalItemCount(layout: RoomLayout): number {
  return layout.floors.reduce((sum, floor) => sum + floor.items.length, 0);
}

/**
 * Returns `null` when localStorage rejects the write (typically
 * QuotaExceededError — library entries embed the base64 floor-plan image, so
 * running out of the ~5MB quota is realistic). The layout blob and the index
 * are kept consistent: if the index write fails, the blob is rolled back.
 * Automatic restore points are evicted before a save is refused (#295).
 */
export function saveNamedLayout(layout: RoomLayout, name: string, capability?: LocalWriteCapability): SaveResult | null {
  try { capability=resolveWorkspaceWriteCapability(capability); } catch { return null; }
  try { if (window.localStorage.getItem(PENDING_KEY) !== null) return null; } catch { return null; }
  const trimmed = name.trim() || layout.name || 'Untitled';
  // The slot comes from the full name, as it always has; the stored name is
  // capped like the schema caps it, so the saved house parses unchanged.
  const id = slugify(trimmed);
  const shown = capText(trimmed, MAX_NAME_LENGTH);
  let beforeIndex: string | null;
  try { beforeIndex = window.localStorage.getItem(LIBRARY_INDEX_KEY); } catch { return null; }
  const index = capability === undefined ? readIndex() : parseLibraryIndex(beforeIndex);
  const existingIndex = index.entries.findIndex((entry) => entry.id === id);

  const entry: SavedLayoutEntry = {
    id,
    name: shown,
    savedAt: Date.now(),
    itemCount: totalItemCount(layout),
    floorCount: layout.floors.length,
  };

  // The house keeps its own id: the slug names the library slot, and two
  // houses saved under one name in turn are still different houses (#342).
  const layoutCopy: RoomLayout = { ...layout, name: shown };
  let previousBlob: string | null;
  try { previousBlob = window.localStorage.getItem(layoutKey(id)); } catch { return null; }
  if (capability !== undefined) {
    if (existingIndex >= 0) index.entries[existingIndex] = entry; else index.entries.push(entry);
    const unreadable = index.unreadable.filter(value => unreadableId(value) !== id);
    const success = guardedChange({ version: 1, key: layoutKey(id), beforeBlob: previousBlob,
      beforeIndex, afterBlob: JSON.stringify(layoutCopy),
      afterIndex: indexText({ ...index, unreadable }) }, capability);
    return success ? { entry, overwrote: existingIndex >= 0 } : null;
  }
  try {
    setItemEvictingSnapshots(window.localStorage, layoutKey(id), JSON.stringify(layoutCopy));
  } catch {
    return null;
  }

  if (existingIndex >= 0) {
    index.entries[existingIndex] = entry;
  } else {
    index.entries.push(entry);
  }
  // An unreadable entry naming this slot described the blob just replaced.
  const unreadable = index.unreadable.filter((value) => unreadableId(value) !== id);
  try {
    writeIndex({ ...index, unreadable });
  } catch {
    // Best-effort rollback: restoring the blob can ITSELF hit the quota that
    // just failed the index write — never let that escape the save call (#122).
    try {
      if (previousBlob === null) window.localStorage.removeItem(layoutKey(id));
      else window.localStorage.setItem(layoutKey(id), previousBlob);
    } catch {
      /* quota still exhausted — the stale blob stays but the index is intact */
    }
    return null;
  }

  return { entry, overwrote: existingIndex >= 0 };
}

export function loadNamedLayout(id: string): RoomLayout | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(layoutKey(id));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parseStoredLayout(parsed);
  } catch {
    return null;
  }
}

export function deleteNamedLayout(id: string, capability?: LocalWriteCapability): boolean {
  if (typeof window === 'undefined') return false;
  try { capability=resolveWorkspaceWriteCapability(capability); } catch { return false; }
  try { if (window.localStorage.getItem(PENDING_KEY) !== null) return false; } catch { return false; }
  let beforeIndex: string | null;
  try { beforeIndex = window.localStorage.getItem(LIBRARY_INDEX_KEY); } catch { return false; }
  const index = capability === undefined ? readIndex() : parseLibraryIndex(beforeIndex);
  const filtered = index.entries.filter((entry) => entry.id !== id);
  if (filtered.length === index.entries.length) return false;
  // Index first, blob second: the old order removed the blob and then let a
  // quota throw out of writeIndex, leaving a ghost index entry whose layout
  // was already gone (#122). removeItem itself cannot hit quota.
  // A second index entry for this id named the blob being removed: dropped
  // with it, or it would list a house that can no longer load.
  const unreadable = index.unreadable.filter((value) => unreadableId(value) !== id);
  if (capability !== undefined) {
    let beforeBlob: string | null;
    try { beforeBlob = window.localStorage.getItem(layoutKey(id)); } catch { return false; }
    return guardedChange({ version: 1, key: layoutKey(id), beforeBlob, beforeIndex, afterBlob: null,
      afterIndex: indexText({ ...index, entries: filtered, unreadable }) }, capability);
  }
  try {
    writeIndex({ ...index, entries: filtered, unreadable });
  } catch {
    return false;
  }
  safeRemoveItem(layoutKey(id));
  return true;
}
