/**
 * 画墙（2026-11-18 用户口径）：
 * 「墙体应该是线条吧？和室内分区一样，会挤出高度的，也可以让门吸附的。
 *   然后可以从室内分区吸附的。」
 *
 * 所以墙不按「占地块」落：一段墙 = 一条线段 + 厚度 + 高度（`plan.walls` 既有口径），
 * 端点往室内分区的边线上吸（与门吸同一套几何、同一个 10px 阈值）。
 * 3D 挤出和门开洞不在这里：那两件事已经由 `lib/plan-indoor-walls.ts` +
 * `three/plan-indoor-walls.ts` 负责，这里只产出能被它们吃下的数据。
 *
 * 本文件是纯函数：不碰 React、不碰 ctx、不读时间、不改入参。
 * 画布负责模式、预览、Esc、撤销与落盘；这里只回答两件事——
 * 「这个点吸到哪条边」「这两个点能不能成一段合法的墙」。
 */

import { planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';
import {
  INDOOR_WALL_HEIGHT_M,
  INDOOR_WALL_THICKNESS_M,
  MIN_WALL_LENGTH_M,
  zoneIsIndoor,
} from './plan-indoor-walls';
import type { PlanPoint, PlanWall } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 端点吸附半径：10 CSS px，和门吸（DOOR_SNAP_TOLERANCE_PX）同一口径。
 * 像素只用来量「离边多远」，吸上去的坐标在米制里算，缩放多少都不会偏。
 */
export const WALL_SNAP_TOLERANCE_PX = 10;

/** 落在 1 cm 上：plan 坐标是米，再细的位数既没意义也会让同一面墙每次算出不同值。 */
function roundM(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `planWallSchema.zoneId` 是 uuid：吸到的分区 id 不是 uuid 就不写，免得整份 plan 校验不过。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 参与吸附的分区（只用到 id / 室内外 / 语义 / 轮廓）。 */
export interface WallSnapZone {
  id: string;
  environment?: 'indoor' | 'outdoor' | 'unknown' | undefined;
  /** 没有 environment 的旧数据/AI 分区靠 `semantic: 'indoor'` 认。 */
  semantic?: string | undefined;
  polygon: readonly PlanPoint[];
}

export interface SnappedWallPoint {
  /** 吸上去的端点（米制，正好落在边线或已有墙上）。 */
  point: PlanPoint;
  /** 2026-11-18 用户「墙之间也要互相吸附」：分清吸到的是已有墙还是分区边，画布据此提词。 */
  source: 'wall' | 'zone';
  /** 吸到了哪个分区（source='zone' 时才有）。 */
  zoneId?: string;
  /** 吸到了哪段已画的墙（source='wall' 时才有）。 */
  wallId?: string;
  /** 命中的那条线（米制两端，给贴边高亮用；墙优先于分区边时画的就是墙线）。 */
  edge: readonly [PlanPoint, PlanPoint];
  /** 原始落点离吸附线多远（米），给「已吸附」提示用。 */
  distanceM: number;
}

export interface WallSnapInput {
  pt: PlanPoint;
  zones: readonly WallSnapZone[];
  /** 已画的墙（plan.walls）：墙与墙互相吸附，接龙时端点直接共用同一个点。 */
  walls?: readonly WallSnapWall[];
  viewport: PlanViewport;
  tolerancePx?: number;
}

/** 已画的墙段（plan.walls 两点口径）。 */
export interface WallSnapWall {
  id: string;
  points: readonly [PlanPoint, PlanPoint];
}

interface SnapCandidate {
  distPx: number;
  point: PlanPoint;
  edge: [PlanPoint, PlanPoint];
  source: 'wall' | 'zone';
  zoneId?: string;
  wallId?: string;
}

/** 投影到线段上的点 + 像素距离；退化线段返回 null。 */
function projectOnLine(
  pt: PlanPoint,
  a: PlanPoint,
  b: PlanPoint,
  viewport: PlanViewport,
  pPx: { x: number; y: number },
): { point: PlanPoint; distPx: number } | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (!(lenSq > 1e-12)) return null;
  // 投影系数在像素/米制里一样（等比缩放），所以米制算 t，像素只量距离。
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lenSq));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  const footPx = planPointToPixel(point, viewport);
  return { point, distPx: Math.hypot(footPx.x - pPx.x, footPx.y - pPx.y) };
}

/**
 * 落点 → 最近的吸附目标。
 *
 * 优先级（2026-11-18 用户口径）：已有墙优先于分区边——只要某段已画的墙在阈值内就贴墙，
 * 这样画折线时第二段直接接在上一段的端点上，不会因为旁边有条分区边就被拉走。
 * 没有墙在范围内才退回吸分区边；两者都够不着返回 null，端点就落在指针处。
 *
 * 室外分区、少于 3 点、退化零长边一律跳过——室外没有墙，吸边没有意义（与门吸同一条判断）。
 */
export function snapWallPointToIndoorEdge(input: WallSnapInput): SnappedWallPoint | null {
  const tolerance = input.tolerancePx ?? WALL_SNAP_TOLERANCE_PX;
  const pPx = planPointToPixel(input.pt, input.viewport);

  // 1) 已画的墙：最近的一段，阈值内就赢过分区边。
  let bestWall: SnapCandidate | null = null;
  for (const wall of input.walls ?? []) {
    const [a, b] = wall.points;
    if (!a || !b) continue;
    const hit = projectOnLine(input.pt, a, b, input.viewport, pPx);
    if (!hit) continue;
    if (!bestWall || hit.distPx < bestWall.distPx) {
      bestWall = { distPx: hit.distPx, point: hit.point, edge: [a, b], source: 'wall', wallId: wall.id };
    }
  }
  if (bestWall && bestWall.distPx <= tolerance) return toSnapped(bestWall, input.pt);

  // 2) 室内分区边：原来的口径不变。
  let bestZone: SnapCandidate | null = null;
  for (const zone of input.zones) {
    if (!zoneIsIndoor(zone)) continue;
    const ring = zone.polygon;
    if (ring.length < 3) continue;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i] as PlanPoint;
      const b = ring[(i + 1) % ring.length] as PlanPoint;
      const hit = projectOnLine(input.pt, a, b, input.viewport, pPx);
      if (!hit) continue;
      if (!bestZone || hit.distPx < bestZone.distPx) {
        bestZone = { distPx: hit.distPx, point: hit.point, edge: [a, b], source: 'zone', zoneId: zone.id };
      }
    }
  }
  if (bestZone && bestZone.distPx <= tolerance) return toSnapped(bestZone, input.pt);
  return null;
}

function toSnapped(candidate: SnapCandidate, pt: PlanPoint): SnappedWallPoint {
  const point = { x: roundM(candidate.point.x), y: roundM(candidate.point.y) };
  return {
    point,
    source: candidate.source,
    ...(candidate.zoneId ? { zoneId: candidate.zoneId } : {}),
    ...(candidate.wallId ? { wallId: candidate.wallId } : {}),
    edge: candidate.edge,
    distanceM: Math.hypot(point.x - pt.x, point.y - pt.y),
  };
}

/** 两点之间的墙长（米）；退化返回 0。 */
export function wallLengthM(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export interface WallSegmentInput {
  a: PlanPoint;
  b: PlanPoint;
  /** 必须是 uuid：`planWallSchema.id` 就是 uuid（画布有自己的 id 生成器）。 */
  id: string;
  thicknessM?: number;
  heightM?: number;
  kind?: NonNullable<PlanWall['kind']>;
  status?: NonNullable<PlanWall['status']>;
  color?: string;
  /** 吸到了哪个分区；不是 uuid 时自动省略，不让整份 plan 校验失败。 */
  zoneId?: string | undefined;
}

export type WallSegmentFailure = 'too-short';

export type WallSegmentResult =
  | { ok: true; wall: PlanWall; lengthM: number }
  | { ok: false; reason: WallSegmentFailure };

/**
 * 两点 → 一段墙。默认按「人画的室内墙」落：
 * 3.5 m 高（与室内分区挤出的墙同高）、0.16 m 厚（与 3D 隔墙同一厚度）、
 * `kind: 'interior'`、`status: 'confirmed'`（手画的就是确认过的，不是识别/推断）。
 *
 * 太短（< MIN_WALL_LENGTH_M，0.2 m）直接拒绝：一段 0 长的墙在 3D 里是空几何，
 * 在 2D 里是一个点，落下去只会在撤销栈里留一条看不见的记录。
 */
export function wallSegmentFromPoints(input: WallSegmentInput): WallSegmentResult {
  const points: PlanPoint[] = [
    { x: roundM(input.a.x), y: roundM(input.a.y) },
    { x: roundM(input.b.x), y: roundM(input.b.y) },
  ];
  const lengthM = wallLengthM(points[0] as PlanPoint, points[1] as PlanPoint);
  if (!(lengthM >= MIN_WALL_LENGTH_M)) return { ok: false, reason: 'too-short' };

  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
  const wall: PlanWall = {
    id: input.id,
    points,
    // 与 planWallSchema 的范围一致：厚度 0.05–5 m、高度 0.5–20 m。
    thicknessM: clamp(input.thicknessM ?? INDOOR_WALL_THICKNESS_M, 0.05, 5),
    heightM: clamp(input.heightM ?? INDOOR_WALL_HEIGHT_M, 0.5, 20),
    kind: input.kind ?? 'interior',
    status: input.status ?? 'confirmed',
    ...(input.color ? { color: input.color.toLowerCase() } : {}),
    ...(input.zoneId && UUID_RE.test(input.zoneId) ? { zoneId: input.zoneId } : {}),
  };
  return { ok: true, wall, lengthM };
}

export interface DrawnWallInput extends Omit<WallSegmentInput, 'a' | 'b' | 'zoneId'> {
  /** 两个原始落点（没吸附前）。 */
  a: PlanPoint;
  b: PlanPoint;
  zones: readonly WallSnapZone[];
  /** 已画的墙：端点会直接接在已有墙上（墙与墙互相吸）。 */
  walls?: readonly WallSnapWall[];
  viewport: PlanViewport;
  tolerancePx?: number;
}

export type DrawnWallResult =
  | {
    ok: true;
    wall: PlanWall;
    lengthM: number;
    /** 哪一端吸上了；没吸上的是 null（画布据此决定要不要画贴边高亮）。 */
    snappedA: SnappedWallPoint | null;
    snappedB: SnappedWallPoint | null;
  }
  | { ok: false; reason: WallSegmentFailure };

/**
 * 画布落笔的完整一步：两端分别尝试吸到室内分区边，再成段。
 * 两端吸到不同分区时，`zoneId` 取先吸上的那一端（墙跨两个房间是合法的，
 * 归属只是一个提示字段，不影响几何）。
 */
export function resolveDrawnWall(input: DrawnWallInput): DrawnWallResult {
  const snappedA = snapWallPointToIndoorEdge({
    pt: input.a,
    zones: input.zones,
    ...(input.walls ? { walls: input.walls } : {}),
    viewport: input.viewport,
    ...(input.tolerancePx !== undefined ? { tolerancePx: input.tolerancePx } : {}),
  });
  const snappedB = snapWallPointToIndoorEdge({
    pt: input.b,
    zones: input.zones,
    ...(input.walls ? { walls: input.walls } : {}),
    viewport: input.viewport,
    ...(input.tolerancePx !== undefined ? { tolerancePx: input.tolerancePx } : {}),
  });

  const segment = wallSegmentFromPoints({
    ...input,
    a: snappedA?.point ?? input.a,
    b: snappedB?.point ?? input.b,
    zoneId: snappedA?.source === 'zone'
      ? snappedA.zoneId
      : snappedB?.source === 'zone' ? snappedB.zoneId : undefined,
  });
  if (!segment.ok) return segment;
  return { ...segment, snappedA, snappedB };
}
