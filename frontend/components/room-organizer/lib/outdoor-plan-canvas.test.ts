import { describe, expect, it } from 'vitest';
import {
  PLAN_LAYER_STACK,
  defaultLayerVisibility,
  drawFacilityGhost,
  drawFacilityLayer,
  enuToLngLat,
  hexWithAlpha,
  isLayerVisible,
  planMetersPerPixel,
  planPixelToPoint,
  planPointToPixel,
  visiblePlanLayers,
  type PlanCanvasContext,
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

  it('round-trips pixels back to ENU metres (H2-b 绘制取点)', () => {
    const p = { x: 37.5, y: -12.25 };
    const px = planPointToPixel(p, view);
    const back = planPixelToPoint(px, view);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('keeps north-up semantics in the inverse mapping (H2-b)', () => {
    // 屏幕上方（y 更小）→ 更北（y 米更大）。
    const top = planPixelToPoint({ x: view.canvasW / 2, y: view.canvasH / 2 - 50 }, view);
    const mid = planPixelToPoint({ x: view.canvasW / 2, y: view.canvasH / 2 }, view);
    expect(top.y).toBeGreaterThan(mid.y);
    expect(mid.x).toBeCloseTo(0, 6);
    expect(mid.y).toBeCloseTo(0, 6);
  });
});

/* ---------------- H2-c 设施放置绘制（stub ctx 捕获调用） ---------------- */

interface CtxCapture {
  rects: string[];
  dash: number[][];
  texts: string[];
  strokes: string[];
}

function makeCtx(): { ctx: CanvasRenderingContext2D; cap: CtxCapture } {
  const cap: CtxCapture = { rects: [], dash: [], texts: [], strokes: [] };
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    fill: () => {},
    arc: () => {},
    setLineDash: (d: number[]) => cap.dash.push([...d]),
    strokeRect: (x: number, y: number, w: number, h: number) => cap.rects.push(`stroke:${x},${y},${w},${h}`),
    fillRect: (x: number, y: number, w: number, h: number) => cap.rects.push(`fill:${x},${y},${w},${h}`),
    fillText: (t: string) => cap.texts.push(t),
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(ctx, 'strokeStyle', { set: (v: string) => cap.strokes.push(v), get: () => '' });
  Object.defineProperty(ctx, 'fillStyle', { set: () => {}, get: () => '' });
  Object.defineProperty(ctx, 'lineWidth', { set: () => {}, get: () => 1 });
  Object.defineProperty(ctx, 'font', { set: () => {}, get: () => '' });
  Object.defineProperty(ctx, 'textAlign', { set: () => {}, get: () => 'left' });
  Object.defineProperty(ctx, 'textBaseline', { set: () => {}, get: () => 'top' });
  return { ctx, cap };
}

describe('facility ghost & selection drawing (H2-c)', () => {
  it('draws the ghost as a dashed footprint with a template/size label', () => {
    const { ctx, cap } = makeCtx();
    drawFacilityGhost({ ctx, viewport: view } as PlanCanvasContext, { name: '市集摊位', width: 2, depth: 2 }, { x: 0, y: 0 });
    expect(cap.dash).toContainEqual([6, 4]);
    expect(cap.rects.some(r => r.startsWith('stroke:'))).toBe(true);
    expect(cap.rects.some(r => r.startsWith('fill:'))).toBe(true);
    expect(cap.texts.some(t => t.includes('市集摊位') && t.includes('2×2m'))).toBe(true);
    expect(cap.strokes).toContain(PLANNING_LAYER_COLORS.facility);
  });

  it('paints an invalid ghost in warning red', () => {
    const { ctx, cap } = makeCtx();
    drawFacilityGhost({ ctx, viewport: view } as PlanCanvasContext, { name: '舞台台面', width: 8, depth: 6 }, { x: 0, y: 0 }, { invalid: true });
    expect(cap.strokes).toContain('#c0392b');
    expect(cap.strokes).not.toContain(PLANNING_LAYER_COLORS.facility);
  });

  it('highlights the selected facility with a white halo and name label', () => {
    const facility = { id: 'f1', name: '市集摊位 A', position: { x: 0, y: 0 }, rotationDeg: 0, size: { width: 2, depth: 2 } };
    const selected = makeCtx();
    drawFacilityLayer({ ctx: selected.ctx, viewport: view } as PlanCanvasContext, [facility], { selectedId: 'f1' });
    // 底矩形 + 选中白圈 = 两次 strokeRect；名称标注一次。
    expect(selected.cap.rects.filter(r => r.startsWith('stroke:')).length).toBe(2);
    expect(selected.cap.texts).toContain('市集摊位 A');

    const plain = makeCtx();
    drawFacilityLayer({ ctx: plain.ctx, viewport: view } as PlanCanvasContext, [facility], {});
    expect(plain.cap.rects.filter(r => r.startsWith('stroke:')).length).toBe(1);
    expect(plain.cap.texts).toHaveLength(0);
  });

  it('paints warning facilities with a red dashed outline', () => {
    const { ctx, cap } = makeCtx();
    drawFacilityLayer(
      { ctx, viewport: view } as PlanCanvasContext,
      [{ id: 'f2', position: { x: 0, y: 0 }, rotationDeg: 0, size: { width: 2, depth: 2 }, warning: true }],
      {},
    );
    expect(cap.strokes).toContain('#c0392b');
    expect(cap.dash).toContainEqual([6, 4]);
  });
});