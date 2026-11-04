import { listAholoAssets } from './aholo-assets';

/** 一套已扫描/重建好的真实场地；尺寸与时间来自扫描库记录。 */
export type ScannedVenue = {
  assetId: string;
  name: string;
  meters?: { width: number; depth: number; height: number };
  savedAt?: number;
};

/**
 * 真实场地只认扫描库里的场景产物（spz/ply）。
 * glb 是物件模型，放不进场地列表；演示厅也不算真实场地，留在环境切换里。
 */
export function listScannedVenues(): ScannedVenue[] {
  return listAholoAssets()
    .filter(asset => asset.kind !== 'glb')
    .map(({ assetId, name, meters, savedAt }) => ({
      assetId,
      name,
      ...(meters ? { meters: { ...meters } } : {}),
      savedAt,
    }))
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

/** 列表副标题：尺寸与扫描时间；没有的就说没有，不编数字。 */
export function describeScannedVenue(venue: ScannedVenue): string {
  const size = venue.meters
    ? `${venue.meters.width.toFixed(1)} × ${venue.meters.depth.toFixed(1)} m`
    : '尺寸未标注';
  const when = venue.savedAt
    ? `扫描于 ${new Date(venue.savedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}`
    : '扫描时间未知';
  return `${size} · ${when}`;
}
