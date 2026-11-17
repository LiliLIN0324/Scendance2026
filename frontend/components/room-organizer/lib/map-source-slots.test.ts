// @vitest-environment jsdom
/**
 * 2026-11-17 用户指令：地图详情面板「上排四格 + 下方按类型分组、可置顶」。
 *
 * 这里测槽位 store 的语义，不测像素：
 * - 缺省必须是用户点名的顺序：高德卫星 / 高德街道 / Carto 白底；
 * - 「置顶」只能进同类槽位（街道→街道格、卫星→卫星格、视觉→单色格），
 *   否则上排「卫星」格里会被塞进街道图，语义就废了；
 * - 脏 localStorage / 跨用途残值一律回落缺省，不污染上排。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_SLOTS,
  MAP_SLOT_STORAGE_KEY,
  pinMapSource,
  readMapSlots,
  resetMapSlotsCacheForTest,
  slotRoleForSource,
  subscribeMapSlots,
  writeMapSlot,
} from './map-source-slots';

beforeEach(() => {
  localStorage.clear();
  resetMapSlotsCacheForTest();
});

describe('地图槽位缺省', () => {
  it('上排缺省 = 高德卫星 / 高德街道 / Carto 白底', () => {
    expect(readMapSlots()).toEqual({
      satellite: 'amap-satellite',
      streets: 'amap-streets',
      tone: 'carto-light',
    });
    expect(DEFAULT_MAP_SLOTS).toEqual(readMapSlots());
  });

  it('同一快照恒等（useSyncExternalStore 不能每次给新对象）', () => {
    expect(readMapSlots()).toBe(readMapSlots());
  });
});

describe('置顶：只能进同类槽位', () => {
  it('街道源进街道格：天地图矢量置顶后替换高德街道', () => {
    expect(pinMapSource('vec')).toBe('streets');
    expect(readMapSlots().streets).toBe('vec');
    // 另外两格不动。
    expect(readMapSlots().satellite).toBe('amap-satellite');
    expect(readMapSlots().tone).toBe('carto-light');
  });

  it('卫星源进卫星格：全球卫星 / 天地图影像都能替换高德卫星', () => {
    expect(pinMapSource('esri-satellite')).toBe('satellite');
    expect(readMapSlots().satellite).toBe('esri-satellite');
    expect(pinMapSource('img')).toBe('satellite');
    expect(readMapSlots().satellite).toBe('img');
  });

  it('视觉源进单色格：Carto 深色替换白底缺省', () => {
    expect(pinMapSource('carto-dark')).toBe('tone');
    expect(readMapSlots().tone).toBe('carto-dark');
  });

  it('跨用途写入被拒绝，不改任何一格', () => {
    const before = readMapSlots();
    expect(writeMapSlot('satellite', 'amap-streets')).toBe(false);
    expect(writeMapSlot('tone', 'esri-satellite')).toBe(false);
    expect(readMapSlots()).toBe(before);
  });

  it('每个图源都有明确用途（面板分组与槽位一一对应）', () => {
    expect(slotRoleForSource('amap-streets-labels')).toBe('streets');
    expect(slotRoleForSource('osm')).toBe('streets');
    expect(slotRoleForSource('carto-light')).toBe('tone');
    expect(slotRoleForSource('amap-satellite')).toBe('satellite');
  });
});

describe('持久化与脏数据', () => {
  it('置顶写进 localStorage，重新读（清缓存）仍生效', () => {
    pinMapSource('carto-dark');
    expect(JSON.parse(localStorage.getItem(MAP_SLOT_STORAGE_KEY)!).tone).toBe('carto-dark');
    resetMapSlotsCacheForTest();
    expect(readMapSlots().tone).toBe('carto-dark');
  });

  it('跨用途残值（街道源被手改进卫星格）回落缺省，不污染上排语义', () => {
    localStorage.setItem(
      MAP_SLOT_STORAGE_KEY,
      JSON.stringify({ satellite: 'amap-streets', streets: 'osm', tone: 'carto-dark' }),
    );
    const slots = readMapSlots();
    expect(slots.satellite).toBe('amap-satellite');
    expect(slots.streets).toBe('osm');
    expect(slots.tone).toBe('carto-dark');
  });

  it('坏 JSON / 未知 id 一律回落缺省', () => {
    localStorage.setItem(MAP_SLOT_STORAGE_KEY, '{not json');
    expect(readMapSlots()).toEqual(DEFAULT_MAP_SLOTS);

    resetMapSlotsCacheForTest();
    localStorage.setItem(MAP_SLOT_STORAGE_KEY, JSON.stringify({ satellite: 'fake-source' }));
    expect(readMapSlots()).toEqual(DEFAULT_MAP_SLOTS);
  });

  it('真的换了槽位才通知订阅者（重复置顶不空转）', () => {
    let calls = 0;
    const off = subscribeMapSlots(() => {
      calls += 1;
    });
    pinMapSource('amap-satellite'); // 已是缺省，不通知
    expect(calls).toBe(0);
    pinMapSource('esri-satellite');
    expect(calls).toBe(1);
    off();
  });
});
