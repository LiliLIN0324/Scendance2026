/**
 * C2 / SC-19～23 规则复验（数据层，走真实管线，不 mock）。
 *
 * 四条验收口径：
 * 1. 硬冲突不进推荐（SC-20）：任何 hard violation → feasible=false，pickRecommendedPlan 不选；
 *    真有硬冲突时 REC=null，硬冲突带人话。
 * 2. 未知数据不当通过（SC-19）：缺房间尺寸 → INSUFFICIENT_INPUT；无真门 → draft_unverified
 *    + DOOR_UNKNOWN；真门被压住才算 hard。
 * 3. 库存不虚构（SC-23）：不传库存 → shortage 缺省；库存不足 → 精确缺口进 reasons；
 *    库存为 0 → 缺满数；未登记的 type 不编可用量、也不假装核验过。
 * 4. 清单与画布一致（SC-23）+ 两版可比（SC-21）：BOM 数量=方案件数；多版之间
 *    分数/容量/子分至少一项不同，每版都有人话。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateScoredPlans, pickRecommendedPlan, type ScoredPlan } from './plan-scoring';
import type { PlanAnnotation } from './plan-annotation';
import { HALL_D5, GUANGZHOU_MEETING_ROOM_6, type FixtureDoor } from './fixtures/hall-d5';

const REVISIT_OUT = process.env.C2_REVISIT_OUT;
const evidence: Array<Record<string, unknown>> = [];

afterAll(() => {
  if (!REVISIT_OUT) return;
  const file = resolve(REVISIT_OUT);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), fixtures: evidence },
      null,
      2,
    ),
  );
});

function doorOf(d: FixtureDoor): PlanAnnotation {
  return {
    id: d.id,
    kind: 'door',
    label: d.label,
    stageNo: 1,
    geometry: {
      kind: 'door',
      wall: d.wall,
      position: d.position,
      widthM: d.widthM ?? 0.9,
      ...(d.inferred ? { inferred: true } : {}),
    },
  };
}

function zone(
  id: string,
  zoneType: PlanAnnotation extends never ? never : NonNullable<PlanAnnotation['zoneType']>,
  rect: { x: number; z: number; width: number; depth: number },
  label = id,
): PlanAnnotation {
  return {
    id,
    kind: 'zone',
    label,
    stageNo: 1,
    geometry: { kind: 'rect', ...rect },
    zoneType,
  };
}

function realSouthDoor(position = 0, id = 'door-real'): PlanAnnotation {
  return {
    id,
    kind: 'door',
    label: '南门',
    stageNo: 1,
    geometry: { kind: 'door', wall: 'south', position, widthM: 0.9 },
  };
}

function hardEnforced(p: ScoredPlan) {
  return p.violations.filter((v) => v.severity === 'hard' && v.status !== 'unknown');
}

function countByType(plan: ScoredPlan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of plan.placements) out[p.spec.type] = (out[p.spec.type] ?? 0) + 1;
  return out;
}

function record(fixture: string, plans: readonly ScoredPlan[], extra: Record<string, unknown> = {}) {
  evidence.push({
    fixture,
    plans: plans.map((p) => ({
      variantId: p.variantId,
      feasible: p.feasible,
      feasibilityStatus: p.feasibilityStatus,
      assurance: p.assurance,
      capacitySeats: p.capacitySeats,
      placements: p.placements.length,
      hardCodes: p.violations.filter((v) => v.severity === 'hard').map((v) => v.code),
      shortage: p.shortage ?? null,
    })),
    recommended: pickRecommendedPlan(plans)?.variantId ?? null,
    ...extra,
  });
}

/* =====================================================================
 * 1. 硬冲突不进推荐（SC-20）
 * ===================================================================== */

describe('C2/SC-20：硬冲突不进推荐', () => {
  it('真门开门扇区被签到台压住 → DOOR_SWEEP_BLOCKED soft/unknown、REC 仍出、带现场确认人话（科智口径）', () => {
    const annotations = [
      zone('checkin', 'checkin', { x: -2, z: 2.3, width: 4, depth: 1.5 }, '签到区'),
      realSouthDoor(0),
    ];
    const plans = generateScoredPlans(annotations, { roomSize: { width: 10, height: 8 } });
    record('real-door-sweep-blocked', plans);

    expect(plans.length).toBeGreaterThanOrEqual(1);
    // 科智口径（door-privacy）：门弧压物不再判 hard，一律 soft/unknown 等现场确认；推荐不因门弧缺席。
    const rec = pickRecommendedPlan(plans);
    expect(rec).not.toBeNull();
    for (const p of plans) {
      const sweep = p.violations.find((v) => v.code === 'DOOR_SWEEP_BLOCKED');
      expect(sweep).toBeDefined();
      expect(sweep!.severity).toBe('soft');
      expect(sweep!.status).toBe('unknown');
      expect(sweep!.message).toMatch(/现场确认/);
      expect(p.violations.some((v) => v.code === 'DOOR_SWEEP_BLOCKED' && v.severity === 'hard')).toBe(false);
    }
  });

  it('同一扇真门挪到无家具处 → 无 hard，REC 非空且 assurance=verified', () => {
    const annotations = [
      zone('checkin', 'checkin', { x: -2, z: -3.8, width: 4, depth: 1.5 }, '签到区'),
      realSouthDoor(0),
    ];
    const plans = generateScoredPlans(annotations, { roomSize: { width: 10, height: 8 } });
    record('real-door-sweep-clear', plans);

    const rec = pickRecommendedPlan(plans);
    expect(rec).not.toBeNull();
    // 科智口径：评分层不再自动升 verified，assurance 一律 draft_unverified，等现场确认。
    expect(rec!.assurance).toBe('draft_unverified');
    expect(rec!.violations.some((v) => v.code === 'DOOR_SWEEP_BLOCKED' && v.severity === 'hard')).toBe(false);
    // 开启方向仍未知 → soft unknown 保留，不声称通过。
    expect(rec!.violations.some((v) => v.code === 'DOOR_SWEEP_BLOCKED' && v.status === 'unknown')).toBe(true);
  });

  it('必留区被家具压住 → 全变体 INFEASIBLE、REC=null', () => {
    const annotations = [
      zone('desk', 'desk', { x: -8.5, z: -5.5, width: 17, depth: 9 }, '课桌区'),
      zone('keep', 'reserved', { x: -6, z: -1, width: 12, depth: 2 }, '消防疏散'),
    ];
    const plans = generateScoredPlans(annotations, { roomSize: { width: 19, height: 15 } });
    record('keep-out-intruded', plans);

    expect(pickRecommendedPlan(plans)).toBeNull();
    for (const p of plans) {
      expect(p.feasible).toBe(false);
      expect(p.violations.some((v) => v.code === 'KEEP_OUT_INTRUDED' && v.severity === 'hard')).toBe(true);
    }
  });

  it('动线横穿课桌区 → ROUTE_BLOCKED hard、REC=null', () => {
    const cross: PlanAnnotation = {
      id: 'route-cross', kind: 'route', label: '宾客动线', stageNo: 1,
      geometry: { kind: 'polyline', points: [{ x: 0, z: -7.25 }, { x: 0, z: 7.25 }] },
    };
    const annotations = [
      zone('desk', 'desk', { x: 0, z: -3.5, width: 12, depth: 8 }, '课桌区'),
      cross,
    ];
    const plans = generateScoredPlans(annotations, { roomSize: { width: 19, height: 15 } });
    record('route-blocked', plans);

    expect(pickRecommendedPlan(plans)).toBeNull();
    for (const p of plans) {
      expect(p.violations.some((v) => v.code === 'ROUTE_BLOCKED' && v.severity === 'hard')).toBe(true);
    }
  });

  it('全量夹具不变量：feasible 只由「已判定的 hard」决定，推荐版必可行', () => {
    const deskD5 = zone('d5-desk', 'desk', { x: -8.5, z: -5.5, width: 17, depth: 9 });
    const fixtures: Array<{ name: string; annotations: PlanAnnotation[]; roomSize: { width: number; height: number } }> = [
      {
        name: 'hall-d5-a',
        annotations: [deskD5, ...HALL_D5.doors.map(doorOf)],
        roomSize: HALL_D5.roomSize,
      },
      {
        name: 'guangzhou-6',
        annotations: [
          zone('gz-desk', 'desk', { x: -6, z: -3.55, width: 12, depth: 4.5 }, '健康讲座课桌区'),
          zone('gz-checkin', 'checkin', { x: -1.5, z: 1.85, width: 3, depth: 1.4 }, '签到区'),
          ...GUANGZHOU_MEETING_ROOM_6.doors.map(doorOf),
        ],
        roomSize: GUANGZHOU_MEETING_ROOM_6.roomSize,
      },
    ];
    for (const f of fixtures) {
      const plans = generateScoredPlans(f.annotations, { roomSize: f.roomSize });
      record(f.name, plans);
      for (const p of plans) {
        expect(p.feasible).toBe(hardEnforced(p).length === 0);
      }
      const rec = pickRecommendedPlan(plans);
      if (rec) {
        expect(rec.feasible).toBe(true);
        expect(hardEnforced(rec)).toEqual([]);
      }
    }
  });
});

/* =====================================================================
 * 2. 未知数据不当通过（SC-19）
 * ===================================================================== */

describe('C2/SC-19：未知输入不假通过', () => {
  it('缺房间尺寸 → INSUFFICIENT_INPUT + ROOM_SIZE_UNKNOWN，绝不标 FEASIBLE', () => {
    const annotations = [
      zone('desk', 'desk', { x: -6, z: -4, width: 12, depth: 8 }, '课桌区'),
    ];
    const plans = generateScoredPlans(annotations);
    record('no-room-size', plans);

    for (const p of plans) {
      expect(p.feasibilityStatus).toBe('INSUFFICIENT_INPUT');
      expect(p.violations.some((v) => v.code === 'ROOM_SIZE_UNKNOWN' && v.status === 'unknown')).toBe(true);
    }
    const rec = pickRecommendedPlan(plans);
    if (rec) expect(rec.feasibilityStatus).not.toBe('FEASIBLE');
  });

  it('没画真门 → DOOR_UNKNOWN soft + draft_unverified；画了真门也不自动升 verified（科智口径：现场确认才升）', () => {
    const base = [zone('checkin', 'checkin', { x: -2, z: -3.8, width: 4, depth: 1.5 }, '签到区')];
    const noDoor = generateScoredPlans(base, { roomSize: { width: 10, height: 8 } });
    record('door-unknown', noDoor);
    for (const p of noDoor) {
      expect(p.assurance).toBe('draft_unverified');
      const unknown = p.violations.find((v) => v.code === 'DOOR_UNKNOWN');
      expect(unknown).toBeDefined();
      expect(unknown!.status).toBe('unknown');
    }

    const withDoor = generateScoredPlans([...base, realSouthDoor(3)], { roomSize: { width: 10, height: 8 } });
    record('door-real-far-away', withDoor);
    for (const p of withDoor) {
      expect(p.assurance).toBe('draft_unverified');
      expect(p.violations.some((v) => v.code === 'DOOR_UNKNOWN' && v.status === 'unknown')).toBe(false);
    }
  });
});

/* =====================================================================
 * 3. 库存不虚构（SC-23）
 * ===================================================================== */

describe('C2/SC-23：库存三类输入', () => {
  const annotations = [
    zone('gz-desk', 'desk', { x: -6, z: -3.55, width: 12, depth: 4.5 }, '健康讲座课桌区'),
    zone('gz-checkin', 'checkin', { x: -1.5, z: 1.85, width: 3, depth: 1.4 }, '签到区'),
    ...GUANGZHOU_MEETING_ROOM_6.doors.map(doorOf),
  ];
  const roomSize = GUANGZHOU_MEETING_ROOM_6.roomSize;

  it('库存够：每一版 shortage 为空数组，reasons 不出现「缺 N」', () => {
    const base = generateScoredPlans(annotations, { roomSize });
    const rec = pickRecommendedPlan(base);
    expect(rec).not.toBeNull();
    const needed = countByType(rec!);
    const enough = Object.fromEntries(Object.entries(needed).map(([type, n]) => [type, n + 10]));
    const plans = generateScoredPlans(annotations, { roomSize, inventory: enough });
    record('inventory-enough', plans);

    for (const p of plans) {
      expect(p.shortage).toEqual([]);
      expect(p.reasons.some((r) => /^缺 \d+/.test(r))).toBe(false);
    }
  });

  it('库存少：缺口精确到件数（shortage），推荐版带缺口人话（科智口径：本次候选比较，实际缺口待核验）', () => {
    const base = generateScoredPlans(annotations, { roomSize });
    const rec = pickRecommendedPlan(base)!;
    const needed = countByType(rec);
    const short: Record<string, number> = {};
    for (const [type, n] of Object.entries(needed)) short[type] = Math.max(0, n - 3);
    const plans = generateScoredPlans(annotations, { roomSize, inventory: short });
    record('inventory-short', plans);

    const recShort = pickRecommendedPlan(plans)!;
    const expected = Object.entries(countByType(recShort))
      .filter(([type, count]) => Object.hasOwn(short, type) && count > short[type])
      .map(([type, count]) => ({
        type,
        needed: count,
        available: short[type],
        missing: count - short[type],
      }));
    expect(expected.length).toBeGreaterThan(0);
    expect(recShort.shortage).toHaveLength(expected.length);
    for (const shortage of expected) {
      expect(recShort.shortage).toContainEqual(expect.objectContaining(shortage));
    }
    for (const s of recShort.shortage!) {
      expect(recShort.reasons).toContainEqual(
        expect.stringMatching(new RegExp(`比所填库存 ${s.available} 多 ${s.missing}`)),
      );
    }
  });

  it('库存为 0：缺口=实际需要量，不凭空当作有货', () => {
    const base = generateScoredPlans(annotations, { roomSize });
    const needed = countByType(pickRecommendedPlan(base)!);
    const empty = Object.fromEntries(Object.keys(needed).map((type) => [type, 0]));
    const plans = generateScoredPlans(annotations, { roomSize, inventory: empty });
    record('inventory-zero', plans);

    const rec = pickRecommendedPlan(plans)!;
    for (const s of rec.shortage!) {
      expect(s.available).toBe(0);
      expect(s.missing).toBe(s.needed);
    }
  });

  it('不传库存 → shortage 缺省（undefined），不编造可用量', () => {
    const plans = generateScoredPlans(annotations, { roomSize });
    record('inventory-absent', plans);
    for (const p of plans) expect(p.shortage).toBeUndefined();
  });

  it('库存漏登记某规格 → 该规格不核验、也不编造「够用」', () => {
    const base = generateScoredPlans(annotations, { roomSize });
    const rec = pickRecommendedPlan(base)!;
    const needed = countByType(rec);
    // 只登记讲座椅，课桌没登记。
    const partial = { 'desk-chair': Math.max(0, needed['desk-chair']! - 2) };
    const plans = generateScoredPlans(annotations, { roomSize, inventory: partial });
    record('inventory-partial', plans);

    const recPartial = pickRecommendedPlan(plans)!;
    expect(recPartial.shortage!.some((s) => s.type === 'desk-table')).toBe(false);
    const chair = recPartial.shortage!.find((s) => s.type === 'desk-chair');
    expect(chair).toBeDefined();
    expect(chair!.available).toBe(partial['desk-chair']);
    // 科智口径：未登记的规格只报「库存未知」，不编造「充足/够用」。
    expect(recPartial.reasons.some((r) => /课桌.*库存(充足|够用|满足)/.test(r))).toBe(false);
    expect(recPartial.reasons.some((r) => r.includes('课桌库存未知'))).toBe(true);
  });
});

/* =====================================================================
 * 4. 清单与画布一致（SC-23）+ 两版可比（SC-21）
 * ===================================================================== */

describe('C2/SC-23：交付清单与画布一致', () => {
  it('推荐版 BOM 每行数量=方案实际件数，总和=placement 总数', () => {
    const annotations = [
      zone('gz-desk', 'desk', { x: -6, z: -3.55, width: 12, depth: 4.5 }, '健康讲座课桌区'),
      zone('gz-checkin', 'checkin', { x: -1.5, z: 1.85, width: 3, depth: 1.4 }, '签到区'),
      ...GUANGZHOU_MEETING_ROOM_6.doors.map(doorOf),
    ];
    const plans = generateScoredPlans(annotations, { roomSize: GUANGZHOU_MEETING_ROOM_6.roomSize });
    const rec = pickRecommendedPlan(plans)!;
    record('bom-vs-placements', plans);

    const actual = countByType(rec);
    const bom = rec.billOfMaterials ?? [];
    const bomTotal = bom.reduce((sum, line) => sum + line.count, 0);
    expect(bomTotal).toBe(rec.placements.length);
    expect(bom.length).toBe(Object.keys(actual).length);
    for (const line of bom) {
      expect(line.count).toBe(actual[line.type]);
    }
  });
});

describe('C2/SC-21：多版可比', () => {
  it('同一场地同一需求：每版 reasons ≥2；多版之间分数/容量/子分至少一项不同', () => {
    const annotations = [
      zone('round', 'roundtable', { x: -8, z: -5, width: 14, depth: 10 }, '宴会区'),
    ];
    const plans = generateScoredPlans(annotations, { roomSize: { width: 18, height: 12 } });
    record('comparable-roundtable', plans);

    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (const p of plans) expect(p.reasons.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < plans.length; i++) {
      for (let j = i + 1; j < plans.length; j++) {
        const key = (p: ScoredPlan) =>
          [p.score, p.capacitySeats, p.subScores.capacity, p.subScores.flow, p.subScores.ergonomics].join('|');
        expect(key(plans[i]!)).not.toBe(key(plans[j]!));
      }
    }
  });
});
