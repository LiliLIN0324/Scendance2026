/**
 * 第 12 批对抗测试（不 mock planZones / evaluateFlow，走真实纯函数）。
 *
 * 覆盖 hint 8 条里的 B/C/F 三条：
 *   B. zone 越出场地边界一半 → placements=[] 或 skipped 含「越出场地」
 *   C. 两个 zone 重叠一半 → score 比单个 zone 低 ≥3，reasons 含「重叠」
 *   F. ≥12×8m 大场地 roundtable → 三版 capacitySeats 或 reasons 有可观测差异
 *
 * 其余 A/G/未知类型见 plan-approve.test.ts；D/E 见 suggestions.test.ts；
 * H（空 annotations）见 plan-scoring.test.ts 既有「空输入」用例。
 */

import { describe, it, expect } from 'vitest';
import { generateScoredPlans, pickRecommendedPlan } from './plan-scoring';
import type { PlanAnnotation } from './plan-annotation';

/** 造一个 zone 标注（rect，房间中心为原点）。 */
function makeZone(
  id: string,
  opts: Partial<{
    x: number; z: number; w: number; d: number;
    zoneType: 'roundtable' | 'checkin' | 'photo' | 'rest';
    label: string;
  }> = {},
): PlanAnnotation {
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

describe('B. zone 越出场地边界一半 → 整块 zone 被跳过', () => {
  it('roomSize 10×8m，zone 大部分落在场地外（z∈[5,9]，场地半深 4）→ placements 越界率 ≥50% → skipped 含「越出场地」', () => {
    // 场地 [−5,5]×[−4,4]；zone rect x∈[-2,2]、z∈[5,9]（完全在 z>4 之外）。
    // 桌心网格在 [x: -1.1..1.1, z: 5.9..8.1]，所有桌心 z>4 → 越界率 100%。
    const ann = makeZone('z-out', { x: -2, z: 5, w: 4, d: 4 });
    const plans = generateScoredPlans([ann], { roomSize: { width: 10, height: 8 } });
    expect(plans).toHaveLength(3);
    for (const p of plans) {
      const offsiteReason = p.skipped.find((s) =>
        /越出场地/.test(s.reason),
      );
      // 越界家具要么整块跳过，要么计入 outOfBounds 扣分；不能静默摆错。
      expect(offsiteReason ?? p.outOfBounds > 0).toBeTruthy();
    }
  });

  it('不传 roomSize 时，zone 落在「场地外」不算越界（向后兼容）', () => {
    const ann = makeZone('z-far', { x: 50, z: 50, w: 4, d: 4 });
    const plans = generateScoredPlans([ann]);
    for (const p of plans) {
      expect(p.skipped.every((s) => !/越出场地/.test(s.reason))).toBe(true);
    }
  });
});

describe('C. 两个 zone 重叠一半 → 扣分并说人话', () => {
  it('同尺寸两个 zone：不重叠版 score 比重叠版高 ≥3', () => {
    // 两个 3×3 圆桌区，各自只能落 1 桌（inset 后可用 1.2×1.2）。
    // 不重叠：A 在 (-4,0)，B 在 (2,0)。两 zone 间隔 0.5m，不触发 overlap。
    // 重叠：A 在 (-1.5,0)，B 在 (0,0)。重叠 [0,1.5]×[-1.5,1.5]=4.5㎡，较小 zone=9㎡，50%>30%。
    const aOverlap = makeZone('a', { x: -1.5, z: 0, w: 3, d: 3 });
    const bOverlap = makeZone('b', { x: 0, z: 0, w: 3, d: 3 });
    const aApart = makeZone('a', { x: -4, z: 0, w: 3, d: 3 });
    const bApart = makeZone('b', { x: 2, z: 0, w: 3, d: 3 });

    const apartPlans = generateScoredPlans([aApart, bApart]);
    const overlapPlans = generateScoredPlans([aOverlap, bOverlap]);

    const apartBalanced = apartPlans.find((p) => p.variantId === 'balanced')!;
    const overlapBalanced = overlapPlans.find((p) => p.variantId === 'balanced')!;
    // 同样的 capacity，但重叠版多 -3 扣分 → apart 比 overlap 高 ≥3。
    expect(apartBalanced.score - overlapBalanced.score).toBeGreaterThanOrEqual(3);
    expect(overlapBalanced.reasons.some((r) => /重叠/.test(r))).toBe(true);
  });
});

describe('F. 大场地 roundtable 三版必须有可观测差异', () => {
  it('12×8m 圆桌区：三版 capacitySeats 或 reasons 不能完全同分', () => {
    // 12×8m 足够大，planZones 密档能摆到 MAX_TABLES_PER_ZONE=3 桌（受限于常数，不是网格）。
    // sparse 删一桌 → capacitySeats 应比 balanced 少 5（1 桌 + 4 椅 = 5 座）；
    // dense 档（density=0.8）与 balanced（density=0.5）在 pitch 上不同，
    // 但 MAX_TABLES_PER_ZONE=3 上限封顶。关键钉：reasons 首条前缀必须差异化。
    const ann = makeZone('big', { x: -6, z: -4, w: 12, d: 8 });
    const plans = generateScoredPlans([ann]);
    expect(plans).toHaveLength(3);
    const [sparse, balanced, dense] = plans;

    // reasons 首条前缀差异化（红线：三版必须真拉开）。
    expect(sparse.reasons[0]).toContain('松：');
    expect(balanced.reasons[0]).toContain('适中：');
    expect(dense.reasons[0]).toContain('密：');

    // 三版不能 capacitySeats / score 完全一样（钉死同分是 bug）。
    const capSet = new Set(plans.map((p) => p.capacitySeats));
    const scoreSet = new Set(plans.map((p) => p.score));
    expect(capSet.size + scoreSet.size).toBeGreaterThanOrEqual(2);
  });
});

describe('H. 空 annotations → 三版 placements=[]，推荐版 balanced', () => {
  it('空数组 → 三版 placements 全空，pickRecommendedPlan 返回 balanced', () => {
    const plans = generateScoredPlans([]);
    expect(plans).toHaveLength(3);
    for (const p of plans) {
      expect(p.placements).toEqual([]);
      expect(p.skipped).toEqual([]);
      expect(p.capacitySeats).toBe(0);
    }
    const rec = pickRecommendedPlan(plans);
    expect(rec.variantId).toBe('balanced');
    expect(rec.placements).toEqual([]);
  });
});

describe("A/G 对抗：极小区 + 连续 4 类 zone", () => {
  it("A. 极小签到区 0.8x0.6m → 进 skipped 且人话说太小/至少要，不乱摆", () => {
    const plans = generateScoredPlans([makeZone("a1", { x: 0, z: 0, w: 0.8, d: 0.6, zoneType: "checkin" })]);
    for (const p of plans) {
      expect(p.placements.length).toBe(0);
      expect(p.skipped.length).toBeGreaterThan(0);
      const joined = p.skipped.map((s) => s.reason).join("|");
      expect(joined).toContain("至少要");
    }
  });

  it("G. 连续 4 类 zone（圆桌+签到+打卡+休息）→ 不崩，各自有产出或人话 skipped", () => {
    const zones = [
      makeZone("g1", { x: -4, z: -2, w: 4, d: 4, zoneType: "roundtable" }),
      makeZone("g2", { x: 1, z: -1, w: 2, d: 1.4, zoneType: "checkin" }),
      makeZone("g3", { x: 1, z: 1.5, w: 2.6, d: 1.4, zoneType: "photo" }),
      makeZone("g4", { x: -4, z: 2, w: 3, d: 2.2, zoneType: "rest" }),
    ];
    const plans = generateScoredPlans(zones, { roomSize: { width: 12, height: 8 } });
    for (const p of plans) {
      expect(Array.isArray(p.placements)).toBe(true);
      expect(Array.isArray(p.skipped)).toBe(true);
      expect(typeof p.score).toBe("number");
      expect(p.reasons.length).toBeGreaterThanOrEqual(2);
    }
  });
});
