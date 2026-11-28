import { describe, expect, it, vi } from 'vitest';
import {
  aoiRowFromGeo,
  ingestBaiduAoi,
  isSimpleRing,
  mcToGcj,
  parseBaiduGeo,
  ringAreaM2,
} from '../functions/api/baidu-aoi.ts';
import { handlePlaceShape } from '../functions/api/place-shape.ts';

/**
 * 搜索兜底补库（2026-11-27 用户指令「每次搜索搜到的地址，爬到百度地址就存进 supabase」）。
 *
 * 这里钉住四件事：解析不吞错、换算不跑偏、质量门不放垃圾入库、补库绝不覆盖已有行。
 * 全部用合成响应，不访问百度与 Supabase。
 */

/** 按真实格式拼一个 MC 方形环（不闭合，模拟百度 geo）：`4|w,s;e,n|<prefix>x1,y1,x2,y2…`。 */
function squareGeo(centerX: number, centerY: number, sideM: number, ringPrefix = '1-', extraRings = ''): string {
  const h = sideM / 2;
  const corners = [
    [centerX - h, centerY - h],
    [centerX + h, centerY - h],
    [centerX + h, centerY + h],
    [centerX - h, centerY + h],
  ];
  const body = corners.map(([x, y]) => `${x},${y}`).join(',');
  return `4|${centerX - h},${centerY - h};${centerX + h},${centerY + h}|${ringPrefix}${body}${extraRings}`;
}

const QINGSHANHU_MC = { x: 13_332_988.41, y: 3_515_153.77 };

describe('parseBaiduGeo', () => {
  it('解析单环：去掉环前缀、按 x,y 成对读点', () => {
    const geo = squareGeo(13_333_000, 3_515_200, 200);
    const parsed = parseBaiduGeo(geo);
    expect(parsed?.type).toBe(4);
    expect(parsed?.rings).toHaveLength(1);
    expect(parsed?.rings[0]).toHaveLength(4);
    expect(parsed?.rings[0]?.[0]).toEqual({ x: 13_332_900, y: 3_515_100 });
  });

  it('多环（外轮廓 + 内洞）都保留，交给上层挑最大的', () => {
    const outer = squareGeo(13_333_000, 3_515_200, 400, '1-');
    const inner = '2-13332950,3515150,13333050,3515150,13333050,3515250';
    const parsed = parseBaiduGeo(`${outer};${inner}`);
    expect(parsed?.rings.length).toBe(2);
  });

  it('垃圾输入一律 null：缺段、非数字、点太少', () => {
    expect(parseBaiduGeo('')).toBeNull();
    expect(parseBaiduGeo('4|1,2')).toBeNull();
    expect(parseBaiduGeo('4|0,0;1,1|1-a,b,c,d,e,f')).toBeNull();
    expect(parseBaiduGeo('4|0,0;1,1|1-1,1,2,2')).toBeNull();
  });
});

describe('mcToGcj（控制点标定）', () => {
  it('杭州植物园的百度 MC 点换算回 GCJ，偏差 < 60 m', () => {
    const gcj = mcToGcj(13_372_266.26, 3_515_219.35);
    const truth = { lng: 120.117009, lat: 30.252910 };
    const dx = (gcj.lng - truth.lng) * Math.cos((30.25 * Math.PI) / 180) * 111320;
    const dy = (gcj.lat - truth.lat) * 110540;
    expect(Math.hypot(dx, dy)).toBeLessThan(60);
  });

  it('青山湖水上森林点位落在杭州临安（量级校验，防常数写错）', () => {
    const gcj = mcToGcj(QINGSHANHU_MC.x, QINGSHANHU_MC.y);
    expect(gcj.lng).toBeGreaterThan(119.7);
    expect(gcj.lng).toBeLessThan(119.85);
    expect(gcj.lat).toBeGreaterThan(30.2);
    expect(gcj.lat).toBeLessThan(30.3);
  });
});

describe('aoiRowFromGeo（质量门 + 入库行）', () => {
  it('正常 AOI → 行：id 带百度 uid、点列不闭合、center/bounds/pts 齐全', () => {
    const row = aoiRowFromGeo(squareGeo(QINGSHANHU_MC.x, QINGSHANHU_MC.y, 300), '青山湖水上森林', 'uid-42');
    expect(row).not.toBeNull();
    expect(row!.id).toBe('baidu:uid-42');
    expect(row!.name_norm).toBe('青山湖水上森林');
    expect(row!.kind).toBe('area');
    expect(row!.pts).toBe(row!.polygon.length);
    expect(row!.polygon.length).toBe(4); // 与库内既有行同口径：不闭合
    expect(row!.polygon[0]).not.toEqual(row!.polygon[3]);
    expect(row!.bounds[0]).toBeLessThan(row!.bounds[2]);
    expect(row!.center_lng).toBeGreaterThan(119.7);
  });

  it('百度若给闭合环，入库时去掉重复的首尾点', () => {
    const closed = `${squareGeo(13_333_000, 3_515_200, 300)},13332850,3515050`;
    expect(parseBaiduGeo(closed)?.rings[0]).toHaveLength(5);
    expect(aoiRowFromGeo(closed, '闭合输入', 'uid-5')?.polygon).toHaveLength(4);
  });

  it('太小（亭子/门牌）与太大（区域级地块）都不入库', () => {
    expect(aoiRowFromGeo(squareGeo(QINGSHANHU_MC.x, QINGSHANHU_MC.y, 5), '小点', 'u1')).toBeNull();
    expect(aoiRowFromGeo(squareGeo(QINGSHANHU_MC.x, QINGSHANHU_MC.y, 3000), '大区域', 'u2')).toBeNull();
  });

  it('自交的蝴蝶结不能入库', () => {
    const bowtie = '4|0,0;1,1|1-13333000,3515000,13333300,3515300,13333300,3515000,13333000,3515300';    expect(aoiRowFromGeo(bowtie, '自交', 'u3')).toBeNull();
  });

  it('名字归一与服务端一致（去空格标点）', () => {
    const row = aoiRowFromGeo(squareGeo(QINGSHANHU_MC.x, QINGSHANHU_MC.y, 300), '青山湖·水上森林', 'u4');
    expect(row?.name_norm).toBe('青山湖水上森林');
  });
});

describe('isSimpleRing / ringAreaM2', () => {
  it('矩形简单环通过，重复点与自交不通过', () => {
    expect(isSimpleRing([[120, 30], [120.1, 30], [120.1, 30.1], [120, 30.1]])).toBe(true);
    expect(isSimpleRing([[120, 30], [120, 30], [120.1, 30.1]])).toBe(false);
    expect(isSimpleRing([[0, 0], [1, 1], [1, 0], [0, 1]])).toBe(false);
  });

  it('面积：0.001° × 0.001° 在杭州纬度约 9,600 ㎡', () => {
    const area = ringAreaM2([[120, 30], [120.001, 30], [120.001, 30.001], [120, 30.001]]);
    expect(area).toBeGreaterThan(8_000);
    expect(area).toBeLessThan(11_000);
  });
});

/** 合成一个按 URL 路由的 fetch：su / ext / supabase 读 / supabase 写各管一段。 */
function routedFetch(options: { existing?: unknown[]; writeOk?: boolean }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('map.baidu.com/su')) {
      return Response.json({ s: ['杭州市$临安区$$青山湖水上森林$179$uid-42$杭州市$临安区$'] });
    }
    if (url.includes('qt=ext')) {
      return Response.json({ content: { geo: squareGeo(QINGSHANHU_MC.x, QINGSHANHU_MC.y, 300) } });
    }
    if (url.includes('/rest/v1/place_shapes') && (init?.method ?? 'GET') === 'GET') {
      return Response.json(options.existing ?? []);
    }
    if (url.includes('/rest/v1/place_shapes')) {
      return new Response('', { status: options.writeOk === false ? 500 : 201 });
    }
    return new Response('', { status: 404 });
  });
}

describe('ingestBaiduAoi', () => {
  it('没有 service_role key：一条请求都不发，返回 skipped-no-key', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await ingestBaiduAoi('青山湖水上森林', { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk' }, fetchImpl);
    expect(result).toBe('skipped-no-key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('库里没有同名行：抓 AOI 并写入，行内带 baidu uid 与点数', async () => {
    const fetchImpl = routedFetch({ existing: [] });
    const result = await ingestBaiduAoi('青山湖水上森林', {
      SUPABASE_SERVICE_ROLE_KEY: 'eyJservice',
      SUPABASE_URL: 'https://example.supabase.co',
    }, fetchImpl);
    expect(result).toBe('written');
    const writeCall = fetchImpl.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(writeCall).toBeTruthy();
    const body = JSON.parse(String(writeCall![1]!.body)) as { id: string; pts: number; name: string };
    expect(body.id).toBe('baidu:uid-42');
    expect(body.name).toBe('青山湖水上森林');
    expect(body.pts).toBeGreaterThan(3);
  });

  it('库里已有同名行：不写，返回 skipped-existing（保护人工描边）', async () => {
    const fetchImpl = routedFetch({ existing: [{ name: '已有场地' }] });
    const result = await ingestBaiduAoi('已有场地', {
      SUPABASE_SERVICE_ROLE_KEY: 'eyJservice',
      SUPABASE_URL: 'https://example.supabase.co',
    }, fetchImpl);
    expect(result).toBe('skipped-existing');
    expect(fetchImpl.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('同一场地 10 分钟内重复触发：第二次直接 skipped-recent，不再打百度', async () => {
    const env = { SUPABASE_SERVICE_ROLE_KEY: 'eyJservice', SUPABASE_URL: 'https://example.supabase.co' };
    const first = routedFetch({ existing: [] });
    const firstResult = await ingestBaiduAoi('去重验证场地', env, first);
    expect(firstResult).toBe('written');
    const second = routedFetch({ existing: [] });
    const result = await ingestBaiduAoi('去重验证场地', env, second);
    expect(result).toBe('skipped-recent');
    expect(second).not.toHaveBeenCalled();
  });

  it('百度只给点没有 AOI：返回 missed，不写库', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('map.baidu.com/su')) return Response.json({ s: ['杭州市$临安区$$某村$179$uid-77$杭州市$临安区$'] });
      if (url.includes('qt=ext')) return Response.json({ content: {} });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const result = await ingestBaiduAoi('某村场地', {
      SUPABASE_SERVICE_ROLE_KEY: 'eyJservice',
      SUPABASE_URL: 'https://example.supabase.co',
    }, fetchImpl);
    expect(result).toBe('missed');
  });
});

describe('handlePlaceShape 接线', () => {
  const missFetch = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;

  it('挖不到轮廓时把补库任务交给 waitUntil（不阻塞响应）', async () => {
    const scheduled: Promise<unknown>[] = [];
    const params = new URLSearchParams({ name: '青山湖水上森林', near: '119.7652,30.2525' });
    const response = await handlePlaceShape(
      new Request(`https://example.test/api/place-shape?${params}`),
      missFetch,
      {},
      task => scheduled.push(task),
    );
    expect(await response.json()).toEqual({ shape: null });
    expect(scheduled).toHaveLength(1);
    // 没有 service key → 任务内部降级，绝不抛错
    await expect(scheduled[0]).resolves.toBe('skipped-no-key');
  });

  it('命中 stock 时不触发补库', async () => {
    const stocked = {
      id: 'osm:W42', name: '青山湖水上森林', kind: 'area',
      bounds: [119.76, 30.25, 119.77, 30.26],
      polygon: [[119.76, 30.25], [119.77, 30.25], [119.77, 30.26], [119.76, 30.26]],
    };
    const fetchImpl = vi.fn(async () => Response.json([stocked])) as unknown as typeof fetch;
    const scheduled: Promise<unknown>[] = [];
    const params = new URLSearchParams({ name: '青山湖水上森林', near: '119.7652,30.2525' });
    const response = await handlePlaceShape(
      new Request(`https://example.test/api/place-shape?${params}`),
      fetchImpl,
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' },
      task => scheduled.push(task),
    );
    const body = await response.json() as { shape?: { source?: string } };
    expect(body.shape?.source).toBe('stock');
    expect(scheduled).toHaveLength(0);
  });
});
