import { listAholoAssets, type AholoAssetGeo } from './aholo-assets';
import { isGeneratedScanName, readableScanName, withScanNameOrdinal } from './scan-names';

/** 一套已扫描/重建好的真实场地；尺寸与时间来自扫描库记录。 */
export type ScannedVenue = {
  assetId: string;
  name: string;
  meters?: { width: number; depth: number; height: number };
  savedAt?: number;
  /** 拍摄位置（docs/19 地理底图）；没有就还没标注。 */
  geo?: AholoAssetGeo;
};

/**
 * 真实场地只认扫描库里的场景产物（spz/ply）。
 * glb 是物件模型，放不进场地列表；演示厅也不算真实场地，留在环境切换里。
 *
 * 名字在这里过一道口：历史占位名（「本机高斯 48245ba8」「云端高斯 6645e211」）换成
 * 「实景扫描 11/08」，同一天的按出现顺序加序号；用户起的名字原样保留。
 * 见 lib/scan-names.ts 的口径说明。
 */
export function listScannedVenues(): ScannedVenue[] {
  const seen = new Map<string, number>();
  return listAholoAssets()
    .filter(asset => asset.kind !== 'glb')
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
    .map(({ assetId, name, meters, savedAt, geo }) => {
      const readable = readableScanName(name, savedAt);
      return {
        assetId,
        name: isGeneratedScanName(readable) ? withScanNameOrdinal(readable, seen) : readable,
        ...(meters ? { meters: { ...meters } } : {}),
        ...(geo ? { geo: { ...geo } } : {}),
        savedAt,
      };
    });
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
