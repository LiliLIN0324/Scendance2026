/**
 * 各底图「真正有瓦片的最高级」——2D 画布、3D 贴地拼图、3D 瓦片金字塔三处共用这一张表。
 *
 * 上限不是图源的宣传值，而是「我们这把 key / 这些端点在实测里还能出真图」的级别：
 * 超过它，请求会拿到 403、空瓦片或占位图，画布上就是一块灰（用户报的「放大到一定程度变空白」）。
 * 所以三处统一按这张表封顶，再往里一律由 overzoom 把上限级瓦片等比拉伸（糊但连续）。
 *
 * 实测依据（2026-11-16，同一把 Carto key、北京同坐标）：
 *   Carto z16 14.9 KB / z17 10.5 KB / z18 6.5 KB 是真图，z19/z20 一律 403；
 *   OSM z19 真图、z20 直接 400（且无 CORS 头）；
 *   高德卫星 z19/z20 是 4235 B 灰底「此区域无卫星图」占位，矢量 z19 起是 100 多字节空瓦片；
 *   天地图影像/矢量 z18 真图，z19/z20 同一张占位图。
 *
 * 换 key 或又出现「放大变空」时，跑一条命令让实测结果和这张表对一遍：
 *   node scripts/probe-basemap-zoom.mjs          # 逐级探测 + 比对，不一致退出码 1
 *   node scripts/probe-basemap-zoom.mjs --apply  # 把探测到的真实上限写回本文件
 */
export const BASEMAP_NATIVE_MAX_ZOOM = {
  osm: 19,
  'carto-light': 18,
  'carto-dark': 18,
  'amap-satellite': 18,
  'amap-streets': 18,
  'amap-streets-labels': 18,
  vec: 18,
  img: 18,
} as const;

export type BasemapNativeSource = keyof typeof BASEMAP_NATIVE_MAX_ZOOM;

/** 某图源的瓦片级别上限；视图级别可以更高，多出来的部分由 overzoom 拉伸。 */
export function basemapNativeMaxZoom(source: BasemapNativeSource): number {
  return BASEMAP_NATIVE_MAX_ZOOM[source];
}
