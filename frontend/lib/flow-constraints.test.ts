import { describe, expect, it } from 'vitest';
import {
  AISLE_MIN_NORMAL,
  AISLE_MIN_WHEELCHAIR,
  ROUTE_CORRIDOR_WIDTH_M,
  evaluateFlow,
  evaluateKeepOut,
  evaluateReachability,
  evaluateRouteClear,
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

/** 造一条 route 折线标注。 */
function makeRoute(id: string, points: Array<{ x: number; z: number }>, label = '宾客动线'): PlanAnnotation {
  return { id, kind: 'route', label, stageNo: 1, geometry: { kind: 'polyline', points } };
}

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

describe('evaluateKeepOut / evaluateRouteClear（SC-19 §五.4：必留区与必留通道）', () => {
  /** 预留区：x∈[-4,4]、z∈[2,4]（房间中心为原点）。 */
  const KEEP = zone('k1', -4, 2, 8, 2, 'reserved', '消防疏散');

  it('必留区没有家具压入 → 无 violation', () => {
    const placements = [furniture('d1', 'desk', -1, -3, 0.57, 1.8)];
    expect(evaluateKeepOut(placements, [KEEP])).toEqual([]);
  });

  it('家具压进必留区 → KEEP_OUT_INTRUDED hard，按区聚合点名件数', () => {
    const placements = [
      furniture('d1', 'desk', 0, 3, 0.57, 1.8),   // 完全在带内
      furniture('d2', 'desk', 0, 2.2, 0.57, 1.8), // 部分压入（z∈[1.915,2.485]）
      furniture('d3', 'desk', 0, -3, 0.57, 1.8),  // 区外，不计
    ];
    const v = evaluateKeepOut(placements, [KEEP]);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('KEEP_OUT_INTRUDED');
    expect(v[0].severity).toBe('hard');
    expect(v[0].zoneId).toBe('k1');
    expect(v[0].message).toContain('必留区');
    expect(v[0].message).toContain('测试家具×2');
  });

  it('压入在容差内（footprint 边缘压入 <0.02m）不误杀', () => {
    // 椅深 0.57，中心 z = 2 − 0.285 + 0.01 = 1.725 → 后缘 2.01，压入 0.01 < 容差 → 放行。
    const placements = [furniture('d1', 'desk', 0, 1.725, 0.57, 1.8)];
    expect(evaluateKeepOut(placements, [KEEP])).toEqual([]);
  });

  it('动线走廊 1.2m：家具距线段 < 半宽−容差 → ROUTE_BLOCKED；官方 1.2m 走道居中不误杀', () => {
    expect(ROUTE_CORRIDOR_WIDTH_M).toBeCloseTo(1.2, 6);
    const route = makeRoute('r1', [{ x: 0, z: -5 }, { x: 0, z: 5 }]);
    // 桌半宽 0.9，桌心 x=±1.5 → 内缘 x=±0.6，距线段 0.6 ≥ 半宽−容差 → 不判。
    const clearRows = [
      furniture('d1', 'desk', -1.5, 0, 0.6, 1.8),
      furniture('d2', 'desk', 1.5, 0, 0.6, 1.8),
    ];
    expect(evaluateRouteClear(clearRows, [route])).toEqual([]);
    // 桌心挪近到 x=±1.4 → 内缘 x=±0.5，压入走廊 → 判。
    const tightRows = [
      furniture('d1', 'desk', -1.4, 0, 0.6, 1.8),
      furniture('d2', 'desk', 1.4, 0, 0.6, 1.8),
    ];
    const v = evaluateRouteClear(tightRows, [route]);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('ROUTE_BLOCKED');
    expect(v[0].severity).toBe('hard');
    expect(v[0].zoneId).toBe('r1');
    expect(v[0].message).toContain('1.2m 净空');
    expect(v[0].message).toContain('测试家具×2');
  });

  it('GEN-03：消防疏散预留 3m，同一摆位仍满足普通动线', () => {
    const route = makeRoute('egress', [{ x: 0, z: -5 }, { x: 0, z: 5 }]);
    const fireRoute = { ...route, label: '消防疏散' };
    const near = furniture('d1', 'desk', 2, 0, 0.6, 1.8);
    expect(evaluateRouteClear([near], [route])).toEqual([]);
    expect(evaluateRouteClear([near], [fireRoute])).toEqual([
      expect.objectContaining({ code: 'ROUTE_BLOCKED', severity: 'hard', ruleId: 'GEN-03', zoneId: 'egress' }),
    ]);
    const edge = furniture('d1', 'desk', 2.4, 0, 0.6, 1.8);
    expect(evaluateRouteClear([edge], [fireRoute])).toEqual([]);
  });

  it('线段整个穿过家具 footprint（相交距离=0）必判；斜向线段也不漏', () => {
    const route = makeRoute('r1', [{ x: -3, z: -3 }, { x: 3, z: 3 }]);
    const blocker = furniture('d1', 'desk', 0, 0, 0.6, 1.8);
    const v = evaluateRouteClear([blocker], [route]);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('ROUTE_BLOCKED');
  });

  it('旋转后的长桌占地进入必留区或路线时不能漏检', () => {
    const rotated = { ...furniture('d1', 'desk', 0, 1.1, 0.4, 2), rotation: Math.PI / 2 };
    expect(evaluateKeepOut([rotated], [KEEP])[0]?.code).toBe('KEEP_OUT_INTRUDED');
    const route = makeRoute('r1', [{ x: -3, z: 0 }, { x: 3, z: 0 }]);
    expect(evaluateRouteClear([rotated], [route])[0]?.code).toBe('ROUTE_BLOCKED');
  });

  it('斜向包围盒相交只标待核验，不能把近似当作硬冲突', () => {
    const diagonal = { ...furniture('d1', 'desk', 0, 2.1, 0.4, 2), rotation: Math.PI / 4 };
    expect(evaluateKeepOut([diagonal], [KEEP])[0]).toMatchObject({ code: 'KEEP_OUT_INTRUDED', severity: 'soft', status: 'unknown' });
    const route = makeRoute('r1', [{ x: -3, z: 0.8 }, { x: 3, z: 0.8 }]);
    expect(evaluateRouteClear([diagonal], [route])[0]).toMatchObject({ code: 'ROUTE_BLOCKED', severity: 'soft', status: 'unknown' });
  });

  it('无效家具坐标不能静默当作保留区或路线已通过', () => {
    const invalid = { ...furniture('d1', 'desk', 0, 0, 0.4, 2), x: NaN };
    expect(evaluateKeepOut([invalid], [KEEP])[0]?.status).toBe('unknown');
    const route = makeRoute('r1', [{ x: -3, z: 0 }, { x: 3, z: 0 }]);
    expect(evaluateRouteClear([invalid], [route])[0]?.status).toBe('unknown');
  });

  it('无 route 标注 / 单点折线 → 不产生 violation', () => {
    const placements = [furniture('d1', 'desk', 0, 0, 0.6, 1.8)];
    expect(evaluateRouteClear(placements, [])).toEqual([]);
    expect(evaluateRouteClear(placements, [makeRoute('r1', [{ x: 0, z: 0 }])])).toEqual([]);
  });
});
