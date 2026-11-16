import { describe, expect, it, vi } from 'vitest';
import {
  PLAN_LAYER_STACK,
  defaultLayerVisibility,
  drawAccessLayer,
  accessRingRadiusPx,
  drawConflictMarkers,
  drawFacilityGhost,
  drawFacilityLayer,
  drawMapEditHighlight,
  drawMeasureDraft,
  drawMeasureLayer,
  drawMeasureRuler,
  MEASURE_RULER_MIN_TICK_PX,
  measureReadoutAnchor,
  measureRulerStepM,
  readableSegmentAngle,
  drawNodeGhost,
  drawRouteDraft,
  drawRouteLayer,
  drawWorkerLayer,
  drawZoneLayer,
  enuToLngLat,
  facilityPlacementGhost,
  hexWithAlpha,
  isLayerVisible,
  planMetersPerPixel,
  planLabelInk,
  planPixelToPoint,
  planPointToPixel,
  visiblePlanLayers,
  type PlanCanvasContext,
  type PlanViewport,
} from './outdoor-plan-canvas';
import { PLANNING_CONFLICT_COLORS, PLANNING_LAYER_COLORS, PLANNING_MEASURE_COLORS, PLANNING_NODE_KIND_COLORS, PLANNING_ROUTE_KIND_COLORS } from '@/lib/outdoor-plan-tokens';
import { formatLengthM } from './site-plan-measure';
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

  // 2026-11-16 罗盘拖转 2D：bearing 把地图绕画布中心旋转，投影与逆投影必须严格互逆。
  it('rotates the projection by bearing around the canvas center and round-trips', () => {
    const rotated: PlanViewport = { ...view, bearing: Math.PI / 4 };
    // bearing=90°：北在屏幕左、东在屏幕下（地图内容屏幕转角 = -bearing）。
    const quarter: PlanViewport = { ...view, bearing: Math.PI / 2 };
    const metersPerPx = planMetersPerPixel(quarter);
    const north = planPointToPixel({ x: 0, y: metersPerPx * 10 }, quarter);
    expect(north.x).toBeCloseTo(view.canvasW / 2 - 10, 3);
    expect(north.y).toBeCloseTo(view.canvasH / 2, 3);
    // 逆投影是正投影的严格逆：任意点往返归位（bearing=45° 非对称角度）。
    const p = { x: 87.3, y: -42.1 };
    const back = planPixelToPoint(planPointToPixel(p, rotated), rotated);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
    // 中心点恒在画布中心（绕中心旋转不动中心）。
    const center = planPointToPixel({ x: 0, y: 0 }, rotated);
    expect(center.x).toBeCloseTo(view.canvasW / 2, 6);
    expect(center.y).toBeCloseTo(view.canvasH / 2, 6);
  });

  it('orders the layer stack bottom-up with the business layers plus measure/annotate on top (H3-a + 2026-11-11 用户指令)', () => {
    expect(PLAN_LAYER_STACK).toEqual(['boundary', 'zone', 'facility', 'route', 'worker', 'access', 'measure', 'annotate']);
  });

  it('filters visible layers without changing the stack order', () => {
    const vis = defaultLayerVisibility();
    expect(visiblePlanLayers(vis)).toEqual([...PLAN_LAYER_STACK]);
    vis.facility = false;
    vis.zone = false;
    vis.measure = false;
    // 2026-11-11 用户指令：标注层随图层开关隐藏。
    vis.annotate = false;
    expect(visiblePlanLayers(vis)).toEqual(['boundary', 'route', 'worker', 'access']);
    expect(isLayerVisible(vis, 'facility')).toBe(false);
    expect(isLayerVisible(vis, 'annotate')).toBe(false);
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

/* ---------------- H3-c 锚点投影（真实锚点 ≠ 视口中心） ---------------- */

describe('plan viewport anchor projection (H3-c 修复)', () => {
  /** 锚点在视口中心西南约 500 m / 256 m：规划层应整体偏移而不是钉死在中心。 */
  const anchored: PlanViewport = {
    lng: 120.141306, lat: 30.2545, zoom: 16, canvasW: 1200, canvasH: 800,
    anchorLng: 120.1460368, anchorLat: 30.2521924,
  };

  it('offsets the ENU origin by the anchor-vs-center mercator delta', () => {
    const origin = planPointToPixel({ x: 0, y: 0 }, anchored);
    // 锚点在视口中心以东 → 原点渲染在中心右侧；锚点更南 → 原点渲染在中心下方。
    expect(origin.x).toBeGreaterThan(anchored.canvasW / 2);
    expect(origin.y).toBeGreaterThan(anchored.canvasH / 2);
  });

  it('keeps meters-per-pixel scaling unaffected by the anchor offset', () => {
    const metersPerPx = planMetersPerPixel(anchored);
    const east = planPointToPixel({ x: metersPerPx * 10, y: 0 }, anchored);
    const origin = planPointToPixel({ x: 0, y: 0 }, anchored);
    expect(east.x - origin.x).toBeCloseTo(10, 6);
  });

  it('round-trips pixels back to ENU metres with the anchor offset applied', () => {
    const p = { x: 64.25, y: -30.5 };
    const px = planPointToPixel(p, anchored);
    const back = planPixelToPoint(px, anchored);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it('renders identical output to the legacy behavior when the view center equals the anchor', () => {
    const same: PlanViewport = {
      lng: 120.1460368, lat: 30.2521924, zoom: 16, canvasW: 1200, canvasH: 800,
      anchorLng: 120.1460368, anchorLat: 30.2521924,
    };
    const pt = planPointToPixel({ x: 12.5, y: 8 }, same);
    expect(pt.x).toBeCloseTo(same.canvasW / 2 + 12.5 / planMetersPerPixel(same), 6);
    expect(pt.y).toBeCloseTo(same.canvasH / 2 - 8 / planMetersPerPixel(same), 6);
  });

  it('stays backward compatible when anchor fields are omitted (旧调用方)', () => {
    const legacy = planPointToPixel({ x: 0, y: 0 }, view);
    expect(legacy.x).toBeCloseTo(view.canvasW / 2, 3);
    expect(legacy.y).toBeCloseTo(view.canvasH / 2, 3);
  });
});

/* ---------------- H2-c 设施放置绘制（stub ctx 捕获调用） ---------------- */

interface CtxCapture {
  rects: string[];
  dash: number[][];
  texts: string[];
  /** 文字描边（白底气）：用来锁「名字有描边才读得出来」。 */
  haloTexts: string[];
  strokes: string[];
  fills: string[];
  /** 圆弧（`arc:x,y,r`）：用来锁「人员点位到底画的是圆点还是只有芯片」。 */
  arcs: string[];
}

function makeCtx(): { ctx: CanvasRenderingContext2D; cap: CtxCapture } {
  const cap: CtxCapture = { rects: [], dash: [], texts: [], haloTexts: [], strokes: [], fills: [], arcs: [] };
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
    arc: (x: number, y: number, r: number) => cap.arcs.push(`arc:${x},${y},${r}`),
    setLineDash: (d: number[]) => cap.dash.push([...d]),
    strokeRect: (x: number, y: number, w: number, h: number) => cap.rects.push(`stroke:${x},${y},${w},${h}`),
    fillRect: (x: number, y: number, w: number, h: number) => cap.rects.push(`fill:${x},${y},${w},${h}`),
    fillText: (t: string) => cap.texts.push(t),
    strokeText: (t: string) => cap.haloTexts.push(t),
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(ctx, 'strokeStyle', { set: (v: string) => cap.strokes.push(v), get: () => '' });
  Object.defineProperty(ctx, 'fillStyle', { set: (v: string) => cap.fills.push(v), get: () => '' });
  Object.defineProperty(ctx, 'lineWidth', { set: () => {}, get: () => 1 });
  Object.defineProperty(ctx, 'font', { set: () => {}, get: () => '' });
  Object.defineProperty(ctx, 'textAlign', { set: () => {}, get: () => 'left' });
  Object.defineProperty(ctx, 'textBaseline', { set: () => {}, get: () => 'top' });
  return { ctx, cap };
}

it('outlines a review area, marks each route vertex, and rings the entrance separately', () => {
  const { ctx } = makeCtx();
  const closePath = vi.spyOn(ctx, 'closePath');
  const arc = vi.spyOn(ctx, 'arc');
  const canvas = { ctx, viewport: view };
  const points = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }];
  drawMapEditHighlight(canvas, points, 'area');
  expect(closePath).toHaveBeenCalledTimes(1);
  expect(arc).not.toHaveBeenCalled();

  drawMapEditHighlight(canvas, points, 'route');
  expect(closePath).toHaveBeenCalledTimes(1);
  expect(arc).toHaveBeenCalledTimes(3);
  const vertex = planPointToPixel(points[1]!, view);
  expect(arc).toHaveBeenNthCalledWith(2, vertex.x, vertex.y, 6, 0, Math.PI * 2);

  drawMapEditHighlight(canvas, [points[0]!], 'entrance');
  expect(arc).toHaveBeenLastCalledWith(view.canvasW / 2, view.canvasH / 2, 12, 0, Math.PI * 2);
});

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

  it('feeds the 2D and 3D ghost from one rotated footprint and one bounds check', () => {
    const boundary = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
    const inside = facilityPlacementGhost({ width: 4, depth: 2 }, { x: 10, y: 10 }, 0, boundary);
    expect(inside.invalid).toBe(false);
    expect(inside.ring).toHaveLength(4);
    const span = (points: { x: number; y: number }[]) => ({
      x: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)),
      y: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)),
    });
    // 0°：宽 4 沿 x、深 2 沿 y；转 90° 后长宽互换，证明旋转真的进了幽灵几何。
    expect(span(inside.ring).x).toBeCloseTo(4, 6);
    expect(span(inside.ring).y).toBeCloseTo(2, 6);
    const rotated = facilityPlacementGhost({ width: 4, depth: 2 }, { x: 10, y: 10 }, 90, boundary);
    expect(span(rotated.ring).x).toBeCloseTo(2, 6);
    expect(span(rotated.ring).y).toBeCloseTo(4, 6);
    // 越界与提交共用 facilityPlacementIssues：贴角放置必须报红。
    expect(facilityPlacementGhost({ width: 4, depth: 2 }, { x: 0.5, y: 0.5 }, 0, boundary).invalid).toBe(true);
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

  it('adds a mid-segment arrow once the segment is long enough to read direction', () => {
    // 2026-11-15：长段中间补方向箭头（端点箭头会被节点徽标盖住）；短段不加，避免箭头连成串。
    const long = makeCtx();
    drawRouteLayer({ ctx: long.ctx, viewport: view } as PlanCanvasContext, [
      { kind: 'pedestrian', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], oneWay: true },
    ]);
    // 300 m ≈ 145 px：端点一只 + 中点一只。
    expect(long.cap.fills.filter(s => s === PLANNING_ROUTE_KIND_COLORS.pedestrian)).toHaveLength(2);
    const short = makeCtx();
    drawRouteLayer({ ctx: short.ctx, viewport: view } as PlanCanvasContext, [
      { kind: 'pedestrian', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], oneWay: true },
    ]);
    expect(short.cap.fills.filter(s => s === PLANNING_ROUTE_KIND_COLORS.pedestrian)).toHaveLength(1);
  });

  it('highlights the selected route with a white overlay and no name text', () => {
    // 2026-11-15 用户指令「文字就不要显示了」：选中只留白描边，不再画名字标签。
    const { ctx, cap } = makeCtx();
    drawRouteLayer(
      { ctx, viewport: view } as PlanCanvasContext,
      [{ kind: 'vehicle', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], oneWay: false, name: '装卸动线', selected: true }],
    );
    expect(cap.strokes).toContain('#ffffff');
    expect(cap.texts).not.toContain('装卸动线');
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

  it('draws access nodes as a filled round badge with a white collar and a haloed name', () => {
    // 2026-11-16 用户：「3D 的圈圈很形象，2D 的 icon 有点看不清」——
    // 所以 2D 也画实心圆盘（类型色）+ 白圈，名字带白描写底。
    const { ctx, cap } = makeCtx();
    // 名字分级：放大到看得见街区细节（z21）才出名字，这里用近视角。
    const near = { ...view, zoom: 21 };
    drawAccessLayer({ ctx, viewport: near } as PlanCanvasContext, [
      { kind: 'entry', position: { x: 0, y: 0 }, name: '入口 1' },
      { kind: 'exit', position: { x: 8, y: 0 }, name: '出口 1' },
    ]);
    // 三型各自的圆盘色都真的填了。
    expect(cap.fills.filter(color => color.startsWith('rgba(')).length).toBeGreaterThanOrEqual(2);
    // 白圈（圆牌外沿）与名字描边都在。
    expect(cap.strokes).toContain('#ffffff');
    expect(cap.haloTexts).toEqual(['入口 1', '出口 1']);
    expect(cap.texts).toEqual(['入口 1', '出口 1']);
  });

  it('hides access names when zoomed out and keeps them for the selected node', () => {
    // 2026-11-16 用户：「缩小时只留圆牌不画名字，放大或选中时才出名字」。
    const node = { kind: 'entry' as const, position: { x: 0, y: 0 }, name: '西门' };
    const far = makeCtx();
    drawAccessLayer({ ctx: far.ctx, viewport: view } as PlanCanvasContext, [node]);
    expect(far.cap.texts).toEqual([]); // 缩小时不出名字
    expect(far.cap.strokes.some(color => color.startsWith('rgba('))).toBe(true); // 圆牌（现在是环）还在

    const farSelected = makeCtx();
    drawAccessLayer({ ctx: farSelected.ctx, viewport: view } as PlanCanvasContext, [{ ...node, selected: true }]);
    expect(farSelected.cap.texts).toEqual(['西门']); // 选中时无论如何都出名字
  });

  it('switches zone/worker label ink with the basemap tone (深色图上白字)', () => {
    // 2026-11-16 用户：「这个文字是不是也要根据不同的地图给适配？深色的话分区就要是白色的」。
    const zone = { name: '装卸区', polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }] };
    const dark = makeCtx();
    drawZoneLayer({ ctx: dark.ctx, viewport: view } as PlanCanvasContext, [zone], { tone: 'dark' });
    expect(dark.cap.texts).toContain('装卸区');
    expect(dark.cap.haloTexts).toContain('装卸区');
    // 深底：白字 + 深描边（描边恒为字的反色）。
    expect(dark.cap.fills).toContain(planLabelInk('dark').fill);
    expect(dark.cap.strokes).toContain(planLabelInk('dark').halo);

    // 缺省浅底：保持原来的深字 + 白描边（浅色路网图仍照旧）。
    const light = makeCtx();
    drawZoneLayer({ ctx: light.ctx, viewport: view } as PlanCanvasContext, [zone]);
    expect(light.cap.fills).toContain(planLabelInk('light').fill);
    expect(light.cap.strokes).toContain(planLabelInk('light').halo);
    expect(planLabelInk('dark').fill).not.toBe(planLabelInk('light').fill);

    // 人名同样跟着底图走。
    const darkWorker = makeCtx();
    drawWorkerLayer(
      { ctx: darkWorker.ctx, viewport: view } as PlanCanvasContext,
      [{ role: '安保', count: 2, position: { x: 3, y: 57 } }],
      { tone: 'dark' },
    );
    expect(darkWorker.cap.fills).toContain(planLabelInk('dark').fill);
  });

  it('writes only the headcount on the map (岗位名已由图标表达) and halos the selected one', () => {
    const worker = { id: 'w1', role: '安保', count: 2, position: { x: 3, y: 57 } };
    const plain = makeCtx();
    drawWorkerLayer({ ctx: plain.ctx, viewport: view } as PlanCanvasContext, [worker]);
    // 2026-11-16 用户：图标细分后不再写岗位名，只留人数。
    expect(plain.cap.texts).toContain('×2');
    expect(plain.cap.texts.join('')).not.toContain('安保');

    // 单人位连「×1」也不写（一枚图标就是一个人）。
    const single = makeCtx();
    drawWorkerLayer({ ctx: single.ctx, viewport: view } as PlanCanvasContext, [{ ...worker, count: 1 }]);
    expect(single.cap.texts).toEqual([]);

    const selected = makeCtx();
    drawWorkerLayer({ ctx: selected.ctx, viewport: view } as PlanCanvasContext, [{ ...worker, selected: true }]);
    expect(selected.cap.strokes).toContain('#ffffff');

    const warned = makeCtx();
    drawWorkerLayer({ ctx: warned.ctx, viewport: view } as PlanCanvasContext, [{ ...worker, warning: true }]);
    expect(warned.cap.strokes).toContain('#c0392b');
  });

  it('draws the role icon chip instead of a dot when the caller supplies one (2026-11-16)', () => {
    const worker = { id: 'w1', role: '安保', count: 3, position: { x: 3, y: 57 } };

    // 无岗位贴纸的岗位：仍是圆点（定位与命中都靠它）。
    const dot = makeCtx();
    drawWorkerLayer({ ctx: dot.ctx, viewport: view } as PlanCanvasContext, [worker]);
    expect(dot.cap.arcs.some(a => a.endsWith(',5'))).toBe(true);
    expect(dot.cap.fills).toContain(hexWithAlpha(PLANNING_LAYER_COLORS.worker, 0.85));

    // 有芯片的岗位：不再画圆点，也不再填人员色——一枚图标就是这一个人位。
    const chip = makeCtx();
    drawWorkerLayer({ ctx: chip.ctx, viewport: view } as PlanCanvasContext, [{ ...worker, chip: true }]);
    expect(chip.cap.arcs).toEqual([]);
    expect(chip.cap.fills).not.toContain(hexWithAlpha(PLANNING_LAYER_COLORS.worker, 0.85));
    // 岗位与人数文字：岗位名不再写，只补×3（图标不表达数量）。
    expect(chip.cap.texts).toContain('×3');

    // 选中圈 / 越界红圈仍按芯片外径让位，不被 16 px 芯片盖掉。
    const warned = makeCtx();
    drawWorkerLayer({ ctx: warned.ctx, viewport: view } as PlanCanvasContext, [{ ...worker, chip: true, warning: true }]);
    expect(warned.cap.strokes).toContain('#c0392b');
    expect(warned.cap.arcs.some(a => a.endsWith(',9'))).toBe(true);

    const selected = makeCtx();
    drawWorkerLayer({ ctx: selected.ctx, viewport: view } as PlanCanvasContext, [{ ...worker, chip: true, selected: true }]);
    expect(selected.cap.strokes).toContain('#ffffff');
    expect(selected.cap.arcs.some(a => a.endsWith(',11.5'))).toBe(true);
  });

  it('draws entry / exit / both with their own colors (green in, red out, teal two-way)', () => {
    const kinds = ['entry', 'exit', 'both'] as const;
    const drawn = kinds.map(kind => {
      const { ctx, cap } = makeCtx();
      drawAccessLayer({ ctx, viewport: view } as PlanCanvasContext, [{ id: kind, kind, position: { x: 0, y: 0 }, name: kind }]);
      return cap.strokes;
    });
    kinds.forEach((kind, i) => {
      expect(drawn[i]).toContain(hexWithAlpha(PLANNING_NODE_KIND_COLORS[kind], 0.95));
      // 每型不接受其它两型的颜色：三型确实互斥，不是“都画蓝/灰”。
      for (const other of kinds.filter(k => k !== kind)) {
        expect(drawn[i]).not.toContain(hexWithAlpha(PLANNING_NODE_KIND_COLORS[other], 0.95));
      }
    });
    expect(new Set(Object.values(PLANNING_NODE_KIND_COLORS)).size).toBe(3);
  });

  it('draws the access node as a hollow ring whose size follows the zoom', () => {
    const node = { kind: 'entry' as const, position: { x: 0, y: 0 }, name: '西门' };
    const ringArc = (zoom: number) => {
      const { ctx, cap } = makeCtx();
      const arc = vi.spyOn(ctx, 'arc');
      drawAccessLayer({ ctx, viewport: { ...view, zoom } } as PlanCanvasContext, [node]);
      // 第一条弧是白色底环；中空意味着这一层不需要填色。
      return { radius: arc.mock.calls[0]![2] as number, fills: cap.fills, strokes: cap.strokes };
    };

    const at19 = ringArc(19);
    expect(at19.fills).toEqual([]); // 不再画实心盘
    expect(at19.strokes.some(color => color.startsWith('rgba('))).toBe(true);

    // 2026-11-16 用户：「这个环的缩放比例特别奇怪。和道路一样行不行?」
    // 环随缩放收敛：低倍缩小（不糊满场地），高倍放大（撑得住街区尺度），上下都有夹值。
    // （第一条弧画在环中线上，所以是 mid = R - 环厚/2，而不是外径 R。）
    expect(ringArc(15).radius).toBeLessThan(at19.radius);
    expect(ringArc(21).radius).toBeGreaterThan(at19.radius);
    expect(accessRingRadiusPx({ ...view, zoom: 15 })).toBeGreaterThanOrEqual(6);
    expect(accessRingRadiusPx({ ...view, zoom: 15 })).toBeLessThan(accessRingRadiusPx({ ...view, zoom: 19 }));
    expect(accessRingRadiusPx({ ...view, zoom: 21 })).toBeGreaterThan(accessRingRadiusPx({ ...view, zoom: 19 }));
    expect(accessRingRadiusPx({ ...view, zoom: 23 })).toBeLessThanOrEqual(13);
  });

  it('previews node placement with a translucent diamond and name label', () => {
    const { ctx, cap } = makeCtx();
    drawNodeGhost({ ctx, viewport: view } as PlanCanvasContext, 'entry', '西门 2', { x: 0, y: 60 });
    expect(cap.rects.some(r => r.startsWith('stroke:'))).toBe(true);
    expect(cap.texts).toContain('西门 2');
    // 幽灵菱形是 0.9 透明度的入口色 fill（三型各自一色，不再共用 access 蓝）。
    expect(cap.fills).toContain(hexWithAlpha(PLANNING_NODE_KIND_COLORS.entry, 0.9));
  });
});

/* ---------------- H3-a 测量标注绘制 ---------------- */

describe('measurement drawing (H3-a)', () => {
  it('draws a fixed distance measurement as a solid segment with white-ring endpoints and a 5 m label', () => {
    const { ctx, cap } = makeCtx();
    drawMeasureLayer({ ctx, viewport: view } as PlanCanvasContext, [
      { id: 'm1', kind: 'distance', points: [{ x: 0, y: 0 }, { x: 3, y: 4 }] },
    ]);
    // Google 测距口径：浅底近黑实线，无虚线。
    expect(cap.strokes).toContain(PLANNING_MEASURE_COLORS.light);
    expect(cap.dash).not.toContainEqual([8, 5]);
    // 端点白心圆环。
    expect(cap.fills).toContain('#ffffff');
    // 读数不再画深色胶囊底衬。
    expect(cap.fills.some(f => f.startsWith('rgba(15,22,32'))).toBe(false);
    expect(cap.texts).toContain('5 m');
  });

  it('draws a fixed 10×10 area measurement as a filled ring with a 100 m² label', () => {
    const { ctx, cap } = makeCtx();
    drawMeasureLayer({ ctx, viewport: view } as PlanCanvasContext, [
      { id: 'm2', kind: 'area', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
    ]);
    expect(cap.dash).not.toContainEqual([6, 4]);
    expect(cap.fills).toContain(hexWithAlpha(PLANNING_MEASURE_COLORS.light, 0.12));
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
    // 顶点为白心圆环，不再画实心方块；读数也无矩形底衬。
    expect(cap.rects.filter(r => r.startsWith('fill:'))).toHaveLength(0);
    expect(cap.fills).toContain('#ffffff');
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

  /* 2026-11-16 用户：「点击下面的×就消失了」——读数改走图上贴片（白胶囊 + ×），
     画布不再重复写字；选中态另加白晕，让“这条被选中了”在图上看得见。 */
  it('skips canvas label when the reading is rendered as a DOM chip', () => {
    const { ctx, cap } = makeCtx();
    drawMeasureLayer({ ctx, viewport: view } as PlanCanvasContext, [
      { id: 'm4', kind: 'distance', points: [{ x: 0, y: 0 }, { x: 3, y: 4 }], showLabel: false },
    ]);
    expect(cap.texts).toEqual([]);
    // 几何照画（贴片只接管文字）。
    expect(cap.fills).toContain('#ffffff');
  });

  it('haloes the selected measurement with white so the pick is visible', () => {
    const { ctx, cap } = makeCtx();
    drawMeasureLayer({ ctx, viewport: view } as PlanCanvasContext, [
      { id: 'm5', kind: 'distance', points: [{ x: 0, y: 0 }, { x: 3, y: 4 }], selected: true },
    ]);
    expect(cap.strokes).toContain('rgba(255,255,255,0.9)');

    const plain = makeCtx();
    drawMeasureLayer({ ctx: plain.ctx, viewport: view } as PlanCanvasContext, [
      { id: 'm6', kind: 'distance', points: [{ x: 0, y: 0 }, { x: 3, y: 4 }] },
    ]);
    expect(plain.cap.strokes).not.toContain('rgba(255,255,255,0.9)');
  });

  it('anchors readout chips exactly where the canvas label sits', () => {
    // 距离：两点段中点。
    const distance = measureReadoutAnchor(view, { kind: 'distance', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] });
    const mid = planPointToPixel({ x: 5, y: 0 }, view);
    expect(distance?.x).toBeCloseTo(mid.x, 5);
    expect(distance?.y).toBeCloseTo(mid.y, 5);

    // 面积：与画布读数同一落点（首边中点），不是质心。
    const ring = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] as const;
    const area = measureReadoutAnchor(view, { kind: 'area', points: ring });
    const edgeMid = planPointToPixel({ x: 5, y: 0 }, view);
    expect(area?.x).toBeCloseTo(edgeMid.x, 5);
    expect(area?.y).toBeCloseTo(edgeMid.y, 5);

    // 路径：中点顶点。
    const pathPt = measureReadoutAnchor(view, { kind: 'path', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] });
    const vertex = planPointToPixel({ x: 10, y: 0 }, view);
    expect(pathPt?.x).toBeCloseTo(vertex.x, 5);
    expect(pathPt?.y).toBeCloseTo(vertex.y, 5);

    expect(measureReadoutAnchor(view, { kind: 'distance', points: [{ x: 0, y: 0 }] })).toBeNull();
    expect(measureReadoutAnchor(view, { kind: 'area', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBeNull();
  });

  /* 2026-11-16 用户四条：文字跟线平行 / 过程标尺 / 多段线 / 退出删线（最后一条在组件层）。 */
  it('picks a ruler step that stays readable when zooming', () => {
    const at16 = measureRulerStepM(view);
    const at19 = measureRulerStepM({ ...view, zoom: 19 });
    const at13 = measureRulerStepM({ ...view, zoom: 13 });
    // 放得越大，刻度越密（步长不会变大）；缩得越小，步长越大。
    expect(at19).toBeLessThanOrEqual(at16);
    expect(at13).toBeGreaterThanOrEqual(at16);
    // 相邻刻度在屏幕上不挤：步长的像素间隔不小于下限。
    expect(at16 / planMetersPerPixel(view)).toBeGreaterThanOrEqual(MEASURE_RULER_MIN_TICK_PX);
  });

  it('writes cumulative ruler labels parallel to the segment', () => {
    const step = measureRulerStepM(view);
    const east = step * 3.4;
    const { ctx, cap } = makeCtx();
    const rotate = vi.spyOn(ctx, 'rotate');
    const result = drawMeasureRuler(
      { ctx, viewport: view } as PlanCanvasContext,
      [{ x: 0, y: 0 }, { x: east, y: 0 }],
      { total: false },
    );
    // 累计刻度：step、2×step、3×step（3.4 段打不下第四个）。
    expect(result.ticksM).toEqual([step, step * 2, step * 3]);
    expect(result.labels).toEqual([formatLengthM(step), formatLengthM(step * 2), formatLengthM(step * 3)]);
    // 水平线：文字角度 0（不歪、也不倒字）。
    expect(rotate.mock.calls.length).toBeGreaterThan(0);
    expect(rotate.mock.calls.every(([angle]) => Math.abs(angle as number) < 1e-9)).toBe(true);
    expect(cap.texts).toEqual(expect.arrayContaining(result.labels));
  });

  it('flips the label angle so a segment never reads upside down', () => {
    expect(readableSegmentAngle(10, 0)).toBeCloseTo(0, 6);
    expect(readableSegmentAngle(-10, 0)).toBeCloseTo(0, 6); // 向左：翻 180° 回正
    // 竖直线一律归到 +90°（从下往上读），两个方向都不会出现倒字。
    expect(readableSegmentAngle(0, -10)).toBeCloseTo(Math.PI / 2, 6); // 向北（屏幕向上）
    expect(readableSegmentAngle(0, 10)).toBeCloseTo(Math.PI / 2, 6); // 向南（屏幕向下）
    // 角度始终落在 (-90°, 90°]：不会把文字转成 180° 倒字。
    for (const [dx, dy] of [[10, 3], [-10, 3], [4, -9], [-4, -9], [0, 5], [0, -5]] as const) {
      const angle = readableSegmentAngle(dx, dy);
      expect(angle).toBeGreaterThan(-Math.PI / 2 - 1e-9);
      expect(angle).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });

  it('draws the draft ruler along the rubber band while still measuring', () => {
    const { ctx, cap } = makeCtx();
    const step = measureRulerStepM(view);
    drawMeasureDraft(
      { ctx, viewport: view } as PlanCanvasContext,
      [{ x: 0, y: 0 }],
      'distance',
      { x: step * 2, y: 0 },
    );
    // 草稿阶段就有过程刻度（不是等提交后才出现）。
    expect(cap.texts).toContain(formatLengthM(step));
    expect(cap.texts).toContain(formatLengthM(step * 2));
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

  it('writes the merged count instead of a row of exclamation marks (count > 1)', () => {
    const { ctx, cap } = makeCtx();
    drawConflictMarkers(
      { ctx, viewport: view } as PlanCanvasContext,
      [{ key: 'route:r-svc', status: 'conflict' as const, at: { x: 0, y: 0 }, count: 3 }],
    );
    // 一枚徽章 + 数字，不再是三枚「!」。
    expect(cap.texts).toEqual(['3']);
    expect(cap.strokes.filter(s => s === '#ffffff')).toHaveLength(1);
    expect(cap.fills).toContain(PLANNING_CONFLICT_COLORS.conflict);
    // 单条问题仍画「!」（与旧视觉兼容）。
    const single = makeCtx();
    drawConflictMarkers(
      { ctx: single.ctx, viewport: view } as PlanCanvasContext,
      [{ key: 'route:r-svc', status: 'conflict' as const, at: { x: 0, y: 0 }, count: 1 }],
    );
    expect(single.cap.texts).toEqual(['!']);
  });
});
