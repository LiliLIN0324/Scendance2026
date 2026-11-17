/**
 * M2 walls 执行器纯函数：把室内 `FloorLayout.interiorWalls` 迁成 plan `walls`。
 *
 * 口径：
 * - 一段 `InteriorWall` → 一条 `PlanWall`，两端经与 facility/worker 同一迁移帧逆变换；
 * - 端点夹在场地边界内；两端重合视为退化段，进 skipped；
 * - 厚度/高度只在合法区间（0.05–5 m / 0.5–20 m）内透传，缺失或超界不虚构；
 * - 归属分区按线段中点命中（与 worker/node 同口径），都不含则留空；
 * - 门/窗暂无独立数据结构，不凭空拆成 node；上限 500 段，超出进 skipped。
 */

import type { PlanPoint, PlanWall } from '../../../../supabase/functions/_shared/site-plan';
import { framePoint, hexOrUndefined, makeFrame, type MigrationUuidGen } from './plan-migration-frame';
import { inferWorkerZoneId } from './site-plan-routes';
import type { RoomLayout } from './types';

/** 与契约 `walls` 上限同值。 */
const MAX_WALLS = 500;
const MIN_THICKNESS_M = 0.05;
const MAX_THICKNESS_M = 5;
const MIN_HEIGHT_M = 0.5;
const MAX_HEIGHT_M = 20;
/** 小于 1 mm 视为同一点：退化段不落库。 */
const DEGENERATE_EPSILON = 1e-3;

export interface WallMigrationSkip {
  sourceId: string;
  reason: string;
}

export interface WallMigrationResult {
  walls: PlanWall[];
  skipped: WallMigrationSkip[];
}

/** 区间内才采信；超界按「未量」处理，不截断成边界值。 */
function boundedOrUndefined(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return value >= min && value <= max ? value : undefined;
}

export function migrateWalls(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floors'>,
  boundary: readonly PlanPoint[],
  gen: MigrationUuidGen = () => crypto.randomUUID(),
  zones: readonly { id: string; polygon: readonly PlanPoint[] }[] = [],
): WallMigrationResult {
  const frame = makeFrame(boundary, layout.width, layout.height);
  const walls: PlanWall[] = [];
  const skipped: WallMigrationSkip[] = [];

  for (const floor of layout.floors) {
    for (const wall of floor.interiorWalls ?? []) {
      if (walls.length >= MAX_WALLS) {
        skipped.push({ sourceId: wall.id, reason: `墙体超过 ${MAX_WALLS} 段上限` });
        continue;
      }
      if (![wall.x1, wall.z1, wall.x2, wall.z2].every(Number.isFinite)) {
        skipped.push({ sourceId: wall.id, reason: '墙体端点不是有限数' });
        continue;
      }

      const start = framePoint(frame, wall.x1, wall.z1);
      const end = framePoint(frame, wall.x2, wall.z2);
      if (Math.abs(start.x - end.x) < DEGENERATE_EPSILON && Math.abs(start.y - end.y) < DEGENERATE_EPSILON) {
        skipped.push({ sourceId: wall.id, reason: '墙体长度退化' });
        continue;
      }

      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const zoneId = inferWorkerZoneId(midpoint, zones);
      const color = hexOrUndefined(wall.color);
      const thicknessM = boundedOrUndefined(wall.thickness, MIN_THICKNESS_M, MAX_THICKNESS_M);
      const heightM = boundedOrUndefined(wall.height, MIN_HEIGHT_M, MAX_HEIGHT_M);

      walls.push({
        id: gen(),
        points: [start, end],
        ...(thicknessM !== undefined ? { thicknessM } : {}),
        ...(heightM !== undefined ? { heightM } : {}),
        ...(wall.kind ? { kind: wall.kind } : {}),
        ...(wall.status ? { status: wall.status } : {}),
        ...(color ? { color } : {}),
        ...(zoneId ? { zoneId } : {}),
      });
    }
  }

  return { walls, skipped };
}
