import { describe, expect, it } from 'vitest';
import {
  FACILITY_ROTATE_GAP_PX,
  PLAN_FACILITY_TEMPLATES,
  buildFacility,
  facilityContainsPoint,
  facilityFootprintRing,
  facilityGroupAlign,
  facilityGroupBounds,
  facilityGroupDistribute,
  facilityGroupScale,
  facilityHandleAt,
  facilityHandles,
  facilityHandlesUsable,
  facilityInRect,
  facilityLocalPoint,
  facilityPassesContract,
  facilityPlacementIssues,
  facilitySideResize,
  facilityTemplatesValid,
  FACILITY_HANDLE_MIN_FOOTPRINT_PX,
  findFacilityTemplate,
  footprintSelfCheck,
  nextFacilityName,
  planFacilityIssues,
} from './site-plan-facilities';
import { planMetersPerPixel } from './outdoor-plan-canvas';
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

  /* 2026-11-12 OnePlan「+ Object setup」镜像字段：可选直通，旧数据缺字段照常解析。 */
  it('parses legacy facilities without vendor fields and passes Object-setup fields through', () => {
    const base = {
      id: 'b3000000-0000-4000-8000-000000000001',
      templateId: 'booth-2x2',
      name: '市集摊位 1',
      position: { x: 60, y: 80 },
      rotationDeg: 0,
      size: { width: 2, depth: 2 },
    };
    const legacy = planFacilitySchema.parse(base);
    expect(legacy.vendorName).toBeUndefined();
    expect(legacy.electricKw).toBeUndefined();
    const filled = planFacilitySchema.parse({
      ...base,
      vendorName: '某某搭建',
      vendorZone: 'A 区',
      inDate: '2026-11-20',
      inTime: '08:30',
      outDate: '2026-11-21',
      outTime: '23:59',
      electricKw: 3.5,
    });
    expect(filled.vendorName).toBe('某某搭建');
    expect(filled.inTime).toBe('08:30');
    expect(filled.electricKw).toBe(3.5);
    expect(planFacilitySchema.safeParse({ ...base, electricKw: -1 }).success).toBe(false);
    // 描边四态：合法值直通、缺省不出现、非法值拒绝。
    expect(planFacilitySchema.parse({ ...base, strokeStyle: 'dashed' }).strokeStyle).toBe('dashed');
    expect(planFacilitySchema.parse({ ...base, strokeStyle: 'none' }).strokeStyle).toBe('none');
    expect(planFacilitySchema.parse(base).strokeStyle).toBeUndefined();
    expect(planFacilitySchema.safeParse({ ...base, strokeStyle: 'double' }).success).toBe(false);
  });

  /* V-5a 3D 模型手动 override（facility.modelOverride 存物料库 slug）：可选直通，旧数据缺字段照常解析。 */
  it('parses legacy facilities without modelOverride and round-trips a model override through JSON', () => {
    const base = {
      id: 'b4000000-0000-4000-8000-000000000001',
      templateId: 'tent-3x3',
      name: '后勤帐篷 1',
      position: { x: 60, y: 80 },
      rotationDeg: 0,
      size: { width: 3, depth: 3 },
    };
    // 旧快照不带 modelOverride 照常解析（optional 直通，不虚构字段）。
    const legacy = planFacilitySchema.parse(base);
    expect(legacy.modelOverride).toBeUndefined();
    // 写入 override：合法 slug 直通。
    const slug = 'mountaineering-and-summit-expedition-base-camp-dome-te-e93b01ea';
    const overridden = planFacilitySchema.parse({ ...base, modelOverride: slug });
    expect(overridden.modelOverride).toBe(slug);
    // JSON 快照往返（落库/回读同一条路径）：override 字段原样保留。
    const restored = planFacilitySchema.parse(JSON.parse(JSON.stringify(overridden)));
    expect(restored.modelOverride).toBe(slug);
    // 清除 override：undefined 直通，JSON 序列化丢键后照常解析（回到自动挑选语义）。
    const cleared = planFacilitySchema.parse({ ...overridden, modelOverride: undefined });
    expect(cleared.modelOverride).toBeUndefined();
    expect(planFacilitySchema.parse(JSON.parse(JSON.stringify(cleared))).modelOverride).toBeUndefined();
    // 非法值拒绝：空串与超长 slug 不进契约。
    expect(planFacilitySchema.safeParse({ ...base, modelOverride: '' }).success).toBe(false);
    expect(planFacilitySchema.safeParse({ ...base, modelOverride: 'x'.repeat(161) }).success).toBe(false);
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

/* ---------------- P2-i：设施编辑手柄（北侧旋转柄 + 命中判定） ---------------- */

const HANDLE_VIEWPORT = { lng: 120.146, lat: 30.252, zoom: 19, canvasW: 1000, canvasH: 700 };
const HANDLE_CENTER = { x: HANDLE_VIEWPORT.canvasW / 2, y: HANDLE_VIEWPORT.canvasH / 2 };

function handleFacility(rotationDeg = 0, width = 12, depth = 12) {
  return { position: { x: 0, y: 0 }, rotationDeg, size: { width, depth } };
}

describe('facility edit handles', () => {
  it('旋转柄在北侧（与顶边中点同侧），间距 = 半深 + 26px 折算', () => {
    const facility = handleFacility();
    const viewport = HANDLE_VIEWPORT;
    const handles = facilityHandles(facility, viewport);
    const mpp = planMetersPerPixel(viewport);
    const gapPx = (facility.size.depth / 2 + FACILITY_ROTATE_GAP_PX * mpp) / mpp;
    expect(handles.rotate.x).toBeCloseTo(HANDLE_CENTER.x, 3);
    expect(handles.rotate.y).toBeCloseTo(HANDLE_CENTER.y - gapPx, 3);
    expect(handles.rotate.y).toBeLessThan(handles.topMid.y);
    expect(handles.topMid.y).toBeLessThan(HANDLE_CENTER.y);
  });

  it('旋转 90° 后旋转柄转到西侧（北向单位向量随占地一起转）', () => {
    const handles = facilityHandles(handleFacility(90), HANDLE_VIEWPORT);
    expect(handles.rotate.x).toBeLessThan(HANDLE_CENTER.x - 10);
    expect(handles.rotate.y).toBeCloseTo(HANDLE_CENTER.y, 3);
  });

  it('命中判定：旋转柄 → rotate，四边中点 → side，四角 → resize，本体中心 → null', () => {
    const facility = handleFacility(15);
    const viewport = HANDLE_VIEWPORT;
    const handles = facilityHandles(facility, viewport);
    expect(facilityHandleAt(facility, viewport, handles.rotate)).toEqual({ kind: 'rotate', corner: null, side: null });
    handles.sides.forEach((side, i) => {
      expect(facilityHandleAt(facility, viewport, side)).toEqual({ kind: 'side', corner: null, side: i });
    });
    handles.corners.forEach((corner, i) => {
      expect(facilityHandleAt(facility, viewport, corner)).toEqual({ kind: 'resize', corner: i, side: null });
    });
    expect(facilityHandleAt(facility, viewport, HANDLE_CENTER)).toBeNull();
  });

  it('单面拉伸：南面拖动只改深度，北面固定，中心沿深度轴平移', () => {
    const facility = handleFacility(0, 10, 6);
    const next = facilitySideResize(facility, 0, { x: 0, y: -5 }, { minM: 0.5, maxM: 100 });
    // 南面 v=-3 → 指针 v=-5 → 深度 8；北面 v=+3 固定 → 中心南移 1 m。
    expect(next.size.depth).toBeCloseTo(8, 6);
    expect(next.size.width).toBeCloseTo(10, 6);
    expect(next.position.y).toBeCloseTo(-1, 6);
    expect(next.position.x).toBeCloseTo(0, 6);
    const ys = facilityFootprintRing({ ...next, rotationDeg: 0 }).map(p => p.y);
    expect(Math.max(...ys)).toBeCloseTo(3, 6);
  });

  it('单面拉伸：东面拖动只改宽度，西面固定', () => {
    const facility = handleFacility(0, 10, 6);
    const next = facilitySideResize(facility, 1, { x: 9, y: 0 }, { minM: 0.5, maxM: 100 });
    expect(next.size.width).toBeCloseTo(14, 6);
    expect(next.size.depth).toBeCloseTo(6, 6);
    expect(next.position.x).toBeCloseTo(2, 6);
    const xs = facilityFootprintRing({ ...next, rotationDeg: 0 }).map(p => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-5, 6);
  });

  it('单面拉伸：越过中心被最小尺寸夹住，对面纹丝不动', () => {
    const facility = handleFacility(0, 10, 6);
    const next = facilitySideResize(facility, 0, { x: 0, y: 30 }, { minM: 0.5, maxM: 100 });
    expect(next.size.depth).toBeCloseTo(0.5, 6);
    const ys = facilityFootprintRing({ ...next, rotationDeg: 0 }).map(p => p.y);
    expect(Math.max(...ys)).toBeCloseTo(3, 6);
  });

  it('单面拉伸：旋转 90° 后拖「南面」仍改深度（v 轴随占地一起转），中心矩阵回位', () => {
    const facility = handleFacility(90, 10, 6);
    const next = facilitySideResize(facility, 0, { x: 5, y: 0 }, { minM: 0.5, maxM: 100 });
    expect(next.size.depth).toBeCloseTo(8, 6);
    expect(next.size.width).toBeCloseTo(10, 6);
    expect(next.position.x).toBeCloseTo(1, 6);
    expect(next.position.y).toBeCloseTo(0, 6);
  });

  it('占地太小（< 20px）时挂「虚拟外扩盒」手柄：手柄在中心外 10px 处，仍可命中', () => {
    const tiny = handleFacility(0, 1, 1); // 1m @ z19 ≈ 3.4px
    expect(facilityHandlesUsable(tiny, HANDLE_VIEWPORT)).toBe(false);
    const handles = facilityHandles(tiny, HANDLE_VIEWPORT, FACILITY_HANDLE_MIN_FOOTPRINT_PX);
    // 虚拟盒半宽 = 10px：旋转柄在中心上方 10 + 26 = 36px
    expect(handles.rotate.y).toBeCloseTo(HANDLE_CENTER.y - 36, 0);
    const hit = facilityHandleAt(tiny, HANDLE_VIEWPORT, handles.rotate, FACILITY_HANDLE_MIN_FOOTPRINT_PX);
    expect(hit).toEqual({ kind: 'rotate', corner: null, side: null });
  });
});

describe('facility group selection (2026-11-12 OnePlan Selection tool)', () => {
  const groupOfTwo = [
    { id: 'g1', position: { x: 10, y: 10 }, rotationDeg: 0, size: { width: 2, depth: 2 } },
    { id: 'g2', position: { x: 20, y: 16 }, rotationDeg: 90, size: { width: 8, depth: 6 } },
  ] as const;

  it('组包围盒 = 全部足迹环的轴对齐外接矩形（含旋转件）', () => {
    const bounds = facilityGroupBounds(groupOfTwo);
    // g2 旋转 90°：占地变为东西 6、南北 8，四至 x∈[17,23] y∈[12,20]。
    expect(bounds).not.toBeNull();
    expect(bounds!.minX).toBeCloseTo(9, 6);
    expect(bounds!.minY).toBeCloseTo(9, 6);
    expect(bounds!.maxX).toBeCloseTo(23, 6);
    expect(bounds!.maxY).toBeCloseTo(20, 6);
  });

  it('组包围盒：空组返回 null', () => {
    expect(facilityGroupBounds([])).toBeNull();
  });

  it('框选命中：中心入矩形或足迹顶点入矩形都算，全在外不算', () => {
    // 矩形只罩住 g2 的上半截（g2 旋转 90° 占 y∈[12,20]）：顶点入矩形即命中。
    const topHalf = { minX: 16, minY: 18, maxX: 24, maxY: 22 };
    expect(facilityInRect(groupOfTwo[1], topHalf)).toBe(true);
    expect(facilityInRect(groupOfTwo[0], topHalf)).toBe(false);
    // 中心命中：矩形很小但罩住 g1 中心。
    const tinyAroundCenter = { minX: 9.5, minY: 9.5, maxX: 10.5, maxY: 10.5 };
    expect(facilityInRect(groupOfTwo[0], tinyAroundCenter)).toBe(true);
    expect(facilityInRect(groupOfTwo[1], tinyAroundCenter)).toBe(false);
  });

  it('组等比缩放：位置绕锚点缩放、尺寸乘同一系数，rotation 不变', () => {
    const anchor = { x: 9, y: 9 };
    const next = facilityGroupScale([...groupOfTwo], anchor, 2, { minM: 0.5, maxM: 100 });
    expect(next[0]!.position).toEqual({ x: 11, y: 11 }); // 锚(9,9) + (1,1)×2
    expect(next[0]!.size).toEqual({ width: 4, depth: 4 });
    expect(next[1]!.rotationDeg).toBe(90);
    expect(next[1]!.size.width).toBeCloseTo(16, 6);
    expect(next[1]!.size.depth).toBeCloseTo(12, 6);
    expect(next[1]!.position.x).toBeCloseTo(9 + 11 * 2, 6);
    expect(next[1]!.position.y).toBeCloseTo(9 + 7 * 2, 6);
  });

  it('组等比缩放：单件顶到夹紧界不回推系数（逐件独立夹紧），非有限/非正系数原样返回', () => {
    const clamped = facilityGroupScale([groupOfTwo[0]], { x: 0, y: 0 }, 200, { minM: 0.5, maxM: 100 });
    expect(clamped[0]!.size.width).toBe(100);
    const raw = groupOfTwo[0];
    expect(facilityGroupScale([raw], { x: 0, y: 0 }, -1, { minM: 0.5, maxM: 100 })[0]!.size).toEqual(raw.size);
    expect(facilityGroupScale([raw], { x: 0, y: 0 }, Number.NaN, { minM: 0.5, maxM: 100 })[0]!.position).toEqual(raw.position);
  });

  it('组对齐：左对齐把每件足迹左缘贴到组最左（位移只沿 x），上对齐走 max-y', () => {
    // g1 2×2 @ (10,10) x∈[9,11]；g2 旋转 90° 8×6 @ (20,16) x∈[17,23] → 组 minX=9。
    const aligned = facilityGroupAlign([...groupOfTwo], 'min-x');
    expect(facilityGroupBounds(aligned)!.minX).toBeCloseTo(9, 6);
    expect(aligned[0]!.position.x).toBeCloseTo(10, 6); // 本来就是最左，不动
    expect(aligned[1]!.position.x).toBeCloseTo(20 + (9 - 17), 6); // 左缘 17 → 9，位移 -8
    expect(aligned[1]!.position.y).toBeCloseTo(16, 6);
    // 上对齐：组 maxY=20（g2 北缘）；g1 顶缘 11 → 平移到 20。
    const topped = facilityGroupAlign([...groupOfTwo], 'max-y');
    expect(topped[0]!.position.y).toBeCloseTo(10 + (20 - 11), 6);
    expect(topped[1]!.position.y).toBeCloseTo(16, 6);
  });

  it('组等距：按中心在首尾之间均匀分布（<3 件原样返回）', () => {
    const three = [
      { position: { x: 0, y: 0 }, rotationDeg: 0, size: { width: 2, depth: 2 } },
      { position: { x: 3, y: 0 }, rotationDeg: 0, size: { width: 2, depth: 2 } },
      { position: { x: 10, y: 0 }, rotationDeg: 0, size: { width: 2, depth: 2 } },
    ];
    expect(facilityGroupDistribute(three.slice(0, 2), 'x')).toEqual(three.slice(0, 2));
    const spread = facilityGroupDistribute(three, 'x');
    const centers = spread.map(f => f.position.x);
    expect(centers[0]).toBeCloseTo(0, 6);
    expect(centers[1]).toBeCloseTo(5, 6); // (0+10)/2
    expect(centers[2]).toBeCloseTo(10, 6);
  });
});
