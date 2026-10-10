import { describe, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from '../lib/__testfixtures__/fixtures';
import { layoutGeometryScene } from '../lib/structural-layout';
import { computeFloorPlanPlacement, computeHeatmapCells, get2DViewTransform, HEATMAP_COLS, HEATMAP_ROWS, placeDimensionLabels, render2DTopDown, type DimensionLabel } from './render';

it('rounds item and room dimension labels to at most two decimal places without rounding scene data', () => {
  const texts: string[] = [];
  const ctx = new Proxy({}, { get: (_target, key) => key === 'fillText' ? (text: string) => texts.push(text) : key === 'measureText' ? () => ({ width: 12 }) : () => {} });
  const canvas = { width: 800, height: 600, clientWidth: 800, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const item = makeItem({ width: 1.2367, depth: 0.88888 });
  const floor = { id: 'floor', name: 'test floor', floorColor: '#ffffff', floorPattern: 'solid' as const, items: [item] };
  const layout = { name: 'measured', width: 10.12345, height: 8.77777, floors: [floor] };
  render2DTopDown({ canvas, layout, floor, selectedItemId: item.id, showMeasurements: true, showWiFiSignals: false, hasCollision: () => false });
  expect(texts).toContain('1.24m × 0.89m');
  expect(texts).toContain('10.12m');
  expect(texts).toContain('8.78m');
  expect(item.width).toBe(1.2367);
});

describe('dimension label placement', () => {
  const label = (id: string, x: number, y: number, priority: DimensionLabel['priority'] = 2): DimensionLabel =>
    ({ id, text: id, x, y, width: 84, height: 14, priority });
  function expectSeparated(placed: ReturnType<typeof placeDimensionLabels>): void {
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!.bounds, b = placed[j]!.bounds;
      expect(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom).toBe(true);
    }
  }
  it('keeps selected labels ahead of overview labels and separates multiple selected labels', () => {
    const labels = [label('overview', 140, 80), { ...label('extra', 140, 80, 1), alternatives: [{ x: 140, y: 50 }] }, label('primary', 140, 80, 0)];
    const original = JSON.stringify(labels), placed = placeDimensionLabels(labels, { width: 300, height: 180 });
    expect(placed.map(value => value.id)).toEqual(['primary', 'extra']);
    expect(placed[1]!.y).toBe(50); expectSeparated(placed);
    expect(JSON.stringify(labels)).toBe(original);
  });
  it('omits overlapping labels in a dense 39-item overview without changing the input', () => {
    const labels = Array.from({ length: 39 }, (_, index) => label(String(index), 50 + index % 13 * 18, 50 + Math.floor(index / 13) * 22));
    const original = JSON.stringify(labels), placed = placeDimensionLabels(labels, { width: 400, height: 180 });
    expect(placed.length).toBeGreaterThan(0); expect(placed.length).toBeLessThan(39); expectSeparated(placed);
    expect(JSON.stringify(labels)).toBe(original);
  });
  it('keeps edge labels inside the CSS viewport and avoids reserved room dimensions', () => {
    const blocked = [{ left: 100, top: 10, right: 190, bottom: 30 }];
    const labels = [
      { ...label('selected', 145, 20, 0), alternatives: [{ x: 145, y: 60 }] },
      label('left', -50, 100), label('right', 500, 130), label('bottom', 145, 500),
    ];
    const placed = placeDimensionLabels(labels, { width: 300, height: 180 }, blocked);
    expect(placed).toHaveLength(4); expect(placed[0]!.y).toBe(60); expectSeparated(placed);
    for (const { bounds } of placed) {
      expect(bounds.left).toBeGreaterThanOrEqual(2); expect(bounds.top).toBeGreaterThanOrEqual(2);
      expect(bounds.right).toBeLessThanOrEqual(298); expect(bounds.bottom).toBeLessThanOrEqual(178);
      expect(bounds.right <= 100 || bounds.left >= 190 || bounds.bottom <= 10 || bounds.top >= 30).toBe(true);
    }
    expect(placeDimensionLabels([label('cannot fit', 10, 10)], { width: 60, height: 40 })).toEqual([]);
  });
});

it('draws readable dimensions after all 39 footprints, preserves geometry, and uses CSS pixels at either DPR', () => {
  const items = Array.from({ length: 39 }, (_, index) => makeItem({ id: `chair-${index}`, width: 0.45, depth: 0.45,
    position: { x: index % 13 * 0.5 - 3, z: Math.floor(index / 13) * 0.5 - 0.5 } }));
  const floor = makeFloor({ items }), layout = makeLayout({ width: 10, height: 8, floors: [floor] });
  const original = JSON.stringify(layout);
  const paint = (dpr: number, showMeasurements = true) => {
    let order = 0;
    const texts: { text: string; x: number; y: number; order: number }[] = [], footprints: { args: number[]; order: number }[] = [];
    const methods = {
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, order: ++order }),
      fillRect: (...args: number[]) => { if (args[0] === -args[2]! / 2 && args[1] === -args[3]! / 2) footprints.push({ args, order: ++order }); },
    };
    const ctx = new Proxy(methods, { get: (target, key) => target[key as keyof typeof methods] ?? (() => {}) });
    const canvas = { width: 800 * dpr, height: 600 * dpr, clientWidth: 800, getContext: () => ctx } as unknown as HTMLCanvasElement;
    render2DTopDown({ canvas, layout, floor, selectedItemId: items[38]!.id, extraSelectedIds: new Set([items[37]!.id]),
      showMeasurements, showWiFiSignals: false, hasCollision: () => false });
    return { dimensions: texts.filter(value => value.text.includes(' × ')), texts, footprints };
  };
  const shown = paint(1), retina = paint(2), hidden = paint(1, false);
  expect(shown.footprints).toHaveLength(39); expect(shown.dimensions.length).toBeGreaterThan(0); expect(shown.dimensions.length).toBeLessThan(39);
  expect(Math.min(...shown.dimensions.map(value => value.order))).toBeGreaterThan(Math.max(...shown.footprints.map(value => value.order)));
  const positions = (painted: ReturnType<typeof paint>) => painted.dimensions.map(({ text, x, y }) => ({ text, x, y }));
  expect(positions(retina)).toEqual(positions(shown));
  expect(hidden.texts.some(value => /m/.test(value.text))).toBe(false);
  expect(hidden.footprints.map(value => value.args)).toEqual(shown.footprints.map(value => value.args));
  for (let i = 0; i < shown.dimensions.length; i++) for (let j = i + 1; j < shown.dimensions.length; j++) {
    const a = shown.dimensions[i]!, b = shown.dimensions[j]!;
    expect(Math.abs(a.x - b.x) >= a.text.length * 6 + 6 || Math.abs(a.y - b.y) >= 14).toBe(true);
  }
  expect(JSON.stringify(layout)).toBe(original);
});

it('does not move a fully offscreen selected item dimension onto the viewport edge', () => {
  const visible = makeItem({ width: 0.45, depth: 0.45 });
  const outside = makeItem({ id: 'offscreen', width: 0.82, depth: 0.83, rotation: Math.PI / 4, position: { x: 100, z: 0 } });
  const floor = makeFloor({ items: [visible, outside] }), layout = makeLayout({ width: 10, height: 8, floors: [floor] });
  const original = JSON.stringify(layout), texts: string[] = [], rectangles: number[][] = [];
  const methods = { measureText: (text: string) => ({ width: text.length * 6 }), fillText: (text: string) => texts.push(text),
    fillRect: (...args: number[]) => { if (args[0] === -args[2]! / 2 && args[1] === -args[3]! / 2) rectangles.push(args); } };
  const ctx = new Proxy(methods, { get: (target, key) => target[key as keyof typeof methods] ?? (() => {}) });
  const canvas = { width: 800, height: 600, clientWidth: 800, getContext: () => ctx } as unknown as HTMLCanvasElement;
  render2DTopDown({ canvas, layout, floor, selectedItemId: outside.id, showMeasurements: true, showWiFiSignals: false, hasCollision: () => false });
  expect(rectangles).toHaveLength(2); expect(texts).toContain('0.45m × 0.45m'); expect(texts).not.toContain('0.82m × 0.83m');
  expect(JSON.stringify(layout)).toBe(original);
});

// A 10×10 m room with the default 20×20 grid gives 0.5 m cells, so grid
// coordinates are easy to reason about: cell (col, row) spans
// [col·0.5, (col+1)·0.5) × [row·0.5, (row+1)·0.5) in room space, and room
// space is world space shifted by +5 on each axis.
const ROOM = 10;

describe('main canvas reference image', () => {
  class DecodedImage {
    complete = true; naturalWidth = 100; naturalHeight = 50;
    onload: (() => void) | null = null;
    set src(_url: string) { this.onload?.(); }
  }
  const setup = () => {
    const drawImage = vi.fn(), transform = vi.fn();
    const target: Record<string, unknown> = { drawImage, transform, globalAlpha: 1 };
    const alphaStack: number[] = [];
    target.save = () => alphaStack.push(target.globalAlpha as number);
    target.restore = () => { target.globalAlpha = alphaStack.pop() ?? 1; };
    const ctx = new Proxy(target, { get: (obj, key) => obj[key as string] ?? (() => {}) });
    const canvas = { width: 800, height: 600, clientWidth: 800, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const floor = makeFloor(), layout = makeLayout({ width: 10, height: 8, floors: [floor], floorPlanImage: 'data:legacy-reference' });
    const options = { canvas, layout, floor, selectedItemId: null, showMeasurements: false, showWiFiSignals: false, hasCollision: () => false };
    return { options, drawImage, transform, target };
  };
  it('hiding keeps the source and paints a solid floor without decoding or drawing', () => {
    const image = vi.fn(); vi.stubGlobal('Image', image);
    try {
      const { options, drawImage } = setup();
      render2DTopDown({ ...options, showFloorPlan: false });
      expect(drawImage).not.toHaveBeenCalled();
      expect(image).not.toHaveBeenCalled();
      expect(options.layout.floorPlanImage).toBe('data:legacy-reference');
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses the same affine mapping for a skewed reference, with display opacity', () => {
    vi.stubGlobal('Image', DecodedImage);
    try {
      const { options, drawImage, transform, target } = setup();
      const referenceImage = { url: 'blob:skew-reference', pixelWidth: 100, pixelHeight: 50,
        imageToWorld: [0.05, 0.01, -0.02, 0.08, 2, 1] as const };
      const shown = { ...options, referenceImage, floorPlanOpacity: 0.25 };
      const alpha: number[] = [];
      drawImage.mockImplementation(() => alpha.push(target.globalAlpha as number));
      render2DTopDown(shown); render2DTopDown(shown);
      const { scale, offsetX, offsetY } = get2DViewTransform(800, 600, options.layout);
      expect(transform).toHaveBeenCalledWith(0.05 * scale, 0.01 * scale, -0.02 * scale, 0.08 * scale,
        offsetX + 2 * scale, offsetY + scale);
      expect(drawImage.mock.lastCall?.slice(1)).toEqual([0, 0, 100, 50]);
      expect(alpha).toEqual([0.25]);
      expect(target.globalAlpha).toBe(1);
      drawImage.mockClear();
      render2DTopDown({ ...shown, showFloorPlan: false });
      expect(drawImage).not.toHaveBeenCalled();
      const upper = makeFloor({ id: 'upper' });
      render2DTopDown({ ...shown, layout: { ...options.layout, floors: [options.floor, upper] }, floor: upper });
      expect(drawImage).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('never stretches an old image into a v2 scene without an applied reference mapping', () => {
    const image = vi.fn(); vi.stubGlobal('Image', image);
    try {
      const { options, drawImage } = setup();
      const layout = { ...options.layout, backendSceneV2: layoutGeometryScene(options.layout) };
      render2DTopDown({ ...options, layout });
      expect(image).not.toHaveBeenCalled(); expect(drawImage).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('leaves the legacy fit unchanged and allows display opacity to override its saved value', () => {
    vi.stubGlobal('Image', DecodedImage);
    try {
      const { options, drawImage, transform, target } = setup();
      const shown = { ...options, layout: { ...options.layout, floorPlanOpacity: 0.6 }, floorPlanOpacity: 0.3 };
      const alpha: number[] = [];
      drawImage.mockImplementation(() => alpha.push(target.globalAlpha as number));
      render2DTopDown(shown); render2DTopDown(shown);
      expect(drawImage.mock.lastCall).toHaveLength(9);
      expect(transform).not.toHaveBeenCalled();
      expect(alpha).toEqual([0.3]);
      expect(shown.layout.floorPlanOpacity).toBe(0.6);
    } finally { vi.unstubAllGlobals(); }
  });
});

const sum = (grid: readonly number[]): number => grid.reduce((a, b) => a + b, 0);

describe('computeHeatmapCells — overlap-weighted attribution (#150)', () => {
  it('splits a corner-centred item evenly across the four touched cells and conserves its total', () => {
    // 0.5×0.5 §2000 item centred exactly on the corner shared by cells
    // (9,9)/(10,9)/(9,10)/(10,10): each quadrant overlap is 0.25×0.25 m².
    const item = makeItem({ width: 0.5, depth: 0.5, price: 2000, position: { x: 0, z: 0 } });
    const grid = computeHeatmapCells([item], ROOM, ROOM);

    const touched = [9 * HEATMAP_COLS + 9, 9 * HEATMAP_COLS + 10, 10 * HEATMAP_COLS + 9, 10 * HEATMAP_COLS + 10];
    for (const idx of touched) {
      expect(grid[idx]).toBeCloseTo(500, 8);
    }
    // Sum conservation: exactly the item's own price — the old code counted
    // pricePerArea·cellArea per touched cell (§8000 total here, 4× too hot).
    expect(sum(grid)).toBeCloseTo(2000, 8);
    // Nothing leaked into any other cell.
    const other = grid.filter((_, idx) => !touched.includes(idx));
    expect(Math.max(...other)).toBe(0);
  });

  it('attributes a fully-contained item entirely to its single cell', () => {
    // 0.4×0.4 item centred in cell (0,0) — room-space centre (0.25, 0.25).
    const item = makeItem({ width: 0.4, depth: 0.4, price: 1200, position: { x: -4.75, z: -4.75 } });
    const grid = computeHeatmapCells([item], ROOM, ROOM);

    expect(grid[0]).toBeCloseTo(1200, 8);
    expect(sum(grid)).toBeCloseTo(1200, 8);
    expect(Math.max(...grid.slice(1))).toBe(0);
  });

  it('weights unevenly-straddling items by the actual per-cell fraction', () => {
    // 1×0.5 item spanning grid x ∈ [4.85, 5.85): 0.15 m in col 9, 0.5 m in
    // col 10, 0.35 m in col 11 — all within row 9 (z ∈ [4.5, 5.0)).
    const item = makeItem({ width: 1, depth: 0.5, price: 1000, position: { x: 0.35, z: -0.25 } });
    const grid = computeHeatmapCells([item], ROOM, ROOM);

    const row = 9 * HEATMAP_COLS;
    expect(grid[row + 9]).toBeCloseTo(150, 8);
    expect(grid[row + 10]).toBeCloseTo(500, 8);
    expect(grid[row + 11]).toBeCloseTo(350, 8);
    expect(sum(grid)).toBeCloseTo(1000, 8);
  });

  it('conserves the total for a 90°-rotated item via its swapped AABB', () => {
    const item = makeItem({
      width: 2,
      depth: 0.5,
      price: 3000,
      rotation: Math.PI / 2,
      position: { x: 1.13, z: -0.87 },
    });
    const grid = computeHeatmapCells([item], ROOM, ROOM);
    // At 90° the AABB has the same area as the footprint, so the weighted sum
    // is exactly the price even at an off-grid position.
    expect(sum(grid)).toBeCloseTo(3000, 8);
  });

  it('ignores unplaced, free, and zero-area items', () => {
    const unplaced = makeUnplacedItem({ id: 'a', price: 500 });
    const free = makeItem({ id: 'b', price: 0 });
    const zeroArea = makeItem({ id: 'c', price: 500, width: 0 });
    const grid = computeHeatmapCells([unplaced, free, zeroArea], ROOM, ROOM);
    expect(sum(grid)).toBe(0);
    expect(grid).toHaveLength(HEATMAP_COLS * HEATMAP_ROWS);
  });
});

describe('computeFloorPlanPlacement (#218)', () => {
  it('stretch fills the room with the whole image', () => {
    const { source, dest } = computeFloorPlanPlacement(2000, 1000, 1, 'stretch');
    expect(source).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
    expect(dest).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('cover crops a wide image to the room aspect, centered', () => {
    const { source, dest } = computeFloorPlanPlacement(2000, 1000, 1, 'cover');
    // Square room: keep a 1000-wide centered band of the 2000-wide image.
    expect(source).toEqual({ x: 500, y: 0, w: 1000, h: 1000 });
    expect(dest).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('cover crops a tall image vertically', () => {
    const { source } = computeFloorPlanPlacement(1000, 2000, 1, 'cover');
    expect(source).toEqual({ x: 0, y: 500, w: 1000, h: 1000 });
  });

  it('contain letterboxes a wide image with centered bands', () => {
    const { source, dest } = computeFloorPlanPlacement(2000, 1000, 1, 'contain');
    expect(source).toEqual({ x: 0, y: 0, w: 2000, h: 1000 });
    expect(dest.w).toBe(1);
    expect(dest.h).toBeCloseTo(0.5, 10);
    expect(dest.y).toBeCloseTo(0.25, 10);
  });

  it('contain pillarboxes a tall image', () => {
    const { dest } = computeFloorPlanPlacement(1000, 2000, 1, 'contain');
    expect(dest.h).toBe(1);
    expect(dest.w).toBeCloseTo(0.5, 10);
    expect(dest.x).toBeCloseTo(0.25, 10);
  });

  it('contain preserves the image aspect in room space for any room', () => {
    for (const roomAspect of [0.5, 1, 1.6, 3]) {
      const { dest } = computeFloorPlanPlacement(1600, 900, roomAspect, 'contain');
      const paintedAspect = (dest.w * roomAspect) / dest.h;
      expect(paintedAspect).toBeCloseTo(1600 / 900, 10);
    }
  });
});
