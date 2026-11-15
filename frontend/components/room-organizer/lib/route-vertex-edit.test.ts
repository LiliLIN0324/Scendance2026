/**
 * 2026-11-15 用户指令：「路线和分区一样的，需要就是在线上可以加点、减点、挪动合并点」。
 * 这里锁住画布那条交互链背后的两步契约（与 zone-edge-insert.test.ts 同构）：
 * 先用 nearestPolylineEdge 找出被点的是哪条边、投影点在哪 → 再 insertRouteVertex；
 * 拖点靠近邻居 → nearestMergeTarget 给目标 → removeRouteVertex 并点。
 * 组件里就是这几步，所以测它们拼起来的行为，避免两边口径漂移。
 */
import { describe, expect, it } from 'vitest';

import { planPointToPixel, type PlanViewport } from './outdoor-plan-canvas';
import {
  insertRouteVertex,
  moveRouteVertex,
  PLAN_ROUTE_MIN_VERTICES,
  removeRouteVertex,
} from './site-plan-routes';
import { nearestMergeTarget, nearestPolylineEdge } from './site-plan-snap';

import type { PlanRoute } from '../../../../supabase/functions/_shared/site-plan';

/** 视口取 zoom 22（≈31 px/m）：接近实机编辑比例，12 px 的并点阈值才不会被几十米当一点。 */
const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 22, canvasW: 1200, canvasH: 800 };

/** L 形折线：(0,0) → (20,0) → (20,20)。三条测试共用，坐标都是米制 ENU。 */
const L: { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
];

function pxOf(point: { x: number; y: number }) {
  return planPointToPixel(point, view);
}

/** 动线夹具：直接拼 PlanRoute（不经过 buildRoute 的节点存在性校验，这里只测折点编辑）。 */
function routeOf(
  points: { x: number; y: number }[],
  extra: { startNodeId?: string; endNodeId?: string } = {},
): PlanRoute {
  return {
    id: 'r-1',
    kind: 'pedestrian',
    name: '人行 A',
    points: points.map(p => ({ x: p.x, y: p.y })),
    oneWay: false,
    notes: '',
    ...extra,
  };
}

describe('动线加点（点线中段就在线上插一个折点）', () => {
  it('点第一段中间 → 命中第 0 条边，投影点落在段上', () => {
    const edge = nearestPolylineEdge(L, pxOf({ x: 10, y: 0 }), view)!;
    expect(edge).not.toBeNull();
    expect(edge.index).toBe(0);
    expect(edge.point.x).toBeCloseTo(10, 3);
    expect(edge.point.y).toBeCloseTo(0, 3);
    expect(edge.distPx).toBeLessThan(1);
  });

  it('点第二段（竖段）中间 → 命中第 1 条边', () => {
    const edge = nearestPolylineEdge(L, pxOf({ x: 20, y: 12 }), view)!;
    expect(edge.index).toBe(1);
    expect(edge.point.y).toBeCloseTo(12, 3);
  });

  it('开放折线不认「末点接回首点」的虚幻边：末点与首点之间不算命中', () => {
    // (20,20) 与 (0,0) 之间的中点附近：闭合环会命中第 2 条边，折线不该给这条边。
    const probe = pxOf({ x: 10, y: 10 });
    const onPolyline = nearestPolylineEdge(L, probe, view)!;
    expect(onPolyline.index).toBeLessThanOrEqual(1);
    const toFirst = Math.abs(onPolyline.index - 2);
    expect(toFirst).toBeGreaterThan(0);
  });

  it('插点后折线多一个点，原有顶点顺序不变', () => {
    const route = routeOf(L);
    const edge = nearestPolylineEdge(L, pxOf({ x: 10, y: 0 }), view)!;
    const inserted = insertRouteVertex(route, edge.index, edge.point);
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(inserted.value.points).toHaveLength(4);
    expect(inserted.value.points[1]!.x).toBeCloseTo(10, 3);
    // 首末点不动（起终点语义不因加点而改变）。
    expect(inserted.value.points[0]!).toEqual({ x: 0, y: 0 });
    expect(inserted.value.points.at(-1)!).toEqual({ x: 20, y: 20 });
  });

  it('首末段插点都保留出入口引用（端点没动，引用仍有效）', () => {
    const route = routeOf(L, { startNodeId: 'n-in', endNodeId: 'n-out' });
    const firstEdge = insertRouteVertex(route, 0, { x: 5, y: 0 });
    expect(firstEdge.ok).toBe(true);
    if (firstEdge.ok) expect(firstEdge.value.startNodeId).toBe('n-in');
    const lastEdge = insertRouteVertex(route, 1, { x: 20, y: 10 });
    expect(lastEdge.ok).toBe(true);
    if (lastEdge.ok) {
      expect(lastEdge.value.startNodeId).toBe('n-in');
      expect(lastEdge.value.endNodeId).toBe('n-out');
    }
  });

  it('边序号越界 / 插点与已有顶点重合 → 拒绝并给原因', () => {
    const route = routeOf(L);
    const bad = insertRouteVertex(route, 9, { x: 10, y: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issue.message).toContain('边序号');

    const dup = insertRouteVertex(route, 0, { x: 20, y: 0 });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.issue.code).toBe('duplicate-vertex');
  });
});

describe('动线减点（点一下折点就删，两侧自动相连）', () => {
  it('删中间折点 → 剩 2 点，端点引用不动', () => {
    const route = routeOf(L, { startNodeId: 'n-in', endNodeId: 'n-out' });
    const removed = removeRouteVertex(route, 1);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.points).toEqual([{ x: 0, y: 0 }, { x: 20, y: 20 }]);
    expect(removed.value.startNodeId).toBe('n-in');
    expect(removed.value.endNodeId).toBe('n-out');
  });

  it('删起点 → 解除起点引用（不留悬空 nodeId）；删终点同口径', () => {
    const route = routeOf(L, { startNodeId: 'n-in', endNodeId: 'n-out' });
    const dropStart = removeRouteVertex(route, 0);
    expect(dropStart.ok).toBe(true);
    if (dropStart.ok) {
      expect(dropStart.value.startNodeId).toBeUndefined();
      expect(dropStart.value.endNodeId).toBe('n-out');
    }
    const dropEnd = removeRouteVertex(route, 2);
    expect(dropEnd.ok).toBe(true);
    if (dropEnd.ok) {
      expect(dropEnd.value.startNodeId).toBe('n-in');
      expect(dropEnd.value.endNodeId).toBeUndefined();
    }
  });

  it('只剩 2 个点就删不动（动线至少要起点和终点）', () => {
    const route = routeOf([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(PLAN_ROUTE_MIN_VERTICES).toBe(2);
    const removed = removeRouteVertex(route, 0);
    expect(removed.ok).toBe(false);
    if (!removed.ok) expect(removed.issue.code).toBe('too-few-vertices');
  });

  it('序号越界 → 报错不抛异常', () => {
    const route = routeOf(L);
    const result = removeRouteVertex(route, 7);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.code).toBe('bad-index');
  });
});

describe('动线挪点与并点', () => {
  it('挪中间折点 → 只有该点变，其余不动', () => {
    const route = routeOf(L);
    const moved = moveRouteVertex(route, 1, { x: 25, y: 4 });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.points[1]!).toEqual({ x: 25, y: 4 });
    expect(moved.value.points[0]!).toEqual({ x: 0, y: 0 });
    expect(moved.value.points[2]!).toEqual({ x: 20, y: 20 });
  });

  it('挪到相邻点同一位置 → 拒绝（先合并，不要留下重合点）', () => {
    const route = routeOf(L);
    const moved = moveRouteVertex(route, 1, { x: 0, y: 0 });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.issue.code).toBe('duplicate-vertex');
  });

  it('拖到邻居 12 px 内 → 给出并点目标；按它删点后折线少一个点', () => {
    // 两点相距 0.2 m（≈6 px）：拖回邻居身边就该被吸走（实机上手感等价于“两个点叠一起了”）。
    const near = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0.2 }];
    const route = routeOf(near, { endNodeId: 'n-out' });
    const neighbor = pxOf({ x: 10, y: 0 });
    const target = nearestMergeTarget(near, 2, { x: neighbor.x, y: neighbor.y + 3 }, view);
    expect(target).toBe(1);
    const merged = removeRouteVertex(route, 2);
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.value.points).toHaveLength(2);
    // 并到一个端点 → 终点引用随之解除（几何不再落在节点上）。
    expect(merged.value.endNodeId).toBeUndefined();
  });

  it('离得远不吸（返回 null），不会误删', () => {
    const last = pxOf({ x: 20, y: 20 });
    expect(nearestMergeTarget(L, 2, { x: last.x - 30, y: last.y }, view)).toBeNull();
  });
});
