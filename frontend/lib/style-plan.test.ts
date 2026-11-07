/**
 * MP-PLAN 风格 brief（C1）验收：
 * 同一场地 × 3 个风格 → 3 套完整方案，且任两套过 docs/24 2-3
 * （SKU 替换 ≥30% 或位置变动 ≥40%，色彩族至少 1 项不同）。
 *
 * 设 STYLE_PLAN_OUT 时把结果写到证据目录；否则只跑断言。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { planZones } from './plan-approve';
import {
  PLAN_STYLE_BRIEFS,
  compareStylePlans,
  generateStylePlans,
  isCompletePlan,
} from './style-plan';
import type { PlanAnnotation } from './plan-annotation';

function zone(
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  zoneType: PlanAnnotation['zoneType'] = 'roundtable',
  label = '圆桌区',
): PlanAnnotation {
  return {
    id,
    kind: 'zone',
    label,
    stageNo: 1,
    geometry: { kind: 'rect', x, z, width, depth },
    zoneType,
  };
}

/** Hall D5 量级：18×12 米，中央一块 14×7 米宾客区。 */
const ROOM = { width: 18, height: 12 };
const ANNOTATIONS: PlanAnnotation[] = [zone('z-main', -7, -4.5, 14, 7)];

const startedAt = Date.now();
const styled = generateStylePlans(ANNOTATIONS, PLAN_STYLE_BRIEFS, { roomSize: ROOM });
const pairs = [
  { a: 0, b: 1, diff: compareStylePlans(styled[0]!.plan, styled[1]!.plan) },
  { a: 0, b: 2, diff: compareStylePlans(styled[0]!.plan, styled[2]!.plan) },
  { a: 1, b: 2, diff: compareStylePlans(styled[1]!.plan, styled[2]!.plan) },
];

afterAll(() => {
  const out = process.env.STYLE_PLAN_OUT;
  if (!out) return;
  const evidence = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    room: ROOM,
    zone: { x: -7, z: -4.5, width: 14, depth: 7 },
    briefs: PLAN_STYLE_BRIEFS.map((brief) => ({
      key: brief.key,
      label: brief.label,
      prompt: brief.prompt,
      recipeOverride: brief.recipeOverride ?? null,
      colors: brief.colors,
    })),
    plans: styled.map(({ brief, plan }) => ({
      brief: brief.key,
      label: brief.label,
      variantId: plan.variantId,
      density: plan.density,
      placements: plan.placements.length,
      capacitySeats: plan.capacitySeats,
      skipped: plan.skipped.length,
      outOfBounds: plan.outOfBounds,
      feasible: plan.feasible,
      feasibilityStatus: plan.feasibilityStatus,
      assurance: plan.assurance,
      score: plan.score,
      violations: plan.violations.map((v) => ({ code: v.code, severity: v.severity })),
      furniture: Object.fromEntries(
        [...new Set(plan.placements.map((p) => p.spec.type))].sort().map((type) => [
          type,
          plan.placements.filter((p) => p.spec.type === type).length,
        ]),
      ),
      colors: [...new Set(plan.placements.map((p) => p.spec.color))].sort(),
    })),
    pairs: pairs.map(({ a, b, diff }) => ({
      a: styled[a]!.brief.key,
      b: styled[b]!.brief.key,
      ...diff,
    })),
    totals: {
      plans: styled.length,
      complete: styled.filter(({ plan }) => isCompletePlan(plan)).length,
      pairsPassing: pairs.filter(({ diff }) => diff.passes).length,
      pairs: pairs.length,
    },
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
});

describe('generateStylePlans', () => {
  it('三个风格各出一套方案，顺序与 brief 一致', () => {
    expect(styled).toHaveLength(3);
    expect(styled.map(({ brief }) => brief.key)).toEqual([
      'banquet-warm',
      'theater-ink',
      'reception-mist',
    ]);
  });

  it('3/3 完整：有家具、无跳过区、无越界、无硬冲突', () => {
    for (const { brief, plan } of styled) {
      expect(plan.placements.length, brief.key).toBeGreaterThan(0);
      expect(plan.skipped, brief.key).toHaveLength(0);
      expect(plan.outOfBounds, brief.key).toBe(0);
      expect(plan.feasible, brief.key).toBe(true);
      expect(
        plan.violations.filter((v) => v.severity === 'hard'),
        brief.key,
      ).toHaveLength(0);
    }
  });

  it('风格不是换配色：宴会圆桌、剧院课桌、接待长桌的 SKU 各自不同', () => {
    const types = styled.map(({ plan }) => new Set(plan.placements.map((p) => p.spec.type)));
    expect(types[0]!.has('dining-table')).toBe(true);
    expect(types[0]!.has('dining-chair')).toBe(true);
    expect(types[1]!.has('desk-table')).toBe(true);
    expect(types[1]!.has('desk-chair')).toBe(true);
    expect(types[2]!.has('table')).toBe(true);
    // 同一套里不混入别人的主家具。
    expect(types[1]!.has('dining-table')).toBe(false);
    expect(types[2]!.has('dining-chair')).toBe(true); // 接待椅沿用工作椅条目
  });

  it('任两套都过 docs/24 2-3：SKU ≥30% 或位置 ≥40%，且色彩族不同', () => {
    for (const { diff } of pairs) {
      expect(diff.matched).toBeGreaterThan(0);
      expect(diff.passes).toBe(true);
      expect(diff.skuReplaceRate >= 0.3 || diff.positionShiftRate >= 0.4).toBe(true);
      expect(diff.colorFamilyDiffers).toBe(true);
    }
  });

  it('同输入两次生成结果一致（可复现）', () => {
    const again = generateStylePlans(ANNOTATIONS, PLAN_STYLE_BRIEFS, { roomSize: ROOM });
    expect(again.map(({ plan }) => plan.placements.length)).toEqual(
      styled.map(({ plan }) => plan.placements.length),
    );
    expect(again.map(({ plan }) => plan.score)).toEqual(styled.map(({ plan }) => plan.score));
    expect(again[0]!.plan.placements[0]!.x).toBe(styled[0]!.plan.placements[0]!.x);
  });

  it('没有硬冲突以外的评分口径变化：缺真实门仍是待核验草案', () => {
    for (const { plan } of styled) {
      expect(plan.assurance).toBe('draft_unverified');
      expect(plan.violations.some((v) => v.code === 'DOOR_UNKNOWN')).toBe(true);
    }
  });
});

describe('风格覆盖的白名单', () => {
  it('只放行 roundtable → desk / checkin，其余覆盖被忽略', () => {
    const base = planZones(ANNOTATIONS, 0.5).placements;
    const ignored = planZones(ANNOTATIONS, 0.5, {
      style: { recipeOverride: { roundtable: 'photo' } },
    }).placements;
    expect(ignored.map((p) => p.spec.type)).toEqual(base.map((p) => p.spec.type));

    const desk = planZones(ANNOTATIONS, 0.5, {
      style: { recipeOverride: { roundtable: 'desk' } },
    }).placements;
    expect(desk.some((p) => p.spec.type === 'desk-table')).toBe(true);
  });

  it('换色只改列出的 type，未列出的保持 catalog 本色', () => {
    const onlyTable = planZones(ANNOTATIONS, 0.5, {
      style: { colors: { 'dining-table': '#123456' } },
    }).placements;
    const table = onlyTable.find((p) => p.spec.type === 'dining-table')!;
    const chair = onlyTable.find((p) => p.spec.type === 'dining-chair')!;
    expect(table.spec.color).toBe('#123456');
    expect(chair.spec.color).not.toBe('#123456');
  });

  it('不传风格时与旧行为完全一致', () => {
    expect(planZones(ANNOTATIONS, 0.5, undefined).placements).toEqual(
      planZones(ANNOTATIONS, 0.5).placements,
    );
  });
});
