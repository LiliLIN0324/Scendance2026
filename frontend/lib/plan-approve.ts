/**
 * 第 10 批「批注→施工」纯函数层：把 zone 矩形标注转成圆桌 + 椅子的放置列表。
 *
 * 设计红线：
 * - 纯函数、不可变，不接 React、不读 layoutStore；
 * - 坐标与 FurnitureItem.position 同一套约定：米制、房间中心为原点；
 * - route / measure 标注不参与转家具（它们是动线 / 参考线）；
 * - 每桌直径 1.2m、四周 4 把椅子；单 zone 最多落 MAX_TABLES_PER_ZONE 桌（MVP 不一次铺 20 桌）。
 */

import type { PlanAnnotation, PlanPoint } from './plan-annotation';
import { densityToSpec } from './density';

/** 圆桌直径（米）。 */
export const TABLE_DIAMETER = 1.2;
/** 椅子边长（米），用于类型占位。 */
export const CHAIR_SIZE = 0.45;
/** 桌心到相邻椅心的径向距离（米）。 */
export const CHAIR_RING_RADIUS = 0.9;
/** 单 zone 最多落几桌（MVP 上限）。 */
export const MAX_TABLES_PER_ZONE = 3;
/** 距 zone 边缘的最小留白（米），避免压住墙或动线。 */
export const ZONE_INSET = 0.3;

/** 一件待放家具的描述（世界坐标，未挂 id / 资产）。 */
export interface ZoneFurniturePlacement {
  kind: 'table' | 'chair';
  x: number;
  z: number;
  /** 朝向（弧度），椅子用于面对桌子。 */
  rotation: number;
  /** 来源 zone 标注 id，便于出问题时回溯。 */
  zoneId: string;
}

/**
 * 把一组 zone 标注 + 密度旋钮转成家具放置列表。
 *
 * - 非 zone 标注（route / measure）被忽略；
 * - 矩形在世界坐标中可能宽高 <= 0（用户拖了个点）→ 返回空；
 * - 网格点落在矩形内缩 ZONE_INSET 之后，再按到矩形中心距离排序，取前 MAX_TABLES_PER_ZONE；
 * - 每桌配 4 把椅子（N / S / E / W）。
 */
export function planZoneApprovals(
  annotations: readonly PlanAnnotation[],
  density: number,
): ZoneFurniturePlacement[] {
  const placements: ZoneFurniturePlacement[] = [];
  const spec = densityToSpec(density);
  // 桌心间距：至少 = 直径 + 0.3m 净距；密度旋钮松档更宽、密档更紧。
  const pitch = Math.max(TABLE_DIAMETER + 0.3, spec.spacingMeters);

  for (const ann of annotations) {
    if (ann.kind !== 'zone' || ann.geometry.kind !== 'rect') continue;
    const g = ann.geometry;
    if (g.width <= 0 || g.depth <= 0) continue;

    const inset = ZONE_INSET + TABLE_DIAMETER / 2;
    // 内缩后放不下任何一张桌（连一个网格点都挤不出）→ 跳过。
    if (g.width - inset * 2 < 0.1 || g.depth - inset * 2 < 0.1) continue;

    const minX = g.x + inset;
    const maxX = g.x + g.width - inset;
    const minZ = g.z + inset;
    const maxZ = g.z + g.depth - inset;
    const centerX = g.x + g.width / 2;
    const centerZ = g.z + g.depth / 2;

    // 从内缩角点开始按 pitch 走网格；用浮点 snap 避免 0.1+0.2 类累积漂移。
    const points: PlanPoint[] = [];
    for (let z = minZ; z <= maxZ + 1e-6; z += pitch) {
      for (let x = minX; x <= maxX + 1e-6; x += pitch) {
        points.push({ x: round2(x), z: round2(z) });
      }
    }
    // 一个网格点都没有（矩形太窄）→ 跳过。
    if (points.length === 0) continue;

    // 按到矩形中心的距离升序，优先放中心附近的点；超出 MVP 上限就裁掉。
    points.sort((a, b) => {
      const da = (a.x - centerX) ** 2 + (a.z - centerZ) ** 2;
      const db = (b.x - centerX) ** 2 + (b.z - centerZ) ** 2;
      return da - db;
    });
    const picked = points.slice(0, MAX_TABLES_PER_ZONE);

    for (const tableAt of picked) {
      placements.push({
        kind: 'table',
        x: tableAt.x,
        z: tableAt.z,
        rotation: 0,
        zoneId: ann.id,
      });
      // 四把椅子：N / S / E / W，朝向桌子。
      const chairs: Array<{ dx: number; dz: number; rotation: number }> = [
        { dx: 0, dz: -CHAIR_RING_RADIUS, rotation: Math.PI },
        { dx: 0, dz: CHAIR_RING_RADIUS, rotation: 0 },
        { dx: -CHAIR_RING_RADIUS, dz: 0, rotation: Math.PI / 2 },
        { dx: CHAIR_RING_RADIUS, dz: 0, rotation: -Math.PI / 2 },
      ];
      for (const c of chairs) {
        placements.push({
          kind: 'chair',
          x: round2(tableAt.x + c.dx),
          z: round2(tableAt.z + c.dz),
          rotation: c.rotation,
          zoneId: ann.id,
        });
      }
    }
  }

  return placements;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
