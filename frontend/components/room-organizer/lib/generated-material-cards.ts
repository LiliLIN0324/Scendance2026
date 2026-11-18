import { isLibraryModelSlug } from './asset-namespace';
import type { CloudAsset } from '@/lib/assets-api';

/** 工作台「我的生成」里的一格。cloud 表示只在账户资产库里，摆放时要先授权。 */
export interface GeneratedMaterialCard {
  id: string;
  name: string;
  image?: string;
  shipped: boolean;
  /** 账户云端的用户生成物。本机或随包已有同一资产号时不会再标这一位。 */
  cloud?: boolean;
  /** 云端记录里的占地（米）。没有时拖到地图用一份小占位，点选仍按 GLB 实测。 */
  width?: number;
  depth?: number;
}

/** 拖到地图时还没量过 GLB：给一份能通过落位校验的小占地，点选会换成实测。 */
export const GENERATED_DRAG_FALLBACK = { width: 0.5, depth: 0.5 } as const;

/**
 * 户外地图的 modelOverride 不收裸 UUID。
 * 随包/本机 id 本身就是 slug，原样用；云端资产号改成个人库同一条 `generated:library-` 前缀。
 */
export function generatedPlacementSlug(assetId: string): string {
  const id = assetId.trim();
  if (isLibraryModelSlug(id)) return id;
  return `generated:library-${id}`;
}

export function generatedCardFootprint(card: Pick<GeneratedMaterialCard, 'width' | 'depth'>): { width: number; depth: number } {
  if (typeof card.width === 'number' && card.width > 0 && typeof card.depth === 'number' && card.depth > 0) {
    return { width: card.width, depth: card.depth };
  }
  return { width: GENERATED_DRAG_FALLBACK.width, depth: GENERATED_DRAG_FALLBACK.depth };
}

/** 账户页「我的生成」同样只认物料自己带的预览地址。 */
function storedPreview(asset: CloudAsset): string | undefined {
  const meta = asset.metadata;
  if (!meta) return undefined;
  for (const value of [meta.previewUrl, meta.preview_url, meta.thumbnail, meta.thumbnail_url, meta.preview_image_url]) {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) return value;
  }
  return undefined;
}

/** 宽深都在 0.1–50 米才拿来当拖放占地；缺高或不合规就留给点选后的实测。 */
function storedFootprint(asset: CloudAsset): { width: number; depth: number } | undefined {
  const size = asset.metadata?.sourceSize;
  if (!size) return undefined;
  const { width, depth } = size;
  const usable = (value: number) => Number.isFinite(value) && value >= 0.1 && value <= 50;
  if (!usable(width) || !usable(depth)) return undefined;
  return { width, depth };
}

/**
 * 把账户云端的用户生成物并进工作台「我的生成」。
 * 与账户页同一条口径：`source !== 'polyhaven'` 且是 GLB。
 * 同一资产号只留一格：本机或随包已经能摆的优先，避免再下一份签名链接。
 * `cloud === null` 表示未登录或名单没读到，原样保留本机/随包。
 */
export function mergeCloudGeneratedCards(
  local: readonly GeneratedMaterialCard[],
  cloud: readonly CloudAsset[] | null,
): GeneratedMaterialCard[] {
  if (!cloud) return [...local];
  const seen = new Set(local.map(card => card.id));
  const added: GeneratedMaterialCard[] = [];
  for (const asset of cloud) {
    if (asset.format.toLowerCase() !== 'glb') continue;
    if (asset.source === 'polyhaven') continue;
    const name = asset.name.trim();
    if (!asset.id || !name || seen.has(asset.id)) continue;
    seen.add(asset.id);
    const image = storedPreview(asset);
    const footprint = storedFootprint(asset);
    added.push({ id: asset.id, name, shipped: false, cloud: true, ...(image ? { image } : {}), ...(footprint ?? {}) });
  }
  return [...local, ...added];
}
