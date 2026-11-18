import { describe, expect, it } from 'vitest';
import { auditWalkability, describeWalkAudit } from './walk-audit';
import type { PlanFacility, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** 30 × 20 m 的矩形红线，中心在原点（ENU：x 东、y 北）。 */
const boundary: PlanPoint[] = [
  { x: -15, y: -10 },
  { x: 15, y: -10 },
  { x: 15, y: 10 },
  { x: -15, y: 10 },
];
const metrics = { width: 30, depth: 20 };

function facility(overrides: Partial<PlanFacility> & { id: string }): PlanFacility {
  return {
    name: '设施',
    templateId: 'tent-3x3',
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    size: { width: 3, depth: 3 },
    notes: '',
    ...overrides,
  } as PlanFacility;
}

describe('auditWalkability', () => {
  it('reports a fully reachable empty site', () => {
    const report = auditWalkability({ facilities: [], boundary, metrics });
    expect(report.reachableRatio).toBeGreaterThan(0.98);
    expect(report.unreachableFacilities).toEqual([]);
    expect(report.blockedRoutes).toEqual([]);
    expect(report.headline).toContain('通行正常');
  });

  it('finds facilities cut off behind a wall', () => {
    // 隔断要顶出红线（深度 21 > 20），否则人从两端缺口绕过去，“走不到”就不成立。
    const wall = facility({ id: 'wall', name: '隔断', position: { x: 0, y: 0 }, size: { width: 0.6, depth: 21 } });
    const left = facility({ id: 'left', name: '左侧帐篷', position: { x: -8, y: 0 }, size: { width: 2, depth: 2 } });
    const right = facility({ id: 'right', name: '右侧舞台', position: { x: 8, y: 0 }, size: { width: 2, depth: 2 } });
    const report = auditWalkability({
      facilities: [wall, left, right],
      boundary,
      metrics,
      start: { x: -8, z: 0 },
    });
    const names = report.unreachableFacilities.map((item) => item.name);
    expect(names).toContain('右侧舞台');
    expect(names).not.toContain('左侧帐篷');
    expect(report.reachableRatio).toBeLessThan(0.6);
  });

  it('names the facility that blocks a route, with distance along the route', () => {
    const tent = facility({ id: 'tent', name: '帐篷 A', position: { x: 0, y: 0 }, size: { width: 4, depth: 4 } });
    const report = auditWalkability({
      facilities: [tent],
      boundary,
      metrics,
      start: { x: -12, z: 0 },
      routes: [{ points: [{ x: -10, y: 0 }, { x: 10, y: 0 }], kind: 'pedestrian' }],
    });
    expect(report.blockedRoutes).toHaveLength(1);
    expect(report.blockedRoutes[0]!.blockers).toContain('帐篷 A');
    // 帐篷半宽 2 + 玩家半径 0.28 → 约 7.7 m 处就过不去。
    expect(report.blockedRoutes[0]!.distanceAlongM).toBeGreaterThan(7);
    expect(report.blockedRoutes[0]!.distanceAlongM).toBeLessThan(9);
  });

  it('flags a squeezed gap narrower than 0.9 m without blocking it', () => {
    // 两道墙各 8 m 深，分别在 +4.6 / −4.6，中间留 1.2 m 缝：人过得去（半径 0.28），推车算窄。
    const upper = facility({ id: 'u', name: '上墙', position: { x: 0, y: 4.6 }, size: { width: 1, depth: 8 } });
    const lower = facility({ id: 'd', name: '下墙', position: { x: 0, y: -4.6 }, size: { width: 1, depth: 8 } });
    const report = auditWalkability({
      facilities: [upper, lower],
      boundary,
      metrics,
      start: { x: -8, z: 0 },
      routes: [{ points: [{ x: -8, y: 0 }, { x: 8, y: 0 }], kind: 'pedestrian' }],
    });
    expect(report.blockedRoutes).toEqual([]);
    expect(report.narrowestRouteWidthM).not.toBeNull();
    expect(report.narrowestRouteWidthM!).toBeLessThan(0.9);
  });

  it('reports a blocked sightline to the main stage', () => {
    const stage = facility({ id: 'stage', name: '主舞台', position: { x: 10, y: 0 }, size: { width: 6, depth: 4 } });
    const tent = facility({ id: 'tent', name: '挡视帐篷', position: { x: 3, y: 0 }, size: { width: 2, depth: 2 } });
    const report = auditWalkability({
      facilities: [stage, tent],
      boundary,
      metrics,
      start: { x: -10, z: 0 },
    });
    expect(report.sightline?.target).toBe('主舞台');
    expect(report.sightline?.blocked).toBe(true);
    expect(report.sightline?.distanceM).toBeGreaterThan(11.5);
    expect(report.sightline?.distanceM).toBeLessThan(12.5);
    expect(report.headline).toContain('看「主舞台」被挡');
  });

  it('leaves the sightline empty when there is nothing to look at', () => {
    const report = auditWalkability({ facilities: [], boundary, metrics });
    expect(report.sightline).toBeNull();
  });

  it('does not treat the red line itself as a narrow passage', () => {
    // 流线贴着红线走：场外不该被当成障碍，否则每条贴边流线都会报 0.5 m。
    const report = auditWalkability({
      facilities: [],
      boundary,
      metrics,
      routes: [{ points: [{ x: -14, y: 9.5 }, { x: 14, y: 9.5 }], kind: 'pedestrian' }],
    });
    expect(report.blockedRoutes).toEqual([]);
    expect(report.narrowSpots).toEqual([]);
    expect(report.narrowestRouteWidthM).toBeNull();
  });

  it('summarises into one HUD line', () => {
    const tent = facility({ id: 'tent', name: '帐篷 A', position: { x: 0, y: 0 }, size: { width: 4, depth: 4 } });
    const report = auditWalkability({
      facilities: [tent],
      boundary,
      metrics,
      start: { x: -12, z: 0 },
      routes: [{ points: [{ x: -10, y: 0 }, { x: 10, y: 0 }] }],
    });
    expect(describeWalkAudit(report)).toMatch(/可达 \d+%.*1 条流线被挡/);
  });
});
