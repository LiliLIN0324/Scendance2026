import { describe, expect, it } from 'vitest';
import {
  AISLE_MIN_NORMAL,
  AISLE_MIN_WHEELCHAIR,
  evaluateFlow,
} from './flow-constraints';
import type { PlanAnnotation, ZoneSemanticType } from './plan-annotation';
import type { ZoneFurniturePlacement } from './plan-approve';

function zone(
  id: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  zoneType?: ZoneSemanticType,
  label = '签到区',
): PlanAnnotation {
  return {
    id,
    kind: 'zone',
    label,
    stageNo: 1,
    geometry: { kind: 'rect', x, z, width, depth },
    ...(zoneType ? { zoneType } : {}),
  };
}

function furniture(
  zoneId: string,
  zoneType: ZoneSemanticType,
  x: number,
  z: number,
  depth: number,
  width = 0.6,
): ZoneFurniturePlacement {
  return {
    zoneId,
    zoneType,
    x,
    z,
    rotation: 0,
    spec: {
      type: 'test-furniture',
      name: '测试家具',
      category: 'test',
      width,
      depth,
      height: 1.0,
      color: '#4A7C59',
      icon: '🪑',
    },
  };
}

/** 默认签到区：x0=0, z0=0, w=2, d=1.4。入口侧 = z<0；横向条带 = [-0.3, 2.3]。 */
const CHECKIN = zone('c1', 0, 0, 2, 1.4, 'checkin');

describe('evaluateFlow / 动线约束', () => {
  it('无签到区时不约束：aisleWidthM=Infinity、violations=[]、checkinBlocked=false', () => {
    const zones = [zone('r1', -2, -2, 3, 3, 'roundtable')];
    const placements = [furniture('r1', 'roundtable', 0, 0, 0.6)];
    const r = evaluateFlow(placements, zones);
    expect(r.aisleWidthM).toBe(Infinity);
    expect(r.wheelChairPassable).toBe(true);
    expect(r.normalPassable).toBe(true);
    expect(r.checkinBlocked).toBe(false);
    expect(r.violations).toEqual([]);
  });

  it('签到区入口侧净空 1.6m：轮椅友好，无违规', () => {
    // depth=0.6 → 后缘 = z + 0.3；要净空 1.6 → 后缘 = -1.6 → z = -1.9
    const placements = [furniture('r1', 'roundtable', 1, -1.9, 0.6)];
    const r = evaluateFlow(placements, [CHECKIN]);
    expect(r.aisleWidthM).toBeCloseTo(1.6, 6);
    expect(r.wheelChairPassable).toBe(true);
    expect(r.normalPassable).toBe(true);
    expect(r.checkinBlocked).toBe(false);
    expect(r.violations).toEqual([]);
  });

  it('净空 1.35m：行人能过、轮椅不过，violations 含「轮椅过不去」但属于「行人能过」档', () => {
    // 后缘 = -1.35 → z = -1.65
    const placements = [furniture('r1', 'roundtable', 1, -1.65, 0.6)];
    const r = evaluateFlow(placements, [CHECKIN]);
    expect(r.aisleWidthM).toBeCloseTo(1.35, 6);
    expect(r.normalPassable).toBe(true);
    expect(r.wheelChairPassable).toBe(false);
    expect(r.checkinBlocked).toBe(false);
    // 命中 1.2~1.5m 档：含「轮椅过不去」+「行人能过」；不应出现 <1.2m 档的「只剩」
    const joined = r.violations.join('\n');
    expect(joined).toContain('轮椅过不去');
    expect(joined).toContain('行人能过');
    expect(joined).not.toContain('只剩');
  });

  it('净空 0.8m：行人也不过，violations 含「只剩」+「轮椅过不去」', () => {
    // 后缘 = -0.8 → z = -1.1
    const placements = [furniture('r1', 'roundtable', 1, -1.1, 0.6)];
    const r = evaluateFlow(placements, [CHECKIN]);
    expect(r.aisleWidthM).toBeCloseTo(0.8, 6);
    expect(r.normalPassable).toBe(false);
    expect(r.wheelChairPassable).toBe(false);
    const joined = r.violations.join('\n');
    expect(joined).toContain('轮椅过不去');
    expect(joined).toContain('只剩');
  });

  it('入口侧贴脸放一件家具：checkinBlocked=true，violations 含「贴脸」', () => {
    // 后缘 = -0.2 → 净空 0.2 < 0.5 → 贴脸
    const placements = [furniture('r1', 'roundtable', 1, -0.5, 0.6)];
    const r = evaluateFlow(placements, [CHECKIN]);
    expect(r.aisleWidthM).toBeCloseTo(0.2, 6);
    expect(r.checkinBlocked).toBe(true);
    expect(r.normalPassable).toBe(false);
    expect(r.violations.join('\n')).toContain('贴脸');
  });

  it('家具落在签到区 z0 边外但横向条带外（x 离签到区很远）：不视为堵', () => {
    // 签到区条带 = [-0.3, 2.3]；x=10 远在条带外；z=-1.0 虽在入口侧但不参与
    const placements = [furniture('r1', 'roundtable', 10, -1.0, 0.6)];
    const r = evaluateFlow(placements, [CHECKIN]);
    expect(r.aisleWidthM).toBe(Infinity);
    expect(r.checkinBlocked).toBe(false);
    expect(r.violations).toEqual([]);
  });

  it('多 zone 混合（roundtable + checkin）：只算签到区那一条通道', () => {
    // 圆桌区在 x=-5 一带，家具落在圆桌区自身位置（离签到区条带 [-0.3,2.3] 很远）→ 不堵
    // 再加一件真堵件：x=1, z=-1.1（净空 0.8）
    const zones = [
      zone('r1', -5, -2, 3, 3, 'roundtable', '圆桌区'),
      CHECKIN,
    ];
    const placements = [
      furniture('r1', 'roundtable', -4, -1.0, 0.6), // 圆桌区家具，x 离签到区很远
      furniture('c1', 'checkin', 1, -1.1, 0.6), // 真堵件 → 净空 0.8
    ];
    const r = evaluateFlow(placements, zones);
    expect(r.aisleWidthM).toBeCloseTo(0.8, 6);
    expect(r.normalPassable).toBe(false);
    expect(r.wheelChairPassable).toBe(false);
    expect(r.violations.join('\n')).toContain('轮椅过不去');
  });

  it('常量与 spec 冻结一致：normal=1.2m、wheelchair=1.5m', () => {
    expect(AISLE_MIN_NORMAL).toBeCloseTo(1.2, 6);
    expect(AISLE_MIN_WHEELCHAIR).toBeCloseTo(1.5, 6);
  });
});
