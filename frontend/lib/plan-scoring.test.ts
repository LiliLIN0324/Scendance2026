/**
 * plan-scoring.ts 单测。
 *
 * 策略：
 * - flow-constraints 整体 mock（并行任务在写，本测试只关心打分公式是否正确套用返回值）；
 * - plan-approve 部分 mock（保留真实导出，planZones 换成可 mock 的 vi.fn）；
 * - 8 例以上，覆盖 spec 列出的全部验收点。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- mock flow-constraints：默认无签到区、动线合规、可达性全可达 ----
vi.mock('./flow-constraints', () => ({
  AISLE_MIN_NORMAL: 1.2,
  AISLE_MIN_WHEELCHAIR: 1.5,
  evaluateFlow: vi.fn(() => ({
    aisleWidthM: Infinity,
    wheelChairPassable: true,
    normalPassable: true,
    checkinBlocked: false,
    violations: [] as string[],
  })),
  evaluateReachability: vi.fn(() => ({
    reachableZones: [] as string[],
    unreachableZones: [] as string[],
    violations: [] as Array<{ code: string; severity: 'hard' | 'soft'; message: string }>,
    pairReachability: [] as Array<{ from: string; to: string; connected: boolean }>,
    blockedBy: [] as Array<{ zoneId: string; blockedFurnitureIds: string[]; coverageRatio: number }>,
  })),
}));

// ---- mock human-factors：默认无 violation（避免现有用例被真实人体工学扣分干扰） ----
vi.mock('./human-factors', () => ({
  evaluateHumanFactors: vi.fn(() => [] as Array<{ code: string; severity: 'hard' | 'soft'; message: string }>),
  evaluateDoorSweep: vi.fn(() => [] as Array<{ code: string; severity: 'hard' | 'soft'; message: string }>),
  evaluatePrivacyOrder: vi.fn(() => [] as Array<{ code: string; severity: 'hard' | 'soft'; message: string }>),
}));

// ---- plan-approve：保留真实导出，planZones 换成 vi.fn ----
vi.mock('./plan-approve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plan-approve')>();
  return {
    ...actual,
    planZones: vi.fn(actual.planZones),
  };
});

import { evaluateFlow, evaluateReachability } from './flow-constraints';
import { evaluateHumanFactors } from './human-factors';
import { planZones, type ZoneFurniturePlacement } from './plan-approve';
import { generateScoredPlans, pickRecommendedPlan, detectFurnitureOverlap } from './plan-scoring';
import type { PlanAnnotation } from './plan-annotation';

const mockPlanZones = vi.mocked(planZones);
const mockEvaluateFlow = vi.mocked(evaluateFlow);
const mockReach = vi.mocked(evaluateReachability);
const mockHumanFactors = vi.mocked(evaluateHumanFactors);

beforeEach(() => {
  mockPlanZones.mockReset();
  mockPlanZones.mockReturnValue({ placements: [], skipped: [] });
  mockEvaluateFlow.mockReset();
  mockEvaluateFlow.mockImplementation(() => ({
    aisleWidthM: Infinity,
    wheelChairPassable: true,
    normalPassable: true,
    checkinBlocked: false,
    violations: [],
  }));
  mockReach.mockReset();
  mockReach.mockReturnValue({
    reachableZones: [],
    unreachableZones: [],
    violations: [],
    pairReachability: [],
    blockedBy: [],
  });
  mockHumanFactors.mockReset();
  mockHumanFactors.mockReturnValue([]);
});

/** 构造一个 zone 标注。 */
function makeZone(id: string, opts: Partial<{
  x: number; z: number; w: number; d: number; zoneType: 'roundtable'|'checkin'|'photo'|'rest'|'desk'; label: string;
}> = {}): PlanAnnotation {
  return {
    id,
    kind: 'zone',
    label: opts.label ?? id,
    geometry: {
      kind: 'rect',
      x: opts.x ?? 0,
      z: opts.z ?? 0,
      width: opts.w ?? 4,
      depth: opts.d ?? 4,
    },
    stageNo: 1,
    zoneType: opts.zoneType ?? 'roundtable',
  };
}

const CHAIR_SPEC = { type: 'dining-chair', name: '餐椅', category: 'seating', width: 0.45, depth: 0.45, height: 0.9, color: '#5D4037', icon: '🪑' };
const TABLE_SPEC = { type: 'dining-table', name: '圆桌', category: 'tables', width: 1.2, depth: 1.2, height: 0.75, color: '#A0522D', icon: '🟫' };
const BENCH_SPEC = { type: 'bench', name: '长椅', category: 'rest', width: 1.8, depth: 0.45, height: 0.45, color: '#8D6E63', icon: '🪑' };

function chairAt(x: number, z: number, zoneId = 'z1'): ZoneFurniturePlacement {
  return { spec: { ...CHAIR_SPEC }, x, z, rotation: 0, zoneId, zoneType: 'roundtable' };
}

describe('generateScoredPlans — 空输入', () => {
  it('空 annotations → 三版算出完全相同，合并为 1 版 balanced，pickRecommendedPlan 返回 balanced', () => {
    const plans = generateScoredPlans([]);
    // 空 annotations 三版同分同 subScores，按合并规则只保留 balanced。
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(plans.map(p => p.variantId)).toEqual(['balanced']);
    for (const p of plans) {
      expect(p.placements).toEqual([]);
      expect(p.skipped).toEqual([]);
      expect(p.capacitySeats).toBe(0);
      expect(p.outOfBounds).toBe(0);
      expect(p.score).toBe(0);
      expect(p.reasons.length).toBeGreaterThanOrEqual(2);
      // 空 annotations 没有真实门 → draft_unverified。
      expect(p.assurance).toBe('draft_unverified');
      expect(p.violations.some(v => v.code === 'DOOR_UNKNOWN')).toBe(true);
    }
    const rec = pickRecommendedPlan(plans);
    expect(rec!.variantId).toBe('balanced');
  });
});

describe('capacitySeats — 按家具名计数', () => {
  it('4 餐椅 + 1 长椅 = 6 座；圆桌本身不算座', () => {
    // 椅放在圆桌周环 0.9m 处（与桌边留 0.075m > 0.02m 容差，不触发 BBOX_OVERLAP）。
    const fakePlacements: ZoneFurniturePlacement[] = [
      { spec: { ...TABLE_SPEC }, x: 1, z: 1, rotation: 0, zoneId: 'z1', zoneType: 'roundtable' },
      chairAt(1, 0.1, 'z1'),
      chairAt(1, 1.9, 'z1'),
      chairAt(0.1, 1, 'z1'),
      chairAt(1.9, 1, 'z1'),
      { spec: { ...BENCH_SPEC }, x: 7, z: 0, rotation: 0, zoneId: 'z2', zoneType: 'rest' },
    ];
    mockPlanZones.mockReturnValue({ placements: fakePlacements, skipped: [] });
    const plans = generateScoredPlans([makeZone('z1'), makeZone('z2', { x: 6, z: 0, zoneType: 'rest' })]);
    for (const p of plans) {
      expect(p.capacitySeats).toBe(6);
      expect(p.outOfBounds).toBe(0);
      expect(p.score).toBe(6);
      expect(p.reasons[0]).toContain('可坐 6 座');
      expect(p.reasons.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('skipped — 区被跳过时扣分并说人话', () => {
  it('有 skipped → score -= 2*n，reasons 含跳过原因', () => {
    mockPlanZones.mockReturnValue({
      placements: [],
      skipped: [{ zoneId: 'z0', label: '小签到', reason: '签到区至少要 1.8×1.4m（台面+工作人员座椅）' }],
    });
    const plans = generateScoredPlans([makeZone('z0', { zoneType: 'checkin' })]);
    for (const p of plans) {
      expect(p.skipped.length).toBe(1);
      expect(p.score).toBe(-2);
      expect(p.reasons.some(r => r.includes('被跳过'))).toBe(true);
      expect(p.reasons.some(r => r.includes('签到区至少要'))).toBe(true);
    }
  });
});

describe('outOfBounds — 越界件数', () => {
  it('某件 center 超出 zone rect +0.05 → outOfBounds=1，扣 3 分', () => {
    // zone rect: [0,0] 到 [3,3]。件 1 在 (1.5,1.5) 区内；件 2 在 (3.5,1.5) 超出。
    const zone = makeZone('z1', { x: 0, z: 0, w: 3, d: 3 });
    const fakePlacements: ZoneFurniturePlacement[] = [
      { spec: { ...TABLE_SPEC }, x: 1.5, z: 1.5, rotation: 0, zoneId: 'z1', zoneType: 'roundtable' },
      chairAt(3.5, 1.5, 'z1'),
    ];
    mockPlanZones.mockReturnValue({ placements: fakePlacements, skipped: [] });
    const plans = generateScoredPlans([zone]);
    for (const p of plans) {
      expect(p.outOfBounds).toBe(1);
      expect(p.capacitySeats).toBe(1);
      expect(p.score).toBe(1 - 3);
      expect(p.reasons.some(r => r.includes('越界'))).toBe(true);
    }
  });

  it('找不到 zoneId 的 placement 容错不计入越界', () => {
    mockPlanZones.mockReturnValue({
      placements: [chairAt(99, 99, 'no-such-zone')],
      skipped: [],
    });
    const plans = generateScoredPlans([makeZone('z1')]);
    for (const p of plans) {
      expect(p.outOfBounds).toBe(0);
      expect(p.capacitySeats).toBe(1);
    }
  });
});

describe('flow penalty — 动线扣分', () => {
  it('「轮椅过不去」且 normalPassable=false → -5；checkinBlocked → -8', () => {
    mockPlanZones.mockReturnValue({ placements: [chairAt(1, 1)], skipped: [] });
    mockEvaluateFlow.mockImplementation(() => ({
      aisleWidthM: 0.8,
      wheelChairPassable: false,
      normalPassable: false,
      checkinBlocked: true,
      violations: ['签到台前通道只剩 0.8m，轮椅过不去', '签到区入口被家具贴脸堵住'],
    }));
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'checkin' })]);
    for (const p of plans) {
      // capacity=1, OOB=0, skipped=0, flow = -5 (轮椅) + -8 (blocked) = -13
      expect(p.score).toBe(1 - 13);
      expect(p.reasons.some(r => r.includes('轮椅过不去'))).toBe(true);
    }
  });

  it('「轮椅过不去」但 normalPassable=true → -2', () => {
    mockPlanZones.mockReturnValue({ placements: [chairAt(1, 1)], skipped: [] });
    mockEvaluateFlow.mockImplementation(() => ({
      aisleWidthM: 1.3,
      wheelChairPassable: false,
      normalPassable: true,
      checkinBlocked: false,
      violations: ['签到台前通道 1.3m，轮椅过不去，但行人能过'],
    }));
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'checkin' })]);
    for (const p of plans) {
      // sparse/balanced: capacity=1, 轮椅过不去但行人能过 → -2 → score=-1
      // dense: 通道收紧 1.3-0.3=1.0m，normalPassable 变 false → -5 → score=-4
      if (p.variantId === 'dense') {
        expect(p.score).toBe(1 - 5);
      } else {
        expect(p.score).toBe(1 - 2);
      }
    }
  });
});

describe('pickRecommendedPlan — 排序、并列、不可变', () => {
  it('dense 容量大但通道违规扣分后更低 → balanced 胜出', () => {
    mockPlanZones.mockImplementation((_a, density) => {
      const isDense = Math.abs(density - 0.8) < 1e-6;
      if (isDense) {
        // 4 椅分散到 1.5m 网格，避免触发 BBOX_OVERLAP（本用例只钉 flow 扣分）。
        return {
          placements: [chairAt(0, 0), chairAt(1.5, 0), chairAt(0, 1.5), chairAt(1.5, 1.5)],
          skipped: [],
        };
      }
      return { placements: [chairAt(1, 1)], skipped: [] };
    });
    mockEvaluateFlow.mockImplementation((placements) => {
      if (placements.length >= 4) {
        return {
          aisleWidthM: 0.8, wheelChairPassable: false, normalPassable: false, checkinBlocked: false,
          violations: ['签到台前通道只剩 0.8m，轮椅过不去'],
        };
      }
      return { aisleWidthM: 1.6, wheelChairPassable: true, normalPassable: true, checkinBlocked: false, violations: [] };
    });
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'checkin' })]);
    // sparse 与 balanced mock 出完全相同的 1 椅 → 合并为 1 版 balanced；dense 4 椅 -5。
    expect(plans.length).toBe(2);
    expect(plans[0]!.variantId).toBe('balanced');
    expect(plans[0]!.score).toBe(1);
    expect(plans[1]!.variantId).toBe('dense');
    // dense: 4 座 -5（轮椅过不去）= -1
    expect(plans[1]!.score).toBe(-1);
    const rec = pickRecommendedPlan(plans);
    expect(rec!.variantId).toBe('balanced'); // 并列时 balanced > sparse
  });

  it('并列 score → 优先 balanced > sparse > dense（乱序输入也成立）', () => {
    const base = {
      placements: [] as any[], skipped: [] as any[], outOfBounds: 0, capacitySeats: 2, score: 2, reasons: ['x'], violations: [] as any[],
      flow: { aisleWidthM: Infinity, wheelChairPassable: true, normalPassable: true, checkinBlocked: false, violations: [] as string[] },
      subScores: { capacity: 10, flow: 100, ergonomics: 100 },
      assurance: 'verified' as const,
      feasible: true as const,
      feasibilityStatus: 'FEASIBLE' as const,
    };
    const plans = [
      { ...base, variantId: 'sparse' as const, label: '松', density: 0.25 },
      { ...base, variantId: 'balanced' as const, label: '适中', density: 0.5 },
      { ...base, variantId: 'dense' as const, label: '密', density: 0.8 },
    ];
    expect(pickRecommendedPlan(plans)!.variantId).toBe('balanced');
    const shuffled = [plans[2], plans[0], plans[1]];
    expect(pickRecommendedPlan(shuffled)!.variantId).toBe('balanced');
  });

  it('pickRecommendedPlan 不修改输入数组（不可变）', () => {
    const base = {
      placements: [] as any[], skipped: [] as any[], outOfBounds: 0, reasons: ['x'], violations: [] as any[],
      flow: { aisleWidthM: Infinity, wheelChairPassable: true, normalPassable: true, checkinBlocked: false, violations: [] as string[] },
      subScores: { capacity: 10, flow: 100, ergonomics: 100 },
      assurance: 'verified' as const,
      feasible: true as const,
      feasibilityStatus: 'FEASIBLE' as const,
    };
    const plans = [
      { ...base, variantId: 'sparse' as const, label: '松', density: 0.25, capacitySeats: 1, score: 1 },
      { ...base, variantId: 'balanced' as const, label: '适中', density: 0.5, capacitySeats: 5, score: 5 },
      { ...base, variantId: 'dense' as const, label: '密', density: 0.8, capacitySeats: 3, score: 3 },
    ];
    const snapshot = plans.map(p => ({ ...p }));
    pickRecommendedPlan(plans);
    expect(plans).toEqual(snapshot);
  });

  it('feasible=false 的方案不参与推荐；全不可行时返回 null', () => {
    const infeasible = {
      placements: [] as any[], skipped: [] as any[], outOfBounds: 0, capacitySeats: 99, score: 99,
      reasons: ['hard conflict'], violations: [] as any[],
      flow: { aisleWidthM: Infinity, wheelChairPassable: true, normalPassable: true, checkinBlocked: false, violations: [] as string[] },
      subScores: { capacity: 100, flow: 100, ergonomics: 0 },
      assurance: 'verified' as const,
      feasible: false as const,
      feasibilityStatus: 'INFEASIBLE' as const,
      variantId: 'dense' as const, label: '密', density: 0.8,
    };
    const feasibleLow = {
      ...infeasible,
      feasible: true as const,
      feasibilityStatus: 'FEASIBLE' as const,
      capacitySeats: 2, score: 2, variantId: 'balanced' as const, label: '适中', density: 0.5,
    };
    // 即使 infeasible 分数 99 远高于 feasible 的 2，也必须选 feasible。
    expect(pickRecommendedPlan([infeasible, feasibleLow])!.variantId).toBe('balanced');
    // 全不可行 → null。
    expect(pickRecommendedPlan([infeasible])).toBeNull();
    expect(pickRecommendedPlan([])).toBeNull();
  });
});

describe('reasons — 每版至少 2 条人话', () => {
  it('干净有签到区场景 → 含容量 + 正面通道描述', () => {
    mockPlanZones.mockReturnValue({ placements: [chairAt(1, 1)], skipped: [] });
    mockEvaluateFlow.mockImplementation(() => ({
      aisleWidthM: 1.6, wheelChairPassable: true, normalPassable: true, checkinBlocked: false, violations: [],
    }));
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'checkin' })]);
    for (const p of plans) {
      expect(p.reasons.length).toBeGreaterThanOrEqual(2);
      expect(p.reasons[0]).toContain('可坐 1 座');
      // sparse/balanced 通道 1.6m 轮椅可过；dense 收紧到 1.3m 行人能过
      if (p.variantId === 'dense') {
        expect(p.reasons.some(r => r.includes('行人能过'))).toBe(true);
      } else {
        expect(p.reasons.some(r => r.includes('轮椅可过'))).toBe(true);
      }
    }
  });
});

describe('P0 接入：violations 字段 + ZONE_UNREACHABLE 扣分', () => {
  it('每个 ScoredPlan 都带 violations 数组（类型正确、可空）', () => {
    mockPlanZones.mockReturnValue({ placements: [chairAt(1, 1)], skipped: [] });
    const plans = generateScoredPlans([makeZone('z1')]);
    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (const p of plans) {
      expect(Array.isArray(p.violations)).toBe(true);
      for (const v of p.violations) {
        expect(v).toHaveProperty('code');
        expect(v).toHaveProperty('severity');
        expect(v).toHaveProperty('message');
      }
    }
  });

  it('ZONE_UNREACHABLE hard violation → 每条扣 5 分（围死 vs 开放分差 ≥5）', () => {
    // 开放版：mock reach 返回空 violations
    mockReach.mockReturnValue({ reachableZones: ['z1'], unreachableZones: [], violations: [], pairReachability: [], blockedBy: [] });
    mockHumanFactors.mockReturnValue([]);
    mockPlanZones.mockReturnValue({ placements: [chairAt(1, 1)], skipped: [] });
    const openPlans = generateScoredPlans([makeZone('z1')]);

    // 围死版：mock reach 返回一条 ZONE_UNREACHABLE
    mockReach.mockReturnValue({
      reachableZones: [],
      unreachableZones: ['z1'],
      violations: [{ code: 'ZONE_UNREACHABLE', severity: 'hard', zoneId: 'z1', message: '「休息区」被桌椅围死，人走不过去' }],
      pairReachability: [],
      blockedBy: [],
    });
    const blockedPlans = generateScoredPlans([makeZone('z1')]);

    // mock 下三版同分 → 合并为 1 版 balanced；对每版断言分差 ≥5。
    expect(openPlans.length).toBeGreaterThanOrEqual(1);
    expect(blockedPlans.length).toBeGreaterThanOrEqual(1);
    for (let i = 0; i < Math.min(openPlans.length, blockedPlans.length); i++) {
      const openScore = openPlans[i]!.score;
      const blockedScore = blockedPlans[i]!.score;
      expect(openScore - blockedScore).toBeGreaterThanOrEqual(5);
      expect(blockedPlans[i]!.violations.some((v) => v.code === 'ZONE_UNREACHABLE')).toBe(true);
    }
  });

  it('CHAIR_GAP hard → 每条 -1；soft violation 不扣分只进 reasons', () => {
    mockPlanZones.mockReturnValue({ placements: [chairAt(1, 1)], skipped: [] });
    // 两条 hard CHAIR_GAP + 一条 soft CHECKIN_QUEUE
    mockHumanFactors.mockReturnValue([
      { code: 'CHAIR_GAP', severity: 'hard', message: '餐椅间距仅 0.50m' },
      { code: 'CHAIR_GAP', severity: 'hard', message: '餐椅间距仅 0.40m' },
      { code: 'CHECKIN_QUEUE', severity: 'soft', message: '签到台前排队缓冲不足' },
    ]);
    mockReach.mockReturnValue({ reachableZones: [], unreachableZones: [], violations: [], pairReachability: [], blockedBy: [] });
    const plans = generateScoredPlans([makeZone('z1')]);
    for (const p of plans) {
      // capacity=1, 两条 CHAIR_GAP 各 -1 → score = 1 - 2 = -1；soft 不扣
      expect(p.score).toBe(-1);
      expect(p.violations.filter((v) => v.code === 'CHAIR_GAP')).toHaveLength(2);
      expect(p.violations.some((v) => v.code === 'CHECKIN_QUEUE' && v.severity === 'soft')).toBe(true);
      expect(p.reasons.some((r) => r.includes('排队缓冲'))).toBe(true);
    }
  });
});

describe('P1 家具 footprint AABB 重叠（BBOX_OVERLAP）', () => {
  it('4 椅故意叠在同一坐标 → 至少 1 条 BBOX_OVERLAP，score 比正常摆放低 ≥2', () => {
    // 正常版：4 椅分散到 1.5m 网格（椅边长 0.45m，间距 1.5m ≫ 0.02m 容差）。
    const normalPlacements = [
      chairAt(0, 0),
      chairAt(1.5, 0),
      chairAt(0, 1.5),
      chairAt(1.5, 1.5),
    ];
    mockPlanZones.mockReturnValue({ placements: normalPlacements, skipped: [] });
    const normalPlans = generateScoredPlans([makeZone('z1')]);

    // 重叠版：4 椅全压在 (0,0)。
    const stackedPlacements = [
      chairAt(0, 0),
      chairAt(0, 0),
      chairAt(0, 0),
      chairAt(0, 0),
    ];
    mockPlanZones.mockReturnValue({ placements: stackedPlacements, skipped: [] });
    const stackedPlans = generateScoredPlans([makeZone('z1')]);

    for (let i = 0; i < Math.min(normalPlans.length, stackedPlans.length); i++) {
      const stacked = stackedPlans[i]!;
      const normal = normalPlans[i]!;
      expect(stacked.violations.some((v) => v.code === 'BBOX_OVERLAP')).toBe(true);
      // 6 对重叠 × -2 = -12，远大于 2 的下限。
      expect(normal.score - stacked.score).toBeGreaterThanOrEqual(2);
      expect(stacked.reasons.some((r) => r.includes('互相压住'))).toBe(true);
    }
  });

  it('两椅中心距 1.5m（不重叠）→ 无 BBOX_OVERLAP', () => {
    mockPlanZones.mockReturnValue({
      placements: [chairAt(0, 0), chairAt(1.5, 0)],
      skipped: [],
    });
    const plans = generateScoredPlans([makeZone('z1')]);
    for (const p of plans) {
      expect(p.violations.some((v) => v.code === 'BBOX_OVERLAP')).toBe(false);
    }
  });

  it('detectFurnitureOverlap 直接调用：同坐标 4 椅 → 6 对 violation', () => {
    const placements = [
      chairAt(0, 0),
      chairAt(0, 0),
      chairAt(0, 0),
      chairAt(0, 0),
    ];
    const vs = detectFurnitureOverlap(placements);
    expect(vs.length).toBe(6);
    for (const v of vs) {
      expect(v.code).toBe('BBOX_OVERLAP');
      expect(v.severity).toBe('hard');
    }
  });
});

/* =====================================================================
 * 库存短缺（inventory）+ 交付清单（BOM）
 * ===================================================================== */
const DESK_TABLE_SPEC = { type: 'desk-table', name: '课桌', category: 'desk', width: 1.8, depth: 0.6, height: 0.75, color: '#A0522D', icon: '📚' };
const DESK_CHAIR_SPEC = { type: 'desk-chair', name: '讲座椅', category: 'chair', width: 0.49, depth: 0.57, height: 0.9, color: '#5D4037', icon: '🪑' };
const DINING_TABLE_SPEC = { type: 'dining-table', name: '圆桌', category: 'table', width: 1.8, depth: 1.8, height: 0.7, color: '#A0522D', icon: '🟫' };

function deskTableAt(x: number, z: number, zoneId = 'z1'): ZoneFurniturePlacement {
  return { spec: { ...DESK_TABLE_SPEC }, x, z, rotation: 0, zoneId, zoneType: 'desk' };
}
function deskChairAt(x: number, z: number, zoneId = 'z1'): ZoneFurniturePlacement {
  return { spec: { ...DESK_CHAIR_SPEC }, x, z, rotation: 0, zoneId, zoneType: 'desk' };
}
function diningTableAt(x: number, z: number, zoneId = 'z1'): ZoneFurniturePlacement {
  return { spec: { ...DINING_TABLE_SPEC }, x, z, rotation: 0, zoneId, zoneType: 'roundtable' };
}

describe('库存库存短缺（ScoringOptions.inventory）', () => {
  it('库存 10 把讲座椅、placement 需要 15 把 → shortage 含 desk-chair 缺 5，reasons 含「缺 5」', () => {
    // 5 张课桌 × 3 椅 = 15 把讲座椅。
    const placements = [
      deskTableAt(0, 0), deskTableAt(2, 0), deskTableAt(4, 0), deskTableAt(6, 0), deskTableAt(8, 0),
      deskChairAt(0.5, 0.5), deskChairAt(0, 0.5), deskChairAt(-0.5, 0.5),
      deskChairAt(2.5, 0.5), deskChairAt(2, 0.5), deskChairAt(1.5, 0.5),
      deskChairAt(4.5, 0.5), deskChairAt(4, 0.5), deskChairAt(3.5, 0.5),
      deskChairAt(6.5, 0.5), deskChairAt(6, 0.5), deskChairAt(5.5, 0.5),
      deskChairAt(8.5, 0.5), deskChairAt(8, 0.5), deskChairAt(7.5, 0.5),
    ];
    mockPlanZones.mockReturnValue({ placements, skipped: [] });
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'desk' })], {
      inventory: { 'desk-chair': 10 },
    });
    for (const p of plans) {
      expect(p.shortage).toBeDefined();
      const chairShort = p.shortage!.find((s) => s.type === 'desk-chair');
      expect(chairShort).toBeDefined();
      expect(chairShort!.needed).toBe(15);
      expect(chairShort!.available).toBe(10);
      expect(chairShort!.missing).toBe(5);
      expect(chairShort!.name).toBe('讲座椅');
      expect(p.reasons.some((r) => r.includes('缺 5') && r.includes('讲座椅'))).toBe(true);
      // shortage 不静默截断 placements，placements 仍然是 20 件。
      expect(p.placements.length).toBe(20);
    }
  });

  it('库存 ≥ 需要数 → shortage 为空数组，reasons 不出现「缺 N 件」类人话', () => {
    const placements = [deskChairAt(0, 0), deskChairAt(1, 0)];
    mockPlanZones.mockReturnValue({ placements, skipped: [] });
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'desk' })], {
      inventory: { 'desk-chair': 10 },
    });
    for (const p of plans) {
      expect(p.shortage).toEqual([]);
      // 不出现「缺 N 把/张/件」这种 shortage 人话（其他 soft violation 可能含「缺场地尺寸」等无关字样）。
      expect(p.reasons.some((r) => /缺\s*\d+\s*(把|张|件|面|盆|条)/.test(r))).toBe(false);
    }
  });

  it('不传 inventory → shortage 字段缺省（undefined），兼容旧调用', () => {
    mockPlanZones.mockReturnValue({ placements: [deskChairAt(0, 0)], skipped: [] });
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'desk' })]);
    for (const p of plans) {
      expect(p.shortage).toBeUndefined();
      expect(p.reasons.some((r) => /缺\s*\d+\s*(把|张|件|面|盆|条)/.test(r))).toBe(false);
    }
  });
});

describe('交付清单（billOfMaterials）', () => {
  it('120 人课桌式：BOM 含 desk-table（=桌数）和 desk-chair（=3×桌数），同 type 聚合去重', () => {
    // 2 桌 × 3 椅 = 2 桌 + 6 椅；椅子 z=1.5 与桌 footprint(z∈[-0.3,0.3]) 拉开，避免 BBOX_OVERLAP。
    const placements = [
      deskTableAt(0, 0), deskTableAt(3, 0),
      deskChairAt(-0.6, 1.5), deskChairAt(0, 1.5), deskChairAt(0.6, 1.5),
      deskChairAt(2.4, 1.5), deskChairAt(3, 1.5), deskChairAt(3.6, 1.5),
    ];
    mockPlanZones.mockReturnValue({ placements, skipped: [] });
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'desk' })]);
    const rec = pickRecommendedPlan(plans)!;
    expect(rec).not.toBeNull();
    expect(rec.billOfMaterials).toBeDefined();
    const tableLine = rec.billOfMaterials!.find((b) => b.type === 'desk-table');
    const chairLine = rec.billOfMaterials!.find((b) => b.type === 'desk-chair');
    expect(tableLine).toBeDefined();
    expect(tableLine!.count).toBe(2);
    expect(tableLine!.name).toBe('课桌');
    expect(chairLine).toBeDefined();
    expect(chairLine!.count).toBe(6);
    expect(chairLine!.name).toBe('讲座椅');
    // 同 type 不重复列两行。
    const types = rec.billOfMaterials!.map((b) => b.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('size 人话：圆桌写「Ø1.8m」，课桌写「1.8×0.6m」', () => {
    mockPlanZones.mockReturnValue({
      placements: [diningTableAt(0, 0), deskTableAt(3, 0)],
      skipped: [],
    });
    const plans = generateScoredPlans([makeZone('z1')]);
    const rec = pickRecommendedPlan(plans)!;
    const round = rec.billOfMaterials!.find((b) => b.type === 'dining-table');
    const desk = rec.billOfMaterials!.find((b) => b.type === 'desk-table');
    expect(round!.size).toBe('Ø1.8m');
    expect(desk!.size).toBe('1.8×0.6m');
  });

  it('推荐版（pickRecommended）必然填 BOM', () => {
    mockPlanZones.mockReturnValue({ placements: [deskChairAt(0, 0)], skipped: [] });
    const plans = generateScoredPlans([makeZone('z1', { zoneType: 'desk' })]);
    const rec = pickRecommendedPlan(plans)!;
    expect(rec.billOfMaterials).toBeDefined();
    expect(rec.billOfMaterials!.length).toBeGreaterThanOrEqual(1);
  });
});
