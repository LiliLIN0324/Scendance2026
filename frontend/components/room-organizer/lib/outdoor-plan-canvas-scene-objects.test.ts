import { describe, expect, it } from 'vitest';
import { drawSceneObjectsLayer, type PlanCanvasContext, type PlanViewport } from './outdoor-plan-canvas';
import type { PlanSceneObject } from './plan-item-bridge';

/** 视口（只为让米/像素换算有确定值）。 */
const VIEWPORT: PlanViewport = {
  lng: 120.15,
  lat: 30.28,
  zoom: 18,
  canvasW: 800,
  canvasH: 600,
};

/** 记录调用次数的画布桩：不需要 jsdom，只关心「画了没有、画成什么样」。 */
interface FillRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
  fillStyle: string;
}

interface StrokeRectCall {
  x: number;
  y: number;
  w: number;
  h: number;
  strokeStyle: string;
  lineWidth: number;
  dash: number[];
}

interface StubCtx {
  save: () => void;
  restore: () => void;
  translate: (x: number, y: number) => void;
  rotate: (angle: number) => void;
  fillRect: (x: number, y: number, w: number, h: number) => void;
  strokeRect: (x: number, y: number, w: number, h: number) => void;
  setLineDash: (segments: number[]) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  stroke: () => void;
  fillText: (text: string, x: number, y: number) => void;
  measureText: (text: string) => { width: number };
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
}

/** 桩上下文 + 录制下来的调用。 */
type StubCtxWithCalls = StubCtx & {
  fillRectCalls: FillRectCall[];
  strokeRectCalls: StrokeRectCall[];
  rotateCalls: number[];
  setLineDashCalls: number[][];
  fillTextCalls: Array<[string, number, number]>;
};

function makeStubCtx(): StubCtxWithCalls {
  const fillRectCalls: FillRectCall[] = [];
  const strokeRectCalls: StrokeRectCall[] = [];
  const rotateCalls: number[] = [];
  const setLineDashCalls: number[][] = [];
  const fillTextCalls: Array<[string, number, number]> = [];
  let dash: number[] = [];
  const ctx: StubCtxWithCalls = {
    fillRectCalls,
    strokeRectCalls,
    rotateCalls,
    setLineDashCalls,
    fillTextCalls,
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: (angle: number) => {
      rotateCalls.push(angle);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      fillRectCalls.push({ x, y, w, h, fillStyle: ctx.fillStyle });
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      strokeRectCalls.push({ x, y, w, h, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth, dash: [...dash] });
    },
    setLineDash: (segments: number[]) => {
      dash = [...segments];
      setLineDashCalls.push([...segments]);
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: (text: string, x: number, y: number) => {
      fillTextCalls.push([text, x, y]);
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  return ctx;
}

function makeCanvas(): { ctx: StubCtxWithCalls; canvas: PlanCanvasContext } {
  const ctx = makeStubCtx();
  const canvas: PlanCanvasContext = {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    viewport: VIEWPORT,
  };
  return { ctx, canvas };
}

const ITEM: PlanSceneObject = {
  id: 'item:table-1',
  kind: 'item',
  name: '圆桌',
  center: { x: 2, y: 3 },
  width: 1.2,
  depth: 1.2,
  height: 0.75,
  rotationDeg: 30,
  color: '#8899aa',
};

const SCENE: PlanSceneObject = {
  id: 'scene:venue-scan',
  kind: 'scene',
  name: '实景扫描',
  center: { x: 0, y: 0 },
  width: 20,
  depth: 16,
  height: 0,
  rotationDeg: 0,
  color: '#6ea8ff',
};

describe('drawSceneObjectsLayer（室内 3D 落位 → 户外 2D 只读投影）', () => {
  it('物料：半透明填充 + 实线描边 + 框下方名称', () => {
    const { ctx, canvas } = makeCanvas();
    drawSceneObjectsLayer(canvas, [ITEM]);

    expect(ctx.fillRectCalls.length).toBe(1);
    expect(ctx.strokeRectCalls.length).toBe(1);
    // 填充是半透明的（0.14），描边是本色实线。
    expect(ctx.fillRectCalls[0].fillStyle).toBe('rgba(136,153,170,0.14)');
    expect(ctx.strokeRectCalls[0].strokeStyle).toBe('#8899aa');
    expect(ctx.strokeRectCalls[0].lineWidth).toBe(1.2);
    // 实线（没有虚线）。
    expect(ctx.strokeRectCalls[0].dash).toEqual([]);
    // 名称画在框下方。
    expect(ctx.fillTextCalls.map(([text]) => text)).toContain('圆桌');
    const [, textY] = ctx.fillTextCalls[0];
    const rect = ctx.strokeRectCalls[0];
    expect(textY).toBeGreaterThan(rect.y + rect.h / 2);
  });

  it('物料：rotationDeg 以负弧度传给 ctx.rotate（屏幕 y 向下）', () => {
    const { ctx, canvas } = makeCanvas();
    drawSceneObjectsLayer(canvas, [ITEM]);

    expect(ctx.rotateCalls.length).toBe(1);
    expect(ctx.rotateCalls[0]).toBeCloseTo((-30 * Math.PI) / 180, 10);
    expect(ctx.rotateCalls[0]).toBeLessThan(0);
  });

  it('实景扫描：只画虚线轮廓，不填充', () => {
    const { ctx, canvas } = makeCanvas();
    drawSceneObjectsLayer(canvas, [SCENE]);

    expect(ctx.fillRectCalls.length).toBe(0);
    expect(ctx.strokeRectCalls.length).toBe(1);
    expect(ctx.setLineDashCalls).toContainEqual([8, 5]);
    expect(ctx.strokeRectCalls[0].dash).toEqual([8, 5]);
    expect(ctx.strokeRectCalls[0].strokeStyle).toBe('#6ea8ff');
    expect(ctx.strokeRectCalls[0].lineWidth).toBe(1.5);
    // 中心一个标签。
    expect(ctx.fillTextCalls.map(([text]) => text)).toContain('实景扫描');
  });

  it('空数组：不画任何东西', () => {
    const { ctx, canvas } = makeCanvas();
    drawSceneObjectsLayer(canvas, []);

    expect(ctx.fillRectCalls.length).toBe(0);
    expect(ctx.strokeRectCalls.length).toBe(0);
    expect(ctx.fillTextCalls.length).toBe(0);
  });
});
