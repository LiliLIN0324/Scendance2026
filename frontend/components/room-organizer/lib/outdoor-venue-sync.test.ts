import { describe, expect, it } from 'vitest';
import botanicalGarden from './__testfixtures__/hangzhou-botanical-garden.json';
import { MAX_ROOM_DIMENSION } from './constants';
import { DEFAULT_SCOPE_MARGIN_M, expandRect } from './outdoor-design-scope';
import {
  planBoundaryToShellVenue,
  samePlanRing,
  shellVenuePatchFromPlanBoundary,
  shellVenueToPlanBoundary,
  nextOutdoorBoundarySync,
  seededPlanFromLayout,
  seededPlanFromVenue,
  trueFootprintBoundary,
  planBoundaryFromSearchArea,
  sceneAnchorFromOutdoorPlan,
  SHELL_RING_LIMIT,
  SHELL_SIZE_LIMIT_M,
} from './outdoor-venue-sync';

/** 一个 20×10 m 的方环：x 0..20（东），y 0..10（北）。 */
const square = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
];

describe('planBoundaryToShellVenue', () => {
  it('把 ENU 边界投影成 0..width × 0..depth 的壳体多边形（北落到 z=0）', () => {
    const venue = planBoundaryToShellVenue(square)!;
    expect(venue.width).toBe(20);
    expect(venue.depth).toBe(10);
    expect(venue.scale).toBe(1);
    // (0,0) 在西南角 → 壳体里 x=0、z=depth（南）；(0,10) 在西北角 → z=0。
    expect(venue.polygon).toEqual([
      { x: 0, z: 10 },
      { x: 20, z: 10 },
      { x: 20, z: 0 },
      { x: 0, z: 0 },
    ]);
  });

  it('平移到正象限：负坐标的边界照样落到 0 起点', () => {
    const shifted = square.map(point => ({ x: point.x - 500, y: point.y - 300 }));
    const venue = planBoundaryToShellVenue(shifted)!;
    expect(venue.width).toBe(20);
    expect(venue.depth).toBe(10);
    expect(venue.polygon.every(point => point.x >= 0 && point.x <= 20 && point.z >= 0 && point.z <= 10)).toBe(true);
  });

  it('超上限的大场地按比例缩到 3D 壳体可承载的尺寸', () => {
    const huge = [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 400 },
      { x: 0, y: 400 },
    ];
    const venue = planBoundaryToShellVenue(huge)!;
    expect(venue.scale).toBeLessThan(1);
    expect(venue.width).toBeLessThanOrEqual(SHELL_SIZE_LIMIT_M);
    expect(venue.depth).toBeLessThanOrEqual(SHELL_SIZE_LIMIT_M);
    // 上限必须跟 3D 编辑器实际可用的场地尺寸对齐，否则 applyLayout 会裁尺寸、
    // 多边形顶点却留在原范围，落到壳体外。
    expect(SHELL_SIZE_LIMIT_M).toBe(MAX_ROOM_DIMENSION);
    expect(venue.width / venue.depth).toBeCloseTo(2, 1);
    expect(venue.polygon.every(point => point.x <= venue.width && point.z <= venue.depth)).toBe(true);
  });

  it('顶点超过 32 个时削到契约上限，外形仍是闭合环', () => {
    const circle = Array.from({ length: 80 }, (_, index) => {
      const angle = (index / 80) * Math.PI * 2;
      return { x: 30 + Math.cos(angle) * 20, y: 30 + Math.sin(angle) * 20 };
    });
    const venue = planBoundaryToShellVenue(circle)!;
    expect(venue.simplified).toBe(true);
    expect(venue.polygon.length).toBe(SHELL_RING_LIMIT);
    expect(venue.polygon.length).toBeLessThan(circle.length);
  });

  it('退化输入返回 null（点数不够 / 面积为零）', () => {
    expect(planBoundaryToShellVenue([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(planBoundaryToShellVenue([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toBeNull();
  });
});

describe('shellVenueToPlanBoundary', () => {
  it('壳体多边形逆变换回 ENU 边界，和原边界同形', () => {
    const venue = planBoundaryToShellVenue(square)!;
    const back = shellVenueToPlanBoundary(venue);
    expect(back).toEqual(square);
    expect(samePlanRing(back, square)).toBe(true);
  });

  it('没有多边形时退回矩形四角', () => {
    const ring = shellVenueToPlanBoundary({ width: 8, depth: 6 });
    expect(ring).toEqual([
      { x: 0, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 0 }, { x: 0, y: 0 },
    ]);
  });
});

describe('samePlanRing', () => {
  it('起点轮转、绕向相反都算同一圈', () => {
    expect(samePlanRing(square, [square[2]!, square[3]!, square[0]!, square[1]!])).toBe(true);
    expect(samePlanRing(square, [...square].reverse())).toBe(true);
  });

  it('点数不同或某点挪动超容差就不算同一圈', () => {
    expect(samePlanRing(square, square.slice(0, 3))).toBe(false);
    expect(samePlanRing(square, [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 12 }])).toBe(false);
  });

  it('亚米级抖动仍算同一圈（避免编辑抖动反复写回 3D）', () => {
    const jittered = square.map(point => ({ x: point.x + 0.2, y: point.y - 0.2 }));
    expect(samePlanRing(square, jittered)).toBe(true);
  });
});

describe('shellVenuePatchFromPlanBoundary', () => {
  const layout = {
    backendVenue: {
      shape: 'rectangle' as const,
      width: 40,
      depth: 20,
      height: 4,
      entrances: [
        // 旧矩形正中间 (20,10)：在 40×20 场地里是室内中心；落到新 20×10 场地后是内部点，
        // 不落在边界上，venueSchema 会整份拒绝，所以要清掉。
        { id: '11111111-1111-4111-8111-111111111111', position: { x: 10, z: 5 }, width: 2 },
      ],
    },
  };

  it('写出 polygon + width/height，并清掉已不在新边界上的出入口', () => {
    const patch = shellVenuePatchFromPlanBoundary(layout, square)!;
    expect(patch.width).toBe(20);
    expect(patch.height).toBe(10);
    expect(patch.backendVenue.shape).toBe('polygon');
    expect(patch.backendVenue.polygon).toHaveLength(4);
    expect(patch.backendVenue.entrances).toEqual([]);
    // 层高沿用原场地，不被平面编辑带跑。
    expect(patch.backendVenue.height).toBe(4);
  });

  it('仍落在新边界上的出入口保留', () => {
    const onEdge = {
      backendVenue: {
        ...layout.backendVenue,
        entrances: [{ id: '22222222-2222-4222-8222-222222222222', position: { x: 10, z: 0 }, width: 2 }],
      },
    };
    const patch = shellVenuePatchFromPlanBoundary(onEdge, square)!;
    expect(patch.backendVenue.entrances).toHaveLength(1);
  });

  it('没有旧壳体时默认 3 m 层高', () => {
    const patch = shellVenuePatchFromPlanBoundary({}, square)!;
    expect(patch.backendVenue.height).toBe(3);
  });
});

describe('nextOutdoorBoundarySync', () => {
  it('初次载入只记基线，不写 3D', () => {
    const first = nextOutdoorBoundarySync({ baseline: null }, { boundary: square });
    expect(first.apply).toBe(false);
    expect(first.state.baseline).toEqual(square);
  });

  it('边界没变不写；真改了才写一次', () => {
    const synced = nextOutdoorBoundarySync({ baseline: square }, { boundary: square });
    expect(synced.apply).toBe(false);
    const changed = nextOutdoorBoundarySync({ baseline: square }, { boundary: [...square.slice(0, 3), { x: 0, y: 14 }] });
    expect(changed.apply).toBe(true);
    expect(changed.state.baseline).toEqual([...square.slice(0, 3), { x: 0, y: 14 }]);
  });
});

describe('seededPlanFromVenue', () => {
  it('3D 场地轮廓直接成为 2D 起步边界，锚点写进 plan.anchor', () => {
    const plan = seededPlanFromVenue(
      {
        width: 20,
        depth: 10,
        shape: 'polygon',
        polygon: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 0, z: 10 }],
      },
      { lng: 120.1413, lat: 30.2545 },
    )!;
    expect(plan.boundary).toHaveLength(4);
    expect(plan.boundary).toContainEqual({ x: 0, y: 10 });
    expect(plan.anchor).toEqual({ lng: 120.1413, lat: 30.2545, crs: 'gcj-02', source: 'asset-geo' });
    expect(plan.zones).toEqual([]);
  });

  it('没有锚点时只播种边界，不编造 plan.anchor', () => {
    const plan = seededPlanFromVenue({ width: 20, depth: 10 }, null)!;
    expect(plan.anchor).toBeUndefined();
    expect(plan.boundary).toHaveLength(4);
  });

  it('退化/缺失的壳体不播种（留给起步矩形）', () => {
    expect(seededPlanFromVenue(null, null)).toBeNull();
    expect(seededPlanFromVenue({ width: 0, depth: 0 }, null)).toBeNull();
    expect(seededPlanFromVenue({ width: Number.NaN, depth: 10 }, null)).toBeNull();
  });

  it('往返一致：播种出的边界再投影回壳体，尺寸不变', () => {
    const plan = seededPlanFromVenue({ width: 20, depth: 10 }, null)!;
    const venue = planBoundaryToShellVenue(plan.boundary)!;
    expect(venue.width).toBe(20);
    expect(venue.depth).toBe(10);
    expect(venue.scale).toBe(1);
  });
});

describe('seededPlanFromLayout', () => {
  it('模板场景只有宽高：按 layout.width/height 播种矩形边界', () => {
    const plan = seededPlanFromLayout({ width: 23.8, height: 16.1 })!;
    const xs = plan.boundary.map(point => point.x);
    const ys = plan.boundary.map(point => point.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(23.8, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(16.1, 1);
  });

  it('backendVenue 多边形落在壳体内时采信多边形，而不是退化成矩形', () => {
    const plan = seededPlanFromLayout({
      width: 20,
      height: 10,
      backendVenue: {
        shape: 'polygon',
        polygon: [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 10, z: 10 }],
      },
    })!;
    expect(plan.boundary).toHaveLength(3);
  });

  it('多边形和宽高尺度不一致（顶点跑到壳体外）时退回矩形，不种出越界边界', () => {
    const plan = seededPlanFromLayout({
      width: 20,
      height: 10,
      backendVenue: {
        shape: 'polygon',
        polygon: [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 133 }, { x: 0, z: 133 }],
      },
    })!;
    const xs = plan.boundary.map(point => point.x);
    expect(Math.max(...xs)).toBeLessThanOrEqual(20);
  });

  it('尺寸退化时不播种', () => {
    expect(seededPlanFromLayout({ width: 0, height: 10 })).toBeNull();
    expect(seededPlanFromLayout({ width: Number.NaN, height: 10 })).toBeNull();
  });

  it('有活动点位时把锚点带进 plan.anchor（source=asset-geo）', () => {
    const plan = seededPlanFromLayout({ width: 20, height: 10, mapLngLat: { lng: 120.15, lat: 30.25 } })!;
    expect(plan.anchor).toEqual({ lng: 120.15, lat: 30.25, crs: 'gcj-02', source: 'asset-geo' });
  });

  // V-1c（2026-11-13）：chat 场地确认/地图圈画写入真实 GCJ 足迹时，2D 边界=真轮廓（真实米数）。
  it('有 mapGroundPolygon + 锚点时边界用真实足迹（米数≈GCJ 差换算），锚点 source=lookup', () => {
    const anchor = { lng: 120.54, lat: 30.40 };
    // 以锚点为中心 ±0.0045°lng（≈425m）×±0.004°lat（≈445m）的四边形
    const plan = seededPlanFromLayout({
      width: 10,
      height: 10,
      mapLngLat: anchor,
      mapGroundPolygon: [
        { lng: anchor.lng - 0.0045, lat: anchor.lat - 0.004 },
        { lng: anchor.lng + 0.0045, lat: anchor.lat - 0.004 },
        { lng: anchor.lng + 0.0045, lat: anchor.lat + 0.004 },
        { lng: anchor.lng - 0.0045, lat: anchor.lat + 0.004 },
      ],
    })!;
    expect(plan.anchor?.source).toBe('lookup');
    const xs = plan.boundary.map(point => point.x);
    const ys = plan.boundary.map(point => point.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(380); // 真米数，不是缩到壳体的影子
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(440);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(4900);
  });

  it('足迹超出 ±4900m（城市级行政区）不采信，退回壳体轮廓', () => {
    const plan = seededPlanFromLayout({
      width: 10,
      height: 10,
      mapLngLat: { lng: 120.54, lat: 30.40 },
      mapGroundPolygon: [
        { lng: 120.40, lat: 30.30 },
        { lng: 120.70, lat: 30.30 },
        { lng: 120.70, lat: 30.50 },
        { lng: 120.40, lat: 30.50 },
      ],
    })!;
    const xs = plan.boundary.map(point => point.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 1); // 壳体 10m 矩形
  });

  it('足迹顶点过多时抽稀到 64（契约上界）', () => {
    const anchor = { lng: 120.54, lat: 30.40 };
    const many = Array.from({ length: 300 }, (_, i) => ({
      lng: anchor.lng + 0.002 * Math.cos(i / 10),
      lat: anchor.lat + 0.002 * Math.sin(i / 10),
    }));
    const plan = seededPlanFromLayout({ width: 10, height: 10, mapLngLat: anchor, mapGroundPolygon: many })!;
    expect(plan.boundary.length).toBeLessThanOrEqual(64);
    expect(plan.boundary.length).toBeGreaterThanOrEqual(3);
  });
});

// #86：杭州湖滨银泰 IN77 真实 OSM 足迹（osm:W1110196946，13 点闭合环，末点与首点重合）。
// 锚点取 bounds 中心；验证真实商场轮廓能转成契约合法的 ENU 米边界（街区尺度，不越 ±4900m）。
const IN77_POLYGON: [number, number][] = [
  [120.165045, 30.253919],
  [120.165159, 30.250533],
  [120.163849, 30.250512],
  [120.163277, 30.25059],
  [120.163175, 30.250639],
  [120.163095, 30.252815],
  [120.162309, 30.252793],
  [120.161611, 30.253851],
  [120.162988, 30.253899],
  [120.162938, 30.255426],
  [120.163875, 30.255466],
  [120.16394, 30.253884],
  [120.165045, 30.253919],
];

describe('trueFootprintBoundary · IN77 真实商场足迹', () => {
  const anchor = { lng: 120.163385, lat: 30.252989 };

  it('把 GCJ-02 闭合环转成合法 ENU 边界，去重首尾、保留街区尺度', () => {
    const boundary = trueFootprintBoundary(
      IN77_POLYGON.map(([lng, lat]) => ({ lng, lat })),
      anchor,
    );
    expect(boundary).not.toBeNull();
    expect(boundary!.length).toBeGreaterThanOrEqual(3);
    expect(boundary!.length).toBeLessThanOrEqual(64);
    // 首尾重合点已被抽掉
    const first = boundary![0]!;
    const last = boundary![boundary!.length - 1]!;
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(0.5);
    // 全部落在契约 ±5000m 内（留余量 ±4900）
    for (const point of boundary!) {
      expect(Math.abs(point.x)).toBeLessThan(4900);
      expect(Math.abs(point.y)).toBeLessThan(4900);
    }
    const xs = boundary!.map(point => point.x);
    const ys = boundary!.map(point => point.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    // IN77 街区约 340m × 550m，落在商场合理尺度区间
    expect(spanX).toBeGreaterThan(200);
    expect(spanX).toBeLessThan(600);
    expect(spanY).toBeGreaterThan(200);
    expect(spanY).toBeLessThan(800);
  });
});

// 2026-11-17 用户：「同一标准检查其他会生成方案的入口」。播种（场景模板 / 3D 壳体 / 真实足迹）
// 同样会凭空交出一份带红线的方案，所以同样要配那只白框；不然 2D 一打开又是「有红线、没白框」。
describe('播种出的方案自带设计范围（红线外扩 20 m）', () => {
  const scopeOf = (boundary: readonly { x: number; y: number }[]) => expandRect(boundary, DEFAULT_SCOPE_MARGIN_M);

  it('seededPlanFromVenue：壳体直接播种时白框跟着红线生', () => {
    const plan = seededPlanFromVenue({ width: 20, depth: 10 }, null)!;
    expect(plan.designScope).toHaveLength(4);
    expect(plan.designScope).toEqual(scopeOf(plan.boundary));
  });

  it('seededPlanFromLayout：模板场景只有宽高时也有白框', () => {
    const plan = seededPlanFromLayout({ width: 23.8, height: 16.1 })!;
    expect(plan.designScope).toEqual(scopeOf(plan.boundary));
  });

  it('seededPlanFromLayout：真实足迹分支同样带白框', () => {
    const anchor = { lng: 120.54, lat: 30.4 };
    const plan = seededPlanFromLayout({
      width: 10,
      height: 10,
      mapLngLat: anchor,
      mapGroundPolygon: [
        { lng: anchor.lng - 0.0045, lat: anchor.lat - 0.004 },
        { lng: anchor.lng + 0.0045, lat: anchor.lat - 0.004 },
        { lng: anchor.lng + 0.0045, lat: anchor.lat + 0.004 },
        { lng: anchor.lng - 0.0045, lat: anchor.lat + 0.004 },
      ],
    })!;
    expect(plan.designScope).toEqual(scopeOf(plan.boundary));
  });

  it('退化输入仍不播种（也就没有白框可补）', () => {
    expect(seededPlanFromVenue({ width: 0, depth: 0 }, null)).toBeNull();
    expect(seededPlanFromLayout({ width: 0, height: 10 })).toBeNull();
  });
});

describe('planBoundaryFromSearchArea · 搜索选区收成红线', () => {
  it('杭州植物园真实122点轮廓缩到64点内仍可确认，不把凹口连成自交线', () => {
    // OSM relation 13794808，2026-11-19 本机轮廓服务返回的 GCJ-02 几何。
    // 来源：https://www.openstreetmap.org/relation/13794808
    const shape = { ...botanicalGarden, polygon: botanicalGarden.polygon as [number, number][] };
    const boundary = planBoundaryFromSearchArea(shape, { lng: 120.085, lat: 30.215 });
    expect(boundary).not.toBeNull();
    expect(boundary!.length).toBeLessThanOrEqual(64);
    expect(boundary!.length).toBeGreaterThan(3);
  });
  const anchor = { lng: 120.14, lat: 30.25 };
  const d = 0.0008;
  const polygon: [number, number][] = [
    [anchor.lng, anchor.lat],
    [anchor.lng + d, anchor.lat],
    [anchor.lng + d, anchor.lat + d],
    [anchor.lng, anchor.lat + d],
  ];

  it('闭合选区转成能通过红线校验的环', () => {
    const boundary = planBoundaryFromSearchArea({ polygon }, anchor);
    expect(boundary).not.toBeNull();
    expect(boundary!.length).toBeGreaterThanOrEqual(3);
  });

  it('道路折线、点数不够、没有锚点都不当成红线', () => {
    expect(planBoundaryFromSearchArea({ polygon, kind: 'line' }, anchor)).toBeNull();
    expect(planBoundaryFromSearchArea({ polygon: polygon.slice(0, 2) }, anchor)).toBeNull();
    expect(planBoundaryFromSearchArea({ polygon }, null)).toBeNull();
    expect(planBoundaryFromSearchArea(null, anchor)).toBeNull();
  });
});

describe('sceneAnchorFromOutdoorPlan', () => {
  it('合法边界 + 锚点：投影出壳体锚点，来源透传、朝向为 0', () => {
    const plan = { anchor: { lng: 120.1413, lat: 30.2545, crs: 'gcj-02' as const, source: 'asset-geo' as const }, boundary: square };
    const result = sceneAnchorFromOutdoorPlan(plan);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('asset-geo');
    expect(result!.orientationDeg).toBe(0);
    expect(result!.lng).toBeCloseTo(120.1413, 6);
    expect(result!.lat).toBeCloseTo(30.2545 + 10 / 111132.92, 6);
    expect(result!.metersPerUnit).toBeGreaterThan(0);
  });

  it('缺锚点时不编造壳体锚点，返回 null', () => {
    expect(sceneAnchorFromOutdoorPlan({ anchor: undefined, boundary: square })).toBeNull();
  });

  it('边界不足 3 点时返回 null', () => {
    expect(
      sceneAnchorFromOutdoorPlan({
        anchor: { lng: 120.1413, lat: 30.2545, crs: 'gcj-02' as const, source: 'asset-geo' as const },
        boundary: square.slice(0, 2),
      }),
    ).toBeNull();
  });
});
