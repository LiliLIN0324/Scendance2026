// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberAholoAsset } from './aholo-assets';
import { listScannedVenues } from './venue-scans';
import { MemoryStorage } from '@/lib/test-support-memory-storage';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = (month: number, date: number) => Date.UTC(2026, month - 1, date);

/** 2026-11-19 用户：「线上可以看到这种莫名其妙的形式。改掉。没有其他和我的区分。」 */
describe('真实场地列表的命名口径', () => {
  let mem: MemoryStorage;
  beforeEach(() => { mem = new MemoryStorage(); vi.stubGlobal('Storage', MemoryStorage); vi.stubGlobal('localStorage', mem); window.localStorage = mem; localStorage.clear(); });
  afterEach(() => { mem?.clear(); vi.unstubAllGlobals(); });

  it('一份列表装下所有扫描，名字里没有来源前缀与资产号', () => {
    rememberAholoAsset({ assetId: id(1), kind: 'spz', name: '云端高斯 48245ba8', bytes: 10, savedAt: day(11, 8) });
    rememberAholoAsset({ assetId: id(2), kind: 'spz', name: '本机高斯 6645e211', bytes: 10, savedAt: day(11, 6) });
    rememberAholoAsset({ assetId: id(3), kind: 'spz', name: '西湖 0233 · 标准档', bytes: 10, savedAt: day(11, 7) });

    const venues = listScannedVenues();
    expect(venues.map(venue => venue.name)).toEqual([
      '实景扫描 11/08',
      '西湖 0233 · 标准档',
      '实景扫描 11/06',
    ]);
    // 新到旧排；尺寸缺失就说没有，不编数字。
    expect(venues.map(venue => venue.assetId)).toEqual([id(1), id(3), id(2)]);
    expect(venues.every(venue => !/本机|云端|高斯/.test(venue.name))).toBe(true);
  });

  it('同一天的两份扫描按出现顺序加序号，不重名', () => {
    rememberAholoAsset({ assetId: id(4), kind: 'spz', name: '本机高斯 3358a0af', bytes: 10, savedAt: day(11, 5) });
    rememberAholoAsset({ assetId: id(5), kind: 'ply', name: '本机高斯 3bac508e', bytes: 10, savedAt: day(11, 5) });
    expect(listScannedVenues().map(venue => venue.name)).toEqual(['实景扫描 11/05', '实景扫描 11/05 · 2']);
  });

  it('物件 GLB 不进真实场地列表', () => {
    rememberAholoAsset({ assetId: id(6), kind: 'glb', name: '云端高斯 9587c51d', bytes: 10, savedAt: day(11, 4) });
    expect(listScannedVenues()).toEqual([]);
  });

  it('已经换成日期名的注册表记录再来一遍不会改坏（幂等）', () => {
    rememberAholoAsset({ assetId: id(7), kind: 'spz', name: '实景扫描 11/08', bytes: 10, savedAt: day(11, 8) });
    expect(listScannedVenues()[0].name).toBe('实景扫描 11/08');
  });
});
