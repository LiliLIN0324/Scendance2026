import { describe, expect, it, vi } from 'vitest';
import {
  handlePlaceShape,
  highwayLineStage,
  isDisplayablePlaceShape,
  isPersistablePlaceShape,
  shapeNameCandidates,
  spatialAreaStage,
} from '../functions/api/place-shape.ts';

/**
 * 「点哪儿框哪儿」核心逻辑单测（2026-11-13）：合成 Overpass 响应验证
 * 空间命中的闭合过滤 / 包含判定 / 同名优先 / 最小面优先，以及道路线型兜底。
 * fake fetchImpl 无视查询内容直接回固定 elements——只测解析与排序，不测查询构造。
 */
function fakeOverpass(elements: unknown[]): typeof fetch {
  return (async () => new Response(JSON.stringify({ elements }), { status: 200 })) as unknown as typeof fetch;
}

/** 闭合矩形面要素（OSM way，首尾同点）。 */
function rect(id: number, lngC: number, latC: number, span: number, name?: string) {
  const h = span / 2;
  return {
    type: 'way',
    id,
    geometry: [
      { lon: lngC - h, lat: latC - h },
      { lon: lngC + h, lat: latC - h },
      { lon: lngC + h, lat: latC + h },
      { lon: lngC - h, lat: latC + h },
      { lon: lngC - h, lat: latC - h },
    ],
    tags: name ? { name } : {},
  };
}

/** 开放折线（道路，首尾不同点）。 */
function line(id: number, points: { lon: number; lat: number }[], name?: string) {
  return { type: 'way', id, geometry: points, tags: name ? { name } : {} };
}

/** GCJ 点击点（画布坐标系）。合成面以 WGS84 给出、足够大，GCJ 偏移不改变包含关系。 */
const NEAR = { lng: 120.163, lat: 30.249 };

describe('shared place shape inventory', () => {
  const env = { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' };
  const stocked = {
    id: 'osm:W42', name: '浙江展览馆', kind: 'area', bounds: [120.16, 30.24, 120.17, 30.25],
    polygon: [[120.16, 30.24], [120.17, 30.24], [120.17, 30.25], [120.16, 30.25]],
  };
  it('returns a matching stored footprint before calling the map providers', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json([stocked]));
    const params = new URLSearchParams({ name: '浙江展览馆 | 杭州', near: '120.163,30.249' });
    const response = await handlePlaceShape(new Request(`https://example.test/api/place-shape?${params}`), fetchImpl, env);
    expect(await response.json()).toEqual({ shape: stocked });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0]!;
    expect(new URL(String(input)).searchParams.get('name_norm')).toBe('eq.浙江展览馆');
    expect(init?.headers).toEqual({ apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
  });

  it.each([
    ['unavailable inventory', () => new Response(null, { status: 503 })],
    ['a mismatched alias', () => Response.json([stocked])],
    ['an invalid footprint', () => Response.json([{ ...stocked, name: '库存测试地点', kind: 'line' }])],
    ['a distant footprint', () => Response.json([{ ...stocked, name: '库存测试地点' }])],
  ] as const)('falls back on %s', async (_label, stockReply) => {
    const fetchImpl = vi.fn<typeof fetch>(async input => String(input).includes('/rest/v1/place_shapes')
      ? stockReply() : Response.json({ elements: [], features: [] }));
    const params = new URLSearchParams({ name: '库存测试地点', near: '121.47,31.23' });
    const response = await handlePlaceShape(new Request(`https://example.test/api/place-shape?${params}`), fetchImpl, env);
    expect(await response.json()).toEqual({ shape: null });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('overpass'))).toBe(true);
  });
});

describe('spatialAreaStage（空间命中：点哪儿框哪儿）', () => {
  // 注意 GCJ 偏移：GCJ 点击点 (120.163, 30.249) 对应的 WGS 位置约 (120.1583, 30.2514)，
  // 合成面必须罩住这个 WGS 点（服务端会把面从 WGS 转到 GCJ 再做包含判定）。
  const bigNamed = rect(1, 120.164, 30.2485, 0.02, '大楼');
  const smallUnnamed = rect(2, 120.1583, 30.2514, 0.006);

  it('面要素包含点击点才入围；同名候选优先于更小的面', async () => {
    const shape = await spatialAreaStage('大楼', NEAR, fakeOverpass([bigNamed, smallUnnamed]));
    expect(shape).not.toBeNull();
    expect(shape!.name).toBe('大楼'); // 选了同名的大面，不是更小的无名面
    expect(shape!.polygon.length).toBeGreaterThanOrEqual(3);
  });

  it('无同名候选时取「包含点击点的最小的面」（点中的那个建筑）', async () => {
    const shape = await spatialAreaStage('不存在的地方', NEAR, fakeOverpass([bigNamed, smallUnnamed]));
    expect(shape).not.toBeNull();
    expect(shape!.id).toBe('osm:W2'); // 更小的无名面胜出
  });

  it('开放折线（道路）不算面候选：只有折线时空间命中回 null', async () => {
    const road = line(9, [
      { lon: 120.15, lat: 30.249 },
      { lon: 120.175, lat: 30.249 },
    ], '延安路');
    const shape = await spatialAreaStage('延安路', NEAR, fakeOverpass([road]));
    expect(shape).toBeNull();
  });

  it('不包含点击点的面被剔除', async () => {
    const far = rect(3, 120.3, 30.4, 0.012, '远处楼');
    const shape = await spatialAreaStage('远处楼', NEAR, fakeOverpass([far]));
    expect(shape).toBeNull();
  });
});

describe('highwayLineStage（道路线型兜底）', () => {
  it('点击点附近的道路段 → kind=line 的开放折线选区', async () => {
    const road = line(7, [
      { lon: 120.15, lat: 30.249 },
      { lon: 120.163, lat: 30.2492 },
      { lon: 120.175, lat: 30.2494 },
    ], '延安路');
    const shape = await highwayLineStage(NEAR, '延安路', fakeOverpass([road]));
    expect(shape).not.toBeNull();
    expect(shape!.kind).toBe('line');
    expect(shape!.name).toBe('延安路');
    expect(shape!.polygon.length).toBeGreaterThanOrEqual(2);
    // 折线不闭合：首尾不同
    expect(shape!.polygon[0]).not.toEqual(shape!.polygon[shape!.polygon.length - 1]);
  });

  it('120m 内没有道路段 → null', async () => {
    const farRoad = line(8, [
      { lon: 120.4, lat: 30.4 },
      { lon: 120.41, lat: 30.41 },
    ]);
    const shape = await highwayLineStage(NEAR, '延安路', fakeOverpass([farRoad]));
    expect(shape).toBeNull();
  });

  it('名字门槛：查询与路名不互相包含 → null（点 in77 绝不给开元路）', async () => {
    const kaiyuan = line(10, [
      { lon: 120.162, lat: 30.249 },
      { lon: 120.166, lat: 30.2492 },
    ], '开元路');
    const unnamed = line(11, [
      { lon: 120.1625, lat: 30.2488 },
      { lon: 120.1655, lat: 30.2488 },
    ]);
    const shape = await highwayLineStage(NEAR, 'in77', fakeOverpass([kaiyuan, unnamed]));
    expect(shape).toBeNull();
  });
});

describe('isDisplayablePlaceShape / isPersistablePlaceShape（垃圾几何门槛）', () => {
  const in77 = {
    kind: 'area' as const,
    polygon: [[120.1603, 30.2562], [120.1604, 30.2528], [120.1633, 30.2529], [120.1632, 30.2561]] as [number, number][],
  };
  /** 杭州大厦式垃圾：3 点短折线，绝不能当占地或入库。 */
  const hangzhouMansionLine = {
    kind: 'line' as const,
    polygon: [[120.1630, 30.2700], [120.1631, 30.2701], [120.1632, 30.2700]] as [number, number][],
  };
  const longRoad = {
    name: '延安路',
    kind: 'line' as const,
    polygon: [[120.15, 30.249], [120.163, 30.2492], [120.175, 30.2494]] as [number, number][],
  };

  it('IN77 式四边形面是可信占地，可入库', () => {
    expect(isDisplayablePlaceShape(in77)).toBe(true);
    expect(isPersistablePlaceShape(in77)).toBe(true);
  });

  it('杭州大厦式 3 点 kind:line 既不可展示也不可入库', () => {
    expect(isDisplayablePlaceShape(hangzhouMansionLine)).toBe(false);
    expect(isPersistablePlaceShape(hangzhouMansionLine)).toBe(false);
  });

  it('足够长的道路折线可展示（点道路画线），但绝不入库、不算占地轮廓', () => {
    expect(isDisplayablePlaceShape(longRoad)).toBe(true);
    expect(isPersistablePlaceShape(longRoad)).toBe(false);
  });

  it('退化三点面不可展示；真实三角建筑不能因顶点少被误拒绝', () => {
    expect(isDisplayablePlaceShape({ kind: 'area', polygon: [[120.163, 30.27], [120.1631, 30.27], [120.1632, 30.27]] })).toBe(false);
    expect(isPersistablePlaceShape({ kind: 'area', polygon: [[120.163, 30.27], [120.164, 30.27], [120.163, 30.271]] })).toBe(true);
  });
});

describe('shapeNameCandidates（分段重试）', () => {
  it('整名优先（最长在前），再按 -·/空格 拆段去重', () => {
    expect(shapeNameCandidates('盐官古城-潮乐之城')).toEqual(['盐官古城-潮乐之城', '盐官古城', '潮乐之城']);
    expect(shapeNameCandidates('  湖滨银泰 in77  ')).toEqual(['湖滨银泰 in77', '湖滨银泰', 'in77']);
  });
});

describe('Photon失效时的具名Overpass回退', () => {
  it('轮换mail.ru/de镜像，way先于relation，具名面不被空间面的快返回抢走', async () => {
    const calls: { url: string; query: string }[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url); const query = new URLSearchParams(String(init?.body ?? '')).get('data') ?? '';
      calls.push({ url: target, query });
      if (target.includes('photon.')) return new Response('', { status: 503 });
      if (target.includes('maps.mail.ru')) return new Response('', { status: 503 });
      if (query.includes('way["name"')) return Response.json({ elements: [rect(191, 120.1583, 30.2514, 0.003, '回退测试甲楼')] });
      return Response.json({ elements: [] });
    }) as typeof fetch;
    const response = await handlePlaceShape(new Request('https://example.test/api/place-shape?name=回退测试甲楼&near=120.163,30.249'), fetchImpl);
    expect((await response.json()).shape.id).toBe('osm:W191');
    expect(calls.some(c => c.url.includes('maps.mail.ru'))).toBe(true);
    expect(calls.some(c => c.url.includes('overpass-api.de'))).toBe(true);
    expect(calls.some(c => c.query.includes('relation["name"'))).toBe(false);
    expect(calls.some(c => c.query.includes('["building"]'))).toBe(false);
  });
  it('way未命中才发relation；null不缓存一天，下次可恢复', async () => {
    const stages: string[] = [];
    const emptyFetch = (async (_url: unknown, init?: RequestInit) => {
      const query = new URLSearchParams(String(init?.body ?? '')).get('data') ?? '';
      if (query.includes('way["name"')) stages.push('way');
      if (query.includes('relation["name"')) stages.push('relation');
      return Response.json({ elements: [], features: [] });
    }) as typeof fetch;
    const request = () => new Request('https://example.test/api/place-shape?name=回退测试乙楼&near=120.163,30.249');
    const response = await handlePlaceShape(request(), emptyFetch); expect(await response.json()).toEqual({ shape: null }); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(stages.indexOf('way')).toBeLessThan(stages.indexOf('relation'));
    let attempts = 0;
    await handlePlaceShape(request(), (async () => { attempts += 1; return Response.json({ elements: [], features: [] }); }) as typeof fetch);
    expect(attempts).toBeGreaterThan(0);
  });
  it('长的杭州大厦三点line仍不是道路；自交面也不能入库', () => {
    expect(isDisplayablePlaceShape({ name: '杭州大厦', kind: 'line', polygon: [[120,30],[120.01,30],[120.02,30.01]] })).toBe(false);
    expect(isPersistablePlaceShape({ kind: 'area', polygon: [[120,30],[120.03,30.02],[120,30.03],[120.02,30]] })).toBe(false);
  });
});
