/**
 * 第 12 批「能摆 → 会摆」动线约束纯函数层。
 *
 * 设计红线（见 scoring-flow-spec.md §flow-constraints）：
 * - 纯函数、不可变，不接 React、不读 layoutStore；
 * - 坐标与 ZoneFurniturePlacement 一致（米制、房间中心为原点；x 向右、z 向下）；
 * - 只约束「入口 → 签到区」这一条主通道：宾客从 z 负方向走来，
 *   签到区 z0 边（z 较小那侧）是入口基准；
 * - 没有签到区时不约束（aisleWidthM=Infinity、violations=[]）。
 */

import type { PlanAnnotation } from './plan-annotation';
import type { ZoneFurniturePlacement } from './plan-approve';
import type { ScoredViolation } from './human-factors';

/** 主通道最低净宽（米）：普通通过。 */
export const AISLE_MIN_NORMAL = 1.2;
/** 主通道最低净宽（米）：轮椅友好。 */
export const AISLE_MIN_WHEELCHAIR = 1.5;

/** 净空小于此值视为「贴脸堵」（米）。 */
const BLOCKED_EPSILON = 0.5;
/** 横向条带在签到区 x0 / x1 外的扩展余量（米）。 */
const AISLE_X_MARGIN = 0.3;
/** 浮点比较容差（米）。 */
const EPS = 1e-6;
/**
 * 无签到区时的默认宽敞通道（米）。
 * 当既无签到区也无 placements 时，主通道不被任何家具约束，给一个保守的宽敞估值，
 * 让 UI 不再显示 Infinity；这个数字不会触发任何 violation。
 */
const DEFAULT_AISLE_WHEN_EMPTY = 3.0;

export interface FlowEvaluation {
  /** 签到区入口侧（z0 边外）到最近家具/zone 家具投影的净空，米；没有签到区时返回 Infinity。 */
  aisleWidthM: number;
  /** aisleWidthM >= AISLE_MIN_WHEELCHAIR。 */
  wheelChairPassable: boolean;
  /** aisleWidthM >= AISLE_MIN_NORMAL。 */
  normalPassable: boolean;
  /** 签到区入口侧是否被任何家具（zone 内或 zone 外）堵上：从 z0 边往 z 负方向扫，遇到第一件家具即算堵。 */
  checkinBlocked: boolean;
  /** 全部人话违规原因（用于打分扣分项 + UI 回执），空数组表示通过。 */
  violations: string[];
}

/**
 * 评估一批 placements 相对 zone 标注的动线合规度。
 *
 * 算法：
 * 1. 从 zones 里挑出 kind==='zone' && zoneType==='checkin' && geometry.kind==='rect' 的签到区；
 *    没有 → 不约束（返回 Infinity / 全过）。
 * 2. 对每个签到区 z0 边：横向条带 = [x0-0.3, x0+w+0.3]；
 *    筛 placements 中「x 中心落在条带内 且 z 中心 < z0」的家具。
 * 3. 每件候选的「后缘 z」= z + depth/2；净空 = z0 - 后缘；
 *    取所有签到区、所有候选里最小的净空作为整体 aisleWidthM（找不到 = Infinity）。
 * 4. checkinBlocked = aisleWidthM < 0.5（贴脸）。
 * 5. violations：
 *    - 净空 < 1.2m → `签到台前通道只剩 X.Xm，轮椅过不去`（normal 不过）
 *    - 1.2m ≤ 净空 < 1.5m → `签到台前通道 X.Xm，轮椅过不去，但行人能过`
 *    - checkinBlocked → `签到区入口被家具贴脸堵住`
 */
export function evaluateFlow(
  placements: readonly ZoneFurniturePlacement[],
  zones: readonly PlanAnnotation[],
): FlowEvaluation {
  const checkinZones = zones.filter(
    (a) => a.kind === 'zone' && a.zoneType === 'checkin' && a.geometry.kind === 'rect',
  );

  if (checkinZones.length === 0) {
    // 无签到区：不写硬约束，但返回有限的「主通道估算余量」让 UI 能显示一个数字。
    // - 无 placements → 默认宽敞 3.0m；
    // - 有 placements → 扫所有家具两两之间的最大正向间隙（轴对齐矩形表面距离），
    //   作为最可能走人那条通道的宽度估算；所有 pair 都贴住时回落到 0.5m。
    const estimated = estimateMainAisleFromPlacements(placements);
    return {
      aisleWidthM: estimated,
      wheelChairPassable: estimated >= AISLE_MIN_WHEELCHAIR - EPS,
      normalPassable: estimated >= AISLE_MIN_NORMAL - EPS,
      checkinBlocked: false,
      violations: [],
    };
  }

  // 对每个签到区扫一遍候选家具，取最小净空（最堵的那条）。
  let minClearance = Infinity;

  for (const zone of checkinZones) {
    const g = zone.geometry;
    if (g.kind !== 'rect') continue;
    const bandL = g.x - AISLE_X_MARGIN;
    const bandR = g.x + g.width + AISLE_X_MARGIN;
    const z0 = g.z;

    for (const p of placements) {
      // 横向条带：x 中心落在哪
      if (p.x < bandL - EPS || p.x > bandR + EPS) continue;
      // 只看入口侧（z 中心 < z0）
      if (p.z >= z0 - EPS) continue;
      const zRear = p.z + p.spec.depth / 2;
      const clearance = z0 - zRear;
      if (clearance < minClearance - EPS) {
        minClearance = clearance;
      }
    }
  }

  const aisleWidthM = minClearance;
  const wheelChairPassable = aisleWidthM >= AISLE_MIN_WHEELCHAIR - EPS;
  const normalPassable = aisleWidthM >= AISLE_MIN_NORMAL - EPS;
  const checkinBlocked = aisleWidthM < BLOCKED_EPSILON - EPS;

  const violations: string[] = [];
  if (aisleWidthM < AISLE_MIN_NORMAL - EPS) {
    violations.push(`签到台前通道只剩 ${aisleWidthM.toFixed(1)}m，轮椅过不去`);
  } else if (aisleWidthM < AISLE_MIN_WHEELCHAIR - EPS) {
    violations.push(`签到台前通道 ${aisleWidthM.toFixed(1)}m，轮椅过不去，但行人能过`);
  }
  if (checkinBlocked) {
    violations.push('签到区入口被家具贴脸堵住');
  }

  return {
    aisleWidthM,
    wheelChairPassable,
    normalPassable,
    checkinBlocked,
    violations,
  };
}

/**
 * 无签到区时的主通道估算余量：扫所有家具两两之间的最大正间隙（轴对齐矩形表面距离）。
 * 这只是一个粗估，不参与硬约束，violations 始终为空。
 * - placements 不足 2 件 → 默认宽敞 3.0m；
 * - 所有 pair 都贴住/重叠 → 回落到 0.5m（贴脸档）；
 * - 否则返回最宽的那条可走人间隙。
 */
function estimateMainAisleFromPlacements(
  placements: readonly ZoneFurniturePlacement[],
): number {
  if (placements.length < 2) return DEFAULT_AISLE_WHEN_EMPTY;
  let maxGap = 0;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!;
      const b = placements[j]!;
      const gap = rectSurfaceGap(a, b);
      if (gap > maxGap) maxGap = gap;
    }
  }
  if (maxGap <= EPS) return BLOCKED_EPSILON;
  return maxGap;
}

/** 两件轴对齐矩形家具之间的表面距离（米）；相交或接触返回 0。 */
function rectSurfaceGap(
  a: ZoneFurniturePlacement,
  b: ZoneFurniturePlacement,
): number {
  const ax1 = a.x - a.spec.width / 2;
  const ax2 = a.x + a.spec.width / 2;
  const az1 = a.z - a.spec.depth / 2;
  const az2 = a.z + a.spec.depth / 2;
  const bx1 = b.x - b.spec.width / 2;
  const bx2 = b.x + b.spec.width / 2;
  const bz1 = b.z - b.spec.depth / 2;
  const bz2 = b.z + b.spec.depth / 2;

  const xOverlap = Math.min(ax2, bx2) - Math.max(ax1, bx1);
  const zOverlap = Math.min(az2, bz2) - Math.max(az1, bz1);

  if (xOverlap > EPS && zOverlap > EPS) return 0; // 相交
  if (xOverlap > EPS) return Math.max(0, Math.max(az1, bz1) - Math.min(az2, bz2));
  if (zOverlap > EPS) return Math.max(0, Math.max(ax1, bx1) - Math.min(ax2, bx2));
  // 对角：用欧氏距离近似（保守）
  const dx = Math.max(0, Math.max(ax1, bx1) - Math.min(ax2, bx2));
  const dz = Math.max(0, Math.max(az1, bz1) - Math.min(az2, bz2));
  return Math.hypot(dx, dz);
}

/* ---------- P0：走廊连通 + zone 可达性（0.3m 网格 BFS） ---------- */

/** 网格边长（米）。 */
export const REACH_CELL = 0.3;

export interface ReachabilityResult {
  /** 可达的 zone id 列表（诊断用）。 */
  reachableZones: string[];
  /** 不可达的 zone id 列表（家具围死）。 */
  unreachableZones: string[];
  /** 不可达转换为标准 violation（severity=hard，供 plan-scoring 扣分）。 */
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

/** zone 入口边被家具覆盖多少比例以上 → 视为堵门。 */
const ENTRANCE_BLOCKED_RATIO = 0.5;

/**
 * 走廊连通 + zone 可达性评估（对齐 Co-Layout research-b）。
 *
 * 做法：
 * 1. 按 roomSize 铺 0.3m 网格；家具 footprint 覆盖的格子 = blocked；
 * 2. 从所有「在场地边缘上的 walkable 格子」出发 BFS，得到能从出口走进来的格子集合；
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
  if (!roomSize || !Number.isFinite(roomSize.width) || !Number.isFinite(roomSize.height)) {
    return empty;
  }

  const cols = Math.max(2, Math.ceil(roomSize.width / REACH_CELL));
  const rows = Math.max(2, Math.ceil(roomSize.height / REACH_CELL));
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
        severity: 'hard',
        zoneId: zone.id,
        message: `「${zone.label}」被桌椅围死，人走不过去`,
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
        severity: 'hard',
        message: `「${fromZone.label}」走到不了「${toZone.label}」`,
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
      severity: 'hard',
      zoneId: zone.id,
      message: `「${zone.label}」入口被 ${covered.length} 件家具堵了一半`,
    });
  }

  return { reachableZones, unreachableZones, violations, pairReachability, blockedBy };
}

/* ---------- 4.1：隐私区前后排软约束 ---------- */

/**
 * 隐私区前后排顺序（soft，不扣分只进 reasons）：
 * - 签到区应在前排（zone 中心 z > 0，靠近入场门）；
 * - 圆桌区居中（不强制）；
 * - 休息区应在后排（zone 中心 z < 0，远离门）。
 *
 * 违反人话：
 * - 休息区 centerZ > 0（跑到前排）→「休息区离门太近，建议往深处挪」
 * - 签到区 centerZ < 0（跑到后排）→「签到区离门太远，建议往前排挪」
 *
 * roomSize 参数保留为 API 一致性（当前判定只用 zone 中心 z 相对 0）；未传 roomSize 时仍按 z=0 判定。
 */
export function evaluatePrivacyOrder(
  zones: readonly PlanAnnotation[],
  _roomSize: { width: number; height: number } | undefined,
): ScoredViolation[] {
  const out: ScoredViolation[] = [];
  for (const z of zones) {
    if (z.kind !== 'zone' || z.geometry.kind !== 'rect') continue;
    const g = z.geometry;
    const centerZ = g.z + g.depth / 2;
    if (z.zoneType === 'rest' && centerZ > 0) {
      out.push({
        code: 'PRIVACY_ORDER',
        severity: 'soft',
        zoneId: z.id,
        message: '休息区离门太近，建议往深处挪',
      });
    }
    if (z.zoneType === 'checkin' && centerZ < 0) {
      out.push({
        code: 'PRIVACY_ORDER',
        severity: 'soft',
        zoneId: z.id,
        message: '签到区离门太远，建议往前排挪',
      });
    }
  }
  return out;
}
