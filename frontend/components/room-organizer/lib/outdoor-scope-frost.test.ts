import { describe, expect, it } from 'vitest';
import {
  SCOPE_FROST_BLUR_PX,
  SCOPE_FROST_VEIL,
  drawScopeFrost,
} from './outdoor-scope-frost';

interface Capture {
  clears: number[][];
  rects: number[][];
  lines: number[][];
  clips: (string | undefined)[];
  images: number[][];
  filters: string[];
  fills: string[];
  fillRects: number[][];
  saved: number;
  restored: number;
}

/** 只记录调用，不真的画：核对「框外挖洞 → 糊底图 → 压白纱，框内不动」这条契约。 */
function makeCtx(): { ctx: CanvasRenderingContext2D; cap: Capture } {
  const cap: Capture = {
    clears: [], rects: [], lines: [], clips: [], images: [], filters: [],
    fills: [], fillRects: [], saved: 0, restored: 0,
  };
  const ctx = {
    save: () => { cap.saved += 1; },
    restore: () => { cap.restored += 1; },
    beginPath: () => {},
    moveTo: (x: number, y: number) => { cap.lines.push([x, y]); },
    lineTo: (x: number, y: number) => { cap.lines.push([x, y]); },
    closePath: () => {},
    clip: (rule?: string) => { cap.clips.push(rule); },
    rect: (x: number, y: number, w: number, h: number) => { cap.rects.push([x, y, w, h]); },
    clearRect: (x: number, y: number, w: number, h: number) => { cap.clears.push([x, y, w, h]); },
    drawImage: (_image: unknown, dx: number, dy: number, dw: number, dh: number) => {
      void _image; // 测试只核对落点与尺寸，不看哪张图。
      cap.images.push([dx, dy, dw, dh]);
    },
    fillRect: (x: number, y: number, w: number, h: number) => { cap.fillRects.push([x, y, w, h]); },
    filter: 'none',
  } as unknown as CanvasRenderingContext2D;
  Object.defineProperty(ctx, 'fillStyle', { set: (v: string) => cap.fills.push(v), get: () => '' });
  Object.defineProperty(ctx, 'filter', { set: (v: string) => cap.filters.push(v), get: () => 'none' });
  return { ctx, cap };
}

const RING = [
  { x: 300, y: 200 },
  { x: 900, y: 200 },
  { x: 900, y: 700 },
  { x: 300, y: 700 },
];

const source = {} as CanvasImageSource;

function draw(ring = RING, size = { width: 1200, height: 900 }) {
  const { ctx, cap } = makeCtx();
  const painted = drawScopeFrost(ctx, { ...size, ring, source });
  return { cap, painted };
}

describe('3D 框外毛玻璃：只糊框外，框内一像素都不碰', () => {
  it('模糊当量与 2D 的 blur(7px) 同档，白纱比 2D 的 0.52 更轻（3D 另有贴地白纱）', () => {
    expect(SCOPE_FROST_BLUR_PX).toBe(7);
    expect(SCOPE_FROST_VEIL).toBe('rgba(255, 255, 255, 0.2)');
  });

  it('先清上一帧，再按 evenodd 挖掉范围环，最后糊底图 + 压白纱', () => {
    const { cap, painted } = draw();
    expect(painted).toBe(true);
    // 没清就画：框内会残留上一次的模糊像素。
    expect(cap.clears).toEqual([[0, 0, 1200, 900]]);
    // 外框整屏 + 范围环 = 挖洞的两条边，evenodd 才能只留框外。
    expect(cap.rects).toEqual([[0, 0, 1200, 900]]);
    expect(cap.lines).toEqual(RING.map(point => [point.x, point.y]));
    expect(cap.clips).toEqual(['evenodd']);
    // 取样源按舞台尺寸整张铺，模糊半径与 2D 同档。
    expect(cap.images).toEqual([[0, 0, 1200, 900]]);
    expect(cap.filters).toEqual(['blur(7px)', 'none']);
    expect(cap.fills).toEqual([SCOPE_FROST_VEIL]);
    expect(cap.fillRects).toEqual([[0, 0, 1200, 900]]);
    // 保存/恢复成对，别把 filter / clip 泄漏给下一帧。
    expect(cap.saved).toBe(1);
    expect(cap.restored).toBe(1);
  });

  it('范围退化 / 尺寸非法时不画（返回 false，调用方把整层藏掉，宁可没有）', () => {
    expect(draw(RING.slice(0, 2)).painted).toBe(false);
    expect(draw([]).painted).toBe(false);
    expect(draw([{ x: 0, y: Number.NaN }, { x: 10, y: 10 }, { x: 20, y: 20 }]).painted).toBe(false);
    expect(draw(RING, { width: 0, height: 900 }).painted).toBe(false);
  });

  it('退化时连清屏都不做——不能让「没有范围」这件事顺手把画面抹掉', () => {
    const { cap } = draw(RING.slice(0, 2));
    expect(cap.clears).toHaveLength(0);
    expect(cap.images).toHaveLength(0);
    expect(cap.fills).toHaveLength(0);
  });

  it('顶点冲出视口照样能画：ptr 交给 evenodd，不做百分比夹取', () => {
    const { cap, painted } = draw([
      { x: -400, y: -60 },
      { x: 1600, y: -60 },
      { x: 1600, y: 1200 },
      { x: -400, y: 1200 },
    ]);
    expect(painted).toBe(true);
    expect(cap.lines[0]).toEqual([-400, -60]);
    expect(cap.clips).toEqual(['evenodd']);
  });
});
