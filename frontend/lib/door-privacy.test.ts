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

describe('evaluateDoorSweep', () => {
  it('门弧内放桌 → DOOR_SWEEP_BLOCKED', () => {
    const v = evaluateDoorSweep([table(0, 0.3)], [southDoor]);
    expect(v.some((x) => x.code === 'DOOR_SWEEP_BLOCKED' && x.severity === 'hard')).toBe(true);
  });
  it('门弧外放桌（远离门）→ 无 violation', () => {
    const v = evaluateDoorSweep([table(5, 3)], [southDoor]);
    expect(v.some((x) => x.code === 'DOOR_SWEEP_BLOCKED')).toBe(false);
  });
  it('无 door 标注 → 空', () => {
    expect(evaluateDoorSweep([table(0, 0)], [])).toEqual([]);
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
