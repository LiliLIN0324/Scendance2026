import { describe, expect, it } from 'vitest';
import { buildSubEntranceProposal } from './sub-entrance';
import type { PlanNode, PlanRoute, PlanZone } from '../../../../supabase/functions/_shared/site-plan';

const ids = (() => {
  let n = 0;
  return () => `id-${(n += 1)}`;
})();

function zone(id: string, name: string, polygon: { x: number; y: number }[]): PlanZone {
  return { id, semantic: 'audience', name, polygon, color: '#1a9e5c', notes: '' };
}

function route(id: string, kind: PlanRoute['kind'], points: { x: number; y: number }[]): PlanRoute {
  return { id, kind, name: id, points, oneWay: false, widthM: 2, notes: '' };
}

function node(id: string, name: string, position: { x: number; y: number }): PlanNode {
  return { id, kind: 'both', name, position, notes: '' };
}

/** 主流线：东西向横穿 y=0。 */
const MAIN = route('route-1', 'pedestrian', [{ x: -500, y: 0 }, { x: 500, y: 0 }]);

describe('buildSubEntranceProposal（V-4a 子出入口）', () => {
  it('分区接到最近流线：子口在分区边上、驳线两点、类别随被接流线', () => {
    const plan = {
      zones: [zone('z1', '观众区', [{ x: -100, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 160 }, { x: -100, y: 160 }])],
      routes: [MAIN],
      nodes: [],
    };
    const proposal = buildSubEntranceProposal(plan, ids)!;
    expect(proposal.summary.spurs).toBe(1);
    expect(proposal.nodes.length).toBe(1);
    const spur = proposal.routes[0]!;
    expect(spur.kind).toBe('pedestrian');
    expect(spur.name).toContain('观众区');
    expect(spur.points.length).toBe(2);
    // 子口在分区边界 y=60 那条边上（离 y=0 的主流线最近的边）
    expect(spur.points[0]!.y).toBe(60);
    // 驳线终点落在主流线上（y=0）
    expect(spur.points[1]!.y).toBe(0);
    // 节点与驳线起点重合
    expect(proposal.nodes[0]!.position).toEqual(spur.points[0]);
  });

  it('流线太远（>120m）的分区跳过并计数', () => {
    const plan = {
      zones: [zone('z-far', '远区', [{ x: -50, y: 300 }, { x: 50, y: 300 }, { x: 50, y: 400 }, { x: -50, y: 400 }])],
      routes: [MAIN],
      nodes: [],
    };
    const proposal = buildSubEntranceProposal(plan, ids);
    expect(proposal).toBeNull(); // 唯一分区太远 → 整案 null
  });

  it('与既有节点 15m 内不重复立；无分区或无流线回 null', () => {
    const nearZone = zone('z1', '观众区', [{ x: -100, y: 60 }, { x: 100, y: 60 }, { x: 100, y: 160 }, { x: -100, y: 160 }]);
    const existing = node('node-1', '已有口', { x: 0, y: 60 }); // 就在最佳子口位
    const proposal = buildSubEntranceProposal({ zones: [nearZone], routes: [MAIN], nodes: [existing] }, ids);
    expect(proposal).toBeNull(); // 唯一分区的最佳位被占 → 整案 null
    expect(buildSubEntranceProposal({ zones: [], routes: [MAIN], nodes: [] }, ids)).toBeNull();
    expect(buildSubEntranceProposal({ zones: [nearZone], routes: [], nodes: [] }, ids)).toBeNull();
  });

  it('多分区批量出驳线，id 全唯一，数量 ≤ 上限', () => {
    // 同一 y 带沿流线一字排开（离主流线都是 60m），只按 x 错开
    const zones = [0, 220, 440].map((x, i) =>
      zone(`z${i}`, `区${i}`, [{ x: x - 100, y: 60 }, { x: x + 100, y: 60 }, { x: x + 100, y: 140 }, { x: x - 100, y: 140 }]),
    );
    const proposal = buildSubEntranceProposal({ zones, routes: [MAIN], nodes: [] }, ids)!;
    expect(proposal.summary.spurs).toBe(3);
    const allIds = [...proposal.routes.map(r => r.id), ...proposal.nodes.map(n => n.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
    // 居中门位：每个子口 x = 分区中心（平局时边中点胜过顶点）
    expect(proposal.nodes.map(n => n.position.x)).toEqual([0, 220, 440]);
  });
});
