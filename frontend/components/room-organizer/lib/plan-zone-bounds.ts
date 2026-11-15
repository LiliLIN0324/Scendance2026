/**
 * 分区越界校验与「一键收进」（2026-11-15 用户指令）。
 *
 * 背景：分区可以先画、边界/设计范围可以后改。边界一收缩，早期画好的分区就留在外面，
 * 提交那一刻没人复验，界面上却仍是普通分区色——用户看不到问题出在哪。
 *
 * 口径：
 * - 判据只有两条：「顶点/边出了场地边界」和「顶点/边出了设计范围」，逐区独立判，
 *   复用 `zoneOutsideBoundaryIssue`（贴边、共边不算越界），不另立几何公式。
 * - 「收进」优先保形：先试**平移**（沿指向容器中心的方向，二分出最小位移），
 *   平移做不到才**按比例收缩**（以锚点为中心整体缩放）。矩形进→矩形出。
 * - 收进后仍要满足分区最小面积；做不到就返回 null，由界面说清「请先确认边界」，
 *   不静默改坏数据。
 */

import { planRingAreaM2, type PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { PLAN_MIN_ZONE_AREA_M2, zoneOutsideBoundaryIssue } from './site-plan-editing';

export interface ZoneBoundsOverflow {
  zoneId: string;
  zoneName: string;
  /** 有顶点/边落在场地边界之外。 */
  outsideBoundary: boolean;
  /** 有顶点/边落在设计范围之外（没画范围时永远 false）。 */
  outsideScope: boolean;
  /** 建议的收进结果；null = 收不动（边界与范围不相交、或缩到最小面积也放不下）。 */
  pulled: PlanPoint[] | null;
  pulledMethod: 'translate' | 'shrink' | null;
}

interface RingLike {
  id: string;
  name: string;
  polygon: readonly PlanPoint[];
}

function centroidOf(ring: readonly PlanPoint[]): PlanPoint {
  let sx = 0;
  let sy = 0;
  for (const p of ring) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / ring.length, y: sy / ring.length };
}

/** 环是否同时落在所有容器里（容器 <3 点视为没有约束）。面积不够也算不通过。 */
function ringFits(ring: readonly PlanPoint[], containers: readonly (readonly PlanPoint[])[]): boolean {
  if (ring.length < 3) return false;
  if (planRingAreaM2(ring) < PLAN_MIN_ZONE_AREA_M2) return false;
  for (const container of containers) {
    if (container.length < 3) continue;
    if (zoneOutsideBoundaryIssue(ring, container) !== null) return false;
  }
  return true;
}

function scaleRing(ring: readonly PlanPoint[], anchor: PlanPoint, k: number): PlanPoint[] {
  return ring.map(p => ({ x: anchor.x + (p.x - anchor.x) * k, y: anchor.y + (p.y - anchor.y) * k }));
}

function translateRing(ring: readonly PlanPoint[], dx: number, dy: number): PlanPoint[] {
  return ring.map(p => ({ x: p.x + dx, y: p.y + dy }));
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(ring: readonly PlanPoint[]): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * 把一个环「贴边」摆进容器：只平移、不改尺寸，取离原位最近的可行位置，
 * 最后朝四个方向推到贴着内沿——看起来才是吸上去的，而不是浮在中间。
 *
 * 为什么用网格而不是解析解：容器是任意多边形（场地边界是手画的凹多边形），
 * 求「最小位移凸包内接」代价远高于直接用 0.25 m 网格粗扫 + 二分细化；
 * 分区也就几个到几十个，一次点击的开销完全可接受。
 */
function placeRingFlush(ring: readonly PlanPoint[], containers: readonly (readonly PlanPoint[])[]): PlanPoint[] | null {
  const boxes = containers.filter(c => c.length >= 3).map(boundsOf);
  if (boxes.length === 0) return null;
  const box: Box = {
    minX: Math.max(...boxes.map(b => b.minX)),
    minY: Math.max(...boxes.map(b => b.minY)),
    maxX: Math.min(...boxes.map(b => b.maxX)),
    maxY: Math.min(...boxes.map(b => b.maxY)),
  };
  const rb = boundsOf(ring);
  const w = rb.maxX - rb.minX;
  const h = rb.maxY - rb.minY;
  // 连外接矩形都塞不进去，平移无解（交给上层去缩）。
  if (w > box.maxX - box.minX || h > box.maxY - box.minY) return null;

  const ax0 = box.minX;
  const ax1 = box.maxX - w;
  const ay0 = box.minY;
  const ay1 = box.maxY - h;
  const step = Math.max(0.25, Math.min(box.maxX - box.minX, box.maxY - box.minY) / 60);
  let best: { dx: number; dy: number; dist: number } | null = null;
  for (let ax = ax0; ax <= ax1 + 1e-9; ax += step) {
    for (let ay = ay0; ay <= ay1 + 1e-9; ay += step) {
      const dx = ax - rb.minX;
      const dy = ay - rb.minY;
      const dist = Math.hypot(dx, dy);
      if (best !== null && dist >= best.dist) continue;
      if (ringFits(translateRing(ring, dx, dy), containers)) best = { dx, dy, dist };
    }
  }
  if (best === null) return null;

  // 沿「原位 → 最优格点」二分，取最近的可行位置（格点只是粗解）。
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i += 1) {
    const mid = (lo + hi) / 2;
    if (ringFits(translateRing(ring, best.dx * mid, best.dy * mid), containers)) hi = mid;
    else lo = mid;
  }
  let dx = best.dx * hi;
  let dy = best.dy * hi;

  // 四向推边：把网格剩下的空隙压到贴住内沿。搜索半径给整个容器对角线——
  // 只推几个网格步长的话，粗选位置离墙色还差两三个步长时就贴不上。
  const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const [ux, uy] = dir;
    let reach = diag;
    if (!ringFits(translateRing(ring, dx + ux * reach, dy + uy * reach), containers)) {
      let l = 0;
      let hh = reach;
      for (let i = 0; i < 20; i += 1) {
        const mid = (l + hh) / 2;
        if (ringFits(translateRing(ring, dx + ux * mid, dy + uy * mid), containers)) l = mid;
        else hh = mid;
      }
      reach = l;
    }
    dx += ux * reach;
    dy += uy * reach;
  }
  return translateRing(ring, dx, dy);
}

/**
 * 把单个分区收进「场地边界 ∩ 设计范围」，**尺寸优先、只缩必要的那一点**。
 *
 * 2026-11-15 用户追问「能不能直接自动贴边」：上一版按锚点缩放，舞台区从 37×26 缩成 17×12，
 * 原因是它只允许绕固定锚点缩、不允许边缩边挪。现在改成：
 * 1. 先试整块平移，能不能贴边放下（尺寸、面积全不变）；
 * 2. 放不下再从 1.0 往下每 2% 试一个比例，每个比例都允许自由平移，
 *    取「能放下的最大比例」，然后推到贴着内沿。
 * 所以分区只会缩到刚刚能进的那一档，不会缩成一团小方块。
 */
export function pullRingIntoBounds(
  ring: readonly PlanPoint[],
  boundary: readonly PlanPoint[],
  scope: readonly PlanPoint[] = [],
): { points: PlanPoint[]; method: 'translate' | 'shrink' } | null {
  if (ring.length < 3) return null;
  const containers: (readonly PlanPoint[])[] = [boundary, scope];
  if (ringFits(ring, containers)) {
    return { points: ring.map(p => ({ x: p.x, y: p.y })), method: 'translate' };
  }

  const anchor = centroidOf(ring);
  for (let i = 0; i <= 34; i += 1) {
    const k = 1 - i * 0.02;
    const candidate = k === 1 ? ring.map(p => ({ x: p.x, y: p.y })) : scaleRing(ring, anchor, k);
    const placed = placeRingFlush(candidate, containers);
    if (placed) return { points: placed, method: k === 1 ? 'translate' : 'shrink' };
  }
  return null;
}

/**
 * 全案分区越界清单（顺序按分区原序，便于界面稳定展示）。
 * 边界/范围没画（<3 点）时该项不参与判定——没有基准就没有「出界」。
 */
export function findZoneBoundsOverflow(plan: {
  boundary: readonly PlanPoint[];
  designScope?: readonly PlanPoint[] | undefined;
  zones: readonly RingLike[];
}): ZoneBoundsOverflow[] {
  const scope = plan.designScope ?? [];
  const out: ZoneBoundsOverflow[] = [];
  for (const zone of plan.zones) {
    if (zone.polygon.length < 3) continue;
    const outsideBoundary = plan.boundary.length >= 3 && zoneOutsideBoundaryIssue(zone.polygon, plan.boundary) !== null;
    const outsideScope = scope.length >= 3 && zoneOutsideBoundaryIssue(zone.polygon, scope) !== null;
    if (!outsideBoundary && !outsideScope) continue;
    const pulled = pullRingIntoBounds(zone.polygon, plan.boundary, scope);
    out.push({
      zoneId: zone.id,
      zoneName: zone.name,
      outsideBoundary,
      outsideScope,
      pulled: pulled?.points ?? null,
      pulledMethod: pulled?.method ?? null,
    });
  }
  return out;
}

/** 越界原因的一句话说明（界面提示用）。 */
export function zoneOverflowReason(item: ZoneBoundsOverflow): string {
  if (item.outsideBoundary && item.outsideScope) return '超出用地红线和设计范围';
  return item.outsideBoundary ? '超出用地红线' : '超出设计范围';
}
