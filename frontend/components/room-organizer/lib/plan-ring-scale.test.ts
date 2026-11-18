import { describe, expect, it } from 'vitest';
import {
  RING_SCALE_HANDLE_OFFSET_PX,
  ringBounds,
  ringBoundsSize,
  ringScaleAnchor,
  ringScaleCorners,
  scaleRingToCorner,
} from './plan-ring-scale';
import { planPointToPixel, drawRingScaleHandles, ringScaleHandlePoints, type PlanViewport } from './outdoor-plan-canvas';

/* ---------------- 2026-11-18 用户：「分区和外面的用地红线也要有缩放，不只是点编辑挪动」 ---------------- */

const rect = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 5 },
  { x: 0, y: 5 },
];

const bounds = ringBounds(rect)!;

function area(ring: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

describe('ringBounds / ringScaleCorners（缩放基准）', () => {
  it('外接矩形与四角顺序 0=NW 1=NE 2=SE 3=SW', () => {
    expect(ringBounds(rect)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 5 });
    expect(ringScaleCorners(bounds)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ]);
  });

  it('锚点 = 对角：拖 NE 时 SW 钉住，拖 SE 时 NW 钉住', () => {
    expect(ringScaleAnchor(bounds, 1)).toEqual({ x: 0, y: 5 });
    expect(ringScaleAnchor(bounds, 2)).toEqual({ x: 0, y: 0 });
  });

  it('不足 3 点的环没有外接矩形（还不成形，不给缩放）', () => {
    expect(ringBounds([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe('scaleRingToCorner：自由缩放（默认）', () => {
  it('拖 NE 到 (20,-5)：SW 不动，尺寸变 20 × 10', () => {
    const next = scaleRingToCorner(rect, bounds, 1, { x: 20, y: -5 })!;
    expect(next).not.toBeNull();
    const nextBounds = ringBounds(next)!;
    expect(ringBoundsSize(nextBounds)).toEqual({ widthM: 20, heightM: 10 });
    // SW 角（原 (0,5)）还是 (0,5)。
    expect(next.some(p => Math.hypot(p.x - 0, p.y - 5) < 1e-9)).toBe(true);
  });

  it('x/y 各自按指针走：宽拉 3 倍、高只拉 2 倍，形状走样但仍是矩形', () => {
    const next = scaleRingToCorner(rect, bounds, 2, { x: 30, y: 10 })!;
    expect(ringBoundsSize(ringBounds(next)!)).toEqual({ widthM: 30, heightM: 10 });
    expect(area(next)).toBeCloseTo(300, 6);
  });

  it('缩到锚点上就停在最小边长（0.5 m），绝不塌成一条线', () => {
    const next = scaleRingToCorner(rect, bounds, 1, { x: 0, y: 5 }, { minSpanM: 0.5 })!;
    const size = ringBoundsSize(ringBounds(next)!);
    expect(size.widthM).toBeCloseTo(0.5, 6);
    expect(size.heightM).toBeCloseTo(0.5, 6);
  });

  it('拖过锚点也不镜像（正系数下限）：绕向不变、坐标不翻面', () => {
    const next = scaleRingToCorner(rect, bounds, 1, { x: -10, y: 20 }, { minSpanM: 0.5 })!;
    const nextBounds = ringBounds(next)!;
    expect(nextBounds.minX).toBeCloseTo(0, 9);
    expect(nextBounds.maxY).toBeCloseTo(5, 9);
    expect(ringBoundsSize(nextBounds).widthM).toBeGreaterThan(0);
  });

  it('凹多边形整体按同一变换：缩 2 倍后面积是原来 4 倍', () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 6 },
      { x: 0, y: 6 },
    ];
    const lBounds = ringBounds(lShape)!;
    const next = scaleRingToCorner(lShape, lBounds, 2, { x: 16, y: 12 })!;
    expect(area(next)).toBeCloseTo(area(lShape) * 4, 6);
  });

  it('退化外接矩形（所有点共线）不产生 NaN，那条轴保持原样', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ];
    const next = scaleRingToCorner(line, ringBounds(line)!, 1, { x: 20, y: 3 })!;
    for (const p of next) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBe(0);
    }
    expect(ringBoundsSize(ringBounds(next)!).widthM).toBeCloseTo(20, 6);
  });
});

describe('scaleRingToCorner：等比（Shift）', () => {
  it('沿对角线拖：宽高同系数，2:1 的长宽比一点没走样', () => {
    // 锚点 (0,5)、原 NE (10,0)：对角线指向 (10,-5)。指针落在同方向 2.48 倍处。
    const next = scaleRingToCorner(rect, bounds, 1, { x: 24.8, y: 5 - 5 * 2.48 }, { uniform: true })!;
    const size = ringBoundsSize(ringBounds(next)!);
    expect(size.widthM / size.heightM).toBeCloseTo(2, 6);
    expect(size.widthM).toBeCloseTo(24.8, 6);
  });

  it('指针偏出对角线（只想拉宽）时仍等比，只取沿对角线的投影', () => {
    const next = scaleRingToCorner(rect, bounds, 1, { x: 30, y: -2 }, { uniform: true })!;
    const size = ringBoundsSize(ringBounds(next)!);
    expect(size.widthM / size.heightM).toBeCloseTo(2, 6);
    // 投影 = (30*10 + (-7)*(-5)) / 125 = (300+35)/125 = 2.68
    expect(size.widthM).toBeCloseTo(26.8, 6);
    expect(size.heightM).toBeCloseTo(13.4, 6);
  });
});

describe('ringScaleHandlePoints：四角外侧的缩放柄', () => {
  const viewport: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 16, canvasW: 1200, canvasH: 800 };

  it('每只柄都在对应角的外侧，且离角点 RING_SCALE_HANDLE_OFFSET_PX（不与顶点手柄同点）', () => {
    const corners = ringScaleCorners(bounds);
    const handles = ringScaleHandlePoints(rect, viewport);
    expect(handles).toHaveLength(4);
    // 外移距离超过顶点命中半径（10 px），「拖顶点改形」与「拖角柄缩放」不会抢同一块热区。
    expect(RING_SCALE_HANDLE_OFFSET_PX).toBeGreaterThan(10);
    corners.forEach((corner, index) => {
      const cornerPx = planPointToPixel(corner, viewport);
      const handle = handles[index]!;
      const dist = Math.hypot(handle.x - cornerPx.x, handle.y - cornerPx.y);
      expect(dist).toBeCloseTo(RING_SCALE_HANDLE_OFFSET_PX, 6);
      // 朝着「外」：柄比角点离外接矩形中心更远。
      const centerPx = planPointToPixel({ x: 5, y: 2.5 }, viewport);
      const cornerFromCenter = Math.hypot(cornerPx.x - centerPx.x, cornerPx.y - centerPx.y);
      const handleFromCenter = Math.hypot(handle.x - centerPx.x, handle.y - centerPx.y);
      expect(handleFromCenter).toBeGreaterThan(cornerFromCenter);
    });
  });

  it('罗盘转过 45° 后，柄仍在框的外侧（不会转进框里）', () => {
    const rotated: PlanViewport = { ...viewport, bearing: Math.PI / 4 };
    const centerPx = planPointToPixel({ x: 5, y: 2.5 }, rotated);
    const corners = ringScaleCorners(bounds);
    const handles = ringScaleHandlePoints(rect, rotated);
    corners.forEach((corner, index) => {
      const cornerPx = planPointToPixel(corner, rotated);
      const handle = handles[index]!;
      expect(Math.hypot(handle.x - centerPx.x, handle.y - centerPx.y))
        .toBeGreaterThan(Math.hypot(cornerPx.x - centerPx.x, cornerPx.y - centerPx.y));
    });
  });

  it('还不成形的环（<3 点）不画柄', () => {
    expect(ringScaleHandlePoints([{ x: 0, y: 0 }], viewport)).toEqual([]);
  });
});

describe('drawRingScaleHandles：画四只角柄', () => {
  interface Capture {
    rects: string[];
    fills: string[];
    strokes: string[];
  }

  function makeCtx(): { ctx: CanvasRenderingContext2D; cap: Capture } {
    const cap: Capture = { rects: [], fills: [], strokes: [] };
    const ctx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      rect: (x: number, y: number, w: number, h: number) => cap.rects.push(`rect:${x},${y},${w},${h}`),
      strokeRect: (x: number, y: number, w: number, h: number) => cap.rects.push(`stroke:${x},${y},${w},${h}`),
      fillRect: (x: number, y: number, w: number, h: number) => cap.rects.push(`fill:${x},${y},${w},${h}`),
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(ctx, 'strokeStyle', { set: (v: string) => cap.strokes.push(v), get: () => '' });
    Object.defineProperty(ctx, 'fillStyle', { set: (v: string) => cap.fills.push(v), get: () => '' });
    Object.defineProperty(ctx, 'lineWidth', { set: () => {}, get: () => 1 });
    return { ctx, cap };
  }

  const viewport: PlanViewport = { lng: 120.141306, lat: 30.2545, zoom: 16, canvasW: 1200, canvasH: 800 };

  it('四个角各画一只白底方块（rect 路径 + fill/stroke）', () => {
    const { ctx, cap } = makeCtx();
    drawRingScaleHandles({ ctx, viewport }, rect, { color: '#1f8a5b' });
    // 每只柄：一条 rect 路径，再 fill + stroke（不是 fillRect，fillStyle 只设一次）。
    expect(cap.rects.filter(r => r.startsWith('rect:'))).toHaveLength(4);
    expect(cap.fills.filter(f => f === 'rgba(255, 255, 255, 0.96)')).toHaveLength(4);
    expect(cap.strokes).toContain('#1f8a5b');
  });

  it('正在拖的角改实心（填色 = 描边色），其余仍白底', () => {
    const { ctx, cap } = makeCtx();
    drawRingScaleHandles({ ctx, viewport }, rect, { color: '#c0392b', activeCorner: 2 });
    expect(cap.fills.filter(f => f === '#c0392b')).toHaveLength(1);
    expect(cap.fills.filter(f => f === 'rgba(255, 255, 255, 0.96)')).toHaveLength(3);
  });

  it('不足 3 点的环什么都不画', () => {
    const { ctx, cap } = makeCtx();
    drawRingScaleHandles({ ctx, viewport }, [{ x: 0, y: 0 }], { color: '#1f8a5b' });
    expect(cap.rects).toEqual([]);
  });
});
