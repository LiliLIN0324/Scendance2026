import { describe, expect, it } from 'vitest';
import { sitePlanDataSchema, type PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { REPLICA_CASES } from './replica-cases';
import { resolveFacilityTemplate } from './plan-facility-catalog';
import { DEFAULT_SCOPE_MARGIN_M, expandRect } from './outdoor-design-scope';

/** 射线法：点是否在多边形内（边界粗略即可——复刻数据只需保证实体都落在边界内）。 */
function pointInRing(p: PlanPoint, ring: PlanPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('replica-cases（OnePlan 经典案例复刻）', () => {
  it('复刻清单齐全（45 个唯一案例）且 id 唯一', () => {
    expect(REPLICA_CASES.length).toBe(45);
    expect(new Set(REPLICA_CASES.map(c => c.id)).size).toBe(REPLICA_CASES.length);
  });

  it('每案过 schema 严格校验', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      expect(sitePlanDataSchema.parse(plan), `${replica.id} schema`).toBeTruthy();
    }
  });

  // 2026-11-17 用户：「案例库画完了用地红线，外面没有对应的白色框」。
  // 病根是案例只生成了 boundary、没写 designScope，画布按 designScope>=3 才画白框，
  // 于是打开经典案例看不见框外那圈压暗与四角白 L，和手画红线的行为对不上。
  it('每案都带设计范围：红线外接矩形四边各外扩 20 m（案例也有那只白框）', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      const scope = plan.designScope ?? [];
      expect(scope.length, `${replica.id} 缺 designScope`).toBeGreaterThanOrEqual(3);
      const xs = plan.boundary.map(p => p.x);
      const ys = plan.boundary.map(p => p.y);
      const expectScope = expandRect(plan.boundary, DEFAULT_SCOPE_MARGIN_M);
      // 与「画好红线默认=设计范围」同一套几何：四个角正好各边外扩 20 m。
      expect(scope, replica.id).toEqual(expectScope);
      const margin = DEFAULT_SCOPE_MARGIN_M;
      expect(Math.min(...scope.map(p => p.x))).toBeCloseTo(Math.min(...xs) - margin, 5);
      expect(Math.max(...scope.map(p => p.x))).toBeCloseTo(Math.max(...xs) + margin, 5);
      expect(Math.min(...scope.map(p => p.y))).toBeCloseTo(Math.min(...ys) - margin, 5);
      expect(Math.max(...scope.map(p => p.y))).toBeCloseTo(Math.max(...ys) + margin, 5);
    }
  });

  it('每案带真实案例锚点 + 非空区块/设施/流线', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      expect(plan.anchor?.source, replica.id).toBe('preset');
      expect(plan.boundary.length).toBeGreaterThanOrEqual(3);
      expect(plan.zones.length, `${replica.id} zones`).toBeGreaterThanOrEqual(3);
      expect(plan.facilities.length, `${replica.id} facilities`).toBeGreaterThanOrEqual(5);
      expect(plan.routes.length, `${replica.id} routes`).toBeGreaterThanOrEqual(1);
      expect(plan.nodes.length, `${replica.id} nodes`).toBeGreaterThanOrEqual(1);
    }
  });

  it('boundary 包住全部 zone 顶点与设施落点（不触发越界误报）', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      for (const zone of plan.zones) {
        for (const p of zone.polygon) {
          expect(pointInRing(p, plan.boundary), `${replica.id} zone ${zone.name} 顶点 (${p.x},${p.y}) 越界`).toBe(true);
        }
      }
      for (const facility of plan.facilities) {
        expect(pointInRing(facility.position, plan.boundary), `${replica.id} facility ${facility.name} 越界`).toBe(true);
      }
      for (const node of plan.nodes) {
        expect(pointInRing(node.position, plan.boundary), `${replica.id} node ${node.name} 越界`).toBe(true);
      }
    }
  });

  it('全部 facility.templateId 能解析出模板（名字/占地进清单与图例）', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      for (const facility of plan.facilities) {
        expect(resolveFacilityTemplate(facility.templateId), `${replica.id} templateId ${facility.templateId} 不可解析`).not.toBeNull();
      }
    }
  });

  it('设施 zoneId 引用完整（若有绑定则指向存在的分区）', () => {
    for (const replica of REPLICA_CASES) {
      const plan = replica.buildPlan();
      const zoneIds = new Set(plan.zones.map(zone => zone.id));
      for (const facility of plan.facilities) {
        if (facility.zoneId) expect(zoneIds.has(facility.zoneId), `${replica.id} facility ${facility.name} zoneId 悬空`).toBe(true);
      }
    }
  });

  it('Scotiabank 冰球日（首案）细节钉住', () => {
    const replica = REPLICA_CASES.find(c => c.id === 'scotiabank-hockey-day-canada')!;
    const plan = replica.buildPlan();
    expect(plan.anchor).toEqual({ lng: -123.3716, lat: 48.4235, crs: 'gcj-02', source: 'preset' });
    // 黄色单向流线（OnePlan 案例的标志性呈现）
    expect(plan.routes.filter(r => r.oneWay && r.color === '#f2c744').length).toBeGreaterThanOrEqual(3);
    expect(plan.zones.length).toBe(10);
  });
});
