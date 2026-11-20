/**
 * 统一保存状态机（任务 B / C05）。
 *
 * 口径来自主计划 §3.7 / §5.2：「云端已保存」必须有服务器确认的版本与依赖完整性证据；
 * 上传期间继续编辑时，新改动仍是待同步，不能被旧请求的回执清空。
 *
 * 六态（派生，不手工置位，避免自相矛盾）：
 * - local        本机已存（云端从未确认）
 * - uploading    素材归档上传进行中
 * - syncing      场景待同步或正在同步（含旧回执未覆盖的新编辑）
 * - cloud-saved  服务器确认过（带版本号与确认时间）
 * - failed       云端失败（本机保留）
 * - conflict     版本冲突（等用户二选一）
 *
 * 待同步计数是精确的：finishCloudSync 只抵扣「开始这次同步时已积累」的本地保存数，
 * 同步期间新产生的编辑不会被旧回执清掉。
 */

import { useSyncExternalStore } from 'react';

export type SaveStage = 'local' | 'uploading' | 'syncing' | 'cloud-saved' | 'failed' | 'conflict';

export interface SaveStatus {
  scope: string;
  /** 派生六态（commit 时刷新；不要手工置位）。 */
  stage: SaveStage;
  /** 最近一次本机落盘成功的时间。 */
  localSavedAt: number | null;
  /** 服务器最近确认的版本与时间；conflict 时是服务器当前版本。 */
  cloudRevision: number | null;
  cloudConfirmedAt: number | null;
  /** 自上次云端确认以来尚未被确认的本地保存次数。 */
  pendingCount: number;
  /** 归档队列活动状态（本 scope 的素材上传）。 */
  uploadsActive: number;
  uploadsTotal: number;
  /** 最近一次云端失败的原因；成功同步或新的本地落盘会保留它直到下次同步结束。 */
  failure: string | null;
  conflict: { remoteRevision: number; remoteName?: string } | null;
  updatedAt: number;
}

export type SaveStatusListener = () => void;
const emptyStatus = (scope: string): SaveStatus => ({
  scope, stage: 'local', localSavedAt: null, cloudRevision: null, cloudConfirmedAt: null,
  pendingCount: 0, uploadsActive: 0, uploadsTotal: 0, failure: null, conflict: null, updatedAt: 0,
});

const statuses = new Map<string, InternalStatus>();
const listeners = new Set<SaveStatusListener>();

interface InternalStatus extends SaveStatus {
  /** 进行中的同步序号；0 = 没有。 */
  syncing?: boolean;
  syncSeq?: number;
  /** 开始 syncSeq 这次同步时积累的待同步数；完成时按这个数抵扣。 */
  syncCovered?: number;
  lastFinishedSeq?: number;
}

/**
 * 六态全部由数据派生。优先级：冲突 > 同步进行中 > 素材归档中 > 失败 >
 * 待同步 > 云端已保存 > 本机。失败态不分 pending 多少——最近一次失败
 * 就是「云端未同步」的事实，新编辑只会累积到待同步计数里。
 */
export function deriveStage(status: SaveStatus & { syncing?: boolean }): SaveStage {
  if (status.conflict) return 'conflict';
  if (status.syncing) return 'syncing';
  if (status.uploadsActive > 0) return 'uploading';
  if (status.failure) return 'failed';
  if (status.pendingCount > 0) return 'syncing';
  if (status.cloudConfirmedAt) return 'cloud-saved';
  return 'local';
}

function statusOf(scope: string): InternalStatus {
  let status = statuses.get(scope) as InternalStatus | undefined;
  if (!status) { status = emptyStatus(scope); statuses.set(scope, status); }
  return status;
}

function commit(scope: string): void {
  const status = statuses.get(scope);
  if (!status) return;
  status.scope = scope;
  status.stage = deriveStage(status);
  status.updatedAt = Date.now();
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: SaveStatusListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function snapshotOf(scope: string): SaveStatus {
  return statusOf(scope);
}

/** React 读口：任一 scope 变化都会触发重渲染（量小，不做按 scope 细分）。 */
export function useSaveStatus(scope: string | null | undefined): SaveStatus {
  return useSyncExternalStore(subscribe, () => snapshotOf(scope ?? ''), () => snapshotOf(scope ?? ''));
}

export function saveStatusOf(scope: string | null | undefined): SaveStatus {
  return snapshotOf(scope ?? '');
}

/** 本机落盘成功：记时间并累积待同步数（云端从未确认过时状态是 local）。 */
export function noteLocalSave(scope: string, at: number = Date.now()): void {
  const status = statusOf(scope);
  status.localSavedAt = at;
  status.pendingCount += 1;
  status.conflict = null;
  commit(scope);
}

/** 直接设待同步数（绑定项目走 session 的 dirty 真值，不逐次累加）。 */
export function setPendingCount(scope: string, count: number): void {
  const status = statusOf(scope);
  status.pendingCount = Math.max(0, Math.floor(count));
  commit(scope);
}

/** 云端同步开始；返回序号，结束/失败时凭同一序号结算，旧回执作废。 */
export function startCloudSync(scope: string): number {
  const status = statusOf(scope);
  status.syncing = true;
  status.syncSeq = (status.syncSeq ?? 0) + 1;
  status.syncCovered = status.pendingCount;
  status.failure = null;
  commit(scope);
  return status.syncSeq;
}

/** 云端确认：只有最新一次同步的回执能抵扣待同步数；期间的编辑保留在计数里。 */
export function finishCloudSync(scope: string, seq: number, confirmation: { revision: number; confirmedAt?: number }): void {
  const status = statusOf(scope);
  const stale = seq !== (status.syncSeq ?? 0);
  if (!stale) {
    status.syncing = false;
    status.pendingCount = Math.max(0, status.pendingCount - (status.syncCovered ?? 0));
    status.lastFinishedSeq = seq;
  }
  status.cloudRevision = confirmation.revision;
  status.cloudConfirmedAt = confirmation.confirmedAt ?? Date.now();
  status.failure = null;
  status.conflict = null;
  commit(scope);
}

/** 云端失败：stale 的失败（旧序号）不覆盖当前状态。 */
export function failCloudSync(scope: string, seq: number, message: string): void {
  const status = statusOf(scope);
  if (seq !== (status.syncSeq ?? 0)) return;
  status.syncing = false;
  status.lastFinishedSeq = seq;
  status.failure = message;
  commit(scope);
}

export function reportConflict(scope: string, conflict: { remoteRevision: number; remoteName?: string }): void {
  const status = statusOf(scope);
  status.conflict = conflict;
  status.syncing = false;
  commit(scope);
}

/** 冲突解决（用户选了任意一方后调用；随后的一方会带新的确认）。 */
export function clearConflict(scope: string): void {
  const status = statusOf(scope);
  status.conflict = null;
  commit(scope);
}

/** 归档队列活动上报（本 scope 内进行中的上传数 / 总待上传数）。 */
export function reportUploads(scope: string, active: number, total: number): void {
  const status = statusOf(scope);
  status.uploadsActive = Math.max(0, active);
  status.uploadsTotal = Math.max(0, total);
  commit(scope);
}

/** 活动删除/账号切换时清掉该 scope 的状态，防串台。 */
export function forgetSaveStatus(scope: string): void {
  statuses.delete(scope);
  for (const listener of [...listeners]) listener();
}

/** 测试与重置用：清空全部状态。 */
export function resetSaveStatusForTests(): void {
  statuses.clear();
  for (const listener of [...listeners]) listener();
}

/** 用户可见的一句话状态（左栏 foot / 卡片角标共用，不出现「已保存」的模糊说法）。 */
export function saveStatusLabel(status: SaveStatus): string {
  switch (status.stage) {
    case 'conflict': return '版本冲突';
    case 'failed': return '云端未同步';
    case 'uploading': return `素材归档中${status.uploadsTotal > 0 ? `（${status.uploadsTotal - status.uploadsActive}/${status.uploadsTotal}）` : ''}`;
    case 'syncing': return status.pendingCount > 0 ? `待同步 · ${status.pendingCount} 处改动` : '同步中';
    case 'cloud-saved': return status.cloudRevision !== null ? `云端已保存 · v${status.cloudRevision}` : '云端已保存';
    default: return '已保存到本机';
  }
}
