import { expect, it } from 'vitest';
import { createStarterOutdoorPlan } from './outdoor-project-store';
import { checkBoundaryRing } from './site-plan-editing';
import { lngLatToEnu } from './outdoor-plan-canvas';
import { boundaryAtNewAnchor, canReanchorOutdoorPlan, planForPickedVenue } from './outdoor-plan-protection';
import { sceneAnchorFromOutdoorPlan, trueFootprintBoundary } from './outdoor-venue-sync';
it('空规划允许真实选址；已有入口/物料等不随新地名悄悄搬家，原对象不变', () => {
  const plan = createStarterOutdoorPlan(); const next = { ...plan.anchor!, lng: plan.anchor!.lng + 0.1 };
  expect(canReanchorOutdoorPlan(plan, next)).toBe(true);
  plan.nodes.push({ id: 'entry', name: '入口', kind: 'both', notes: '', position: { x: 0, y: 0 } });
  const before = JSON.stringify(plan);
  expect(canReanchorOutdoorPlan(plan, next)).toBe(false);
  expect(canReanchorOutdoorPlan(plan, plan.anchor!)).toBe(true);
  expect(JSON.stringify(plan)).toBe(before);
});
it('只有车（plan.vehicles）的平面也算有内容：不许整体改锤点把车搬走', () => {
  const plan = createStarterOutdoorPlan();
  plan.vehicles = [
    { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', type: 'coach', count: 3, position: { x: 6, y: 8 }, notes: '' },
  ];
  const moved = { ...plan.anchor!, lng: plan.anchor!.lng + 0.1 };
  const before = JSON.stringify(plan);
  expect(canReanchorOutdoorPlan(plan, moved)).toBe(false);
  // 锤点没变时仍允许重复提交同一锤点（幂等），且判定纯读不改 plan。
  expect(canReanchorOutdoorPlan(plan, plan.anchor!)).toBe(true);
  expect(JSON.stringify(plan)).toBe(before);
});

it('旧 plan 不带 vehicles 字段不虚构车：空规划仍可换锤点', () => {
  const plan = createStarterOutdoorPlan();
  delete (plan as { vehicles?: unknown }).vehicles;
  expect(canReanchorOutdoorPlan(plan, { ...plan.anchor!, lng: plan.anchor!.lng + 0.1 })).toBe(true);
});

it('真实面写米制坐标，场景西北原点与缩放可反映射到同一地理场地', () => {
  const anchor = { lng: 120.163, lat: 30.25, crs: 'gcj-02' as const, source: 'lookup' as const };
  const footprint = [{ lng: 120.163, lat: 30.25 }, { lng: 120.165, lat: 30.25 }, { lng: 120.165, lat: 30.251 }, { lng: 120.163, lat: 30.251 }];
  const boundary = trueFootprintBoundary([...footprint, footprint[0]!], anchor)!;
  expect(boundary).toHaveLength(4); expect(checkBoundaryRing(boundary).ok).toBe(true); expect(Math.max(...boundary.map(p => p.x))).toBeGreaterThan(150);
  const mirror = sceneAnchorFromOutdoorPlan({ anchor, boundary });
  expect(mirror).not.toBeNull(); expect(mirror!.lng).toBeCloseTo(120.163, 5); expect(mirror!.lat).toBeCloseTo(30.251, 5);
});

it('远处场地手画前不改锚点，闭合时一次转换旧视口坐标到新地理原点', () => {
  const oldAnchor = { lng: 120.1, lat: 30.2 }; const next = { lng: 120.5, lat: 30.4 };
  const geos = [{ lng: 120.5, lat: 30.4 }, { lng: 120.501, lat: 30.4 }, { lng: 120.501, lat: 30.401 }, { lng: 120.5, lat: 30.401 }];
  const draft = geos.map(p => lngLatToEnu(p.lng, p.lat, oldAnchor.lng, oldAnchor.lat));
  expect(Math.max(...draft.map(p => p.x))).toBeGreaterThan(30000);
  const converted = boundaryAtNewAnchor(draft, oldAnchor, next);
  expect(converted[0]!.x).toBeCloseTo(0, 3); expect(converted[0]!.y).toBeCloseTo(0, 3);
  expect(checkBoundaryRing(converted).ok).toBe(true);
  expect(oldAnchor).toEqual({ lng: 120.1, lat: 30.2 });
});

// 2026-11-16 用户定稿「换场地就是新场地」：换了地理位置就把旧草稿删掉，不再拒改。
it('换场地：锚点真挪了就清空旧草稿，只留新锚点与新用地红线', () => {
  const plan = createStarterOutdoorPlan();
  plan.nodes.push({ id: 'entry', name: '入口', kind: 'both', notes: '', position: { x: 0, y: 0 } });
  plan.zones.push({ id: '11111111-1111-4111-8111-111111111111', name: '观众区', color: '#888', polygon: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }] } as never);
  plan.facilities.push({ id: '22222222-2222-4222-8222-222222222222', name: '摊位', catalogId: 'booth', position: { x: 2, y: 2 }, rotation: 0 } as never);
  const nextAnchor = { lng: plan.anchor!.lng + 0.1, lat: plan.anchor!.lat, crs: 'gcj-02' as const, source: 'picker' as const };
  const boundary = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }];
  const result = planForPickedVenue(plan, nextAnchor, boundary);
  expect(result.replaced).toBe(true);
  expect(result.cleared).toBe(3);
  expect(result.plan.anchor).toEqual(nextAnchor);
  expect(result.plan.boundary).toEqual(boundary);
  for (const items of [result.plan.zones, result.plan.routes, result.plan.nodes, result.plan.facilities, result.plan.workers]) {
    expect(items).toHaveLength(0);
  }
  // 原对象不被就地改动：撤销与历史快照还靠它。
  expect(plan.zones).toHaveLength(1);
  expect(plan.nodes).toHaveLength(1);
});

it('同一锚点原地重画边界：内容原样保留，只换 boundary', () => {
  const plan = createStarterOutdoorPlan();
  plan.nodes.push({ id: 'entry', name: '入口', kind: 'both', notes: '', position: { x: 0, y: 0 } });
  const boundary = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }];
  const result = planForPickedVenue(plan, { ...plan.anchor! }, boundary);
  expect(result.replaced).toBe(false);
  expect(result.cleared).toBe(0);
  expect(result.plan.nodes).toHaveLength(1);
  expect(result.plan.boundary).toEqual(boundary);
});

it('空草稿换场：不报清空项，锚点与红线照样跟着新场地走', () => {
  const plan = createStarterOutdoorPlan();
  const nextAnchor = { lng: 120.5, lat: 30.4, crs: 'gcj-02' as const, source: 'picker' as const };
  const boundary = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 8 }, { x: 0, y: 8 }];
  const result = planForPickedVenue(plan, nextAnchor, boundary);
  expect(result.cleared).toBe(0);
  expect(result.plan.anchor).toEqual(nextAnchor);
  expect(result.plan.boundary).toEqual(boundary);
});
