/**
 * 仓库里长期留档的 Aholo 产物：随网站一起发布，不依赖浏览器本机记录。
 * 本机落盘的那一份换浏览器或清站点数据就没了，这一份才是「生成历史」；
 * 地址是同源路径，所以摆进图纸后连资产号带链接一起存下来，重开不用回查。
 */
export type ShippedAssetKind = 'glb' | 'spz';

export type ShippedAsset = {
  assetId: string;
  kind: ShippedAssetKind;
  name: string;
  /** 相对 `assets/generated/` 的文件路径。 */
  path: string;
  bytes: number;
  /** 卡片上那张图：物件是渲染缩略图，场景是接口返回的全景图。 */
  image?: string;
};

const BASE = '/showcase/assets/generated';

export const SHIPPED_ASSETS: readonly ShippedAsset[] = [
  { assetId: 'shipped-chinese-wood-armchair', kind: 'glb', name: '中式木扶手椅', path: 'model/chinese-wood-armchair.glb', bytes: 6433368, image: 'thumb/chinese-wood-armchair.png' },
  { assetId: 'shipped-white-round-table', kind: 'glb', name: '白色圆桌', path: 'model/white-round-table.glb', bytes: 2784124, image: 'thumb/white-round-table.png' },
  { assetId: 'shipped-scendance-m3-mvp', kind: 'spz', name: 'Scendance-M3-MVP', path: 'scene/scendance-m3-mvp.spz', bytes: 4388248, image: 'scene/scendance-m3-mvp.panorama.jpg' },
  { assetId: 'shipped-small-launch-hall', kind: 'spz', name: '小型发布会场地', path: 'scene/small-launch-hall.spz', bytes: 4837840, image: 'scene/small-launch-hall.panorama.jpg' },
];

export function shippedAssetUrl(asset: ShippedAsset): string {
  return `${BASE}/${asset.path}`;
}

/** 卡片上那张图与产物同一个打包目录；没有图就退回占位符。 */
export function shippedImageUrl(asset: ShippedAsset): string | undefined {
  return asset.image ? `${BASE}/${asset.image}` : undefined;
}

export function findShippedAsset(assetId?: string): ShippedAsset | undefined {
  if (!assetId) return undefined;
  return SHIPPED_ASSETS.find(asset => asset.assetId === assetId);
}

/** 货架用：物件一格、场景一格。 */
export function listShippedAssets(kind: ShippedAssetKind): ShippedAsset[] {
  return SHIPPED_ASSETS.filter(asset => asset.kind === kind);
}
