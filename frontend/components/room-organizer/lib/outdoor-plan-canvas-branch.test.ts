import { describe, expect, it } from 'vitest';
import {
  drawBranchAnchor,
  findRouteBranchAnchor,
  planPointToPixel,
  type PlanCanvasContext,
  type PlanViewport,
} from './outdoor-plan-canvas';

const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 18, canvasW: 1200, canvasH: 800 };

const node = { id: 'n1', name: '出入口 1', position: { x: 0, y: 0 } };
const route = {
  id: 'r1',
  name: '人行动线 1',
  points: [
    { x: 30, y: 0 },
    { x: 60, y: 0 },
  ],
};
const plan = { nodes: [node], routes: [route] };

const pxOf = (p: { x: number; y: number }) => planPointToPixel(p, view);

describe('Alt 分叉：先认已有点，再谈画线', () => {
  it('点在节点上 → 锚到节点，并带上 nodeId（提交时能写 startNodeId）', () => {
    const anchor = findRouteBranchAnchor(plan, pxOf(node.position), view);
    expect(anchor).not.toBeNull();
    expect(anchor!.kind).toBe('node');
    expect(anchor!.nodeId).toBe('n1');
    expect(anchor!.label).toBe('出入口 1');
    expect(anchor!.point).toEqual(node.position);
  });

  it('点在动线折点上 → 锚到折点（不抢节点的优先级）', () => {
    const anchor = findRouteBranchAnchor(plan, pxOf(route.points[1]!), view);
    expect(anchor!.kind).toBe('route-vertex');
    expect(anchor!.label).toBe('人行动线 1');
    expect(anchor!.point).toEqual(route.points[1]!);
    expect(anchor!.nodeId).toBeUndefined();
  });

  it('节点与折点挨着时节点优先（端点吸附更可靠）', () => {
    const crowded = {
      nodes: [{ id: 'n2', name: '出入口 2', position: { x: 0, y: 0 } }],
      routes: [{ id: 'r2', name: '后勤动线', points: [{ x: 0.2, y: 0 }] }],
    };
    const anchor = findRouteBranchAnchor(crowded, pxOf({ x: 0.1, y: 0 }), view);
    expect(anchor!.kind).toBe('node');
  });

  it('离所有点都远 → 没有锚点，就不会误起一条线', () => {
    expect(findRouteBranchAnchor(plan, pxOf({ x: 0, y: 40 }), view)).toBeNull();
  });

  it('半径可调：默认 14px 内才认', () => {
    const near = { x: 0, y: 0 };
    const px = pxOf(near);
    const pushed = { x: px.x + 13, y: px.y };
    expect(findRouteBranchAnchor(plan, pushed, view)).not.toBeNull();
    const tooFar = { x: px.x + 40, y: px.y };
    expect(findRouteBranchAnchor(plan, tooFar, view)).toBeNull();
    // 调大半径就能认到
    expect(findRouteBranchAnchor(plan, tooFar, view, { nodeRadiusPx: 60 })).not.toBeNull();
  });
});

describe('Alt 落点顺带告诉画布「画什么」', () => {
  const vehiclePlan = {
    nodes: [],
    routes: [
      {
        id: 'r3',
        name: '车行道 1',
        kind: 'vehicle',
        color: '#334455',
        oneWay: true,
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 40, y: 0 },
        ],
      },
    ],
  };

  it('折点带出来源动线的类型/颜色/单行（不会退回工具箱里的旧类型）', () => {
    const anchor = findRouteBranchAnchor(vehiclePlan, pxOf({ x: 20, y: 0 }), view)!;
    expect(anchor.routeId).toBe('r3');
    expect(anchor.routeKind).toBe('vehicle');
    expect(anchor.routeColor).toBe('#334455');
    expect(anchor.routeOneWay).toBe(true);
    expect(anchor.vertexIndex).toBe(1);
    expect(anchor.isEndpoint).toBe(false);
  });

  it('首/末折点标成端点（端点上按 Alt = 原地续接同一条线）', () => {
    const start = findRouteBranchAnchor(vehiclePlan, pxOf({ x: 0, y: 0 }), view)!;
    const end = findRouteBranchAnchor(vehiclePlan, pxOf({ x: 40, y: 0 }), view)!;
    expect(start.vertexIndex).toBe(0);
    expect(start.isEndpoint).toBe(true);
    expect(end.vertexIndex).toBe(2);
    expect(end.isEndpoint).toBe(true);
  });

  it('节点锚点不带动线类型（由画布回退到已选中的线或工具箱）', () => {
    const anchor = findRouteBranchAnchor(plan, pxOf(node.position), view)!;
    expect(anchor.routeId).toBeUndefined();
    expect(anchor.routeKind).toBeUndefined();
  });
});

describe('分叉锚点的「+」提示', () => {
  function makeCtx() {
    let arcs = 0;
    const segments: number[][] = [];
    const ctx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: (x: number, y: number) => { segments.push([x, y]); },
      lineTo: (x: number, y: number) => { segments.push([x, y]); },
      arc: () => { arcs += 1; },
      fill: () => {},
      stroke: () => {},
    } as unknown as CanvasRenderingContext2D;
    for (const prop of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap'] as const) {
      Object.defineProperty(ctx, prop, { set: () => {}, get: () => '' });
    }
    return { ctx, segments, get arcs() { return arcs; } };
  }

  it('画两圈（白底 + 品牌色）和一枚十字，位置就在锚点上', () => {
    const cap = makeCtx();
    drawBranchAnchor({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, { x: 320, y: 240 });
    expect(cap.arcs).toBe(2);
    const xs = cap.segments.map(([x]) => x);
    const ys = cap.segments.map(([, y]) => y);
    expect(Math.min(...xs)).toBe(316);
    expect(Math.max(...xs)).toBe(324);
    expect(Math.min(...ys)).toBe(236);
    expect(Math.max(...ys)).toBe(244);
  });
});
