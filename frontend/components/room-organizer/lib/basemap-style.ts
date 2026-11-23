/**
 * 户外底图的唯一记录：地图 / 卫星 / 浅色 / 纸面。
 *
 * 工作台、评审页以及任何后来的消费方都读这一份选择，再经
 * `tileSourceForBasemapStyle` 换成唯一的瓦片源。不要在外面再维护一张
 * 「卫星 = 高德 / 全球卫星 / 天地图」的平行表——2026-11-23 工作台图层写着
 * 「当前底图 全球卫星」（Esri World Imagery），同一方案的评审页却铺
 * 「© 高德地图 · 卫星影像」，画布右侧出现两套影像接在一起的色缝。
 *
 * 锚点仍是 GCJ-02，这里不改投影：
 * - 境内「地图 / 卫星」用高德，网格本身就是 GCJ-02，取瓦片不做 WGS 平移；
 * - 「浅色」是 Carto（WGS-84），取瓦片仍走既有的 `alignedTileCenter`，
 *   杭州一带那约 500 米的偏移留在对齐函数里，不在这里取消；
 * - 境外高德没有瓦片，卫星 / 地图仍由 `sourceForLocation` 换成 Esri / OSM。
 *   那是这一份解析在境外的结果，不是第二种被记下来的选择。
 */

import { sourceForLocation } from './basemap-alignment';
import type { PlanGroundSource } from './plan-ground-capture';
import { PROBE_PUBLIC_SOURCES, type ProbePublicSource } from './tdt-probe';

export const WORKBENCH_BASEMAP_STYLES = ['map', 'satellite', 'light', 'paper'] as const;
export type WorkbenchBasemapStyle = (typeof WORKBENCH_BASEMAP_STYLES)[number];

export const WORKBENCH_BASEMAP_LABEL: Record<WorkbenchBasemapStyle, string> = {
  map: '地图',
  satellite: '卫星',
  light: '浅色',
  paper: '纸面',
};

/** 每种非纸面选择在记盘时对应的那一个图源 id（境外换源发生在取瓦片时，不写进偏好）。 */
export const WORKBENCH_BASEMAP_SOURCE = {
  map: 'amap-streets',
  satellite: 'amap-satellite',
  light: 'carto-light',
} as const satisfies Record<Exclude<WorkbenchBasemapStyle, 'paper'>, PlanGroundSource>;

export const BASEMAP_STYLE_STORAGE_KEY = 'scendance-basemap-style-v1';

const NON_PAPER_STYLES = ['map', 'satellite', 'light'] as const;
export type WorkbenchImageryStyle = (typeof NON_PAPER_STYLES)[number];

export function isWorkbenchImageryStyle(value: unknown): value is WorkbenchImageryStyle {
  return value === 'map' || value === 'satellite' || value === 'light';
}

/**
 * 旧偏好里的图源 id 归到三种影像选择。
 * 全球卫星 / 天地图影像 / 高德卫星都是「卫星」；Carto 深色并进「浅色」
 * （深色不再单列）；其余街道、矢量、OSM 都是「地图」。
 */
export function styleFromProvider(source: string | null | undefined): WorkbenchImageryStyle {
  if (source === 'amap-satellite' || source === 'esri-satellite' || source === 'img') return 'satellite';
  if (source === 'carto-light' || source === 'carto-dark') return 'light';
  return 'map';
}

/** 纸面优先；否则按图源归类。评审页快照与工作台图层用同一条规则。 */
export function styleFromGround(mode: string | null | undefined, source: string | null | undefined): WorkbenchBasemapStyle {
  if (mode === 'paper') return 'paper';
  return styleFromProvider(source);
}

/** 记盘用的图源 id。Esri / 天地图 / Carto 深色 / OSM 都收成该选择的唯一源。 */
export function canonicalPlanGroundSource(source: string | null | undefined): PlanGroundSource {
  return WORKBENCH_BASEMAP_SOURCE[styleFromProvider(source)];
}

/**
 * 一种选择 → 一块地方实际要铺的那一个瓦片源。
 * 纸面没有瓦片。境内卫星是高德卫星；境外同一选择才换成 Esri。
 */
export function tileSourceForBasemapStyle(
  style: WorkbenchBasemapStyle,
  lng: number | null | undefined,
  lat: number | null | undefined,
): ProbePublicSource | null {
  if (style === 'paper') return null;
  const requested = WORKBENCH_BASEMAP_SOURCE[style];
  const resolved = sourceForLocation(requested, lng, lat);
  if ((PROBE_PUBLIC_SOURCES as readonly string[]).includes(resolved)) return resolved as ProbePublicSource;
  return requested;
}
