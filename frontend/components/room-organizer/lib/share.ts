import { layoutForExport } from '../../../lib/layout-export';
import { DELIVERY_VERSION_PATTERN } from './delivery-package-spec';
import {
  contentFingerprintOfShareable,
  deliveryShareableLayout,
  deliveryVersionState,
  snapshotIdFor,
} from './delivery-version';
import { MAX_LAYOUT_JSON_BYTES, parseLayoutEventOperations, parseStoredLayout } from './schema';
import type { RoomLayout } from './types';

const HASH_PREFIX = '#layout=';
/**
 * Version prefix for compressed payloads: `#layout=2.<base64url(deflate-raw(json))>`.
 * Legacy (v1) links carry un-prefixed `base64url(json)`; base64url never contains
 * a dot, so the prefix is unambiguous. Decoding supports both forever; encoding
 * always emits v2.
 */
const V2_PREFIX = '2.';
const MAX_REASONABLE_URL_LENGTH = 12_000;
/**
 * Longest `#layout=…` hash decoding will touch (#332). The app never makes
 * one past MAX_REASONABLE_URL_LENGTH, so this leaves five times that for
 * links from older versions — while a crafted 270 KB hash, which inflates
 * to 200 MB, is refused before a single byte is inflated.
 */
export const MAX_SHARE_HASH_LENGTH = 64 * 1024;

/** Why a share hash didn't open: far too big to be a house, or not readable as one. */
export type ShareDecodeFailure = 'too-large' | 'unreadable';

export type ShareDecodeResult =
  | { ok: true; layout: RoomLayout; identity: ReadPlanShareIdentity | null }
  | { ok: false; reason: ShareDecodeFailure };

/** 链接自带的交付版本身份（SC-10）：旧链接没有这一段，读作 null。 */
export interface PlanShareIdentity {
  deliveryVersion: string;
  snapshotId: string;
  contentFingerprint: string;
  status: 'confirmed' | 'draft';
}

/** 读链接时重算指纹的核对结果；`verified=false` 说明快照号和内容对不上。 */
export interface ReadPlanShareIdentity extends PlanShareIdentity {
  verified: boolean;
}

/** 载荷外壳标记：`{ kind, identity, layout }`；没有这个标记就是旧链接的裸布局。 */
export const PLAN_SHARE_KIND = 'scendance-plan-share';

export interface EncodeShareUrlResult {
  url: string;
  /** True when the layout had a floor-plan image that was stripped to keep the URL compact. */
  strippedFloorPlan: boolean;
  /** 这条链接绑定的版本身份；内容未确认时为草案身份。 */
  identity: PlanShareIdentity;
}

export async function encodeShareUrl(
  layout: RoomLayout,
  origin: string
): Promise<EncodeShareUrlResult> {
  const stripped = layout.floorPlanImage !== undefined;
  const checked = parseLayoutEventOperations(layout);
  if (!checked) throw new Error('制作计划或活动安排无效，请先核对后再分享。');
  const shareable = deliveryShareableLayout(checked);

  const identity = await planShareIdentity(shareable);
  const json = JSON.stringify({ kind: PLAN_SHARE_KIND, identity, layout: shareable });
  const compressed = await deflateRaw(new TextEncoder().encode(json));
  const encoded = `${V2_PREFIX}${bytesToBase64Url(compressed)}`;
  return { url: `${origin}${HASH_PREFIX}${encoded}`, strippedFloorPlan: stripped, identity };
}

/**
 * True when a URL hash carries a share payload (starts with `#layout=`),
 * regardless of whether that payload decodes cleanly. Lets callers distinguish
 * "no share link" from "a share link that failed to decode" so a corrupt link
 * can surface user feedback instead of silently falling back to the local save.
 */
export function isShareHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX) && hash.length > HASH_PREFIX.length;
}

/** True when a share hash is short enough to be worth decoding at all (#332). */
export function isShareHashWithinBudget(hash: string): boolean {
  return hash.length <= MAX_SHARE_HASH_LENGTH;
}

export async function decodeShareUrl(hash: string): Promise<RoomLayout | null> {
  const result = await readShareHash(hash);
  return result.ok ? result.layout : null;
}

/**
 * `decodeShareUrl` that says why it failed. A hash over the length budget is
 * refused before decoding, and the inflated payload is read in chunks and
 * dropped as soon as it passes MAX_LAYOUT_JSON_BYTES, so a deflate bomb
 * costs a few milliseconds instead of the tab (#332).
 */
export async function readShareHash(hash: string): Promise<ShareDecodeResult> {
  if (!isShareHash(hash)) return { ok: false, reason: 'unreadable' };
  if (!isShareHashWithinBudget(hash)) return { ok: false, reason: 'too-large' };
  const encoded = hash.slice(HASH_PREFIX.length);
  try {
    const jsonBytes = encoded.startsWith(V2_PREFIX)
      ? await inflateRawBounded(base64UrlToBytes(encoded.slice(V2_PREFIX.length)), MAX_LAYOUT_JSON_BYTES)
      : base64UrlToBytes(encoded);
    if (!jsonBytes) return { ok: false, reason: 'too-large' };
    // fatal: true so truncated/garbage byte sequences throw here (→ null)
    // instead of silently decoding to replacement characters.
    const json = new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes);
    const parsed: unknown = JSON.parse(json);
    const envelope = readPlanShareEnvelope(parsed);
    const layout = parseStoredLayout(envelope ? envelope.layout : parsed);
    if (!layout) return { ok: false, reason: 'unreadable' };
    const exported = layoutForExport(layout, true);
    const identity = envelope?.identity ? await verifyPlanShareIdentity(envelope.identity, exported) : null;
    return { ok: true, layout: exported, identity };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export function isShareUrlReasonablySized(url: string): boolean {
  return url.length <= MAX_REASONABLE_URL_LENGTH;
}

async function planShareIdentity(shareable: RoomLayout): Promise<PlanShareIdentity> {
  const state = await deliveryVersionState({ layout: shareable, storage: shareStorage() });
  return {
    deliveryVersion: state.deliveryVersion,
    snapshotId: state.snapshotId,
    contentFingerprint: state.contentFingerprint,
    status: state.status === 'confirmed' ? 'confirmed' : 'draft',
  };
}

function shareStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readPlanShareEnvelope(value: unknown): { identity: PlanShareIdentity | null; layout: unknown } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== PLAN_SHARE_KIND) return null;
  if (!record.layout || typeof record.layout !== 'object') return null;
  const identity = parsePlanShareIdentity(record.identity);
  return { identity, layout: record.layout };
}

function parsePlanShareIdentity(value: unknown): PlanShareIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const deliveryVersion = typeof record.deliveryVersion === 'string' ? record.deliveryVersion : '';
  const snapshotId = typeof record.snapshotId === 'string' ? record.snapshotId : '';
  const contentFingerprint = typeof record.contentFingerprint === 'string' ? record.contentFingerprint : '';
  if (!DELIVERY_VERSION_PATTERN.test(deliveryVersion)) return null;
  if (!/^[0-9a-f]{16}$/.test(snapshotId) || !/^[0-9a-f]{64}$/.test(contentFingerprint)) return null;
  if (snapshotIdFor(contentFingerprint) !== snapshotId) return null;
  if (record.status !== 'confirmed' && record.status !== 'draft') return null;
  return { deliveryVersion, snapshotId, contentFingerprint, status: record.status };
}

/** 链接内容自带指纹：读页时重算一遍，确认快照号确实对得上这一版。 */
async function verifyPlanShareIdentity(identity: PlanShareIdentity, layout: RoomLayout): Promise<ReadPlanShareIdentity> {
  try {
    const fingerprint = await contentFingerprintOfShareable(layout);
    return { ...identity, verified: fingerprint === identity.contentFingerprint };
  } catch {
    return { ...identity, verified: false };
  }
}

// CompressionStream/DecompressionStream are native in every modern browser and
// in Node >= 18 (which covers the vitest node environment) — no dependency and
// no node:zlib import needed. Piping through Blob/Response keeps error
// propagation contained: a corrupt deflate stream rejects the arrayBuffer()
// promise instead of raising an unhandled rejection.
async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return pumpThrough(bytes, new CompressionStream('deflate-raw'));
}

/** The inflated bytes, or null as soon as they pass `maxBytes`. */
async function inflateRawBounded(bytes: Uint8Array<ArrayBuffer>, maxBytes: number): Promise<Uint8Array | null> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function pumpThrough(
  bytes: Uint8Array<ArrayBuffer>,
  transform: ReadableWritablePair<Uint8Array, BufferSource>
): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// btoa/atob are global in browsers and in Node >= 16, so these helpers work in
// both the client bundle and the vitest node environment without shims.
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // keep String.fromCharCode argument counts stack-safe
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
