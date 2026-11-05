/**
 * 净距报告：一个物件「离最近的东西还有多少米」。
 *
 * 为什么要有它：幕景的校验一直只有两态——通过，或者不通过。但真实事故多半落在中间：
 * 尺寸没超界、也没重叠，只是通道只剩 0.82 米，搬不进推车。这种「合法但不可用」在布尔
 * 回执里被吞掉，模型接着往下排，人到现场才发现。
 *
 * 所以 validate_candidate 通过时也回一份实测净距，模型据此判断通道够不够，不必再去
 * 猜、也不必再问一次。数值是引擎量的，不是模型说的。
 */
import type { Point, Scene } from './domain.ts';
import { footprint, footprintsIntersect, pointInPolygon } from './structural-geometry.ts';
import { structureOf, venuePolygon, wallPolygons } from './scene-digest.ts';

export type ClearanceKind = 'object' | 'wall' | 'column' | 'edge';

export type Clearance = {
  /** 被量的物件。 */
  id: string;
  /** 到最近障碍物的净距，米，三位小数；重叠时为 0。 */
  gap: number;
  nearest: { kind: ClearanceKind; ref: string };
};

const EPS = 1e-9;

function segmentGap(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < EPS) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/**
 * 两个凸多边形之间的净距：相交为 0，否则取所有「顶点到对边」距离的最小值。
 * 凸多边形的最近距离一定落在某条边与对端某条边之间，所以顶点扫边就够。
 */
export function polygonGap(a: Point[], b: Point[]): number {
  if (footprintsIntersect(a, b)) return 0;
  let best = Infinity;
  for (const p of a) for (let i = 0; i < b.length; i += 1) best = Math.min(best, segmentGap(p, b[i], b[(i + 1) % b.length]));
  for (const p of b) for (let i = 0; i < a.length; i += 1) best = Math.min(best, segmentGap(p, a[i], a[(i + 1) % a.length]));
  return Number.isFinite(best) ? Number(best.toFixed(3)) : 0;
}

/**
 * 到场地边界的距离。
 *
 * 不能复用 polygonGap：物件在场地**里面**，包含关系会被相交判定算成 0，于是「离边界多远」
 * 永远是 0，整个报告就没意义了。这里改成「顶点到边界线的最短距离」，越界才算 0。
 */
export function boundaryGap(poly: Point[], boundary: Point[]): number {
  if (!poly.every(p => pointInPolygon(p, boundary))) return 0;
  let best = Infinity;
  for (const p of poly) for (let i = 0; i < boundary.length; i += 1) best = Math.min(best, segmentGap(p, boundary[i], boundary[(i + 1) % boundary.length]));
  return Number.isFinite(best) ? Number(best.toFixed(3)) : 0;
}

/**
 * 给一批物件量净距。
 *
 * 只量传进来的这些 id——validate_candidate 里就是本次被命令碰到的物件；把整场都量一遍
 * 会淹没模型（它只需要知道自己刚动的那几件挨得近不近）。同一场里物件可能很多，只保留
 * 最近的一个障碍，因为「离谁最近、差多少」才是可操作的读数。
 */
export function clearanceReport(scene: Scene, ids: string[]): Clearance[] {
  const structure = structureOf(scene);
  const walls = wallPolygons(scene);
  const boundary = venuePolygon(scene);
  const report: Clearance[] = [];
  for (const id of ids) {
    const object = scene.objects.find(candidate => candidate.id === id);
    if (!object) continue;
    const poly = footprint(object);
    let nearest: Clearance['nearest'] = { kind: 'edge', ref: 'venue' };
    let gap = boundaryGap(poly, boundary);
    const consider = (value: number, kind: ClearanceKind, ref: string) => {
      if (value < gap) { gap = value; nearest = { kind, ref }; }
    };
    for (const other of scene.objects) {
      if (other.id === id) continue;
      consider(polygonGap(poly, footprint(other)), 'object', other.id);
    }
    for (let index = 0; index < walls.length; index += 1) consider(polygonGap(poly, walls[index]), 'wall', structure.walls[index].id);
    for (const column of structure.columns) consider(polygonGap(poly, footprint(column)), 'column', column.id);
    report.push({ id, gap, nearest });
  }
  return report;
}
