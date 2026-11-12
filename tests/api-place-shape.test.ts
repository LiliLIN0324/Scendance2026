import { describe, expect, it } from 'vitest';
import { highwayLineStage, spatialAreaStage } from '../functions/api/place-shape.ts';

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
