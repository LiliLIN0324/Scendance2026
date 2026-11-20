/**
 * 设施占地之间的重叠检测（2026-11-20 地图编辑交互审计 K7）。
 *
 * 背景：放置只校验越界，冲突清单只有「动线压设施」，没有「物料压物料」——两顶桁架、
 * 两个展位可以完全叠在一起，画布/清单/问题页都不报；偏偏阵列复制会拦碰撞，前后语义不一致。
 *
 * 这一层回答三个问题，不做界面、不读 store：
 *  1. 这一对设施是不是**本来就该叠**（桌椅、地毯/桌布这类覆盖物、隔离栏这类导流件）；
 *  2. 两个占地是真的重叠，还是只是贴边（贴边是正常摆法，不算重叠）；
 *  3. 重叠有多深——「几乎完全重合」按冲突报，其余按待核实提示，避免给贴邻的展位刷红。
 *
 * 判定口径：
 * - tolerance：每边缩 5 cm 后再判相交，浅于 5 cm 的压边不算重叠（模型摆位本来就有误差）；
 * - duplicateRatio：交集面积 / 较小占地面积 ≥ 80% 视为「像重复摆放」，按冲突报；
 * - 面积用 Sutherland–Hodgman 凸多边形裁剪算，两个占地都是矩形（含旋转），不必近似采样。
 */

import { facilityFootprintRing } from './site-plan-facilities';
import type { PlanFacility, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** 每边留出的容差（米）：浅于它的压边按「贴边」处理。 */
export const PLAN_FACILITY_OVERLAP_TOLERANCE_M = 0.05;
/** 交集占较小占地面积的比例达到它 → 视为「几乎完全重合」。 */
export const PLAN_FACILITY_OVERLAP_DUPLICATE_RATIO = 0.8;
/** 低于它的重叠比例不报（0.5% 以下属于数值噪声）。 */
export const PLAN_FACILITY_OVERLAP_MIN_RATIO = 0.005;

/**
 * 允许正常叠放的类别（产品口径，2026-11-20 定）。
 *
 * 这些是「垂直方向本来就要叠」或「薄片状贴着摆」的物料：
 * - 覆盖类：地毯/地垫/桌布/背景布/帷幔——铺在别的物件下面或上面就是它们的用途；
 * - 桌椅：椅子/凳子收在桌下是标准摆法；
 * - 导流类：隔离栏/警戒带/路锥——常贴着设施边缘摆，占地相交是常态。
 * 名单按 templateId + 名称关键词匹配；不在名单里的重叠才会被报出来。
 */
const SOFT_COVER_PATTERN = /rug|carpet|floor-?mat|table-?cloth|backdrop|banner|cloth|drape|valance|地毯|地垫|地布|桌布|背景布|挂布|帷幔|篷布/;
const SEAT_PATTERN = /chair|seat|stool|bench|椅子|座椅|坐凳|长凳|凳子/;
const TABLE_PATTERN = /table|desk|counter|bar-?counter|桌|台面|吧台|服务台/;
const GUIDE_PATTERN = /stanchion|barrier|fence|rope|bollard|cone|sign-?post|隔离|栏杆|围栏|路锥|警戒|导流/;

function textOf(facility: Pick<PlanFacility, 'templateId' | 'name'>): string {
  return `${facility.templateId} ${facility.name}`;
}

/** 这一对设施是否属于「本来就该叠」的类别。 */
export function mayStackFacilities(a: Pick<PlanFacility, 'templateId' | 'name'>, b: Pick<PlanFacility, 'templateId' | 'name'>): boolean {
  const textA = textOf(a);
  const textB = textOf(b);
  if (SOFT_COVER_PATTERN.test(textA) || SOFT_COVER_PATTERN.test(textB)) return true;
  if (GUIDE_PATTERN.test(textA) || GUIDE_PATTERN.test(textB)) return true;
  const seatTable = (SEAT_PATTERN.test(textA) && TABLE_PATTERN.test(textB))
    || (TABLE_PATTERN.test(textA) && SEAT_PATTERN.test(textB));
  return seatTable;
}

function signedArea(points: readonly PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** Sutherland–Hodgman：把 subject 裁到凸多边形 clip 内（clip 必须凸）。 */
function clipConvex(subject: readonly PlanPoint[], clip: readonly PlanPoint[]): PlanPoint[] {
  const orientation = signedArea(clip) >= 0 ? 1 : -1;
  let output: PlanPoint[] = [...subject];
  for (let i = 0; i < clip.length && output.length > 0; i += 1) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const side = (p: PlanPoint) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j += 1) {
      const current = input[j]!;
      const previous = input[(j + input.length - 1) % input.length]!;
      const currentIn = side(current) >= -1e-9;
      const previousIn = side(previous) >= -1e-9;
      if (currentIn) {
        if (!previousIn) output.push(intersect(previous, current, a, b));
        output.push(current);
      } else if (previousIn) {
        output.push(intersect(previous, current, a, b));
      }
    }
  }
  return output;
}

function intersect(p1: PlanPoint, p2: PlanPoint, a: PlanPoint, b: PlanPoint): PlanPoint {
  const r = { x: p2.x - p1.x, y: p2.y - p1.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return { x: p2.x, y: p2.y };
  const t = ((a.x - p1.x) * s.y - (a.y - p1.y) * s.x) / denom;
  return { x: p1.x + r.x * t, y: p1.y + r.y * t };
}

/** 两个占地环的交集面积（平方米）。 */
export function footprintOverlapArea(a: readonly PlanPoint[], b: readonly PlanPoint[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const clipped = clipConvex(a, b);
  return clipped.length < 3 ? 0 : Math.abs(signedArea(clipped));
}

function ringArea(points: readonly PlanPoint[]): number {
  return points.length < 3 ? 0 : Math.abs(signedArea(points));
}

/** 把占地按尺寸各缩 tolerance（米）后返回；缩没了返回 null。 */
function shrinkRing(facility: PlanFacility, toleranceM: number): PlanPoint[] | null {
  const scaleX = (facility.size.width - toleranceM * 2) / facility.size.width;
  const scaleY = (facility.size.depth - toleranceM * 2) / facility.size.depth;
  if (scaleX <= 0 || scaleY <= 0) return null;
  return facilityFootprintRing(facility).map(point => ({
    x: facility.position.x + (point.x - facility.position.x) * scaleX,
    y: facility.position.y + (point.y - facility.position.y) * scaleY,
  }));
}

export interface FacilityOverlapPair {
  a: PlanFacility;
  b: PlanFacility;
  /** 重叠的定位点（两件占地中心的中点）。 */
  at: PlanPoint;
  /** 交集 / 较小占地面积，0–1。 */
  ratio: number;
  /** true = 几乎完全重合（按冲突报），false = 部分重叠（按待核实报）。 */
  nearDuplicate: boolean;
}

/**
 * 全案两两重叠（已排除允许叠放的类别与贴边）。
 * 用 8 m 网格做候选筛选：设施多时不会退化成 O(n²)。
 */
export function facilityOverlapPairs(
  facilities: readonly PlanFacility[],
  options: { toleranceM?: number; duplicateRatio?: number } = {},
): FacilityOverlapPair[] {
  const toleranceM = Math.max(0, options.toleranceM ?? PLAN_FACILITY_OVERLAP_TOLERANCE_M);
  const duplicateRatio = options.duplicateRatio ?? PLAN_FACILITY_OVERLAP_DUPLICATE_RATIO;
  const rings = new Map<string, PlanPoint[]>();
  const boxes = new Map<string, { minX: number; maxX: number; minY: number; maxY: number }>();
  for (const facility of facilities) {
    const ring = facilityFootprintRing(facility);
    rings.set(facility.id, ring);
    boxes.set(facility.id, {
      minX: Math.min(...ring.map(point => point.x)),
      maxX: Math.max(...ring.map(point => point.x)),
      minY: Math.min(...ring.map(point => point.y)),
      maxY: Math.max(...ring.map(point => point.y)),
    });
  }

  // 网格候选：格子边 8 m，占地跨多格就登记到多格。
  const CELL_M = 8;
  const grid = new Map<string, number[]>();
  facilities.forEach((facility, index) => {
    const box = boxes.get(facility.id)!;
    const x0 = Math.floor(box.minX / CELL_M);
    const x1 = Math.floor(box.maxX / CELL_M);
    const y0 = Math.floor(box.minY / CELL_M);
    const y1 = Math.floor(box.maxY / CELL_M);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        const key = `${x}:${y}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(index);
        else grid.set(key, [index]);
      }
    }
  });

  const pairs: FacilityOverlapPair[] = [];
  const seen = new Set<string>();
  facilities.forEach((a, indexA) => {
    const boxA = boxes.get(a.id)!;
    const candidates = new Set<number>();
    const x0 = Math.floor(boxA.minX / CELL_M);
    const x1 = Math.floor(boxA.maxX / CELL_M);
    const y0 = Math.floor(boxA.minY / CELL_M);
    const y1 = Math.floor(boxA.maxY / CELL_M);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (const candidate of grid.get(`${x}:${y}`) ?? []) candidates.add(candidate);
      }
    }
    for (const indexB of candidates) {
      if (indexB <= indexA) continue;
      const b = facilities[indexB]!;
      const key = `${a.id}:${b.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const boxB = boxes.get(b.id)!;
      if (boxA.maxX < boxB.minX || boxB.maxX < boxA.minX || boxA.maxY < boxB.minY || boxB.maxY < boxA.minY) continue;
      if (mayStackFacilities(a, b)) continue;
      // 贴边不算重叠：把其中一件每边缩 tolerance 后再算交集；缩完就没了交集的直接跳过。
      const shrunk = shrinkRing(a, toleranceM);
      if (!shrunk) continue;
      // 用缩过的环做面积比，避免 5 cm 级别的误差把比例抬到阈值上。
      const shrunkArea = ringArea(shrunk);
      if (shrunkArea <= 0) continue;
      const ratio = footprintOverlapArea(shrunk, rings.get(b.id)!) / Math.min(shrunkArea, ringArea(rings.get(b.id)!));
      if (!Number.isFinite(ratio) || ratio < PLAN_FACILITY_OVERLAP_MIN_RATIO) continue;
      pairs.push({
        a,
        b,
        at: { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 },
        ratio,
        nearDuplicate: ratio >= duplicateRatio,
      });
    }
  });
  return pairs;
}
