import { describe, expect, it } from 'vitest';
import {
  drawRouteKindChip,
  type PlanCanvasContext,
  type PlanViewport,
  type RouteKindGlyph,
} from './outdoor-plan-canvas';

const view: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 18, canvasW: 1200, canvasH: 800 };

interface Capture {
  ctx: CanvasRenderingContext2D;
  arcs: { x: number; y: number; r: number }[];
  points: { x: number; y: number }[];
  fills: number;
  strokes: number;
  saves: number;
  restores: number;
  texts: string[];
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

function capture(): Capture {
  const cap: Capture = {
    arcs: [], points: [], fills: 0, strokes: 0, saves: 0, restores: 0, texts: [],
    fillStyle: '', strokeStyle: '', lineWidth: 0,
  } as unknown as Capture;
  const ctx = {
    save: () => { cap.saves += 1; },
    restore: () => { cap.restores += 1; },
    beginPath: () => {},
    closePath: () => {},
    moveTo: (x: number, y: number) => { cap.points.push({ x, y }); },
    lineTo: (x: number, y: number) => { cap.points.push({ x, y }); },
    arc: (x: number, y: number, r: number) => { cap.arcs.push({ x, y, r }); },
    fill: () => { cap.fills += 1; },
    stroke: () => { cap.strokes += 1; },
    fillText: (text: string) => { cap.texts.push(text); },
  } as unknown as CanvasRenderingContext2D;
  for (const prop of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha'] as const) {
    Object.defineProperty(ctx, prop, {
      get: () => cap[prop as 'fillStyle'],
      set: (value: unknown) => { (cap as unknown as Record<string, unknown>)[prop] = value; },
    });
  }
  cap.ctx = ctx;
  return cap;
}

const chip = (kind: RouteKindGlyph, diameter?: number) => {
  const cap = capture();
  drawRouteKindChip(
    { ctx: cap.ctx, viewport: view } as PlanCanvasContext,
    { x: 200, y: 160 },
    kind,
    { color: '#4a6fa3', ...(diameter ? { diameter } : {}) },
  );
  return cap;
};

describe('动线折点芯片：底色是类型色，字形跟属性栏同源', () => {
  it('圆片用传入的类型色，外环与字形都是白色描边', () => {
    const cap = chip('pedestrian');
    expect(cap.fills).toBe(1);
    expect(cap.fillStyle).toBe('#4a6fa3');
    expect(cap.strokes).toBeGreaterThanOrEqual(2);
    expect(String(cap.strokeStyle)).toContain('255, 255, 255');
    expect(cap.saves).toBe(1);
    expect(cap.restores).toBe(1);
  });

  it('三种类型画出的字形各不相同（圆片 + 各自的骨架）', () => {
    // 人行 = 圆片 + 头（2 个圆弧）；车辆 = 圆片 + 两只轮子（3 个）；后勤 = 只有圆片。
    expect(chip('pedestrian').arcs.length).toBe(2);
    expect(chip('vehicle').arcs.length).toBe(3);
    expect(chip('service').arcs.length).toBe(1);
  });

  it('不再写任何文字（PED / VEH / LZ 那三个英文标已取消）', () => {
    for (const kind of ['pedestrian', 'vehicle', 'service'] as const) {
      expect(chip(kind).texts).toEqual([]);
    }
  });

  it('字形不溢出圆片：所有落点都在半径内', () => {
    for (const kind of ['pedestrian', 'vehicle', 'service'] as const) {
      const cap = chip(kind);
      const radius = cap.arcs[0]!.r;
      expect(radius).toBeCloseTo(15 / 2 - 0.75, 5);
      for (const point of cap.points) {
        const distance = Math.hypot(point.x - 200, point.y - 160);
        expect(distance).toBeLessThanOrEqual(radius + 0.2);
      }
    }
  });

  it('直径可调（缩小时字形跟着缩，不越界）', () => {
    const cap = chip('vehicle', 11);
    const radius = cap.arcs[0]!.r;
    expect(radius).toBeCloseTo(11 / 2 - 0.75, 5);
    for (const point of cap.points) {
      expect(Math.hypot(point.x - 200, point.y - 160)).toBeLessThanOrEqual(radius + 0.2);
    }
  });
});
