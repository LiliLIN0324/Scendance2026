/**
 * 可评论方案页的议题钉存储（与工作台 review-pins 模型一致）。
 *
 * 演示持久化：本机 localStorage，键名 `REVIEW_SHARE_PIN_STORAGE_KEY`。
 * 刷新后仍在；不写 Supabase，不跨设备。
 */

import {
  createReviewPin,
  type ReviewCamera,
  type ReviewPin,
  type ReviewPinDraft,
  type ReviewPinStatus,
} from '../room-organizer/lib/review-pins';

export const REVIEW_SHARE_PIN_STORAGE_KEY = 'scendance-review-share-pins-v1';
export const REVIEW_SHARE_PINS_PER_PLAN = 80;
export const REVIEW_SHARE_PIN_PLANS = 40;

export type ReviewSharePinFailure = 'text' | 'full' | 'storage' | 'plan' | 'draft';

export type AppendReviewSharePinResult =
  | { ok: true; pins: ReviewPin[]; pin: ReviewPin }
  | { ok: false; reason: ReviewSharePinFailure };

interface PinFile {
  version: 1;
  byPlan: Record<string, ReviewPin[]>;
}

type PinStore = Pick<Storage, 'getItem' | 'setItem'>;

const emptyFile = (): PinFile => ({ version: 1, byPlan: {} });

export function readReviewSharePins(
  planKey: string,
  storage: Pick<Storage, 'getItem'> | null,
): ReviewPin[] {
  const file = parseFile(storage?.getItem(REVIEW_SHARE_PIN_STORAGE_KEY) ?? null);
  return file.byPlan[planKey] ?? [];
}

export function appendReviewSharePin(
  storage: PinStore,
  input: {
    planKey: string;
    text: string;
    draft: ReviewPinDraft;
    id?: string;
  },
): AppendReviewSharePinResult {
  if (!input.planKey || input.planKey.length > 80) return { ok: false, reason: 'plan' };
  const pin = createReviewPin({ id: input.id ?? newPinId(), text: input.text, draft: input.draft });
  if (!pin) return { ok: false, reason: 'text' };

  let file: PinFile;
  try {
    file = parseFile(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  const existing = file.byPlan[input.planKey] ?? [];
  if (existing.length >= REVIEW_SHARE_PINS_PER_PLAN) return { ok: false, reason: 'full' };

  const byPlan = evictPlans({ ...file.byPlan, [input.planKey]: [...existing, pin] }, input.planKey);
  const next: PinFile = { version: 1, byPlan };
  try {
    storage.setItem(REVIEW_SHARE_PIN_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true, pins: byPlan[input.planKey] ?? [], pin };
}

function newPinId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseFile(raw: string | null): PinFile {
  if (!raw) return emptyFile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyFile();
  }
  if (!parsed || typeof parsed !== 'object') return emptyFile();
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !record.byPlan || typeof record.byPlan !== 'object') return emptyFile();
  const byPlan: Record<string, ReviewPin[]> = {};
  for (const [planKey, value] of Object.entries(record.byPlan as Record<string, unknown>)) {
    if (!planKey || planKey.length > 80 || !Array.isArray(value)) continue;
    byPlan[planKey] = value.filter(isPin).slice(0, REVIEW_SHARE_PINS_PER_PLAN);
  }
  return { version: 1, byPlan };
}

function isPin(value: unknown): value is ReviewPin {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id || row.id.length > 80) return false;
  if (typeof row.text !== 'string' || !row.text.trim() || [...row.text].length > 80) return false;
  if (row.itemId !== null && (typeof row.itemId !== 'string' || !row.itemId)) return false;
  if (typeof row.x !== 'number' || typeof row.y !== 'number' || typeof row.z !== 'number') return false;
  if (row.offset !== null && !isOffset(row.offset)) return false;
  if (!isCamera(row.camera)) return false;
  return row.status === 'open' || row.status === 'resolved';
}

function isOffset(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isCamera(value: unknown): value is ReviewCamera {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return isTriple(row.position) && isTriple(row.target);
}

function isTriple(value: unknown): value is readonly [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function evictPlans(byPlan: Record<string, ReviewPin[]>, keep: string): Record<string, ReviewPin[]> {
  const keys = Object.keys(byPlan);
  if (keys.length <= REVIEW_SHARE_PIN_PLANS) return byPlan;
  const ranked = keys
    .filter((key) => key !== keep)
    .sort((left, right) => (byPlan[right]?.length ?? 0) - (byPlan[left]?.length ?? 0) || left.localeCompare(right));
  const drop = new Set(ranked.slice(0, keys.length - REVIEW_SHARE_PIN_PLANS));
  const next: Record<string, ReviewPin[]> = {};
  for (const key of keys) {
    if (!drop.has(key)) next[key] = byPlan[key] ?? [];
  }
  return next;
}

export type { ReviewPin, ReviewPinDraft, ReviewPinStatus };
