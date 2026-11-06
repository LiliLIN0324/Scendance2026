/**
 * 第 12 批「能摆 → 会摆」多方案打分纯函数层。
 *
 * 设计红线：
 * - 纯函数、不可变、不接 React、不读 layoutStore；
 * - 对同一批 zone 标注跑三档密度（松/适中/密），每版独立打分；
 * - 打分公式固定：capacitySeats - 2*skipped.length - 3*outOfBounds - 动线扣分；
 * - 不引新依赖；UI 文案中文简体，禁「高斯/WorldGen」。
 */

import type { PlanAnnotation } from './plan-annotation';
import {
  planZones,
  type ZoneFurniturePlacement,
  type ZonePlanSkipped,
} from './plan-approve';
import { evaluateFlow, type FlowEvaluation } from './flow-constraints';

/** 三档密度旋钮。 */
export type PlanVariantId = 'sparse' | 'balanced' | 'dense';

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
  /** 越界件数：placement 中心落在来源 zone rect 外扩 0.05m 之外的件数。 */
  outOfBounds: number;
  /** 动线评估结果（直接来自 evaluateFlow）。 */
  flow: FlowEvaluation;
  /** 总分。 */
  score: number;
  /** 人话理由数组，2~4 条。 */
  reasons: string[];
}

/** 浮点容差。 */
const EPS = 1e-6;
/** zone rect 外扩容差（米），判定越界时使用。 */
const OUT_OF_BOUNDS_PAD = 0.05;

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
 * 返回数组顺序固定为 [sparse, balanced, dense]。
 */
export function generateScoredPlans(annotations: readonly PlanAnnotation[]): ScoredPlan[] {
  return VARIANTS.map((v) => scoreVariant(annotations, v.variantId, v.label, v.density));
}

/**
 * 从三版里挑推荐版：score 最高；并列时优先 balanced > sparse > dense。
 * 若三版 placements 全空，返回 balanced 版（让 UI 走「摆不下」分支）。
 * 不修改输入数组。
 */
export function pickRecommendedPlan(plans: readonly ScoredPlan[]): ScoredPlan {
  if (plans.length === 0) {
    throw new Error('pickRecommendedPlan: plans 不能为空');
  }
  const balanced = plans.find((p) => p.variantId === 'balanced') ?? plans[0];
  const allEmpty = plans.every((p) => p.placements.length === 0);
  if (allEmpty) return balanced;

  let best = plans[0];
  for (let i = 1; i < plans.length; i++) {
    const p = plans[i];
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
): ScoredPlan {
  const { placements, skipped } = planZones(annotations, density);
  const flow = evaluateFlow(placements, annotations);
  const capacitySeats = computeCapacitySeats(placements);
  const outOfBounds = computeOutOfBounds(placements, annotations);
  const flowPenalty = computeFlowPenalty(flow);
  const score = capacitySeats - 2 * skipped.length - 3 * outOfBounds + flowPenalty;
  const reasons = buildReasons(placements, capacitySeats, skipped, outOfBounds, flow);
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
  };
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

/** 越界件数：中心超出 zone rect + 0.05m 的件数；找不到 zoneId 容错不计。 */
function computeOutOfBounds(
  placements: readonly ZoneFurniturePlacement[],
  annotations: readonly PlanAnnotation[],
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
    const zone = zoneMap.get(p.zoneId);
    if (!zone) continue;
    const minX = zone.x - OUT_OF_BOUNDS_PAD;
    const maxX = zone.x + zone.w + OUT_OF_BOUNDS_PAD;
    const minZ = zone.z - OUT_OF_BOUNDS_PAD;
    const maxZ = zone.z + zone.d + OUT_OF_BOUNDS_PAD;
    if (
      p.x < minX - EPS || p.x > maxX + EPS ||
      p.z < minZ - EPS || p.z > maxZ + EPS
    ) {
      count += 1;
    }
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

/** 人话理由，2~4 条。 */
function buildReasons(
  placements: readonly ZoneFurniturePlacement[],
  capacitySeats: number,
  skipped: readonly ZonePlanSkipped[],
  outOfBounds: number,
  flow: FlowEvaluation,
): string[] {
  const reasons: string[] = [];
  if (placements.length === 0) {
    reasons.push('本版没有可摆的家具');
  } else {
    reasons.push(`可坐 ${capacitySeats} 座（${placements.length} 件家具）`);
  }
  if (skipped.length > 0) {
    reasons.push(`${skipped.length} 个区被跳过：${skipped[0].reason}`);
  }
  if (outOfBounds > 0) {
    reasons.push(`${outOfBounds} 件越界，扣分 -${3 * outOfBounds}`);
  }
  if (flow.violations.length > 0) {
    reasons.push(flow.violations[0]);
  } else if (flow.aisleWidthM !== Infinity && Number.isFinite(flow.aisleWidthM)) {
    reasons.push(`签到台前通道 ${flow.aisleWidthM.toFixed(1)}m，轮椅可过`);
  } else if (placements.length > 0 && skipped.length === 0) {
    reasons.push('无签到区，主通道不约束');
  }
  // 兜底：保证至少 2 条人话（空 annotations / 全无违规场景下用）。
  if (reasons.length < 2) {
    reasons.push('本版按密度旋钮生成，未触发任何扣分项');
  }
  return reasons.slice(0, 4);
}
