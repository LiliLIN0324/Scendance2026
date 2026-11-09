import { describe, it, expect } from 'vitest';
import { evaluateDoorSweep, evaluatePrivacyOrder } from './human-factors';
import { generateScoredPlans } from './plan-scoring';
import type { PlanAnnotation } from './plan-annotation';
import type { ZoneFurniturePlacement } from './plan-approve';

function table(x: number, z: number, name = '签到台'): ZoneFurniturePlacement {
  return {
    zoneId: 'z1', zoneType: 'checkin', x, z, rotation: 0,
    spec: { type: 'table', name, category: 'table', width: 1.6, depth: 0.6, height: 0.75, color: '#x', icon: 'x' },
  };
}

const southDoor: PlanAnnotation = {
  id: 'd1', kind: 'door', label: '南门', stageNo: 1,
  geometry: { kind: 'door', wall: 'south', position: 0, widthM: 0.9 },
};

// 新坐标系：房间居中，南墙在 z=+height/2；家具坐标原点同中心。
const room = { width: 10, height: 8 };

describe('evaluateDoorSweep', () => {
  it('宽度未知时不以假定的门宽计算遮挡，靠近和远离都保持 unknown', () => {
    const unknown: PlanAnnotation = { ...southDoor, geometry: { kind: 'door', wall: 'south', position: 0, widthM: null } };
    const near = evaluateDoorSweep([table(0, 3.8)], [unknown], room);
    const far = evaluateDoorSweep([table(4, 0)], [unknown], room);
    expect(near).toEqual(far);
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ code: 'DOOR_SWEEP_BLOCKED', severity: 'soft', status: 'unknown' });
    expect(near[0]!.message).toContain('门宽未知');
  });
  it('手工输入的门宽只是记录，仍提示现场核验位置、宽度及开向', () => {
    const result = evaluateDoorSweep([], [southDoor], room);
    expect(result[0]).toMatchObject({ status: 'unknown', severity: 'soft' });
    expect(result[0]!.message).toContain('位置、宽度及开启方向未核验');
  });
  it('靠近门的桌子提醒核对，但未知开启方向时不能断言撞门', () => {
    // 桌子贴南墙内侧（z=3.0，南墙 z=4.0），距门 1.0m，落入扇区半径。
    const v = evaluateDoorSweep([table(0, 3.0)], [southDoor], room);
    expect(v.some((x) => x.code === 'DOOR_SWEEP_BLOCKED' && x.status === 'unknown' && x.message.includes('现场确认'))).toBe(true);
    expect(v.some((x) => x.status === 'violated')).toBe(false);
  });
  it('门弧外放桌（远离门）→ 无 hard 遮挡，但因开启方向未知给出 soft unknown', () => {
    const v = evaluateDoorSweep([table(5, 0)], [southDoor], room);
    expect(v.some((x) => x.code === 'DOOR_SWEEP_BLOCKED' && x.severity === 'hard')).toBe(false);
    expect(v.some((x) => x.code === 'DOOR_SWEEP_BLOCKED' && x.status === 'unknown')).toBe(true);
  });
  it('缺房间尺寸 → 不硬判遮挡，只给 unknown（近似，门扇未核验）', () => {
    const v = evaluateDoorSweep([table(0, 0.3)], [southDoor]);
    expect(v.every((x) => x.status === 'unknown' && x.severity === 'soft')).toBe(true);
  });
  it('无 door 标注 → 空', () => {
    expect(evaluateDoorSweep([table(0, 0)], [], room)).toEqual([]);
  });
});

describe('evaluatePrivacyOrder', () => {
  it('休息区与入口的距离未知，不按坐标假定离门远近', () => {
    const rest: PlanAnnotation = {
      id: 'r1', kind: 'zone', label: '休息区', stageNo: 1, zoneType: 'rest',
      geometry: { kind: 'rect', x: -1.5, z: 3, width: 3, depth: 2 },
    };
    const v = evaluatePrivacyOrder([rest], { width: 10, height: 8 });
    expect(v).toEqual([expect.objectContaining({ code: 'PRIVACY_ORDER', severity: 'soft', status: 'unknown', message: expect.stringContaining('尚未核验') })]);
    expect(v[0]!.message).not.toMatch(/太近|前排|深处/);
  });
  it('即使标了北门也不把坐标当作已核验入口距离', () => {
    const rest: PlanAnnotation = {
      id: 'r2', kind: 'zone', label: '休息区', stageNo: 1, zoneType: 'rest',
      geometry: { kind: 'rect', x: -1.5, z: -3, width: 3, depth: 2 },
    };
    const door: PlanAnnotation = { id: 'north', kind: 'door', label: '北门', stageNo: 1,
      geometry: { kind: 'door', wall: 'north', position: 0, widthM: 1.2, inferred: false } };
    const v = evaluatePrivacyOrder([rest, door], { width: 10, height: 8 });
    expect(v).toEqual([expect.objectContaining({ code: 'PRIVACY_ORDER', status: 'unknown' })]);
    expect(evaluatePrivacyOrder([rest], undefined)[0]?.status).toBe('unknown');
  });
  it('候选评分保留未知状态，不声称已确定入口远近', () => {
    const checkin: PlanAnnotation = { id: 'checkin', kind: 'zone', label: '签到区', stageNo: 1, zoneType: 'checkin',
      geometry: { kind: 'rect', x: -2, z: -4, width: 4, depth: 2 } };
    const north: PlanAnnotation = { id: 'north', kind: 'door', label: '北门', stageNo: 1,
      geometry: { kind: 'door', wall: 'north', position: 0, widthM: 1.2, inferred: false } };
    const plans = generateScoredPlans([checkin, north], { roomSize: { width: 12, height: 10 } });
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      expect(plan.violations).toContainEqual(expect.objectContaining({ code: 'PRIVACY_ORDER', status: 'unknown' }));
      expect(plan.feasibilityStatus).toBe('INSUFFICIENT_INPUT');
      expect(plan.reasons.join(' ')).not.toMatch(/离门太近|入口侧（前排）/);
    }
  });
});
