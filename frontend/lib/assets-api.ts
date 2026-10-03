import { layoutToBackendScene } from '@/components/room-organizer/lib/backend-adapter';
import { type Scene, sceneSchema } from '../../supabase/functions/_shared/domain';
import { generationRequestSchema, type GenerationRequest } from '../../supabase/functions/_shared/generation-contract';
import type { GenerationJob } from './backend-session';
import type { RoomLayout } from '@/components/room-organizer/lib/types';

export interface CloudAsset {
  id: string; name: string; source: string; format: string; byte_size: number;
  source_url?: string | null; license?: { id?: string; url?: string; attribution?: string };
  metadata?: { sourceSize?: AssetSize }; created_at?: string;
}
export interface AuthorizedAsset { id: string; name: string; source: string; url: string }
export interface AssetSize { width: number; depth: number; height: number }
export type GenerationIntent = Omit<GenerationRequest,'kind'> & {kind?:GenerationRequest['kind'];jobId?:string};
export function generationIntentFingerprint(intent:GenerationIntent):string {
  const input={...intent};delete input.jobId;
  return JSON.stringify(generationRequestSchema.parse(input));
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const jobLabels: Record<GenerationJob['state'], string> = {
  queued: '等待处理', submitting: '正在提交', submitted: '已提交', processing: '正在生成',
  archiving: '正在归档', ready: '可预览', added: '已加入云项目', failed: '生成失败',
  rejected: '模型未通过校验', submit_unknown: '提交结果待核对',
};
export function jobIsActive(job: GenerationJob): boolean {
  return !['ready', 'added', 'failed', 'rejected'].includes(job.state);
}
export function intentStorageKey(apiUrl: string, accountId: string): string {
  return `scendance:generation-intent:${apiUrl}:${accountId}`;
}
/** Persist before submitting, so a reload never silently creates a second paid request. */
export function saveGenerationIntent(storage: Pick<Storage, 'setItem' | 'getItem'>, key: string, intent: GenerationIntent): void {
  try {
    const value = JSON.stringify(intent);
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) throw new Error('Storage unavailable');
  } catch { throw new Error('无法保存生成请求编号。请允许本地存储后再提交，以便安全恢复任务。'); }
}
export function readGenerationIntent(storage: Pick<Storage, 'getItem'>, key: string): GenerationIntent | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as GenerationIntent;
    if (!uuid.test(value.requestId) || typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 1024 || value.jobId && !uuid.test(value.jobId)) throw new Error('Invalid intent');
    const request={...value};delete request.jobId;
    generationRequestSchema.parse(request);
    return value;
  } catch { throw new Error('无法读取上一次生成请求。请先核对云任务记录；恢复本地存储前不能新建付费任务。'); }
}
export function assetError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    SERVICE_NOT_CONFIGURED: '三维生成服务尚未配置，请联系管理员完成配置。',
    BILLING_NOT_CONFIGURED: '生成预算尚未配置，请联系管理员。',
    BUDGET_EXCEEDED: '生成预算已用完。请联系管理员核对预算，重试会沿用同一请求编号。',
    GENERATION_BUSY: '已有生成任务等待完成，请稍后重试同一请求。',
    IDEMPOTENCY_CONFLICT: '此请求编号已对应其他内容，请联系管理员核对记录。',
    UNAUTHENTICATED: '登录已失效，请重新登录。当前画布和生成请求已保留。',
    SESSION_CHANGED: '账号已变化，请重新操作。',
    FORBIDDEN: '当前账号没有工作室权限，请联系管理员。',
    NO_COMPATIBLE_MODEL: '该模型暂不符合导入要求，请选择其他模型。',
    ASSET_NOT_FOUND: '没有访问此素材的权限，或素材已不存在。',
    SOURCE_UV_REQUIRED: '此模型没有可用 UV，暂不能进行纹理生成，可先使用材质参数修改。',
    TEXTURE_GEOMETRY_CHANGED: '生成结果改变了几何或 UV，已拒绝应用，原模型保持不变。',
    REFERENCE_IMAGE_FORBIDDEN: '请选择当前账号上传的 PNG 或 JPEG 参考图。',
    INVALID_REFERENCE_IMAGE: '参考图尺寸不符合要求，请使用 129–4095 像素的 PNG 或 JPEG。',
    ASSET_NOT_IN_SAVED_SCENE: '云端项目尚未保存该资产，请先保存当前画布。',
  };
  return messages[code] ?? (error instanceof Error ? error.message : '请求失败，请稍后重试。');
}
export function validAssetSize(size: AssetSize): boolean {
  return Number.isFinite(size.width) && size.width >= 0.1 && size.width <= 50 &&
    Number.isFinite(size.depth) && size.depth >= 0.1 && size.depth <= 50 &&
    Number.isFinite(size.height) && size.height >= 0.01 && size.height <= 30;
}
export function assetPreviewScene(asset: Pick<CloudAsset, 'id'>, size: AssetSize): Scene {
  return sceneSchema.parse({ schemaVersion: 1,
    venue: { shape: 'rectangle', width: Math.max(4, size.width + 2), depth: Math.max(4, size.depth + 2), height: Math.max(3, size.height), entrances: [] },
    objects: [{ id: asset.id, materialId: 'asset', assetId: asset.id, position: { x: Math.max(4, size.width + 2) / 2, z: Math.max(4, size.depth + 2) / 2 },
      rotation: 0, size, color: '#ffffff', locked: false, notes: '' }], camera: 'overview', lighting: 'neutral' });
}
export function addAssetToLayout(layout: RoomLayout, asset: AuthorizedAsset, size: AssetSize): RoomLayout {
  if (!validAssetSize(size)) throw new Error('请输入有效米制尺寸：宽深 0.1–50 米，高 0.01–30 米。');
  if (size.width > layout.width || size.depth > layout.height || size.height > (layout.floors[0]?.height ?? 3)) throw new Error('模型尺寸超出当前场地，请调整尺寸。');
  const next: RoomLayout = { ...layout, floors: layout.floors.map((floor, index) => index ? floor : { ...floor, items: [...floor.items, {
    id: crypto.randomUUID(), type: 'glb-asset', materialId: 'asset', assetId: asset.id, glbUrl: asset.url,
    name: asset.name, ...size, color: '#ffffff', icon: '◇', locked: false, notes: '',
    position: { x: 0, z: 0 }, rotation: 0, source: asset.source === 'polyhaven' ? 'public_library' : 'generated',
  }] }) };
  layoutToBackendScene(next);
  return next;
}
