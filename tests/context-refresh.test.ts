import { describe, expect, it } from 'vitest';
import {
  diffScene,
  renderDelta,
  renderRoundContext,
  shouldStopForNoProgress,
  type GridRect,
  type SceneBox,
  type SceneDelta,
  type SceneSnapshot,
  type TerrainKind,
} from '../supabase/functions/_shared/context-refresh.ts';

const flatCells = (width: number, height: number): TerrainKind[] =>
  Array.from({ length: width * height }, () => 'flat' as TerrainKind);

function makeScene(options: {
  width?: number;
  height?: number;
  cells?: readonly TerrainKind[];
  originX?: number;
  originY?: number;
  buildable?: GridRect;
  structures?: SceneBox[];
  objects?: SceneBox[];
} = {}): SceneSnapshot {
  const width = options.width ?? 40;
  const height = options.height ?? 30;
  return {
    width,
    height,
    cells: options.cells ?? flatCells(width, height),
    originX: options.originX ?? 0,
    originY: options.originY ?? 0,
    buildable: options.buildable ?? { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 },
    structures: options.structures ?? [],
    objects: options.objects ?? [],
  };
}

/** 169×140 的大图：山、水、路、两个不可覆盖结构，足够触发平面裁剪。 */
function largeScene(objects: SceneBox[] = []): SceneSnapshot {
  const width = 169;
  const height = 140;
  const cells = flatCells(width, height);
  const at = (x: number, y: number) => y * width + x;

  for (let y = 30; y < 80; y++) {
    for (let x = 60; x < 105; x++) cells[at(x, y)] = 'mountain';
  }
  for (let y = 90; y < 105; y++) {
    for (let x = 20; x < 45; x++) cells[at(x, y)] = 'water';
  }
  for (let y = 0; y < height; y++) {
    for (let x = 80; x < 84; x++) {
      if (cells[at(x, y)] === 'flat') cells[at(x, y)] = 'road';
    }
  }

  return makeScene({
    width,
    height,
    cells,
    buildable: { minX: 13, minY: 6, maxX: 154, maxY: 126 },
    structures: [
      { id: 'plaza', kind: '__plaza__', x: 79, y: 64, w: 20, h: 27 },
      { id: 'station', kind: 'facility-station', x: 26, y: 133, w: 16, h: 20 },
    ],
    objects,
  });
}

function roundFixture(): { scene: SceneSnapshot; delta: SceneDelta } {
  const before = largeScene();
  const cells = [...before.cells];
  for (let y = 110; y < 118; y++) {
    for (let x = 115; x < 119; x++) cells[y * before.width + x] = 'water';
  }
  const scene = largeScene([{ id: 'sunset-hut', kind: 'sunset-hut', x: 136, y: 51, w: 5, h: 4 }]);
  const withWater = { ...scene, cells };
  return { scene: withWater, delta: diffScene(before, withWater) };
}

describe('diffScene', () => {
  it('counts 32 grass cells turned into water and reports their bounds', () => {
    const before = makeScene();
    const cells = [...before.cells];
    for (let y = 20; y < 28; y++) {
      for (let x = 10; x < 14; x++) cells[y * before.width + x] = 'water';
    }
    const after = makeScene({ cells });
    const delta = diffScene(before, after);

    expect(delta.cellsChanged).toBe(32);
    expect(delta.cellsAdded.water).toBe(32);
    expect(delta.cellsRemoved.flat).toBe(32);
    expect(delta.bounds).toEqual({ minX: 10, minY: 20, maxX: 13, maxY: 27 });
    expect(delta.isEmpty).toBe(false);
  });

  it('is empty when the snapshot did not change', () => {
    const scene = makeScene();
    const delta = diffScene(scene, scene);

    expect(delta.isEmpty).toBe(true);
    expect(delta.cellsChanged).toBe(0);
    expect(delta.bounds).toBeUndefined();
  });
});

describe('renderDelta', () => {
  it('names the empty step explicitly', () => {
    const delta = diffScene(makeScene(), makeScene());
    expect(renderDelta(delta)).toContain('没有变化');
  });

  it('summarises a real step in one compact line', () => {
    const { delta } = roundFixture();
    const line = renderDelta(delta);
    expect(line).toContain('改地形 32 格');
    expect(line).toContain('水 +32');
    expect(line).toContain('sunset-hut@(136,51) 5×4');
    expect(line).toContain('变化范围');
  });
});

describe('renderRoundContext', () => {
  it('renders both tags and stays inside the 1400-character budget', () => {
    const { scene, delta } = roundFixture();
    const output = renderRoundContext({
      scene,
      round: 3,
      maxRounds: 6,
      phase: 'locate',
      delta,
      selection: { x: 136, y: 51 },
      lastError: { code: 'STALE_SCENE', target: '(30,80)' },
    });

    expect(output).toContain('<round_context>');
    expect(output).toContain('</round_context>');
    expect(output.length).toBeLessThanOrEqual(1400);
  });

  it('resolves “here/it” when a cell is selected', () => {
    const { scene, delta } = roundFixture();
    const output = renderRoundContext({
      scene,
      round: 3,
      maxRounds: 6,
      phase: 'locate',
      delta,
      selection: { x: 136, y: 51 },
    });

    expect(output).toContain('你选中的格子：(136,51) 平地');
    expect(output).toContain('用户说的"这里/它"指这里');
  });

  it('keeps the last error code visible', () => {
    const { scene, delta } = roundFixture();
    const output = renderRoundContext({
      scene,
      round: 3,
      maxRounds: 6,
      phase: 'locate',
      delta,
      lastError: { code: 'STALE_SCENE', target: '(30,80)' },
    });

    expect(output).toContain('STALE_SCENE');
    expect(output).toContain('target=(30,80)');
  });

  it('keeps the ASCII plane at 32 rows or fewer, with a fixed row width', () => {
    const { scene, delta } = roundFixture();
    const output = renderRoundContext({
      scene,
      round: 3,
      maxRounds: 6,
      phase: 'locate',
      delta,
      selection: { x: 136, y: 51 },
      lastError: { code: 'STALE_SCENE', target: '(30,80)' },
    });
    const lines = output.split('\n');
    const start = lines.findIndex(line => line.startsWith('平面（'));
    const end = lines.lastIndexOf('</round_context>');

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const plane = lines.slice(start + 1, end);
    expect(plane.length).toBeLessThanOrEqual(32);
    const rows = plane.filter(line => line.startsWith('y='));
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map(line => line.length)).size).toBe(1);
  });
});

describe('shouldStopForNoProgress', () => {
  it('stops after two unchanged rounds that both reported errors', () => {
    const unchanged = diffScene(makeScene(), makeScene());
    expect(shouldStopForNoProgress([unchanged, unchanged], ['A', 'B'])).toEqual({
      stop: true,
      reason: 'NO_PROGRESS',
    });
  });

  it('stops when the same error code repeats', () => {
    const changed = roundFixture().delta;
    expect(shouldStopForNoProgress([changed, changed], ['E', 'E'])).toEqual({
      stop: true,
      reason: 'REPEAT_BLOCKED',
    });
  });

  it('does not stop when the map moves and errors differ', () => {
    const changed = roundFixture().delta;
    expect(shouldStopForNoProgress([changed, changed], ['E', 'F'])).toEqual({ stop: false });
  });
});
