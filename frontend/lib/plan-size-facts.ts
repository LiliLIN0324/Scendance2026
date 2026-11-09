import type { DimensionConstraint, SourceImage } from '../../supabase/functions/_shared/domain';
import type { RoomLayout } from '../components/room-organizer/lib/types';

export type PlanSizeStatus = 'confirmed' | 'inferred' | 'unknown';
export type PlanSizeReason = 'confirmed_record' | 'inferred_record' | 'missing_value' | 'unsupported_floor'
  | 'no_scene_record' | 'stale_scene' | 'conflicting_records' | 'no_matching_record';

export interface PlanSizeRecord {
  /** 原始尺寸记录；confirmed 指记录状态，不等于现场实测。 */
  record: Readonly<DimensionConstraint & Record<string, unknown>>;
  matchesCurrent: boolean;
  /** 未能关联来源时保留 record.sourceAssetId，不能虚构来源。 */
  source: Readonly<SourceImage> | null;
}

export interface PlanSizeFact {
  valueMeters: number | null;
  status: PlanSizeStatus;
  /** 数字来自当前画布；原始来源与记录保留在 records 中。 */
  source: 'canvas' | 'unknown';
  reason: PlanSizeReason;
  records: readonly PlanSizeRecord[];
}

export interface PlanSizeFacts {
  floorId: string | null;
  width: PlanSizeFact;
  depth: PlanSizeFact;
}

/** 数值转换误差，仅用于同一尺寸记录的匹配，不代表测量误差。 */
const MATCH_EPSILON_M = 1e-6;
const equalMeters = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= MATCH_EPSILON_M;

/**
 * V2 场景仅对应一个楼层；记录缺失、跨层或场景与画布脱节时不沿用确认。
 * 不把墙长、两点距离或对象尺寸误当成场地总宽/总深。
 */
export function extractPlanSizeFacts(layout: RoomLayout, floorIndex: number): PlanSizeFacts {
  const floor = Number.isInteger(floorIndex) && floorIndex >= 0 ? layout.floors[floorIndex] : undefined;
  const scene = layout.backendSceneV2;
  const supported = !!floor && floorIndex === 0 && layout.floors.length === 1;
  const fact = (kind: 'width' | 'depth', raw: number): PlanSizeFact => {
    const valueMeters = Number.isFinite(raw) && raw > 0 ? raw : null;
    if (valueMeters === null) return { valueMeters, status: 'unknown', source: 'unknown', reason: 'missing_value', records: [] };
    if (!supported) return { valueMeters, status: 'unknown', source: 'canvas', reason: 'unsupported_floor', records: [] };
    if (!scene || !Array.isArray(scene.dimensions)) return { valueMeters, status: 'unknown', source: 'canvas', reason: 'no_scene_record', records: [] };
    const records: PlanSizeRecord[] = scene.dimensions
      .filter(dimension => dimension && typeof dimension === 'object' && dimension.kind === kind && !dimension.targetId && !dimension.targetEndId)
      .map(dimension => {
        const source = dimension.sourceAssetId && Array.isArray(scene.sources)
          ? scene.sources.find(item => item && item.assetId === dimension.sourceAssetId) : undefined;
        return {
          record: { ...dimension, ...(dimension.start ? { start: { ...dimension.start } } : {}), ...(dimension.end ? { end: { ...dimension.end } } : {}) },
          matchesCurrent: equalMeters(dimension.valueMeters, valueMeters),
          source: source ? { ...source } : null,
        };
      });
    const sceneValue = kind === 'width' ? scene.venue?.width : scene.venue?.depth;
    if (sceneValue === undefined || !equalMeters(sceneValue, valueMeters)) return { valueMeters, status: 'unknown', source: 'canvas', reason: 'stale_scene', records };
    const confirmed = records.filter(item => item.record.status === 'confirmed');
    if (confirmed.some(item => !item.matchesCurrent)) return { valueMeters, status: 'unknown', source: 'canvas', reason: 'conflicting_records', records };
    if (confirmed.some(item => item.matchesCurrent)) return { valueMeters, status: 'confirmed', source: 'canvas', reason: 'confirmed_record', records };
    if (records.some(item => item.matchesCurrent && (item.record.status === 'inferred' || item.record.status === 'detected'))) {
      return { valueMeters, status: 'inferred', source: 'canvas', reason: 'inferred_record', records };
    }
    return { valueMeters, status: 'unknown', source: 'canvas', reason: records.length ? 'no_matching_record' : 'no_scene_record', records };
  };
  return { floorId: floor?.id ?? null, width: fact('width', layout.width), depth: fact('depth', layout.height) };
}
