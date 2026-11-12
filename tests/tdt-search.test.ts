import { describe, expect, it } from 'vitest';
import { handleTdtSearch, parseCenter } from '../functions/api/tdt-search.ts';

type Call = { kind: 'geocoder' | 'search'; bound?: string; keyWord?: string };

/** 假上游：geocoder 按 map 回点，v2 搜索只在杭州框内回 POI（模拟天地图的地理限制）。 */
function fakeTdt(options: {
  geocoder?: { lon: string; lat: string; score: number; level: string; keyWord?: string };
  pois?: { name: string; address: string; lonlat: string }[];
  hits?: (bound: string) => boolean;
}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname.endsWith('/geocoder')) {
      const ds = JSON.parse(url.searchParams.get('ds') ?? '{}');
      calls.push({ kind: 'geocoder', keyWord: ds.keyWord });
      if (!options.geocoder) return new Response('{"msg":"no"}', { status: 200 });
      return new Response(JSON.stringify({ msg: 'ok', location: options.geocoder }), { status: 200 });
    }
    const postStr = JSON.parse(url.searchParams.get('postStr') ?? '{}');
    calls.push({ kind: 'search', bound: postStr.mapBound, keyWord: postStr.keyWord });
    const inRange = options.hits ? options.hits(postStr.mapBound) : false;
    const pois = inRange ? (options.pois ?? []) : [];
    return new Response(JSON.stringify({ count: pois.length, pois }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ENV = { TDT_KEY: 'test-key' };
const HANGZHOU = '120.160000,30.253000';
/** 「湖滨银泰 in77」在杭州；in77 的 geocoder 却把点塞到大同。 */
const IN77_POIS = [{ name: 'in77', address: '解放路', lonlat: '120.165,30.256' }];
const nearHangzhou = (bound: string): boolean => {
  const [west, south, east, north] = bound.split(',').map(Number);
  return west < 120.16 && east > 120.16 && south < 30.253 && north > 30.253;
};

function request(query: string): Request {
  return new Request(`https://example.com/api/tdt-search?${query}`);
}

describe('parseCenter', () => {
  it('认 "lng,lat"，坏值一律回 null', () => {
    expect(parseCenter('120.16,30.25')).toEqual({ lng: 120.16, lat: 30.25 });
    expect(parseCenter(null)).toBeNull();
    expect(parseCenter('abc')).toBeNull();
    expect(parseCenter('200,30')).toBeNull();
  });
});

describe('handleTdtSearch：地理搜索广度', () => {
  it('geocoder 低分（in77 → 大同）时不拿它当中心，围着 center 提示搜就能命中湖滨银泰', async () => {
    const { calls, fetchImpl } = fakeTdt({
      geocoder: { lon: '113.29551', lat: '40.07112', score: 0, level: '区县及以上级行政区划' },
      pois: IN77_POIS,
      hits: nearHangzhou,
    });
    const response = await handleTdtSearch(
      request(`keywords=in77&limit=6&center=${HANGZHOU}`),
      ENV,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { places: { name: string; lng: number }[] };
    expect(body.places[0].name).toBe('in77');
    expect(body.places[0].lng).toBeGreaterThan(120);
    // 所有搜索都围着杭州（大同那一片一次都没搜）。
    const searches = calls.filter(call => call.kind === 'search');
    expect(searches.length).toBeGreaterThan(0);
    for (const search of searches) {
      expect(search.bound?.startsWith('11')).toBe(false);
    }
  });

  it('有锚点时先打最窄一档，命中同名 POI 就不再问 geocoder（省掉约 2s）', async () => {
    const { calls, fetchImpl } = fakeTdt({
      geocoder: { lon: '113.29551', lat: '40.07112', score: 0, level: '区县及以上级行政区划' },
      pois: IN77_POIS,
      hits: nearHangzhou,
    });
    const response = await handleTdtSearch(
      request(`keywords=in77&limit=6&center=${HANGZHOU}`),
      ENV,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    expect(calls.filter(call => call.kind === 'geocoder')).toHaveLength(0);
    expect(calls.filter(call => call.kind === 'search')).toHaveLength(1);
  });

  it('geocoder 不可信又没给 center 时回 404，而不是把大同那个假点当建议', async () => {
    const { fetchImpl } = fakeTdt({
      geocoder: { lon: '113.29551', lat: '40.07112', score: 0, level: '区县及以上级行政区划' },
      pois: IN77_POIS,
      hits: nearHangzhou,
    });
    const response = await handleTdtSearch(request('keywords=in77&limit=6'), ENV, fetchImpl);
    expect(response.status).toBe(404);
  });

  it('行政区级但低分（score 42 的乱码指向上海）也算不可信，回 404', async () => {
    const { fetchImpl } = fakeTdt({
      geocoder: { lon: '121.45854', lat: '31.27625', score: 42, level: '区县及以上级行政区划', keyWord: '查无此地xyz' },
      pois: IN77_POIS,
      hits: nearHangzhou,
    });
    const response = await handleTdtSearch(request('keywords=查无此地xyz&limit=6'), ENV, fetchImpl);
    expect(response.status).toBe(404);
  });

  it('搜行政区时先按 geocoder 中心搜（搜「杭州」要的是那座城，不是名字带杭州的店）', async () => {
    const { calls, fetchImpl } = fakeTdt({
      geocoder: { lon: '120.205944', lat: '30.248572', score: 100, level: '区县及以上级行政区划', keyWord: '杭州' },
      pois: [{ name: '杭州市', address: '', lonlat: '120.205944,30.248572' }],
      // 只有围着 geocoder 中心（120.2059）的那一档才有结果；画布中心 120.16 附近搜不到。
      hits: bound => {
        const [west, , east] = bound.split(',').map(Number);
        return (west + east) / 2 > 120.19;
      },
    });
    const response = await handleTdtSearch(
      request(`keywords=杭州&limit=6&center=${HANGZHOU}`),
      ENV,
      fetchImpl,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { places: { name: string }[] };
    expect(body.places[0].name).toBe('杭州市');
    const winning = calls.filter(call => call.kind === 'search').some(call => {
      const [west, , east] = (call.bound ?? '').split(',').map(Number);
      return east > 120.36 && west > 120.02;
    });
    expect(winning).toBe(true);
  });

  it('可信中心搜不到时，geocoder 点仍兜底一条「至少能落钉」的建议', async () => {
    const { fetchImpl } = fakeTdt({
      geocoder: { lon: '120.146169', lat: '30.252176', score: 99, level: '兴趣点', keyWord: '平湖秋月' },
      pois: [],
      hits: () => false,
    });
    const response = await handleTdtSearch(request('keywords=平湖秋月&limit=6'), ENV, fetchImpl);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { places: { name: string; address: string }[] };
    expect(body.places).toHaveLength(1);
    expect(body.places[0].name).toBe('平湖秋月');
    expect(body.places[0].address).toContain('天地图定位');
  });
});