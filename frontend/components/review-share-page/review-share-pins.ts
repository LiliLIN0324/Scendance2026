/**
 * 甲方分享页的画内议题钉。与开发端 Bingo 收件箱共用 planKey。
 */
import { normalizePinText, REVIEW_PIN_TEXT_MAX } from '../room-organizer/lib/review-pins';

export const REVIEW_SHARE_PINS_KEY = 'scendance-review-share-pins-v1';
export const REVIEW_SHARE_PIN_AUTHOR_MAX = 24;
export const REVIEW_SHARE_PINS_PER_PLAN = 80;
export const REVIEW_SHARE_PIN_PLANS = 40;

export interface ReviewSharePin {
  id: string;
  planKey: string;
  floorId: string;
  itemId: string | null;
  x: number;
  z: number;
  author: string;
  text: string;
  createdAt: string;
}

type PinFile = {
  version: 1;
  lastAuthor: string;
  byPlan: Record<string, ReviewSharePin[]>;
};

export type AddReviewSharePinResult =
  | { ok: true; pins: ReviewSharePin[]; pin: ReviewSharePin; lastAuthor: string }
  | { ok: false; reason: 'author' | 'text' | 'plan' | 'full' | 'storage' };

const emptyFile = (): PinFile => ({ version: 1, lastAuthor: '', byPlan: {} });

export function readReviewSharePins(
  planKey: string,
  storage: Pick<Storage, 'getItem'> | null,
): { pins: ReviewSharePin[]; lastAuthor: string } {
  const file = parseFile(storage?.getItem(REVIEW_SHARE_PINS_KEY) ?? null);
  return { pins: file.byPlan[planKey] ?? [], lastAuthor: file.lastAuthor };
}

export function addReviewSharePin(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  input: {
    planKey: string;
    floorId: string;
    itemId: string | null;
    x: number;
    z: number;
    author: string;
    text: string;
    id?: string;
    now?: Date;
  },
): AddReviewSharePinResult {
  if (!input.planKey || input.planKey.length > 80) return { ok: false, reason: 'plan' };
  const author = clean(input.author, REVIEW_SHARE_PIN_AUTHOR_MAX);
  const text = normalizePinText(input.text);
  if (!author) return { ok: false, reason: 'author' };
  if (!text) return { ok: false, reason: 'text' };
  if (!Number.isFinite(input.x) || !Number.isFinite(input.z)) return { ok: false, reason: 'plan' };

  let file: PinFile;
  try {
    file = parseFile(storage.getItem(REVIEW_SHARE_PINS_KEY));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  const existing = file.byPlan[input.planKey] ?? [];
  if (existing.length >= REVIEW_SHARE_PINS_PER_PLAN) return { ok: false, reason: 'full' };

  const pin: ReviewSharePin = {
    id: input.id ?? crypto.randomUUID(),
    planKey: input.planKey,
    floorId: input.floorId,
    itemId: input.itemId,
    x: input.x,
    z: input.z,
    author,
    text,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  const byPlan = evictPlans({ ...file.byPlan, [input.planKey]: [...existing, pin] }, input.planKey);
  const next: PinFile = { version: 1, lastAuthor: author, byPlan };
  try {
    storage.setItem(REVIEW_SHARE_PINS_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true, pins: byPlan[input.planKey] ?? [], pin, lastAuthor: author };
}

function parseFile(raw: string | null): PinFile {
  if (!raw) return emptyFile();
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object') return emptyFile();
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || typeof record.byPlan !== 'object' || !record.byPlan) return emptyFile();
  const byPlan: Record<string, ReviewSharePin[]> = {};
  for (const [key, value] of Object.entries(record.byPlan as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const pins: ReviewSharePin[] = [];
    for (const entry of value) {
      const pin = parsePin(entry);
      if (pin) pins.push(pin);
    }
    if (pins.length) byPlan[key] = pins;
  }
  return {
    version: 1,
    lastAuthor: typeof record.lastAuthor === 'string' ? record.lastAuthor : '',
    byPlan,
  };
}

function parsePin(value: unknown): ReviewSharePin | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.planKey !== 'string') return null;
  if (typeof record.floorId !== 'string' || typeof record.text !== 'string') return null;
  if (typeof record.author !== 'string' || typeof record.createdAt !== 'string') return null;
  if (!Number.isFinite(record.x) || !Number.isFinite(record.z)) return null;
  return {
    id: record.id,
    planKey: record.planKey,
    floorId: record.floorId,
    itemId: typeof record.itemId === 'string' ? record.itemId : null,
    x: record.x as number,
    z: record.z as number,
    author: record.author,
    text: record.text,
    createdAt: record.createdAt,
  };
}

function evictPlans(byPlan: Record<string, ReviewSharePin[]>, keepKey: string): Record<string, ReviewSharePin[]> {
  const keys = Object.keys(byPlan);
  if (keys.length <= REVIEW_SHARE_PIN_PLANS) return byPlan;
  const ranked = keys
    .map(key => ({
      key,
      last: byPlan[key]?.[byPlan[key]!.length - 1]?.createdAt ?? '',
    }))
    .sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
  const drop = new Set(ranked.slice(REVIEW_SHARE_PIN_PLANS).map(entry => entry.key));
  drop.delete(keepKey);
  const next = { ...byPlan };
  for (const key of drop) delete next[key];
  return next;
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}
