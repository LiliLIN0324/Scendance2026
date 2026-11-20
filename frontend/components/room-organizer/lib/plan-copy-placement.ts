/**
 * 复制设施时的落点选择（2026-11-20 审计 F2）。
 *
 * 原来单件复制和整组复制都写死「+2 m, +2 m」：贴着红线或紧邻别的物件的展位复制出来就
 * 直接落到场地外/压在别人身上，而问题页只报「越界」不报「重叠」，执行团队按图搭台才发现。
 *
 * 这一层不改复制的语义（复制仍是一次 commit、副本仍挑空闲位），只把「+2,+2」从唯一答案
 * 降级为首选：先试原来的偏移，不行就按 2m 一档向外找最近的空地（8 个方向逐圈）。
 * 一圈都找不到时仍返回原偏移并标记 `clear: false`——复制不该被静默拒绝，
 * 但调用方要如实说明「副本落在场地外或与已有物件重叠，问题清单会列出」。
 */

import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { facilitiesFootprintsIntersect, facilityFootprintRing, facilityPlacementIssues } from './site-plan-facilities';

/** 判定落点需要的最小形状（与 facilityFootprintRing 的入参一致）。 */
export interface PlanCopyShape {
  position: PlanPoint;
  rotationDeg: number;
  size: { width: number; depth: number };
}

export interface PlanCopyOffsetOptions {
  /** 每档步长（米），默认沿用原有的 2 m。 */
  stepM?: number;
  /** 最多向外找几圈，默认 4 圈（2/4/6/8 m）。 */
  rings?: number;
}

export interface PlanCopyOffsetResult {
  /** 相对原位置的偏移（米）。 */
  offset: PlanPoint;
  /** true = 这个偏移下每个副本都在红线内且不与现有/彼此占地相交。 */
  clear: boolean;
}

/** 首选偏移：保持 2026-11-11 以来的 +2/+2，除非它不干净。 */
const PREFERRED_OFFSET: PlanPoint = { x: 2, y: 2 };

/** 逐圈寻找的方向：正交优先，再对角（贴边排列时正交更容易找到缝）。 */
const DIRECTIONS: readonly PlanPoint[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: -1 },
];

function shifted(shape: PlanCopyShape, offset: PlanPoint): PlanCopyShape {
  return { ...shape, position: { x: shape.position.x + offset.x, y: shape.position.y + offset.y } };
}

/**
 * 占地是否真的重叠（贴边不算）。
 * `facilitiesFootprintsIntersect` 的投影比较含边界，两件紧贴的 2 m 展位会被判成「相交」；
 * 但副本紧贴原件/邻居是正常摆法，不能因此把它算成脏落点。这里把副本缩 1 cm 再比。
 */
function overlapsStrictly(copy: PlanCopyShape, other: PlanCopyShape): boolean {
  const shrunk: PlanCopyShape = {
    ...copy,
    size: { width: Math.max(copy.size.width - 0.02, 0.01), depth: Math.max(copy.size.depth - 0.02, 0.01) },
  };
  return facilitiesFootprintsIntersect(shrunk, other, 0);
}

function offsetClear(
  sources: readonly PlanCopyShape[],
  others: readonly PlanCopyShape[],
  boundary: readonly PlanPoint[],
  offset: PlanPoint,
): boolean {
  const copies = sources.map(shape => shifted(shape, offset));
  for (const copy of copies) {
    const ring = facilityFootprintRing(copy);
    if (facilityPlacementIssues(ring, boundary).length > 0) return false;
    if (others.some(other => overlapsStrictly(copy, other))) return false;
    // 多件一起复制时，副本之间也不能互相压住。
    if (copies.filter(item => item !== copy).some(other => overlapsStrictly(copy, other))) return false;
  }
  return true;
}

/**
 * 复制落点：返回相对原位置的偏移。
 * `others` 传当前方案里所有设施（原位置仍在场上，副本不能压住原件）。
 */
export function planCopyOffset(
  sources: readonly PlanCopyShape[],
  others: readonly PlanCopyShape[],
  boundary: readonly PlanPoint[],
  options: PlanCopyOffsetOptions = {},
): PlanCopyOffsetResult {
  const stepM = Math.max(0.5, options.stepM ?? 2);
  const rings = Math.max(0, Math.floor(options.rings ?? 4));
  if (sources.length === 0) return { offset: PREFERRED_OFFSET, clear: false };
  if (offsetClear(sources, others, boundary, PREFERRED_OFFSET)) {
    return { offset: PREFERRED_OFFSET, clear: true };
  }
  for (let ring = 1; ring <= rings; ring += 1) {
    for (const direction of DIRECTIONS) {
      const offset = { x: direction.x * stepM * ring, y: direction.y * stepM * ring };
      if (offsetClear(sources, others, boundary, offset)) return { offset, clear: true };
    }
  }
  return { offset: PREFERRED_OFFSET, clear: false };
}
