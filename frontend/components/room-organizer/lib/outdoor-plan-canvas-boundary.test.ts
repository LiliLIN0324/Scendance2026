import { describe, expect, it } from 'vitest';
import { avoidLockOverlap, boundaryHaloStyle, boundaryHaloToneFor, drawBoundaryEditHints, drawBoundaryLayer, planPointToPixel, scopeLockButtonRect, SCOPE_LOCK_SIZE, type PlanCanvasContext, type PlanViewport } from './outdoor-plan-canvas';

const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 16, canvasW: 1200, canvasH: 800 };
const ring = [
  { x: 0, y: 0 },
  { x: 60, y: 0 },
  { x: 60, y: 40 },
  { x: 0, y: 40 },
];

function makeCtx(): {
  ctx: CanvasRenderingContext2D;
  squares: number[][];
  outlines: number[][];
  outlineStrokes: string[];
  strokes: { color: string; width: number }[];
  fills: string[];
  arcs: number;
} {
  const squares: number[][] = [];
  const outlines: number[][] = [];
  const outlineStrokes: string[] = [];
  const strokes: { color: string; width: number }[] = [];
  const fills: string[] = [];
  let arcs = 0;
  let stroke = '';
  let fill = '';
  let width = 0;
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => { fills.push(fill); },
    stroke: () => { strokes.push({ color: stroke, width }); },
    arc: () => { arcs += 1; },
    fillRect: (x: number, y: number, w: number, h: number) => { squares.push([x, y, w, h]); },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      outlines.push([x, y, w, h]);
      outlineStrokes.push(stroke);
    },
  } as unknown as CanvasRenderingContext2D;
  for (const prop of ['globalAlpha'] as const) {
    Object.defineProperty(ctx, prop, { set: () => {}, get: () => '' });
  }
  Object.defineProperty(ctx, 'strokeStyle', {
    set: (v: string) => { stroke = v; },
    get: () => stroke,
  });
  Object.defineProperty(ctx, 'fillStyle', {
    set: (v: string) => { fill = v; },
    get: () => fill,
  });
  Object.defineProperty(ctx, 'lineWidth', {
    set: (v: number) => { width = v; },
    get: () => width,
  });
  return { ctx, squares, outlines, outlineStrokes, strokes, fills, get arcs() { return arcs; } };
}

function draw(opts: { vertexHandles?: boolean; vertexDots?: boolean }) {
  const cap = makeCtx();
  drawBoundaryLayer({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, ring, opts);
  return { squares: cap.squares, outlines: cap.outlines, arcs: cap.arcs };
}

describe('用地红线：边界 = 规划红实线 + 白垫边（2026-11-16 用户「建筑会画一条用地红线」）', () => {
  it('矢量底图：白垫边 + 红实线（不再用品牌绿 / 中灰画线）', () => {
    const cap = makeCtx();
    drawBoundaryLayer({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, ring, { halo: 'light' });
    const [casing, line] = cap.strokes;
    expect(cap.strokes).toHaveLength(2);
    // 白垫边只负责“把线拨出来”：宽一档、白一档。
    expect(casing!.color).toContain('255, 255, 255');
    expect(casing!.width).toBeCloseTo(boundaryHaloStyle('light').line.width + 2.2, 5);
    expect(line!.width).toBe(boundaryHaloStyle('light').line.width);
    expect(line!.color).toBe(boundaryHaloStyle('light').line.color);
    // 规划红（#c8362c），不再是 0.9 近黑也不发绿。
    expect(line!.color).toContain('200,54,44');
    expect(line!.color).not.toBe('#35624A');
  });

  it('影像/卫星底图：同一条红线，只是亮一档', () => {
    const cap = makeCtx();
    drawBoundaryLayer({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, ring, { halo: 'imagery' });
    expect(cap.strokes).toHaveLength(2);
    const line = cap.strokes[1]!;
    expect(line.color).toBe(boundaryHaloStyle('imagery').line.color);
    expect(line.color).toContain('200,54,44');
    const alphaOf = (s: string) => Number(s.slice(s.lastIndexOf(',') + 1, s.lastIndexOf(')')));
    // 影像底更花，红线用更高一档不透明度。
    expect(alphaOf(line.color)).toBeGreaterThan(alphaOf(boundaryHaloStyle('light').line.color));
  });

  it('填色仍用品牌绿，且影像底深一档：身份靠填色，不靠线', () => {
    const light = makeCtx();
    drawBoundaryLayer({ ctx: light.ctx, viewport: view } as PlanCanvasContext, ring, { halo: 'light' });
    const imagery = makeCtx();
    drawBoundaryLayer({ ctx: imagery.ctx, viewport: view } as PlanCanvasContext, ring, { halo: 'imagery' });
    const alphaOf = (s: string) => Number(s.slice(s.lastIndexOf(',') + 1, s.lastIndexOf(')')));
    // 两层都还是场地绿的低透明面
    expect(light.fills[0]).toContain('53,98,74');
    expect(imagery.fills[0]).toContain('53,98,74');
    expect(alphaOf(light.fills[0]!)).toBeCloseTo(boundaryHaloStyle('light').fillAlpha, 3);
    expect(alphaOf(imagery.fills[0]!)).toBeGreaterThan(alphaOf(light.fills[0]!));
  });

  it('锁定后红线仍在地界上：更细、更淡，但仍是红色实线', () => {
    const open = makeCtx();
    drawBoundaryLayer({ ctx: open.ctx, viewport: view } as PlanCanvasContext, ring, { halo: 'light' });
    const locked = makeCtx();
    drawBoundaryLayer({ ctx: locked.ctx, viewport: view } as PlanCanvasContext, ring, { halo: 'light', locked: true });
    expect(locked.strokes).toHaveLength(2);
    const openLine = open.strokes[1]!;
    const lockedLine = locked.strokes[1]!;
    expect(lockedLine.width).toBeLessThan(openLine.width);
    expect(lockedLine.width).toBeLessThanOrEqual(1.3);
    const alphaOf = (s: string) => Number(s.slice(s.lastIndexOf(',') + 1, s.lastIndexOf(')')));
    expect(alphaOf(lockedLine.color)).toBeLessThan(alphaOf(openLine.color));
    // 锁上也不能把地界变灰：红线就是“这是这块地”的唯一标记。
    expect(lockedLine.color).toContain('200,54,44');
    // 锁上不挂顶点方块
    expect(locked.squares).toHaveLength(0);
    // 填色两者一致：锁不改变“这是哪块地”
    expect(locked.fills).toHaveLength(1);
  });

  it('图源映射：影像/深色/矢量都把红线画在图上的三个档位', () => {
    expect(boundaryHaloToneFor('img')).toBe('imagery');
    expect(boundaryHaloToneFor('amap-satellite')).toBe('imagery');
    expect(boundaryHaloToneFor('carto-dark')).toBe('dark');
    expect(boundaryHaloToneFor('vec')).toBe('light');
    expect(boundaryHaloToneFor('osm')).toBe('light');
    expect(boundaryHaloToneFor('amap-streets')).toBe('light');
  });
});

describe('场地边界：顶点永远是实心正方形，编辑态只放大', () => {
  it('未锁且未进编辑态：5 px 实心方点（只有标记，没有白圈）', () => {
    const plain = draw({});
    expect(plain.squares).toHaveLength(4);
    expect(plain.squares.every(([, , w, h]) => w === 5 && h === 5)).toBe(true);
    expect(plain.outlines).toHaveLength(0);
    expect(plain.arcs).toBe(0);
  });

  it('锁定 → 一个顶点小点都不画（2026-11-16 用户：上锁就该看不出能编辑）', () => {
    expect(draw({ vertexDots: false }).squares).toHaveLength(0);
  });

  it('编辑态：还是实心方块，但放大到 9 px 并加一圈白边（用户：实心的在编辑模式大一些）', () => {
    const editing = draw({ vertexHandles: true, vertexDots: false });
    expect(editing.squares).toHaveLength(4);
    expect(editing.squares.every(([, , w, h]) => w === 9 && h === 9)).toBe(true);
    expect(editing.outlines).toHaveLength(4);
    // 不再用圆形手柄——形状和标记态保持一致。
    expect(editing.arcs).toBe(0);
  });
});

describe('悬停提示：看得出哪里能拖、哪里能加点', () => {
  function hoverCap() {
    const cap = makeCtx();
    const segments: number[][] = [];
    const withLines = cap.ctx as unknown as { moveTo: (x: number, y: number) => void; lineTo: (x: number, y: number) => void };
    withLines.moveTo = (x: number, y: number) => { segments.push([x, y]); };
    withLines.lineTo = (x: number, y: number) => { segments.push([x, y]); };
    return { cap, segments };
  }

  it('没悬停就什么都不画（不抢底图）', () => {
    const { cap, segments } = hoverCap();
    drawBoundaryEditHints({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, ring, {});
    expect(cap.squares).toHaveLength(0);
    expect(cap.arcs).toBe(0);
    expect(segments).toHaveLength(0);
  });

  it('悬停顶点：套一个比手柄大一圈的白框（看得出被抓住了）', () => {
    const { cap } = hoverCap();
    drawBoundaryEditHints({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, ring, { vertexHoverIndex: 1 });
    expect(cap.squares).toHaveLength(1);
    const [, , w, h] = cap.squares[0]!;
    expect([w, h]).toEqual([16, 16]);
    expect(cap.outlines).toHaveLength(1);
    // 白框要比 9 px 手柄大，且套在命中那个顶点上（不是随便一个点）。
    const expected = planPointToPixel(ring[1]!, view);
    expect(cap.squares[0]![0]).toBeCloseTo(expected.x - 8, 5);
    expect(cap.squares[0]![1]).toBeCloseTo(expected.y - 8, 5);
  });

  it('悬停边线：一颗带「+」的圆标（点它就是加点）', () => {
    const { cap, segments } = hoverCap();
    drawBoundaryEditHints({ ctx: cap.ctx, viewport: view } as PlanCanvasContext, ring, { edgeHintPx: { x: 300, y: 200 } });
    expect(cap.arcs).toBe(1);
    // 十字：横竖各两段。
    expect(segments).toHaveLength(4);
    const xs = segments.map(([x]) => x);
    const ys = segments.map(([, y]) => y);
    expect(Math.min(...xs)).toBeLessThan(300);
    expect(Math.max(...xs)).toBeGreaterThan(300);
    expect(Math.min(...ys)).toBeLessThan(200);
    expect(Math.max(...ys)).toBeGreaterThan(200);
  });
});

describe('点第一下：白底方框的描边由绿转琥珀（预告再点会删）', () => {
  it('悬停 = 绿描边；点过一下（armed）= 琥珀描边，同样大小、同一个点', () => {
    const hovered = makeCtx();
    drawBoundaryEditHints({ ctx: hovered.ctx, viewport: view } as PlanCanvasContext, ring, { vertexHoverIndex: 1 });
    const expected = planPointToPixel(ring[1]!, view);
    expect(hovered.outlines).toHaveLength(1);
    expect(hovered.outlines[0]![2]).toBe(16);
    expect(hovered.outlines[0]![0]).toBeCloseTo(expected.x - 8, 5);
    expect(hovered.outlineStrokes[0]).not.toBe('#d98324');

    const armed = makeCtx();
    drawBoundaryEditHints({ ctx: armed.ctx, viewport: view } as PlanCanvasContext, ring, { armedVertexIndex: 1 });
    expect(armed.outlines).toHaveLength(1);
    expect(armed.outlines[0]![0]).toBeCloseTo(expected.x - 8, 5);
    expect(armed.outlineStrokes[0]).toBe('#d98324');
  });

  it('琥珀框不靠悬停也留着（手移开也能看到“待删除”）', () => {
    const armed = makeCtx();
    drawBoundaryEditHints({ ctx: armed.ctx, viewport: view } as PlanCanvasContext, ring, { armedVertexIndex: 2, vertexHoverIndex: null });
    expect(armed.outlines).toHaveLength(1);
    expect(armed.outlineStrokes[0]).toBe('#d98324');
  });

  it('同一个点只画一层框：琥珀盖绿，不叠两层', () => {
    const both = makeCtx();
    drawBoundaryEditHints({ ctx: both.ctx, viewport: view } as PlanCanvasContext, ring, { armedVertexIndex: 1, vertexHoverIndex: 1 });
    expect(both.outlines).toHaveLength(1);
    expect(both.outlineStrokes[0]).toBe('#d98324');
  });
});

describe('两枚锁定钮：一枚在白框外右上角（设计范围）、一枚在同一角的框内（场地边界）', () => {
  const frame = [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
    { x: 300, y: 250 },
    { x: 100, y: 250 },
  ];
  const canvas = { canvasW: 1200, canvasH: 800 };

  it('框内那颗：贴右上角但整个在白框里（角的左下方向）', () => {
    const rect = scopeLockButtonRect(frame, canvas, { placement: 'inside' })!;
    expect(rect).not.toBeNull();
    expect(rect.x).toBeGreaterThan(100);
    expect(rect.y).toBeGreaterThan(100);
    expect(rect.x + rect.w).toBeLessThan(300);
    expect(rect.y + rect.h).toBeLessThan(250);
  });

  it('一外一内不会叠：外侧那颗在框右上方，内侧那颗在框里，两者不重叠', () => {
    const outside = scopeLockButtonRect(frame, canvas)!;
    const inside = scopeLockButtonRect(frame, canvas, { placement: 'inside' })!;
    expect(outside.x).toBeGreaterThan(300);
    expect(outside.y + outside.h).toBeLessThan(100);
    expect(inside.x + inside.w).toBeLessThan(outside.x);
    const overlap = inside.x < outside.x + outside.w && outside.x < inside.x + inside.w
      && inside.y < outside.y + outside.h && outside.y < inside.y + inside.h;
    expect(overlap).toBe(false);
  });

  it('内侧钮与右上角的距离就是一个 gap：不多占可用面积', () => {
    const rect = scopeLockButtonRect(frame, canvas, { placement: 'inside' })!;
    expect(300 - (rect.x + rect.w)).toBeCloseTo(10, 5);
    expect(rect.y - 100).toBeCloseTo(10, 5);
    expect(rect.w).toBe(SCOPE_LOCK_SIZE);
  });
});

describe('两枚锁定钮不叠在一起', () => {
  const rect = { x: 400, y: 40, w: 24, h: 24 };

  it('没另一枚锁时原样返回', () => {
    expect(avoidLockOverlap(rect, null)).toEqual(rect);
  });

  it('离得远：位置不动（各锁各的角）', () => {
    const other = { x: 900, y: 300, w: 24, h: 24 };
    expect(avoidLockOverlap(rect, other)).toEqual(rect);
  });

  it('撞位：后画的那枚整块下移一行，仍看得见也点得中', () => {
    const other = { x: 402, y: 44, w: 24, h: 24 };
    const moved = avoidLockOverlap(rect, other);
    expect(moved.x).toBe(rect.x);
    expect(moved.y).toBe(other.y + other.h + 6);
    expect(moved.y).toBeGreaterThan(other.y + other.h);
  });
});
