import libraryAssetIds from '../../assets/library/asset-ids.json';
import { assetCloudLabel, assetCloudStateOf } from '../components/room-organizer/lib/asset-cloud';
import { layoutForExport } from './layout-export';
import { MAX_LAYOUT_JSON_BYTES, parseLayoutEventOperations, parseStoredLayout } from '../components/room-organizer/lib/schema';
import { isGlbUrl } from '../components/room-organizer/lib/glb-url';
import type { CameraPreset, FurnitureItem, RoomLayout } from '../components/room-organizer/lib/types';

/** Hash prefix for the read-only 3D viewer link: `/share/#s1.<payload>`. */
export const SHARE_SNAPSHOT_HASH_PREFIX = '#s1=';
const SNAPSHOT_VERSION = '1.';

/**
 * Readers and chat clients start truncating links well before the browser does.
 * A snapshot has to survive being pasted into a message, so the ceiling is the
 * same order of magnitude as the editor layout share link (12k) with extra room
 * for the viewer metadata.
 */
export const MAX_SHARE_SNAPSHOT_URL_LENGTH = 20_000;
/** Refuse to inflate a crafted hash into a large object graph. */
export const MAX_SHARE_SNAPSHOT_HASH_LENGTH = 64 * 1024;
const MAX_SNAPSHOT_JSON_BYTES = 1024 * 1024;

export type ShareViewPreset = Extract<CameraPreset, 'front' | 'iso' | 'top'>;

/** The three fixed angles exported as still images, in filename order. */
export const SHARE_VIEW_PRESETS: readonly ShareViewPreset[] = ['front', 'iso', 'top'];

/** Chinese labels used by the viewer toolbar, the download filenames and the menu notice. */
export const SHARE_VIEW_LABELS: Record<ShareViewPreset, string> = {
  front: '正视',
  iso: '45°',
  top: '俯视',
};

export interface ShareAssetRef {
  id: string;
  name: string;
  url: string;
}

export interface ShareSceneSummary {
  width: number;
  depth: number;
  height: number;
  floors: number;
  objects: number;
}

export interface ShareSnapshot {
  version: 1;
  name: string;
  createdAt: string;
  camera: CameraPreset;
  scene: ShareSceneSummary;
  assets: ShareAssetRef[];
  layout: RoomLayout;
}

export type ShareSnapshotFailure = 'too-large' | 'unreadable';

export type ReadShareSnapshotResult =
  | { ok: true; snapshot: ShareSnapshot }
  | { ok: false; reason: ShareSnapshotFailure };

export type SnapshotErrorCode = 'too-large' | 'invalid' | 'unshareable';

export class ShareSnapshotError extends Error {
  code: SnapshotErrorCode;

  constructor(code: SnapshotErrorCode, message: string) {
    super(message);
    this.name = 'ShareSnapshotError';
    this.code = code;
  }
}

export interface EncodeShareSnapshotResult {
  url: string;
  snapshot: ShareSnapshot;
  /** Always 0 now: generation stops before a partial link can be made. Kept for existing callers. */
  droppedAssets: number;
}

const registryUrls = new Set(Object.keys(libraryAssetIds as Record<string, string>));

/**
 * Only URLs that are public by construction may travel in a link: relative
 * same-origin files and URLs registered in the public asset catalogue. Signed
 * handoff URLs expire and often carry credentials, so they are deliberately
 * dropped instead of silently shipping a dead or private asset reference.
 */
export function isShareableAssetUrl(url: string | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  if (!isGlbUrl(url)) return false;
  if (registryUrls.has(url)) return true;
  return url.startsWith('/') && !url.startsWith('//');
}

export function publicAssetUrl(assetId: string | undefined): string | undefined {
  if (!assetId) return undefined;
  const url = (libraryAssetIds as Record<string, string>)[assetId];
  return isShareableAssetUrl(url) ? url : undefined;
}

/** Stable catalogue URLs per asset id. Relative same-origin files are public too. */
const shareableRegistryUrls = new Map<string, string>();
for (const [url, assetId] of Object.entries(libraryAssetIds as Record<string, string>)) {
  if (isShareableAssetUrl(url) && !shareableRegistryUrls.has(assetId)) shareableRegistryUrls.set(assetId, url);
}

export interface UnshareableAsset {
  name: string;
  reason: string;
}

export interface UnshareableAssetsReport {
  count: number;
  items: UnshareableAsset[];
  /** Empty when every asset can travel in the link. */
  message: string;
}

/** Put the catalogue URL back for registered assets that the exporter could not resolve. */
function restoreRegistryAssetUrls(target: RoomLayout): void {
  for (const floor of target.floors) {
    for (const item of floor.items) {
      if (!item.glbUrl && item.assetId) {
        const url = shareableRegistryUrls.get(item.assetId);
        if (url) item.glbUrl = url;
      }
    }
  }
  for (const variant of target.designBook?.variants ?? []) restoreRegistryAssetUrls(variant.layout);
}

function unshareableReason(item: FurnitureItem, url: string): string {
  if (item.assetId && !shareableRegistryUrls.has(item.assetId)) {
    const state = assetCloudLabel(assetCloudStateOf(item.assetId).state);
    return `本机素材库/生成模型（${state}），没进入公开素材目录，链接里带不走`;
  }
  if (/^(blob|data):/i.test(url)) return '本机临时模型文件，换台设备就读不到';
  if (/^https?:/i.test(url)) return '外部私有或带签名的地址，分享后会失效';
  return '模型地址不是公开可读的 GLB';
}

function collectUnshareableAssets(source: RoomLayout, exported: RoomLayout, found: UnshareableAsset[]): void {
  source.floors.forEach((floor, floorIndex) => {
    const exportedItems = exported.floors[floorIndex]?.items ?? [];
    floor.items.forEach((item, itemIndex) => {
      // Primitive items without a loading URL travel as geometry; nothing is lost.
      if (!item.glbUrl) return;
      const exportedUrl = exportedItems[itemIndex]?.glbUrl;
      if (exportedUrl && isShareableAssetUrl(exportedUrl)) return;
      found.push({ name: item.name?.trim() || '未命名物件', reason: unshareableReason(item, item.glbUrl) });
    });
  });
  const variants = source.designBook?.variants ?? [];
  variants.forEach((variant, index) => {
    const exportedVariant = exported.designBook?.variants?.[index];
    if (exportedVariant) collectUnshareableAssets(variant.layout, exportedVariant.layout, found);
  });
}

function unshareableMessage(items: UnshareableAsset[]): string {
  const grouped = new Map<string, { name: string; reason: string; count: number }>();
  for (const item of items) {
    const key = `${item.name}\u0000${item.reason}`;
    const entry = grouped.get(key);
    if (entry) entry.count += 1;
    else grouped.set(key, { ...item, count: 1 });
  }
  const list = [...grouped.values()]
    .map(entry => `${entry.name}（${entry.reason}${entry.count > 1 ? `，${entry.count} 件` : ''}）`)
    .slice(0, 6);
  return `有 ${items.length} 件资产不能放进分享链接：${list.join('、')}。请先替换为公开素材或移除后再生成；这次不会生成缺件的链接。`;
}

/** Pre-flight check for the menu: names and reasons before any link is built. */
export function describeUnshareableAssets(layout: RoomLayout): UnshareableAssetsReport {
  const checked = parseLayoutEventOperations(layout);
  if (!checked) return { count: 0, items: [], message: '' };
  const exported = layoutForExport(checked, true);
  restoreRegistryAssetUrls(exported);
  const items: UnshareableAsset[] = [];
  collectUnshareableAssets(checked, exported, items);
  return { count: items.length, items, message: items.length ? unshareableMessage(items) : '' };
}

/**
 * Build the payload from the live layout. It never mutates the layout, strips
 * handoff credentials, and records the camera preset the viewer should open at.
 */
export function buildShareSnapshot(
  layout: RoomLayout,
  camera: CameraPreset = 'iso',
  now = new Date()
): { snapshot: ShareSnapshot; droppedAssets: number } {
  const checked = parseLayoutEventOperations(layout);
  if (!checked) throw new ShareSnapshotError('invalid', '制作计划或活动安排无效，请先核对后再生成分享方案。');

  const shareable = layoutForExport(checked, true);
  restoreRegistryAssetUrls(shareable);
  const unshareable: UnshareableAsset[] = [];
  collectUnshareableAssets(checked, shareable, unshareable);
  if (unshareable.length) throw new ShareSnapshotError('unshareable', unshareableMessage(unshareable));
  delete shareable.floorPlanImage;

  let droppedAssets = 0;
  const assets = new Map<string, ShareAssetRef>();

  const sanitize = (target: RoomLayout): void => {
    for (const floor of target.floors) {
      for (const item of floor.items) {
        const original = isShareableAssetUrl(item.glbUrl) ? item.glbUrl : undefined;
        if (item.glbUrl && !original) droppedAssets += 1;
        if (original) {
          item.glbUrl = original;
          const id = item.assetId ?? original;
          if (!assets.has(id)) assets.set(id, { id, name: item.name, url: original });
        } else {
          delete item.glbUrl;
        }
      }
    }
    for (const variant of target.designBook?.variants ?? []) sanitize(variant.layout);
  };
  sanitize(shareable);

  const height = shareable.floors.reduce((max, floor) => max + (floor.height ?? 3), 0);
  const objects = shareable.floors.reduce((count, floor) => count + floor.items.length, 0);

  const snapshot: ShareSnapshot = {
    version: 1,
    name: shareable.name || '未命名方案',
    createdAt: now.toISOString(),
    camera: camera === 'top' || camera === 'front' ? camera : 'iso',
    scene: {
      width: shareable.width,
      depth: shareable.height,
      height,
      floors: shareable.floors.length,
      objects,
    },
    assets: [...assets.values()],
    layout: shareable,
  };
  return { snapshot, droppedAssets };
}

const SHARE_URL_MESSAGES = {
  'too-large': '方案超出链接体积上限，请精简物件后再生成分享方案。',
  unreadable: '分享链接不完整或已损坏，请让同事重新生成。',
} as const;

export function shareSnapshotErrorMessage(reason: ShareSnapshotFailure): string {
  return SHARE_URL_MESSAGES[reason];
}

export async function encodeShareSnapshot(
  layout: RoomLayout,
  origin: string,
  camera: CameraPreset = 'iso'
): Promise<EncodeShareSnapshotResult> {
  const { snapshot, droppedAssets } = buildShareSnapshot(layout, camera);
  const json = JSON.stringify(snapshot);
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > MAX_SNAPSHOT_JSON_BYTES) {
    throw new ShareSnapshotError('too-large', '方案数据过大，无法放进分享链接。请减少楼层或物件后再试。');
  }
  const compressed = await deflateRaw(bytes);
  const url = `${origin}${SHARE_SNAPSHOT_HASH_PREFIX}${SNAPSHOT_VERSION}${bytesToBase64Url(compressed)}`;
  if (url.length > MAX_SHARE_SNAPSHOT_URL_LENGTH) {
    throw new ShareSnapshotError(
      'too-large',
      `方案生成的链接约 ${Math.round(url.length / 1000)}k，超过 ${MAX_SHARE_SNAPSHOT_URL_LENGTH / 1000}k 上限。请减少物件或楼层后再试。`
    );
  }
  return { url, snapshot, droppedAssets };
}

export async function readShareSnapshotHash(hash: string): Promise<ReadShareSnapshotResult> {
  if (!hash.startsWith(SHARE_SNAPSHOT_HASH_PREFIX)) return { ok: false, reason: 'unreadable' };
  const encoded = hash.slice(SHARE_SNAPSHOT_HASH_PREFIX.length);
  if (encoded.length > MAX_SHARE_SNAPSHOT_HASH_LENGTH) return { ok: false, reason: 'too-large' };
  try {
    const json = encoded.startsWith(SNAPSHOT_VERSION)
      ? await inflateRawBounded(base64UrlToBytes(encoded.slice(SNAPSHOT_VERSION.length)), MAX_LAYOUT_JSON_BYTES)
      : null;
    if (!json) return { ok: false, reason: 'too-large' };
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
    const snapshot = validateSnapshot(parsed);
    return snapshot ? { ok: true, snapshot } : { ok: false, reason: 'unreadable' };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

function validateSnapshot(value: unknown): ShareSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;
  const layout = parseStoredLayout(raw.layout);
  if (!layout) return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : '未命名方案';
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : '';
  const camera: CameraPreset = raw.camera === 'top' || raw.camera === 'front' || raw.camera === 'corner' ? raw.camera : 'iso';
  const scene = validateScene(raw.scene, layout);
  const assets: ShareAssetRef[] = [];
  if (Array.isArray(raw.assets)) {
    for (const entry of raw.assets) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.url !== 'string' || !isShareableAssetUrl(item.url)) continue;
      assets.push({ id: item.id.slice(0, 120), name: item.name.slice(0, 80), url: item.url });
    }
  }
  const clean = layoutForExport(layout, true);
  // The decoder is the trust boundary: never let an old link smuggle an
  // expired signed loading URL into the viewer.
  for (const floor of clean.floors) {
    for (const item of floor.items) {
      if (!isShareableAssetUrl(item.glbUrl)) delete item.glbUrl;
    }
  }
  return { version: 1, name, createdAt, camera, scene, assets, layout: clean };
}

function validateScene(value: unknown, layout: RoomLayout): ShareSceneSummary {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const number = (input: unknown, fallback: number) => (
    typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : fallback
  );
  return {
    width: number(raw.width, layout.width),
    depth: number(raw.depth, layout.height),
    height: number(raw.height, layout.floors.reduce((max, floor) => max + (floor.height ?? 3), 0)),
    floors: number(raw.floors, layout.floors.length),
    objects: number(raw.objects, layout.floors.reduce((count, floor) => count + floor.items.length, 0)),
  };
}

/** Filesystem-safe stem for the three exported stills. */
export function safeShareName(name: string): string {
  const stem = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return stem.slice(0, 60) || '方案';
}

export function shareShotFilename(name: string, preset: ShareViewPreset): string {
  return `${safeShareName(name)}-${SHARE_VIEW_LABELS[preset]}.png`;
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return pumpThrough(bytes, new CompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
}

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
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function pumpThrough(bytes: Uint8Array<ArrayBuffer>, transform: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const blob = new Blob([bytes]).stream().pipeThrough(transform);
  const buffer = await new Response(blob).arrayBuffer();
  return new Uint8Array(buffer);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(encoded: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('not base64url');
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
