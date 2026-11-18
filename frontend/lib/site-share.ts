/**
 * 只读场地页（/site）的快照编解码。
 *
 * 与 /view 的 `#s1=` 同构：整条链接自带数据，不连后端、可离线打开。
 * 只带“场地”这一层：锚点、场地轮廓、分区、初始缩放；不带设施/路线/人员，
 * 那些属于执行资料，不进客户只读页。
 *
 *   #s2=<版本前缀><base64url(deflate-raw(JSON))>
 */
import type { PlanPoint, SitePlanData } from '../../supabase/functions/_shared/site-plan';

export const SITE_SNAPSHOT_HASH_PREFIX = '#s2=';
const SNAPSHOT_VERSION = '1.';
export const MAX_SITE_SNAPSHOT_URL_LENGTH = 20_000;
export const MAX_SITE_SNAPSHOT_HASH_LENGTH = 64 * 1024;
const MAX_SNAPSHOT_JSON_BYTES = 256 * 1024;
const MIN_ZOOM = 3;
const MAX_ZOOM = 20;
export const MAX_SITE_ZONES = 30;

export interface SiteShareZone {
  name: string;
  semantic: string;
  color?: string;
  polygon: PlanPoint[];
}

export interface SiteShareSnapshot {
  version: 1;
  title: string;
  createdAt: string;
  /** 高德语义 GCJ-02 锚点：局部米制坐标的原点。 */
  anchor: { lng: number; lat: number };
  zoom: number;
  boundary: PlanPoint[];
  zones: SiteShareZone[];
  source?: string;
  note?: string;
}

export type SiteSnapshotFailure = 'too-large' | 'unreadable';

export type ReadSiteSnapshotResult =
  | { ok: true; snapshot: SiteShareSnapshot }
  | { ok: false; reason: SiteSnapshotFailure };

export class SiteSnapshotError extends Error {
  readonly code: 'too-large' | 'invalid';

  constructor(code: 'too-large' | 'invalid', message: string) {
    super(message);
    this.code = code;
  }
}

const SITE_URL_MESSAGES: Record<SiteSnapshotFailure, string> = {
  'too-large': '场地内容超出链接体积上限，请精简分区后再生成。',
  unreadable: '场地链接不完整或已损坏，请让发布者重新生成。',
};

export function siteSnapshotErrorMessage(reason: SiteSnapshotFailure): string {
  return SITE_URL_MESSAGES[reason];
}

const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const point = (value: PlanPoint): PlanPoint => ({ x: round(value.x, 1), y: round(value.y, 1) });

/**
 * 从场地规划里取“客户只读页”需要的那一层。
 * 只读页要能独立看懂一块地，所以轮廓、分区、锚点必须齐；缺锚点直接报错，
 * 不猜一个坐标把页面撑起来。
 */
export function buildSiteSnapshot(
  plan: SitePlanData,
  title: string,
  options: { zoom?: number; source?: string; note?: string; now?: Date } = {},
): SiteShareSnapshot {
  const anchor = plan.anchor;
  if (!anchor || !Number.isFinite(anchor.lng) || !Number.isFinite(anchor.lat)) {
    throw new SiteSnapshotError('invalid', '这份场地还没有定位锚点，先在地图上选址再分享。');
  }
  const boundary = plan.boundary.map(point);
  if (boundary.length < 3) throw new SiteSnapshotError('invalid', '场地轮廓至少要有 3 个点。');
  if (plan.zones.length > MAX_SITE_ZONES) {
    throw new SiteSnapshotError('invalid', `分区超过 ${MAX_SITE_ZONES} 个，只读页只收最有用的那些。`);
  }
  const zones: SiteShareZone[] = plan.zones.map(zone => ({
    name: zone.name.slice(0, 60),
    semantic: zone.semantic,
    ...(zone.color ? { color: zone.color } : {}),
    polygon: zone.polygon.map(point),
  }));
  const span = spanOf(boundary);
  const zoom = clampZoom(options.zoom ?? zoomForSpan(span, anchor.lat));
  return {
    version: 1,
    title: title.trim().slice(0, 80) || '未命名场地',
    createdAt: (options.now ?? new Date()).toISOString(),
    anchor: { lng: round(anchor.lng, 6), lat: round(anchor.lat, 6) },
    zoom: round(zoom, 2),
    boundary,
    zones,
    ...(options.source ? { source: options.source.slice(0, 200) } : {}),
    ...(options.note ? { note: options.note.slice(0, 300) } : {}),
  };
}

export async function encodeSiteSnapshot(
  plan: SitePlanData,
  title: string,
  origin: string,
  options: { zoom?: number; source?: string; note?: string } = {},
): Promise<{ url: string; snapshot: SiteShareSnapshot }> {
  const snapshot = buildSiteSnapshot(plan, title, options);
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.byteLength > MAX_SNAPSHOT_JSON_BYTES) {
    throw new SiteSnapshotError('too-large', '场地数据过大，无法放进链接。');
  }
  const url = `${origin}${SITE_SNAPSHOT_HASH_PREFIX}${SNAPSHOT_VERSION}${base64UrlFromBytes(await deflateRaw(bytes))}`;
  if (url.length > MAX_SITE_SNAPSHOT_URL_LENGTH) {
    throw new SiteSnapshotError('too-large', `场地链接约 ${Math.round(url.length / 1000)}k，超过上限。`);
  }
  return { url, snapshot };
}

export async function readSiteSnapshotHash(hash: string): Promise<ReadSiteSnapshotResult> {
  if (!hash.startsWith(SITE_SNAPSHOT_HASH_PREFIX)) return { ok: false, reason: 'unreadable' };
  const encoded = hash.slice(SITE_SNAPSHOT_HASH_PREFIX.length);
  if (encoded.length > MAX_SITE_SNAPSHOT_HASH_LENGTH) return { ok: false, reason: 'too-large' };
  try {
    if (!encoded.startsWith(SNAPSHOT_VERSION)) return { ok: false, reason: 'unreadable' };
    const json = await inflateRaw(base64UrlToBytes(encoded.slice(SNAPSHOT_VERSION.length)), MAX_SNAPSHOT_JSON_BYTES);
    if (!json) return { ok: false, reason: 'too-large' };
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
    const snapshot = validateSnapshot(parsed);
    return snapshot ? { ok: true, snapshot } : { ok: false, reason: 'unreadable' };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/** 解码即信任边界：链接里的任何东西都要先过一遍范围与条数。 */
function validateSnapshot(value: unknown): SiteShareSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;
  const anchorRaw = raw.anchor as Record<string, unknown> | undefined;
  const lng = anchorRaw?.lng;
  const lat = anchorRaw?.lat;
  if (typeof lng !== 'number' || typeof lat !== 'number') return null;
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  const boundary = readRing(raw.boundary);
  if (!boundary) return null;
  const zones: SiteShareZone[] = [];
  if (Array.isArray(raw.zones)) {
    for (const entry of raw.zones.slice(0, MAX_SITE_ZONES)) {
      if (!entry || typeof entry !== 'object') continue;
      const zone = entry as Record<string, unknown>;
      if (typeof zone.name !== 'string' || !zone.name.trim() || typeof zone.semantic !== 'string') continue;
      const polygon = readRing(zone.polygon);
      if (!polygon) continue;
      zones.push({
        name: zone.name.trim().slice(0, 60),
        semantic: zone.semantic.slice(0, 24),
        ...(typeof zone.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(zone.color) ? { color: zone.color.toLowerCase() } : {}),
        polygon,
      });
    }
  }
  const zoomRaw = typeof raw.zoom === 'number' && Number.isFinite(raw.zoom) ? raw.zoom : 16;
  return {
    version: 1,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 80) : '未命名场地',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    anchor: { lng, lat },
    zoom: clampZoom(zoomRaw),
    boundary,
    zones,
    ...(typeof raw.source === 'string' ? { source: raw.source.slice(0, 200) } : {}),
    ...(typeof raw.note === 'string' ? { note: raw.note.slice(0, 300) } : {}),
  };
}

function readRing(value: unknown): PlanPoint[] | null {
  if (!Array.isArray(value) || value.length < 3 || value.length > 64) return null;
  const ring: PlanPoint[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const { x, y } = entry as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 5000 || Math.abs(y) > 5000) return null;
    ring.push({ x, y });
  }
  return ring;
}

export function siteBoundaryBounds(boundary: PlanPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = boundary.map(p => p.x);
  const ys = boundary.map(p => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** 球面多边形面积（鞋带公式在米制平面上的近似，±5 km 内误差可忽略）。 */
export function siteArea(boundary: PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < boundary.length; i += 1) {
    const a = boundary[i];
    const b = boundary[(i + 1) % boundary.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function spanOf(points: PlanPoint[]): number {
  const bounds = siteBoundaryBounds(points);
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 16;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** 让整块地在 ~640 px 的视野里留一圈边，反推一个合适的初始缩放。 */
export function zoomForSpan(spanMeters: number, lat: number): number {
  const metresPerPixel = Math.max(spanMeters, 1) * 1.35 / 640;
  const zoom = Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * metresPerPixel));
  return clampZoom(zoom);
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes: Uint8Array, limit: number): Promise<Uint8Array | null> {
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return buffer.byteLength > limit ? null : new Uint8Array(buffer);
}

/** Blob 只接受真正的 ArrayBuffer，Uint8Array 的 buffer 可能是共享的，先切一份。 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
