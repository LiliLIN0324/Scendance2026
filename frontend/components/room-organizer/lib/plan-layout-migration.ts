/**
 * M2：旧室内布局（`RoomLayout`）→ 户外 plan 实体的一次性迁移纯函数层。
 *
 * 范围（2026-11-13 拍板）：本模块总入口迁出**分区 / 人员 / 动线 / 物料**四类实体；
 * - 物料 `FurnitureItem` → facility：执行器见 `plan-facility-migration.ts`（消费 `plan-facility-mapping` 四档）；
 * - 墙体 `InteriorWall`：契约独立 `walls` 集合，扩字段评审后再接。
 *
 * 口径：
 * - 坐标复用 `plan-item-bridge` 的壳体 → 平面逆变换（z 南翻成 y 北，边界外接框两轴缩放）；
 * - 实体一律经 `buildZone / buildWorker / buildRoute / buildFacility` 工厂构建，不绕过 schema 直接拼 JSON；
 * - 本模块不读写 localStorage、不接壳体调用、不拆旧链；id 由入参 `gen` 生成，便于对照快照。
 */

import type { PlanFacility, PlanPoint, PlanRoute, PlanWorker, PlanZone } from '../../../../supabase/functions/_shared/site-plan';
import type { FurnitureItem, RoomLayout, RoomZone, WalkRoute } from './types';
import type { ZoneSemanticType } from '../../../lib/plan-annotation';
import type { PlanningZoneSemantic } from '@/lib/outdoor-plan-tokens';
import {
  framePoint,
  hexOrUndefined,
  makeFrame,
  type MigrationFrame,
  type MigrationUuidGen,
} from './plan-migration-frame';
import { buildZone } from './site-plan-editing';
import { buildRoute, buildWorker } from './site-plan-routes';
import { migrateFacilities } from './plan-facility-migration';

export type { MigrationUuidGen } from './plan-migration-frame';

const FALLBACK_WORKER_ROLE = '人员';
const FALLBACK_ROUTE_NAME = '行走路线';

/**
 * 室内分区语义 → plan 九类语义。
 * 室内六类里圆桌区/课桌区归到就坐区 `audience`，打卡区/休息区 plan 无对应类目，
 * 保守回落 `reserved`（预留），不虚构语义；映射表待产品微调。
 */
const ZONE_SEMANTIC_FALLBACK: PlanningZoneSemantic = 'reserved';
const ZONE_SEMANTIC_MAP: Record<ZoneSemanticType, PlanningZoneSemantic> = {
  roundtable: 'audience',
  checkin: 'checkin',
  photo: 'reserved',
  rest: 'reserved',
  desk: 'audience',
  reserved: 'reserved',
};

export interface LayoutMigrationSkip {
  source: 'zone' | 'worker' | 'route' | 'facility';
  sourceId: string;
  reason: string;
}

export interface LayoutMigrationResult {
  zones: PlanZone[];
  workers: PlanWorker[];
  routes: PlanRoute[];
  facilities: PlanFacility[];
  skipped: LayoutMigrationSkip[];
}

function mapZoneSemantic(zoneType: ZoneSemanticType | undefined): PlanningZoneSemantic {
  return zoneType ? ZONE_SEMANTIC_MAP[zoneType] ?? ZONE_SEMANTIC_FALLBACK : ZONE_SEMANTIC_FALLBACK;
}

/** 矩形分区 {x,z,w,d} → 四点闭合环（NW → NE → SE → SW），逐点换平面坐标。 */
function zonePolygon(frame: MigrationFrame, zone: RoomZone): PlanPoint[] {
  const corners: readonly (readonly [number, number])[] = [
    [zone.x, zone.z],
    [zone.x + zone.w, zone.z],
    [zone.x + zone.w, zone.z + zone.d],
    [zone.x, zone.z + zone.d],
  ];
  return corners.map(([x, z]) => framePoint(frame, x, z));
}

function migrateRoute(
  frame: MigrationFrame,
  walk: WalkRoute,
  item: FurnitureItem,
  gen: MigrationUuidGen,
): PlanRoute | null {
  const points = walk.points.map(point => framePoint(frame, point.x, point.z));
  const role = (item.name ?? '').trim() || FALLBACK_WORKER_ROLE;
  const name = `${role}动线`.slice(0, 60) || FALLBACK_ROUTE_NAME;
  const built = buildRoute({
    id: gen(),
    kind: 'pedestrian',
    name,
    points,
    oneWay: walk.loop === false,
    notes: '',
  }, []);
  return built.ok ? built.value : null;
}

/**
 * 把旧布局里的分区、人员点位、行走动线迁成 plan 契约实体。
 *
 * 失败实体进 `skipped`（不抛异常、不留半成品）；其余已构建实体照常返回。
 * 墙体本轮不迁，见模块头注。
 */
export function migrateLayoutToPlan(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floors'>,
  boundary: readonly PlanPoint[],
  gen: MigrationUuidGen = () => crypto.randomUUID(),
): LayoutMigrationResult {
  const frame = makeFrame(boundary, layout.width, layout.height);
  const zones: PlanZone[] = [];
  const workers: PlanWorker[] = [];
  const routes: PlanRoute[] = [];
  const skipped: LayoutMigrationSkip[] = [];

  const allZones = layout.floors.flatMap(floor => floor.zones ?? []);
  const allItems = layout.floors.flatMap(floor => floor.items ?? []);

  for (const zone of allZones) {
    const zoneColor = hexOrUndefined(zone.color);
    const built = buildZone({
      id: gen(),
      semantic: mapZoneSemantic(zone.zoneType),
      name: zone.name.trim() || '分区',
      polygon: zonePolygon(frame, zone),
      ...(zoneColor ? { color: zoneColor } : {}),
      notes: '',
    }, boundary, zones);
    if (built.ok) {
      zones.push(built.value);
    } else {
      skipped.push({ source: 'zone', sourceId: zone.id, reason: built.issue.message });
    }
  }

  for (const item of allItems) {
    if (item.type !== 'person') continue;
    if (!item.position) {
      skipped.push({ source: 'worker', sourceId: item.id, reason: '人员缺少落点' });
      continue;
    }
    const position = framePoint(frame, item.position.x, item.position.z);
    const role = (item.name ?? '').trim() || FALLBACK_WORKER_ROLE;
    const workerColor = hexOrUndefined(item.color);
    const workerNotes = (item.notes ?? '').trim().slice(0, 500);
    const builtWorker = buildWorker({
      id: gen(),
      role,
      count: 1,
      position,
      ...(workerColor ? { color: workerColor } : {}),
      notes: workerNotes,
    }, boundary, zones);
    if (builtWorker.ok) {
      workers.push(builtWorker.value);
    } else {
      skipped.push({ source: 'worker', sourceId: item.id, reason: builtWorker.issue.message });
    }

    if (item.walkRoute) {
      const route = migrateRoute(frame, item.walkRoute, item, gen);
      if (route) {
        routes.push(route);
      } else {
        skipped.push({ source: 'route', sourceId: item.id, reason: '动线点不足或退化' });
      }
    }
  }

  const facilityResult = migrateFacilities(layout, boundary, gen, zones);
  for (const skip of facilityResult.skipped) {
    skipped.push({ source: 'facility', sourceId: skip.sourceId, reason: skip.reason });
  }

  return { zones, workers, routes, facilities: facilityResult.facilities, skipped };
}
