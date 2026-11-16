/**
 * 云端资产库地址：人物漫游模型与本机扫描的云端副本都放在 R2 桶 scendance-assets
 * （公开读 + CORS 白名单只放行本站来源）。线上站点取不到开发机的 127.0.0.1:3199，
 * 所以云端站点一律从这里取文件；本地开发走同源的 /cloud-assets 代理，行为与线上一致。
 * 换桶或绑自定义域时改 NEXT_PUBLIC_CLOUD_ASSETS_BASE 即可，代码不感知具体主机。
 */
/** R2 公开读域名（桶 scendance-assets）。换桶或绑自定义域时改这里或 NEXT_PUBLIC_CLOUD_ASSETS_BASE。 */
const R2_PUBLIC_BASE = 'https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev';

/**
 * 本机开发走同源代理 /cloud-assets（next dev 重写到 R2，见 next.config.mjs）。
 * 原因：R2 的 CORS 白名单只放行线上站点，浏览器从 localhost:3210 直取模型会被拦，
 * 表现为「线上有角色、本地没有」。同源重写既不用改桶配置，也不用往白名单塞开发机。
 */
const DEV_PROXY_BASE = '/cloud-assets';

export const CLOUD_ASSETS_BASE = (
  process.env.NEXT_PUBLIC_CLOUD_ASSETS_BASE
  ?? (process.env.NODE_ENV === 'development' ? DEV_PROXY_BASE : R2_PUBLIC_BASE)
).replace(/\/+$/, '');

/** 云端扫描文件：scans/<assetId>.<kind>，与 .cache/aholo 的落盘命名一致。 */
export function cloudScanUrl(assetId: string, kind: 'spz' | 'ply'): string {
  return `${CLOUD_ASSETS_BASE}/scans/${assetId}.${kind}`;
}

/** 云端资产按类型分流：物件模型在 people/ 之外再前缀无——glb 一律按 people/ 解析。 */
export function cloudAssetUrl(assetId: string, kind: 'glb' | 'spz' | 'ply'): string {
  return kind === 'glb' ? cloudPeopleUrl(assetId) : cloudScanUrl(assetId, kind);
}

/** 云端漫游人物：people/<assetId>.glb，双动画模型由上云脚本一次性放入。 */
export function cloudPeopleUrl(assetId: string): string {
  return `${CLOUD_ASSETS_BASE}/people/${assetId}.glb`;
}

/** 云端扫描的 LOD 元数据：scans/<id>/lod-meta.json（目前只有茶室 130 一场）。 */
export function cloudScanLodUrl(scanId: string): string {
  return `${CLOUD_ASSETS_BASE}/scans/${scanId}/lod-meta.json`;
}
