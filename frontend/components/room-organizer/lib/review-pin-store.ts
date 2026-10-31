/**
 * 场地上的钉，按方案写在本机 localStorage。
 *
 * `/review` 和创作者工作台的评审面读同一份。不写 Supabase，不跨设备。
 * 形状就是 `ReviewPin`：短句、落点、可选物件。没有称呼线程。
 */
import {
  createReviewPin,
  normalizePinText,
  REVIEW_PIN_TEXT_MAX,
  type ReviewPin,
  type ReviewPinStatus,
} from './review-pins';

export const PLAN_PIN_STORAGE_KEY = 'scendance-review-pins-v1';
export const PLAN_PINS_PER_PLAN = 80;
export const PLAN_PIN_PLANS = 40;

export interface PlanPin {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  itemId: string | null;
  floorId: string;
  status: ReviewPinStatus;
  createdAt: string;
}

export type PlanPinFailure = 'text' | 'point' | 'full' | 'storage' | 'plan';

type PinStore = Pick<Storage, 'getItem' | 'setItem'>;

interface PinFile {
  version: 1;
  byPlan: Record<string, PlanPin[]>;
}

const emptyFile = (): PinFile => ({ version: 1, byPlan: {} });

export function readPlanPins(planKey: string, storage: Pick<Storage, 'getItem'> | null): PlanPin[] {
  if (!planKey || !storage) return [];
  return parseFile(storage.getItem(PLAN_PIN_STORAGE_KEY)).byPlan[planKey] ?? [];
}

export function planPinToReviewPin(pin: PlanPin): ReviewPin {
  return {
    id: pin.id,
    text: pin.text,
    itemId: pin.itemId,
    x: pin.x,
    y: pin.y,
    z: pin.z,
    offset: null,
    camera: {
      position: [pin.x + 2.4, pin.y + 2.8, pin.z + 2.4],
      target: [pin.x, pin.y, pin.z],
    },
    status: pin.status,
  };
}

export function mergeFloorPins(current: readonly ReviewPin[], stored: readonly PlanPin[], floorId: string): ReviewPin[] {
  const seen = new Set(current.map(pin => pin.id));
  const incoming = stored
    .filter(pin => pin.floorId === floorId && !seen.has(pin.id))
    .map(planPinToReviewPin);
  return [...current, ...incoming];
}

export function appendPlanPin(
  storage: PinStore,
  input: {
    planKey: string;
    id: string;
    text: string;
    x: number;
    y: number;
    z: number;
    itemId: string | null;
    floorId: string;
    now?: Date;
  },
): { ok: true; pins: PlanPin[]; pin: PlanPin } | { ok: false; reason: PlanPinFailure } {
  const pin = draftPin(input);
  if (!pin) return { ok: false, reason: pinFailure(input) };
  if (!acceptableKey(input.planKey)) return { ok: false, reason: 'plan' };
  let file: PinFile;
  try {
    file = parseFile(storage.getItem(PLAN_PIN_STORAGE_KEY));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  const existing = file.byPlan[input.planKey] ?? [];
  if (existing.length >= PLAN_PINS_PER_PLAN) return { ok: false, reason: 'full' };
  const byPlan = evictPlans({ ...file.byPlan, [input.planKey]: [...existing, pin] }, input.planKey);
  try {
    storage.setItem(PLAN_PIN_STORAGE_KEY, JSON.stringify({ version: 1, byPlan }));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true, pins: byPlan[input.planKey] ?? [], pin };
}

/** 用这一层当前的钉换掉存储里同一层，其它层留着。 */
export function replaceFloorPins(
  storage: PinStore,
  planKey: string,
  floorId: string,
  pins: readonly ReviewPin[],
): { ok: true; pins: PlanPin[] } | { ok: false; reason: 'plan' | 'storage' } {
  if (!acceptableKey(planKey) || !floorId) return { ok: false, reason: 'plan' };
  let file: PinFile;
  try {
    file = parseFile(storage.getItem(PLAN_PIN_STORAGE_KEY));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  const kept = (file.byPlan[planKey] ?? []).filter(pin => pin.floorId !== floorId);
  const nextFloor: PlanPin[] = [];
  for (const pin of pins) {
    if (nextFloor.length + kept.length >= PLAN_PINS_PER_PLAN) break;
    const stored = planPinFromReview(pin, floorId);
    if (stored) nextFloor.push(stored);
  }
  const byPlan = evictPlans({ ...file.byPlan, [planKey]: [...kept, ...nextFloor] }, planKey);
  try {
    storage.setItem(PLAN_PIN_STORAGE_KEY, JSON.stringify({ version: 1, byPlan }));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true, pins: byPlan[planKey] ?? [] };
}

function planPinFromReview(pin: ReviewPin, floorId: string): PlanPin | null {
  const text = normalizePinText(pin.text);
  if (!text || !pin.id || pin.id.length > 80) return null;
  if (!finitePoint(pin.x, pin.y, pin.z)) return null;
  const draft = createReviewPin({
    id: pin.id,
    text,
    draft: {
      itemId: pin.itemId,
      x: pin.x,
      y: pin.y,
      z: pin.z,
      offset: pin.offset,
      camera: pin.camera,
    },
  });
  if (!draft) return null;
  return {
    id: pin.id,
    text,
    x: pin.x,
    y: pin.y,
    z: pin.z,
    itemId: pin.itemId,
    floorId: floorId.slice(0, 80),
    status: pin.status === 'resolved' ? 'resolved' : 'open',
    createdAt: new Date().toISOString(),
  };
}

function draftPin(input: {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  itemId: string | null;
  floorId: string;
  now?: Date;
}): PlanPin | null {
  const text = normalizePinText(input.text);
  if (!text || !input.id || input.id.length > 80 || !input.floorId) return null;
  if (!finitePoint(input.x, input.y, input.z)) return null;
  if (text.length > REVIEW_PIN_TEXT_MAX) return null;
  return {
    id: input.id,
    text,
    x: input.x,
    y: input.y,
    z: input.z,
    itemId: input.itemId,
    floorId: input.floorId.slice(0, 80),
    status: 'open',
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

function pinFailure(input: { id: string; text: string; x: number; y: number; z: number; floorId: string }): PlanPinFailure {
  if (!normalizePinText(input.text)) return 'text';
  if (!finitePoint(input.x, input.y, input.z) || !input.id || !input.floorId) return 'point';
  return 'text';
}

function acceptableKey(planKey: string): boolean {
  return planKey.length > 0 && planKey.length <= 80 && !planKey.includes('\u0000');
}

function finitePoint(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
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
  const byPlan: Record<string, PlanPin[]> = {};
  for (const [key, value] of Object.entries(record.byPlan as Record<string, unknown>)) {
    if (!acceptableKey(key) || !Array.isArray(value)) continue;
    const pins: PlanPin[] = [];
    for (const entry of value) {
      const pin = parsePin(entry);
      if (pin) pins.push(pin);
      if (pins.length >= PLAN_PINS_PER_PLAN) break;
    }
    if (pins.length > 0) byPlan[key] = pins;
  }
  return { version: 1, byPlan };
}

function parsePin(value: unknown): PlanPin | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.length === 0 || record.id.length > 80) return null;
  if (typeof record.text !== 'string' || typeof record.floorId !== 'string' || !record.floorId) return null;
  const text = normalizePinText(record.text);
  if (!text) return null;
  if (typeof record.x !== 'number' || typeof record.y !== 'number' || typeof record.z !== 'number') return null;
  if (!finitePoint(record.x, record.y, record.z)) return null;
  if (record.status !== 'open' && record.status !== 'resolved') return null;
  if (typeof record.createdAt !== 'string') return null;
  const itemId = record.itemId === null ? null : typeof record.itemId === 'string' ? record.itemId : null;
  if (record.itemId !== null && itemId === null) return null;
  return {
    id: record.id,
    text,
    x: record.x,
    y: record.y,
    z: record.z,
    itemId,
    floorId: record.floorId.slice(0, 80),
    status: record.status,
    createdAt: record.createdAt,
  };
}

function evictPlans(byPlan: Record<string, PlanPin[]>, keep: string): Record<string, PlanPin[]> {
  const keys = Object.keys(byPlan);
  if (keys.length <= PLAN_PIN_PLANS) return byPlan;
  const ranked = keys
    .map(key => ({
      key,
      at: (byPlan[key] ?? []).reduce((latest, pin) => (pin.createdAt > latest ? pin.createdAt : latest), ''),
    }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const next: Record<string, PlanPin[]> = {};
  for (const entry of ranked) {
    if (Object.keys(next).length >= PLAN_PIN_PLANS && entry.key !== keep) continue;
    const pins = byPlan[entry.key];
    if (pins) next[entry.key] = pins;
  }
  if (!next[keep] && byPlan[keep]) next[keep] = byPlan[keep];
  return next;
}
