import type { CloudAsset } from '@/lib/assets-api';

/** 工作台「我的生成」里的一格。cloud 表示只在账户资产库里，摆放时要先授权。 */
export interface GeneratedMaterialCard {
  id: string;
  name: string;
  image?: string;
  shipped: boolean;
  /** 账户云端的用户生成物。本机或随包已有同一资产号时不会再标这一位。 */
  cloud?: boolean;
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
    added.push({ id: asset.id, name, shipped: false, cloud: true, ...(image ? { image } : {}) });
  }
  return [...local, ...added];
}
