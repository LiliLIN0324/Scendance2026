import { describe, expect, it } from 'vitest';
import { buildRouteProposal, matchRouteCommand, routeIntentNote } from './route-proposal';
import type { RoadSegment } from './road-network';

/** 测试用确定性 id。 */
const ids = (() => {
  let n = 0;
  return () => `id-${(n += 1)}`;
})();

/** 锚点 = (0,0) 语义：直接用真实经纬度构造 ±0.008°（≈770m）的路网。 */
const ANCHOR = { lng: 120.54, lat: 30.4 };
/** 与实现同一套球面近似：metersPerDegreeLng(30.4) ≈ 96018。 */
const M_PER_LNG = Math.cos(30.4 * Math.PI / 180) * 111319.49;

function road(id: string, highway: string, name: string, points: [number, number][]): RoadSegment {
  return { id, highway, name, points };
}

/** 500×400m 矩形边界（ENU），中心在锚点。 */
const BOUNDARY = [
  { x: -250, y: -200 }, { x: 250, y: -200 }, { x: 250, y: 200 }, { x: -250, y: 200 },
];

/** 穿场而过的南北向道路（在 x=0 处跨越边界南北边；沿线多点防裁剪断链，中间点落在扩展 bbox 内）。 */
const NORTH_SOUTH_ROAD = road('way-1', 'primary', '观潮大道', [
  [ANCHOR.lng, ANCHOR.lat - 0.008],
  [ANCHOR.lng, ANCHOR.lat - 0.003],
  [ANCHOR.lng, ANCHOR.lat],
  [ANCHOR.lng, ANCHOR.lat + 0.003],
  [ANCHOR.lng, ANCHOR.lat + 0.008],
]);

/** 东西向步行道（在 y=0 处跨越边界东西边）。 */
const EAST_WEST_FOOTWAY = road('way-2', 'footway', '滨海步道', [
  [ANCHOR.lng - 0.008, ANCHOR.lat],
  [ANCHOR.lng - 0.004, ANCHOR.lat],
  [ANCHOR.lng, ANCHOR.lat],
  [ANCHOR.lng + 0.004, ANCHOR.lat],
  [ANCHOR.lng + 0.008, ANCHOR.lat],
]);

/** #3 现场同款：湖滨路（东西向，贴着场地南缘穿场，界内约 800 m）与仁和路（南北向，在场地东侧穿北缘，约 294 m）。 */
const HUBIN_ROAD = road('way-hubin', 'secondary', '湖滨路', [
  [ANCHOR.lng - 0.006, ANCHOR.lat - 0.0015],
  [ANCHOR.lng - 0.003, ANCHOR.lat - 0.0015],
  [ANCHOR.lng, ANCHOR.lat - 0.0015],
  [ANCHOR.lng + 0.003, ANCHOR.lat - 0.0015],
  [ANCHOR.lng + 0.006, ANCHOR.lat - 0.0015],
]);

const RENHE_ROAD = road('way-renhe', 'primary', '仁和路', [
  [ANCHOR.lng + 0.002, ANCHOR.lat + 0.0005],
  [ANCHOR.lng + 0.002, ANCHOR.lat + 0.002],
  [ANCHOR.lng + 0.002, ANCHOR.lat + 0.004],
]);

describe('matchRouteCommand（V-2 意图）', () => {
  it('排流线类说法命中 auto', () => {
    expect(matchRouteCommand('排一下流线')).toBe('auto');
    expect(matchRouteCommand('画出流线和入口')).toBe('auto');
    expect(matchRouteCommand('自动排一下入口')).toBe('auto');
  });

  it('删除/无关说法不劫持', () => {
    expect(matchRouteCommand('把流线删了')).toBeNull();
    expect(matchRouteCommand('在潮乐之城去做设计')).toBeNull();
    expect(matchRouteCommand('')).toBeNull();
  });

  it('复合规划不走单独的自动流线指令', () => {
    expect(matchRouteCommand('请帮我画出流线和入口。', true)).toBe('auto');
    expect(matchRouteCommand('排流线，先划室外展览区和室外表演区', true)).toBeNull();
  });
});

describe('buildRouteProposal（V-2c 生成规则）', () => {
  it('穿场道路 → 对应类别流线 + 边界交点出入口', () => {
    const proposal = buildRouteProposal({ boundary: BOUNDARY, anchor: ANCHOR, roads: [NORTH_SOUTH_ROAD, EAST_WEST_FOOTWAY] }, ids);
    expect(proposal).not.toBeNull();
    const kinds = proposal!.routes.map(route => route.kind);
    expect(kinds).toContain('vehicle'); // primary → 车行
    expect(kinds).toContain('pedestrian'); // footway → 人行
    expect(proposal!.summary.entrances).toBeGreaterThanOrEqual(2);
    expect(proposal!.nodes.every(node => node.kind === 'both')).toBe(true);
    // 出入口落在边界环上（点到最近边界线段的距离 <5m；交点在边上不在顶点上）
    const distToSegment = (point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number => {
      const dx = b.x - a.x; const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
    };
    for (const node of proposal!.nodes) {
      const onRing = Math.min(...BOUNDARY.map((vertex, index) => {
        const next = BOUNDARY[(index + 1) % BOUNDARY.length]!;
        return distToSegment(node.position, vertex, next);
      }));
      expect(onRing).toBeLessThan(5);
    }
    // 契约口径：点名非空、宽度随类别、notes 带来源
    expect(proposal!.routes.every(route => route.name.length > 0 && route.points.length >= 2)).toBe(true);
    expect(proposal!.routes.find(route => route.kind === 'vehicle')?.widthM).toBe(6);
    expect(proposal!.routes.every(route => route.notes.includes('AI 路网提案'))).toBe(true);
  });

  it('路网为空 / 边界退化 → null（回「路网拿不到」）', () => {
    expect(buildRouteProposal({ boundary: BOUNDARY, anchor: ANCHOR, roads: [] }, ids)).toBeNull();
    expect(buildRouteProposal({ boundary: [], anchor: ANCHOR, roads: [NORTH_SOUTH_ROAD] }, ids)).toBeNull();
  });

  it('道路离场太远（不在 bbox+150m 内）不产生提案', () => {
    const farRoad = road('way-far', 'primary', '远郊大道', [
      [ANCHOR.lng + 0.06, ANCHOR.lat + 0.06],
      [ANCHOR.lng + 0.07, ANCHOR.lat + 0.07],
    ]);
    expect(buildRouteProposal({ boundary: BOUNDARY, anchor: ANCHOR, roads: [farRoad] }, ids)).toBeNull();
  });

  it('路网绕场不进界时给接驳线兜底', () => {
    // 贴着东边界外 ~60m 的南北向路（bbox+150m 内但不穿越边界环）
    const xOffM = 250 + 60; // 米
    const xOff = xOffM / M_PER_LNG;
    const bypass = road('way-bypass', 'secondary', '绕场路', [
      [ANCHOR.lng + xOff, ANCHOR.lat - 0.004],
      [ANCHOR.lng + xOff, ANCHOR.lat - 0.002],
      [ANCHOR.lng + xOff, ANCHOR.lat],
      [ANCHOR.lng + xOff, ANCHOR.lat + 0.002],
      [ANCHOR.lng + xOff, ANCHOR.lat + 0.004],
    ]);
    const proposal = buildRouteProposal({ boundary: BOUNDARY, anchor: ANCHOR, roads: [bypass] }, ids);
    expect(proposal).not.toBeNull();
    expect(proposal!.routes.some(route => route.name.includes('接驳线'))).toBe(true);
    expect(proposal!.nodes.length).toBeGreaterThanOrEqual(1);
    // 接驳线长 ≈ 60m（点到最近顶点的距离量级）
    const spur = proposal!.routes.find(route => route.name.includes('接驳线'))!;
    expect(Math.hypot(spur.points[1]!.x - spur.points[0]!.x, spur.points[1]!.y - spur.points[0]!.y)).toBeLessThan(120);
  });

  it('同类超上限只留最长的几条，id 全部唯一', () => {
    const many: RoadSegment[] = Array.from({ length: 6 }, (_, i) =>
      road(`way-${i}`, 'primary', `大道${i}`, [
        [ANCHOR.lng + (i * 3) / M_PER_LNG, ANCHOR.lat - 0.008],
        [ANCHOR.lng + (i * 3) / M_PER_LNG, ANCHOR.lat - 0.003],
        [ANCHOR.lng + (i * 3) / M_PER_LNG, ANCHOR.lat + 0.003],
        [ANCHOR.lng + (i * 3) / M_PER_LNG, ANCHOR.lat + 0.008],
      ]),
    );
    const proposal = buildRouteProposal({ boundary: BOUNDARY, anchor: ANCHOR, roads: many }, ids)!;
    const vehicleRoutes = proposal.routes.filter(route => route.kind === 'vehicle');
    expect(vehicleRoutes.length).toBeLessThanOrEqual(3);
    const allIds = [...proposal.routes.map(route => route.id), ...proposal.nodes.map(node => node.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

/**
 * #3（2026-11-18）：改口要能落到选路口径上。
 *
 * 真因：选路一直是纯几何的——同类里按「落在范围内的长度」排序，于是
 * 「主通道改走场地北侧仁和路，别沿湖滨路走」两轮都没被采纳，入口候选始终只有
 * 湖滨路上的那一个。这里把原话接进选路：点名的路优先、明确不要的路不选。
 */
describe('buildRouteProposal（#3 改口落到选路口径）', () => {
  const roads = [HUBIN_ROAD, RENHE_ROAD];

  it('没给原话时行为与旧口径一致：同类按长度，湖滨路在前', () => {
    const proposal = buildRouteProposal({ boundary: BOUNDARY, anchor: ANCHOR, roads }, ids)!;
    const vehicle = proposal.routes.filter(route => route.kind === 'vehicle');
    expect(vehicle[0]!.name).toContain('湖滨路');
    expect(proposal.intent).toBeUndefined();
    expect(routeIntentNote(proposal.intent)).toBeNull();
  });

  it('点名的路排到同类第一条（不再只按长度）', () => {
    const proposal = buildRouteProposal({
      boundary: BOUNDARY,
      anchor: ANCHOR,
      roads,
      request: '主通道走仁和路',
    }, ids)!;
    const vehicle = proposal.routes.filter(route => route.kind === 'vehicle');
    expect(vehicle[0]!.name).toContain('仁和路');
    expect(proposal.intent?.preferred).toEqual(['仁和路']);
    expect(proposal.intent?.excluded).toEqual([]);
  });

  it('明确不要的路不进候选，入口候选来自点名的那条路', () => {
    const proposal = buildRouteProposal({
      boundary: BOUNDARY,
      anchor: ANCHOR,
      roads,
      request: '主通道改走场地北侧仁和路，别沿湖滨路走',
    }, ids)!;
    expect(proposal.routes.some(route => route.name.includes('湖滨路'))).toBe(false);
    expect(proposal.routes.some(route => route.name.includes('仁和路'))).toBe(true);
    // 入口候选来自被选中的那条路——不再是湖滨路上的口。
    expect(proposal.nodes.map(node => node.name)).toContain('仁和路口');
    expect(proposal.nodes.some(node => node.name.includes('湖滨路'))).toBe(false);
    expect(proposal.intent?.preferred).toEqual(['仁和路']);
    expect(proposal.intent?.excluded).toEqual(['湖滨路']);
    // 卡片上要如实说明改了什么。
    const note = routeIntentNote(proposal.intent)!;
    expect(note).toContain('按你点名的「仁和路」');
    expect(note).toContain('按你说的没有用「湖滨路」');
  });

  it('否定只管到本小句：「别沿湖滨路走，改走仁和路」不会把仁和路一起排除', () => {
    const proposal = buildRouteProposal({
      boundary: BOUNDARY,
      anchor: ANCHOR,
      roads,
      request: '别沿湖滨路走，改走仁和路',
    }, ids)!;
    expect(proposal.intent?.excluded).toEqual(['湖滨路']);
    expect(proposal.intent?.preferred).toEqual(['仁和路']);
    expect(proposal.routes.some(route => route.name.includes('仁和路'))).toBe(true);
  });

  it('「从 X 改到 Y」两头都认：X 不进候选，Y 排最前', () => {
    const proposal = buildRouteProposal({
      boundary: BOUNDARY,
      anchor: ANCHOR,
      roads,
      request: '把流线从湖滨路改到仁和路',
    }, ids)!;
    expect(proposal.intent?.excluded).toEqual(['湖滨路']);
    expect(proposal.intent?.preferred).toEqual(['仁和路']);
    expect(proposal.routes.some(route => route.name.includes('湖滨路'))).toBe(false);
    expect(proposal.routes.filter(route => route.kind === 'vehicle')[0]!.name).toContain('仁和路');
  });

  it('点名的路这一带路网里没有 → 如实说没找到，不装作听懂了', () => {
    const proposal = buildRouteProposal({
      boundary: BOUNDARY,
      anchor: ANCHOR,
      roads,
      request: '主通道改走北侧的仁和东路',
    }, ids)!;
    expect(proposal.intent?.notFound).toBe(true);
    expect(routeIntentNote(proposal.intent)).toContain('没找到');
  });

  it('点名的路够不着（离场太远）→ 也要说没找到，不能装作采纳了', () => {
    const farRoad = road('way-far', 'primary', '远郊大道', [
      [ANCHOR.lng + 0.06, ANCHOR.lat + 0.06],
      [ANCHOR.lng + 0.07, ANCHOR.lat + 0.07],
    ]);
    const proposal = buildRouteProposal({
      boundary: BOUNDARY,
      anchor: ANCHOR,
      roads: [HUBIN_ROAD, farRoad],
      request: '主通道改走远郊大道',
    }, ids)!;
    expect(proposal.intent?.notFound).toBe(true);
    expect(proposal.intent?.preferred).toEqual([]);
    expect(routeIntentNote(proposal.intent)).toContain('没找到');
  });

  it('想排除的路是这一带唯一一条 → 先留着候选并如实说明，不静默塞回去', () => {
    const proposal = buildRouteProposal({
      boundary: BOUNDARY,
      anchor: ANCHOR,
      roads: [HUBIN_ROAD],
      request: '别沿湖滨路走',
    }, ids)!;
    expect(proposal.routes.length).toBeGreaterThan(0);
    expect(proposal.intent?.keptExcluded).toEqual(['湖滨路']);
    expect(proposal.intent?.excluded).toEqual([]);
    expect(routeIntentNote(proposal.intent)).toContain('你想排除');
  });
});
