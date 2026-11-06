import { describe, expect, it } from 'vitest';
import {
  AISLE_MIN_NORMAL,
  AISLE_MIN_WHEELCHAIR,
  evaluateFlow,
  evaluateReachability,
  evaluatePrivacyOrder,
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
  it('无签到区时不写硬约束：violations=[]、checkinBlocked=false，aisleWidthM 返回有限估值', () => {
    const zones = [zone('r1', -2, -2, 3, 3, 'roundtable')];
    // 单件 placement：不构成 pair，回落到默认宽敞 3.0m。
    const placements = [furniture('r1', 'roundtable', 0, 0, 0.6)];
    const r = evaluateFlow(placements, zones);
    expect(Number.isFinite(r.aisleWidthM)).toBe(true);
    expect(r.aisleWidthM).toBe(3.0);
    expect(r.wheelChairPassable).toBe(true);
    expect(r.normalPassable).toBe(true);
    expect(r.checkinBlocked).toBe(false);
    expect(r.violations).toEqual([]);
  });

  it('无签到区 + 多件 placement：返回最大正间隙作为主通道估算', () => {
    // 两件家具 x 方向相距 2.5m（表面距离），z 方向投影重叠。
    const placements = [
      furniture('r1', 'roundtable', -1.0, 0, 0.6, 0.6), // 左边缘 -1.3
      furniture('r1', 'roundtable',  1.0, 0, 0.6, 0.6), // 右边缘  0.7
    ];
    const r = evaluateFlow(placements, []);
    expect(r.violations).toEqual([]);
    expect(r.checkinBlocked).toBe(false);
    // 表面间隙 = 1.0 - (-1.0) - 0.3 - 0.3 = 1.4m
    expect(r.aisleWidthM).toBeCloseTo(1.4, 6);
  });

  it('无签到区且无 placement：默认宽敞 3.0m', () => {
    const r = evaluateFlow([], []);
    expect(r.aisleWidthM).toBe(3.0);
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

describe('evaluateReachability — pairReachability 固定三对连通性', () => {
  // 5×10 场地：x∈[-2.5,2.5]、z∈[-5,5]。
  // 签到区在顶部 z0=-4，圆桌区在中部 z0=0，两者之间留一段 z∈[-2,0] 走廊。
  // 入口格 = z0 - 0.15，必须落在场地内（halfH=5）。
  const checkinZone = zone('c1', -1, -4, 2, 2, 'checkin', '签到区');
  const roundZone = zone('r1', -1, 0, 2, 2, 'roundtable', '圆桌区');

  it('签到区 + 圆桌区开放 → pairReachability 里 checkin→roundtable connected=true', () => {
    const r = evaluateReachability([], [checkinZone, roundZone], { width: 5, height: 10 });
    const pair = r.pairReachability.find((p) => p.from === 'c1' && p.to === 'r1');
    expect(pair).toBeDefined();
    expect(pair!.connected).toBe(true);
    expect(r.violations.some((v) => v.code === 'ZONE_PAIR_DISCONNECTED')).toBe(false);
  });

  it('两 zone 中间用一排宽 bench 封死走廊 → connected=false，violations 含 ZONE_PAIR_DISCONNECTED', () => {
    // 两件宽 bench（width=2.6）在 z=-2 处拼成整面墙，覆盖 x∈[-2.55,2.55]。
    const wall: ZoneFurniturePlacement[] = [
      furniture('c1', 'checkin', -1.25, -2, 0.45, 2.6),
      furniture('c1', 'checkin',  1.25, -2, 0.45, 2.6),
    ];
    const r = evaluateReachability(wall, [checkinZone, roundZone], { width: 5, height: 10 });
    const pair = r.pairReachability.find((p) => p.from === 'c1' && p.to === 'r1');
    expect(pair).toBeDefined();
    expect(pair!.connected).toBe(false);
    const v = r.violations.find((x) => x.code === 'ZONE_PAIR_DISCONNECTED');
    expect(v).toBeDefined();
    expect(v!.message).toContain('签到区');
    expect(v!.message).toContain('圆桌区');
  });

  it('某一类 zone 缺失 → 该对被跳过（不报错、不产生 violation）', () => {
    // 只有签到区，没有圆桌区/休息区/打卡点。
    const r = evaluateReachability([], [checkinZone], { width: 5, height: 10 });
    expect(r.pairReachability).toEqual([]);
    expect(r.violations.some((v) => v.code === 'ZONE_PAIR_DISCONNECTED')).toBe(false);
  });
});

describe('evaluateReachability — blockedBy 入口边被家具覆盖', () => {
  // 3×2 休息区：x∈[-1.5,1.5]、z0=0。
  const restZone: PlanAnnotation = zone('r1', -1.5, 0, 3, 2, 'rest', '休息区');

  it('zone 入口边被 bench 贴死一半（覆盖 100%）→ blockedBy 含该 zone，violations 含 ZONE_ENTRANCE_BLOCKED', () => {
    // bench width=3.0、depth=0.45，中心在 (0,0)，footprint x∈[-1.5,1.5]、z∈[-0.225,0.225]
    // → 正好盖住 z0=0 整条边，coverageRatio=1.0。
    const blocker = furniture('r1', 'rest', 0, 0, 0.45, 3.0);
    const r = evaluateReachability([blocker], [restZone], { width: 6, height: 6 });
    const entry = r.blockedBy.find((b) => b.zoneId === 'r1');
    expect(entry).toBeDefined();
    expect(entry!.coverageRatio).toBeGreaterThanOrEqual(0.5);
    expect(entry!.blockedFurnitureIds.length).toBeGreaterThanOrEqual(1);
    const v = r.violations.find((x) => x.code === 'ZONE_ENTRANCE_BLOCKED');
    expect(v).toBeDefined();
    expect(v!.message).toContain('休息区');
  });

  it('zone 入口边完全开放 → blockedBy 不含该 zone，无 ZONE_ENTRANCE_BLOCKED', () => {
    const r = evaluateReachability([], [restZone], { width: 6, height: 6 });
    expect(r.blockedBy.find((b) => b.zoneId === 'r1')).toBeUndefined();
    expect(r.violations.some((v) => v.code === 'ZONE_ENTRANCE_BLOCKED')).toBe(false);
  });

  it('家具只盖住入口边 1/3（<50%）→ blockedBy 不含该 zone', () => {
    // bench width=1.0 居中放，只覆盖 x∈[-0.5,0.5]，总长 1.0 / 3.0 ≈ 0.33 < 0.5。
    const small = furniture('r1', 'rest', 0, 0, 0.45, 1.0);
    const r = evaluateReachability([small], [restZone], { width: 6, height: 6 });
    expect(r.blockedBy.find((b) => b.zoneId === 'r1')).toBeUndefined();
    expect(r.violations.some((v) => v.code === 'ZONE_ENTRANCE_BLOCKED')).toBe(false);
  });
});

describe('evaluatePrivacyOrder — 隐私区前后排软约束', () => {
  const room = { width: 10, height: 8 };

  it('休息区 center z<0（后排）→ 无 PRIVACY_ORDER', () => {
    // zone z0=-3, depth=2 → center = -2
    const rest = zone('r1', -1.5, -3, 3, 2, 'rest', '休息区');
    const v = evaluatePrivacyOrder([rest], room);
    expect(v.some((x) => x.code === 'PRIVACY_ORDER')).toBe(false);
  });

  it('休息区 center z>0（前排）→ PRIVACY_ORDER soft，message 含「休息区」人话', () => {
    // zone z0=1, depth=2 → center = 2（跑到前排）
    const rest = zone('r1', -1.5, 1, 3, 2, 'rest', '休息区');
    const v = evaluatePrivacyOrder([rest], room);
    const hit = v.find((x) => x.code === 'PRIVACY_ORDER');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('soft');
    expect(hit!.message).toContain('休息区');
    expect(hit!.message).toContain('往深处挪');
  });

  it('签到区 center z<0（后排）→ PRIVACY_ORDER soft，建议往前排挪', () => {
    // zone z0=-3, depth=1.4 → center = -2.3（签到跑到后排）
    const c = zone('c1', -1, -3, 2, 1.4, 'checkin', '签到区');
    const v = evaluatePrivacyOrder([c], room);
    const hit = v.find((x) => x.code === 'PRIVACY_ORDER');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('soft');
    expect(hit!.message).toContain('签到区');
    expect(hit!.message).toContain('往前排挪');
  });

  it('签到区 center z>0（前排）→ 无 PRIVACY_ORDER', () => {
    // zone z0=0, depth=1.4 → center = 0.7（在前排）
    const c = zone('c1', -1, 0, 2, 1.4, 'checkin', '签到区');
    const v = evaluatePrivacyOrder([c], room);
    expect(v.some((x) => x.code === 'PRIVACY_ORDER')).toBe(false);
  });
});
