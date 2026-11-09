import { describe, expect, it } from 'vitest';
import {
  PLAN_FACILITY_TEMPLATES,
  buildFacility,
  facilityContainsPoint,
  facilityFootprintRing,
  facilityLocalPoint,
  facilityPassesContract,
  facilityPlacementIssues,
  facilityTemplatesValid,
  findFacilityTemplate,
  footprintSelfCheck,
  nextFacilityName,
  planFacilityIssues,
} from './site-plan-facilities';
import { planRingSelfIntersects } from './site-plan-editing';
import { planFacilitySchema, planRingAreaM2 } from '../../../../supabase/functions/_shared/site-plan';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

const rect = (x0: number, y0: number, w: number, h: number): PlanPoint[] => [
  { x: x0, y: y0 },
  { x: x0 + w, y: y0 },
  { x: x0 + w, y: y0 + h },
  { x: x0, y: y0 + h },
];
const BOUNDARY = rect(0, 0, 200, 120); // 24,000 m²

describe('facility template catalog (H2-c)', () => {
  it('keeps a non-empty catalog with unique contract-safe template ids and sizes', () => {
    expect(PLAN_FACILITY_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    expect(facilityTemplatesValid()).toBe(true);
    // 目录里必须包含 H2-a 样例已用的两个 templateId，旧数据不悬空。
    expect(findFacilityTemplate('booth-2x2')).not.toBeNull();
    expect(findFacilityTemplate('tent-3x3')).not.toBeNull();
    expect(findFacilityTemplate('nope')).toBeNull();
  });
});

describe('facility footprint ring (H2-c)', () => {
  it('places an axis-aligned 2×2 booth corners at ±1 m around the center', () => {
    const ring = facilityFootprintRing({ position: { x: 60, y: 80 }, rotationDeg: 0, size: { width: 2, depth: 2 } });
    expect(ring).toEqual([
      { x: 59, y: 79 },
      { x: 61, y: 79 },
      { x: 61, y: 81 },
      { x: 59, y: 81 },
    ]);
  });

  it('rotates +90° turning the width axis from east to north (canvas-consistent)', () => {
    // 8×6 舞台旋转 90°：占地变为东西 6 m、南北 8 m。
    const ring = facilityFootprintRing({ position: { x: 10, y: 10 }, rotationDeg: 90, size: { width: 8, depth: 6 } });
    expect(ring[0]).toEqual({ x: 13, y: 6 });
    expect(ring[2]).toEqual({ x: 7, y: 14 });
    expect(planRingAreaM2(ring)).toBeCloseTo(48, 6);
  });

  it('keeps area == width×depth and never self-intersects at arbitrary rotations', () => {
    for (const template of PLAN_FACILITY_TEMPLATES) {
      for (const rotationDeg of [15, 33.5, 90, 180, -47]) {
        const check = footprintSelfCheck({ position: { x: 30, y: 40 }, rotationDeg, size: { width: template.width, depth: template.depth } });
        expect(check.selfIntersects).toBe(false);
        expect(check.areaM2).toBeCloseTo(template.width * template.depth, 6);
      }
    }
  });
});

describe('facilityContainsPoint (H2-c 选中命中)', () => {
  it('hits the center and footprint corners, misses just outside', () => {
    const facility = { position: { x: 60, y: 80 }, rotationDeg: 0, size: { width: 2, depth: 2 } };
    expect(facilityContainsPoint({ x: 60, y: 80 }, facility)).toBe(true);
    expect(facilityContainsPoint({ x: 61, y: 81 }, facility)).toBe(true);
    expect(facilityContainsPoint({ x: 61.2, y: 80 }, facility)).toBe(false);
    expect(facilityContainsPoint({ x: 60, y: 78 }, facility)).toBe(false);
  });

  it('respects rotation: a 90°-rotated truck is long north–south', () => {
    const truck = { position: { x: 0, y: 0 }, rotationDeg: 90, size: { width: 6, depth: 2.5 } };
    expect(facilityContainsPoint({ x: 0, y: 2 }, truck)).toBe(true); // 北向 2 m：落入旋转后的长边
    expect(facilityContainsPoint({ x: 2, y: 0 }, truck)).toBe(false); // 东向 2 m：超出旋转后的窄边
  });

  it('round-trips facilityLocalPoint against the footprint corners', () => {
    const facility = { position: { x: 12, y: -8 }, rotationDeg: 33.5, size: { width: 4, depth: 3 } };
    for (const corner of facilityFootprintRing(facility)) {
      const local = facilityLocalPoint(corner, facility);
      expect(Math.abs(local.u)).toBeCloseTo(2, 6);
      expect(Math.abs(local.v)).toBeCloseTo(1.5, 6);
    }
  });
});

describe('buildFacility (H2-c 放置)', () => {
  it('creates a contract-valid instance with auto name numbering per template', () => {
    const existing = [
      { templateId: 'booth-2x2' },
      { templateId: 'booth-2x2' },
      { templateId: 'tent-3x3' },
    ];
    const result = buildFacility({ templateId: 'booth-2x2', position: { x: 60, y: 80 } }, BOUNDARY, existing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('市集摊位 3');
    expect(result.value.size).toEqual({ width: 2, depth: 2 });
    expect(result.value.rotationDeg).toBe(0);
    expect(result.value.notes).toBe('');
    expect(facilityPassesContract(result.value)).toBe(true);
    expect(planFacilitySchema.safeParse(result.value).success).toBe(true);
  });

  it('honours explicit name/id/rotation and clamps rotation into the contract range', () => {
    const result = buildFacility(
      { templateId: 'tent-3x3', position: { x: 180, y: 100 }, name: '指挥帐篷', id: 'b2000000-0000-4000-8000-000000000009', rotationDeg: 400 },
      BOUNDARY,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe('指挥帐篷');
    expect(result.value.id).toBe('b2000000-0000-4000-8000-000000000009');
    expect(result.value.rotationDeg).toBe(360);
  });

  it('allows out-of-boundary placement but returns a warning issue', () => {
    const inside = buildFacility({ templateId: 'booth-2x2', position: { x: 60, y: 80 } }, BOUNDARY);
    expect(inside.ok && inside.issues?.length === 0).toBe(true);
    const corner = buildFacility({ templateId: 'booth-2x2', position: { x: 200, y: 120 } }, BOUNDARY);
    expect(corner.ok).toBe(true);
    if (corner.ok) {
      expect(corner.issues?.length).toBe(1);
      expect(corner.issues?.[0]?.code).toBe('out-of-boundary');
    }
  });

  it('rejects unknown templates and out-of-range positions', () => {
    const unknown = buildFacility({ templateId: 'nope', position: { x: 10, y: 10 } }, BOUNDARY);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issue.code).toBe('unknown-template');
    const far = buildFacility({ templateId: 'booth-2x2', position: { x: 6000, y: 10 } }, BOUNDARY);
    expect(far.ok).toBe(false);
    if (!far.ok) expect(far.issue.code).toBe('out-of-range');
  });
});

describe('planFacilityIssues (H2-c 问题清单)', () => {
  it('lists only facilities whose footprint leaves the boundary', () => {
    const inside = buildFacility({ templateId: 'booth-2x2', position: { x: 60, y: 80 } }, BOUNDARY);
    const outside = buildFacility({ templateId: 'booth-2x2', position: { x: 200, y: 120 } }, BOUNDARY);
    expect(inside.ok && outside.ok).toBe(true);
    if (!inside.ok || !outside.ok) return;
    const issues = planFacilityIssues({
      boundary: BOUNDARY,
      facilities: [inside.value, outside.value],
    });
    expect(issues.length).toBe(1);
    expect(issues[0]?.facilityId).toBe(outside.value.id);
    expect(issues[0]?.facilityName).toBe('市集摊位 1');
    expect(issues[0]?.issue.code).toBe('out-of-boundary');
  });
});

describe('nextFacilityName & facilityPlacementIssues (H2-c)', () => {
  it('numbers names per templateId only', () => {
    const template = findFacilityTemplate('booth-2x2')!;
    const existing = [{ templateId: 'booth-2x2' }, { templateId: 'booth-2x2' }, { templateId: 'tent-3x3' }];
    expect(nextFacilityName(template, existing)).toBe('市集摊位 3');
    expect(nextFacilityName(template, [])).toBe('市集摊位 1');
  });

  it('flags corners outside the boundary and stays silent for edge-touching footprints', () => {
    // 角点越界：半只身子出界的摊位。
    const crossing = facilityPlacementIssues(
      facilityFootprintRing({ position: { x: 200, y: 120 }, rotationDeg: 0, size: { width: 2, depth: 2 } }),
      BOUNDARY,
    );
    expect(crossing.length).toBe(1);
    expect(crossing[0]?.code).toBe('out-of-boundary');
    // 贴边豁免：占地正好内切在边界东沿上不算越界。
    const flush = facilityPlacementIssues(
      facilityFootprintRing({ position: { x: 199, y: 60 }, rotationDeg: 0, size: { width: 2, depth: 2 } }),
      BOUNDARY,
    );
    expect(flush).toHaveLength(0);
  });
});
describe('footprint vs ring self-intersection guard', () => {
  it('ring self-intersection helper stays available for facility footprints', () => {
    const ring = facilityFootprintRing({ position: { x: 0, y: 0 }, rotationDeg: 15, size: { width: 6, depth: 2.5 } });
    expect(planRingSelfIntersects(ring)).toBe(false);
  });
});
