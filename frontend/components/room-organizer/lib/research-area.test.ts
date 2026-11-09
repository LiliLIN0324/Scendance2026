// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupPlace } from './research-area';

vi.mock('./amap-script', async (importOriginal) => {
  const original = await importOriginal<typeof import('./amap-script')>();
  return { ...original, loadAmapScript: vi.fn().mockResolvedValue(undefined) };
});

let nextLocation: unknown;
let nextStatus = 'complete';
let throwSearch = false;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_AMAP_KEY', 'test-map-key');
  nextStatus = 'complete';
  throwSearch = false;
  window.AMap = {
    PlaceSearch: class {
      search(_query: string, callback: (status: string, result: unknown) => void) {
        if (throwSearch) throw new Error('mock SDK failure');
        callback(nextStatus, { poiList: { pois: [{ name: '测试地点', address: '虚构地址', location: nextLocation }] } });
      }
    },
  };
});

afterEach(() => { delete window.AMap; vi.unstubAllEnvs(); });

describe('lookupPlace 地图坐标校验', () => {
  it.each([
    ['缺失经度', { lat: 30 }],
    ['null 经度', { lng: null, lat: 30 }],
    ['空经度', { lng: '', lat: 30 }],
    ['空白纬度', { lng: 120, lat: '  ' }],
    ['布尔值', { lng: false, lat: 30 }],
    ['数组', { lng: [], lat: 30 }],
    ['十六进制字符串', { lng: '0x10', lat: 30 }],
    ['无效数字字符串', { lng: 'NaN', lat: 30 }],
    ['异常坐标访问', { get lng() { throw new Error('bad location'); }, lat: 30 }],
    ['无穷值', { lng: Infinity, lat: 30 }],
    ['经度超范围', { lng: 180.001, lat: 30 }],
    ['纬度超范围', { lng: 120, lat: -90.001 }],
  ])('拒绝 %s，不返回场地', async (_label, location) => {
    nextLocation = location;
    await expect(lookupPlace('测试地点')).resolves.toBeNull();
  });

  it.each([
    [{ lng: 0, lat: 0 }, { lng: 0, lat: 0 }],
    [{ lng: ' 120.125 ', lat: '30.5' }, { lng: 120.125, lat: 30.5 }],
    [{ lng: '-180', lat: '90' }, { lng: -180, lat: 90 }],
  ])('接受真实有效坐标 %j', async (location, expected) => {
    nextLocation = location;
    await expect(lookupPlace('测试地点')).resolves.toMatchObject(expected);
  });

  it('SDK 搜索异常时返回空结果', async () => {
    throwSearch = true;
    await expect(lookupPlace('测试地点')).resolves.toBeNull();
  });

  it('SDK 返回非成功状态时不产生场地', async () => {
    nextStatus = 'error';
    nextLocation = { lng: 0, lat: 0 };
    await expect(lookupPlace('测试地点')).resolves.toBeNull();
  });
});
