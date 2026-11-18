/**
 * 门的贴边吸附（2026-11-16 用户指令，2026-11-18 修角度）：
 * 「落点离室内区域边线 10px 内时，门自动贴边；放下后坐标应落在边上。」
 *
 * 角度口径（2026-11-18 用户报「吸附在室内，但旋转角度是错误的」后修正）：
 * 门在 2D 是一条宽 1.2 m、深 0.2 m 的横条（见 oneplan-library-size 的 door 规则），
 * 要「贴在墙上」就得让**长边沿墙**，所以 rotationDeg 取墙的走向（tangent），
 * 不是墙的法线——取法线会把门横着钉穿墙面（截图里那根斜穿蓝线的橙条就是这个）。
 * 墙面朝外方向另外给一个 normalDeg，只给「贴边高亮」那根小刻度用，不写进门。
 *
 * 只认 `environment === 'indoor'` 的分区：室外分区没有墙，吸边没有意义。
 * 纯函数，不碰画布：像素只用来量「离边多远」，吸上去的坐标在米制里算，
 * 所以缩放多少都不会让门偏离边线（像素距离只是阈值，不参与落点）。
 */

import { planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';
import { zoneIsIndoor } from './plan-indoor-walls';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** 参与吸附的分区（用到 id / 室内外 / 语义 / 轮廓）。 */
export interface DoorSnapZone {
  id: string;
  environment?: 'indoor' | 'outdoor' | 'unknown' | undefined;
  /** 分区语义：没有 environment 的旧数据/AI 分区靠 `semantic: 'indoor'` 认。 */
  semantic?: string | undefined;
  polygon: readonly PlanPoint[];
}

/** 参与吸附的手画墙（`plan.walls`）：一段墙 = 两点，米制。 */
export interface DoorSnapWall {
  id: string;
  points: readonly [PlanPoint, PlanPoint];
}

export interface DoorSnap {
  /** 吸到边上的落点（米制，正好在边线/墙线上）。 */
  point: PlanPoint;
  /** 门的落位角度：与墙线同向（东为 0、逆时针为正，与设施 rotationDeg 同口径），门横条压在墙上。 */
  rotationDeg: number;
  /** 墙面朝外的法线角（同上口径，只给贴边高亮的小刻度用）。 */
  normalDeg: number;
  /** 吸到了哪个室内分区（手画墙上吸住时没有分区，省略）。 */
  zoneId?: string;
  /** 吸到了哪段手画墙；分区边赢的时候没有这个字段。 */
  wallId?: string;
  /** 命中的那条边（米制两端，画高亮用）。 */
  edge: readonly [PlanPoint, PlanPoint];
}

/** 默认吸附半径：10 CSS px（用户口径）。 */
export const DOOR_SNAP_TOLERANCE_PX = 10;

/** `plan.walls` → 吸附候选：只收正好两点的段（schema 就是两点，多点/退化的直接跳过）。 */
export function doorSnapWalls(
  walls: readonly { id: string; points: readonly PlanPoint[] }[] | undefined,
): DoorSnapWall[] {
  const out: DoorSnapWall[] = [];
  for (const wall of walls ?? []) {
    const a = wall.points[0];
    const b = wall.points[1];
    if (!a || !b || wall.points.length !== 2) continue;
    out.push({ id: wall.id, points: [a, b] });
  }
  return out;
}

/** 阈值内最近的一段手画墙；没有就返回 null，调用方退回分区边。 */
function nearestDrawnWall(
  walls: readonly DoorSnapWall[] | undefined,
  pt: PlanPoint,
  pPx: { x: number; y: number },
  viewport: PlanViewport,
  tolerance: number,
): { wall: DoorSnapWall; a: PlanPoint; b: PlanPoint; foot: PlanPoint; t: number } | null {
  if (!walls?.length) return null;
  let best: { wall: DoorSnapWall; a: PlanPoint; b: PlanPoint; foot: PlanPoint; t: number; distPx: number } | null = null;
  for (const wall of walls) {
    const [a, b] = wall.points;
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (!(lenSq > 1e-12)) continue;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
    const foot = { x: a.x + dx * t, y: a.y + dy * t };
    const footPx = planPointToPixel(foot, viewport);
    const distPx = Math.hypot(footPx.x - pPx.x, footPx.y - pPx.y);
    if (!best || distPx < best.distPx) best = { wall, a, b, foot, t, distPx };
  }
  if (!best || best.distPx > tolerance) return null;
  return { wall: best.wall, a: best.a, b: best.b, foot: best.foot, t: best.t };
}

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
  /** 手画的墙（`plan.walls`）：2026-11-18 用户口径，墙段优先于分区边。 */
  walls?: readonly DoorSnapWall[];
  viewport: PlanViewport;
  tolerancePx?: number;
}): DoorSnap | null {
  const tolerance = input.tolerancePx ?? DOOR_SNAP_TOLERANCE_PX;
  const pPx = planPointToPixel(input.pt, input.viewport);

  // 1) 手画的墙优先：只要某段墙在阈值内就贴墙，不再看分区边（哪怕分区边更近）。
  //    两个理由：用户明确要「墙优先」；3D 开洞只认墙，落在分区边上会变成没洞的门。
  const wallHit = nearestDrawnWall(input.walls, input.pt, pPx, input.viewport, tolerance);
  if (wallHit) {
    const { a, b, foot, t } = wallHit;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // 法线取「门来的一侧」：门从哪边靠近，就朝哪边开。
    let nx = -uy;
    let ny = ux;
    if (nx * (input.pt.x - foot.x) + ny * (input.pt.y - foot.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    void t;
    return {
      point: foot,
      rotationDeg: (Math.atan2(uy, ux) * 180) / Math.PI,
      normalDeg: (Math.atan2(ny, nx) * 180) / Math.PI,
      wallId: wallHit.wall.id,
      edge: [a, b],
    };
  }

  let best: { distPx: number; edge: [PlanPoint, PlanPoint]; zone: DoorSnapZone; t: number } | null = null;

  for (const zone of input.zones) {
    if (!zoneIsIndoor(zone)) continue;
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
    // 长边沿墙：门贴在墙上，不是横着穿墙。
    rotationDeg: (Math.atan2(uy, ux) * 180) / Math.PI,
    // 朝外法线：只用于高亮刻度，不参与落位。
    normalDeg: (Math.atan2(ny, nx) * 180) / Math.PI,
    zoneId: best.zone.id,
    edge: [a, b],
  };
}
