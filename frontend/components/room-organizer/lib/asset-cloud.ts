import { useSyncExternalStore } from 'react';
import { aholoAssetUrl, findAholoAsset } from './aholo-assets';
import type { RoomLayout } from './types';

/**
 * 本机资产（Lux3D 直连产物 / 本地导入的 GLB）与云端资产记录的桥。
 *
 * 本机文件永远先留在本机：上传只负责把它复制一份到对象存储，并把返回的云端 asset_id
 * 记进 `assetIdMap`。上传失败只改变状态，不删本地文件；下次保存/重试还能用同一份。
 *
 * 四态：
 * - local     本机（还没试过上传）
 * - uploading 上传中（带进度）
 * - uploaded  已上云（有 cloudAssetId，可直接写进云端场景）
 * - failed    上传失败（本机副本还在，error 说明原因）
 */
export type AssetCloudState = 'local' | 'uploading' | 'uploaded' | 'failed';

export interface AssetCloudRecord {
  localAssetId: string;
  state: AssetCloudState;
  cloudAssetId?: string;
  sha256?: string;
  bytes?: number;
  /** 0–1；只在 uploading 时有意义。 */
  progress?: number;
  uploadedAt?: number;
  updatedAt: number;
  error?: string;
}

export interface AssetUploadMeta {
  name: string;
  source: 'aholo' | 'upload';
  sourceId?: string;
}

export interface AssetUploadResult {
  id: string;
  byteSize: number;
  sha256: string;
  reused?: boolean;
  metadata?: { dimensions?: { width: number; depth: number; height: number }; [key: string]: unknown };
}

/** 上传实现由调用方注入（浏览器里是 BackendSession.uploadLocalAsset），便于单测替身。 */
export type AssetUploader = (
  file: Blob,
  meta: AssetUploadMeta,
  onProgress?: (loaded: number, total: number) => void,
) => Promise<AssetUploadResult>;

export interface AssetCloudFailure {
  localAssetId: string;
  name: string;
  state: AssetCloudState;
  message: string;
}

export interface PreparedAssets {
  assetIdMap: Record<string, string>;
  localAssetIds: Set<string>;
  failures: AssetCloudFailure[];
}

const STORAGE_KEY = 'scendance:asset-cloud-v1';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATES: AssetCloudState[] = ['local', 'uploading', 'uploaded', 'failed'];
const LOCAL_FETCH_TIMEOUT_MS = 120_000;
const DEFAULT_RETRY_DELAYS = [400, 1200] as const;

function isRecord(value: unknown): value is AssetCloudRecord {
  const record = value as AssetCloudRecord;
  return Boolean(record) && uuidPattern.test(record.localAssetId ?? '') && STATES.includes(record.state) &&
    (record.cloudAssetId === undefined || uuidPattern.test(record.cloudAssetId)) &&
    Number.isFinite(record.updatedAt);
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage ?? null; } catch { return null; }
}

function readPersisted(): Record<string, AssetCloudRecord> {
  const store = storage();
  if (!store) return {};
  try {
    const raw: unknown = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const records: Record<string, AssetCloudRecord> = {};
    for (const value of Object.values(raw)) {
      if (!isRecord(value)) continue;
      // 上次页面关掉时还在 uploading 的，恢复成 failed：本机副本还在，重试就能继续。
      if (value.state === 'uploading') {
        const stripped = { ...value };
        delete stripped.progress;
        records[value.localAssetId] = { ...stripped, state: 'failed', error: '上次上传被中断，本机副本还在，可重试。' };
      } else {
        records[value.localAssetId] = value;
      }
    }
    return records;
  } catch { return {}; }
}

let snapshot: Record<string, AssetCloudRecord> = readPersisted();
let mapCache: Record<string, string> | null = null;
const listeners = new Set<() => void>();
const inFlight = new Map<string, Promise<AssetUploadResult>>();

function persist(): void {
  const store = storage();
  if (!store) return;
  try { store.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* 存不下只丢状态缓存；本机文件与云端记录都还在。 */ }
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function setRecord(localAssetId: string, patch: Partial<AssetCloudRecord> & Pick<AssetCloudRecord, 'state'>): AssetCloudRecord {
  const previous = snapshot[localAssetId];
  const record: AssetCloudRecord = {
    localAssetId,
    state: patch.state,
    ...(patch.cloudAssetId !== undefined ? { cloudAssetId: patch.cloudAssetId } : previous?.cloudAssetId !== undefined ? { cloudAssetId: previous.cloudAssetId } : {}),
    ...(patch.sha256 !== undefined ? { sha256: patch.sha256 } : previous?.sha256 !== undefined ? { sha256: previous.sha256 } : {}),
    ...(patch.bytes !== undefined ? { bytes: patch.bytes } : previous?.bytes !== undefined ? { bytes: previous.bytes } : {}),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    ...(patch.uploadedAt !== undefined ? { uploadedAt: patch.uploadedAt } : previous?.uploadedAt !== undefined ? { uploadedAt: previous.uploadedAt } : {}),
    ...(patch.error !== undefined ? { error: patch.error } : {}),
    updatedAt: Date.now(),
  };
  snapshot = { ...snapshot, [localAssetId]: record };
  mapCache = null;
  persist();
  emit();
  return record;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function assetCloudSnapshot(): Record<string, AssetCloudRecord> {
  return snapshot;
}

export function useAssetCloudRecords(): Record<string, AssetCloudRecord> {
  return useSyncExternalStore(subscribe, assetCloudSnapshot, assetCloudSnapshot);
}

export function assetCloudStateOf(localAssetId?: string): AssetCloudRecord {
  if (!localAssetId) return { localAssetId: '', state: 'local', updatedAt: 0 };
  return snapshot[localAssetId] ?? { localAssetId, state: 'local', updatedAt: 0 };
}

/** 已上云的映射；保存场景时把本机 UUID 换掉。 */
export function cloudAssetIdMap(): Record<string, string> {
  if (mapCache) return mapCache;
  const map: Record<string, string> = {};
  for (const record of Object.values(snapshot)) {
    if (record.state === 'uploaded' && record.cloudAssetId) map[record.localAssetId] = record.cloudAssetId;
  }
  mapCache = map;
  return map;
}

/** 当前方案里引用到的本机资产（注册表里有记录的才算本机；云端资产号不会命中）。 */
export function localAssetIdsInLayout(layout: RoomLayout): Set<string> {
  const ids = new Set<string>();
  for (const floor of layout.floors) {
    for (const item of floor.items) {
      if (item.assetId && findAholoAsset(item.assetId)) ids.add(item.assetId);
    }
  }
  return ids;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '上传没成功，请稍后再试。';
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

function retryable(error: unknown): boolean {
  const status = statusOf(error);
  return status === undefined || status === 408 || status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchLocalBytes(localAssetId: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; name: string; taskid?: string }> {
  const asset = findAholoAsset(localAssetId);
  if (!asset) throw new Error('本机注册表里找不到这个模型；本机文件可能已被清理，需要重新生成或从原文件重新导入。');
  const url = aholoAssetUrl(asset);
  if (!url) throw new Error('这个本机资产没有稳定的读取地址，无法上传。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`读不到本机模型（HTTP ${response.status}）；本机副本还在，请确认本机代理已启动。`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength) throw new Error('本机模型是空文件，未上传。');
    if (asset.bytes > 0 && bytes.byteLength !== asset.bytes) {
      throw new Error(`本机文件大小和记录不一致（记录 ${asset.bytes} 字节，实际 ${bytes.byteLength} 字节），未上传。`);
    }
    return { bytes, name: asset.name, ...(asset.taskid ? { taskid: asset.taskid } : {}) };
  } finally { clearTimeout(timer); }
}

export interface SyncAssetOptions {
  fetchImpl?: typeof fetch;
  retryDelaysMs?: readonly number[];
}

/** 单个本机资产上传；同一个资产并发调用会复用同一个 in-flight Promise。 */
export function syncLocalAsset(localAssetId: string, uploader: AssetUploader, options: SyncAssetOptions = {}): Promise<AssetUploadResult> {
  const active = inFlight.get(localAssetId);
  if (active) return active;
  const job = runSync(localAssetId, uploader, options).finally(() => inFlight.delete(localAssetId));
  inFlight.set(localAssetId, job);
  return job;
}

async function runSync(localAssetId: string, uploader: AssetUploader, options: SyncAssetOptions): Promise<AssetUploadResult> {
  const existing = snapshot[localAssetId];
  if (existing?.state === 'uploaded' && existing.cloudAssetId) {
    return { id: existing.cloudAssetId, byteSize: existing.bytes ?? 0, sha256: existing.sha256 ?? '', reused: true };
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  let local: { bytes: Uint8Array; name: string; taskid?: string };
  try {
    local = await fetchLocalBytes(localAssetId, fetchImpl);
  } catch (error) {
    setRecord(localAssetId, { state: 'failed', error: messageOf(error) });
    throw error;
  }
  setRecord(localAssetId, { state: 'uploading', progress: 0 });
  const file = new Blob([local.bytes as unknown as BlobPart], { type: 'model/gltf-binary' });
  const meta: AssetUploadMeta = { name: local.name, source: local.taskid ? 'aholo' : 'upload', ...(local.taskid ? { sourceId: local.taskid } : {}) };
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      const result = await uploader(file, meta, (loaded, total) => {
        const progress = total > 0 ? Math.min(1, Math.max(0, loaded / total)) : undefined;
        setRecord(localAssetId, { state: 'uploading', ...(progress !== undefined ? { progress } : {}) });
      });
      if (!uuidPattern.test(result.id ?? '')) throw new Error('服务端没有返回有效 asset_id，未登记云端资产。');
      setRecord(localAssetId, {
        state: 'uploaded', cloudAssetId: result.id, sha256: result.sha256,
        bytes: result.byteSize || local.bytes.byteLength, uploadedAt: Date.now(), progress: 1,
      });
      return result;
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === delays.length) break;
      await sleep(delays[attempt] ?? 0);
    }
  }
  setRecord(localAssetId, { state: 'failed', error: messageOf(lastError) });
  throw lastError instanceof Error ? lastError : new Error(messageOf(lastError));
}

/**
 * 保存云端场景前的准备：把当前方案里所有本机资产逐个上传/复用。
 * 失败不阻止本机继续使用；调用方拿 failures 决定是否停下保存并提示状态。
 */
export async function prepareLayoutAssetsForCloud(
  layout: RoomLayout,
  uploader: AssetUploader,
  options: SyncAssetOptions = {},
): Promise<PreparedAssets> {
  const localAssetIds = localAssetIdsInLayout(layout);
  const failures: AssetCloudFailure[] = [];
  for (const localAssetId of localAssetIds) {
    const record = snapshot[localAssetId];
    if (record?.state === 'uploaded' && record.cloudAssetId) continue;
    try {
      await syncLocalAsset(localAssetId, uploader, options);
    } catch (error) {
      const latest = snapshot[localAssetId];
      const name = findAholoAsset(localAssetId)?.name ?? localAssetId;
      failures.push({ localAssetId, name, state: latest?.state ?? 'failed', message: messageOf(error) });
    }
  }
  return { assetIdMap: cloudAssetIdMap(), localAssetIds, failures };
}

/** 分享/查看器文案：没上云不是「丢失」，而是明确告诉用户本机还在、差哪一步。 */
export function assetCloudLabel(state: AssetCloudState, progress?: number): string {
  if (state === 'uploaded') return '已上云';
  if (state === 'uploading') return progress === undefined ? '上传中' : `上传中 ${Math.round(progress * 100)}%`;
  if (state === 'failed') return '上传失败';
  return '本机';
}
