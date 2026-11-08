/**
 * 第 12 批「能摆 → 会摆」动线约束纯函数层。
 *
 * 设计红线（见 scoring-flow-spec.md §flow-constraints）：
 * - 纯函数、不可变，不接 React、不读 layoutStore；
 * - 坐标与 ZoneFurniturePlacement 一致（米制、房间中心为原点；x 向右、z 向下）；
 * - 未提供真实通道与使用者轮廓时，不推断通行结论；
 * - 仅在签到区一侧存在家具时提供局部几何间距估算。
 */

import type { PlanAnnotation } from './plan-annotation';
import type { ZoneFurniturePlacement } from './plan-approve';
import type { ScoredViolation } from './human-factors';

/** 历史设计参考数值；不单独构成通行或规范结论。 */
export const AISLE_MIN_NORMAL = 1.2;
export const AISLE_MIN_WHEELCHAIR = 1.5;

/** 横向条带在签到区 x0 / x1 外的扩展余量（米）。 */
const AISLE_X_MARGIN = 0.3;
/** 浮点比较容差（米）。 */
const EPS = 1e-6;

export interface FlowEvaluation {
  /** 签到区 z 较小一侧与附近家具的估算间距，不是通道净宽；没有足够数据为 null。 */
  aisleWidthM: number | null;
  /** 局部间距不能判断轮椅、行人或真实入口是否通过。 */
  wheelChairPassable: null;
  normalPassable: null;
  checkinBlocked: null;
  /** 未获取真实路径、入口、转弯和规范适用事实时始终未知。 */
  status: 'unknown';
  /** 待核对提示；空数组也不代表通行通过。 */
  violations: string[];
}

/**
 * 签到区一侧的局部估算；旋转家具使用轴对齐包围盒。该侧不一定是实际进入方向，
 * 未覆盖门、墙、行进路线、转弯和轮椅实体，不代表通行或合规结论。
 */
export function evaluateFlow(
  placements: readonly ZoneFurniturePlacement[],
  zones: readonly PlanAnnotation[],
): FlowEvaluation {
  const checkinZones = zones.filter(
    (a) => a.kind === 'zone' && a.zoneType === 'checkin' && a.geometry.kind === 'rect',
  );

  // 对每个签到区一侧扫描候选家具，不推断入口在此侧。
  let minClearance = Infinity;

  for (const zone of checkinZones) {
    const g = zone.geometry;
    if (g.kind !== 'rect') continue;
    const bandL = g.x - AISLE_X_MARGIN;
    const bandR = g.x + g.width + AISLE_X_MARGIN;
    const z0 = g.z;

    for (const p of placements) {
      if (![p.x, p.z, p.rotation, p.spec.width, p.spec.depth].every(Number.isFinite)
          || p.spec.width <= 0 || p.spec.depth <= 0) continue;
      const cos = Math.abs(Math.cos(p.rotation));
      const sin = Math.abs(Math.sin(p.rotation));
      const halfWidth = (p.spec.width * cos + p.spec.depth * sin) / 2;
      const halfDepth = (p.spec.width * sin + p.spec.depth * cos) / 2;
      if (p.x + halfWidth < bandL - EPS || p.x - halfWidth > bandR + EPS) continue;
      if (p.z - halfDepth >= z0 - EPS) continue;
      const zRear = p.z + halfDepth;
      const clearance = z0 - zRear;
      if (clearance < minClearance - EPS) {
        minClearance = clearance;
      }
    }
  }

  const aisleWidthM = Number.isFinite(minClearance) ? Math.max(0, minClearance) : null;
  const violations = aisleWidthM === null ? [] : [
    `签到区一侧与附近家具的估算间距 ${aisleWidthM.toFixed(1)}m；实际进入方向和通行条件需核对。`,
  ];

  return {
    aisleWidthM,
    wheelChairPassable: null,
    normalPassable: null,
    checkinBlocked: null,
    status: 'unknown',
    violations,
  };
}

/* ---------- SC-19 §五.4 / SC-20 输入侧：必留区与必留通道（硬约束） ---------- */

/**
 * 必留通道（route 折线）两侧各要求的最小净空（米），总净宽 1.2m。
 * 是本次路线检查使用的固定宽度，并非消防或无障碍合规结论。
 */
export const ROUTE_CORRIDOR_WIDTH_M = 1.2;
/**
 * 侵入判定容差（米）：量级与 plan-scoring.BBOX_OVERLAP_TOLERANCE_M 对齐
 * （不直接 import 那边，避免 plan-scoring → human-factors → plan-scoring 环）。
 * 方向取宽容：家具压进必留区/通道**超过**容差才判违规——贴线与 2cm 内的
 * 舍入噪声不判（G7 教训：边界噪声错杀整版，比漏掉 2cm 侵入更伤）。
 */
const INTRUSION_TOLERANCE_M = 0.02;

/** Conservative axis-aligned bounds of the rotated furniture footprint. */
function placementBounds(p: ZoneFurniturePlacement) {
  const c = Math.abs(Math.cos(p.rotation));
  const s = Math.abs(Math.sin(p.rotation));
  const halfWidth = (p.spec.width * c + p.spec.depth * s) / 2;
  const halfDepth = (p.spec.width * s + p.spec.depth * c) / 2;
  return { x1: p.x - halfWidth, z1: p.z - halfDepth, x2: p.x + halfWidth, z2: p.z + halfDepth };
}

function validPlacement(p: ZoneFurniturePlacement): boolean {
  return [p.x, p.z, p.rotation, p.spec.width, p.spec.depth].every(Number.isFinite)
    && p.spec.width > 0 && p.spec.depth > 0;
}

function axisAlignedPlacement(p: ZoneFurniturePlacement): boolean {
  return Math.abs(Math.sin(p.rotation)) < EPS || Math.abs(Math.cos(p.rotation)) < EPS;
}

/**
 * 必留区（reserved，预留区/消防疏散）侵入检查：
 * 生成层对 reserved 区不摆任何家具（planZones），这里负责把**别区**家具
 * 压进必留区的方案判成 hard violation——压通道的方案不进推荐（SC-20 口径）。
 * 判定取宽容方向：把必留区内缩 INTRUSION_TOLERANCE_M 出「核心」，家具压进
 * 核心才算侵入——贴线/1cm 级舍入噪声不判（G7 教训：边界噪声错杀整版更伤）。
 * 每个 keep-out 区聚合一条 violation（点名家具与件数），避免 24 把椅子刷 24 条。
 */
export function evaluateKeepOut(
  placements: readonly ZoneFurniturePlacement[],
  zones: readonly PlanAnnotation[],
): ScoredViolation[] {
  const out: ScoredViolation[] = [];
  for (const zone of zones) {
    if (zone.kind !== 'zone' || zone.zoneType !== 'reserved') continue;
    const g = zone.geometry;
    if (g.kind !== 'rect') continue;
    // 核心区 = 必留区四边各内缩容差；家具 footprint 与核心相交才算压住。
    const coreX1 = g.x + INTRUSION_TOLERANCE_M;
    const coreX2 = g.x + g.width - INTRUSION_TOLERANCE_M;
    const coreZ1 = g.z + INTRUSION_TOLERANCE_M;
    const coreZ2 = g.z + g.depth - INTRUSION_TOLERANCE_M;
    const offenders = new Map<string, number>();
    let total = 0;
    let uncertain = 0;
    for (const p of placements) {
      if (!validPlacement(p)) { uncertain += 1; continue; }
      const { x1, x2, z1, z2 } = placementBounds(p);
      if (x1 < coreX2 - EPS && coreX1 < x2 - EPS && z1 < coreZ2 - EPS && coreZ1 < z2 - EPS) {
        if (!axisAlignedPlacement(p)) { uncertain += 1; continue; }
        offenders.set(p.spec.name, (offenders.get(p.spec.name) ?? 0) + 1);
        total += 1;
      }
    }
    if (total > 0) {
      const names = [...offenders.entries()].map(([n, c]) => `${n}×${c}`).join('、');
      out.push({ code: 'KEEP_OUT_INTRUDED', severity: 'hard', zoneId: zone.id,
        message: `「${zone.label}」是必留区，不能摆东西——被 ${total} 件家具占住（${names}）` });
    }
    if (uncertain > 0) out.push({ code: 'KEEP_OUT_INTRUDED', severity: 'soft', status: 'unknown', zoneId: zone.id,
      message: `「${zone.label}」附近有 ${uncertain} 件家具的位置或旋转占地需核对，必留区结果未确认。` });
  }
  return out;
}

/**
 * 必留通道（route 折线，宾客动线/消防疏散）压线检查：
 * 折线按 ROUTE_CORRIDOR_WIDTH_M 展宽成走廊，家具 footprint 到任一线段的
 * 距离 < 半宽 − 容差 → 压通道（hard）。压通道的方案不进推荐（SC-20 口径）。
 * 注意：动线终点要停在区外——伸进签到台/桌椅堆里的最后一段按压通道算。
 */
export function evaluateRouteClear(
  placements: readonly ZoneFurniturePlacement[],
  routes: readonly PlanAnnotation[],
): ScoredViolation[] {
  const out: ScoredViolation[] = [];
  const half = ROUTE_CORRIDOR_WIDTH_M / 2;
  const limit = half - INTRUSION_TOLERANCE_M;
  for (const route of routes) {
    if (route.kind !== 'route' || route.geometry.kind !== 'polyline') continue;
    const pts = route.geometry.points;
    if (pts.length < 2) continue;
    const offenders = new Map<string, number>();
    let total = 0;
    let uncertain = 0;
    for (const p of placements) {
      if (!validPlacement(p)) { uncertain += 1; continue; }
      const rect = placementBounds(p);
      let hit = false;
      for (let i = 0; i + 1 < pts.length && !hit; i++) {
        if (segmentRectDistance(pts[i]!, pts[i + 1]!, rect) < limit) hit = true;
      }
      if (hit) {
        if (!axisAlignedPlacement(p)) { uncertain += 1; continue; }
        offenders.set(p.spec.name, (offenders.get(p.spec.name) ?? 0) + 1);
        total += 1;
      }
    }
    if (total > 0) {
      const names = [...offenders.entries()].map(([n, c]) => `${n}×${c}`).join('、');
      out.push({ code: 'ROUTE_BLOCKED', severity: 'hard', zoneId: route.id,
        message: `「${route.label}」动线按 ${ROUTE_CORRIDOR_WIDTH_M}m 净空检查——被 ${total} 件家具压住（${names}）` });
    }
    if (uncertain > 0) out.push({ code: 'ROUTE_BLOCKED', severity: 'soft', status: 'unknown', zoneId: route.id,
      message: `「${route.label}」附近有 ${uncertain} 件家具的位置或旋转占地需核对，路线净空未确认。` });
  }
  return out;
}

/** 线段到轴对齐矩形的最短距离（米）；相交或接触返回 0。 */
function segmentRectDistance(
  a: { x: number; z: number },
  b: { x: number; z: number },
  rect: { x1: number; z1: number; x2: number; z2: number },
): number {
  // 1) Liang-Barsky slab test：线段与矩形相交（含端点在矩形内）→ 0。
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let t0 = 0;
  let t1 = 1;
  let intersect = true;
  const p = [-dx, dx, -dz, dz];
  const q = [a.x - rect.x1, rect.x2 - a.x, a.z - rect.z1, rect.z2 - a.z];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]!) < EPS) {
      if (q[i]! < 0) {
        intersect = false;
        break;
      }
    } else {
      const r = q[i]! / p[i]!;
      if (p[i]! < 0) {
        if (r > t1) { intersect = false; break; }
        if (r > t0) t0 = r;
      } else {
        if (r < t0) { intersect = false; break; }
        if (r < t1) t1 = r;
      }
    }
  }
  if (intersect && t0 <= t1 + EPS) return 0;
  // 2) 不相交：最近距离只会出现在「线段端点→矩形」或「矩形角→线段」。
  let min = Infinity;
  for (const [px, pz] of [[a.x, a.z], [b.x, b.z]] as const) {
    const cx = Math.min(Math.max(px, rect.x1), rect.x2);
    const cz = Math.min(Math.max(pz, rect.z1), rect.z2);
    min = Math.min(min, Math.hypot(px - cx, pz - cz));
  }
  const corners: Array<[number, number]> = [
    [rect.x1, rect.z1], [rect.x2, rect.z1], [rect.x1, rect.z2], [rect.x2, rect.z2],
  ];
  for (const [cx, cz] of corners) {
    min = Math.min(min, pointSegmentDistance(cx, cz, a, b));
  }
  return min;
}

/** 点到线段的最短距离（米）。 */
function pointSegmentDistance(
  px: number,
  pz: number,
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq <= EPS) return Math.hypot(px - a.x, pz - a.z);
  let t = ((px - a.x) * dx + (pz - a.z) * dz) / lenSq;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (a.x + t * dx), pz - (a.z + t * dz));
}

/* ---------- P0：走廊连通 + zone 可达性（0.3m 网格 BFS） ---------- */

/** 网格边长（米）。 */
export const REACH_CELL = 0.3;
/** 网格预算耗尽时保留未知，避免大场地冻结页面。 */
export const REACH_MAX_CELLS = 1_000_000;

export interface ReachabilityResult {
  /** 从场地边界采样格可触达的 zone，不代表真实出口可达。 */
  reachableZones: string[];
  /** 未从边界采样格触达的 zone，仍需人工核对。 */
  unreachableZones: string[];
  /** 网格结果仅作待核验提示。 */
  violations: ScoredViolation[];
  /** 固定三对 zone 之间的连通性（签到→圆桌、圆桌→休息、打卡→休息）。 */
  pairReachability: Array<{ from: string; to: string; connected: boolean }>;
  /** zone 入口边（z0 边）被家具 footprint 覆盖率 ≥50% 的列表。 */
  blockedBy: Array<{
    zoneId: string;
    blockedFurnitureIds: string[];
    coverageRatio: number;
  }>;
}

/**
 * 固定要测的三对 zone（按 zoneType 匹配，不是 zoneId）。
 * 顺序固定，UI/测试都依赖这个顺序。
 */
const PAIR_CHECKS: ReadonlyArray<{ from: 'checkin' | 'roundtable' | 'photo'; to: 'roundtable' | 'rest' }> = [
  { from: 'checkin', to: 'roundtable' },
  { from: 'roundtable', to: 'rest' },
  { from: 'photo', to: 'rest' },
];

/** 采样边覆盖比例的提示阈值；该边不一定是真实进入方向。 */
const ENTRANCE_BLOCKED_RATIO = 0.5;

/**
 * 走廊连通 + zone 可达性评估（对齐 Co-Layout research-b）。
 *
 * 做法：
 * 1. 按 roomSize 铺 0.3m 网格；家具 footprint 覆盖的格子 = blocked；
 * 2. 从所有场地边缘空格出发 BFS；边缘不等于真实出口，不能据此判断疏散。
 * 3. 每个 zone rect（内缩 0.15m）至少要有一个格子在可达集合里，否则 = 被围死。
 *
 * 不传 roomSize 时退化为空结果（向后兼容，不参与打分）。
 */
export function evaluateReachability(
  placements: readonly ZoneFurniturePlacement[],
  zones: readonly PlanAnnotation[],
  roomSize: { width: number; height: number } | undefined,
): ReachabilityResult {
  const empty: ReachabilityResult = {
    reachableZones: [],
    unreachableZones: [],
    violations: [],
    pairReachability: [],
    blockedBy: [],
  };
  if (!roomSize || !Number.isFinite(roomSize.width) || !Number.isFinite(roomSize.height) || roomSize.width <= 0 || roomSize.height <= 0) {
    return empty;
  }

  const cols = Math.max(2, Math.ceil(roomSize.width / REACH_CELL));
  const rows = Math.max(2, Math.ceil(roomSize.height / REACH_CELL));
  if (cols > REACH_MAX_CELLS || rows > REACH_MAX_CELLS || cols > Math.floor(REACH_MAX_CELLS / rows)) {
    return { ...empty, violations: [{ code: 'FLOW_ANALYSIS_LIMIT', severity: 'soft', status: 'unknown',
      message: '场地超出本次网格检查范围，通行条件尚未核验。' }] };
  }
  const blocked = new Uint8Array(cols * rows);

  const idx = (cx: number, cz: number) => cz * cols + cx;

  // 家具 footprint 铺进 blocked
  for (const p of placements) {
    const x1 = p.x - p.spec.width / 2;
    const x2 = p.x + p.spec.width / 2;
    const z1 = p.z - p.spec.depth / 2;
    const z2 = p.z + p.spec.depth / 2;
    const c0 = Math.floor((x1 + roomSize.width / 2) / REACH_CELL);
    const c1 = Math.floor((x2 + roomSize.width / 2) / REACH_CELL);
    const r0 = Math.floor((z1 + roomSize.height / 2) / REACH_CELL);
    const r1 = Math.floor((z2 + roomSize.height / 2) / REACH_CELL);
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        blocked[idx(c, r)] = 1;
      }
    }
  }

  // BFS 从边缘 walkable 格出发
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [];
  const pushBorder = (c: number, r: number) => {
    if (c < 0 || c >= cols || r < 0 || r >= rows) return;
    if (blocked[idx(c, r)] || seen[idx(c, r)]) return;
    seen[idx(c, r)] = 1;
    queue.push(idx(c, r));
  };
  for (let c = 0; c < cols; c++) {
    pushBorder(c, 0);
    pushBorder(c, rows - 1);
  }
  for (let r = 0; r < rows; r++) {
    pushBorder(0, r);
    pushBorder(cols - 1, r);
  }
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const cc = cur % cols;
    const cr = Math.floor(cur / cols);
    pushBorder(cc - 1, cr);
    pushBorder(cc + 1, cr);
    pushBorder(cc, cr - 1);
    pushBorder(cc, cr + 1);
  }

  // 每个 zone 检查
  const rects = zones.filter(
    (a): a is PlanAnnotation & { geometry: { kind: 'rect'; x: number; z: number; width: number; depth: number } } =>
      a.kind === 'zone' && a.geometry.kind === 'rect',
  );
  const reachableZones: string[] = [];
  const unreachableZones: string[] = [];
  const violations: ScoredViolation[] = [];
  for (const zone of rects) {
    const g = zone.geometry;
    const inset = REACH_CELL / 2;
    const c0 = Math.floor((g.x + inset + roomSize.width / 2) / REACH_CELL);
    const c1 = Math.floor((g.x + g.width - inset + roomSize.width / 2) / REACH_CELL);
    const r0 = Math.floor((g.z + inset + roomSize.height / 2) / REACH_CELL);
    const r1 = Math.floor((g.z + g.depth - inset + roomSize.height / 2) / REACH_CELL);
    let touched = false;
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1) && !touched; r++) {
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        if (seen[idx(c, r)]) {
          touched = true;
          break;
        }
      }
    }
    if (touched) {
      reachableZones.push(zone.id);
    } else {
      unreachableZones.push(zone.id);
      violations.push({
        code: 'ZONE_UNREACHABLE',
        severity: 'soft',
        status: 'unknown',
        zoneId: zone.id,
        message: `简化网格未找到场地边缘通往「${zone.label}」的路径；请核对真实入口与通行空间。`,
      });
    }
  }

  /* ---------- P1：固定三对 zone 连通性 BFS ---------- */
  // 取每类 zoneType 的「代表 zone」（按出现顺序第一个）。
  const zoneByType = new Map<string, (typeof rects)[number]>();
  for (const zone of rects) {
    const t = zone.zoneType;
    if (t && !zoneByType.has(t)) zoneByType.set(t, zone);
  }

  // zone 入口点：z0 边中点再往 z 负方向退半格（站在入口外的走廊上）。
  const entryCellOf = (
    zone: (typeof rects)[number],
  ): { c: number; r: number } | null => {
    const g = zone.geometry;
    const ex = g.x + g.width / 2;
    const ez = g.z - REACH_CELL / 2;
    const c = Math.floor((ex + roomSize.width / 2) / REACH_CELL);
    const r = Math.floor((ez + roomSize.height / 2) / REACH_CELL);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return { c, r };
  };

  // 从 (startC, startR) 出发 4 邻域 BFS，目标格 visited 即连通。
  const bfsConnected = (sc: number, sr: number, tc: number, tr: number): boolean => {
    if (blocked[idx(sc, sr)] || blocked[idx(tc, tr)]) return false;
    const vis = new Uint8Array(cols * rows);
    const q: number[] = [];
    vis[idx(sc, sr)] = 1;
    q.push(idx(sc, sr));
    while (q.length > 0) {
      const cur = q.pop()!;
      const cc = cur % cols;
      const cr = Math.floor(cur / cols);
      if (cc === tc && cr === tr) return true;
      const nb: Array<[number, number]> = [[cc - 1, cr], [cc + 1, cr], [cc, cr - 1], [cc, cr + 1]];
      for (const [nc, nr] of nb) {
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        if (blocked[idx(nc, nr)] || vis[idx(nc, nr)]) continue;
        vis[idx(nc, nr)] = 1;
        q.push(idx(nc, nr));
      }
    }
    return vis[idx(tc, tr)] === 1;
  };

  const pairReachability: ReachabilityResult['pairReachability'] = [];
  for (const pair of PAIR_CHECKS) {
    const fromZone = zoneByType.get(pair.from);
    const toZone = zoneByType.get(pair.to);
    if (!fromZone || !toZone) continue; // 任一类缺失 → 跳过该对
    const fromCell = entryCellOf(fromZone);
    const toCell = entryCellOf(toZone);
    if (!fromCell || !toCell) continue;
    const connected = bfsConnected(fromCell.c, fromCell.r, toCell.c, toCell.r);
    pairReachability.push({ from: fromZone.id, to: toZone.id, connected });
    if (!connected) {
      violations.push({
        code: 'ZONE_PAIR_DISCONNECTED',
        severity: 'soft',
        status: 'unknown',
        message: `简化网格未连通「${fromZone.label}」与「${toZone.label}」的采样点，请核对实际路径。`,
      });
    }
  }

  /* ---------- P1：zone 入口边被家具 footprint 覆盖 ---------- */
  // 每件家具一个稳定 id（placement 本身无 id）。
  const furnId = (p: ZoneFurniturePlacement, i: number): string =>
    `${p.zoneId}@${p.x.toFixed(2)},${p.z.toFixed(2)}#${i}`;

  const blockedBy: ReachabilityResult['blockedBy'] = [];
  for (const zone of rects) {
    const g = zone.geometry;
    const covered: Array<{ id: string; len: number }> = [];
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i]!;
      const fx1 = p.x - p.spec.width / 2;
      const fx2 = p.x + p.spec.width / 2;
      const fz1 = p.z - p.spec.depth / 2;
      const fz2 = p.z + p.spec.depth / 2;
      // z0 边（水平线 z=g.z）穿过家具 footprint？
      if (fz1 > g.z + EPS || fz2 < g.z - EPS) continue;
      const ix1 = Math.max(g.x, fx1);
      const ix2 = Math.min(g.x + g.width, fx2);
      const len = Math.max(0, ix2 - ix1);
      if (len <= EPS) continue;
      covered.push({ id: furnId(p, i), len });
    }
    if (g.width <= EPS) continue;
    // 合并重叠段（按 id 累加，但同一件家具的 id 唯一，直接 sum len 即可）。
    const total = covered.reduce((s, c) => s + c.len, 0);
    const ratio = total / g.width;
    if (ratio < ENTRANCE_BLOCKED_RATIO - EPS) continue;
    blockedBy.push({
      zoneId: zone.id,
      blockedFurnitureIds: covered.map((c) => c.id),
      coverageRatio: ratio,
    });
    violations.push({
      code: 'ZONE_ENTRANCE_BLOCKED',
      severity: 'soft',
      status: 'unknown',
      zoneId: zone.id,
      message: `「${zone.label}」一侧被 ${covered.length} 件家具覆盖较多，请核对实际进入方向。`,
    });
  }

  return { reachableZones, unreachableZones, violations, pairReachability, blockedBy };
}
