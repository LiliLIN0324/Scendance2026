/**
 * 本机存量盘点（任务 B / C14）。
 *
 * 主计划 §5.4：先盘点、预览清单，再幂等补传；不删除本机唯一副本，不编造丢失原件。
 * 这份清单聚合四类本机登记，逐项标注归档状态，供云面板的「归档」页展示：
 *
 * - 物料模型（GLB）：asset-cloud 映射 + 归档队列回执；
 * - 实景扫描（spz/ply）：归档队列回执；origin 'cloud' 的条目在公共云资产库有副本，
 *   与「私有归档」分开说明，不混为一谈；
 * - 资料图/图纸：source-storage 里带 assetId 的算已上传，blob-only 的算未归档；
 * - 户外规划：有 remoteActivityId 的算云端有副本，其余算未同步。
 *
 * 产出只读：不改任何存储，不发起上传（补传入队在云面板按需触发）。
 */

import { listAholoAssets, aholoAssetUrl, type AholoAsset } from './aholo-assets';
import { assetCloudSnapshot } from './asset-cloud';
import type { ArchiveJob, ArchiveScope } from './archive-queue';
import { sharedArchiveQueue } from './archive-queue';
import type { StoredSource } from '@/lib/source-storage';

export type InventoryItemState = 'archived' | 'pending' | 'needs-file' | 'failed';

export interface InventoryItem {
  type: 'model' | 'scan' | 'floorplan' | 'photo' | 'attachment' | 'outdoor-plan';
  localId: string;
  name: string;
  bytes?: number;
  state: InventoryItemState;
  cloudAssetId?: string;
  /** 一句人话说明；archived 也写清楚是哪种副本（私有归档 vs 公共资产库）。 */
  detail?: string;
}

export interface InventoryReport {
  items: InventoryItem[];
  summary: { total: number; archived: number; pending: number; needsFile: number; failed: number };
}

export interface CollectInventoryInputs {
  assets?: readonly AholoAsset[];
  archiveJobs?: readonly ArchiveJob[];
  cloudRecords?: Readonly<Record<string, { state: string; cloudAssetId?: string; bytes?: number }>>;
  sources?: readonly StoredSource[];
  /** 户外规划记录；缺省从 localStorage 按 key 前缀枚举。 */
  outdoorRecords?: ReadonlyArray<{ projectId: string; name: string; remoteActivityId?: string; remoteRevision?: number }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function summarize(items: InventoryItem[]): InventoryReport['summary'] {
  const summary = { total: items.length, archived: 0, pending: 0, needsFile: 0, failed: 0 };
  for (const item of items) {
    if (item.state === 'archived') summary.archived += 1;
    else if (item.state === 'needs-file') summary.needsFile += 1;
    else if (item.state === 'failed') summary.failed += 1;
    else summary.pending += 1;
  }
  return summary;
}

/** 纯函数：全部输入可注入，测试不碰真实存储。 */
export function collectArchiveInventory(inputs: CollectInventoryInputs = {}): InventoryReport {
  const jobs = inputs.archiveJobs ?? [];
  const jobByLocalId = new Map(jobs.map(job => [job.localId, job] as const));
  const cloudRecords = inputs.cloudRecords ?? assetCloudSnapshot();
  const items: InventoryItem[] = [];

  for (const asset of inputs.assets ?? listAholoAssets()) {
    const job = jobByLocalId.get(asset.assetId);
    const cloudRecord = cloudRecords[asset.assetId];
    const isScan = asset.kind === 'spz' || asset.kind === 'ply';
    if (job?.state === 'uploaded' && job.assetId) {
      items.push({ type: isScan ? 'scan' : 'model', localId: asset.assetId, name: asset.name, bytes: job.bytes, state: 'archived', cloudAssetId: job.assetId, detail: '已归档到私有云端' });
      continue;
    }
    if (cloudRecord?.state === 'uploaded' && cloudRecord.cloudAssetId) {
      items.push({ type: 'model', localId: asset.assetId, name: asset.name, bytes: asset.bytes, state: 'archived', cloudAssetId: cloudRecord.cloudAssetId, detail: '已上传云端资产' });
      continue;
    }
    if (isScan && asset.origin === 'cloud') {
      items.push({ type: 'scan', localId: asset.assetId, name: asset.name, bytes: asset.bytes, state: 'archived', detail: '公共云资产库有副本（非私有归档）' });
      continue;
    }
    if (job?.state === 'needs-file') {
      items.push({ type: isScan ? 'scan' : 'model', localId: asset.assetId, name: asset.name, bytes: asset.bytes, state: 'needs-file', detail: job.error ?? '原文件不可读，请在原设备补传' });
      continue;
    }
    if (job?.state === 'failed') {
      items.push({ type: isScan ? 'scan' : 'model', localId: asset.assetId, name: asset.name, bytes: asset.bytes, state: 'failed', detail: job.error ?? '上次补传失败' });
      continue;
    }
    items.push({ type: isScan ? 'scan' : 'model', localId: asset.assetId, name: asset.name, bytes: asset.bytes, state: 'pending', detail: '尚未归档，本机原件保留' });
  }

  for (const source of inputs.sources ?? []) {
    if (source.assetId && UUID_PATTERN.test(source.assetId)) {
      items.push({ type: source.kind, localId: source.id, name: source.name, state: 'archived', cloudAssetId: source.assetId, detail: '资料图已上传云端' });
    } else {
      items.push({ type: source.kind, localId: source.id, name: source.name, state: 'pending', detail: '资料图只在本机，云端没有副本' });
    }
  }

  for (const record of inputs.outdoorRecords ?? []) {
    if (record.remoteActivityId) {
      items.push({
        type: 'outdoor-plan', localId: record.projectId, name: record.name, state: 'archived',
        detail: `云端有活动副本${typeof record.remoteRevision === 'number' ? `（版本 ${record.remoteRevision}）` : ''}`,
      });
    } else {
      items.push({ type: 'outdoor-plan', localId: record.projectId, name: record.name, state: 'pending', detail: '云端没有这个规划的副本' });
    }
  }

  return { items, summary: summarize(items) };
}

/** 从 localStorage 枚举户外规划记录（键前缀对齐 outdoor-project-store）。 */
export function readOutdoorInventoryRecords(storage: Pick<Storage, 'getItem' | 'key' | 'length'> | null): Array<{ projectId: string; name: string; remoteActivityId?: string; remoteRevision?: number }> {
  if (!storage) return [];
  const records: Array<{ projectId: string; name: string; remoteActivityId?: string; remoteRevision?: number }> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith('scendance-outdoor-plan-v1:')) continue;
    try {
      const parsed: unknown = JSON.parse(storage.getItem(key) ?? '');
      if (!parsed || typeof parsed !== 'object') continue;
      const record = parsed as { projectId?: unknown; name?: unknown; remoteActivityId?: unknown; remoteRevision?: unknown };
      if (typeof record.projectId !== 'string' || !record.projectId) continue;
      records.push({
        projectId: record.projectId,
        name: typeof record.name === 'string' && record.name ? record.name : '户外规划',
        ...(typeof record.remoteActivityId === 'string' && record.remoteActivityId ? { remoteActivityId: record.remoteActivityId } : {}),
        ...(typeof record.remoteRevision === 'number' ? { remoteRevision: record.remoteRevision } : {}),
      });
    } catch { /* 坏档如实跳过，不编造 */ }
  }
  return records;
}

/** 当前环境的一次完整盘点（异步：归档队列在 IndexedDB）。 */
export async function collectCurrentInventory(scope: ArchiveScope | null): Promise<InventoryReport> {
  const jobs = scope ? await sharedArchiveQueue.inventory(scope) : [];
  return collectArchiveInventory({ archiveJobs: jobs });
}

/** 把待归档的物料/扫描登记进补传队列；返回入队数。资料图与户外规划走各自链路，不在这一步。 */
export async function enqueuePendingInventoryItems(report: InventoryReport, _scope: ArchiveScope, enqueue: (input: { localId: string; name: string; kind: 'model' | 'scan' | 'floorplan' | 'photo' | 'attachment'; bytes: number; localUrl: string }) => Promise<unknown>, assets?: readonly AholoAsset[]): Promise<number> {
  const registry = new Map((assets ?? listAholoAssets()).map(asset => [asset.assetId, asset] as const));
  let queued = 0;
  for (const item of report.items) {
    if (item.state !== 'pending' || (item.type !== 'model' && item.type !== 'scan')) continue;
    const asset = registry.get(item.localId);
    const url = aholoAssetUrl(asset);
    if (!asset || !url || !asset.bytes) continue;
    await enqueue({ localId: asset.assetId, name: asset.name, kind: item.type === 'scan' ? 'scan' : 'model', bytes: asset.bytes, localUrl: url });
    queued += 1;
  }
  return queued;
}

/** 归档状态五档派生：给面板徽章与计数用，不改盘点原始状态。 */
export type InventoryTone = 'private' | 'public' | 'activity' | 'local' | 'error';

export function inventoryTone(item: InventoryItem): InventoryTone {
  if (item.state === 'needs-file' || item.state === 'failed') return 'error';
  if (item.state === 'pending') return 'local';
  if (item.type === 'scan' && item.detail?.includes('公共云资产库')) return 'public';
  if (item.type === 'outdoor-plan') return 'activity';
  return 'private';
}

/** 经典案例用 replica- 伪 id 占本机槽位（见 space-panel），是内置示例，不计入个人归档。 */
export function isReplicaCaseItem(item: InventoryItem): boolean {
  return item.localId.startsWith('replica-');
}

/** 缺口条目的下一步提示；动作按对象归属：素材走补传队列，规划随项目保存同步。 */
export function inventoryActionHint(item: InventoryItem): string {
  if (isReplicaCaseItem(item)) return '示例，不参与同步';
  if (item.state === 'pending' && (item.type === 'model' || item.type === 'scan')) return '加入补传队列后上传';
  if (item.state === 'pending' && item.type === 'outdoor-plan') return '打开项目保存后同步到云端';
  if (item.state === 'archived' && item.type === 'outdoor-plan') return '版本已随活动保存';
  return '';
}
