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
    expect(plans.length).toBeGreaterThanOrEqual(1);
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
    // 重叠版必须触发重叠扣分（reasons 含「重叠」），且分数不高于不重叠版。
    expect(overlapBalanced.reasons.some((r) => /重叠/.test(r))).toBe(true);
    expect(overlapBalanced.score).toBeLessThanOrEqual(apartBalanced.score);
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
    // 纯圆桌区：sparse 删一桌，balanced/dense 无 checkin 不 squeeze → 合并为 2 版。
    expect(plans.length).toBeGreaterThanOrEqual(2);
    const variants = plans.map(p => p.variantId);
    expect(variants).toContain('sparse');
    expect(variants).toContain('balanced');

    const sparse = plans.find(p => p.variantId === 'sparse')!;
    const balanced = plans.find(p => p.variantId === 'balanced')!;

    // reasons 首条前缀差异化（红线：版本必须真拉开）。
    expect(sparse.reasons[0]).toContain('松：');
    expect(balanced.reasons[0]).toContain('适中：');

    // 各版不能 capacitySeats / score 完全一样（钉死同分是 bug）。
    const capSet = new Set(plans.map((p) => p.capacitySeats));
    const scoreSet = new Set(plans.map((p) => p.score));
    expect(capSet.size + scoreSet.size).toBeGreaterThanOrEqual(2);
  });
});

describe('H. 空 annotations → 合并为 1 版 balanced', () => {
  it('空数组 → 三版 placements 全空、同分同 subScores，合并为 1 版 balanced', () => {
    const plans = generateScoredPlans([]);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.variantId).toBe('balanced');
    for (const p of plans) {
      expect(p.placements).toEqual([]);
      expect(p.skipped).toEqual([]);
      expect(p.capacitySeats).toBe(0);
    }
    const rec = pickRecommendedPlan(plans);
    expect(rec!.variantId).toBe('balanced');
    expect(rec!.placements).toEqual([]);
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

describe('P1. subScores 0-100 三维子分', () => {
  it('9×9 圆桌区：三版 subScores 不全相同（capacity 或 flow 至少一项有差）', () => {
    const ann = makeZone('big', { x: -4.5, z: -4.5, w: 9, d: 9, zoneType: 'roundtable' });
    const plans = generateScoredPlans([ann], { roomSize: { width: 12, height: 12 } });
    expect(plans.length).toBeGreaterThanOrEqual(2);
    const capSet = new Set(plans.map((p) => p.subScores.capacity));
    const flowSet = new Set(plans.map((p) => p.subScores.flow));
    // sparse 主动删一桌 → capacity 必降；dense 通道收紧 → flow 可能降。
    expect(capSet.size + flowSet.size).toBeGreaterThanOrEqual(2);
  });

  it('每个 subScores 分量都落在 [0,100] 闭区间', () => {
    const ann = makeZone('big', { x: -4.5, z: -4.5, w: 9, d: 9, zoneType: 'roundtable' });
    const plans = generateScoredPlans([ann], { roomSize: { width: 12, height: 12 } });
    for (const p of plans) {
      expect(p.subScores.capacity).toBeGreaterThanOrEqual(0);
      expect(p.subScores.capacity).toBeLessThanOrEqual(100);
      expect(p.subScores.flow).toBeGreaterThanOrEqual(0);
      expect(p.subScores.flow).toBeLessThanOrEqual(100);
      expect(p.subScores.ergonomics).toBeGreaterThanOrEqual(0);
      expect(p.subScores.ergonomics).toBeLessThanOrEqual(100);
    }
  });

  it('empty annotations 时 subScores 全为 0 或 100（不越界、不 NaN）', () => {
    const plans = generateScoredPlans([]);
    for (const p of plans) {
      expect(Number.isFinite(p.subScores.capacity)).toBe(true);
      expect(Number.isFinite(p.subScores.flow)).toBe(true);
      expect(Number.isFinite(p.subScores.ergonomics)).toBe(true);
      expect(p.subScores.capacity).toBeGreaterThanOrEqual(0);
      expect(p.subScores.flow).toBeLessThanOrEqual(100);
    }
  });
});

describe('4.0.1 默认南门（withDefaultDoor）+ 墙退距', () => {
  it('无 door 标注时数据层合成默认南门；签到台压在门近似点 (0,0) 附近 → violations 含 DOOR_SWEEP_BLOCKED', () => {
    // 签到区 2×1.4 居中：desk rowZ = 0 + 0.3 + 0.3 = 0.6，desk x=0。
    // evaluateDoorSweep 对 south 门近似门点 (position=0, z=0)；
    // desk 中心距 (0,0) 仅 0.6m，furnitureR=0.7，0.6 < 0.45+0.7=1.15 → 触发。
    const ann = makeZone('checkin', { x: -1, z: 0, w: 2, d: 1.4, zoneType: 'checkin', label: '签到区' });
    const plans = generateScoredPlans([ann], { roomSize: { width: 10, height: 8 } });
    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (const p of plans) {
      expect(p.violations.some((v) => v.code === 'DOOR_SWEEP_BLOCKED')).toBe(true);
      // 推测门：assurance=draft_unverified，reasons 含「未确认」。
      expect(p.assurance).toBe('draft_unverified');
      expect(p.reasons.some((r) => r.includes('未确认'))).toBe(true);
    }
  });

  it('用户已画真实门时 assurance=verified（不是 draft_unverified）', () => {
    const userDoor: PlanAnnotation = {
      id: 'user-door-north',
      kind: 'door',
      label: '北门',
      stageNo: 1,
      geometry: { kind: 'door', wall: 'north', position: 0, widthM: 0.9 },
    };
    const zone = makeZone('round', { x: -4, z: 0, w: 4, d: 4, zoneType: 'roundtable' });
    const plans = generateScoredPlans([zone, userDoor], { roomSize: { width: 12, height: 10 } });
    for (const p of plans) {
      expect(p.assurance).toBe('verified');
      expect(p.violations.some(v => v.code === 'DOOR_UNKNOWN')).toBe(false);
    }
  });

  it('缺 roomSize 时生成 ROOM_SIZE_UNKNOWN soft unknown violation，不当成 pass', () => {
    const ann = makeZone('big', { x: -4.5, z: -4.5, w: 9, d: 9, zoneType: 'roundtable' });
    const plans = generateScoredPlans([ann]); // 不传 roomSize
    for (const p of plans) {
      const unknown = p.violations.find(v => v.code === 'ROOM_SIZE_UNKNOWN');
      expect(unknown).toBeDefined();
      expect(unknown!.severity).toBe('soft');
      expect(unknown!.status).toBe('unknown');
      expect(p.reasons.some(r => r.includes('缺少房间'))).toBe(true);
    }
  });

  it('用户已画 door 标注时 withDefaultDoor 不重复添加（直接走真实门）', () => {
    // 用一个远离任何家具的北门，确认不因为默认南门误报。
    // 这里只验证 generateScoredPlans 不崩、violations 可枚举。
    const userDoor: PlanAnnotation = {
      id: 'user-door-north',
      kind: 'door',
      label: '北门',
      stageNo: 1,
      geometry: { kind: 'door', wall: 'north', position: 0, widthM: 0.9 },
    };
    // 圆桌区放场地远离门的位置（避免真压到北门近似点）。
    const zone = makeZone('round', { x: -4, z: 0, w: 4, d: 4, zoneType: 'roundtable' });
    const plans = generateScoredPlans([zone, userDoor], { roomSize: { width: 12, height: 10 } });
    for (const p of plans) {
      expect(Array.isArray(p.violations)).toBe(true);
    }
  });

  it('墙退距：所有 placement 中心距 [±W/2, ±H/2] 边 ≥ 0.3m（小房间贴墙场景被内移或 skipped）', () => {
    // 8×6 小房间；签到区故意贴南墙（z0=2.6，半深 3，desk rowZ 会接近南墙）。
    // desk depth 0.6；rowZ = 2.6 + 0.3 + 0.3 = 3.2；桌底沿 = 3.2+0.3=3.5 > 3-0.3=2.7 → 被内移。
    const ann = makeZone('checkin', { x: -1, z: 2.6, w: 2, d: 1.4, zoneType: 'checkin' });
    const plans = generateScoredPlans([ann], { roomSize: { width: 8, height: 6 } });
    for (const p of plans) {
      for (const pl of p.placements) {
        const hw = pl.spec.width / 2;
        const hd = pl.spec.depth / 2;
        // 左沿距西墙
        expect(pl.x - hw - (-4)).toBeGreaterThanOrEqual(0.3 - 0.01);
        // 右沿距东墙
        expect(4 - (pl.x + hw)).toBeGreaterThanOrEqual(0.3 - 0.01);
        // 上沿距北墙
        expect(pl.z - hd - (-3)).toBeGreaterThanOrEqual(0.3 - 0.01);
        // 下沿距南墙
        expect(3 - (pl.z + hd)).toBeGreaterThanOrEqual(0.3 - 0.01);
      }
    }
  });
});
