/**
 * 第 12 批「能摆 → 会摆」多方案打分纯函数层。
 *
 * 设计红线：
 * - 纯函数、不可变、不接 React、不读 layoutStore；
 * - 对同一批 zone 标注跑三档密度（松/适中/密），每版独立打分；
 * - 排序使用座位与已识别冲突；真实通行条件未知，不给动线分；
 * - 布局和检查完全相同的候选合并，分数相同但布局不同的候选保留；
 * - 不引新依赖；UI 文案中文简体，禁「高斯/WorldGen」。
 */

import type { PlanAnnotation } from './plan-annotation';
import type { PlanSizeFacts } from './plan-size-facts';
import { withDefaultDoor } from './plan-annotation';
import {
  planZones,
  applyWallClearance,
  isRingChairOfTable,
  MAX_TABLES_PER_ZONE,
  type PlanZoneStyle,
  type ZoneFurniturePlacement,
  type ZonePlanSkipped,
} from './plan-approve';
import { evaluateFlow, evaluateReachability, evaluateKeepOut, evaluateRouteClear, type FlowEvaluation } from './flow-constraints';
import { evaluateHumanFactors, evaluateDoorSweep, evaluatePrivacyOrder, type ScoredViolation } from './human-factors';
import { getCatalogByType } from './furniture-catalog';

/** 三档密度旋钮。 */
export type PlanVariantId = 'sparse' | 'balanced' | 'dense';

/** 场地尺寸（米制、房间中心为原点；width=x 方向全宽、height=z 方向全深）。 */
export interface RoomSize {
  width: number;
  height: number;
  /** 宽和深分别记录来源与确认状态；缺失不等于确认。 */
  facts?: PlanSizeFacts;
}

/** 某类家具的库存缺口条目（placements 需求 > 可用库存）。 */
export interface FurnitureShortage {
  /** furniture type（与 placement.spec.type 对齐）。 */
  type: string;
  /** 中文家具名（人话，用于 reasons 拼接）。 */
  name: string;
  /** placements 实际需要的件数。 */
  needed: number;
  /** 库存可用件数。 */
  available: number;
  /** 缺几件 = needed - available。 */
  missing: number;
}

/** 交付清单（BOM）一行：按 type 聚合后的家具明细。 */
export interface BillOfMaterialLine {
  /** 中文家具名（来自 catalog）。 */
  name: string;
  /** furniture type。 */
  type: string;
  /** 数量（同 type 件数求和）。 */
  count: number;
  /**
   * 尺寸人话：圆桌写「Ø1.8m」；其他家具写「1.8×0.6m」（宽×深，米）。
   * catalog 查不到时回退 placements 的 spec.width×depth。
   */
  size: string;
}

/** generateScoredPlans 的可选开关。 */
export interface ScoringOptions {
  /** 场地尺寸；提供后越界判定会把「落到场地外」的件数计入 outOfBounds。 */
  roomSize?: RoomSize;
  /** 当前区域要安排的目标座位数；不足时只报告候选结果，不推断场地最大容量。 */
  targetCapacity?: number;
  /**
   * 可选库存清单：key=furniture type，value=可用件数。
   * 缺省或缺少类型表示库存未知，不表示不限。
   * 若 placements 里某 type 数量 > inventory[type]，placements 不静默截断，
   * 而是在 shortage / reasons 里报告仅对候选的比较；其他楼层和既有物料未计入。
   */
  inventory?: Record<string, number>;
  /**
   * 风格 brief（MP-PLAN）：只换摆法与颜色，不换评分口径。
   * 三档密度仍在，风格差异由 plan-approve 的配方白名单保证有已验摆法兜底。
   */
  style?: PlanZoneStyle;
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
    /** 缺真实通道和使用者轮廓时不能计算动线分。 */
    flow: number | null;
    /** 未覆盖完整人体工学要求，不能计算通过分。 */
    ergonomics: number | null;
  };
  /** 当前检查尚不覆盖完整的出口、门扇及适用规则，方案均为待核验草案。 */
  assurance: 'verified' | 'draft_unverified';
  /**
   * 没有已检出的硬冲突时为 true，可作为草案排序；不代表安全已确认。
   * 已检出的硬冲突使其为 false，不能被座位容量加分盖过。
   */
  feasible: boolean;
  /**
   * 三态可行性：
   * - FEASIBLE：已运行的必需检查无硬冲突且无未知；
   * - INFEASIBLE：有依据证明冲突（hard violation 存在）；
   * - INSUFFICIENT_INPUT：缺房间尺寸/门数据等无法判断；
   * - SEARCH_TIMEOUT：求解预算耗尽（本批为占位，未启用真实超时枚举）。
   */
  feasibilityStatus: 'FEASIBLE' | 'INFEASIBLE' | 'INSUFFICIENT_INPUT' | 'SEARCH_TIMEOUT';
  /**
   * 库存缺口清单（仅当 ScoringOptions.inventory 提供且 placements 需求 > 可用库存时填充）。
   * 不静默截断 placements，而是显式列出缺几件；方案 feasible 状态不变。
   * 未传 inventory 时为 undefined（旧调用兼容）。
   */
  shortage?: FurnitureShortage[] | undefined;
  /** 仅本次候选与所填库存的比较，既有家具与其他楼层不在范围内。 */
  inventoryNotes?: string[];
  /**
   * 交付清单（BOM）：按 placements 的 furniture type 聚合成中文明细。
   * 同 type 合并一行；size 从 furniture-catalog 取（圆桌写 ØØm，其他写 w×d m）。
   * 推荐版（pickRecommended 选中）必然填此字段。
   */
  billOfMaterials?: BillOfMaterialLine[];
}

/** 浮点容差。 */
const EPS = 1e-6;
/** zone rect 外扩容差（米），判定越界时使用。 */
const OUT_OF_BOUNDS_PAD = 0.05;
/** 两 zone 相交面积占较小 zone 面积超过此比例 → 视为重叠。 */
const ZONE_OVERLAP_RATIO = 0.3;
/** zone 内 placements 越界率超过此比例 → 整块 zone 标 skipped。 */
const ZONE_OFFSITE_RATIO = 0.5;
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
 * 布置与检查结果都相同，才合并为一版（组内优先保留 balanced）。
 * 空 annotations / 极小场地可能只返回 1 版，杜绝假差异。
 */
export function generateScoredPlans(
  annotations: readonly PlanAnnotation[],
  opts?: ScoringOptions,
): ScoredPlan[] {
  const candidateSize = opts?.roomSize;
  const roomSize = candidateSize && Number.isFinite(candidateSize.width) && Number.isFinite(candidateSize.height)
    && candidateSize.width > 0 && candidateSize.height > 0 ? candidateSize : undefined;
  const targetCapacity = opts?.targetCapacity;
  const inventory = opts?.inventory;
  const style = opts?.style;
  const all = VARIANTS.map((v) =>
    scoreVariant(annotations, v.variantId, v.label, v.density, roomSize, targetCapacity, inventory, style),
  );
  return dedupePlans(all);
}

/** 分数相同不代表布置或冲突相同；只合并结果完全相同的候选。 */
function dedupePlans(plans: readonly ScoredPlan[]): ScoredPlan[] {
  const keyOf = (p: ScoredPlan) => JSON.stringify({
    score: p.score, capacitySeats: p.capacitySeats, subScores: p.subScores, feasible: p.feasible,
    placements: p.placements.map(v => [v.zoneId, v.spec.type, v.spec.width, v.spec.depth, v.x, v.z, v.rotation]).sort(),
    violations: p.violations.map(v => [v.code, v.severity, v.status ?? null, v.zoneId ?? null, v.message]).sort(),
    skipped: p.skipped.map(v => [v.zoneId, v.reason]).sort(),
  });
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
 * - 只推荐没有硬冲突、实际生成物料且没有跳过物料的候选；
 * - 没有可推荐的候选时返回 null，不推断整个场地无解；
 * - 同分并列时优先 balanced > sparse > dense。
 * 不修改输入数组。
 */
export function pickRecommendedPlan(plans: readonly ScoredPlan[]): ScoredPlan | null {
  if (plans.length === 0) return null;
  const feasiblePlans = plans.filter(isScoredPlanApplicable);
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

/** 这里只判断本次候选是否完整可审阅；不代表现场安全、规范或库存已经通过。 */
export function isScoredPlanApplicable(plan: ScoredPlan): boolean {
  return plan.feasible === true && Array.isArray(plan.placements) && plan.placements.length > 0
    && Array.isArray(plan.skipped) && plan.skipped.length === 0;
}

/* ---------- 内部打分辅助 ---------- */

function scoreVariant(
  annotations: readonly PlanAnnotation[],
  variantId: PlanVariantId,
  label: string,
  density: number,
  roomSize: RoomSize | undefined,
  targetCapacity?: number,
  inventory?: Record<string, number>,
  style?: PlanZoneStyle,
): ScoredPlan {
  const raw = planZones(annotations, density, style ? { style } : undefined);
  let placements = raw.placements;
  let skipped = raw.skipped;

  // 区分度 #1：sparse 版主动删一桌（按 zone 分组，离中心最远的那张圆桌 + 其归属餐椅）。
  if (variantId === 'sparse') {
    placements = dropFarthestRoundtable(placements, annotations);
  }

  // 墙退距后处理：有 roomSize 时把越界家具内移，移不动的进 skipped。
  if (roomSize && Number.isFinite(roomSize.width) && Number.isFinite(roomSize.height) && roomSize.width > 0 && roomSize.height > 0) {
    const walled = applyWallClearance(placements, roomSize);
    placements = walled.placements;
    if (walled.skipped.length > 0) {
      skipped = [...skipped, ...walled.skipped];
    }
  }

  // 场地越界 + 整块 zone offsite 跳过。
  const offsite = detectOffsiteZones(placements, annotations, roomSize);
  if (offsite.skipped.length > 0) {
    skipped = [...skipped, ...offsite.skipped];
    placements = placements.filter((p) => !offsite.removedZoneIds.has(p.zoneId));
  }
  const flow = evaluateFlow(placements, annotations);

  const capacitySeats = computeCapacitySeats(placements);
  const outOfBounds = computeOutOfBounds(placements, annotations, roomSize);
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
  // SC-19 §五.4 / SC-20 输入侧：必留区（reserved）侵入与必留通道（route 走廊）
  // 压线都是硬约束——annotations 里有没有 route/reserved 由调用方决定
  // （产品主路径传全量 draft 标注，routes 才有机会参与评分）。
  const keepOutViolations = evaluateKeepOut(placements, annotations);
  const routeViolations = evaluateRouteClear(placements, annotations);
  const violations: ScoredViolation[] = [
    ...hfViolations,
    ...reach.violations,
    ...furnViolations,
    ...doorViolations,
    ...privacyViolations,
    ...keepOutViolations,
    ...routeViolations,
  ];
  // 缺场地尺寸 → soft unknown violation，绝不当成合规 pass。
  const hasRoomSize = !!roomSize && Number.isFinite(roomSize.width) && Number.isFinite(roomSize.height) && roomSize.width > 0 && roomSize.height > 0;
  if (!hasRoomSize) {
    violations.push({
      code: 'ROOM_SIZE_UNKNOWN',
      severity: 'soft',
      status: 'unknown',
      message: '缺少房间宽度/深度，墙退距与可达性未核验',
    });
  } else if (!roomSize?.facts || roomSize.facts.width.status !== 'confirmed' || roomSize.facts.depth.status !== 'confirmed'
      || roomSize.facts.width.valueMeters !== roomSize.width || roomSize.facts.depth.valueMeters !== roomSize.height) {
    violations.push({ code: 'ROOM_SIZE_UNKNOWN', severity: 'soft', status: 'unknown',
      message: '场地图中宽深的来源或确认状态尚不完整，现场尺寸仍需核对。' });
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
  const hardViolations = violations.filter((v) => v.severity === 'hard' && (v.status === undefined || v.status === 'violated'));
  const feasible = hardViolations.length === 0;
  const feasibilityStatus: ScoredPlan['feasibilityStatus'] = !hasRoomSize
    ? 'INSUFFICIENT_INPUT'
    : !feasible
    ? 'INFEASIBLE'
    : (flow.status === 'unknown' || violations.some(v => v.status === 'unknown'))
      ? 'INSUFFICIENT_INPUT'
      : 'FEASIBLE';
  const hfPenalty = hardViolations.reduce((sum, v) => {
    if (v.code === 'CHAIR_GAP') return sum - 1;
    if (v.code === 'AISLE_CLEARANCE') return sum - 2;
    if (v.code === 'ZONE_UNREACHABLE') return sum - 5;
    if (v.code === 'BBOX_OVERLAP') return sum - 2;
    if (v.code === 'ZONE_PAIR_DISCONNECTED') return sum - 2;
    if (v.code === 'ZONE_ENTRANCE_BLOCKED') return sum - 3;
    if (v.code === 'DOOR_SWEEP_BLOCKED') return sum - 3;
    if (v.code === 'KEEP_OUT_INTRUDED') return sum - 3;
    if (v.code === 'ROUTE_BLOCKED') return sum - 3;
    return sum;
  }, 0);

  const score = capacitySeats - 2 * skipped.length - 3 * outOfBounds + overlapPenalty + hfPenalty;

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
    if (v.severity === 'soft' || v.status === 'unknown') reasons.push(v.message);
  }
  let hardCount = 0;
  for (const v of hardViolations) {
    reasons.push(v.message);
    hardCount += 1;
    if (hardCount >= 2) break;
  }

  if (targetCapacity && Number.isFinite(targetCapacity) && capacitySeats < targetCapacity) {
    const recipeCap = placements.some((p) => p.spec.type === 'dining-table')
      ? `圆桌区当前配方每区最多 ${MAX_TABLES_PER_ZONE} 桌、每桌 ${getCatalogByType('dining-table')?.chairsPerTable ?? 4} 椅。`
      : '';
    reasons.push(
      `当前这些区域估算 ${capacitySeats} 座，距目标 ${targetCapacity} 座还差约 ${targetCapacity - capacitySeats} 座；${recipeCap}可调整区域、摆法或目标人数。`,
    );
  }

  // 比较范围仅是这次生成的物料，不能推断整个项目的实际缺口。
  const shortage = inventory ? computeShortage(placements, inventory) : undefined;
  const inventoryNotes = placements.length ? [
    '库存仅比较本次候选物料，既有家具及其他楼层未计入；全项目库存与实际缺口待核验。',
  ] : [];
  const unknownTypes = new Map<string, string>();
  for (const { spec } of placements) {
    const count = inventory?.[spec.type];
    if (!Number.isSafeInteger(count) || count! < 0) unknownTypes.set(spec.type, spec.name);
  }
  for (const name of unknownTypes.values()) inventoryNotes.push(`${name}库存未知，请核验。`);
  for (const s of shortage ?? []) {
    inventoryNotes.push(`本次候选需要 ${s.needed} ${pluralUnit(s.name)}${s.name}，比所填库存 ${s.available} 多 ${s.missing}；实际缺口待核验。`);
  }
  reasons.push(...inventoryNotes);

  // 交付清单（BOM）：按 type 聚合，推荐版必然填。
  const billOfMaterials = buildBillOfMaterials(placements);

  // 0-100 三维子分：容量按座位数线性、动线按通道扣分绝对值、人体按 hard 条数。
  const subScores = {
    capacity: Math.min(100, capacitySeats * 5),
    flow: null,
    ergonomics: null,
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
    assurance: 'draft_unverified' as const,
    feasible,
    feasibilityStatus,
    shortage,
    inventoryNotes,
    billOfMaterials,
  };
}

/**
 * 库存核验：placements 按 spec.type 聚合计数，对比 inventory[type]。
 * inventory 未传或缺该 key → 不做核验，返回空数组。
 * 库存 ≥ 需要数 → 空；否则每条记 needed/available/missing。
 */
function computeShortage(
  placements: readonly ZoneFurniturePlacement[],
  inventory: Record<string, number> | undefined,
): FurnitureShortage[] {
  if (!inventory) return [];
  const neededByType = new Map<string, { name: string; needed: number }>();
  for (const p of placements) {
    const t = p.spec.type;
    const cur = neededByType.get(t) ?? { name: p.spec.name, needed: 0 };
    cur.needed += 1;
    neededByType.set(t, cur);
  }
  const out: FurnitureShortage[] = [];
  for (const [type, agg] of neededByType) {
    if (!Object.hasOwn(inventory, type)) continue;
    const available = inventory[type]!;
    if (!Number.isSafeInteger(available) || available < 0) continue;
    if (agg.needed <= available) continue;
    out.push({
      type,
      name: agg.name,
      needed: agg.needed,
      available,
      missing: agg.needed - available,
    });
  }
  return out;
}

/** 家具名单量词：椅类用「把」，桌/台用「张」，其他用「件」。 */
function pluralUnit(name: string): string {
  if (name.includes('椅')) return '把';
  if (name.includes('桌') || name.includes('台')) return '张';
  if (name.includes('墙')) return '面';
  if (name.includes('绿植')) return '盆';
  if (name.includes('长椅')) return '条';
  return '件';
}

/**
 * 从 placements 聚合交付清单（BOM）：
 * - 同 type 合并一行；数量求和；
 * - name/尺寸优先从 furniture-catalog 取（type→catalog），查不到回退 placement.spec；
 * - size 人话：圆桌（正方形 footprint 且 name 含「圆桌」）写「Ø1.8m」，其他写「1.8×0.6m」。
 */
export function buildBillOfMaterials(
  placements: readonly ZoneFurniturePlacement[],
): BillOfMaterialLine[] {
  const grouped = new Map<string, { name: string; count: number; width: number; depth: number; isRound: boolean }>();
  for (const p of placements) {
    const type = p.spec.type;
    const catalog = getCatalogByType(type);
    // 同名 type 在 catalog 里可能有多条（dining-chair 分餐椅/工作椅）；取第一条匹配。
    // 尺寸以 placement.spec 为准（与实际摆放一致），catalog 只用于判定圆桌。
    const width = catalog?.width ?? p.spec.width;
    const depth = catalog?.depth ?? p.spec.depth;
    const name = catalog?.name ?? p.spec.name;
    const isRound = name.includes('圆桌') || (Math.abs(width - depth) < EPS && name.includes('桌'));
    const cur = grouped.get(type) ?? { name, count: 0, width, depth, isRound };
    cur.count += 1;
    grouped.set(type, cur);
  }
  const out: BillOfMaterialLine[] = [];
  for (const [type, agg] of grouped) {
    const size = agg.isRound
      ? `Ø${trimTrailingZero(agg.width)}m`
      : `${trimTrailingZero(agg.width)}×${trimTrailingZero(agg.depth)}m`;
    out.push({ name: agg.name, type, count: agg.count, size });
  }
  // 稳定排序：按家具数量倒序，再按 type 字母序，便于测试快照。
  out.sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return out;
}

function trimTrailingZero(v: number): string {
  // 1.8 → "1.8"；1.0 → "1"；0.45 → "0.45"。
  return Number.isInteger(v) ? String(v) : String(v);
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

/** 餐椅/工作椅/讲座椅 +1，长椅 +2，其余 0。 */
function computeCapacitySeats(placements: readonly ZoneFurniturePlacement[]): number {
  let seats = 0;
  for (const p of placements) {
    const n = p.spec.name;
    if (n === '餐椅' || n === '工作椅' || n === '讲座椅') seats += 1;
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
 * 例外：斜向环椅 vs 自家圆桌——AABB 轴对齐近似下 45° 环椅的包围盒角会戳进
 * 桌包围盒，但径向距离够远（isRingChairOfTable 自带径向自守卫，环半径被改小
 * 豁免自动失效），不算压住（G5 修复）。
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
      if (boxesOverlap(a, b) && !isRingChairOfTable(a, b) && !isRingChairOfTable(b, a)) {
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
    reasons.push(`${prefix}估算 ${capacitySeats} 座（${placements.length} 件家具），仍需核对实际座位`);
  }
  if (skipped.length > 0) {
    // skipped 里既有整块区（越界/太小）也有单件家具（墙退距放不下），
    // 用中性的「项」计数，不把件数说成区数（docs/32 验收点二缺口 4）。
    reasons.push(`${skipped.length} 项被跳过：${skipped[0].reason}`);
  }
  if (outOfBounds > 0) {
    reasons.push(`${outOfBounds} 件越界，扣分 -${3 * outOfBounds}`);
  }
  if (overlapCount > 0) {
    reasons.push(`区与区重叠 ${overlapCount} 对（${(reasons[reasons.length - 1] ?? '').slice(0) || '相邻区'}），扣分 -${3 * overlapCount}`);
  }
  if (flow.violations.length > 0) {
    reasons.push(flow.violations[0]);
  } else reasons.push('真实入口和通行条件待核验');
  if (reasons.length < 2) {
    reasons.push('本版按密度旋钮生成，未触发任何扣分项');
  }
  return reasons.slice(0, 4);
}
