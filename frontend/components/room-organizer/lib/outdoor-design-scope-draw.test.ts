import { describe, expect, it } from 'vitest';
import { axisToScreen } from './outdoor-canvas-rotation';
import {
  drawDesignScopeMask,
  drawScopeLockButton,
  hitScopeLockButton,
  scopeLockButtonRect,
  SCOPE_LOCK_SIZE,
  type PlanCanvasContext,
  type PlanViewport,
} from './outdoor-plan-canvas';

const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 16, canvasW: 1200, canvasH: 800 };

interface Capture {
  fills: string[];
  fillRules: (string | undefined)[];
  rects: number[][];
  dashes: number[][];
  strokes: string[];
  strokeCount: number;
  texts: string[];
  arcs: number;
  clips: (string | undefined)[];
  images: number[][];
  filters: string[];
  fillRects: number[][];
  arcTos: number;
  lines: number[][];
}

/** 只记录调用，不真的画：验证「框外挖洞 + 白纱毛玻璃 + 四角白角标」这条关键契约。 */
function makeCtx(): { ctx: CanvasRenderingContext2D; cap: Capture } {
  const cap: Capture = {
    fills: [], fillRules: [], rects: [], dashes: [], strokes: [], strokeCount: 0,
    texts: [], arcs: 0, clips: [], images: [], filters: [], fillRects: [], arcTos: 0, lines: [],
  };
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: (x: number, y: number) => { cap.lines.push([x, y]); },
    closePath: () => {},
    clip: (rule?: string) => { cap.clips.push(rule); },
    drawImage: (_image: unknown, dx: number, dy: number, dw: number, dh: number) => {
      void _image; // 这些测试只核对落点与尺寸，不看哪张图。
      cap.images.push([dx, dy, dw, dh]);
    },
    stroke: () => { cap.strokeCount += 1; },
    fill: (rule?: string) => { cap.fillRules.push(rule); },
    arc: () => { cap.arcs += 1; },
    arcTo: () => { cap.arcTos += 1; },
    rect: (x: number, y: number, w: number, h: number) => cap.rects.push([x, y, w, h]),
    fillRect: (x: number, y: number, w: number, h: number) => cap.fillRects.push([x, y, w, h]),
    setLineDash: (d: number[]) => cap.dashes.push([...d]),
    fillText: (t: string) => cap.texts.push(t),
    measureText: (t: string) => ({ width: t.length * 7 }) as TextMetrics,
    filter: 'none',
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(ctx, 'fillStyle', { set: (v: string) => cap.fills.push(v), get: () => '' });
  Object.defineProperty(ctx, 'strokeStyle', { set: (v: string) => cap.strokes.push(v), get: () => '' });
  Object.defineProperty(ctx, 'filter', { set: (v: string) => cap.filters.push(v), get: () => 'none' });
  Object.defineProperty(ctx, 'lineWidth', { set: () => {}, get: () => 1 });
  Object.defineProperty(ctx, 'lineJoin', { set: () => {}, get: () => 'round' });
  Object.defineProperty(ctx, 'font', { set: () => {}, get: () => '' });
  Object.defineProperty(ctx, 'textAlign', { set: () => {}, get: () => 'center' });
  Object.defineProperty(ctx, 'textBaseline', { set: () => {}, get: () => 'bottom' });
  return { ctx, cap };
}

const scope = [
  { x: -30, y: -30 },
  { x: 60, y: -30 },
  { x: 60, y: 60 },
  { x: -30, y: 60 },
];

const frostSource = { canvas: {} as CanvasImageSource, cssWidth: view.canvasW, cssHeight: view.canvasH };

function draw(
  points = scope,
  opts: { label?: string; frostSource?: typeof frostSource } = {},
) {
  const { ctx, cap } = makeCtx();
  const c: PlanCanvasContext = { ctx, viewport: view };
  drawDesignScopeMask(c, points, opts);
  return cap;
}

describe('设计范围蒙版绘制', () => {
  it('退化环（<3 点）什么都不画——不能因为一个点就把整屏蒙住', () => {
    const cap = draw(scope.slice(0, 2));
    expect(cap.rects).toHaveLength(0);
    expect(cap.fillRules).toHaveLength(0);
    expect(cap.images).toHaveLength(0);
  });

  it('给了底图取样源：框外先模糊底图、再压白纱（白色毛玻璃，不压黑）', () => {
    const cap = draw(scope, { frostSource });
    expect(cap.rects[0]).toEqual([0, 0, view.canvasW, view.canvasH]);
    expect(cap.clips).toEqual(['evenodd']);
    expect(cap.images).toHaveLength(1);
    expect(cap.images[0]).toEqual([0, 0, view.canvasW, view.canvasH]);
    expect(cap.filters).toContain('blur(7px)');
    expect(cap.fills).toContain('rgba(255, 255, 255, 0.52)');
    expect(cap.fillRects).toContainEqual([0, 0, view.canvasW, view.canvasH]);
    // 旧版框外是 rgba(10,14,20,0.34) 的暗幕：用户要求去掉。
    expect(cap.fills.some(f => /rgba\(10, 14, 20/.test(f))).toBe(false);
  });

  it('没有取样源时退化成整块视口 + evenodd 白纱：框内仍保持原亮度', () => {
    const cap = draw();
    expect(cap.rects[0]).toEqual([0, 0, view.canvasW, view.canvasH]);
    expect(cap.fillRules).toEqual(['evenodd']);
    expect(cap.fills[0]).toBe('rgba(255, 255, 255, 0.72)');
    expect(cap.images).toHaveLength(0);
  });

  it('不再有整圈虚线：只画四个角的 L 形白色角标', () => {
    const cap = draw();
    // 全程不挂 dash，也不会漏到后续图层。
    expect(cap.dashes.every(d => d.length === 0)).toBe(true);
    expect(cap.strokes.every(s => s === 'rgba(255, 255, 255, 0.98)')).toBe(true);
    expect(cap.strokeCount).toBe(4);
  });

  it('带标签时在上边中点画面积文字，并垫一块白底保证可读', () => {
    const cap = draw(scope, { label: '设计范围 · 约 8100 m²' });
    expect(cap.texts).toEqual(['设计范围 · 约 8100 m²']);
    expect(cap.fills).toContain('rgba(255, 255, 255, 0.94)');
  });

  it('编辑模式下也不再画角点圆点：L 角标已经说明了那个角（弧 0 个）', () => {
    const cap = draw(scope);
    expect(cap.arcs).toBe(0);
    // 只有 4 条 L 角标，不额外描边。
    expect(cap.strokeCount).toBe(4);
    expect(cap.fills).not.toContain('rgba(255, 255, 255, 0.98)');
  });
});

describe('设计范围：框外锁定钮（默认不锁）', () => {
  const cornersPx = [
    { x: 100, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 300 },
    { x: 100, y: 300 },
  ];

  it('钮贴在框右上外侧：在右边界之右、上边界之上，不压到框内作业区', () => {
    const rect = scopeLockButtonRect(cornersPx, view)!;
    expect(rect.w).toBe(SCOPE_LOCK_SIZE);
    expect(rect.h).toBe(SCOPE_LOCK_SIZE);
    expect(rect.x).toBeGreaterThan(400);
    expect(rect.y + rect.h).toBeLessThan(100);
  });

  it('框贴到画布右上角时把钮向内夹住，不出可视区', () => {
    const flush = [{ x: 300, y: 0 }, { x: 1195, y: 0 }, { x: 1195, y: 200 }, { x: 300, y: 200 }];
    const rect = scopeLockButtonRect(flush, view)!;
    expect(rect.x + rect.w).toBeLessThanOrEqual(view.canvasW - 4);
    expect(rect.y).toBeGreaterThanOrEqual(4);
  });

  it('没框就不给钮', () => {
    expect(scopeLockButtonRect([], view)).toBeNull();
  });

  // 2026-11-17 罗盘拖转：bearing≠0 时锁钮中心随地图旋转，命中区放大覆盖旋转外接。
  it('罗盘拖转后锁钮跟着转：中心绕画布中心等半径旋转，命中区放大并带角度', () => {
    const rotated: PlanViewport = { ...view, bearing: Math.PI / 4 };
    // 入口语义 = 带旋转的屏幕投影：轴对齐 ring 先转到真实屏幕再喂进去（与画布调用方一致）。
    const screenRing = cornersPx.map(point => axisToScreen(point, rotated));
    const rect = scopeLockButtonRect(screenRing, rotated)!;
    expect(rect.angle).toBeCloseTo(-Math.PI / 4, 6);
    expect(rect.w).toBeGreaterThan(SCOPE_LOCK_SIZE);
    // 轴系中心（右上外贴：right=400/top=100、贴框间距 10 → (422, 78)）绕画布中心旋转，半径必须不变。
    const axisCx = 400 + 10 + SCOPE_LOCK_SIZE / 2;
    const axisCy = 100 - 10 - SCOPE_LOCK_SIZE / 2;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const r0 = Math.hypot(axisCx - view.canvasW / 2, axisCy - view.canvasH / 2);
    const r1 = Math.hypot(cx - view.canvasW / 2, cy - view.canvasH / 2);
    // 半径不变量（命中区取整有 ±0.5px 抖动，容差 1px）。
    expect(Math.abs(r1 - r0)).toBeLessThan(1);
  });

  it('热区比视觉大一圈，点得中', () => {
    const rect = { x: 400, y: 60, w: SCOPE_LOCK_SIZE, h: SCOPE_LOCK_SIZE };
    expect(hitScopeLockButton(rect, { x: 411, y: 71 })).toBe(true);
    expect(hitScopeLockButton(rect, { x: 400, y: 60 })).toBe(true);
    expect(hitScopeLockButton(rect, { x: 380, y: 40 })).toBe(false);
  });

  it('默认未锁：白底＋淡墨开口锁（右腿悬空）；锁上后反成墨底白形、两腿合上', () => {
    const rect = { x: 400, y: 60, w: SCOPE_LOCK_SIZE, h: SCOPE_LOCK_SIZE };

    const unlocked = makeCtx();
    drawScopeLockButton({ ctx: unlocked.ctx, viewport: view }, rect, false);
    expect(unlocked.cap.fills).toContain('rgba(255, 255, 255, 0.96)');
    expect(unlocked.cap.fills).toContain('rgba(17, 19, 23, 0.78)');
    expect(unlocked.cap.arcTos).toBe(4);

    const locked = makeCtx();
    drawScopeLockButton({ ctx: locked.ctx, viewport: view }, rect, true);
    expect(locked.cap.fills).toContain('rgba(17, 19, 23, 0.92)');
    expect(locked.cap.fills).toContain('rgba(255, 255, 255, 0.96)');

    // 2026-11-16 用户「这不是锁上的图标吗」：未锁必须画成开口锁。
    // 两个状态唯一差别就在锁环右腿的落点：锁上落回锁体，未锁悬在上面。
    const unlockedRightLegY = unlocked.cap.lines.at(-1)![1]!;
    const lockedRightLegY = locked.cap.lines.at(-1)![1]!;
    expect(lockedRightLegY).toBeGreaterThan(unlockedRightLegY);
  });
});
