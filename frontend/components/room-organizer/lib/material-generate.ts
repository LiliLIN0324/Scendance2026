import { useSyncExternalStore } from 'react';
import { DIRECT_BASE, isLux3dLocalProxy } from './aholo-assets';

/**
 * 物料库「＋」的两条生成入口。只打已经存在的 Aholo 路径（文生 /text-to-3d、图生 /image-to-3d）。
 * 密钥留在本机代理里；代理没开就停在说明上，不提交、不编一把钥匙。
 */
export type MaterialGenerateInput =
  | { kind: 'text'; prompt: string }
  | { kind: 'image'; imageDataUrl: string; prompt?: string };

/**
 * 云端生成队列（生产通路）：登录云项目后，由服务端调用 Lux3D 并把 GLB 归档进对象存储。
 * 直连代理（本机 3199 或部署的中转）只是可选加速，缺省时自动走这条。
 */
export interface MaterialCloudLane {
  createJob(prompt: string, options: { kind: 'text' | 'image'; referenceImageAssetId?: string }): Promise<{ id: string }>;
  uploadReference(file: File): Promise<{ id: string }>;
}

export type MaterialGenerateResult =
  | { ok: true; taskid: string; kind: 'text' | 'image'; lane: 'direct' | 'cloud' }
  | { ok: false; stub: boolean; message: string };

const NO_CHANNEL = '生成通道没接通：线上需要登录云项目（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY），本地可启动 tools/aholo/lux3d-dev-proxy.mjs 后重试。';

/** 提交成功的任务号：生成入口在底部对话里，物料卡要看得见同一份。 */
export interface PendingMaterial {
  id: string;
  name: string;
  image?: string;
  shipped: false;
  /** 提交时间：取回时按最新的一条先试。 */
  submittedAt?: number;
}

const PENDING_KEY = 'scendance:lux3d-pending';

function pendingStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readPending(storage: Storage | null): PendingMaterial[] {
  if (!storage) return [];
  try {
    const raw: unknown = JSON.parse(storage.getItem(PENDING_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((value): value is PendingMaterial => {
      const item = value as PendingMaterial;
      return Boolean(item) && typeof item.id === 'string' && item.id.startsWith('pending:') &&
        typeof item.name === 'string' && item.shipped === false;
    }).slice(0, 12) : [];
  } catch {
    return [];
  }
}

function writePending(items: PendingMaterial[]): void {
  const storage = pendingStorage();
  if (!storage) return;
  try {
    storage.setItem(PENDING_KEY, JSON.stringify(items));
  } catch {
    /* 存不下只丢待取回列表；任务号还在生成入口的提示里。 */
  }
}

let pendingMaterials: PendingMaterial[] = readPending(pendingStorage());
const pendingListeners = new Set<() => void>();

function emitPending(): void {
  for (const listener of [...pendingListeners]) listener();
}

/** 待取回任务跟着物料库一起持久化：刷新后仍能自动把它接回来。 */
export function addPendingMaterial(item: PendingMaterial): void {
  if (pendingMaterials.some(current => current.id === item.id)) return;
  const record: PendingMaterial = { ...item, submittedAt: item.submittedAt ?? Date.now() };
  pendingMaterials = [record, ...pendingMaterials];
  writePending(pendingMaterials);
  emitPending();
}

export function removePendingMaterial(id: string): void {
  const next = pendingMaterials.filter(item => item.id !== id);
  if (next.length === pendingMaterials.length) return;
  pendingMaterials = next;
  writePending(next);
  emitPending();
}

export function listPendingMaterials(): PendingMaterial[] {
  return pendingMaterials;
}

function subscribePending(listener: () => void): () => void {
  pendingListeners.add(listener);
  return () => { pendingListeners.delete(listener); };
}

/** 单独的订阅口：取回模块导入成功后通知物料库重算卡片。 */
export function subscribePendingMaterials(listener: () => void): () => void {
  return subscribePending(listener);
}

export function usePendingMaterials(): PendingMaterial[] {
  return useSyncExternalStore(subscribePending, () => pendingMaterials, () => pendingMaterials);
}

export interface MaterialGenerateOptions {
  /** 测试里替掉全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 测试里强制当作直连通道已开或未开。正式界面不传。 */
  localProxy?: boolean;
  /** 云端生成队列（生产通路）；没有直连通道时用它提交。 */
  cloud?: MaterialCloudLane;
}

function taskIdOf(body: unknown): string {
  const row = body as { taskid?: unknown; error?: unknown };
  if (row && typeof row.error === 'string' && row.error) throw new Error(row.error);
  const taskid = String(row?.taskid ?? '');
  if (!/^\d+$/.test(taskid)) throw new Error('接口没返回有效任务号。');
  return taskid;
}

/** 数据 URL 换回 File，好走云端 `/assets/floorplan` 的参考图上传口。 */
function dataUrlToFile(dataUrl: string): File {
  const match = /^data:(image\/[^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('请选择一张 PNG 或 JPEG。');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], 'reference', { type: match[1] });
}

/** 云端失败说清缺什么：没配 LUX3D_API_KEY 和没开权限是两件事。 */
function cloudFailure(failure: unknown): string {
  const message = failure instanceof Error ? failure.message : '';
  if (/SERVICE_NOT_CONFIGURED|LUX3D_API_KEY|PROVIDER_NOT_CONFIGURED/i.test(message)) {
    return '云端没配置 Lux3D（缺少 LUX3D_API_KEY / LUX3D_TERMS_URL / LUX3D_TERMS_REVIEWED_AT），生成暂不可用。';
  }
  if (/UNAUTHENTICATED|401/i.test(message)) return '登录已过期，请重新登录云项目后再生成。';
  return message || '云端没接受这次生成，请稍后再试。';
}

export async function submitMaterialGenerate(input: MaterialGenerateInput, options: MaterialGenerateOptions = {}): Promise<MaterialGenerateResult> {
  const prompt = input.kind === 'text' ? input.prompt.trim() : (input.prompt ?? '').trim();
  if (input.kind === 'text' && !prompt) return { ok: false, stub: false, message: '先写一句要生成的物料。' };
  if (input.kind === 'image' && !input.imageDataUrl.startsWith('data:image/')) return { ok: false, stub: false, message: '请选择一张 PNG 或 JPEG。' };

  // 先试直连通道（本机代理或部署的中转）——它只是加速，不是唯一通路。
  const local = options.localProxy ?? isLux3dLocalProxy();
  if (local) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const path = input.kind === 'text' ? '/text-to-3d' : '/image-to-3d';
    const payload = input.kind === 'text' ? { prompt } : { img: input.imageDataUrl };
    try {
      const response = await fetchImpl(`${DIRECT_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `提交没成功（HTTP ${response.status}），没有确认扣费。`;
        return { ok: false, stub: false, message };
      }
      return { ok: true, taskid: taskIdOf(body), kind: input.kind, lane: 'direct' };
    } catch (failure) {
      // 直连通道打不通（没起代理、网络断）不是终点：有云端队列就接着走。
      if (!options.cloud) return { ok: false, stub: false, message: failure instanceof Error ? failure.message : '提交没成功，没有确认扣费。' };
    }
  }

  if (!options.cloud) return { ok: false, stub: true, message: NO_CHANNEL };
  try {
    if (input.kind === 'image') {
      const uploaded = await options.cloud.uploadReference(dataUrlToFile(input.imageDataUrl));
      const job = await options.cloud.createJob(prompt || '图片物料', { kind: 'image', referenceImageAssetId: uploaded.id });
      return { ok: true, taskid: job.id, kind: 'image', lane: 'cloud' };
    }
    const job = await options.cloud.createJob(prompt, { kind: 'text' });
    return { ok: true, taskid: job.id, kind: 'text', lane: 'cloud' };
  } catch (failure) {
    return { ok: false, stub: false, message: cloudFailure(failure) };
  }
}
