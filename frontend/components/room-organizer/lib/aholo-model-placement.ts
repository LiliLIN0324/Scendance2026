import { createGlbCatalogItem, ensureGlbAsset, getGlbAssetState } from '../three/glb-assets';
import { aholoAssetUrl, DIRECT_BASE, findAholoAsset, importAholoAsset } from './aholo-assets';
import { findShippedAsset, shippedAssetUrl } from './shipped-assets';
import type { CatalogItem } from './types';
import type { SplatMeters, SplatSource } from '../three/splat-preview';

/** 本机落盘的档和仓库留档的档走同一条摆放/预览链路，只差在地址从哪来。 */
type AssetLike = { assetId: string; kind: 'glb' | 'spz' | 'ply'; name: string; meters?: SplatMeters };

/** 找到文件却打不开它时该说什么：物件与场景走的是两条不同的入口。 */
function sceneSourceOf(asset: AssetLike | undefined, url: string | undefined): SplatSource {
  if (!asset || !url) throw new Error('本机已经没有这个场景，请重新生成。');
  if (asset.kind === 'glb') throw new Error('这是物件模型，请在「生成物件」里摆进场景。');
  return { assetId: asset.assetId, url, name: asset.name, ...(asset.meters ? { meters: asset.meters } : {}) };
}

/**
 * lod-meta 的 forwardBox（米制、Z-up）换算成布置场地的宽深高。
 * 离谱的值当没有（扫描坏档），别把场地校到 0.2 m 或 300 m 去。
 */
export function metersFromForwardBox(value: unknown): SplatMeters | null {
  if (!value || typeof value !== 'object') return null;
  const box = value as { min?: unknown; max?: unknown };
  if (!Array.isArray(box.min) || !Array.isArray(box.max)) return null;
  const min = box.min as unknown[];
  const max = box.max as unknown[];
  const span = (index: number): number => {
    const low = min[index], high = max[index];
    return typeof low === 'number' && typeof high === 'number' && Number.isFinite(low) && Number.isFinite(high)
      ? Math.abs(high - low) : Number.NaN;
  };
  const width = span(0), depth = span(1), height = span(2);
  const usable = (n: number): boolean => Number.isFinite(n) && n >= 0.5 && n <= 120;
  return usable(width) && usable(depth) && usable(height)
    ? { width: Math.round(width * 10) / 10, depth: Math.round(depth * 10) / 10, height: Math.round(height * 10) / 10 }
    : null;
}

/** lod-meta 经本机代理取回（Aholo 域名白名单在代理侧）；拿不到就返回 null，预览退回场地缩放。 */
export async function loadAholoSceneMeters(metaUrl: string): Promise<SplatMeters | null> {
  try {
    const response = await fetch(`${DIRECT_BASE}/meta?url=${encodeURIComponent(metaUrl)}`);
    if (!response.ok) return null;
    const meta = await response.json() as { forwardBox?: unknown };
    return metersFromForwardBox(meta?.forwardBox);
  } catch {
    return null;
  }
}

/** 文件已经在，只是按模型量一次宽高深；缓存命中时不再读盘。 */
async function toCatalogItem(asset: AssetLike, url: string): Promise<CatalogItem> {
  if (asset.kind !== 'glb') throw new Error('场景点云文件不能当作物件摆放。');
  await ensureGlbAsset(asset.assetId, url);
  const dimensions = getGlbAssetState(asset.assetId).dimensions;
  if (!dimensions) throw new Error('模型没有量出尺寸，请重新落盘。');
  return createGlbCatalogItem({
    name: asset.name, url, assetId: asset.assetId,
    width: dimensions.width, depth: dimensions.depth, height: dimensions.height,
    source: 'generated',
  });
}

/**
 * Aholo 的产物变成可摆放物料：先落盘换成本机地址，再按模型本身量出宽高深。
 * 同一任务号已经落过盘就复用本机文件，重复点击不会再下载第二次。
 */
export async function loadAholoCatalogItem(source: {
  url: string;
  name?: string;
  taskid?: string;
}): Promise<CatalogItem> {
  const asset = await importAholoAsset(source);
  return toCatalogItem(asset, asset.url);
}

/** 货架里的重复摆放：本机落盘的认资产号，仓库留档的认那条随网站发布的路径。 */
export async function loadStoredAholoCatalogItem(assetId: string): Promise<CatalogItem> {
  const shipped = findShippedAsset(assetId);
  if (shipped) return toCatalogItem(shipped, shippedAssetUrl(shipped));
  const asset = findAholoAsset(assetId);
  const url = aholoAssetUrl(asset);
  if (!asset || !url) throw new Error('本机已经没有这个模型，请重新生成。');
  return toCatalogItem(asset, url);
}

/** 3DGS 场景预览：签名链接先落盘，lod-meta 换真实尺度（高斯优先），预览只认本机那条稳定地址。 */
export async function loadAholoSceneSource(source: {
  url: string;
  name?: string;
  taskid?: string;
  metaUrl?: string;
}): Promise<SplatSource> {
  const meters = source.metaUrl ? await loadAholoSceneMeters(source.metaUrl) : null;
  const asset = await importAholoAsset({ ...source, ...(meters ? { meters } : {}) });
  return sceneSourceOf(asset, asset.url);
}

/** 环境预览列表里的重复打开：本机那份回源到代理，仓库留档那份回源到本站。 */
export function storedAholoSceneSource(assetId: string): SplatSource {
  const shipped = findShippedAsset(assetId);
  if (shipped) return sceneSourceOf(shipped, shippedAssetUrl(shipped));
  const asset = findAholoAsset(assetId);
  return sceneSourceOf(asset, aholoAssetUrl(asset));
}
