/**
 * 经营地点库的本机状态。
 *
 * 场地不是另一套主流程：开局可以没有场，入口保持灰。
 * 用户要 3D 布置或进入空间时才点亮。收藏与点亮都写这一把 localStorage，
 * 不进画布撤销，不接真实模型。
 */

import { safeGetItem, safeSetItem } from './safe-storage';

export const VENUE_LIBRARY_STORAGE_KEY = 'scendance.venue-library.v1';
export const VENUE_LIBRARY_VERSION = 1;
export const VENUE_LIBRARY_EVENT = 'scendance-venue-library';
export const VENUE_LIBRARY_MAX = 24;
export const VENUE_LIGHT_HINT = '需要 3D 时会点亮场地';

export interface VenueTemplate {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly swatch: string;
}

/** 库可以是空的。这几条是我们准备 / 合作的参观壳，不是用户的场。 */
export const VENUE_TEMPLATES: readonly VenueTemplate[] = [
  { id: 'tavern-night', name: '夜市酒馆壳', blurb: '合作模板 · 室内吧台，可先参观', swatch: '#3a2a1c' },
  { id: 'hall-day', name: '白日展厅壳', blurb: '我们准备的空展墙，可当布置底', swatch: '#c5ced6' },
  { id: 'yard-lantern', name: '灯会庭院壳', blurb: '合作模板 · 户外庭院轮廓', swatch: '#3d4f38' },
];

export interface SavedVenue {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly swatch: string;
  readonly templateId: string;
  readonly savedAt: number;
}

export interface VenueLibraryState {
  readonly version: typeof VENUE_LIBRARY_VERSION;
  readonly lit: boolean;
  readonly venues: readonly SavedVenue[];
}

export function emptyVenueLibrary(): VenueLibraryState {
  return { version: VENUE_LIBRARY_VERSION, lit: false, venues: [] };
}

export function venueTemplateById(id: string): VenueTemplate | null {
  return VENUE_TEMPLATES.find(item => item.id === id) ?? null;
}

/** 轨上的灰态和打开态。未点亮保持 is-muted；面板开着再加 is-active。 */
export function venueEntryClassName(base: string, lit: boolean, open: boolean): string {
  return `${base}${open ? ' is-active' : ''}${lit ? '' : ' is-muted'}`;
}

export function lightVenueLibrary(state: VenueLibraryState): VenueLibraryState {
  if (state.lit) return state;
  return { ...state, lit: true };
}

export function saveVenueFromTemplate(state: VenueLibraryState, templateId: string, now: number): VenueLibraryState {
  const template = venueTemplateById(templateId);
  if (!template) return state;
  if (state.venues.some(item => item.templateId === templateId)) return state;
  const saved: SavedVenue = {
    id: `mine-${templateId}`,
    name: template.name,
    blurb: template.blurb,
    swatch: template.swatch,
    templateId,
    savedAt: now,
  };
  return { ...state, venues: [...state.venues, saved].slice(-VENUE_LIBRARY_MAX) };
}

export function parseVenueLibrary(raw: string): VenueLibraryState | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== VENUE_LIBRARY_VERSION || typeof record.lit !== 'boolean' || !Array.isArray(record.venues)) return null;
  const venues: SavedVenue[] = [];
  const seen = new Set<string>();
  for (const row of record.venues) {
    const venue = parseSavedVenue(row);
    if (!venue || seen.has(venue.id) || seen.has(venue.templateId)) continue;
    seen.add(venue.id);
    seen.add(venue.templateId);
    venues.push(venue);
  }
  return { version: VENUE_LIBRARY_VERSION, lit: record.lit, venues: venues.slice(-VENUE_LIBRARY_MAX) };
}

export function readVenueLibrary(storage?: Storage): VenueLibraryState {
  const raw = storage === undefined
    ? safeGetItem(VENUE_LIBRARY_STORAGE_KEY)
    : safeGetItem(VENUE_LIBRARY_STORAGE_KEY, storage);
  if (raw == null) return emptyVenueLibrary();
  return parseVenueLibrary(raw) ?? emptyVenueLibrary();
}

export function writeVenueLibrary(state: VenueLibraryState, storage?: Storage): boolean {
  const payload = JSON.stringify({
    version: state.version,
    lit: state.lit,
    venues: state.venues,
  });
  return storage === undefined
    ? safeSetItem(VENUE_LIBRARY_STORAGE_KEY, payload)
    : safeSetItem(VENUE_LIBRARY_STORAGE_KEY, payload, storage);
}

export function publishVenueLibrary(state: VenueLibraryState, storage?: Storage): boolean {
  const ok = writeVenueLibrary(state, storage);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VENUE_LIBRARY_EVENT));
  return ok;
}

/** 布置、进入场景或 3D 入口被点到。已经亮过就不再写。 */
export function noteVenueThreeIntent(storage?: Storage): VenueLibraryState {
  const current = readVenueLibrary(storage);
  const next = lightVenueLibrary(current);
  if (next !== current) publishVenueLibrary(next, storage);
  return next;
}

function parseSavedVenue(row: unknown): SavedVenue | null {
  if (!row || typeof row !== 'object') return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.name !== 'string' || typeof record.blurb !== 'string') return null;
  if (typeof record.swatch !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(record.swatch)) return null;
  if (typeof record.templateId !== 'string') return null;
  if (typeof record.savedAt !== 'number' || !Number.isFinite(record.savedAt)) return null;
  const id = record.id.trim();
  const name = record.name.trim();
  const templateId = record.templateId.trim();
  if (!id || !name || !templateId || id.length > 96 || name.length > 40 || templateId.length > 64) return null;
  const blurb = record.blurb.trim();
  if (!blurb || blurb.length > 80) return null;
  return { id, name, blurb, swatch: record.swatch.toLowerCase(), templateId, savedAt: record.savedAt };
}
