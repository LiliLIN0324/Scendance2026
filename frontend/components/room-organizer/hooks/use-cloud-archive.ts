'use client';

/**
 * 云端归档接线（任务 B / C03–C05、C14 的运行时）。
 *
 * 职责：把共享队列（archive-queue.ts）与 A 的归档传输（cloud-archive.ts 探测）
 * 接到 React 侧：能力探测、账号/工作室隔离 scope、队列列表订阅、自动补传、
 * 上传活动上报给统一保存状态机。
 *
 * 铁律：transport 为 null（A 的方法未上线）时不发起任何上传，也不报告成功；
 * 队列任务只在本机积累，原件留在原处，等通道接通后由这里的 drain 续传。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { backendFailureText, type BackendSession } from '@/lib/backend-session';
import { aholoAssetUrl, findAholoAsset } from '../lib/aholo-assets';
import { sharedArchiveQueue, type ArchiveJob, type ArchiveScope } from '../lib/archive-queue';
import {
  CLOUD_ARCHIVE_UNAVAILABLE_MESSAGE,
  createDirectArchiveUpload,
  resolveCloudArchiveTransport,
  type CloudArchiveTransport,
  type CloudCapabilities,
} from '../lib/cloud-archive';
import { reportUploads } from '../lib/save-status';

export interface EnqueueFileInput {
  localId: string;
  name: string;
  kind: ArchiveJob['kind'];
  file: Blob;
  /** 归档目标工作室；省略 = 个人私有（需当前管理员）。 */
  studioId?: string;
}

export interface UseCloudArchiveOptions {
  controller: BackendSession | null | undefined;
  /** 账号 id；未登录为 null（不排队、不探测）。 */
  userId: string | null | undefined;
  /** 当前工作室（隔离与展示用；归档默认落个人私有）。 */
  studioId?: string | null;
  /** 归档目标工作室（官方共同归属）；省略 = 个人私有。 */
  archiveStudioId?: string | null;
  /** 登录且面板开启后才工作。 */
  enabled?: boolean;
  /** 上传活动上报到统一保存状态的 scope（当前项目）。 */
  statusScope?: string | null;
}

export interface CloudArchiveState {
  transport: CloudArchiveTransport | null;
  capabilities: CloudCapabilities | null;
  capabilityError: string | null;
  unavailableMessage: string | null;
  scope: ArchiveScope | null;
  jobs: ArchiveJob[];
  counts: { pending: number; uploading: number; failed: number; needsFile: number; uploaded: number };
  draining: boolean;
  /** 惰性能力查询：只在归档页可见时调用，不在挂载时偷偷发请求（列表/保存路径不依赖它）。 */
  queryCapabilities(): Promise<void>;
  enqueueAholoAsset(assetId: string): Promise<ArchiveJob | null>;
  enqueueFile(input: EnqueueFileInput): Promise<ArchiveJob>;
  /** 手动补传：drain 所有未完成任务。 */
  retry(): Promise<void>;
  refresh(): Promise<void>;
}

function scopeKeyOf(userId: string | null | undefined, studioId: string | null | undefined): string {
  return `${userId ?? ''}|${studioId ?? ''}`;
}

export function useCloudArchive({ controller, userId, studioId, archiveStudioId, enabled = false, statusScope }: UseCloudArchiveOptions): CloudArchiveState {
  const transport = useMemo(() => resolveCloudArchiveTransport(controller), [controller]);
  const scope = useMemo<ArchiveScope | null>(
    () => userId ? { userId, ...(studioId ? { studioId } : {}) } : null,
    [userId, studioId],
  );
  const scopeKey = scopeKeyOf(userId, studioId);
  const [jobs, setJobs] = useState<ArchiveJob[]>([]);
  const [capabilities, setCapabilities] = useState<CloudCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [draining, setDraining] = useState(false);
  const scopeRef = useRef<ArchiveScope | null>(scope);
  const scopeEpochRef = useRef(0);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  scopeRef.current = scope;

  const refresh = useCallback(async (): Promise<void> => {
    if (!scopeRef.current) { setJobs([]); return; }
    try { setJobs(await sharedArchiveQueue.inventory(scopeRef.current)); }
    catch { setJobs([]); }
  }, []);

  // scope 变化 = 账号或工作室切换：立即停旧 drain，旧账号的上传不得继承到新账号。
  useEffect(() => {
    scopeEpochRef.current += 1;
    sharedArchiveQueue.stop();
    setCapabilities(null); setCapabilityError(null); setJobs([]); setDraining(false);
    void refresh();
  }, [scopeKey, refresh]);

  useEffect(() => sharedArchiveQueue.subscribe(() => { void refresh(); }), [refresh]);

  // 能力探测：惰性触发（UI 打开归档页时调用）。挂载时不自动发请求——
  // 项目列表/保存路径不依赖 capabilities，也不想给既有请求序列添乱。
  const queryCapabilities = useCallback(async (): Promise<void> => {
    if (!transport || !userId || !enabledRef.current) return;
    try {
      const next = await transport.getCloudCapabilities();
      setCapabilities(next); setCapabilityError(null);
    } catch (error) {
      setCapabilities(null);
      // 能力探测失败属通道状态，错误码转人话，不把后端 code 贴到面板上。
      setCapabilityError(backendFailureText(error));
    }
  }, [transport, userId]);

  // 自动补传：有未完成任务且通道可用就 drain；scope 变化（epoch）终止旧循环。
  useEffect(() => {
    if (!transport || !scope || !enabled) return;
    if (!jobs.some(job => job.state !== 'uploaded')) return;
    const epoch = scopeEpochRef.current;
    const upload = createDirectArchiveUpload(transport);
    setDraining(true);
    sharedArchiveQueue
      .drain(scope, upload, () => scopeEpochRef.current === epoch && enabledRef.current)
      .catch(() => { /* 每个任务的状态已在队列里如实落盘 */ })
      .finally(() => { if (scopeEpochRef.current === epoch) setDraining(false); });
  }, [transport, scope, enabled, jobs]);

  // 上传活动上报给统一保存状态（C05：素材归档中/待归档数）。
  useEffect(() => {
    if (!statusScope) return;
    const outstanding = jobs.filter(job => job.state !== 'uploaded').length;
    reportUploads(statusScope, draining && outstanding > 0 ? 1 : 0, outstanding);
  }, [statusScope, jobs, draining]);

  const enqueueAholoAsset = useCallback(async (assetId: string): Promise<ArchiveJob | null> => {
    const currentScope = scopeRef.current;
    const asset = findAholoAsset(assetId);
    const url = aholoAssetUrl(asset);
    if (!currentScope || !asset || !url || !asset.bytes) return null;
    try {
      return await sharedArchiveQueue.enqueue({
        scope: currentScope,
        localId: asset.assetId,
        name: asset.name,
        kind: asset.kind === 'glb' ? 'model' : 'scan',
        bytes: asset.bytes,
        localUrl: url,
        ...(archiveStudioId ? { studioId: archiveStudioId } : {}),
      });
    } catch { return null; }
  }, [archiveStudioId]);

  const enqueueFile = useCallback(async (input: EnqueueFileInput): Promise<ArchiveJob> => {
    const currentScope = scopeRef.current;
    if (!currentScope) throw new Error('未登录，云端归档不可用；本机原件保留。');
    if (!input.file.size) throw new Error('这个文件是空的，没有归档任何内容。');
    return sharedArchiveQueue.enqueue({
      scope: currentScope,
      localId: input.localId,
      name: input.name,
      kind: input.kind,
      bytes: input.file.size,
      blob: input.file,
      ...(input.studioId || archiveStudioId ? { studioId: input.studioId ?? archiveStudioId! } : {}),
    });
  }, [archiveStudioId]);

  const retry = useCallback(async (): Promise<void> => {
    const currentScope = scopeRef.current;
    if (!transport || !currentScope || !enabledRef.current) return;
    const epoch = scopeEpochRef.current;
    setDraining(true);
    try {
      await sharedArchiveQueue.drain(currentScope, createDirectArchiveUpload(transport), () => scopeEpochRef.current === epoch && enabledRef.current);
    } finally { if (scopeEpochRef.current === epoch) setDraining(false); }
  }, [transport]);

  const counts = useMemo(() => {
    const base = { pending: 0, uploading: 0, failed: 0, needsFile: 0, uploaded: 0 };
    for (const job of jobs) {
      if (job.state === 'needs-file') base.needsFile += 1;
      else base[job.state] += 1;
    }
    return base;
  }, [jobs]);

  return {
    transport,
    capabilities,
    capabilityError,
    unavailableMessage: transport ? null : CLOUD_ARCHIVE_UNAVAILABLE_MESSAGE,
    scope,
    jobs,
    counts,
    draining,
    queryCapabilities,
    enqueueAholoAsset,
    enqueueFile,
    retry,
    refresh,
  };
}
