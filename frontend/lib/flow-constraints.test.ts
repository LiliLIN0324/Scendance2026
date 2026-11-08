import { describe, expect, it } from 'vitest';
import {
  AISLE_MIN_NORMAL,
  AISLE_MIN_WHEELCHAIR,
  evaluateFlow,
  evaluateReachability,
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

describe('evaluateFlow / 待核验的局部间距估算', () => {
  it('没有签到区时不把空场或任意家具间距当作通道', () => {
    for (const placements of [[], [furniture('r1', 'roundtable', 0, 0, 0.6)],
      [furniture('r1', 'roundtable', -1, 0, 0.6), furniture('r1', 'roundtable', 1, 0, 0.6)]]) {
      const result = evaluateFlow(placements, []);
      expect(result).toEqual({ aisleWidthM: null, wheelChairPassable: null, normalPassable: null,
        checkinBlocked: null, status: 'unknown', violations: [] });
    }
  });

  it('有签到区但附近没有可比较物件时仍未知', () => {
    const far = furniture('r1', 'roundtable', 10, -1, 0.6);
    expect(evaluateFlow([far], [CHECKIN]).aisleWidthM).toBeNull();
    expect(evaluateFlow([], [CHECKIN]).status).toBe('unknown');
  });

  it.each([1.6, 1.35, 0.8, 0.2])('局部估算 %.2f 米也不推断行人、轮椅或入口是否通过', (gap) => {
    const result = evaluateFlow([furniture('r1', 'roundtable', 1, -gap - 0.3, 0.6)], [CHECKIN]);
    expect(result.aisleWidthM).toBeCloseTo(gap, 6);
    expect(result.status).toBe('unknown');
    expect(result.normalPassable).toBeNull();
    expect(result.wheelChairPassable).toBeNull();
    expect(result.checkinBlocked).toBeNull();
    expect(result.violations.join(' ')).toContain('估算间距');
    expect(result.violations.join(' ')).not.toMatch(/轮椅可过|轮椅过不去|行人能过|合规/);
  });

  it('以旋转后的包围盒计算估算间距，并在相交时显示零而非负宽度', () => {
    const rotated = { ...furniture('r1', 'roundtable', 1, -1.5, 0.6, 2), rotation: Math.PI / 2 };
    expect(evaluateFlow([rotated], [CHECKIN]).aisleWidthM).toBeCloseTo(0.5, 6);
    const overlaps = furniture('r1', 'roundtable', 1, -0.1, 1);
    expect(evaluateFlow([overlaps], [CHECKIN]).aisleWidthM).toBe(0);
  });

  it('无效坐标或尺寸不被当作测量数据', () => {
    const bad = furniture('r1', 'roundtable', 1, NaN, 1);
    expect(evaluateFlow([bad], [CHECKIN]).aisleWidthM).toBeNull();
  });

  it('旧常量仅保留作参考，不能推断规范结论', () => {
    expect(AISLE_MIN_NORMAL).toBeCloseTo(1.2, 6);
    expect(AISLE_MIN_WHEELCHAIR).toBeCloseTo(1.5, 6);
  });
});

describe('evaluateReachability — pairReachability 固定三对连通性', () => {
  it('大型输入超出网格预算时返回未知而不是崩溃或假装可达', () => {
    const result = evaluateReachability([], [], { width: 1e12, height: 1e12 });
    expect(result.violations).toEqual([expect.objectContaining({ code: 'FLOW_ANALYSIS_LIMIT', status: 'unknown' })]);
    expect(result.reachableZones).toEqual([]);
  });
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
    expect(v!.status).toBe('unknown');
    expect(v!.severity).toBe('soft');
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
    expect(v!.status).toBe('unknown');
    expect(v!.severity).toBe('soft');
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
