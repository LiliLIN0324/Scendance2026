import { expect, it } from 'vitest';
import { createStarterOutdoorPlan } from './outdoor-project-store';
import { checkBoundaryRing } from './site-plan-editing';
import { lngLatToEnu } from './outdoor-plan-canvas';
import { boundaryAtNewAnchor, canReanchorOutdoorPlan } from './outdoor-plan-protection';
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
