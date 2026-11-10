/**
 * GeoJSON 导出（H5-c）——纯函数层。
 *
 * 口径（评审稿 §11）：GeoJSON 为「全量几何，GIS 可用」交付。
 * - RFC 7946：FeatureCollection + Feature，坐标 [lng, lat]（WGS84/GCJ2000 口径
 *   与 plan.anchor 一致；anchor 缺失时实体无地理坐标，GeoJSON 不输出该实体
 *   ——不虚构坐标是红线）。
 * - ENU 米 → 经纬度：沿用 site-plan-csv 同一套局部近似投影（锚点每度米数）。
 * - 属性表：kind/名称/类型/分区/备注/问题标记——GIS 里可直接筛选着色。
 */

import {
  planRingAreaM2,
  planRouteLengthM,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import { buildPlanInventory } from './site-plan-inventory';

interface GeoFeatureBase {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string | number | boolean | null>;
}

export interface GeoJsonExport {
  type: 'FeatureCollection';
  features: GeoFeatureBase[];
}

/** ENU 米点 → [lng, lat]（锚点近似投影；与 CSV 坐标列同一套换算）。 */
function enuToLngLat(p: { x: number; y: number }, anchorLng: number, anchorLat: number): [number, number] {
  const metersPerDegLng = Math.cos(anchorLat * Math.PI / 180) * 111319.49;
  return [
    Number((anchorLng + p.x / metersPerDegLng).toFixed(7)),
    Number((anchorLat + p.y / 111132.92).toFixed(7)),
  ];
}

function baseProperties(row: { kind: string; name: string; typeLabel: string; zoneName: string | null; hasIssue: boolean }): Record<string, string | number | boolean | null> {
  return {
    kind: row.kind,
    name: row.name,
    type: row.typeLabel,
    zone: row.zoneName,
    issue: row.hasIssue ? '✓' : null,
  };
}

/** 导出全量几何 GeoJSON。无锚点（无法换算地理坐标）时返回空 FeatureCollection 并在元数据注明。 */
export function buildPlanGeoJson(plan: SitePlanData): GeoJsonExport {
  const anchor = plan.anchor;
  if (!anchor) {
    return { type: 'FeatureCollection', features: [] };
  }
  const inventory = buildPlanInventory(plan);
  const zoneById = new Map(plan.zones.map(z => [z.id, z]));
  const features: GeoFeatureBase[] = [];

  // 场地边界：Polygon（外环，不自闭合由消费方补——GeoJSON 允许闭合环，这里输出闭合环）。
  const boundaryRing = [...plan.boundary.map(p => enuToLngLat(p, anchor.lng, anchor.lat))];
  if (boundaryRing.length >= 3) {
    const closed = boundaryRing[0][0] === boundaryRing[boundaryRing.length - 1][0]
      && boundaryRing[0][1] === boundaryRing[boundaryRing.length - 1][1]
      ? boundaryRing
      : [...boundaryRing, boundaryRing[0]];
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closed] },
      properties: { kind: 'boundary', name: '场地边界', type: '边界', zone: null, issue: null, area_m2: Number(planRingAreaM2(plan.boundary).toFixed(2)) },
    });
  }

  // 分区：Polygon。
  for (const zone of plan.zones) {
    const ring = zone.polygon.map(p => enuToLngLat(p, anchor.lng, anchor.lat));
    if (ring.length < 3) continue;
    const closed = [...ring, ring[0]];
    const row = inventory.find(r => r.id === zone.id);
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closed] },
      properties: {
        ...baseProperties({ kind: 'zone', name: zone.name, typeLabel: row?.typeLabel ?? '分区', zoneName: null, hasIssue: row?.hasIssue ?? false }),
        area_m2: Number(planRingAreaM2(zone.polygon).toFixed(2)),
        notes: zone.notes,
      },
    });
  }

  // 设施：Point（占地矩形属性宽深+旋转）。
  for (const facility of plan.facilities) {
    const row = inventory.find(r => r.id === facility.id);
    const zoneName = facility.zoneId ? zoneById.get(facility.zoneId)?.name ?? null : null;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: enuToLngLat(facility.position, anchor.lng, anchor.lat) },
      properties: {
        ...baseProperties({ kind: 'facility', name: facility.name, typeLabel: row?.typeLabel ?? '设施', zoneName, hasIssue: row?.hasIssue ?? false }),
        width_m: facility.size.width,
        depth_m: facility.size.depth,
        rotation_deg: facility.rotationDeg,
        notes: facility.notes,
      },
    });
  }

  // 动线：LineString（宽度进属性）。
  for (const route of plan.routes) {
    if (route.points.length < 2) continue;
    const row = inventory.find(r => r.id === route.id);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.points.map(p => enuToLngLat(p, anchor.lng, anchor.lat)) },
      properties: {
        ...baseProperties({ kind: 'route', name: route.name, typeLabel: row?.typeLabel ?? '动线', zoneName: null, hasIssue: row?.hasIssue ?? false }),
        length_m: Number(planRouteLengthM(route.points).toFixed(2)),
        width_m: route.widthM ?? null,
        one_way: route.oneWay,
        notes: route.notes,
      },
    });
  }

  // 出入口：Point（类型进属性）。
  for (const node of plan.nodes) {
    const row = inventory.find(r => r.id === node.id);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: enuToLngLat(node.position, anchor.lng, anchor.lat) },
      properties: {
        ...baseProperties({ kind: 'node', name: node.name, typeLabel: row?.typeLabel ?? '出入口', zoneName: null, hasIssue: row?.hasIssue ?? false }),
        notes: node.notes,
      },
    });
  }

  // 人员：Point（岗位+人数）。
  for (const worker of plan.workers) {
    const row = inventory.find(r => r.id === worker.id);
    const zoneName = worker.zoneId ? zoneById.get(worker.zoneId)?.name ?? null : null;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: enuToLngLat(worker.position, anchor.lng, anchor.lat) },
      properties: {
        ...baseProperties({ kind: 'worker', name: worker.role, typeLabel: row?.typeLabel ?? '人员', zoneName, hasIssue: row?.hasIssue ?? false }),
        count: worker.count,
        notes: worker.notes,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** GeoJSON 文本（2 空格缩进，稳定键序——同 plan 两次导出字节一致）。 */
export function buildPlanGeoJsonText(plan: SitePlanData): string {
  return JSON.stringify(buildPlanGeoJson(plan), null, 2);
}

/** 触发 .geojson 下载。 */
export function downloadPlanGeoJson(plan: SitePlanData, filenameBase = 'site-plan'): string {
  const text = buildPlanGeoJsonText(plan);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${filenameBase}-${date}.geojson`;
  const blob = new Blob([text], { type: 'application/geo+json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}