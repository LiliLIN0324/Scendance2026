/**
 * 室内分区在 3D 里立墙（2026-11-18 用户口径）：
 * 「起到 3D 的视角的时候，室内分区边缘会向上挤出 3.5m 的墙，然后如果我画了门就在对应的位置开 2m 的门。」
 *
 * 这里只做决策，不碰 three / DOM：算出「哪几段墙、每段墙上开哪几个洞」，
 * 渲染在 `three/plan-indoor-walls.ts`（复用隔墙那套「挤出 + earcut 挖洞」）。
 *
 * 同一天用户拍的四条，直接写进规则里：
 * 1. 「会挡住室内」——接受实心墙，不做近景剖切、不加半透明；
 * 2. 「拒绝开洞」——门（含两侧墙垛）比边线还宽时，墙保持完整，不缩门、不静默改尺寸；
 * 3. 「就在场地上出现一个莫名其妙的门」——没吸附到边上的门不开洞，只留它自己的图标；
 * 4. 「先 2m，以后再说」——门洞高度先固定 2 m。
 *
 * 只认 `environment === 'indoor'` 的分区：室外分区没有墙，开洞也就没有意义。
 */
import type { ShellPoint } from './plan-footprint-geometry';

/** 墙高（用户口径 3.5 m）。 */
export const INDOOR_WALL_HEIGHT_M = 3.5;
/** 墙厚：与室内隔墙同一档（0.16 m），3D 里两边看都不显纸片。 */
export const INDOOR_WALL_THICKNESS_M = 0.16;
/** 门洞高（用户口径先 2 m）。 */
export const INDOOR_DOOR_HEIGHT_M = 2;
/**
 * 门心离边线多远仍算「画在这面墙上」。
 * 吸附成功时落点正好在边线上（误差是浮点级的 0）；留 3 cm 只为吃掉缩放与手抖。
 * 比这更远的门一律当自由摆放：不开洞。
 */
export const DOOR_ON_WALL_TOLERANCE_M = 0.03;
/** 洞口两端至少留出的墙垛，避免洞口贴到墙端把挤出几何打穿。 */
export const MIN_PIER_M = 0.08;
/** 短于这个长度的边不立墙（退化多边形/重复顶点留下的零长边）。 */
export const MIN_WALL_LENGTH_M = 0.2;

/**
 * 门的六种图标（单开/双开/推拉/旋转/卷帘/折叠）。
 * 与 2D 画布「贴室内分区边线」的吸附同一份口径：只有它们会被当门处理。
 */
const DOOR_TEMPLATE_ID = /(^|:)(door|double-door|sliding-door|revolving-door|roller-shutter|folding-door)$/;

export function isDoorTemplateId(templateId: string): boolean {
  return DOOR_TEMPLATE_ID.test(templateId);
}

export type IndoorZoneEnvironment = 'indoor' | 'outdoor' | 'unknown';

/** 参与立墙的分区（壳体米制坐标，与 3D 地面色块同一份点）。 */
export interface IndoorWallZone {
  id: string;
  environment?: IndoorZoneEnvironment | undefined;
  points: readonly ShellPoint[];
}

/** 门：中心点已换成壳体坐标，宽度取它自己的占地宽。 */
export interface IndoorWallDoor {
  id: string;
  center: ShellPoint;
  widthM: number;
}

export interface IndoorWallOpening {
  doorId: string;
  /** 洞口中心，从墙段中点沿 +X（a→b）量（m）。 */
  centerAlongWall: number;
  width: number;
  height: number;
}

export interface IndoorWall {
  zoneId: string;
  a: ShellPoint;
  b: ShellPoint;
  length: number;
  openings: IndoorWallOpening[];
}

export type IndoorDoorRefusalReason = 'door-wider-than-wall';

/** 拒绝开洞的门：墙保持完整，留在场地上当图标。 */
export interface IndoorDoorRefusal {
  doorId: string;
  zoneId: string;
  wallLength: number;
  doorWidth: number;
  reason: IndoorDoorRefusalReason;
}

export interface IndoorWallsPlan {
  walls: IndoorWall[];
  refusals: IndoorDoorRefusal[];
}

export interface PlanIndoorWallsOptions {
  doorHeightM?: number;
  onWallToleranceM?: number;
  minPierM?: number;
}

function projectOnSegment(
  pt: ShellPoint,
  a: ShellPoint,
  b: ShellPoint,
): { t: number; dist: number } | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (!(lenSq > 1e-9)) return null;
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.z - a.z) * dz) / lenSq));
  const x = a.x + dx * t;
  const z = a.z + dz * t;
  return { t, dist: Math.hypot(pt.x - x, pt.z - z) };
}

/**
 * 分区边线 → 墙段 → 洞口。返回的 walls 包含没有洞口的墙段（墙本身要画）。
 */
export function planIndoorWalls(
  zones: readonly IndoorWallZone[],
  doors: readonly IndoorWallDoor[],
  options: PlanIndoorWallsOptions = {},
): IndoorWallsPlan {
  const doorHeightM = options.doorHeightM ?? INDOOR_DOOR_HEIGHT_M;
  const tolerance = options.onWallToleranceM ?? DOOR_ON_WALL_TOLERANCE_M;
  const minPier = options.minPierM ?? MIN_PIER_M;

  const walls: IndoorWall[] = [];
  for (const zone of zones) {
    if (zone.environment !== 'indoor') continue;
    const ring = zone.points;
    if (ring.length < 3) continue;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index]!;
      const b = ring[(index + 1) % ring.length]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (!(length >= MIN_WALL_LENGTH_M)) continue;
      walls.push({ zoneId: zone.id, a, b, length, openings: [] });
    }
  }

  const refusals: IndoorDoorRefusal[] = [];
  for (const door of doors) {
    if (!(door.widthM > 0)) continue;
    let best: { wall: IndoorWall; t: number } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const wall of walls) {
      const hit = projectOnSegment(door.center, wall.a, wall.b);
      if (!hit || hit.dist > tolerance) continue;
      if (hit.dist >= bestDist) continue;
      best = { wall, t: hit.t };
      bestDist = hit.dist;
    }
    if (!best) continue;
    const { wall, t } = best;

    // 用户口径「拒绝开洞」：门连两侧墙垛一起放不下，就让它保持完整，不缩门凑合。
    if (door.widthM + 2 * minPier > wall.length) {
      refusals.push({
        doorId: door.id,
        zoneId: wall.zoneId,
        wallLength: wall.length,
        doorWidth: door.widthM,
        reason: 'door-wider-than-wall',
      });
      continue;
    }

    const limit = wall.length / 2 - minPier - door.widthM / 2;
    const centerAlongWall = Math.max(-limit, Math.min(limit, (t - 0.5) * wall.length));
    wall.openings.push({
      doorId: door.id,
      centerAlongWall,
      width: door.widthM,
      height: doorHeightM,
    });
  }

  for (const wall of walls) wall.openings.sort((left, right) => left.centerAlongWall - right.centerAlongWall);
  return { walls, refusals };
}
