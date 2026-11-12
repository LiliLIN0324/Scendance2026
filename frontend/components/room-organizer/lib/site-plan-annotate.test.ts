/**
 * 2026-11-11 用户指令：自由标注（文本 note + 形状 rect/circle/triangle/line）纯函数层测试。
 * 口径与测量 H3-a 同构：几何校验按五类点位口径、标注不参与冲突判定、
 * 契约可选字段（旧快照不带 annotations 照常解析）、米制 ENU 命中测试。
 */
import { describe, expect, it } from 'vitest';
import {
  PLAN_SHAPE_KINDS,
  annotationDistanceM,
  annotationRectRing,
  buildAnnotation,
  planShapeDraftTarget,
} from './site-plan-annotate';
import { planOverviewStats } from './site-plan-measure';
import { filterPlanByLevel } from './plan-levels';
import type { PlanEditIssue } from './site-plan-editing';
import { sitePlanDataSchema, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 最小合法 plan（标注测试只需要 boundary 与空实体集合）。 */
function basePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 40 }, { x: 0, y: 40 }],
    zones: [], facilities: [], routes: [], nodes: [], workers: [],
  };
}

describe('buildAnnotation validation (2026-11-11)', () => {
  function buildOrIssue(input: Parameters<typeof buildAnnotation>[0]): PlanEditIssue {
    const result = buildAnnotation(input);
    expect(result.ok).toBe(false);
    return (result as { ok: false; issue: PlanEditIssue }).issue;
  }

  it('accepts one of each kind with the exact point-count contract', () => {
    for (const built of [
      buildAnnotation({ kind: 'note', name: '文本 1', points: [{ x: 5, y: 5 }], text: '入口集合点' }),
      buildAnnotation({ kind: 'rect', name: '矩形 1', points: [{ x: 0, y: 0 }, { x: 10, y: 6 }] }),
      buildAnnotation({ kind: 'circle', name: '圆形 1', points: [{ x: 20, y: 20 }], radiusM: 5 }),
      buildAnnotation({ kind: 'triangle', name: '三角形 1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }] }),
      buildAnnotation({ kind: 'line', name: '线段 1', points: [{ x: 0, y: 0 }, { x: 12, y: 0 }] }),
    ]) {
      expect(built.ok).toBe(true);
    }
  });

  it('rejects wrong point counts per kind', () => {
    expect(buildOrIssue({ kind: 'note', name: '文本 1', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], text: 'hi' }).code).toBe('bad-vertex-count');
    expect(buildOrIssue({ kind: 'rect', name: '矩形 1', points: [{ x: 0, y: 0 }] }).code).toBe('bad-vertex-count');
    expect(buildOrIssue({ kind: 'triangle', name: '三角形 1', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }).code).toBe('bad-vertex-count');
    expect(buildOrIssue({ kind: 'line', name: '线段 1', points: [{ x: 0, y: 0 }] }).code).toBe('bad-vertex-count');
  });

  it('rejects a circle without a positive radius, or with a tiny radius', () => {
    expect(buildOrIssue({ kind: 'circle', name: '圆形 1', points: [{ x: 0, y: 0 }] }).code).toBe('bad-radius');
    expect(buildOrIssue({ kind: 'circle', name: '圆形 1', points: [{ x: 0, y: 0 }], radiusM: 0 }).code).toBe('bad-radius');
    expect(buildOrIssue({ kind: 'circle', name: '圆形 1', points: [{ x: 0, y: 0 }], radiusM: 0.2 }).code).toBe('too-small');
  });

  it('rejects degenerate rect/line drags (<0.5 m)', () => {
    expect(buildOrIssue({ kind: 'rect', name: '矩形 1', points: [{ x: 0, y: 0 }, { x: 0.2, y: 0.2 }] }).code).toBe('too-small');
    expect(buildOrIssue({ kind: 'rect', name: '矩形 1', points: [{ x: 0, y: 0 }, { x: 8, y: 0.1 }] }).code).toBe('too-small');
    expect(buildOrIssue({ kind: 'line', name: '线段 1', points: [{ x: 0, y: 0 }, { x: 0.3, y: 0 }] }).code).toBe('too-small');
  });

  it('rejects empty note text, duplicate vertices and out-of-range points', () => {
    expect(buildOrIssue({ kind: 'note', name: '文本 1', points: [{ x: 0, y: 0 }], text: '   ' }).code).toBe('empty-text');
    expect(buildOrIssue({ kind: 'triangle', name: '三角形 1', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }] }).code).toBe('duplicate-vertex');
    expect(buildOrIssue({ kind: 'rect', name: '矩形 1', points: [{ x: 0, y: 0 }, { x: 6000, y: 8 }] }).code).toBe('out-of-range');
  });

  it('keeps circle radiusM on the built annotation and drops it for other kinds', () => {
    const circle = buildAnnotation({ kind: 'circle', name: '圆形 1', points: [{ x: 0, y: 0 }], radiusM: 3 });
    expect(circle.ok && circle.value.radiusM).toBe(3);
    const rect = buildAnnotation({ kind: 'rect', name: '矩形 1', points: [{ x: 0, y: 0 }, { x: 4, y: 4 }], radiusM: 3 });
    expect(rect.ok && rect.value.radiusM).toBeUndefined();
  });

  it('reports shape draft targets: 2 points for rect/circle/line, 3 for triangle', () => {
    expect(PLAN_SHAPE_KINDS).toEqual(['rect', 'circle', 'triangle', 'line']);
    expect(planShapeDraftTarget('rect')).toBe(2);
    expect(planShapeDraftTarget('circle')).toBe(2);
    expect(planShapeDraftTarget('line')).toBe(2);
    expect(planShapeDraftTarget('triangle')).toBe(3);
  });
});

describe('annotationRectRing (2026-11-11)', () => {
  it('normalizes a diagonal drag into an axis-aligned four-corner ring', () => {
    const ring = annotationRectRing({ x: 10, y: 8 }, { x: 2, y: 1 });
    expect(ring).toEqual([
      { x: 2, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 8 }, { x: 2, y: 8 },
    ]);
  });

  it('expands to a square when square=true (Shift 正方形同口径)', () => {
    const ring = annotationRectRing({ x: 0, y: 0 }, { x: 3, y: 10 }, true);
    const xs = ring.map(p => p.x);
    const ys = ring.map(p => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(10);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(10);
  });
});

describe('annotationDistanceM hit geometry (2026-11-11)', () => {
  it('note: distance to the anchor point', () => {
    const d = annotationDistanceM({ x: 3, y: 4 }, { kind: 'note', points: [{ x: 0, y: 0 }] });
    expect(d).toBeCloseTo(5, 9);
  });

  it('line: distance to the segment, clamped at endpoints', () => {
    const line = { kind: 'line' as const, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] };
    expect(annotationDistanceM({ x: 5, y: 3 }, line)).toBeCloseTo(3, 9);
    expect(annotationDistanceM({ x: -4, y: 0 }, line)).toBeCloseTo(4, 9);
  });

  it('circle: 0 inside, ring distance outside', () => {
    const circle = { kind: 'circle' as const, points: [{ x: 0, y: 0 }], radiusM: 5 };
    expect(annotationDistanceM({ x: 3, y: 0 }, circle)).toBe(0);
    expect(annotationDistanceM({ x: 8, y: 0 }, circle)).toBeCloseTo(3, 9);
  });

  it('rect: 0 inside, edge distance outside', () => {
    const rect = { kind: 'rect' as const, points: [{ x: 0, y: 0 }, { x: 10, y: 6 }] };
    expect(annotationDistanceM({ x: 5, y: 3 }, rect)).toBe(0);
    expect(annotationDistanceM({ x: 13, y: 3 }, rect)).toBeCloseTo(3, 9);
  });

  it('triangle: 0 inside, edge distance outside', () => {
    const triangle = { kind: 'triangle' as const, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }] };
    expect(annotationDistanceM({ x: 5, y: 2 }, triangle)).toBe(0);
    expect(annotationDistanceM({ x: 5, y: -3 }, triangle)).toBeCloseTo(3, 9);
  });
});

describe('annotations in the contract & plan views (2026-11-11)', () => {
  it('parses legacy plans without the annotations field (optional, same as measurements)', () => {
    const result = sitePlanDataSchema.safeParse(basePlan());
    expect(result.success).toBe(true);
  });

  it('rejects a circle annotation without radiusM at the contract boundary', () => {
    const rect = buildAnnotation({ kind: 'rect', name: '矩形 1', points: [{ x: 0, y: 0 }, { x: 4, y: 4 }] });
    expect(rect.ok).toBe(true);
    if (!rect.ok) return;
    const broken = { ...basePlan(), annotations: [{ ...rect.value, kind: 'circle', points: [{ x: 1, y: 1 }] }] };
    expect(sitePlanDataSchema.safeParse(broken).success).toBe(false);
  });

  it('round-trips annotations through the schema (color lower-cased, text kept)', () => {
    const note = buildAnnotation({ kind: 'note', name: '文本 1', points: [{ x: 2, y: 3 }], text: '主入口', color: '#FFAA00' });
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    const parsed = sitePlanDataSchema.safeParse({ ...basePlan(), annotations: [note.value] });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.annotations?.[0]?.color).toBe('#ffaa00');
    expect(parsed.data.annotations?.[0]?.text).toBe('主入口');
  });

  it('round-trips strokeWidth for shapes and leaves old plans without it valid', () => {
    const rect = buildAnnotation({ kind: 'rect', name: '矩形 1', points: [{ x: 0, y: 0 }, { x: 4, y: 4 }], strokeWidth: 'thick' });
    expect(rect.ok).toBe(true);
    if (!rect.ok) return;
    expect(rect.value.strokeWidth).toBe('thick');
    const parsed = sitePlanDataSchema.safeParse({ ...basePlan(), annotations: [rect.value] });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.annotations?.[0]?.strokeWidth).toBe('thick');

    // 旧快照不带 strokeWidth：照常解析，字段为 undefined（渲染层按细线兜底）。
    const legacy = buildAnnotation({ kind: 'line', name: '线段 1', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }] });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    const legacyParsed = sitePlanDataSchema.safeParse({ ...basePlan(), annotations: [legacy.value] });
    expect(legacyParsed.success).toBe(true);
    if (!legacyParsed.success) return;
    expect(legacyParsed.data.annotations?.[0]?.strokeWidth).toBeUndefined();
  });

  it('counts annotations in overview stats without touching conflicts', () => {
    const rect = buildAnnotation({ kind: 'rect', name: '矩形 1', points: [{ x: 1, y: 1 }, { x: 9, y: 5 }] });
    const line = buildAnnotation({ kind: 'line', name: '线段 1', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }] });
    expect(rect.ok && line.ok).toBe(true);
    if (!rect.ok || !line.ok) return;
    const stats = planOverviewStats({ ...basePlan(), annotations: [rect.value, line.value] });
    expect(stats.annotationCount).toBe(2);
    expect(stats.conflictCount).toBe(0);
    expect(stats.issueCount).toBe(0);
  });

  it('filters annotations by level together with the other entities', () => {
    const rect = buildAnnotation({ kind: 'rect', name: '矩形 1', points: [{ x: 1, y: 1 }, { x: 9, y: 5 }] });
    expect(rect.ok).toBe(true);
    if (!rect.ok) return;
    const plan: SitePlanData = {
      ...basePlan(),
      levels: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Level 1' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Level 2' },
      ],
      annotations: [
        { ...rect.value, levelId: '11111111-1111-4111-8111-111111111111' },
        { ...rect.value, id: '33333333-3333-4333-8333-333333333333', levelId: '22222222-2222-4222-8222-222222222222' },
      ],
    };
    const l1 = filterPlanByLevel(plan, '11111111-1111-4111-8111-111111111111');
    const l2 = filterPlanByLevel(plan, '22222222-2222-4222-8222-222222222222');
    expect(l1.annotations?.length).toBe(1);
    expect(l1.annotations?.[0]?.name).toBe('矩形 1');
    expect(l2.annotations?.[0]?.id).toBe('33333333-3333-4333-8333-333333333333');
    // 未打 levelId 的标注归第一层。
    const legacy = { ...rect.value, id: '44444444-4444-4444-8444-444444444444' };
    delete (legacy as { levelId?: string }).levelId;
    const planWithLegacy: SitePlanData = { ...plan, annotations: [...(plan.annotations ?? []), legacy] };
    expect(filterPlanByLevel(planWithLegacy, '11111111-1111-4111-8111-111111111111').annotations?.length).toBe(2);
  });
});
