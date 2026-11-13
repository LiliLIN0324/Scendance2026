import { describe, expect, it } from 'vitest';
import type { PlanNode, PlanRoute } from '../../../../supabase/functions/_shared/site-plan';
import {
  buildNode,
  buildRoute,
  buildWorker,
  detachNodeFromRoutes,
  inferNodeZoneId,
  inferWorkerZoneId,
  movePlanNode,
  nodeRouteRefs,
  planNodeIssues,
  planWorkerIssues,
  reverseRoute,
  workerRoleSummary,
  workerZoneSummary,
} from './site-plan-routes';
import type { PlanEditIssue } from './site-plan-editing';

const NODE_WEST: PlanNode = { id: 'd4000000-0000-4000-8000-000000000001', kind: 'entry', name: '西门', position: { x: 0, y: 60 }, notes: '' };
const NODE_EAST: PlanNode = { id: 'd4000000-0000-4000-8000-000000000002', kind: 'exit', name: '东出口', position: { x: 200, y: 60 }, notes: '' };
const NODE_LONELY: PlanNode = { id: 'd4000000-0000-4000-8000-000000000003', kind: 'both', name: '北门', position: { x: 100, y: 120 }, notes: '' };

function makeRoute(overrides: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'c3000000-0000-4000-8000-000000000001',
    kind: 'pedestrian',
    name: '入场动线',
    points: [{ x: 0, y: 60 }, { x: 55, y: 60 }, { x: 55, y: 30 }],
    oneWay: true,
    startNodeId: NODE_WEST.id,
    endNodeId: NODE_EAST.id,
    notes: '',
    ...overrides,
  };
}

const BOUNDARY = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }];
const ZONES = [
  { id: 'a1000000-0000-4000-8000-000000000001', name: '观众区', polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }] },
  { id: 'a1000000-0000-4000-8000-000000000002', name: '排队区', polygon: [{ x: 12, y: 70 }, { x: 42, y: 70 }, { x: 42, y: 108 }, { x: 12, y: 108 }] },
];

function firstIssue(result: { ok: boolean } & { issue?: PlanEditIssue }): PlanEditIssue {
  expect(result.ok).toBe(false);
  return (result as { ok: false; issue: PlanEditIssue }).issue;
}

describe('site-plan routes / nodes (H2-d)', () => {
  it('builds a route with node-referenced endpoints and rejects bad geometry', () => {
    const ok = buildRoute({
      kind: 'vehicle',
      name: '装卸动线',
      points: [{ x: 200, y: 60 }, { x: 160, y: 60 }],
      startNodeId: NODE_EAST.id,
      endNodeId: NODE_WEST.id,
      widthM: 6,
    }, [NODE_EAST, NODE_WEST]);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.oneWay).toBe(false);
    expect(ok.value.startNodeId).toBe(NODE_EAST.id);
    expect(ok.value.widthM).toBe(6);

    const tooFew = buildRoute({ kind: 'pedestrian', name: 'X', points: [{ x: 0, y: 0 }] });
    expect(firstIssue(tooFew).code).toBe('too-few-vertices');

    const dup = buildRoute({ kind: 'pedestrian', name: 'X', points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }] });
    expect(firstIssue(dup).code).toBe('duplicate-vertex');

    const out = buildRoute({ kind: 'pedestrian', name: 'X', points: [{ x: 6000, y: 0 }, { x: 0, y: 0 }] });
    expect(firstIssue(out).code).toBe('out-of-range');

    const dangling = buildRoute({ kind: 'pedestrian', name: 'X', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], startNodeId: 'd9999999-0000-4000-8000-000000000000' }, [NODE_WEST]);
    expect(firstIssue(dangling).code).toBe('unknown-node');
  });

  it('reverses direction and swaps endpoint references while keeping oneWay', () => {
    const route = makeRoute();
    const flipped = reverseRoute(route);
    expect(flipped.points[0]).toEqual({ x: 55, y: 30 });
    expect(flipped.points[flipped.points.length - 1]).toEqual({ x: 0, y: 60 });
    expect(flipped.startNodeId).toBe(NODE_EAST.id);
    expect(flipped.endNodeId).toBe(NODE_WEST.id);
    expect(flipped.oneWay).toBe(true);
    expect(flipped.id).toBe(route.id);
    expect(flipped.kind).toBe(route.kind);
  });

  it('moves a node and routes referencing it follow the new position', () => {
    const route = makeRoute();
    const next = { x: -10, y: 70 };
    const result = movePlanNode(NODE_WEST, next, [route]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.node.position).toEqual(next);
    expect(result.value.routes[0].points[0]).toEqual(next);
    expect(result.value.routes[0].points[2]).toEqual({ x: 55, y: 30 });
    expect(result.value.routes[0].startNodeId).toBe(NODE_WEST.id);
  });

  it('rejects a node move that collapses a referenced route', () => {
    // 2 点路线两端都引用同一节点：移动节点会让两点重合。
    const loopish = makeRoute({ points: [{ x: 0, y: 60 }, { x: 40, y: 60 }], startNodeId: NODE_WEST.id, endNodeId: NODE_WEST.id });
    const result = movePlanNode(NODE_WEST, { x: 10, y: 60 }, [loopish]);
    expect(firstIssue(result).code).toBe('duplicate-vertex');

    const outOfRange = movePlanNode(NODE_WEST, { x: 9000, y: 0 }, []);
    expect(firstIssue(outOfRange).code).toBe('out-of-range');
  });

  it('detaches node references but keeps route geometry when deleting a node', () => {
    const route = makeRoute();
    const [next] = detachNodeFromRoutes(NODE_WEST.id, [route]);
    expect(next?.startNodeId).toBeUndefined();
    expect(next?.endNodeId).toBe(NODE_EAST.id);
    expect(next?.points).toEqual(route.points);
    // 与删除的节点无关的路线原样返回（同一对象，避免无谓 diff）。
    const [untouched] = detachNodeFromRoutes('d4000000-0000-4000-8000-00000000ffff', [route]);
    expect(untouched).toBe(route);
  });

  it('lists node route references and unconnected nodes', () => {
    const route = makeRoute();
    const refs = nodeRouteRefs(NODE_WEST.id, [route]);
    expect(refs.startRoutes).toHaveLength(1);
    expect(refs.endRoutes).toHaveLength(0);

    const issues = planNodeIssues({ nodes: [NODE_WEST, NODE_EAST, NODE_LONELY], routes: [route] });
    expect(issues).toHaveLength(1);
    expect(issues[0].nodeId).toBe(NODE_LONELY.id);
    expect(issues[0].issue.code).toBe('unconnected-node');
  });
});

describe('site-plan workers (H2-d)', () => {
  it('builds a worker with automatic zone attribution and boundary hints', () => {
    const inZone = buildWorker({ role: '安保', count: 2, position: { x: 30, y: 30 } }, BOUNDARY, ZONES);
    expect(inZone.ok).toBe(true);
    if (!inZone.ok) return;
    expect(inZone.value.zoneId).toBe(ZONES[0].id);
    expect(inZone.issues).toBeUndefined();

    const explicit = buildWorker({ role: '引导员', count: 1, position: { x: 30, y: 30 }, zoneId: ZONES[1].id }, BOUNDARY, ZONES);
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.value.zoneId).toBe(ZONES[1].id);

    const outside = buildWorker({ role: '机动', count: 1, position: { x: 250, y: 60 } }, BOUNDARY, ZONES);
    expect(outside.ok).toBe(true);
    if (!outside.ok) return;
    expect(outside.value.zoneId).toBeUndefined();
    expect(outside.issues?.[0].code).toBe('out-of-boundary');

    const badCount = buildWorker({ role: '安保', count: 0, position: { x: 30, y: 30 } }, BOUNDARY, ZONES);
    expect(firstIssue(badCount).code).toBe('out-of-range');

    const badZone = buildWorker({ role: '安保', count: 1, position: { x: 30, y: 30 }, zoneId: 'a9999999-0000-4000-8000-000000000000' }, BOUNDARY, ZONES);
    expect(firstIssue(badZone).code).toBe('unknown-zone');

    const emptyRole = buildWorker({ role: '  ', count: 1, position: { x: 30, y: 30 } }, BOUNDARY, ZONES);
    expect(emptyRole.ok).toBe(false);
  });

  it('stores gender on labor people and drops it on 自定义点', () => {
    const person = buildWorker({ role: '经理', count: 1, position: { x: 30, y: 30 }, gender: 'female' }, BOUNDARY, ZONES);
    expect(person.ok).toBe(true);
    if (person.ok) expect(person.value.gender).toBe('female');

    const pin = buildWorker({ role: '自定义点', count: 1, position: { x: 30, y: 30 }, gender: 'female' }, BOUNDARY, ZONES);
    expect(pin.ok).toBe(true);
    if (pin.ok) expect(pin.value.gender).toBeUndefined();
  });

  it('infers the containing zone by point-in-ring', () => {
    expect(inferWorkerZoneId({ x: 30, y: 30 }, ZONES)).toBe(ZONES[0].id);
    expect(inferWorkerZoneId({ x: 20, y: 90 }, ZONES)).toBe(ZONES[1].id);
    expect(inferWorkerZoneId({ x: 150, y: 90 }, ZONES)).toBeUndefined();
  });

  it('summarizes workers by zone and by role', () => {
    const workers = [
      { id: 'e5000000-0000-4000-8000-000000000001', role: '安保', count: 2, position: { x: 30, y: 30 }, zoneId: ZONES[0].id, notes: '' },
      { id: 'e5000000-0000-4000-8000-000000000002', role: '安保', count: 1, position: { x: 20, y: 90 }, zoneId: ZONES[1].id, notes: '' },
      { id: 'e5000000-0000-4000-8000-000000000003', role: '引导员', count: 1, position: { x: 150, y: 90 }, notes: '' },
    ];
    const byZone = workerZoneSummary({ zones: ZONES, workers });
    expect(byZone).toEqual([
      { zoneId: ZONES[0].id, zoneName: '观众区', total: 2, posts: 1 },
      { zoneId: ZONES[1].id, zoneName: '排队区', total: 1, posts: 1 },
      { zoneId: null, zoneName: '未归属分区', total: 1, posts: 1 },
    ]);
    const byRole = workerRoleSummary({ workers });
    expect(byRole).toEqual([
      { role: '安保', total: 3, posts: 2 },
      { role: '引导员', total: 1, posts: 1 },
    ]);
  });

  it('flags workers placed outside the boundary', () => {
    const workers = [
      { id: 'e5000000-0000-4000-8000-000000000001', role: '机动', count: 1, position: { x: 300, y: 60 }, notes: '' },
    ];
    const issues = planWorkerIssues({ boundary: BOUNDARY, workers });
    expect(issues).toHaveLength(1);
    expect(issues[0].workerId).toBe(workers[0].id);
    expect(issues[0].issue.code).toBe('out-of-boundary');
    expect(planWorkerIssues({ boundary: [], workers })).toHaveLength(0);
  });
});

describe('site-plan nodes (buildNode 归属分区)', () => {
  it('builds a node with automatic zone attribution and boundary hints', () => {
    const inZone = buildNode({ kind: 'entry', name: '入口 1', position: { x: 30, y: 30 } }, BOUNDARY, ZONES);
    expect(inZone.ok).toBe(true);
    if (!inZone.ok) return;
    expect(inZone.value.zoneId).toBe(ZONES[0].id);
    expect(inZone.issues).toBeUndefined();

    const explicit = buildNode({ kind: 'exit', name: '出口 1', position: { x: 30, y: 30 }, zoneId: ZONES[1].id }, BOUNDARY, ZONES);
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.value.zoneId).toBe(ZONES[1].id);

    const outside = buildNode({ kind: 'both', name: '出入口 1', position: { x: 250, y: 60 } }, BOUNDARY, ZONES);
    expect(outside.ok).toBe(true);
    if (!outside.ok) return;
    expect(outside.value.zoneId).toBeUndefined();
    expect(outside.issues?.[0].code).toBe('out-of-boundary');

    const badZone = buildNode({ kind: 'entry', name: '入口 2', position: { x: 30, y: 30 }, zoneId: 'a9999999-0000-4000-8000-000000000000' }, BOUNDARY, ZONES);
    expect(firstIssue(badZone).code).toBe('unknown-zone');

    const outOfRange = buildNode({ kind: 'entry', name: '入口 3', position: { x: 6000, y: 0 } }, BOUNDARY, ZONES);
    expect(firstIssue(outOfRange).code).toBe('out-of-range');

    const emptyName = buildNode({ kind: 'entry', name: '   ', position: { x: 30, y: 30 } }, BOUNDARY, ZONES);
    expect(emptyName.ok).toBe(false);
  });

  it('infers the containing zone by point-in-ring', () => {
    expect(inferNodeZoneId({ x: 30, y: 30 }, ZONES)).toBe(ZONES[0].id);
    expect(inferNodeZoneId({ x: 20, y: 90 }, ZONES)).toBe(ZONES[1].id);
    expect(inferNodeZoneId({ x: 150, y: 90 }, ZONES)).toBeUndefined();
  });
});
