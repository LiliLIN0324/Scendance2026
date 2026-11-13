import { describe, expect, it } from 'vitest';
import {
  LEFT_STACK_CASCADE_OFFSET,
  LEFT_STACK_FLOAT_MARGIN,
  LEFT_STACK_FLOAT_MIN_HEIGHT,
  LEFT_STACK_FLOAT_MIN_WIDTH,
  LEFT_STACK_MAX_DETACHED,
  LEFT_STACK_RATIO_MAX,
  LEFT_STACK_RATIO_MIN,
  LEFT_STACK_STORAGE_KEY,
  clampFloatRect,
  clampRatio,
  defaultFloatRect,
  defaultLeftStackState,
  detachLeftStackPanel,
  dockBandFromRect,
  dockLeftStackPanel,
  isLeftStackDetached,
  normalizeLeftStackState,
  pointInDockBand,
  raiseLeftStackPanel,
  ratioFromPointer,
  readLeftStackState,
  swapLeftStackOrder,
  toggleLeftStackDetached,
  withLeftStackRatio,
  writeLeftStackState,
  type LeftStackState,
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
  it('默认户外在上、五五分，没有浮着的小窗，四张卡的独立小窗矩形都落在视口里', () => {
    const state = defaultLeftStackState(VIEWPORT);
    expect(state.first).toBe('outdoor');
    expect(state.ratio).toBe(0.5);
    expect(state.detached).toEqual([]);
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

  it('最多同时两枚独立小窗：第二枚入列，第三枚把最早弹出的那枚挤回栏内', () => {
    const first = detachLeftStackPanel(defaultLeftStackState(VIEWPORT), 'outdoor', VIEWPORT);
    expect(first.detached).toEqual(['outdoor']);
    expect(isLeftStackDetached(first, 'outdoor')).toBe(true);

    const second = detachLeftStackPanel(first, 'bingo', VIEWPORT);
    expect(second.detached).toEqual(['outdoor', 'bingo']);

    // 第三枚超出上限：队首 outdoor 被挤走，bingo 与新入列的 capture 留下。
    const third = detachLeftStackPanel(second, 'capture', VIEWPORT);
    expect(third.detached).toHaveLength(LEFT_STACK_MAX_DETACHED);
    expect(third.detached).toEqual(['bingo', 'capture']);
    expect(isLeftStackDetached(third, 'outdoor')).toBe(false);
  });

  it('新窗相对当前最上一枚级联错位，两枚标题条都露得出来', () => {
    const first = detachLeftStackPanel(defaultLeftStackState(VIEWPORT), 'outdoor', VIEWPORT);
    const second = detachLeftStackPanel(first, 'bingo', VIEWPORT);
    const top = first.rects.outdoor;
    const next = second.rects.bingo;
    expect(next.x).toBeGreaterThan(top.x);
    expect(next.y).toBeGreaterThan(top.y);
    expect(next.x - top.x).toBe(LEFT_STACK_CASCADE_OFFSET);
  });

  it('抬层级：点按小窗把它挪到队尾（最上层）；本来就在最上则幂等', () => {
    const state = detachLeftStackPanel(detachLeftStackPanel(defaultLeftStackState(VIEWPORT), 'outdoor', VIEWPORT), 'bingo', VIEWPORT);
    expect(state.detached).toEqual(['outdoor', 'bingo']);
    const raised = raiseLeftStackPanel(state, 'outdoor');
    expect(raised.detached).toEqual(['bingo', 'outdoor']);
    expect(raiseLeftStackPanel(raised, 'outdoor')).toBe(raised);
  });

  it('收回栏内：dock 只移除指定那枚，其他浮窗保留；本来就在栏内则幂等', () => {
    const state = detachLeftStackPanel(detachLeftStackPanel(defaultLeftStackState(VIEWPORT), 'outdoor', VIEWPORT), 'bingo', VIEWPORT);
    const docked = dockLeftStackPanel(state, 'outdoor');
    expect(docked.detached).toEqual(['bingo']);
    expect(dockLeftStackPanel(docked, 'chat')).toBe(docked);
  });

  it('toggle：浮着收回栏内，栏内抓成小窗', () => {
    const base = defaultLeftStackState(VIEWPORT);
    const detached = toggleLeftStackDetached(base, 'bingo', VIEWPORT);
    expect(detached.detached).toEqual(['bingo']);
    expect(toggleLeftStackDetached(detached, 'bingo', VIEWPORT).detached).toEqual([]);
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
    expect(fallback.detached).toEqual([]);
    expect(fallback.rects.outdoor).toEqual(defaultFloatRect('outdoor', VIEWPORT));
  });

  it('旧版单 id 存档迁移成数组；数组存档去重并截断到上限', () => {
    const legacy = normalizeLeftStackState({ order: 'bingo-first', ratio: 0.4, detached: 'bingo', rects: { outdoor: { x: 10, y: 20, width: 300, height: 400 }, bingo: { x: 10, y: 20, width: 300, height: 400 } } }, VIEWPORT);
    expect(legacy.first).toBe('bingo');
    expect(legacy.ratio).toBe(0.4);
    expect(legacy.detached).toEqual(['bingo']);
    expect(legacy.rects.outdoor).toEqual({ x: 10, y: 20, width: 300, height: 400 });
    expect(legacy.rects.capture).toEqual(defaultFloatRect('capture', VIEWPORT));
    expect(legacy.rects.chat).toEqual(defaultFloatRect('chat', VIEWPORT));

    const list = normalizeLeftStackState({ detached: ['chat', 'chat', 'capture', 'outdoor'] }, VIEWPORT);
    expect(list.detached).toEqual(['chat', 'capture']);
  });

  it('读写本地存储：坏 JSON 与空值都回落，好值原样回来', () => {
    const storage = fakeStorage();
    expect(readLeftStackState(storage, VIEWPORT)).toEqual(defaultLeftStackState(VIEWPORT));

    const custom: LeftStackState = { ...defaultLeftStackState(VIEWPORT), first: 'bingo', ratio: 0.32, detached: ['bingo'] };
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

describe('停靠吸附带 dockBandFromRect / pointInDockBand', () => {
  const OPEN_RECT = { left: 64, right: 384, top: 58, bottom: 750, width: 320, height: 692 };
  const COLLAPSED_RECT = { left: 64, right: 64, top: 0, bottom: 0, width: 0, height: 0 };

  it('栏体展开时吸附带就是列实体矩形', () => {
    const band = dockBandFromRect(OPEN_RECT, 320, 800);
    expect(band).toEqual({ left: 64, right: 384, top: 58, bottom: 750 });
  });

  it('全浮走栏体收成 0 宽时，沿轨边兜底出一条栏宽的吸附带，纵向铺满视口', () => {
    const band = dockBandFromRect(COLLAPSED_RECT, 320, 800);
    expect(band.left).toBe(64);
    expect(band.right).toBe(384);
    expect(band.top).toBe(0);
    expect(band.bottom).toBe(800);
  });

  it('拿不到列元素时回退到轨左缘 64px 起的兜底带', () => {
    const band = dockBandFromRect(null, 240, 720);
    expect(band.left).toBe(64);
    expect(band.right).toBe(64 + Math.max(240, 220));
    expect(band.bottom).toBe(720);
  });

  it('命中判定：带内（左缘留 4px、上下留 8px 容错）为真，越界为假', () => {
    const band = dockBandFromRect(OPEN_RECT, 320, 800);
    expect(pointInDockBand(band, 68, 100)).toBe(true);
    expect(pointInDockBand(band, 64, 100)).toBe(false);
    expect(pointInDockBand(band, 380, 50)).toBe(true);
    expect(pointInDockBand(band, 400, 100)).toBe(false);
    expect(pointInDockBand(band, 100, 50)).toBe(true);
    expect(pointInDockBand(band, 100, 40)).toBe(false);
  });
});
