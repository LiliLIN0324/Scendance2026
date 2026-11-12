import { describe, expect, it } from 'vitest';
import {
  LEFT_STACK_FLOAT_MARGIN,
  LEFT_STACK_FLOAT_MIN_HEIGHT,
  LEFT_STACK_FLOAT_MIN_WIDTH,
  LEFT_STACK_RATIO_MAX,
  LEFT_STACK_RATIO_MIN,
  LEFT_STACK_STORAGE_KEY,
  clampFloatRect,
  clampRatio,
  defaultFloatRect,
  defaultLeftStackState,
  normalizeLeftStackState,
  ratioFromPointer,
  readLeftStackState,
  swapLeftStackOrder,
  withLeftStackDetached,
  withLeftStackRatio,
  writeLeftStackState,
} from './left-stack';

function fakeStorage(seed?: string) {
  const data = new Map<string, string>();
  if (seed !== undefined) data.set(LEFT_STACK_STORAGE_KEY, seed);
  return {
    getItem(key: string) {
      return data.has(key) ? (data.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    dump() {
      return data.get(LEFT_STACK_STORAGE_KEY) ?? null;
    },
  };
}

const VIEWPORT = { width: 1440, height: 900 };

describe('left stack layout state', () => {
  it('默认户外在上、五五分，四张卡的独立小窗矩形都落在视口里', () => {
    const state = defaultLeftStackState(VIEWPORT);
    expect(state.first).toBe('outdoor');
    expect(state.ratio).toBe(0.5);
    expect(state.detached).toBeNull();
    for (const panel of ['outdoor', 'bingo', 'capture', 'chat'] as const) {
      const rect = state.rects[panel];
      expect(rect.width).toBeGreaterThanOrEqual(LEFT_STACK_FLOAT_MIN_WIDTH);
      expect(rect.x).toBeGreaterThanOrEqual(LEFT_STACK_FLOAT_MARGIN);
      expect(rect.y).toBeGreaterThanOrEqual(LEFT_STACK_FLOAT_MARGIN);
      expect(rect.x + rect.width).toBeLessThanOrEqual(VIEWPORT.width);
    }
  });

  it('比例夹在可读区间里，坏数字回落到一半', () => {
    expect(clampRatio(0.05)).toBe(LEFT_STACK_RATIO_MIN);
    expect(clampRatio(0.99)).toBe(LEFT_STACK_RATIO_MAX);
    expect(clampRatio(Number.NaN)).toBe(0.5);
    const state = withLeftStackRatio(defaultLeftStackState(VIEWPORT), 0.9);
    expect(state.ratio).toBe(LEFT_STACK_RATIO_MAX);
    // 已经贴着上限了就不必造新对象
    expect(withLeftStackRatio(state, 0.9)).toBe(state);
  });

  it('上下换序：first 让位给另一张卡，传同一张时幂等', () => {
    const once = swapLeftStackOrder(defaultLeftStackState(VIEWPORT), 'bingo');
    expect(once.first).toBe('bingo');
    expect(swapLeftStackOrder(once, 'outdoor').first).toBe('outdoor');
    expect(swapLeftStackOrder(once, 'bingo')).toBe(once);
  });

  it('同一时间只留一个独立小窗，四张卡都能被抓出来', () => {
    const outdoors = withLeftStackDetached(defaultLeftStackState(VIEWPORT), 'outdoor');
    expect(outdoors.detached).toBe('outdoor');
    for (const panel of ['bingo', 'capture', 'chat'] as const) {
      expect(withLeftStackDetached(outdoors, panel).detached).toBe(panel);
    }
    expect(withLeftStackDetached(outdoors, null).detached).toBeNull();
  });

  it('小窗被夹回视口：位置越界归位、尺寸不缩破下限', () => {
    const rect = clampFloatRect({ x: 5000, y: -300, width: 10, height: 10 }, VIEWPORT);
    expect(rect.width).toBe(LEFT_STACK_FLOAT_MIN_WIDTH);
    expect(rect.height).toBe(LEFT_STACK_FLOAT_MIN_HEIGHT);
    expect(rect.x).toBe(VIEWPORT.width - rect.width - LEFT_STACK_FLOAT_MARGIN);
    expect(rect.y).toBe(LEFT_STACK_FLOAT_MARGIN);
  });

  it('坏存档不影响开面板：一律回落默认值', () => {
    const fallback = normalizeLeftStackState({ order: 'sideways', ratio: 'tall', detached: 'camera', rects: { outdoor: { x: 0 } } }, VIEWPORT);
    expect(fallback.first).toBe('outdoor');
    expect(fallback.ratio).toBe(0.5);
    expect(fallback.detached).toBeNull();
    expect(fallback.rects.outdoor).toEqual(defaultFloatRect('outdoor', VIEWPORT));
  });

  it('旧版 order 存档兼容：outdoor-first/bingo-first 映射成 first，缺的新卡矩形补默认', () => {
    const legacy = normalizeLeftStackState({ order: 'bingo-first', ratio: 0.4, detached: null, rects: { outdoor: { x: 10, y: 20, width: 300, height: 400 }, bingo: { x: 10, y: 20, width: 300, height: 400 } } }, VIEWPORT);
    expect(legacy.first).toBe('bingo');
    expect(legacy.ratio).toBe(0.4);
    expect(legacy.rects.outdoor).toEqual({ x: 10, y: 20, width: 300, height: 400 });
    expect(legacy.rects.capture).toEqual(defaultFloatRect('capture', VIEWPORT));
    expect(legacy.rects.chat).toEqual(defaultFloatRect('chat', VIEWPORT));
  });

  it('读写本地存储：坏 JSON 与空值都回落，好值原样回来', () => {
    const storage = fakeStorage();
    expect(readLeftStackState(storage, VIEWPORT)).toEqual(defaultLeftStackState(VIEWPORT));

    const custom = { ...defaultLeftStackState(VIEWPORT), first: 'bingo' as const, ratio: 0.32, detached: 'bingo' as const };
    writeLeftStackState(custom, storage);
    expect(readLeftStackState(storage, VIEWPORT)).toEqual(custom);

    const broken = fakeStorage('{not json');
    expect(readLeftStackState(broken, VIEWPORT)).toEqual(defaultLeftStackState(VIEWPORT));
  });

  it('分隔条拖动换算：第一张卡在上，往下拖它就变高', () => {
    expect(ratioFromPointer(300, 100, 800)).toBeCloseTo(0.25, 5);
    expect(ratioFromPointer(700, 100, 800)).toBeCloseTo(0.75, 5);
    expect(ratioFromPointer(0, 0, 0)).toBe(0.5);
  });
});
