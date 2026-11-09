import { describe, expect, it } from 'vitest';
import {
  PLAN_MIN_BOUNDARY_AREA_M2,
  PLAN_RING_MAX_VERTICES,
  buildZone,
  checkBoundaryRing,
  checkPlanRing,
  defaultZoneColor,
  insertRingVertex,
  moveRingVertex,
  planZoneFillAlpha,
  planZoneIssues,
  planZonesOverlap,
  removeRingVertex,
  zoneOutsideBoundaryIssue,
  zoneSemanticsAlignedWithContract,
} from './site-plan-editing';
import { planZoneSemantics } from '../../../../supabase/functions/_shared/site-plan';
import { PLANNING_ZONE_COLORS } from '@/lib/outdoor-plan-tokens';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

const rect = (x0: number, y0: number, w: number, h: number): PlanPoint[] => [
  { x: x0, y: y0 },
  { x: x0 + w, y: y0 },
  { x: x0 + w, y: y0 + h },
  { x: x0, y: y0 + h },
];
const BOUNDARY = rect(0, 0, 200, 120); // 24,000 m²

describe('site plan editing: boundary ring (H2-b)', () => {
  it('accepts the 200×120 m boundary and keeps 24,000 m²', () => {
    const check = checkBoundaryRing(BOUNDARY);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.areaM2).toBeCloseTo(24000, 6);
  });

  it('rejects fewer than 3 vertices', () => {
    const check = checkBoundaryRing([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue.code).toBe('too-few-vertices');
  });

  it('rejects coincident adjacent vertices', () => {
    const check = checkBoundaryRing([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue.code).toBe('duplicate-vertex');
  });

  it('rejects a self-intersecting bowtie', () => {
    const bowtie: PlanPoint[] = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const check = checkBoundaryRing(bowtie);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue.code).toBe('self-intersection');
  });

  it('rejects boundary area below the 100 m² floor', () => {
    const tiny = rect(0, 0, 5, 5); // 25 m²
    const check = checkBoundaryRing(tiny);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.issue.code).toBe('area-below-min');
      expect(check.issue.message).toContain('100');
    }
    expect(PLAN_MIN_BOUNDARY_AREA_M2).toBe(100);
  });

  it('rejects rings above the 64-vertex contract limit', () => {
    // 65 顶点凸圆环：间距约 9.7 m（不触发重合），不自交，面积足够大——只卡顶点数。
    const circle: PlanPoint[] = [];
    for (let i = 0; i < PLAN_RING_MAX_VERTICES + 1; i++) {
      const angle = (i / (PLAN_RING_MAX_VERTICES + 1)) * Math.PI * 2;
      circle.push({ x: Math.cos(angle) * 100, y: Math.sin(angle) * 100 });
    }
    const check = checkPlanRing(circle, PLAN_MIN_BOUNDARY_AREA_M2, '场地边界');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issue.code).toBe('too-many-vertices');
  });
});

describe('site plan editing: vertex editing (H2-b)', () => {
  it('moves a vertex and recomputes the area', () => {
    const moved = moveRingVertex(BOUNDARY, 0, { x: -50, y: -50 });
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value[0]).toEqual({ x: -50, y: -50 });
      // 梯形：(250+200)/2 * (120+50)... 直接用鞋带复算——面积只增不减。
      let sum = 0;
      for (let i = 0; i < moved.value.length; i++) {
        const a = moved.value[i]!;
        const b = moved.value[(i + 1) % moved.value.length]!;
        sum += a.x * b.y - b.x * a.y;
      }
      expect(Math.abs(sum) / 2).toBeGreaterThan(24000);
    }
  });

  it('rejects a move that collapses onto a neighbour', () => {
    const moved = moveRingVertex(BOUNDARY, 0, { x: 200, y: 0 });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.issue.code).toBe('duplicate-vertex');
  });

  it('rejects a move that makes the ring self-intersect', () => {
    // (0,0) 拖到 (300,-10)：边 (0,120)-(300,-10) 穿过右边界 (200,0)-(200,120)。
    const moved = moveRingVertex(BOUNDARY, 0, { x: 300, y: -10 });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.issue.code).toBe('self-intersection');
  });

  it('rejects out-of-range vertex index and non-finite coordinates', () => {
    expect(moveRingVertex(BOUNDARY, 4, { x: 1, y: 1 }).ok).toBe(false);
    expect(moveRingVertex(BOUNDARY, 0, { x: Number.NaN, y: 1 }).ok).toBe(false);
  });

  it('inserts a midpoint on an edge without changing the area', () => {
    const inserted = insertRingVertex(BOUNDARY, 0, { x: 100, y: 0 });
    expect(inserted.ok).toBe(true);
    if (inserted.ok) {
      expect(inserted.value).toHaveLength(5);
      let sum = 0;
      for (let i = 0; i < inserted.value.length; i++) {
        const a = inserted.value[i]!;
        const b = inserted.value[(i + 1) % inserted.value.length]!;
        sum += a.x * b.y - b.x * a.y;
      }
      expect(Math.abs(sum) / 2).toBeCloseTo(24000, 6);
    }
  });

  it('rejects insertion beyond the vertex limit and bad edge index', () => {
    expect(insertRingVertex(BOUNDARY, 7, { x: 0, y: 0 }).ok).toBe(false);
    expect(insertRingVertex(BOUNDARY, -1, { x: 0, y: 0 }).ok).toBe(false);
  });

  it('removes a vertex from a 4-ring and refuses to go below 3', () => {
    const removed = removeRingVertex(BOUNDARY, 0);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.value).toHaveLength(3);
    const triangle = removed.ok ? removed.value : [];
    expect(removeRingVertex(triangle, 0).ok).toBe(false);
  });

  it('rejects removal with a bad index', () => {
    expect(removeRingVertex(BOUNDARY, -1).ok).toBe(false);
    expect(removeRingVertex(BOUNDARY, 9).ok).toBe(false);
  });
});

describe('site plan editing: zone boundary containment (H2-b)', () => {
  // 带凹口的 L 形边界：底条 y∈[0,40] 全宽 + 左塔 x∈[0,60]；凹口 [80,120]×[15,40] 为场外。
  const NOTCHED: PlanPoint[] = [
    { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 40 }, { x: 120, y: 40 },
    { x: 120, y: 15 }, { x: 80, y: 15 }, { x: 80, y: 40 }, { x: 0, y: 40 },
  ];

  it('passes a fully contained zone and a zone touching the boundary edge', () => {
    expect(zoneOutsideBoundaryIssue(rect(10, 10, 50, 20), BOUNDARY)).toBeNull();
    // 贴边内沿：分区底边与场地底边共线——不算越界。
    expect(zoneOutsideBoundaryIssue(rect(0, 0, 40, 30), BOUNDARY)).toBeNull();
  });

  it('flags a zone vertex outside the boundary', () => {
    const issue = zoneOutsideBoundaryIssue(rect(180, 100, 40, 30), BOUNDARY);
    expect(issue?.code).toBe('out-of-boundary');
    expect(issue?.at).toBeDefined();
  });

  it('flags a zone whose edge pokes into an outside notch while all vertices stay inside', () => {
    const zone = rect(60, 10, 80, 10); // y∈[10,20]，横边穿过凹口
    const issue = zoneOutsideBoundaryIssue(zone, NOTCHED);
    expect(issue?.code).toBe('out-of-boundary');
  });
});

describe('site plan editing: zone overlap (H2-b)', () => {
  it('detects overlapping, contained zones; accepts separated and edge-adjacent ones', () => {
    expect(planZonesOverlap(rect(0, 0, 40, 30), rect(20, 10, 40, 30))).toBe(true);
    expect(planZonesOverlap(rect(0, 0, 40, 30), rect(10, 10, 10, 10))).toBe(true); // 包含
    expect(planZonesOverlap(rect(0, 0, 40, 30), rect(100, 100, 20, 10))).toBe(false); // 分离
    expect(planZonesOverlap(rect(0, 0, 40, 30), rect(40, 0, 20, 30))).toBe(false); // 共边相邻
  });
});

describe('site plan editing: plan zone issues (H2-b)', () => {
  it('lists out-of-boundary and pairwise overlaps with zone names, in stable order', () => {
    const issues = planZoneIssues({
      boundary: BOUNDARY,
      zones: [
        { id: 'z1', name: '越界区', polygon: rect(180, 100, 40, 30) },
        { id: 'z2', name: '甲', polygon: rect(0, 0, 40, 30) },
        { id: 'z3', name: '乙', polygon: rect(20, 10, 40, 30) },
      ],
    });
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ zoneId: 'z1', zoneName: '越界区' });
    expect(issues[0]!.issue.code).toBe('out-of-boundary');
    expect(issues[1]).toMatchObject({ zoneId: 'z2', zoneName: '甲', otherZoneName: '乙' });
    expect(issues[1]!.issue.code).toBe('zones-overlap');
  });

  it('returns nothing for a clean plan', () => {
    expect(planZoneIssues({
      boundary: BOUNDARY,
      zones: [{ id: 'z1', name: '观众区', polygon: rect(10, 10, 50, 20) }],
    })).toEqual([]);
  });
});

describe('site plan editing: buildZone (H2-b)', () => {
  it('builds a zone with the semantic default colour and empty notes', () => {
    const result = buildZone({ semantic: 'medical', name: '医疗点', polygon: rect(10, 10, 20, 15) }, BOUNDARY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.color).toBe(PLANNING_ZONE_COLORS.medical);
      expect(result.value.notes).toBe('');
      expect(result.value.opacity).toBeUndefined();
      expect(result.issues ?? []).toEqual([]);
    }
  });

  it('keeps an explicit opacity and id when provided', () => {
    const result = buildZone(
      { semantic: 'vip', name: 'VIP 区', polygon: rect(10, 10, 20, 15), opacity: 0.4, id: '00000000-0000-4000-8000-0000000000ff' },
      BOUNDARY,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.opacity).toBe(0.4);
      expect(result.value.id).toBe('00000000-0000-4000-8000-0000000000ff');
    }
  });

  it('blocks degenerate and self-intersecting submissions', () => {
    const tiny = buildZone({ semantic: 'queue', name: '排队区', polygon: rect(0, 0, 0.5, 0.5) }, BOUNDARY);
    expect(tiny.ok).toBe(false);
    if (!tiny.ok) expect(tiny.issue.code).toBe('area-below-min');

    const bowtie = buildZone({
      semantic: 'queue',
      name: '排队区',
      polygon: [{ x: 0, y: 0 }, { x: 30, y: 30 }, { x: 30, y: 0 }, { x: 0, y: 30 }],
    }, BOUNDARY);
    expect(bowtie.ok).toBe(false);
    if (!bowtie.ok) expect(bowtie.issue.code).toBe('self-intersection');
  });

  it('allows out-of-boundary submission but reports the issue (蓝图口径)', () => {
    const result = buildZone({ semantic: 'parking', name: '停车区', polygon: rect(180, 100, 40, 30) }, BOUNDARY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues?.some(i => i.code === 'out-of-boundary')).toBe(true);
    }
  });

  it('reports overlap with existing zones', () => {
    const existing = [{ id: 'z1', name: '观众区', polygon: rect(0, 0, 40, 30) }];
    const result = buildZone({ semantic: 'queue', name: '排队区', polygon: rect(20, 10, 40, 30) }, BOUNDARY, existing);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issues?.some(i => i.code === 'zones-overlap')).toBe(true);
    }
  });
});

describe('site plan editing: zone styling helpers (H2-b)', () => {
  it('fills alpha from explicit opacity or the token default, clamped to the band', () => {
    expect(planZoneFillAlpha({})).toBe(0.22);
    expect(planZoneFillAlpha({ opacity: 0.35 })).toBe(0.35);
    expect(planZoneFillAlpha({ opacity: 0.01 })).toBe(0.05);
    expect(planZoneFillAlpha({ opacity: 0.9 })).toBe(0.6);
  });

  it('covers every contract semantic with a colour (tokens ↔ 契约不漂移)', () => {
    expect(zoneSemanticsAlignedWithContract(planZoneSemantics)).toBe(true);
    expect(zoneSemanticsAlignedWithContract(['stage', 'audience'])).toBe(false);
    for (const semantic of planZoneSemantics) {
      expect(defaultZoneColor(semantic)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
