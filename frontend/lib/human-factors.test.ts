import { describe, it, expect } from 'vitest';
import { evaluateHumanFactors } from './human-factors';
import { evaluateReachability } from './flow-constraints';
import type { ZoneFurniturePlacement } from './plan-approve';
import type { PlanAnnotation } from './plan-annotation';

function chair(x: number, z: number): ZoneFurniturePlacement {
  return {
    zoneId: 'z1',
    zoneType: 'roundtable',
    x, z, rotation: 0,
    spec: { type: 'dining-chair', name: '餐椅', category: 'seating', width: 0.45, depth: 0.45, height: 0.9, color: '#x', icon: 'x' },
  };
}
function bench(x: number, z: number): ZoneFurniturePlacement {
  return {
    zoneId: 'z1', zoneType: 'rest', x, z, rotation: 0,
    spec: { type: 'bench', name: '长椅', category: 'rest', width: 1.8, depth: 0.45, height: 0.45, color: '#x', icon: 'x' },
  };
}
function table(x: number, z: number): ZoneFurniturePlacement {
  return {
    zoneId: 'z1', zoneType: 'checkin', x, z, rotation: 0,
    spec: { type: 'table', name: '签到台', category: 'table', width: 1.6, depth: 0.6, height: 0.75, color: '#x', icon: 'x' },
  };
}

/** 签到区：x∈[-1,1]、z∈[0,1.4]；z0=0。 */
const checkinZone: PlanAnnotation = {
  id: 'z1', kind: 'zone', label: '签到区', stageNo: 1, zoneType: 'checkin',
  geometry: { kind: 'rect', x: -1, z: 0, width: 2, depth: 1.4 },
};

describe('evaluateHumanFactors — CHAIR_GAP 餐椅间距', () => {
  it('两椅中心距 0.5m < 0.9m → CHAIR_GAP hard violation', () => {
    const v = evaluateHumanFactors([chair(0, 0), chair(0.5, 0)], []);
    expect(v.some((x) => x.code === 'CHAIR_GAP' && x.severity === 'soft' && x.status === 'unknown')).toBe(true);
  });
  it('两椅中心距 1.5m ≥ 0.9m → 无 CHAIR_GAP', () => {
    const v = evaluateHumanFactors([chair(0, 0), chair(1.5, 0)], []);
    expect(v.some((x) => x.code === 'CHAIR_GAP')).toBe(false);
  });
});

describe('evaluateHumanFactors — AISLE_CLEARANCE 对坐通行余量', () => {
  it('两排长椅中心距 1.5m < 1.65m → AISLE_CLEARANCE hard violation', () => {
    const v = evaluateHumanFactors([bench(0, 0), bench(0, 1.5)], []);
    expect(v.some((x) => x.code === 'AISLE_CLEARANCE' && x.severity === 'soft' && x.status === 'unknown')).toBe(true);
  });
  it('两排长椅中心距 2.5m ≥ 1.65m → 无 AISLE_CLEARANCE', () => {
    const v = evaluateHumanFactors([bench(0, 0), bench(0, 2.5)], []);
    expect(v.some((x) => x.code === 'AISLE_CLEARANCE')).toBe(false);
  });
});

describe('evaluateHumanFactors — CHECKIN_QUEUE 签到台前缓冲', () => {
  it('签到台前沿到 z0 边缓冲 1.2m < 1.5m → CHECKIN_QUEUE soft（不扣分）', () => {
    // zone z0=0；桌前沿要落在 z=1.2（缓冲=1.2）→ 桌中心 = 1.2 + depth/2 = 1.2+0.3 = 1.5
    const v = evaluateHumanFactors([table(0, 1.5)], [checkinZone]);
    const q = v.find((x) => x.code === 'CHECKIN_QUEUE');
    expect(q).toBeDefined();
    expect(q!.severity).toBe('soft');
    expect(q!.message).toContain('排队方向和空间仍需核对');
    expect(q!.status).toBe('unknown');
  });
  it('签到台前沿到 z0 边缓冲 2.0m ≥ 1.5m → 无 CHECKIN_QUEUE', () => {
    // 桌前沿落在 z=2.0 → 桌中心 = 2.3
    const v = evaluateHumanFactors([table(0, 2.3)], [checkinZone]);
    expect(v.some((x) => x.code === 'CHECKIN_QUEUE')).toBe(false);
  });
  it('无签到区时不产 CHECKIN_QUEUE', () => {
    const v = evaluateHumanFactors([table(0, 0)], []);
    expect(v.some((x) => x.code === 'CHECKIN_QUEUE')).toBe(false);
  });
});

describe('evaluateReachability — 走廊连通 + zone 可达性', () => {
  it('没有 roomSize → 空结果（向后兼容）', () => {
    const r = evaluateReachability([bench(0, 0)], [], undefined);
    expect(r.unreachableZones).toEqual([]);
    expect(r.violations).toEqual([]);
  });
  it('开放 zone 贴边不被围 → reachableZones 含该 zone id', () => {
    // 10×8 场地；rest zone 顶边贴 z=-4（场地边），无家具 → 可达
    const zone: PlanAnnotation = {
      id: 'rest1', kind: 'zone', label: '休息区', stageNo: 1, zoneType: 'rest',
      geometry: { kind: 'rect', x: -1.5, z: -4, width: 3, depth: 2 },
    };
    const r = evaluateReachability([], [zone], { width: 10, height: 8 });
    expect(r.reachableZones).toContain('rest1');
    expect(r.unreachableZones).not.toContain('rest1');
    expect(r.violations).toEqual([]);
  });
  it('zone 被一圈家具围死 → unreachableZones 含该 zone id，violations 含 ZONE_UNREACHABLE', () => {
    // 12×8 场地；中央 1×1 小 zone；用四件 bench 把 zone 内部格子全部覆盖（围死）。
    const zone: PlanAnnotation = {
      id: 'rest2', kind: 'zone', label: '休息区', stageNo: 1, zoneType: 'rest',
      geometry: { kind: 'rect', x: -0.5, z: -0.5, width: 1, depth: 1 },
    };
    const blockers: ZoneFurniturePlacement[] = [
      bench(-0.5, 0), bench(0.5, 0), bench(0, -0.5), bench(0, 0.5),
    ];
    const r = evaluateReachability(blockers, [zone], { width: 12, height: 8 });
    expect(r.unreachableZones).toContain('rest2');
    expect(r.reachableZones).not.toContain('rest2');
    expect(r.violations.some(
      (v) => v.code === 'ZONE_UNREACHABLE' && v.zoneId === 'rest2',
    )).toBe(true);
  });
});
