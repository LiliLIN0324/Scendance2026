import type { FurnitureItem, InteriorWall, RoomLayout } from '../components/room-organizer/lib/types';

/** 几何判据容差（米）。所有数字与相交判断都用同一把尺子。 */
const EPS = 1e-6;

/**
 * 违规码枚举。
 * - OUT_OF_BOUNDS / WALL_INTERSECTION / BBOX_OVERLAP：M3-A 已实现的硬伤判据。
 * - MAIN_AISLE_BLOCKED：大件压主通道带（椅子/低矮件/结构件豁免）。
 * - CHAIR_ISLAND：椅子离通道过远且被家具围合，疑似孤岛椅。
 */
export type ViolationCode =
  | 'OUT_OF_BOUNDS'
  | 'WALL_INTERSECTION'
  | 'BBOX_OVERLAP'
  | 'MAIN_AISLE_BLOCKED'
  | 'CHAIR_ISLAND';

/** 单条违规记录。 */
export interface Violation {
  /** 违规类型。 */
  code: ViolationCode;
  /** 违规家具 id。 */
  itemId: string;
  /** 违规家具中文名，便于直接展示。 */
  itemName: string;
  /** 中文人话描述。 */
  detail: string;
  /**
   * 冲突对手：越界时为空串；BBOX_OVERLAP 时为对方 itemId；
   * WALL_INTERSECTION 时为内墙 id。
   */
  targetId?: string;
}

interface Pt {
  x: number;
  z: number;
}

/**
 * 工具：item 旋转后的 4 个世界角点（顺时针顺序）。
 * 坐标原点在房间中心；item.position 是中心点；rotation 单位弧度，0 朝向 +z。
 * width/depth 是未旋转时的全宽/全深，半边长分别为 width/2、depth/2。
 */
export function itemCorners(item: FurnitureItem): Array<{ x: number; z: number }> {
  const cx = item.position?.x ?? 0;
  const cz = item.position?.z ?? 0;
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const theta = item.rotation ?? 0;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  // 局部角点顺序：BL → BR → TR → TL（在 x-z 平面内为顺时针）。
  const locals: Pt[] = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ];
  return locals.map((p) => ({
    x: cx + p.x * c - p.z * s,
    z: cz + p.x * s + p.z * c,
  }));
}

/** 计算凸多边形的 AABB。 */
function aabbOf(poly: Pt[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** 旋转后的 AABB 是否越出场地边界（场地以原点为中心）。 */
function isOutOfBounds(poly: Pt[], width: number, height: number): boolean {
  const { minX, maxX, minZ, maxZ } = aabbOf(poly);
  return (
    minX < -width / 2 - EPS ||
    maxX > width / 2 + EPS ||
    minZ < -height / 2 - EPS ||
    maxZ > height / 2 + EPS
  );
}

/** 把多边形投影到给定轴上，返回 [min, max]。 */
function projectAlong(poly: Pt[], axis: Pt): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.z * axis.z;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/** 取矩形 4 条边的法向作为 SAT 分离轴。 */
function axesOf(poly: Pt[]): Pt[] {
  const axes: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    // 边向量 (ex, ez) 的法向：(-ez, ex)
    axes.push({ x: -ez, z: ex });
  }
  return axes;
}

/**
 * SAT（分离轴定理）判断两个凸多边形是否相交。
 * 相切（投影恰好接触）不算重叠，留 EPS 余量。
 */
function polygonsOverlap(a: Pt[], b: Pt[]): boolean {
  const axes = [...axesOf(a), ...axesOf(b)];
  for (const axis of axes) {
    const pa = projectAlong(a, axis);
    const pb = projectAlong(b, axis);
    if (pa.max < pb.min - EPS || pb.max < pa.min - EPS) {
      return false;
    }
  }
  return true;
}

/** 2D 叉积 (a × b)。 */
function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/** 线段 p1p2 与线段 q1q2 是否严格相交（共线/端点接触不算）。 */
function segmentsIntersect(p1: Pt, p2: Pt, q1: Pt, q2: Pt): boolean {
  const d1 = cross(q2.x - q1.x, q2.z - q1.z, p1.x - q1.x, p1.z - q1.z);
  const d2 = cross(q2.x - q1.x, q2.z - q1.z, p2.x - q1.x, p2.z - q1.z);
  const d3 = cross(p2.x - p1.x, p2.z - p1.z, q1.x - p1.x, q1.z - p1.z);
  const d4 = cross(p2.x - p1.x, p2.z - p1.z, q2.x - p1.x, q2.z - p1.z);
  const p1Side = d1 > EPS ? 1 : d1 < -EPS ? -1 : 0;
  const p2Side = d2 > EPS ? 1 : d2 < -EPS ? -1 : 0;
  const q1Side = d3 > EPS ? 1 : d3 < -EPS ? -1 : 0;
  const q2Side = d4 > EPS ? 1 : d4 < -EPS ? -1 : 0;
  return p1Side !== p2Side && q1Side !== q2Side && p1Side !== 0 && p2Side !== 0 && q1Side !== 0 && q2Side !== 0;
}

/** 点是否在凸多边形内部（含边上，按容差处理）。 */
function pointInConvexPoly(p: Pt, poly: Pt[]): boolean {
  let sign: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = cross(b.x - a.x, b.z - a.z, p.x - a.x, p.z - a.z);
    if (Math.abs(c) < EPS) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === null) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

/** 线段 p1p2 是否穿过凸多边形 poly（端点在内或与任一边相交）。 */
function segmentHitsPolygon(p1: Pt, p2: Pt, poly: Pt[]): boolean {
  if (pointInConvexPoly(p1, poly) || pointInConvexPoly(p2, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (segmentsIntersect(p1, p2, a, b)) return true;
  }
  return false;
}

/** 低矮件（地毯/地垫/台阶等）：不参与 BBOX_OVERLAP 判据，但仍要查越界。 */
function isLowProfile(item: FurnitureItem): boolean {
  return item.height <= 0.05 || item.type === 'rug';
}

/** structural-* 标记件（柱/墙/门洞等结构占位）：跳过重叠判据。 */
function isStructural(item: FurnitureItem): boolean {
  return typeof item.type === 'string' && item.type.startsWith('structural');
}

/**
 * 椅/凳/沙发类家具：允许临时压主通道（不算堵死），
 * 但当它被推到离通道 >0.6m 且被一堆家具围合时，会被识别为孤岛椅。
 */
function isChairFamily(item: FurnitureItem): boolean {
  return (
    item.type === 'chair' ||
    item.type === 'dining-chair' ||
    item.type === 'armchair' ||
    item.type === 'bench' ||
    item.type === 'sofa'
  );
}

/**
 * 核心判据：把 candidate 放到 floorIndex 这一层，对 floor.items（含 candidate 自身）跑全部硬伤。
 * 调用方负责决定是只看合法性，还是把违规清单透出。
 */
function checkAgainstFloor(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floors'>,
  floorIndex: number,
  candidate: FurnitureItem,
): Violation[] {
  const violations: Violation[] = [];
  const floor = layout.floors[floorIndex];
  if (!floor) return violations;

  const poly = itemCorners(candidate);

  // 1. 越界
  if (isOutOfBounds(poly, layout.width, layout.height)) {
    violations.push({
      code: 'OUT_OF_BOUNDS',
      itemId: candidate.id,
      itemName: candidate.name,
      detail: `「${candidate.name}」越出场地边界（场地 ${layout.width}m × ${layout.height}m）`,
    });
  }

  // 2. 穿内墙
  const walls: InteriorWall[] = floor.interiorWalls ?? [];
  for (const wall of walls) {
    const w1: Pt = { x: wall.x1, z: wall.z1 };
    const w2: Pt = { x: wall.x2, z: wall.z2 };
    if (segmentHitsPolygon(w1, w2, poly)) {
      violations.push({
        code: 'WALL_INTERSECTION',
        itemId: candidate.id,
        itemName: candidate.name,
        detail: `「${candidate.name}」与内墙「${wall.id}」相交`,
        targetId: wall.id,
      });
    }
  }

  // 3. 包围盒重叠（低矮件 / structural 占位件豁免）
  if (!isLowProfile(candidate) && !isStructural(candidate)) {
    for (const other of floor.items) {
      if (other.id === candidate.id) continue;
      if (isLowProfile(other) || isStructural(other)) continue;
      const otherPoly = itemCorners(other);
      if (polygonsOverlap(poly, otherPoly)) {
        // 去重：同一对家具只报一次，itemId 字典序较小的那一方挂记录。
        if (candidate.id < other.id) {
          violations.push({
            code: 'BBOX_OVERLAP',
            itemId: candidate.id,
            itemName: candidate.name,
            detail: `「${candidate.name}」与「${other.name}」包围盒重叠`,
            targetId: other.id,
          });
        }
      }
    }
  }

  // 4. 主通道被堵：沿房间中线 x=0 的纵向通道带（宽 1.2m，贯穿全高）。
  //    大件（桌/柜/舞台/背景等）压上去就报；椅子类、低矮件、结构件豁免。
  if (!isStructural(candidate) && !isLowProfile(candidate) && !isChairFamily(candidate)) {
    const aabb = aabbOf(poly);
    const aisle = {
      minX: -0.6,
      maxX: 0.6,
      minZ: -layout.height / 2,
      maxZ: layout.height / 2,
    };
    const overlap =
      aabb.minX < aisle.maxX - EPS &&
      aabb.maxX > aisle.minX + EPS &&
      aabb.minZ < aisle.maxZ - EPS &&
      aabb.maxZ > aisle.minZ + EPS;
    if (overlap) {
      violations.push({
        code: 'MAIN_AISLE_BLOCKED',
        itemId: candidate.id,
        itemName: candidate.name,
        detail: `「${candidate.name}」堵住了主通道（预留 1.2m 宽纵向通道）`,
      });
    }
  }

  // 5. 孤岛椅：椅/凳/沙发离主通道带的最小水平距离 > 0.6m，
  //    且 1.5m 半径内有 ≥3 件其他非结构、非低矮家具围合。
  if (isChairFamily(candidate)) {
    const aabb = aabbOf(poly);
    let gap = 0;
    if (aabb.maxX < -0.6) gap = -0.6 - aabb.maxX;
    else if (aabb.minX > 0.6) gap = aabb.minX - 0.6;
    if (gap > 0.6 + EPS) {
      let neighbors = 0;
      const cx = candidate.position?.x ?? 0;
      const cz = candidate.position?.z ?? 0;
      for (const other of floor.items) {
        if (other.id === candidate.id) continue;
        if (isStructural(other) || isLowProfile(other)) continue;
        const ox = other.position?.x ?? 0;
        const oz = other.position?.z ?? 0;
        const d = Math.hypot(ox - cx, oz - cz);
        if (d <= 1.5 + EPS) neighbors += 1;
      }
      if (neighbors >= 3) {
        violations.push({
          code: 'CHAIR_ISLAND',
          itemId: candidate.id,
          itemName: candidate.name,
          detail: `「${candidate.name}」离主通道过远且被家具围合，可能是孤岛椅`,
        });
      }
    }
  }

  return violations;
}

/**
 * 判断候选家具落到 floorIndex 这一层是否合法（无任何硬伤）。
 * 若 candidate 本身已在该层 items 里（例如正在拖动已存在的家具），自比会被跳过。
 */
export function isPlacementLegal(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floors'>,
  floorIndex: number,
  candidate: FurnitureItem,
): boolean {
  if (!layout.floors[floorIndex]) return false;
  return checkAgainstFloor(layout, floorIndex, candidate).length === 0;
}

/**
 * 扫一遍整份布局（或指定某一层）的所有 items，返回违规清单。
 * - options.floorIndex 缺省：扫所有 floor。
 * - OUT_OF_BOUNDS / WALL_INTERSECTION 对每件低矮件同样生效；BBOX_OVERLAP 对低矮件豁免。
 * - MAIN_AISLE_BLOCKED 对大件生效，对椅子/低矮件/结构件豁免。
 * - CHAIR_ISLAND 只对椅/凳/沙发类生效，且要求离通道 >0.6m 且被 ≥3 件家具围合。
 */
export function collectViolations(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floors'>,
  options?: { floorIndex?: number },
): Violation[] {
  const violations: Violation[] = [];
  const indices =
    options?.floorIndex !== undefined
      ? [options.floorIndex]
      : layout.floors.map((_, i) => i);
  for (const fi of indices) {
    const floor = layout.floors[fi];
    if (!floor) continue;
    for (const item of floor.items) {
      violations.push(...checkAgainstFloor(layout, fi, item));
    }
  }
  return violations;
}
