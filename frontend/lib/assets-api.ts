import { layoutToBackendScene } from '@/components/room-organizer/lib/backend-adapter';
import { type Scene, sceneSchema } from '../../supabase/functions/_shared/domain';
import { generationRequestSchema, type GenerationRequest } from '../../supabase/functions/_shared/generation-contract';
import type { GenerationJob } from './backend-session';
import type { RoomLayout } from '@/components/room-organizer/lib/types';

export interface CloudAsset {
  id: string; name: string; source: string; format: string; byte_size: number;
  source_url?: string | null;
  /** 物主是谁。公共目录里的物料带着原主人的 id。 */
  owner_id?: string;
  /** 有值说明这物料在公共目录里，所有注册用户都能看到并取用。 */
  published_at?: string | null;
  /** 有值说明这物料在所属工作室的团队库（L2）里，同室成员可见并可取用。 */
  team_studio_id?: string | null;
  /** 团队库状态：pending 待审 / approved 已通过 / rejected 被驳回；只在团队列表里回带。 */
  status?: 'pending' | 'approved' | 'rejected';
  license?: { id?: string; type?: string; url?: string; attribution?: string; reviewedAt?: string };
  metadata?: {
    sourceSize?: AssetSize;
    /** 物料自己的预览图。没有则界面留空方块，不画通用椅子。 */
    previewUrl?: string;
    preview_url?: string;
    thumbnail?: string;
    thumbnail_url?: string;
    preview_image_url?: string;
    /** 归档时落下的原提示词；旧数据只在 backfill.originalName 里留了原名。 */
    originalPrompt?: string;
    prompt?: string;
    description?: string;
    backfill?: { originalName?: string; at?: string; preview?: string };
    /** 生成任务回执。图生 3D 的参考图是当前唯一可用的历史缩略图来源。 */
    generation?: {
      kind?: string;
      providerMode?: string;
      providerModel?: string;
      referenceImageAssetId?: string;
    };
  }; created_at?: string;
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
/**
 * 槽位满的人话。
 *
 * 服务端按「每个账号最多 3 个在跑的生成任务」收口（见
 * supabase/migrations/20261119130000_per_owner_concurrent_generation.sql），
 * 所以这里不能说「已有生成任务等待完成」——那是在说单人旧口径。
 * 统一生成面板与物料库面板都读这一句，别各写各的。
 */
export const GENERATION_BUSY_NOTICE = '这个账号已经有 3 个生成任务在跑，等一个完成后再提交；重试会沿用同一请求编号，不会重复扣费。';

export function assetError(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const messages: Record<string, string> = {
    SERVICE_NOT_CONFIGURED: '三维生成服务尚未配置，请联系管理员完成配置。',
    BILLING_NOT_CONFIGURED: '生成预算尚未配置，请联系管理员。',
    BUDGET_EXCEEDED: '生成预算已用完。请联系管理员核对预算，重试会沿用同一请求编号。',
    GENERATION_BUSY: GENERATION_BUSY_NOTICE,
    IDEMPOTENCY_CONFLICT: '此请求编号已对应其他内容，请联系管理员核对记录。',
    UNAUTHENTICATED: '登录已失效，请重新登录。当前画布和生成请求已保留。',
    SESSION_CHANGED: '账号已变化，请重新操作。',
    FORBIDDEN: '当前账号没有工作室权限，请联系管理员。',
    NO_COMPATIBLE_MODEL: '该模型暂不符合导入要求，请选择其他模型。',
    ASSET_NOT_FOUND: '没有访问此素材的权限，或素材已不存在。',
    ASSET_NOT_PUBLISHABLE: '只有 3D 模型可以进入团队库或公共目录。',
    INVALID_TEAM_DECISION: '审核结论只能是通过或驳回。',
    SOURCE_UV_REQUIRED: '此模型没有可用 UV，暂不能进行纹理生成，可先使用材质参数修改。',
    TEXTURE_GEOMETRY_CHANGED: '生成结果改变了几何或 UV，已拒绝应用，原模型保持不变。',
    REFERENCE_IMAGE_FORBIDDEN: '请选择当前账号上传的 PNG 或 JPEG 参考图。',
    INVALID_REFERENCE_IMAGE: '参考图尺寸不符合要求，请使用 129–4095 像素的 PNG 或 JPEG。',
    ASSET_NOT_IN_SAVED_SCENE: '云端项目尚未保存该资产，请先保存当前画布。',
    ROUTE_NOT_FOUND: '物料接口不存在，列表没有刷新。',
    PROVIDER_REJECTED: '生成服务商拒绝了这次请求。先检查描述是否含违规内容，或换一个模型再试。',
    PROVIDER_FAILED: '生成服务商这次没做完，本次通常不扣费；换一个模型或稍后再试。',
    PROVIDER_TIMEOUT: '生成服务商响应超时，稍后再试；不要连续重复提交。',
    PROVIDER_NO_GLB: '生成服务商没有产出模型文件，换一个模型再试。',
    FILE_TOO_LARGE: '生成文件超过入库上限。请降低面数或贴图尺寸，或换一个模型再试。',
    STORAGE_SIGN_FAILED: '预览图暂时签不出来，物料本身还在；刷新页面再试。',
    STORAGE_UPLOAD_FAILED: '生成结果上传失败，请稍后重试或联系管理员。',
  };
  return messages[code] ?? (error instanceof Error ? error.message : '请求失败，请稍后重试。');
}

/** 服务商名称的人话；未知来源原样显示，方便排查。 */
export function assetSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    aholo: 'Aholo Lux3D', hunyuan: '混元 3D', polyhaven: 'Poly Haven',
    upload: '本地上传', parametric: '参数化物料', shipped: '随包物料',
  };
  return labels[source] ?? source;
}

/** 图生 3D 的参考图资产号；只在格式合法时返回，调用方仍需向服务端换签名地址。 */
export function referenceImageAssetId(asset: Pick<CloudAsset, 'metadata'>): string | undefined {
  const id = asset.metadata?.generation?.referenceImageAssetId;
  return typeof id === 'string' && uuid.test(id) ? id : undefined;
}

/** 生成物料的原始描述。旧数据回填在 backfill.originalName，新数据在 originalPrompt。 */
export function assetPrompt(asset: Pick<CloudAsset, 'metadata'>): string | undefined {
  const metadata = asset.metadata;
  if (!metadata) return undefined;
  const values = [metadata.originalPrompt, metadata.prompt, metadata.description, metadata.backfill?.originalName];
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

/** 授权信息不猜：有署名给署名，有类型给类型，什么都没有就说未记录。 */
export function assetLicenseLabel(asset: Pick<CloudAsset, 'license'>): string {
  const license = asset.license;
  if (!license) return '未记录';
  if (license.attribution) return license.attribution;
  const labels: Record<string, string> = {
    'provider-terms': '服务商条款', 'cc0': 'CC0', 'cc-by': 'CC BY',
    'cc-by-sa': 'CC BY-SA', 'commercial': '商业授权', 'internal': '内部授权',
  };
  return labels[license.type ?? ''] ?? license.type ?? license.id ?? '已记录';
}

/** 文件大小按人读的单位显示；0/缺失不显示成 0 B。 */
export function assetBytesLabel(bytes: number | undefined): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) return '大小未记录';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
