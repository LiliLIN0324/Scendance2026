/**
 * 真实场地基准 fixture 测试（4.0.1 P1 验收）。
 *
 * 数据来源（仅作排序参照，非消防/官方核定值）：
 * - 东京国际论坛 Hall D5：285㎡，参考容量 剧院 200 / 课桌 120 / 回字 72。
 * - 广州增城保利皇冠假日会议室 6：12.9×7.1×2.8m，93㎡，参考容量 剧院 80 / 课桌 45 / U 形 36。
 *
 * 红线：
 * - 只使用数字常量，不下载 PDF/图片、不抄版权文案；
 * - 参考容量仅作为我们自己的排序参照，文案不得称为「消防已批准/无障碍达标/门扇已核验」；
 * - 门宽、出口、无障碍、库存全部缺省时，对应检查项必须 unknown，不得默认 pass。
 */

import { describe, it, expect } from 'vitest';
import {
  planZones,
  applyWallClearance,
  MAX_CHAIR_OWNER_DIST_M,
  WALL_CLEARANCE_M,
  CHAIR_BACK_CLEARANCE_M,
} from './plan-approve';
import { detectFurnitureOverlap, generateScoredPlans } from './plan-scoring';
import type { PlanAnnotation, ZoneSemanticType } from './plan-annotation';

/** Hall D5：22.5m × 12.7m ≈ 285㎡。 */
const HALL_D5 = { width: 22.5, height: 12.7 };
/** 增城保利会议室 6：12.9m × 7.1m = 91.6㎡（标称 93㎡）。 */
const ZC_MEETING_6 = { width: 12.9, height: 7.1 };

function zone(
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  zoneType: ZoneSemanticType = 'roundtable',
  label = '圆桌区',
): PlanAnnotation {
  return {
    id,
    kind: 'zone',
    label,
    stageNo: 1,
    geometry: { kind: 'rect', x, z, width, depth },
    zoneType,
  };
}

describe('Hall D5 基准（285㎡，参考课桌 120）', () => {
  it('大圆桌区布置：椅成组归属桌心、无 AABB 重叠、墙退距达标', () => {
    // 圆桌区居中 12×8m（小于厅，留四周通道）。
    const ann = zone('d5-r1', -6, -4, 12, 8);
    const raw = planZones([ann], 0.5);
    expect(raw.skipped).toEqual([]);

    const tables = raw.placements.filter((p) => p.spec.type === 'dining-table');
    const chairs = raw.placements.filter((p) => p.spec.type === 'dining-chair');
    // MAX_TABLES_PER_ZONE=3，每桌 8 椅。
    expect(tables.length).toBeGreaterThanOrEqual(1);
    expect(chairs.length).toBe(tables.length * 8);

    // 每件椅都有 ownerTableId 且距桌心 ≤ 阈值。
    const tableByKey = new Map(tables.map((t) => [`${t.x}|${t.z}`, t]));
    for (const c of chairs) {
      expect(c.ownerTableId).toBeDefined();
      const owner = tableByKey.get(c.ownerTableId!);
      expect(owner).toBeDefined();
      const d = Math.hypot(c.x - owner!.x, c.z - owner!.z);
      expect(d).toBeLessThanOrEqual(MAX_CHAIR_OWNER_DIST_M + 1e-6);
    }

    // 过墙退距后：AABB 无重叠、所有件距墙 ≥0.3m。
    const walled = applyWallClearance(raw.placements, HALL_D5);
    expect(detectFurnitureOverlap(walled.placements)).toEqual([]);
    const halfW = HALL_D5.width / 2;
    const halfH = HALL_D5.height / 2;
    for (const p of walled.placements) {
      const hw = p.spec.width / 2;
      const hd = p.spec.depth / 2;
      expect(p.x - hw - (-halfW)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(halfW - (p.x + hw)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(p.z - hd - (-halfH)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(halfH - (p.z + hd)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
    }
  });

  it('缺门/缺尺寸时：roomSize 未传 → ROOM_SIZE_UNKNOWN unknown，门未确认 → DOOR_UNKNOWN unknown', () => {
    const ann = zone('d5-r2', -6, -4, 12, 8);
    // 不传 roomSize、不传门标注。
    const plans = generateScoredPlans([ann]);
    for (const p of plans) {
      const roomUnknown = p.violations.find((v) => v.code === 'ROOM_SIZE_UNKNOWN');
      expect(roomUnknown).toBeDefined();
      expect(roomUnknown!.status).toBe('unknown');
      expect(roomUnknown!.severity).toBe('soft');

      const doorUnknown = p.violations.find((v) => v.code === 'DOOR_UNKNOWN');
      expect(doorUnknown).toBeDefined();
      expect(doorUnknown!.status).toBe('unknown');

      expect(p.assurance).toBe('draft_unverified');
      expect(p.feasibilityStatus).toBe('INSUFFICIENT_INPUT');
      // 缺尺寸时不得声称「无障碍达标/门扇已核验」。
      expect(p.reasons.join('|')).not.toMatch(/消防已批准|无障碍达标|门扇已核验/);
    }
  });

  it('对抗例「塞 250 人进 285㎡」：极小区被跳过，不默默减椅硬排', () => {
    // 1×1m 小 zone，远小于圆桌区下限（含整圈椅子 ≈3.6×3.6m）。
    const tiny = zone('d5-tiny', -0.5, -0.5, 1, 1);
    const out = planZones([tiny], 0.5);
    expect(out.placements).toEqual([]);
    expect(out.skipped.length).toBeGreaterThanOrEqual(1);
    expect(out.skipped[0].reason).toMatch(/圆桌区|太小/);
    // 不给硬排下的虚假 capacity。
    expect(out.placements.filter((p) => p.spec.type === 'dining-chair')).toEqual([]);
  });
});

describe('增城保利会议室 6 基准（93㎡，参考课桌 45）', () => {
  it('小厅布置：墙退距与组团约束在 12.9×7.1m 内仍然成立', () => {
    // 圆桌区 6×4m，居中。
    const ann = zone('zc-r1', -3, -2, 6, 4);
    const raw = planZones([ann], 0.5);
    expect(raw.skipped).toEqual([]);
    expect(raw.placements.length).toBeGreaterThanOrEqual(1);

    const walled = applyWallClearance(raw.placements, ZC_MEETING_6);
    expect(detectFurnitureOverlap(walled.placements)).toEqual([]);

    const halfW = ZC_MEETING_6.width / 2;
    const halfH = ZC_MEETING_6.height / 2;
    for (const p of walled.placements) {
      const hw = p.spec.width / 2;
      const hd = p.spec.depth / 2;
      expect(p.x - hw - (-halfW)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(halfW - (p.x + hw)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(p.z - hd - (-halfH)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
      expect(halfH - (p.z + hd)).toBeGreaterThanOrEqual(WALL_CLEARANCE_M - 0.02);
    }
    // 餐椅背侧退距常量存在（本测试只校验常量被引入使用，具体断言见 plan-approve.test.ts）。
    expect(CHAIR_BACK_CLEARANCE_M).toBeGreaterThanOrEqual(WALL_CLEARANCE_M);
  });
});
