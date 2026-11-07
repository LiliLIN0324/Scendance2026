/**
 * MP-PLAN 风格 brief（C1）：同一批区标注按 3 个风格出 3 套完整备选。
 *
 * 设计红线：
 * - 纯函数、不接 React、不读 layoutStore；
 * - 风格只做两件事：把圆桌区换一种**已验证过的配方**（课桌排 / 接待长桌），
 *   以及按家具 type 换色；不新造家具类型，不绕开评分层；
 * - 每套仍走 generateScoredPlans 的同一套硬约束（越界/穿模/可达/门弧），
 *   风格不同不等于可以不合规；
 * - 差异按 docs/24 2-3 量化：SKU 替换率 ≥30% 或位置变动率 ≥40%，
 *   且色彩族至少 1 项不同。
 */

import {
  generateScoredPlans,
  pickRecommendedPlan,
  type ScoredPlan,
  type ScoringOptions,
} from './plan-scoring';
import type { PlanAnnotation } from './plan-annotation';

/** 一套风格 brief：一句提示词 + 摆法覆盖 + 色板。 */
export interface PlanStyleBrief {
  key: string;
  /** UI 短名。 */
  label: string;
  /** 客户能说的那风格词。 */
  prompt: string;
  /**
   * 把圆桌区改排成另一种配方。只允许 desk / checkin：
   * 两种配方都在同一块矩形里验过最小尺寸与人体工学。
   */
  recipeOverride?: { roundtable?: 'desk' | 'checkin' };
  /** 家具 type → 颜色；未列出的保持 catalog 本色。 */
  colors: Readonly<Record<string, string>>;
}

/**
 * 内置三套：暖木宴会（圆桌围坐）、墨白剧院（课桌排）、雾蓝接待（长桌一字排开）。
 * 三套的家具类型、位置与色彩都不同，不是同一摆法换配色。
 */
export const PLAN_STYLE_BRIEFS: readonly PlanStyleBrief[] = [
  {
    key: 'banquet-warm',
    label: '暖木宴会',
    prompt: '暖木宴会，圆桌围坐，金色点缀',
    colors: {
      'dining-table': '#6B4A32',
      'dining-chair': '#C4A574',
      'desk-table': '#6B4A32',
      'desk-chair': '#C4A574',
      table: '#6B4A32',
      backdrop: '#8A6A3A',
      plant: '#7C8F6A',
      bench: '#8D6E63',
    },
  },
  {
    key: 'theater-ink',
    label: '墨白剧院',
    prompt: '讲座剧院，课桌排排，黑白分明',
    recipeOverride: { roundtable: 'desk' },
    colors: {
      'dining-table': '#2A2A2A',
      'dining-chair': '#F5F5F5',
      'desk-table': '#2A2A2A',
      'desk-chair': '#F5F5F5',
      table: '#2A2A2A',
      backdrop: '#1A1918',
      plant: '#6B7364',
      bench: '#3A3A3A',
    },
  },
  {
    key: 'reception-mist',
    label: '雾蓝接待',
    prompt: '迎宾接待，长桌一字排开，雾蓝安静',
    recipeOverride: { roundtable: 'checkin' },
    colors: {
      'dining-table': '#A8B8C8',
      'dining-chair': '#D7E0E8',
      'desk-table': '#A8B8C8',
      'desk-chair': '#D7E0E8',
      table: '#A8B8C8',
      backdrop: '#8FA4B8',
      plant: '#9BB0A0',
      bench: '#B7C6D4',
    },
  },
];

/** 两版位置差多少米才算「动了」。 */
export const POSITION_SHIFT_MIN_M = 0.5;
/** docs/24 2-3 的两条通过线。 */
export const SKU_REPLACE_MIN_RATE = 0.3;
export const POSITION_SHIFT_MIN_RATE = 0.4;

export interface StyledPlan {
  brief: PlanStyleBrief;
  plan: ScoredPlan;
}

/**
 * 同一批标注 × N 个风格 → 每个风格一套可确认方案（取该风格下的推荐版）。
 * 传入的 opts 与普通三档一致（场地尺寸/目标人数/库存），风格只作为额外维度。
 */
export function generateStylePlans(
  annotations: readonly PlanAnnotation[],
  briefs: readonly PlanStyleBrief[] = PLAN_STYLE_BRIEFS,
  opts: Omit<ScoringOptions, 'style'> = {},
): StyledPlan[] {
  const out: StyledPlan[] = [];
  for (const brief of briefs) {
    const plans = generateScoredPlans(annotations, {
      ...opts,
      style: {
        ...(brief.recipeOverride ? { recipeOverride: brief.recipeOverride } : {}),
        colors: brief.colors,
      },
    });
    const plan = pickRecommendedPlan(plans) ?? plans[0];
    if (plan) out.push({ brief, plan });
  }
  return out;
}

/** 一套「完整」：有家具、没有跳过区、没有越界、没有硬冲突。 */
export function isCompletePlan(plan: ScoredPlan): boolean {
  return (
    plan.placements.length > 0 &&
    plan.skipped.length === 0 &&
    plan.outOfBounds === 0 &&
    plan.feasible
  );
}

export interface StylePlanDiff {
  /** 两版按区逐件配对后的共同件数。 */
  matched: number;
  /** 其中 SKU（type + 名称）不同的件数。 */
  skuReplaced: number;
  skuReplaceRate: number;
  /** 位置移动超过 POSITION_SHIFT_MIN_M 的件数。 */
  moved: number;
  positionShiftRate: number;
  /** 各自用到的颜色集合（排序去重）。 */
  colorsA: string[];
  colorsB: string[];
  colorFamilyDiffers: boolean;
  /** docs/24 2-3：SKU ≥30% 或位置 ≥40%，且色彩族至少 1 项不同。 */
  passes: boolean;
}

interface KeyedPlacement {
  x: number;
  z: number;
  sku: string;
  color: string;
}

/** 按 zoneId + 区内顺序配对；不同配方件数不同时只比配得上的部分，不硬凑。 */
function keyedByZone(plan: ScoredPlan): Map<string, KeyedPlacement[]> {
  const map = new Map<string, KeyedPlacement[]>();
  for (const p of plan.placements) {
    const list = map.get(p.zoneId) ?? [];
    list.push({ x: p.x, z: p.z, sku: `${p.spec.type}|${p.spec.name}`, color: p.spec.color });
    map.set(p.zoneId, list);
  }
  return map;
}

function colorSet(plan: ScoredPlan): string[] {
  return [...new Set(plan.placements.map((p) => p.spec.color))].sort();
}

/** 量化两套方案的差异（docs/24 2-3）。 */
export function compareStylePlans(a: ScoredPlan, b: ScoredPlan): StylePlanDiff {
  const zonesA = keyedByZone(a);
  const zonesB = keyedByZone(b);
  let matched = 0;
  let skuReplaced = 0;
  let moved = 0;

  for (const [zoneId, listA] of zonesA) {
    const listB = zonesB.get(zoneId) ?? [];
    const count = Math.min(listA.length, listB.length);
    for (let i = 0; i < count; i += 1) {
      const left = listA[i]!;
      const right = listB[i]!;
      matched += 1;
      if (left.sku !== right.sku) skuReplaced += 1;
      if (Math.hypot(left.x - right.x, left.z - right.z) > POSITION_SHIFT_MIN_M) moved += 1;
    }
  }

  const colorsA = colorSet(a);
  const colorsB = colorSet(b);
  const colorFamilyDiffers =
    colorsA.length + colorsB.length > 0 &&
    (colorsA.length !== colorsB.length || colorsA.some((color) => !colorsB.includes(color)));

  const skuReplaceRate = matched > 0 ? skuReplaced / matched : 0;
  const positionShiftRate = matched > 0 ? moved / matched : 0;

  return {
    matched,
    skuReplaced,
    skuReplaceRate,
    moved,
    positionShiftRate,
    colorsA,
    colorsB,
    colorFamilyDiffers,
    passes:
      matched > 0 &&
      (skuReplaceRate >= SKU_REPLACE_MIN_RATE || positionShiftRate >= POSITION_SHIFT_MIN_RATE) &&
      colorFamilyDiffers,
  };
}
