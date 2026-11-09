import type { RoomLayout } from './types';

/**
 * 场地地面的底图样式。沿用高德瓦片：6 卫星、7 路网、8 路网注记。
 * 地址仍走现有 /api/amap-static 与本机 3199 代理，不新开图源、不加密钥名。
 * 缺省（旧图没有 style）按卫星，和 resolveTileStyle 一致。
 */
export const GROUND_BASEMAP_STYLES = [6, 7, 8] as const;
export type GroundBasemapStyle = typeof GROUND_BASEMAP_STYLES[number];

export interface GroundBasemapLayer {
  id: 'amap-streets' | 'amap-streets-labels' | 'amap-satellite';
  /** 菜单主标题，对应 OnePlan 的 Streets / Satellite。 */
  label: string;
  /** 副标题：国内图源说明。 */
  detail: string;
  provider: '高德';
  kind: 'street' | 'satellite';
  style: GroundBasemapStyle;
}

export const GROUND_BASEMAP_LAYERS: readonly GroundBasemapLayer[] = [
  { id: 'amap-streets', label: '街道 1', detail: '国内路网', provider: '高德', kind: 'street', style: 7 },
  { id: 'amap-streets-labels', label: '街道 2', detail: '国内路网注记', provider: '高德', kind: 'street', style: 8 },
  { id: 'amap-satellite', label: '卫星', detail: '国内影像', provider: '高德', kind: 'satellite', style: 6 },
];

export function isGroundBasemapStyle(value: number): value is GroundBasemapStyle {
  return value === 6 || value === 7 || value === 8;
}

/** 从贴地地址读瓦片样式。读不到就当卫星，避免把旧图误判成路网。 */
export function groundBasemapStyleOf(url: string | null | undefined): GroundBasemapStyle {
  if (!url) return 6;
  try {
    const raw = Number(new URL(url, 'https://scendance.lilicoding.space').searchParams.get('style'));
    if (isGroundBasemapStyle(raw)) return raw;
  } catch {
    // 占位 SVG 或坏地址：按卫星。
  }
  return 6;
}

export function groundBasemapLayerByStyle(style: GroundBasemapStyle): GroundBasemapLayer {
  return GROUND_BASEMAP_LAYERS.find(layer => layer.style === style) ?? GROUND_BASEMAP_LAYERS[2]!;
}

/** 底图关着时没有当前层。开着时以贴地地址为准，没有图时再看调研底图。 */
export function activeGroundBasemap(layout: Pick<RoomLayout, 'floorPlanImage' | 'satelliteGroundRef' | 'researchArea'>): GroundBasemapLayer | null {
  if (layout.satelliteGroundRef === false) return null;
  const style = layout.floorPlanImage
    ? groundBasemapStyleOf(layout.floorPlanImage)
    : (layout.researchArea?.style ?? 6);
  return groundBasemapLayerByStyle(style);
}

/**
 * 圈内清晰、圈外淡。卫星沿用原来的圈内下限 0.65 与圈外 0.55。
 * 路网是细线，圈内再实一点、圈外再压一点，围栏内外仍是同一张图，不另铺、不拉丝。
 */
export function groundBasemapOpacity(style: GroundBasemapStyle, floorPlanOpacity?: number): { inside: number; outside: number } {
  const requested = floorPlanOpacity ?? 0.78;
  if (style === 6) return { inside: Math.max(0.65, requested), outside: 0.55 };
  return { inside: Math.max(0.9, requested), outside: 0.38 };
}
