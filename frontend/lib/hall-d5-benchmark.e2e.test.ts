/**
 * Hall D5 端到端已知答案验收（P1 纵向切片真做）。
 *
 * 三个场景：
 * - A：120 人公开讲座课桌式（东京国际论坛 Hall D5，19×15 估测）
 * - B：对抗 250 人（超官方剧院 200，系统必须返回空间不够，不许默默减椅硬排）
 * - C：广州会议室 6 社区健康讲座 45 人课桌式 + 签到台（12.9×7.1）
 *
 * 数据来源：docs/research/2026-11-06-真实场地基准-HallD5.md（主会话亲自抓 PDF）。
 * 红线：不引图片/PDF；门宽 unknown 走四值 unknown，不宣称通过；
 *       feasible=false 的硬冲突方案不进推荐；中文简体；禁「高斯/WorldGen」。
 */

import { describe, it, expect } from 'vitest';
import {
  planZones,
  applyWallClearance,
  DESK_ROW_PITCH_M,
  DESK_AISLE_M,
  DESK_TABLE_WIDTH_M,
  DESK_TABLE_DEPTH_M,
  DESK_CHAIR_WIDTH_M,
  DESK_CHAIR_DEPTH_M,
  DESK_CHAIRS_PER_TABLE,
  WALL_CLEARANCE_M,
} from './plan-approve';
import { generateScoredPlans, pickRecommendedPlan, detectFurnitureOverlap } from './plan-scoring';
import type { PlanAnnotation } from './plan-annotation';
import { HALL_D5, GUANGZHOU_MEETING_ROOM_6, type FixtureDoor } from './fixtures/hall-d5';
import { FURNITURE_CATALOG } from './furniture-catalog';

/** 把 fixture 的门标注转成管线吃的 PlanAnnotation door。 */
function fixtureDoorToAnnotation(d: FixtureDoor): PlanAnnotation {
  return {
    id: d.id,
    kind: 'door',
    label: d.label,
    stageNo: 1,
    geometry: {
      kind: 'door',
      wall: d.wall,
      position: d.position,
      // fixture 未提供的宽度保持未知，不生成假定的门洞尺寸。
      widthM: d.widthM ?? null,
      ...(d.inferred ? { inferred: true } : {}),
    },
  };
}

function deskZone(id: string, x: number, z: number, w: number, d: number, label = '课桌区'): PlanAnnotation {
  return {
    id, kind: 'zone', label, stageNo: 1,
    geometry: { kind: 'rect', x, z, width: w, depth: d },
    zoneType: 'desk',
  };
}

function checkinZone(id: string, x: number, z: number, w: number, d: number): PlanAnnotation {
  return {
    id, kind: 'zone', label: '签到区', stageNo: 1,
    geometry: { kind: 'rect', x, z, width: w, depth: d },
    zoneType: 'checkin',
  };
}

/** 取所有 desk-table，按排（z）分组。 */
function groupTablesByRow(placements: PlanAnnotation extends never ? never : ReturnType<typeof planZones>['placements']) {
  const tables = placements.filter((p) => p.spec.type === 'desk-table');
  const rows = new Map<number, typeof tables>();
  for (const t of tables) {
    const key = Math.round(t.z * 10);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key)!.push(t);
  }
  return [...rows.entries()].sort((a, b) => a[0] - b[0]);
}

/* =====================================================================
 * 场景 A：120 人公开讲座课桌式（Hall D5）
 * ===================================================================== */
describe('场景 A：Hall D5 120 人公开讲座课桌式', () => {
  // 课桌区 17m×9m，居中偏后（z 从 -5.5 到 3.5），南缘留 4m 给入口/通道。
  const DESK_AREA = { x: -8.5, z: -5.5, width: 17, depth: 9 };
  const doors = HALL_D5.doors.map(fixtureDoorToAnnotation);
  const annotations: PlanAnnotation[] = [deskZone('d5-desk', DESK_AREA.x, DESK_AREA.z, DESK_AREA.width, DESK_AREA.depth), ...doors];

  it('A1：出 1~3 个方案，至少 1 个 feasible=true，capacitySeats 接近 120（±20%）', () => {
    const plans = generateScoredPlans(annotations, { roomSize: HALL_D5.roomSize });
    expect(plans.length).toBeGreaterThanOrEqual(1);
    expect(plans.length).toBeLessThanOrEqual(3);
    const feasible = plans.filter((p) => p.feasible);
    expect(feasible.length).toBeGreaterThanOrEqual(1);
    // 人工估测矩形与课桌区的模拟：容差只用于发现算法回归，不能证明匹配官方完整布局。
    for (const p of feasible) {
      expect(p.capacitySeats).toBeGreaterThanOrEqual(96);
      expect(p.capacitySeats).toBeLessThanOrEqual(144);
      expect(p.feasibilityStatus).toBe('INSUFFICIENT_INPUT');
    }
  });

  it('示例课桌区的原始排布为 42 桌、126 椅，仅是估测条件下的合成计数', () => {
    const raw = planZones(annotations, 0.5);
    expect(raw.placements.filter(p => p.spec.type === 'desk-table')).toHaveLength(42);
    expect(raw.placements.filter(p => p.spec.type === 'desk-chair')).toHaveLength(126);
    expect(groupTablesByRow(raw.placements)).toHaveLength(6);
  });

  it('人工矩形与区块未复现官图完整台前条件，不能作为容量校准结论', () => {
    const raw = planZones(annotations, 0.5);
    const firstTableEdge = Math.min(...raw.placements.filter(p => p.spec.type === 'desk-table').map(p => p.z - p.spec.depth / 2));
    const estimatedNorthWall = -HALL_D5.roomSize.height / 2;
    // 仅计算到估测边界的距离；基准没有舞台，不能由此测量真实台前距离。
    expect(firstTableEdge - estimatedNorthWall).toBeLessThan(HALL_D5.layoutReference.stageFrontClearM);
    expect(HALL_D5.roomSize.note).toContain('估测');
  });

  it('A2：课桌排距 ≥1.4m（对齐官方课桌图，不是剧院的 0.9m）', () => {
    const raw = planZones(annotations, 0.5);
    const rows = groupTablesByRow(raw.placements);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < rows.length; i++) {
      const dz = (rows[i]![1][0].z - rows[i - 1]![1][0].z);
      expect(dz).toBeGreaterThanOrEqual(DESK_ROW_PITCH_M - 0.02);
    }
  });

  it('A3：block 间走道 ≥1.2m（块间净空）', () => {
    const raw = planZones(annotations, 0.5);
    const rows = groupTablesByRow(raw.placements);
    // 取中间一排，按 x 排序，找相邻桌的间隙；block 间应 ≥1.2m，block 内 ≈0.04m。
    const midRow = rows[Math.floor(rows.length / 2)]![1]!.sort((a, b) => a.x - b.x);
    let foundAisle = false;
    for (let i = 1; i < midRow.length; i++) {
      const gap = (midRow[i]!.x - midRow[i - 1]!.x) - DESK_TABLE_WIDTH_M;
      if (gap >= DESK_AISLE_M - 0.02) foundAisle = true;
    }
    expect(foundAisle).toBe(true);
  });

  it('A4：家具 footprint 无 AABB 重叠', () => {
    const plans = generateScoredPlans(annotations, { roomSize: HALL_D5.roomSize });
    const rec = pickRecommendedPlan(plans);
    expect(rec).not.toBeNull();
    expect(detectFurnitureOverlap(rec!.placements)).toEqual([]);
  });

  it('A5：每张讲座椅都带 ownerTableId 链到所属课桌', () => {
    const raw = planZones(annotations, 0.5);
    const tables = raw.placements.filter((p) => p.spec.type === 'desk-table');
    const tableKeys = new Set(tables.map((t) => `${t.x}|${t.z}`));
    const chairs = raw.placements.filter((p) => p.spec.type === 'desk-chair');
    expect(chairs.length).toBe(tables.length * DESK_CHAIRS_PER_TABLE);
    for (const c of chairs) {
      expect(c.ownerTableId).toBeDefined();
      expect(tableKeys.has(c.ownerTableId!)).toBe(true);
    }
  });

  it('A6：applyWallClearance 后所有家具距墙 ≥0.3m（不贴墙）', () => {
    const raw = planZones(annotations, 0.5);
    const walled = applyWallClearance(raw.placements, HALL_D5.roomSize);
    const halfW = HALL_D5.roomSize.width / 2;
    const halfH = HALL_D5.roomSize.height / 2;
    for (const p of walled.placements) {
      const hw = p.spec.width / 2;
      const hd = p.spec.depth / 2;
      expect(p.x - hw - (-halfW)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(halfW - (p.x + hw)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(p.z - hd - (-halfH)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(halfH - (p.z + hd)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
    }
  });

  it('A7：在估计的南门位置留空，不代表实际入口已核验' , () => {
    const plans = generateScoredPlans(annotations, { roomSize: HALL_D5.roomSize });
    const rec = pickRecommendedPlan(plans)!;
    const halfH = HALL_D5.roomSize.height / 2;
    const southDoor = HALL_D5.doors.find((d) => d.wall === 'south')!;
    for (const p of rec.placements) {
      const hw = p.spec.width / 2;
      const hd = p.spec.depth / 2;
      // 南墙门在 z=halfH，±1.5m 带；x 在门 position ±1.5m。
      const inZBand = p.z + hd > halfH - 1.5;
      const inXBand = Math.abs(p.x - southDoor.position) < 1.5 + hw;
      expect(!(inZBand && inXBand)).toBe(true);
    }
  });

  it('A8：在估计的非常口位置留空，不代表实际出口已核验' , () => {
    const plans = generateScoredPlans(annotations, { roomSize: HALL_D5.roomSize });
    const rec = pickRecommendedPlan(plans)!;
    const halfW = HALL_D5.roomSize.width / 2;
    const emergency = HALL_D5.doors.find((d) => d.isEmergency)!;
    // 应急口在西墙、z=emergency.position（西北）。检查 1.5m 半径内无家具。
    const doorX = -halfW;
    const doorZ = emergency.position;
    for (const p of rec.placements) {
      const d = Math.hypot(p.x - doorX, p.z - doorZ);
      expect(d).toBeGreaterThan(1.5 - 0.02);
    }
  });

  it('A9：门弧因门宽/方向 unknown → violation status=unknown，不宣称通过', () => {
    expect(doors.every(d => d.geometry.kind === 'door' && d.geometry.widthM === null)).toBe(true);
    const plans = generateScoredPlans(annotations, { roomSize: HALL_D5.roomSize });
    for (const p of plans) {
      const doorSweeps = p.violations.filter((v) => v.code === 'DOOR_SWEEP_BLOCKED');
      expect(doorSweeps.length).toBeGreaterThanOrEqual(1);
      // 至少有一条 soft unknown（门扇开启方向未核验）。
      const unknownSweeps = doorSweeps.filter((v) => v.status === 'unknown');
      expect(unknownSweeps.length).toBeGreaterThanOrEqual(1);
      // 不得有 hard violated 宣称门弧已通过（我们没核验门宽/方向）。
      expect(doorSweeps.some((v) => v.status === 'pass')).toBe(false);
      // assurance 是 draft_unverified（门是 fixture 推断的，不是用户真实画的）。
      expect(p.assurance).toBe('draft_unverified');
    }
  });

  it('A10：feasible=false 的硬冲突方案不被 pickRecommended 选中', () => {
    // 构造一个硬冲突：zone 越出厅深，导致越界/墙退距失败，feasible=false。
    const badDesk = deskZone('d5-bad', -8.5, -10, 17, 20, '越界课桌区');
    const badAnns = [badDesk, ...doors];
    const plans = generateScoredPlans(badAnns, { roomSize: HALL_D5.roomSize });
    const rec = pickRecommendedPlan(plans);
    if (rec) { expect(rec.feasible).toBe(true); expect(rec.placements.length).toBeGreaterThan(0); expect(rec.skipped).toEqual([]); }
    else expect(plans.every(p => !p.feasible || p.placements.length === 0 || p.skipped.length > 0)).toBe(true);
  });
});

/* =====================================================================
 * 场景 B：对抗 250 人（超官方剧院 200）
 * ===================================================================== */
describe('场景 B：对抗 250 人（超官方剧院 200）', () => {
  const doors = HALL_D5.doors.map(fixtureDoorToAnnotation);

  it('B1：本次课桌搜索未达到 250 座，不将不完整候选标为推荐', () => {
    // 把课桌区拉到最大（18×14），看管线实际能摆多少。
    const maxDesk = deskZone('d5-max', -9, -7, 18, 14, '最大课桌区');
    const plans = generateScoredPlans([maxDesk, ...doors], { roomSize: HALL_D5.roomSize });
    // 这是有限搜索的诊断，不以跳过物料的不完整版本冒充可推荐方案。
    const candidate = plans.reduce((best, plan) => plan.capacitySeats > best.capacitySeats ? plan : best);
    expect(candidate.capacitySeats).toBeLessThan(250);
    expect(candidate.capacitySeats).toBeGreaterThanOrEqual(100);
    expect(pickRecommendedPlan(plans)).toBeNull();
  });

  it('B2：空间不够时，capacitySeats 等于实际 desk-chair 数（不凭空加椅子）', () => {
    const maxDesk = deskZone('d5-max2', -9, -7, 18, 14);
    const plans = generateScoredPlans([maxDesk, ...doors], { roomSize: HALL_D5.roomSize });
    const rec = plans.reduce((best, plan) => plan.capacitySeats > best.capacitySeats ? plan : best);
    // capacitySeats 必须等于 placements 里 desk-chair 的实际数量（不能凭空加椅子）。
    const actualChairs = rec.placements.filter((p) => p.spec.type === 'desk-chair').length;
    expect(rec.capacitySeats).toBe(actualChairs);
    // 没有"为了凑 250 而虚增椅子"：实际 chair 数 < 250。
    expect(actualChairs).toBeLessThan(250);
    // gap：现有管线无"目标人数"入参，不会主动说"空间不够，建议降到 200"。
    // 这条产品 gap 在对照结论里列出，本测试只验证"不硬凑"。
  });

  it('B3：传 targetCapacity=250 时，诊断候选说明当前区域的座位缺口', () => {
    // 真断言：直接调用 generateScoredPlans 并把 targetCapacity=250 喂进去，
    // 要求诊断候选的 reasons 里有人话缺口提示，不宣称场地最大容量。
    const maxDesk = deskZone('d5-max3', -9, -7, 18, 14);
    const plans = generateScoredPlans([maxDesk, ...doors], {
      roomSize: HALL_D5.roomSize,
      targetCapacity: 250,
    });
    const rec = plans.reduce((best, plan) => plan.capacitySeats > best.capacitySeats ? plan : best);
    expect(pickRecommendedPlan(plans)).toBeNull();
    const reasonText = rec.reasons.join('\n');
    expect(reasonText).toMatch(/目标\s*250\s*座还差约/);
    expect(reasonText).not.toContain('最多');
    // 同时保留「容量不虚增」的硬断言。
    expect(rec.capacitySeats).toBeLessThan(250);
  });
});

/* =====================================================================
 * 场景 C：广州会议室 6 社区健康讲座 45 人课桌 + 签到台
 * ===================================================================== */
describe('场景 C：广州会议室 6 社区健康讲座 45 人课桌+签到台', () => {
  // 课桌区 12×4.5 居中偏北（z 从 -3.55 到 0.95）；签到区靠南墙（z 从 1.85 到 3.25）。
  const DESK = { x: -6, z: -3.55, width: 12, depth: 4.5 };
  const CHECKIN = { x: -1.5, z: 1.85, width: 3, depth: 1.4 };
  const doors = GUANGZHOU_MEETING_ROOM_6.doors.map(fixtureDoorToAnnotation);
  const annotations: PlanAnnotation[] = [
    deskZone('gz6-desk', DESK.x, DESK.z, DESK.width, DESK.depth, '健康讲座课桌区'),
    checkinZone('gz6-checkin', CHECKIN.x, CHECKIN.z, CHECKIN.width, CHECKIN.depth),
    ...doors,
  ];

  it('C1：12.9×7.1 内放下 45 人课桌（capacitySeats ≈45，容差 ±20%）', () => {
    const plans = generateScoredPlans(annotations, { roomSize: GUANGZHOU_MEETING_ROOM_6.roomSize });
    const rec = pickRecommendedPlan(plans);
    expect(rec).not.toBeNull();
    // 官方课桌 45；我们摆约 45（3 排 × 5 桌 × 3 人）。
    expect(rec!.capacitySeats).toBeGreaterThanOrEqual(36);
    expect(rec!.capacitySeats).toBeLessThanOrEqual(60);
  });

  it('C2：签到台不堵入口（签到区前沿离南墙 ≥0.3m，且签到台 z 在课桌区以南）', () => {
    const plans = generateScoredPlans(annotations, { roomSize: GUANGZHOU_MEETING_ROOM_6.roomSize });
    const rec = pickRecommendedPlan(plans)!;
    const halfH = GUANGZHOU_MEETING_ROOM_6.roomSize.height / 2;
    // 签到台 type='table' 且 zoneType='checkin'。
    const checkinDesks = rec.placements.filter((p) => p.spec.type === 'table' && p.zoneType === 'checkin');
    expect(checkinDesks.length).toBeGreaterThanOrEqual(1);
    for (const d of checkinDesks) {
      // 签到台后缘（z 正方向）离南墙 ≥0.3m。
      expect(halfH - (d.z + d.spec.depth / 2)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
    }
    // 签到台 z 应在课桌区课桌以南（z 更大）。
    const deskTables = rec.placements.filter((p) => p.spec.type === 'desk-table');
    const maxDeskZ = Math.max(...deskTables.map((t) => t.z));
    for (const d of checkinDesks) {
      expect(d.z).toBeGreaterThan(maxDeskZ);
    }
  });

  it('C3：无 AABB 重叠、不贴墙', () => {
    const plans = generateScoredPlans(annotations, { roomSize: GUANGZHOU_MEETING_ROOM_6.roomSize });
    const rec = pickRecommendedPlan(plans)!;
    expect(detectFurnitureOverlap(rec.placements)).toEqual([]);
    const halfW = GUANGZHOU_MEETING_ROOM_6.roomSize.width / 2;
    const halfH = GUANGZHOU_MEETING_ROOM_6.roomSize.height / 2;
    for (const p of rec.placements) {
      const hw = p.spec.width / 2;
      const hd = p.spec.depth / 2;
      expect(p.x - hw - (-halfW)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(halfW - (p.x + hw)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(p.z - hd - (-halfH)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(halfH - (p.z + hd)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
    }
  });

  it('C4：门弧 unknown（fixture 门宽未填），不宣称通过', () => {
    const plans = generateScoredPlans(annotations, { roomSize: GUANGZHOU_MEETING_ROOM_6.roomSize });
    for (const p of plans) {
      const doorSweeps = p.violations.filter((v) => v.code === 'DOOR_SWEEP_BLOCKED');
      expect(doorSweeps.some((v) => v.status === 'unknown')).toBe(true);
      expect(doorSweeps.some((v) => v.status === 'pass')).toBe(false);
    }
  });
});

/* =====================================================================
 * 常量对照（文档性断言：保证我们导出的常数与官方参考值对齐）
 * ===================================================================== */
describe('常数对照：我们导出的课桌常数 vs 官方图', () => {
  it('局部排距/走道/每桌人数沿用参考值，不代表完整布局一致', () => {
    expect(DESK_ROW_PITCH_M).toBe(HALL_D5.layoutReference.classroomRowPitchM); // 1.4
    expect(DESK_AISLE_M).toBe(HALL_D5.layoutReference.classroomAisleM); // 1.2
    expect(DESK_CHAIRS_PER_TABLE).toBe(HALL_D5.layoutReference.chairsPerClassroomTable); // 3
    expect(DESK_TABLE_WIDTH_M).toBe(HALL_D5.furniture.deskTable.width); // 1.8
    expect(DESK_TABLE_DEPTH_M).toBe(HALL_D5.furniture.deskTable.depth); // 0.6
    expect(HALL_D5.furniture.deskTable.referenceHeightM).toBe(0.7);
    expect(FURNITURE_CATALOG.find(item => item.type === 'desk-table')?.height).toBe(0.75);
    expect(FURNITURE_CATALOG.find(item => item.type === 'desk-table')?.height).not.toBe(HALL_D5.furniture.deskTable.referenceHeightM);
    expect(DESK_CHAIR_WIDTH_M).toBe(HALL_D5.furniture.deskChair.width); // 0.49
    expect(DESK_CHAIR_DEPTH_M).toBe(HALL_D5.furniture.deskChair.depth); // 0.57
  });
});
