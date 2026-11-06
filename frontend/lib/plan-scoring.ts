/**
 * 第 12 批「能摆 → 会摆」多方案打分纯函数层。
 *
 * 设计红线：
 * - 纯函数、不可变、不接 React、不读 layoutStore；
 * - 对同一批 zone 标注跑三档密度（松/适中/密），每版独立打分；
 * - 打分公式：capacitySeats - 2*skipped.length - 3*outOfBounds + flowPenalty - overlapPenalty；
 * - 三版必须真拉开：sparse 主动删一桌、dense 通道修正、reasons 每版差异化；
 * - 不引新依赖；UI 文案中文简体，禁「高斯/WorldGen」。
 */

import type { PlanAnnotation } from './plan-annotation';
import { withDefaultDoor } from './plan-annotation';
import {
  planZones,
  applyWallClearance,
  type ZoneFurniturePlacement,
  type ZonePlanSkipped,
} from './plan-approve';
import { evaluateFlow, evaluateReachability, type FlowEvaluation } from './flow-constraints';
import { evaluateHumanFactors, evaluateDoorSweep, evaluatePrivacyOrder, type ScoredViolation } from './human-factors';

/** 三档密度旋钮。 */
export type PlanVariantId = 'sparse' | 'balanced' | 'dense';

/** 场地尺寸（米制、房间中心为原点；width=x 方向全宽、height=z 方向全深）。 */
export interface RoomSize {
  width: number;
  height: number;
}

/** generateScoredPlans 的可选开关。 */
export interface ScoringOptions {
  /** 场地尺寸；提供后越界判定会把「落到场地外」的件数计入 outOfBounds。 */
  roomSize?: RoomSize;
}

export interface ScoredPlan {
  variantId: PlanVariantId;
  /** UI 显示的中文短名。 */
  label: string;
  /** 实际喂给 planZones 的密度旋钮值。 */
  density: number;
  placements: ZoneFurniturePlacement[];
  skipped: ZonePlanSkipped[];
  /** 容量：可坐座位/工位件数。餐椅/工作椅各 +1，长椅每张 +2。 */
  capacitySeats: number;
  /** 越界件数：placement 中心落在来源 zone rect 外扩 0.05m 或 [±room/2] 外的件数。 */
  outOfBounds: number;
  /** 动线评估结果（经 dense 通道修正后的 flow）。 */
  flow: FlowEvaluation;
  /** 总分。 */
  score: number;
  /** 人话理由数组，2~4 条。 */
  reasons: string[];
  /** 带 code 的 violation envelope（P0：人体工学 + 可达性）。 */
  violations: ScoredViolation[];
  /** 0-100 三维子分（容量/动线/人体），UI 展示用。 */
  subScores: {
    /** 容量：每座 5 分，20 座封顶 100。 */
    capacity: number;
    /** 动线：100 - 通道扣分项绝对值 * 10，不低于 0。 */
    flow: number;
    /** 人体：100 - hard violation 数 * 10，不低于 0。 */
    ergonomics: number;
  };
  /**
   * 方案可信度：用户在画布上真实画了门才是 verified；
   * 门由 withDefaultDoor 推测合成时为 draft_unverified，
   * reasons 会带「门位置未确认，本方案为待核验草案」。
   */
  assurance: 'verified' | 'draft_unverified';
  /**
   * 可行性否决：凡有 hard violation（ZONE_UNREACHABLE / BBOX_OVERLAP /
   * DOOR_SWEEP_BLOCKED / ZONE_ENTRANCE_BLOCKED / ZONE_PAIR_DISCONNECTED 等）
   * → feasible=false，不参与推荐排序，不能被座位容量加分盖过。
   */
  feasible: boolean;
  /**
   * 三态可行性：
   * - FEASIBLE：无 hard violation，可推荐；
   * - INFEASIBLE：有依据证明冲突（hard violation 存在）；
   * - INSUFFICIENT_INPUT：缺房间尺寸/门数据等无法判断；
   * - SEARCH_TIMEOUT：求解预算耗尽（本批为占位，未启用真实超时枚举）。
   */
  feasibilityStatus: 'FEASIBLE' | 'INFEASIBLE' | 'INSUFFICIENT_INPUT' | 'SEARCH_TIMEOUT';
}

/** 浮点容差。 */
const EPS = 1e-6;
/** zone rect 外扩容差（米），判定越界时使用。 */
const OUT_OF_BOUNDS_PAD = 0.05;
/** 两 zone 相交面积占较小 zone 面积超过此比例 → 视为重叠。 */
const ZONE_OVERLAP_RATIO = 0.3;
/** zone 内 placements 越界率超过此比例 → 整块 zone 标 skipped。 */
const ZONE_OFFSITE_RATIO = 0.5;
/** dense 版在有签到区时通道修正量（米）：模拟密档通道更窄。 */
const DENSE_AISLE_SQUEEZE = 0.3;
/** 家具 footprint AABB 容差（米）：两件边距 ≤ 此值仍视为压住。 */
export const BBOX_OVERLAP_TOLERANCE_M = 0.02;

/** 三档配置：顺序固定，generateScoredPlans 按此返回。 */
const VARIANTS: ReadonlyArray<{ variantId: PlanVariantId; label: string; density: number }> = [
  { variantId: 'sparse', label: '松', density: 0.25 },
  { variantId: 'balanced', label: '适中', density: 0.5 },
  { variantId: 'dense', label: '密', density: 0.8 },
];

/** score 并列时的优先级：balanced > sparse > dense。 */
const TIE_PRIORITY: Record<PlanVariantId, number> = {
  balanced: 0,
  sparse: 1,
  dense: 2,
};

/**
 * 对同一批 zone 标注生成三版布置（松/适中/密），每版独立打分。
 * 返回顺序固定为 [sparse, balanced, dense] 的子集——若两版算出来
 * score / capacitySeats / subScores 完全相同，合并为一版（组内优先保留 balanced）。
 * 空 annotations / 极小场地可能只返回 1 版，杜绝假差异。
 */
export function generateScoredPlans(
  annotations: readonly PlanAnnotation[],
  opts?: ScoringOptions,
): ScoredPlan[] {
  const roomSize = opts?.roomSize;
  const all = VARIANTS.map((v) =>
    scoreVariant(annotations, v.variantId, v.label, v.density, roomSize),
  );
  return dedupePlans(all);
}

/** 合并 score+capacitySeats+subScores 完全相同的版本；同组优先保留 balanced > sparse > dense。 */
function dedupePlans(plans: readonly ScoredPlan[]): ScoredPlan[] {
  const keyOf = (p: ScoredPlan) =>
    [p.score, p.capacitySeats, p.subScores.capacity, p.subScores.flow, p.subScores.ergonomics].join('|');
  const groups = new Map<string, ScoredPlan[]>();
  for (const p of plans) {
    const k = keyOf(p);
    const list = groups.get(k) ?? [];
    list.push(p);
    groups.set(k, list);
  }
  const out: ScoredPlan[] = [];
  for (const list of groups.values()) {
    const preferred =
      list.find((p) => p.variantId === 'balanced') ??
      list.find((p) => p.variantId === 'sparse') ??
      list[0]!;
    out.push(preferred);
  }
  // 按 variantId 在 VARIANTS 里的原始顺序排回。
  const order = new Map(VARIANTS.map((v, i) => [v.variantId, i]));
  out.sort((a, b) => (order.get(a.variantId) ?? 99) - (order.get(b.variantId) ?? 99));
  return out;
}

/**
 * 从候选方案里挑推荐版：
 * - 只在 feasible=true 的集合里选（hard violation 方案直接否决，不能被座位容量加分盖过）；
 * - feasible 集合为空时返回 null（不 throw、不硬出三版），调用方应展示「无可行方案」并列出硬冲突；
 * - 同分并列时优先 balanced > sparse > dense。
 * 不修改输入数组。
 */
export function pickRecommendedPlan(plans: readonly ScoredPlan[]): ScoredPlan | null {
  if (plans.length === 0) return null;
  const feasiblePlans = plans.filter((p) => p.feasible);
  if (feasiblePlans.length === 0) return null;

  let best = feasiblePlans[0]!;
  for (let i = 1; i < feasiblePlans.length; i++) {
    const p = feasiblePlans[i]!;
    const diff = p.score - best.score;
    if (diff > EPS) {
      best = p;
    } else if (Math.abs(diff) <= EPS) {
      if (TIE_PRIORITY[p.variantId] < TIE_PRIORITY[best.variantId]) best = p;
    }
  }
  return best;
}

/* ---------- 内部打分辅助 ---------- */

function scoreVariant(
  annotations: readonly PlanAnnotation[],
  variantId: PlanVariantId,
  label: string,
  density: number,
  roomSize: RoomSize | undefined,
): ScoredPlan {
  const raw = planZones(annotations, density);
  let placements = raw.placements;
  let skipped = raw.skipped;

  // 区分度 #1：sparse 版主动删一桌（按 zone 分组，离中心最远的那张圆桌 + 其归属餐椅）。
  if (variantId === 'sparse') {
    placements = dropFarthestRoundtable(placements, annotations);
  }

  // 墙退距后处理：有 roomSize 时把越界家具内移，移不动的进 skipped。
  if (roomSize && Number.isFinite(roomSize.width) && Number.isFinite(roomSize.height)) {
    const walled = applyWallClearance(placements, roomSize);
    placements = walled.placements;
    if (walled.skipped.length > 0) {
      skipped = [...skipped, ...walled.skipped];
    }
  }

  // 计算 flow：dense 版在 evaluateFlow 之后做通道 -0.3m 修正。
  let flow = evaluateFlow(placements, annotations);
  if (variantId === 'dense' && hasCheckinZone(annotations) && Number.isFinite(flow.aisleWidthM)) {
    flow = applyDenseAisleSqueeze(flow);
  }

  // 场地越界 + 整块 zone offsite 跳过。
  const offsite = detectOffsiteZones(placements, annotations, roomSize);
  if (offsite.skipped.length > 0) {
    skipped = [...skipped, ...offsite.skipped];
    placements = placements.filter((p) => !offsite.removedZoneIds.has(p.zoneId));
  }

  const capacitySeats = computeCapacitySeats(placements);
  const outOfBounds = computeOutOfBounds(placements, annotations, roomSize);
  const flowPenalty = computeFlowPenalty(flow);
  const overlap = detectZoneOverlap(annotations);
  const overlapPenalty = overlap.count > 0 ? -3 * overlap.count : 0;

  // P0：人体工学 + 可达性 violation envelope。
  const hfViolations = evaluateHumanFactors(placements, annotations);
  const reach = evaluateReachability(placements, annotations, roomSize);
  // P1：家具 footprint 真重叠（两两 AABB，含 0.02m 容差）。
  const furnViolations = detectFurnitureOverlap(placements);
  // 4.0.0 补：门弧遮挡 + 隐私区顺序建议。
  // 若用户没画门，数据层合成默认南门，让 evaluateDoorSweep 仍能给出 DOOR_SWEEP_BLOCKED。
  const hasRealDoor = annotations.some(
    (a) => a.kind === 'door' && a.geometry.kind === 'door' && !a.geometry.inferred,
  );
  const doorAnnots = withDefaultDoor(annotations);
  const doorViolations = evaluateDoorSweep(placements, doorAnnots, roomSize);
  const privacyViolations = evaluatePrivacyOrder(annotations, roomSize);
  const violations: ScoredViolation[] = [
    ...hfViolations,
    ...reach.violations,
    ...furnViolations,
    ...doorViolations,
    ...privacyViolations,
  ];
  // 缺场地尺寸 → soft unknown violation，绝不当成合规 pass。
  const hasRoomSize = !!roomSize && Number.isFinite(roomSize.width) && Number.isFinite(roomSize.height);
  if (!hasRoomSize) {
    violations.push({
      code: 'ROOM_SIZE_UNKNOWN',
      severity: 'soft',
      status: 'unknown',
      message: '缺少房间宽度/深度，墙退距与可达性未核验',
    });
  }
  // 缺真实门数据（用的是推测门）→ soft unknown violation 提示。
  if (!hasRealDoor) {
    violations.push({
      code: 'DOOR_UNKNOWN',
      severity: 'soft',
      status: 'unknown',
      message: '门位置未确认，本方案为待核验草案',
    });
  }

  // hard violation → 方案不可行；缺关键数据 → INSUFFICIENT_INPUT。
  const hardViolations = violations.filter((v) => v.severity === 'hard' && v.status !== 'unknown');
  const feasible = hardViolations.length === 0;
  const feasibilityStatus: ScoredPlan['feasibilityStatus'] = !hasRoomSize
    ? 'INSUFFICIENT_INPUT'
    : feasible
      ? 'FEASIBLE'
      : 'INFEASIBLE';
  const hfPenalty = violations.reduce((sum, v) => {
    if (v.severity !== 'hard') return sum;
    if (v.code === 'CHAIR_GAP') return sum - 1;
    if (v.code === 'AISLE_CLEARANCE') return sum - 2;
    if (v.code === 'ZONE_UNREACHABLE') return sum - 5;
    if (v.code === 'BBOX_OVERLAP') return sum - 2;
    if (v.code === 'ZONE_PAIR_DISCONNECTED') return sum - 2;
    if (v.code === 'ZONE_ENTRANCE_BLOCKED') return sum - 3;
    if (v.code === 'DOOR_SWEEP_BLOCKED') return sum - 3;
    return sum;
  }, 0);

  const score = capacitySeats - 2 * skipped.length - 3 * outOfBounds + flowPenalty + overlapPenalty + hfPenalty;

  const reasons = buildReasons(
    variantId,
    placements,
    capacitySeats,
    skipped,
    outOfBounds,
    flow,
    overlap.count,
  );
  // P1：footprint 重叠人话总结——统计参与至少一对压住的不同家具件数。
  if (furnViolations.length > 0) {
    const involved = new Set<number>();
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        if (boxesOverlap(placements[i]!, placements[j]!)) {
          involved.add(i);
          involved.add(j);
        }
      }
    }
    reasons.push(`${involved.size} 件家具互相压住，扣分 -${2 * furnViolations.length}`);
  }
  // 把 violation 人话补到 reasons 末尾：soft 全推（提示不扣分），hard 最多推 2 条。
  for (const v of violations) {
    if (v.severity === 'soft') reasons.push(v.message);
  }
  let hardCount = 0;
  for (const v of violations) {
    if (v.severity !== 'hard') continue;
    reasons.push(v.message);
    hardCount += 1;
    if (hardCount >= 2) break;
  }

  // 0-100 三维子分：容量按座位数线性、动线按通道扣分绝对值、人体按 hard 条数。
  const hardTotal = violations.filter((v) => v.severity === 'hard').length;
  const subScores = {
    capacity: Math.min(100, capacitySeats * 5),
    flow: Math.max(0, 100 + flowPenalty * 10),
    ergonomics: Math.max(0, 100 - hardTotal * 10),
  };

  return {
    variantId,
    label,
    density,
    placements,
    skipped,
    capacitySeats,
    outOfBounds,
    flow,
    score,
    reasons,
    violations,
    subScores,
    assurance: hasRealDoor ? 'verified' as const : 'draft_unverified' as const,
    feasible,
    feasibilityStatus,
  };
}

/**
 * sparse 版删桌：按 zoneId 分组，每个 zone 内如果圆桌 ≥2 张，
 * 删掉离该 zone 几何中心最远的那张桌及其归属餐椅。
 * 椅子优先按 ownerTableId === 被删桌 key 判定；ownerTableId 缺失时
 * （如测试 mock）回退到「椅心到被删桌心 ≤ 1.0m」的旧距离规则。
 * 其他类型家具（签到台/长椅/背景墙）不动。
 */
function dropFarthestRoundtable(
  placements: readonly ZoneFurniturePlacement[],
  annotations: readonly PlanAnnotation[],
): ZoneFurniturePlacement[] {
  const zoneCenter = new Map<string, { cx: number; cz: number }>();
  for (const ann of annotations) {
    if (ann.kind !== 'zone' || ann.geometry.kind !== 'rect') continue;
    const g = ann.geometry;
    zoneCenter.set(ann.id, { cx: g.x + g.width / 2, cz: g.z + g.depth / 2 });
  }

  // 按 zone 分组，挑出每个 zone 里「离中心最远的那桌」。
  const tablesByZone = new Map<string, ZoneFurniturePlacement[]>();
  for (const p of placements) {
    if (p.spec.type !== 'dining-table') continue;
    const list = tablesByZone.get(p.zoneId) ?? [];
    list.push(p);
    tablesByZone.set(p.zoneId, list);
  }

  const dropKeys = new Set<string>();
  for (const [zoneId, tables] of tablesByZone) {
    if (tables.length < 2) continue;
    const c = zoneCenter.get(zoneId);
    if (!c) continue;
    let farthest = tables[0];
    let farthestD = (tables[0]!.x - c.cx) ** 2 + (tables[0]!.z - c.cz) ** 2;
    for (const t of tables) {
      const d = (t.x - c.cx) ** 2 + (t.z - c.cz) ** 2;
      if (d > farthestD + EPS) {
        farthest = t;
        farthestD = d;
      }
    }
    dropKeys.add(`${farthest!.x}|${farthest!.z}`);
  }

  if (dropKeys.size === 0) return placements.slice();

  // 删桌 + 其归属餐椅（ownerTableId 命中 dropKeys；缺失时回退距离判定）。
  return placements.filter((p) => {
    if (p.spec.type === 'dining-table') {
      return !dropKeys.has(`${p.x}|${p.z}`);
    }
    if (p.spec.type === 'dining-chair') {
      if (p.ownerTableId && dropKeys.has(p.ownerTableId)) return false;
      if (!p.ownerTableId) {
        for (const key of dropKeys) {
          const [sx, sz] = key.split('|');
          const tx = Number(sx);
          const tz = Number(sz);
          if (Math.hypot(p.x - tx, p.z - tz) < 1.0 + EPS) return false;
        }
      }
    }
    return true;
  });
}

/**
 * dense 版通道修正：aisleWidthM -= 0.3。
 * 修正后 <1.2m → 追加「密版签到台前通道只剩 X.Xm」violation（纯几何数字，不带受众文案）。
 * 受众相关的轮椅/行人能否过的人话判定只在 suggestions 层。
 */
function applyDenseAisleSqueeze(flow: FlowEvaluation): FlowEvaluation {
  const squeezed = Math.max(0, flow.aisleWidthM - DENSE_AISLE_SQUEEZE);
  const wheelChairPassable = squeezed >= 1.5 - EPS;
  const normalPassable = squeezed >= 1.2 - EPS;
  const violations = [...flow.violations];
  if (squeezed < 1.2 - EPS) {
    violations.push(`密版签到台前通道只剩 ${squeezed.toFixed(1)}m`);
  }
  return { ...flow, aisleWidthM: squeezed, wheelChairPassable, normalPassable, violations };
}

function hasCheckinZone(annotations: readonly PlanAnnotation[]): boolean {
  return annotations.some(
    (a) => a.kind === 'zone' && a.zoneType === 'checkin' && a.geometry.kind === 'rect',
  );
}

/**
 * 场地越界判定：
 * - 单件判定：placement 中心超出 [−w/2, w/2] × [−d/2, d/2] 计入 outOfBounds（在 computeOutOfBounds 里）。
 * - 整块 zone offsite：某 zone 内 placements 越界率 ≥ 50% → 整块 skipped「zone 越出场地边界」。
 */
function detectOffsiteZones(
  placements: readonly ZoneFurniturePlacement[],
  annotations: readonly PlanAnnotation[],
  roomSize: RoomSize | undefined,
): { skipped: ZonePlanSkipped[]; removedZoneIds: Set<string> } {
  if (!roomSize || !Number.isFinite(roomSize.width) || !Number.isFinite(roomSize.height)) {
    return { skipped: [], removedZoneIds: new Set() };
  }
  const zoneList = annotations.filter(
    (a): a is PlanAnnotation & { geometry: { kind: 'rect'; x: number; z: number; width: number; depth: number } } =>
      a.kind === 'zone' && a.geometry.kind === 'rect',
  );
  const skipped: ZonePlanSkipped[] = [];
  const removedZoneIds = new Set<string>();
  for (const zone of zoneList) {
    const list = placements.filter((p) => p.zoneId === zone.id);
    if (list.length === 0) continue;
    const offsite = list.filter((p) => isOutsideRoom(p, roomSize));
    if (offsite.length / list.length >= ZONE_OFFSITE_RATIO - EPS) {
      skipped.push({
        zoneId: zone.id,
        label: zone.label,
        reason: 'zone 越出场地边界，整块跳过',
      });
      removedZoneIds.add(zone.id);
    }
  }
  return { skipped, removedZoneIds };
}

function isOutsideRoom(p: ZoneFurniturePlacement, roomSize: RoomSize): boolean {
  const halfW = roomSize.width / 2;
  const halfH = roomSize.height / 2;
  return (
    p.x < -halfW - EPS || p.x > halfW + EPS || p.z < -halfH - EPS || p.z > halfH + EPS
  );
}

/** 餐椅/工作椅 +1，长椅 +2，其余 0。 */
function computeCapacitySeats(placements: readonly ZoneFurniturePlacement[]): number {
  let seats = 0;
  for (const p of placements) {
    const n = p.spec.name;
    if (n === '餐椅' || n === '工作椅') seats += 1;
    else if (n === '长椅') seats += 2;
  }
  return seats;
}

/** 越界件数：zone rect + 0.05m 或 [±room/2] 外；找不到 zoneId 容错不计。 */
function computeOutOfBounds(
  placements: readonly ZoneFurniturePlacement[],
  annotations: readonly PlanAnnotation[],
  roomSize: RoomSize | undefined,
): number {
  const zoneMap = new Map<string, { x: number; z: number; w: number; d: number }>();
  for (const ann of annotations) {
    if (ann.kind === 'zone' && ann.geometry.kind === 'rect') {
      zoneMap.set(ann.id, {
        x: ann.geometry.x,
        z: ann.geometry.z,
        w: ann.geometry.width,
        d: ann.geometry.depth,
      });
    }
  }
  let count = 0;
  for (const p of placements) {
    let outside = false;
    const zone = zoneMap.get(p.zoneId);
    if (zone) {
      const minX = zone.x - OUT_OF_BOUNDS_PAD;
      const maxX = zone.x + zone.w + OUT_OF_BOUNDS_PAD;
      const minZ = zone.z - OUT_OF_BOUNDS_PAD;
      const maxZ = zone.z + zone.d + OUT_OF_BOUNDS_PAD;
      if (
        p.x < minX - EPS || p.x > maxX + EPS ||
        p.z < minZ - EPS || p.z > maxZ + EPS
      ) {
        outside = true;
      }
    }
    if (!outside && roomSize && Number.isFinite(roomSize.width) && Number.isFinite(roomSize.height)) {
      if (isOutsideRoom(p, roomSize)) outside = true;
    }
    if (outside) count += 1;
  }
  return count;
}

/**
 * 动线扣分：
 * - violations 每条含「轮椅过不去」且 normalPassable=false → -5；
 * - violations 每条含「轮椅过不去」但 normalPassable=true → -2；
 * - checkinBlocked → -8。
 */
function computeFlowPenalty(flow: FlowEvaluation): number {
  let penalty = 0;
  for (const v of flow.violations) {
    if (v.includes('轮椅过不去')) {
      penalty += flow.normalPassable ? -2 : -5;
    }
  }
  if (flow.checkinBlocked) penalty += -8;
  return penalty;
}

/**
 * zone 两两重叠检测：相交面积 > 较小 zone 面积 30% → 计一次重叠。
 * 返回重叠对数（用于扣分）和首条人话描述。
 */
function detectZoneOverlap(
  annotations: readonly PlanAnnotation[],
): { count: number; sampleLabel: string } {
  const rects: { id: string; label: string; x: number; z: number; w: number; d: number }[] = [];
  for (const ann of annotations) {
    if (ann.kind !== 'zone' || ann.geometry.kind !== 'rect') continue;
    const g = ann.geometry;
    rects.push({ id: ann.id, label: ann.label, x: g.x, z: g.z, w: g.width, d: g.depth });
  }
  let count = 0;
  let sampleLabel = '';
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iz = Math.max(0, Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z));
      if (ix <= EPS || iz <= EPS) continue;
      const inter = ix * iz;
      const minArea = Math.min(a.w * a.d, b.w * b.d);
      if (minArea <= EPS) continue;
      if (inter / minArea > ZONE_OVERLAP_RATIO) {
        count += 1;
        if (!sampleLabel) sampleLabel = `${a.label} 与 ${b.label}`;
      }
    }
  }
  return { count, sampleLabel };
}

/**
 * 两件家具 footprint AABB 是否相交（含 0.02m 容差）。
 * footprint 按 placement 中心 ± (spec.width/2, spec.depth/2) 算轴对齐矩形，
 * 再向外扩 BBOX_OVERLAP_TOLERANCE_M；两扩边矩形相交即视为压住。
 */
function boxesOverlap(a: ZoneFurniturePlacement, b: ZoneFurniturePlacement): boolean {
  const t = BBOX_OVERLAP_TOLERANCE_M;
  const ax1 = a.x - a.spec.width / 2 - t;
  const ax2 = a.x + a.spec.width / 2 + t;
  const az1 = a.z - a.spec.depth / 2 - t;
  const az2 = a.z + a.spec.depth / 2 + t;
  const bx1 = b.x - b.spec.width / 2 - t;
  const bx2 = b.x + b.spec.width / 2 + t;
  const bz1 = b.z - b.spec.depth / 2 - t;
  const bz2 = b.z + b.spec.depth / 2 + t;
  return ax1 < bx2 - EPS && bx1 < ax2 - EPS && az1 < bz2 - EPS && bz1 < az2 - EPS;
}

/**
 * 两两 AABB 相交检测（含 0.02m 容差）。
 * 家具 footprint 按 placement 中心 ± (spec.width/2, spec.depth/2) 算轴对齐矩形。
 * 相交 → 每次生成 code='BBOX_OVERLAP' 的 hard violation（进 violations 数组）。
 * 同一对家具只报一次（i<j 遍历）。扣分由 scoreVariant 按 hard/code 统一算。
 */
export function detectFurnitureOverlap(
  placements: readonly ZoneFurniturePlacement[],
): ScoredViolation[] {
  const violations: ScoredViolation[] = [];
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!;
      const b = placements[j]!;
      if (boxesOverlap(a, b)) {
        violations.push({
          code: 'BBOX_OVERLAP',
          severity: 'hard',
          message: `${a.spec.name} 与 ${b.spec.name} 位置压住`,
        });
      }
    }
  }
  return violations;
}

/** 人话理由，2~4 条。variantId 决定首条差异化前缀。 */
function buildReasons(
  variantId: PlanVariantId,
  placements: readonly ZoneFurniturePlacement[],
  capacitySeats: number,
  skipped: readonly ZonePlanSkipped[],
  outOfBounds: number,
  flow: FlowEvaluation,
  overlapCount: number,
): string[] {
  const prefix =
    variantId === 'sparse'
      ? '松：少摆一桌留宽通道；'
      : variantId === 'balanced'
        ? '适中：平衡容量与通道；'
        : '密：多摆但通道紧；';
  const reasons: string[] = [];

  if (placements.length === 0) {
    reasons.push(`${prefix}本版没有可摆的家具`);
  } else {
    reasons.push(`${prefix}可坐 ${capacitySeats} 座（${placements.length} 件家具）`);
  }
  if (skipped.length > 0) {
    reasons.push(`${skipped.length} 个区被跳过：${skipped[0].reason}`);
  }
  if (outOfBounds > 0) {
    reasons.push(`${outOfBounds} 件越界，扣分 -${3 * outOfBounds}`);
  }
  if (overlapCount > 0) {
    reasons.push(`区与区重叠 ${overlapCount} 对（${(reasons[reasons.length - 1] ?? '').slice(0) || '相邻区'}），扣分 -${3 * overlapCount}`);
  }
  if (flow.violations.length > 0) {
    reasons.push(flow.violations[0]);
  } else if (Number.isFinite(flow.aisleWidthM) && flow.aisleWidthM > 0) {
    if (flow.wheelChairPassable) {
      reasons.push(`通道 ${flow.aisleWidthM.toFixed(1)}m，轮椅可过`);
    } else {
      reasons.push(`通道 ${flow.aisleWidthM.toFixed(1)}m，行人能过`);
    }
  } else if (placements.length > 0 && skipped.length === 0) {
    reasons.push('主通道宽敞，不约束');
  }
  if (reasons.length < 2) {
    reasons.push('本版按密度旋钮生成，未触发任何扣分项');
  }
  return reasons.slice(0, 4);
}
