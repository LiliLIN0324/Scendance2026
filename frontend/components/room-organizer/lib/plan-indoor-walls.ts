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
/** 窗台高（2026-11-18 用户「窗户也是吸附的逻辑，在 3D 里开窗户的洞」）。 */
export const INDOOR_WINDOW_SILL_M = 0.9;
/** 窗洞高：窗台 0.9 + 1.2 = 顶到 2.1 m，剩下 1.4 m 过梁。 */
export const INDOOR_WINDOW_HEIGHT_M = 1.2;
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
 * 门的六种 slug（单开/双开/推拉/旋转/卷帘/折叠）。
 * 与 2D 画布「贴室内分区边线」的吸附同一份口径：只有它们会被当门处理。
 */
export const DOOR_SLUGS = [
  'door',
  'double-door',
  'sliding-door',
  'revolving-door',
  'roller-shutter',
  'folding-door',
] as const;
const DOOR_SLUG_SET: ReadonlySet<string> = new Set(DOOR_SLUGS);

/** 窗：与门同一套吸附/开洞，只是洞口不落地（窗台高度见 INDOOR_WINDOW_SILL_M）。 */
export const WINDOW_SLUGS = ['window'] as const;
const WINDOW_SLUG_SET: ReadonlySet<string> = new Set(WINDOW_SLUGS);

export function isWindowSlug(value: string | null | undefined): boolean {
  return WINDOW_SLUG_SET.has(slugTailOf(value));
}

export function isWindowTemplateId(templateId: string): boolean {
  return isWindowSlug(templateId);
}

/**
 * 取 id 末段当 slug：`oneplan:icon:double-door` / `library:door` / `pack:door` / `door` 都回 `door`。
 * 2026-11-18 用户报「有些门能吸、有些不行」：以前只认正则贴在末尾的 `:door`，
 * 命名空间不同（或 id 里带了别的段落）就漏判。现在一律按末段 slug 精确比较。
 */
export function slugTailOf(value: string | null | undefined): string {
  if (!value) return '';
  const index = value.lastIndexOf(':');
  return index >= 0 ? value.slice(index + 1) : value;
}

/** 单个 slug / 模型 slug 是不是门（等价于「这个 id 末段是不是门」）。 */
export function isDoorSlug(value: string | null | undefined): boolean {
  return DOOR_SLUG_SET.has(slugTailOf(value));
}

export function isDoorTemplateId(templateId: string): boolean {
  return isDoorSlug(templateId);
}

export type IndoorZoneEnvironment = 'indoor' | 'outdoor' | 'unknown';

/** 只用到「室内/室外 + 语义」这两个字段。 */
export interface ZoneIndoorLike {
  environment?: IndoorZoneEnvironment | undefined;
  semantic?: string | undefined;
}

/**
 * 分区算不算「有墙的室内」。
 *
 * 2026-11-18 用户报「有些门能吸、有些不行」：以前只看 `environment === 'indoor'`，
 * 但旧数据 / AI 生成的分区常常只有 `semantic === 'indoor'` 而没有 environment 字段，
 * 那种分区在面板上也写着「室内区域」，门贴着边线却永远不吸。
 * 这里补一条兼容：显式 outdoor 仍旧不算；没写或 unknown 时按语义认。
 * 2D 吸附与 3D 立墙共用这一个判据，不会出现「吸上了但墙没开洞」。
 */
export function zoneIsIndoor(zone: ZoneIndoorLike): boolean {
  if (zone.environment === 'indoor') return true;
  if (zone.environment === 'outdoor') return false;
  return zone.semantic === 'indoor';
}

/** 参与立墙的分区（壳体米制坐标，与 3D 地面色块同一份点）。 */
export interface IndoorWallZone extends ZoneIndoorLike {
  id: string;
  points: readonly ShellPoint[];
}

/** 门：中心点已换成壳体坐标，宽度取它自己的占地宽。 */
export interface IndoorWallDoor {
  id: string;
  center: ShellPoint;
  widthM: number;
}

/** 窗：同门，额外带窗台高与窗高（缺省 0.9 / 1.2 m）。 */
export interface IndoorWallWindow {
  id: string;
  center: ShellPoint;
  widthM: number;
  sillM?: number;
  heightM?: number;
}

export interface IndoorWallOpening {
  doorId: string;
  /** 洞口中心，从墙段中点沿 +X（a→b）量（m）。 */
  centerAlongWall: number;
  width: number;
  height: number;
  /** 洞口底离地高：门是 0，窗是窗台高（3D 挤出时用作 bottomFromFloor）。 */
  bottomFromFloor: number;
}

export interface IndoorWall {
  /**
   * 这面墙归谁：分区墙填 zone.id，手画墙填 plan.walls 自己的 id。
   * 2026-11-18 用户口径「不造假 uuid」——手画墙不属于任何分区，就不填，不编一个。
   */
  ownerId?: string;
  a: ShellPoint;
  b: ShellPoint;
  length: number;
  openings: IndoorWallOpening[];
}

/**
 * 手画的墙段（`plan.walls`）：已经是壳体系的两端 + 墙自己的 id。
 * 和分区边线走同一套墙段/洞口逻辑，区别只在没有 zone 可归。
 */
export interface ExtraIndoorWall {
  id: string;
  a: ShellPoint;
  b: ShellPoint;
}

export type IndoorDoorRefusalReason = 'door-wider-than-wall' | 'window-wider-than-wall';

/** 拒绝开洞的门：墙保持完整，留在场地上当图标。 */
export interface IndoorDoorRefusal {
  doorId: string;
  /** 同 `IndoorWall.ownerId`：手画墙上被拒时是墙的 id，分区墙上被拒时是分区 id。 */
  ownerId?: string;
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
  /** 手画的墙段（plan.walls）：与分区边线一起参与「门贴在哪儿、在哪儿开洞」。 */
  extraWalls?: readonly ExtraIndoorWall[];
  /** 窗：与门同一套贴墙判定，洞口不落地。 */
  windows?: readonly IndoorWallWindow[];
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
    if (!zoneIsIndoor(zone)) continue;
    const ring = zone.points;
    if (ring.length < 3) continue;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index]!;
      const b = ring[(index + 1) % ring.length]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (!(length >= MIN_WALL_LENGTH_M)) continue;
      walls.push({ ownerId: zone.id, a, b, length, openings: [] });
    }
  }

  // 手画墙：与分区边线同权，只是没有 zone 可归（ownerId 用它自己的 id）。
  for (const extra of options.extraWalls ?? []) {
    const length = Math.hypot(extra.b.x - extra.a.x, extra.b.z - extra.a.z);
    if (!(length >= MIN_WALL_LENGTH_M)) continue;
    walls.push({ ownerId: extra.id, a: extra.a, b: extra.b, length, openings: [] });
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
        ...(wall.ownerId ? { ownerId: wall.ownerId } : {}),
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
      // 门洞落地。
      bottomFromFloor: 0,
    });
  }

  // 窗：贴墙判定、墙埛/超宽拒绝与门完全一致，只差洞口不落地。
  for (const window of options.windows ?? []) {
    if (!(window.widthM > 0)) continue;
    let best: { wall: IndoorWall; t: number } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const wall of walls) {
      const hit = projectOnSegment(window.center, wall.a, wall.b);
      if (!hit || hit.dist > tolerance) continue;
      if (hit.dist >= bestDist) continue;
      best = { wall, t: hit.t };
      bestDist = hit.dist;
    }
    if (!best) continue;
    const { wall, t } = best;

    if (window.widthM + 2 * minPier > wall.length) {
      refusals.push({
        doorId: window.id,
        ...(wall.ownerId ? { ownerId: wall.ownerId } : {}),
        wallLength: wall.length,
        doorWidth: window.widthM,
        reason: 'window-wider-than-wall',
      });
      continue;
    }

    // 窗台不低于 0、窗顶不高过墙顶：两个都夹一遍，洞口不会跑出墙面。
    const sill = Math.max(0, Math.min(INDOOR_WALL_HEIGHT_M - 0.3, window.sillM ?? INDOOR_WINDOW_SILL_M));
    const height = Math.max(0.2, Math.min(INDOOR_WALL_HEIGHT_M - sill, window.heightM ?? INDOOR_WINDOW_HEIGHT_M));
    const limit = wall.length / 2 - minPier - window.widthM / 2;
    const centerAlongWall = Math.max(-limit, Math.min(limit, (t - 0.5) * wall.length));
    wall.openings.push({
      doorId: window.id,
      centerAlongWall,
      width: window.widthM,
      height,
      bottomFromFloor: sill,
    });
  }

  for (const wall of walls) wall.openings.sort((left, right) => left.centerAlongWall - right.centerAlongWall);
  return { walls, refusals };
}
