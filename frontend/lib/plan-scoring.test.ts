/**
 * plan-scoring.ts 单测。
 *
 * 策略：
 * - flow-constraints 整体 mock（并行任务在写，本测试只关心打分公式是否正确套用返回值）；
 * - plan-approve 部分 mock（保留真实导出，planZones 换成可 mock 的 vi.fn）；
 * - 8 例以上，覆盖 spec 列出的全部验收点。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- mock flow-constraints：默认无签到区、动线合规 ----
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
}));

// ---- plan-approve：保留真实导出，planZones 换成 vi.fn ----
vi.mock('./plan-approve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./plan-approve')>();
  return {
    ...actual,
    planZones: vi.fn(actual.planZones),
  };
});

import { evaluateFlow } from './flow-constraints';
import { planZones, type ZoneFurniturePlacement } from './plan-approve';
import { generateScoredPlans, pickRecommendedPlan } from './plan-scoring';
import type { PlanAnnotation } from './plan-annotation';

const mockPlanZones = vi.mocked(planZones);
const mockEvaluateFlow = vi.mocked(evaluateFlow);

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
});

/** 构造一个 zone 标注。 */
function makeZone(id: string, opts: Partial<{
  x: number; z: number; w: number; d: number; zoneType: 'roundtable'|'checkin'|'photo'|'rest'; label: string;
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
  it('空 annotations → 三版 placements 都空，pickRecommendedPlan 返回 balanced', () => {
    const plans = generateScoredPlans([]);
    expect(plans).toHaveLength(3);
    expect(plans.map(p => p.variantId)).toEqual(['sparse', 'balanced', 'dense']);
    for (const p of plans) {
      expect(p.placements).toEqual([]);
      expect(p.skipped).toEqual([]);
      expect(p.capacitySeats).toBe(0);
      expect(p.outOfBounds).toBe(0);
      expect(p.score).toBe(0);
      expect(p.reasons.length).toBeGreaterThanOrEqual(2);
    }
    const rec = pickRecommendedPlan(plans);
    expect(rec.variantId).toBe('balanced');
  });
});

describe('capacitySeats — 按家具名计数', () => {
  it('4 餐椅 + 1 长椅 = 6 座；圆桌本身不算座', () => {
    const fakePlacements: ZoneFurniturePlacement[] = [
      { spec: { ...TABLE_SPEC }, x: 1, z: 1, rotation: 0, zoneId: 'z1', zoneType: 'roundtable' },
      ...[0,1,2,3].map(() => chairAt(1, 1, 'z1')),
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
      const count = isDense ? 4 : 1;
      return {
        placements: Array.from({ length: count }, () => chairAt(1, 1)),
        skipped: [],
      };
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
    // sparse: 1 座, clean → 1
    // balanced: 1 座, clean → 1
    // dense: 4 座, -5 → -1
    expect(plans[0].score).toBe(1);
    expect(plans[1].score).toBe(1);
    expect(plans[2].score).toBe(-1);
    const rec = pickRecommendedPlan(plans);
    expect(rec.variantId).toBe('balanced'); // 并列时 balanced > sparse
  });

  it('并列 score → 优先 balanced > sparse > dense（乱序输入也成立）', () => {
    const base = {
      placements: [], skipped: [], outOfBounds: 0, capacitySeats: 2, score: 2, reasons: ['x'],
      flow: { aisleWidthM: Infinity, wheelChairPassable: true, normalPassable: true, checkinBlocked: false, violations: [] as string[] },
    };
    const plans = [
      { ...base, variantId: 'sparse' as const, label: '松', density: 0.25 },
      { ...base, variantId: 'balanced' as const, label: '适中', density: 0.5 },
      { ...base, variantId: 'dense' as const, label: '密', density: 0.8 },
    ];
    expect(pickRecommendedPlan(plans).variantId).toBe('balanced');
    const shuffled = [plans[2], plans[0], plans[1]];
    expect(pickRecommendedPlan(shuffled).variantId).toBe('balanced');
  });

  it('pickRecommendedPlan 不修改输入数组（不可变）', () => {
    const base = {
      placements: [], skipped: [], outOfBounds: 0, reasons: ['x'],
      flow: { aisleWidthM: Infinity, wheelChairPassable: true, normalPassable: true, checkinBlocked: false, violations: [] as string[] },
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
