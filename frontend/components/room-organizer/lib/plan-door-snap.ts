/**
 * 门的贴边吸附（2026-11-16 用户指令）：
 * 「落点离室内区域边线 10px 内时，门自动贴边、朝向垂直墙面；放下后坐标应落在边上、角度等于边法线。」
 *
 * 只认 `environment === 'indoor'` 的分区：室外分区没有墙，吸边没有意义。
 * 纯函数，不碰画布：像素只用来量「离边多远」，吸上去的坐标在米制里算，
 * 所以缩放多少都不会让门偏离边线（像素距离只是阈值，不参与落点）。
 */

import { planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** 参与吸附的分区（只用到 id / 室内外 / 轮廓）。 */
export interface DoorSnapZone {
  id: string;
  environment?: 'indoor' | 'outdoor' | 'unknown' | undefined;
  polygon: readonly PlanPoint[];
}

export interface DoorSnap {
  /** 吸到边上的落点（米制，正好在边线上）。 */
  point: PlanPoint;
  /** 与边法线同向的角度（东为 0、逆时针为正，与设施 rotationDeg 同口径）。 */
  rotationDeg: number;
  /** 吸到了哪个分区。 */
  zoneId: string;
  /** 命中的那条边（米制两端，画高亮用）。 */
  edge: readonly [PlanPoint, PlanPoint];
}

/** 默认吸附半径：10 CSS px（用户口径）。 */
export const DOOR_SNAP_TOLERANCE_PX = 10;

function centroid(polygon: readonly PlanPoint[]): PlanPoint {
  const n = polygon.length;
  return polygon.reduce(
    (acc, p) => ({ x: acc.x + p.x / n, y: acc.y + p.y / n }),
    { x: 0, y: 0 },
  );
}

/**
 * 落点 → 最近的室内区域边。
 * 超出 tolerancePx 返回 null；分区少于 3 点、或退化成零长边的一律跳过。
 */
export function snapDoorToIndoorEdge(input: {
  pt: PlanPoint;
  zones: readonly DoorSnapZone[];
  viewport: PlanViewport;
  tolerancePx?: number;
}): DoorSnap | null {
  const tolerance = input.tolerancePx ?? DOOR_SNAP_TOLERANCE_PX;
  const pPx = planPointToPixel(input.pt, input.viewport);
  let best: { distPx: number; edge: [PlanPoint, PlanPoint]; zone: DoorSnapZone; t: number } | null = null;

  for (const zone of input.zones) {
    if (zone.environment !== 'indoor') continue;
    const ring = zone.polygon;
    if (ring.length < 3) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i] as PlanPoint;
      const b = ring[(i + 1) % ring.length] as PlanPoint;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy;
      if (!(lenSq > 1e-12)) continue;
      // 投影系数在像素/米制里一样（等比缩放），所以用米制算 t，像素只量距离。
      const t = Math.max(0, Math.min(1, ((input.pt.x - a.x) * dx + (input.pt.y - a.y) * dy) / lenSq));
      const footPx = planPointToPixel({ x: a.x + dx * t, y: a.y + dy * t }, input.viewport);
      const distPx = Math.hypot(footPx.x - pPx.x, footPx.y - pPx.y);
      if (!best || distPx < best.distPx) best = { distPx, edge: [a, b], zone, t };
    }
  }

  if (!best || best.distPx > tolerance) return null;

  const [a, b] = best.edge;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0)) return null;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  // 法线取「朝外」那一侧：背离分区质心。
  const center = centroid(best.zone.polygon);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let nx = -uy;
  let ny = ux;
  if (nx * (center.x - mid.x) + ny * (center.y - mid.y) > 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    point: { x: a.x + (b.x - a.x) * best.t, y: a.y + (b.y - a.y) * best.t },
    rotationDeg: (Math.atan2(ny, nx) * 180) / Math.PI,
    zoneId: best.zone.id,
    edge: [a, b],
  };
}
