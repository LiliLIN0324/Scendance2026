/**
 * 2026-11-15 用户：「从场地外的线到场地边界的时候，交界处会自动变成出入口」，
 * 随后反馈：「微调之后原先的出入口没有消失，又多了出入口」。
 * 所以这里锁住的不是「交点就新建」，而是**同一条动线自己那几只节点跟着交点走**：
 * 位置微调 → 挪过去（不新建）；交点变少/消失 → 删掉；用户手放的 / 改过名字的 / 被引用的 → 不动。
 */
import { describe, expect, it } from 'vitest';

import type { PlanNode } from '../../../../supabase/functions/_shared/site-plan';
import {
  isAutoCrossingNode,
  reconcileCrossingNodes,
  removeAutoCrossingNodesOfRoute,
  routeBoundaryCrossings,
  type CrossingNodeReconcile,
} from './site-plan-routes';

/** 100×100 的方形场地。 */
const BOUNDARY = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

function userNode(x: number, y: number, name = '西门', kind: PlanNode['kind'] = 'both'): PlanNode {
  return { id: `user-${x}-${y}`, kind, name, position: { x, y }, notes: '' };
}

function reconcile(
  points: { x: number; y: number }[],
  nodes: PlanNode[],
  extra: {
    id?: string;
    /** 单向线：points 的先后就是行进方向。不传 = 双向。 */
    oneWay?: boolean;
    routes?: { id: string; startNodeId?: string; endNodeId?: string }[];
  } = {},
): CrossingNodeReconcile {
  return reconcileCrossingNodes(
    {
      points,
      ...(extra.id !== undefined ? { id: extra.id } : {}),
      ...(extra.oneWay !== undefined ? { oneWay: extra.oneWay } : {}),
    },
    { boundary: BOUNDARY, nodes, routes: extra.routes ?? [] },
  );
}

describe('动线穿边 → 交点', () => {
  it('从界外进界内 → 一个交点，落在边界上', () => {
    const crossings = routeBoundaryCrossings([{ x: -20, y: 50 }, { x: 60, y: 50 }], BOUNDARY);
    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.x).toBeCloseTo(0, 6);
    expect(crossings[0]!.y).toBeCloseTo(50, 6);
  });

  it('穿场而过（外→内→外）→ 两个交点，沿动线顺序', () => {
    const crossings = routeBoundaryCrossings([{ x: -20, y: 30 }, { x: 120, y: 30 }], BOUNDARY);
    expect(crossings).toHaveLength(2);
    expect(crossings[0]!.x).toBeCloseTo(0, 6);
    expect(crossings[1]!.x).toBeCloseTo(100, 6);
  });

  it('整条线在界内 / 边界没画完 → 没有交点', () => {
    expect(routeBoundaryCrossings([{ x: 10, y: 10 }, { x: 90, y: 90 }], BOUNDARY)).toHaveLength(0);
    expect(routeBoundaryCrossings([{ x: -20, y: 50 }, { x: 60, y: 50 }], [{ x: 0, y: 0 }, { x: 100, y: 0 }])).toHaveLength(0);
  });
});

describe('交界处自动出入口（默认出入口）', () => {
  it('交点处没节点 → 建一个 kind=both 的出入口，坐标吸到 0.1 m', () => {
    const result = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.kind).toBe('both');
    expect(result.added[0]!.name).toBe('出入口 1');
    expect(result.added[0]!.position).toEqual({ x: 0, y: 50 });
    expect(isAutoCrossingNode(result.added[0]!)).toBe(true);
    expect(result.nodes).toHaveLength(1);
  });

  it('两个交点 → 两个出入口，编号连续', () => {
    const result = reconcile([{ x: -20, y: 30 }, { x: 120, y: 30 }], [], { id: 'r-1' });
    expect(result.added.map(node => node.name)).toEqual(['出入口 1', '出入口 2']);
    expect(result.added.map(node => node.position.x)).toEqual([0, 100]);
  });
});

describe('微调不重复出入口（用户反馈的回归）', () => {
  it('交点只挪了 2 m → 挪同一只节点，不新建、不多出来', () => {
    const first = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    expect(first.nodes).toHaveLength(1);

    // 用户把线往下拖了一点：交点从 y=50 变成 y=52。
    const second = reconcile([{ x: -20, y: 52 }, { x: 60, y: 52 }], first.nodes, { id: 'r-1' });
    expect(second.added).toHaveLength(0);
    expect(second.moved).toHaveLength(1);
    expect(second.nodes).toHaveLength(1);
    expect(second.nodes[0]!.id).toBe(first.nodes[0]!.id);
    expect(second.nodes[0]!.position).toEqual({ x: 0, y: 52 });
  });

  it('连续微调十次 → 始终只有一个出入口', () => {
    let nodes: PlanNode[] = [];
    for (let step = 0; step < 10; step += 1) {
      const y = 40 + step;
      nodes = reconcile([{ x: -20, y }, { x: 60, y }], nodes, { id: 'r-1' }).nodes;
    }
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.position.y).toBe(49);
  });

  it('线缩回场内（不再穿边）→ 自己那只自动出入口被删掉', () => {
    const first = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    const second = reconcile([{ x: 10, y: 50 }, { x: 60, y: 50 }], first.nodes, { id: 'r-1' });
    expect(second.removed).toHaveLength(1);
    expect(second.nodes).toHaveLength(0);
  });

  it('穿场变单边（两个交点变一个）→ 多出来的那只删掉', () => {
    const first = reconcile([{ x: -20, y: 30 }, { x: 120, y: 30 }], [], { id: 'r-1' });
    expect(first.nodes).toHaveLength(2);
    const second = reconcile([{ x: -20, y: 30 }, { x: 60, y: 30 }], first.nodes, { id: 'r-1' });
    expect(second.removed).toHaveLength(1);
    expect(second.nodes).toHaveLength(1);
  });

  it('重复提交同一条动线是幂等的', () => {
    const first = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    const second = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], first.nodes, { id: 'r-1' });
    expect(second.added).toHaveLength(0);
    expect(second.moved).toHaveLength(0);
    expect(second.removed).toHaveLength(0);
  });
});

describe('单向 / 双向 → 入口 / 出口 / 出入口（2026-11-15 用户）', () => {
  it('单向线与进场：交界处是入口', () => {
    // 从外 (-20,50) 往内 (60,50) 走 → 是在进场。
    const result = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1', oneWay: true });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.kind).toBe('entry');
    expect(result.added[0]!.name).toBe('入口 1');
  });

  it('单向线与离场：交界处是出口', () => {
    // 从内 (60,50) 往场外 (-20,50) 走 → 是在离场。
    const result = reconcile([{ x: 60, y: 50 }, { x: -20, y: 50 }], [], { id: 'r-1', oneWay: true });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]!.kind).toBe('exit');
    expect(result.added[0]!.name).toBe('出口 1');
  });

  it('单向线穿场：先进后出 → 一只入口 + 一只出口', () => {
    const result = reconcile([{ x: -20, y: 30 }, { x: 120, y: 30 }], [], { id: 'r-1', oneWay: true });
    expect(result.added.map(node => node.kind)).toEqual(['entry', 'exit']);
    expect(result.added.map(node => node.name)).toEqual(['入口 1', '出口 1']);
  });

  it('双向线：两边都是出入口', () => {
    const result = reconcile([{ x: -20, y: 30 }, { x: 120, y: 30 }], [], { id: 'r-1', oneWay: false });
    expect(result.added.map(node => node.kind)).toEqual(['both', 'both']);
    expect(result.added.map(node => node.name)).toEqual(['出入口 1', '出入口 2']);
  });

  it('单向线反了方向：同一只节点改型改名，不新建', () => {
    const inward = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1', oneWay: true });
    expect(inward.nodes[0]!.kind).toBe('entry');
    const outward = reconcile([{ x: 60, y: 50 }, { x: -20, y: 50 }], inward.nodes, { id: 'r-1', oneWay: true });
    expect(outward.added).toHaveLength(0);
    expect(outward.retyped).toHaveLength(1);
    expect(outward.nodes).toHaveLength(1);
    expect(outward.nodes[0]!.id).toBe(inward.nodes[0]!.id);
    expect(outward.nodes[0]!.kind).toBe('exit');
    expect(outward.nodes[0]!.name).toBe('出口 1');
  });

  it('单向线改成双向：同一只节点变出入口', () => {
    const inward = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1', oneWay: true });
    const twoWay = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], inward.nodes, { id: 'r-1', oneWay: false });
    expect(twoWay.added).toHaveLength(0);
    expect(twoWay.nodes).toHaveLength(1);
    expect(twoWay.nodes[0]!.kind).toBe('both');
    expect(twoWay.nodes[0]!.name).toBe('出入口 1');
  });

  it('用户手动改过类型：不跟著流向改回去', () => {
    const inward = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1', oneWay: true });
    // 用户把自动建的入口手动改成出入口。
    const manual = inward.nodes.map(node => ({ ...node, kind: 'both' as const }));
    const again = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], manual, { id: 'r-1', oneWay: true });
    expect(again.retyped).toHaveLength(0);
    expect(again.nodes[0]!.kind).toBe('both');
  });
});

describe('不该动的东西一律不动', () => {
  it('用户手放的节点压在交点上 → 不新建、不删它', () => {
    const mine = userNode(0, 50, '西门');
    const result = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [mine], { id: 'r-1' });
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.nodes).toEqual([mine]);
  });

  it('自动节点被动线端点引用 → 不删（引用还指着它）', () => {
    const first = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    const auto = first.nodes[0]!;
    // 线改成从这只出入口出发且不再穿边。
    const second = reconcile(
      [{ x: 0, y: 50 }, { x: 60, y: 50 }],
      first.nodes,
      { id: 'r-1', routes: [{ id: 'r-1', startNodeId: auto.id }] },
    );
    expect(second.removed).toHaveLength(0);
    expect(second.nodes).toHaveLength(1);
  });

  it('用户给自动节点改过名字 → 不删（保守，别吃掉用户的命名）', () => {
    const first = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    const renamed = [{ ...first.nodes[0]!, name: '西侧临时口' }];
    const second = reconcile([{ x: 10, y: 50 }, { x: 60, y: 50 }], renamed, { id: 'r-1' });
    expect(second.removed).toHaveLength(0);
    expect(second.nodes).toHaveLength(1);
  });

  it('别的动线建的自动节点不会被这条线抢走', () => {    // 这条线（r-2）在 y=70 处穿边；r-1 的自动节点头在 (0,50)，距离 20 m > 5 m。
    const other = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    const mine = reconcile([{ x: -20, y: 70 }, { x: 60, y: 70 }], other.nodes, { id: 'r-2' });
    expect(mine.nodes).toHaveLength(2);
    expect(mine.removed).toHaveLength(0);
  });
});

describe('删掉动线时收走它自己建的交界节点', () => {
  it('未被引用的自动节点跟着动线一起消失', () => {
    const built = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    const left = removeAutoCrossingNodesOfRoute('r-1', { nodes: built.nodes, routes: [{ id: 'r-1' }] });
    expect(left).toHaveLength(0);
  });

  it('被别的动线引用的、或用户改过名字的保留', () => {
    const built = reconcile([{ x: -20, y: 30 }, { x: 120, y: 30 }], [], { id: 'r-1' });
    const [first, second] = built.nodes;
    const kept = removeAutoCrossingNodesOfRoute('r-1', {
      nodes: [{ ...second!, name: '南门临时口' }],
      routes: [{ id: 'r-1' }, { id: 'r-2', startNodeId: first!.id }],
    });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.name).toBe('南门临时口');
  });

  it('别的动线建的节点不受影响', () => {
    const mine = reconcile([{ x: -20, y: 50 }, { x: 60, y: 50 }], [], { id: 'r-1' });
    const other = reconcile([{ x: -20, y: 70 }, { x: 60, y: 70 }], mine.nodes, { id: 'r-2' });
    const left = removeAutoCrossingNodesOfRoute('r-1', { nodes: other.nodes, routes: [{ id: 'r-1' }, { id: 'r-2' }] });
    expect(left).toHaveLength(1);
    expect(left[0]!.position.y).toBe(70);
  });
});
