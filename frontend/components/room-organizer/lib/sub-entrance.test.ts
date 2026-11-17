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
    expect(proposal?.nodes).toHaveLength(0); // 已有真实规划子口优先复用，不能另造重复门
    expect(proposal?.routes).toHaveLength(1); // 仍补缺失接驳，不因去重把区域留成孤岛
    expect(proposal?.routes[0]?.startNodeId).toBe(existing.id)
    expect(buildSubEntranceProposal({ zones: [], routes: [MAIN], nodes: [] }, ids)).toBeNull();
    expect(buildSubEntranceProposal({ zones: [nearZone], routes: [], nodes: [] }, ids)).toBeNull();
  });

  it('分区贴边 + 已确认主入口在区边内侧：复用该口补驳线，不整区跳过也不另造重复门', () => {
    // 分区西侧贴场地边界（x=0），只有 10×10 m：八个边界采样点全落在 15m 去重半径内，
    // 旧口径会因为没有「贴在环边 1m 内」的节点而把整区当成重复立口跳过 → 返回 null。
    const edgeZone = zone('z-edge', '美食区', [
      { x: 0, y: 30 },
      { x: 10, y: 30 },
      { x: 10, y: 40 },
      { x: 0, y: 40 },
    ]);
    const entrance: PlanNode = {
      ...node('node-main', '已核对主入口', { x: 8.5, y: 35 }),
      verification: 'user-confirmed',
    };
    const proposal = buildSubEntranceProposal(
      {
        zones: [edgeZone],
        routes: [route('route-2', 'pedestrian', [{ x: 30, y: -20 }, { x: 30, y: 80 }])],
        nodes: [entrance],
        boundary: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }],
      },
      ids,
    );
    expect(proposal).not.toBeNull();
    expect(proposal!.nodes).toHaveLength(0); // 复用既有确认口，不另造 15m 内的重复门
    const spur = proposal!.routes[0]!;
    expect(spur.startNodeId).toBe(entrance.id);
    expect(spur.points[0]).toEqual({ x: 8.5, y: 35 }); // 起点就是那个已确认入口
    expect(spur.points[1]).toEqual({ x: 30, y: 35 }); // 终点落在主线上
  });

  it('邻区子口就在旁边时，本区接驳到那个口：不整区放弃，也不重复立口', () => {
    // 2026-11-17 死结 4（正式站实测）：签到台与观众区贴边，观众区口落在共边中点旁 4m。
    // 旧口径「样本离既有节点 15m 内就跳过」会把整个签到台放弃 → 该区永远拿不到驳线，
    // 岗位阶段随后报「尚无后勤接驳，请先安排子流线/子入口」，而重跑子动线还是同样的跳过。
    const portal: PlanNode = {
      ...node('node-portal', '观众区口', { x: 56, y: 205 }),
      verification: 'user-confirmed',
    };
    const checkin = zone('z-checkin', '签到台', [
      { x: 60, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 400 },
      { x: 60, y: 400 },
    ]);
    const proposal = buildSubEntranceProposal(
      {
        zones: [checkin],
        routes: [route('route-9', 'pedestrian', [{ x: 56, y: 205 }, { x: -40, y: 205 }])],
        nodes: [portal],
        boundary: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 500 },
          { x: 0, y: 500 },
        ],
      },
      ids,
    );
    expect(proposal).not.toBeNull();
    expect(proposal!.summary.spurs).toBe(1);
    expect(proposal!.nodes).toHaveLength(0); // 复用邻区那个口，不在 15m 内另造重复门
    const spur = proposal!.routes[0]!;
    expect(spur.startNodeId).toBe(portal.id);
    expect(spur.points[0]).toEqual({ x: 60, y: 205 }); // 落在这个区的边上
    expect(spur.points[1]).toEqual({ x: 56, y: 205 }); // 接到邻区那个口
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
