import { createGlbCatalogItem, ensureGlbAsset, getGlbAssetState } from '../three/glb-assets';
import { aholoAssetUrl, findAholoAsset, importAholoAsset } from './aholo-assets';
import { findShippedAsset, shippedAssetUrl } from './shipped-assets';
import type { CatalogItem } from './types';
import type { SplatSource } from '../three/splat-preview';

/** 本机落盘的档和仓库留档的档走同一条摆放/预览链路，只差在地址从哪来。 */
type AssetLike = { assetId: string; kind: 'glb' | 'spz' | 'ply'; name: string };

/** 找到文件却打不开它时该说什么：物件与场景走的是两条不同的入口。 */
function sceneSourceOf(asset: AssetLike | undefined, url: string | undefined): SplatSource {
  if (!asset || !url) throw new Error('本机已经没有这个场景，请重新生成。');
  if (asset.kind === 'glb') throw new Error('这是物件模型，请在「生成物件」里摆进场景。');
  return { assetId: asset.assetId, url, name: asset.name };
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

/** 3DGS 场景预览：签名链接先落盘，预览只认本机那条稳定地址。 */
export async function loadAholoSceneSource(source: {
  url: string;
  name?: string;
  taskid?: string;
}): Promise<SplatSource> {
  const asset = await importAholoAsset(source);
  return sceneSourceOf(asset, asset.url);
}

/** 环境预览列表里的重复打开：本机那份回源到代理，仓库留档那份回源到本站。 */
export function storedAholoSceneSource(assetId: string): SplatSource {
  const shipped = findShippedAsset(assetId);
  if (shipped) return sceneSourceOf(shipped, shippedAssetUrl(shipped));
  const asset = findAholoAsset(assetId);
  return sceneSourceOf(asset, aholoAssetUrl(asset));
}
