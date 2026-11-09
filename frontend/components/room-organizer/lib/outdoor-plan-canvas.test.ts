import { describe, expect, it } from 'vitest';
import {
  PLAN_LAYER_STACK,
  defaultLayerVisibility,
  enuToLngLat,
  hexWithAlpha,
  isLayerVisible,
  planMetersPerPixel,
  planPointToPixel,
  visiblePlanLayers,
  type PlanViewport,
} from './outdoor-plan-canvas';
import { PLANNING_LAYER_COLORS } from '@/lib/outdoor-plan-tokens';

const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 16, canvasW: 1200, canvasH: 800 };

describe('outdoor plan canvas core (H2-a)', () => {
  it('places the ENU origin (anchor) at the viewport center when anchor equals center', () => {
    const pt = planPointToPixel({ x: 0, y: 0 }, view);
    expect(pt.x).toBeCloseTo(view.canvasW / 2, 3);
    expect(pt.y).toBeCloseTo(view.canvasH / 2, 3);
  });

  it('maps east to screen-right and north to screen-up (north-up semantics)', () => {
    const metersPerPx = planMetersPerPixel(view);
    const east = planPointToPixel({ x: metersPerPx * 10, y: 0 }, view);
    const north = planPointToPixel({ x: 0, y: metersPerPx * 10 }, view);
    // 原点是视口中心：向东 10 像素 → 屏幕右 10px；向北 10 像素 → 屏幕上 10px（y 减小）。
    expect(east.x).toBeCloseTo(view.canvasW / 2 + 10, 3);
    expect(north.y).toBeCloseTo(view.canvasH / 2 - 10, 3);
  });

  it('round-trips ENU meters through lng/lat back to the same point', () => {
    const p = { x: 123.4, y: -56.7 };
    const geo = enuToLngLat(p.x, p.y, view.lng, view.lat);
    const anchor = enuToLngLat(0, 0, view.lng, view.lat);
    const backX = (geo.lng - anchor.lng) * 111319.49 * Math.cos(view.lat * Math.PI / 180);
    const backY = (geo.lat - anchor.lat) * 111132.92;
    expect(backX).toBeCloseTo(p.x, 1);
    expect(backY).toBeCloseTo(p.y, 1);
  });

  it('orders the layer stack bottom-up with all six business layers', () => {
    expect(PLAN_LAYER_STACK).toEqual(['boundary', 'zone', 'facility', 'route', 'worker', 'access']);
  });

  it('filters visible layers without changing the stack order', () => {
    const vis = defaultLayerVisibility();
    expect(visiblePlanLayers(vis)).toEqual([...PLAN_LAYER_STACK]);
    vis.facility = false;
    vis.zone = false;
    expect(visiblePlanLayers(vis)).toEqual(['boundary', 'route', 'worker', 'access']);
    expect(isLayerVisible(vis, 'facility')).toBe(false);
    // 全案数据不受可见性影响——这里只校验过滤函数本身的口径。
  });

  it('derives rgba from token hex colors', () => {
    expect(hexWithAlpha(PLANNING_LAYER_COLORS.boundary, 0.1)).toBe('rgba(53,98,74,0.1)');
    expect(hexWithAlpha('#ffffff', 0.5)).toBe('rgba(255,255,255,0.5)');
  });

  it('reports a positive meters-per-pixel that shrinks with zoom', () => {
    const z16 = planMetersPerPixel(view);
    const z17 = planMetersPerPixel({ ...view, zoom: 17 });
    expect(z16).toBeGreaterThan(0);
    expect(z17).toBeLessThan(z16);
  });
});