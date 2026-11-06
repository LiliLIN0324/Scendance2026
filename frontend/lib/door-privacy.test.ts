import { describe, it, expect } from 'vitest';
import { evaluateDoorSweep, evaluatePrivacyOrder } from './human-factors';
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
  it('门弧内放桌 → DOOR_SWEEP_BLOCKED（hard）', () => {
    // 桌子贴南墙内侧（z=3.0，南墙 z=4.0），距门 1.0m，落入扇区半径。
    const v = evaluateDoorSweep([table(0, 3.0)], [southDoor], room);
    expect(v.some((x) => x.code === 'DOOR_SWEEP_BLOCKED' && x.severity === 'hard' && x.status === 'violated')).toBe(true);
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
  it('休息区放前排（z>2m）→ PRIVACY_ORDER soft 建议往深处挪', () => {
    const rest: PlanAnnotation = {
      id: 'r1', kind: 'zone', label: '休息区', stageNo: 1, zoneType: 'rest',
      geometry: { kind: 'rect', x: -1.5, z: 3, width: 3, depth: 2 },
    };
    const v = evaluatePrivacyOrder([rest], { width: 10, height: 8 });
    expect(v.some((x) => x.code === 'PRIVACY_ORDER' && x.severity === 'soft')).toBe(true);
  });
  it('休息区放后排 → 不触发', () => {
    const rest: PlanAnnotation = {
      id: 'r2', kind: 'zone', label: '休息区', stageNo: 1, zoneType: 'rest',
      geometry: { kind: 'rect', x: -1.5, z: -3, width: 3, depth: 2 },
    };
    const v = evaluatePrivacyOrder([rest], { width: 10, height: 8 });
    expect(v.some((x) => x.code === 'PRIVACY_ORDER')).toBe(false);
  });
});
