import { describe, expect, it, vi } from 'vitest';
import { fetchPlaceShape, parseAreaPayload, placeAreaUrl, searchAreas } from './place-area';

/** Map 版 Storage 不需要；这里只测纯解析与带 mock fetch 的网络层。 */

describe('parseAreaPayload（行政区选区解析）', () => {
  it('正常载荷 → PlaceArea（bounds 缺省时由多边形兜底）', () => {
    const areas = parseAreaPayload({
      areas: [
        {
          id: '156330106',
          name: '西湖区',
          level: '区县',
          lng: 120.125,
          lat: 30.261,
          bounds: [120.0, 30.1, 120.2, 30.4],
          polygon: [[120.0, 30.1], [120.2, 30.1], [120.2, 30.4], [120.0, 30.4]],
        },
      ],
    });
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({ id: '156330106', name: '西湖区', level: '区县' });
    expect(areas[0]!.bounds).toEqual([120.0, 30.1, 120.2, 30.4]);
  });

  it('脏数据逐条丢弃：非数组 polygon / 顶点非法 / 名字为空 / 少于 3 点', () => {
    const areas = parseAreaPayload({
      areas: [
        null,
        { id: 'x', name: '坏顶点', polygon: [[1, 'NaN'], [2, 2], [3, 3]] },
        { id: 'y', name: '', polygon: [[1, 1], [2, 2], [3, 3]] },
        { id: 'z', name: '点太少', polygon: [[1, 1], [2, 2]] },
      ],
    });
    expect(areas).toHaveLength(0);
  });

  it('bounds 缺失时用 polygon 外框兜底', () => {
    const areas = parseAreaPayload({
      areas: [{ id: 'b1', name: '某某园', polygon: [[100.1, 20.2], [100.3, 20.2], [100.2, 20.5]] }],
    });
    expect(areas).toHaveLength(1);
    const [west, south, east, north] = areas[0]!.bounds;
    expect(west).toBeCloseTo(100.1, 6);
    expect(south).toBeCloseTo(20.2, 6);
    expect(east).toBeCloseTo(100.3, 6);
    expect(north).toBeCloseTo(20.5, 6);
  });
});

describe('placeAreaUrl / searchAreas（本地代理契约）', () => {
  it('本机走 3199，线上走同源，带 near 与 limit', () => {
    const near = { lng: 120.146037, lat: 30.252192 };
    expect(placeAreaUrl('西湖区', near, 3, true)).toContain('http://127.0.0.1:3199/api/tdt-area?');
    expect(placeAreaUrl('西湖区', near, 3, true)).toContain('near=120.146037%2C30.252192');
    expect(placeAreaUrl('西湖区', null, 3, false)).toBe('/api/tdt-area?keywords=%E8%A5%BF%E6%B9%96%E5%8C%BA&limit=3');
  });

  it('searchAreas 同名行政区去重（服务端按 near 排序后取首个）', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      areas: [
        { id: '1', name: '西湖区', level: '区县', polygon: [[120, 30], [120.1, 30], [120, 30.1]] },
        { id: '2', name: '西湖区', level: '区县', polygon: [[115.8, 28.6], [115.9, 28.6], [115.8, 28.7]] },
        { id: '3', name: '东西湖区', level: '区县', polygon: [[114.1, 30.6], [114.2, 30.6], [114.1, 30.7]] },
      ],
    }), { status: 200 }));
    const areas = await searchAreas('西湖区', { local: true, fetchImpl });
    expect(areas.map(a => a.name)).toEqual(['西湖区', '东西湖区']);
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain('127.0.0.1:3199/api/tdt-area');
  });

  it('网络失败回空数组，不抛错', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('net down'); });
    await expect(searchAreas('西湖区', { local: true, fetchImpl })).resolves.toEqual([]);
  });
});

describe('fetchPlaceShape（POI 真实轮廓）', () => {
  it('拿到 shape → PlaceArea（level 标「占地范围」）', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      shape: {
        id: 'osm:W1110196946',
        name: '湖滨银泰·IN77',
        polygon: [[120.1603, 30.2562], [120.1604, 30.2528], [120.1633, 30.2529], [120.1632, 30.2561]],
        bounds: [120.1603, 30.2528, 120.1633, 30.2562],
      },
    }), { status: 200 }));
    const shape = await fetchPlaceShape('in77', { local: true, fetchImpl });
    expect(shape).not.toBeNull();
    expect(shape!.level).toBe('占地范围');
    expect(shape!.polygon).toHaveLength(4);
    expect(shape!.name).toBe('湖滨银泰·IN77');
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain('127.0.0.1:3199/api/place-shape');
    expect(url).toContain('name=in77');
  });

  it('shape 为 null（OSM 里没有面）→ 静默 null', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ shape: null }), { status: 200 }));
    await expect(fetchPlaceShape('某公交站', { local: true, fetchImpl })).resolves.toBeNull();
  });

  it('请求失败 → null 不抛错；超短关键词直接 null 不发请求', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('timeout'); });
    // cache:false 绕开 localStorage（前面成功用例已把 in77 写进缓存，这里必须真发请求）
    await expect(fetchPlaceShape('in77', { local: true, fetchImpl, cache: false })).resolves.toBeNull();
    await expect(fetchPlaceShape('好', { local: true, fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 只有 in77 发了请求
  });
});