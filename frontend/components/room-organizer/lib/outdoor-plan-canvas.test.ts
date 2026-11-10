import { describe, expect, it } from 'vitest';
import {
  PLAN_LAYER_STACK,
  defaultLayerVisibility,
  drawAccessLayer,
  drawConflictMarkers,
  drawFacilityGhost,
  drawFacilityLayer,
  drawMeasureDraft,
  drawMeasureLayer,
  drawNodeGhost,
  drawRouteDraft,
  drawRouteLayer,
  drawWorkerLayer,
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
import { PLANNING_CONFLICT_COLORS, PLANNING_LAYER_COLORS, PLANNING_ROUTE_KIND_COLORS } from '@/lib/outdoor-plan-tokens';

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

  it('orders the layer stack bottom-up with the business layers plus measure on top (H3-a)', () => {
    expect(PLAN_LAYER_STACK).toEqual(['boundary', 'zone', 'facility', 'route', 'worker', 'access', 'measure']);
  });

  it('filters visible layers without changing the stack order', () => {
    const vis = defaultLayerVisibility();
    expect(visiblePlanLayers(vis)).toEqual([...PLAN_LAYER_STACK]);
    vis.facility = false;
    vis.zone = false;
    vis.measure = false;
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
  fills: string[];
}

function makeCtx(): { ctx: CanvasRenderingContext2D; cap: CtxCapture } {
  const cap: CtxCapture = { rects: [], dash: [], texts: [], strokes: [], fills: [] };
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
  Object.defineProperty(ctx, 'fillStyle', { set: (v: string) => cap.fills.push(v), get: () => '' });
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

/* ---------------- H2-d 动线 / 节点 / 人员绘制 ---------------- */

describe('route / node / worker drawing (H2-d)', () => {
  it('paints each route kind in its own token colour with oneWay arrows along segments', () => {
    const points = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }];
    for (const kind of ['pedestrian', 'vehicle', 'service'] as const) {
      const { ctx, cap } = makeCtx();
      drawRouteLayer({ ctx, viewport: view } as PlanCanvasContext, [{ kind, points, oneWay: true }]);
      expect(cap.strokes).toContain(PLANNING_ROUTE_KIND_COLORS[kind]);
    }
    // oneWay：每段一个方向箭头（两点一段、三点两段；箭头是 fill 填充，见 stub fills 记录）。
    const { ctx, cap } = makeCtx();
    drawRouteLayer({ ctx, viewport: view } as PlanCanvasContext, [{ kind: 'pedestrian', points, oneWay: true }]);
    const arrowFills = cap.fills.filter(s => s === PLANNING_ROUTE_KIND_COLORS.pedestrian);
    expect(arrowFills).toHaveLength(2);
    const noArrow = makeCtx();
    drawRouteLayer({ ctx: noArrow.ctx, viewport: view } as PlanCanvasContext, [{ kind: 'pedestrian', points, oneWay: false }]);
    expect(noArrow.cap.fills.filter(s => s === PLANNING_ROUTE_KIND_COLORS.pedestrian)).toHaveLength(0);
  });

  it('highlights the selected route with a white overlay and a name label', () => {
    const { ctx, cap } = makeCtx();
    drawRouteLayer(
      { ctx, viewport: view } as PlanCanvasContext,
      [{ kind: 'vehicle', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], oneWay: false, name: '装卸动线', selected: true }],
    );
    expect(cap.strokes).toContain('#ffffff');
    expect(cap.texts).toContain('装卸动线');
  });

  it('draws the route draft with rubber band and cursor cross when a cursor point is given', () => {
    const { ctx, cap } = makeCtx();
    drawRouteDraft(
      { ctx, viewport: view } as PlanCanvasContext,
      [{ x: 0, y: 0 }, { x: 10, y: 5 }],
      'service',
      { x: 20, y: 10 },
    );
    expect(cap.dash).toContainEqual([8, 5]); // 已收点虚线
    expect(cap.dash).toContainEqual([4, 4]); // 橡皮筋虚线
    expect(cap.rects.filter(r => r.startsWith('fill:'))).toHaveLength(2); // 两个顶点方块
    // 空草稿 + 指针：只画指针十字，无顶点方块。
    const empty = makeCtx();
    drawRouteDraft({ ctx: empty.ctx, viewport: view } as PlanCanvasContext, [], 'pedestrian', { x: 0, y: 0 });
    expect(empty.cap.rects.filter(r => r.startsWith('fill:'))).toHaveLength(0);
  });

  it('marks the selected access node with a white halo and unconnected nodes with a red dot', () => {
    const node = { id: 'n1', kind: 'entry' as const, position: { x: 0, y: 0 }, name: '西门' };
    const selected = makeCtx();
    drawAccessLayer({ ctx: selected.ctx, viewport: view } as PlanCanvasContext, [{ ...node, selected: true }]);
    expect(selected.cap.strokes).toContain('#ffffff');

    const lonely = makeCtx();
    drawAccessLayer({ ctx: lonely.ctx, viewport: view } as PlanCanvasContext, [{ ...node, unconnected: true }]);
    // 未连接红点是 fill 圆点。
    expect(lonely.cap.fills).toContain('#c0392b');
  });

  it('labels workers with role and count and halos the selected one', () => {
    const worker = { id: 'w1', role: '安保', count: 2, position: { x: 3, y: 57 } };
    const plain = makeCtx();
    drawWorkerLayer({ ctx: plain.ctx, viewport: view } as PlanCanvasContext, [worker]);
    expect(plain.cap.texts).toContain('安保 ×2');

    const selected = makeCtx();
    drawWorkerLayer({ ctx: selected.ctx, viewport: view } as PlanCanvasContext, [{ ...worker, selected: true }]);
    expect(selected.cap.strokes).toContain('#ffffff');

    const warned = makeCtx();
    drawWorkerLayer({ ctx: warned.ctx, viewport: view } as PlanCanvasContext, [{ ...worker, warning: true }]);
    expect(warned.cap.strokes).toContain('#c0392b');
  });

  it('previews node placement with a translucent diamond and name label', () => {
    const { ctx, cap } = makeCtx();
    drawNodeGhost({ ctx, viewport: view } as PlanCanvasContext, 'entry', '西门 2', { x: 0, y: 60 });
    expect(cap.rects.some(r => r.startsWith('stroke:'))).toBe(true);
    expect(cap.texts).toContain('西门 2');
    // 幽灵菱形是 0.9 透明度的入口蓝 fill。
    expect(cap.fills).toContain(hexWithAlpha(PLANNING_LAYER_COLORS.access, 0.9));
  });
});

/* ---------------- H3-a 测量标注绘制 ---------------- */

describe('measurement drawing (H3-a)', () => {
  it('draws a fixed distance measurement as a dashed segment with a 5 m label', () => {
    const { ctx, cap } = makeCtx();
    drawMeasureLayer({ ctx, viewport: view } as PlanCanvasContext, [
      { id: 'm1', kind: 'distance', points: [{ x: 0, y: 0 }, { x: 3, y: 4 }] },
    ]);
    expect(cap.dash).toContainEqual([8, 5]);
    expect(cap.texts).toContain('5 m');
    expect(cap.strokes).toContain(PLANNING_LAYER_COLORS.measure);
    // 深色底衬（标签可读性）也在 fill 记录里。
    expect(cap.fills.some(f => f.startsWith('rgba(15,22,32'))).toBe(true);
  });

  it('draws a fixed 10×10 area measurement as a filled ring with a 100 m² label', () => {
    const { ctx, cap } = makeCtx();
    drawMeasureLayer({ ctx, viewport: view } as PlanCanvasContext, [
      { id: 'm2', kind: 'area', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    ]);
    expect(cap.dash).toContainEqual([6, 4]);
    expect(cap.fills).toContain(hexWithAlpha(PLANNING_LAYER_COLORS.measure, 0.12));
    expect(cap.texts).toContain('100 m²');
  });

  it('draws a fixed two-segment 10 m path with a 20 m total label', () => {
    const { ctx, cap } = makeCtx();
    drawMeasureLayer({ ctx, viewport: view } as PlanCanvasContext, [
      { id: 'm3', kind: 'path', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
    ]);
    expect(cap.texts).toContain('20 m');
  });

  it('draws the measure draft with rubber band and a live readout near the cursor', () => {
    const { ctx, cap } = makeCtx();
    drawMeasureDraft({ ctx, viewport: view } as PlanCanvasContext, [{ x: 0, y: 0 }], 'distance', { x: 3, y: 4 });
    expect(cap.dash).toContainEqual([4, 4]); // 橡皮筋
    // 一个顶点方块 + 读数底衬 = 2 个 fill 矩形。
    expect(cap.rects.filter(r => r.startsWith('fill:'))).toHaveLength(2);
    expect(cap.texts).toContain('5 m'); // 实时读数

    // 面积草稿：3 点 + 指针闭合 10×10 → 100 m²。
    const area = makeCtx();
    drawMeasureDraft(
      { ctx: area.ctx, viewport: view } as PlanCanvasContext,
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      'area',
      { x: 0, y: 10 },
    );
    expect(area.cap.texts).toContain('100 m²');
  });
});

/* ---------------- H3-b 冲突/缺失可定位标记 ---------------- */

describe('conflict marker drawing (H3-b)', () => {
  const conflicts = [
    { key: 'crossing:1', status: 'conflict' as const, at: { x: 0, y: 0 } },
    { key: 'no-width:1', status: 'missing' as const, at: { x: 10, y: 0 } },
    { key: 'capacity:1', status: 'unverified' as const, at: { x: 20, y: 0 } },
  ];

  it('draws a badge per conflict with the status colour and an exclamation glyph', () => {
    const { ctx, cap } = makeCtx();
    drawConflictMarkers({ ctx, viewport: view } as PlanCanvasContext, conflicts);
    expect(cap.fills).toContain(PLANNING_CONFLICT_COLORS.conflict);
    expect(cap.fills).toContain(PLANNING_CONFLICT_COLORS.missing);
    expect(cap.fills).toContain(PLANNING_CONFLICT_COLORS.unverified);
    expect(cap.texts.filter(t => t === '!')).toHaveLength(3);
    // 每个徽章一个白色外圈。
    expect(cap.strokes.filter(s => s === '#ffffff')).toHaveLength(3);
  });

  it('enlarges the highlighted marker ring (可定位标记的高亮态)', () => {
    const plain = makeCtx();
    drawConflictMarkers({ ctx: plain.ctx, viewport: view } as PlanCanvasContext, [conflicts[0]!]);
    const highlighted = makeCtx();
    drawConflictMarkers(
      { ctx: highlighted.ctx, viewport: view } as PlanCanvasContext,
      [conflicts[0]!],
      { highlightKey: 'crossing:1' },
    );
    expect(highlighted.cap.strokes.filter(s => s === '#ffffff')).toHaveLength(1);
    // 高亮与常态都只有一个标记，差异在半径——用字体/描边宽度外的 fill 次数兜底核对不额外画标记。
    expect(highlighted.cap.fills.filter(s => s === PLANNING_CONFLICT_COLORS.conflict)).toHaveLength(1);
    expect(plain.cap.fills.filter(s => s === PLANNING_CONFLICT_COLORS.conflict)).toHaveLength(1);
  });

  it('draws nothing for an empty conflict list', () => {
    const { ctx, cap } = makeCtx();
    drawConflictMarkers({ ctx, viewport: view } as PlanCanvasContext, []);
    expect(cap.texts).toHaveLength(0);
    expect(cap.fills).toHaveLength(0);
  });
});