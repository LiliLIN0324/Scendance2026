import { describe, expect, it } from 'vitest';
import { planGroundSchema } from '../../../../supabase/functions/_shared/site-plan';
import { rememberPlanGroundBounds } from './amap-venue';
import { planGroundFromLayout, planGroundSync, resolveGround, stripLayoutGroundBytes, stripPlanGroundImage } from './plan-ground';
import type { LegacyLayoutGround } from './legacy-ground';

const POLYGON = [
  { lng: 120.1413, lat: 30.2489 },
  { lng: 120.1433, lat: 30.2489 },
  { lng: 120.1433, lat: 30.2469 },
  { lng: 120.1413, lat: 30.2469 },
];
const FRAME = { lng0: 120.1413, lat0: 30.2489, latMid: 30.2479, scale: 1, latSign: -1 as const };
const IMAGE = `data:image/png;base64,${'A'.repeat(120)}`;

function groundLayout(extra: Partial<LegacyLayoutGround> = {}): LegacyLayoutGround {
  return {
    floorPlanImage: IMAGE,
    floorPlanOpacity: 0.9,
    satelliteGroundRef: true,
    mapGroundPolygon: POLYGON,
    mapLngLat: { lng: 120.1423, lat: 30.2479 },
    mapGroundFrame: FRAME,
    ...extra,
  };
}

describe('plan.ground 正源 ← layout 视图缓存', () => {
  it('把旧项目 layout 里的贴地底图读成 plan.ground（图 + 定位 + 框）', () => {
    const ground = planGroundFromLayout(groundLayout());
    expect(ground).toEqual({
      image: IMAGE,
      opacity: 0.9,
      satelliteRef: true,
      polygon: POLYGON,
      center: { lng: 120.1423, lat: 30.2479 },
      frame: FRAME,
    });
    expect(planGroundSchema.safeParse(ground).success).toBe(true);
  });

  it('刷新后内存登记表为空也不丢存量（data:image + 贴地框仍认）', () => {
    // 不调用 rememberPlanGroundBounds：模拟重开项目，isPlanGroundImage 为 false。
    const ground = planGroundFromLayout(groundLayout());
    expect(ground?.image).toBe(IMAGE);
  });

  it('用户自己上传的户型图（无贴地定位）不被冒充成贴地底图', () => {
    const ground = planGroundFromLayout({
      floorPlanImage: IMAGE, floorPlanOpacity: 0.8, satelliteGroundRef: false,
    });
    expect(ground).toBeNull();
  });

  it('人关掉卫星贴地（satelliteGroundRef=false）时不把旧图当正源', () => {
    expect(planGroundFromLayout(groundLayout({ satelliteGroundRef: false }))?.image).toBeUndefined();
  });

  it('只有定位没有图也能读成 ground（用于换设备重拼底图）', () => {
    const ground = planGroundFromLayout({
      mapGroundPolygon: POLYGON, mapLngLat: { lng: 120.1423, lat: 30.2479 }, mapGroundFrame: FRAME,
    });
    expect(ground).toMatchObject({ polygon: POLYGON, center: { lng: 120.1423, lat: 30.2479 }, frame: FRAME });
    expect(ground?.image).toBeUndefined();
  });

  it('一份定位都没有 → null，不虚构空 ground', () => {
    expect(planGroundFromLayout({})).toBeNull();
    expect(planGroundFromLayout({ mapGroundPolygon: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }] })).toBeNull();
  });

  it('本次会话刚拼好的图（登记过的 data:image）即使没写框也认', () => {
    rememberPlanGroundBounds(IMAGE, { west: 120.14, south: 30.24, east: 120.15, north: 30.25 });
    const ground = planGroundFromLayout({ floorPlanImage: IMAGE, satelliteGroundRef: true });
    expect(ground).toEqual({ image: IMAGE, satelliteRef: true });
  });
});

describe('迁移落地后擦掉 layout 的底图字节镜像（stripLayoutGroundBytes）', () => {
  function layoutOf(extra: Partial<LegacyLayoutGround>): LegacyLayoutGround & { id: string; name: string; width: number; height: number; floors: never[] } {
    return { id: 't', name: '擦镜像夹具', width: 30, height: 20, floors: [], ...extra };
  }
  const framedImage = groundLayout();

  it('贴地底图：图、透明度、开关、定位三类一起擦，layout 不剩第二份', () => {
    const { layout, stripped } = stripLayoutGroundBytes(layoutOf(framedImage));
    expect(stripped).toBe(true);
    expect(layout.floorPlanImage).toBeUndefined();
    expect(layout.floorPlanOpacity).toBeUndefined();
    expect(layout.satelliteGroundRef).toBeUndefined();
    expect(layout.mapGroundPolygon).toBeUndefined();
    expect(layout.mapLngLat).toBeUndefined();
    expect(layout.mapGroundFrame).toBeUndefined();
  });

  it('用户上传的参考图纸（没有贴地框/多边形）只擦开关，图与透明度保留', () => {
    const reference = { floorPlanImage: 'data:image/png;base64,PLAN', floorPlanOpacity: 0.6, satelliteGroundRef: true as const };
    const { layout, stripped } = stripLayoutGroundBytes(layoutOf(reference));
    expect(stripped).toBe(true);
    expect(layout.floorPlanImage).toBe(reference.floorPlanImage);
    expect(layout.floorPlanOpacity).toBe(0.6);
    expect(layout.satelliteGroundRef).toBeUndefined();
  });

  it('本来就没有镜像 → 原样返回同一引用，不制造无意义写入', () => {
    const bare = layoutOf({});
    const result = stripLayoutGroundBytes(bare);
    expect(result.stripped).toBe(false);
    expect(result.layout).toBe(bare);
    expect(stripLayoutGroundBytes(layoutOf({ floorPlanImage: 'data:image/png;base64,PLAN' })).stripped).toBe(false);
  });
});

describe('读源单源化（resolveGround）：plan 优先，layout 只兜底', () => {
  it('plan 有图时以正源为准，即使 layout 缓存还是旧图', () => {
    const resolved = resolveGround(groundLayout(), { ground: { image: 'data:image/png;base64,NEW', frame: FRAME } });
    expect(resolved?.source).toBe('plan');
    expect(resolved?.image).toBe('data:image/png;base64,NEW');
  });

  it('旧项目 plan 没有 ground 时退回 layout 缓存，并沿用其透明度/定位', () => {
    const resolved = resolveGround(groundLayout(), {});
    expect(resolved).toMatchObject({ source: 'layout', image: IMAGE, opacity: 0.9, polygon: POLYGON, frame: FRAME });
  });

  it('两边都没有可读底图 → null（不虚构）', () => {
    expect(resolveGround({}, {})).toBeNull();
    expect(resolveGround({}, null)).toBeNull();
    // 用户上传的户型图纸（无贴地框/多边形）不算贴地底图
    expect(resolveGround({ floorPlanImage: 'data:image/png;base64,PLAN' }, null)).toBeNull();
  });

  it('layout 侧 satelliteGroundRef=false（显式关掉贴地）不被兜底读成底图', () => {
    expect(resolveGround(groundLayout({ satelliteGroundRef: false }), {})).toBeNull();
  });

  it('plan 给的值直接生效：透明度与 satelliteRef 不再被 layout 覆盖', () => {
    const resolved = resolveGround(groundLayout(), { ground: { image: IMAGE, opacity: 0.5, satelliteRef: false } });
    expect(resolved).toMatchObject({ source: 'plan', opacity: 0.5, satelliteRef: false });
  });
});

describe('打开方案时的同步方向（planGroundSync）', () => {
  it('旧项目：plan 没有 ground、layout 有 → 迁进正源', () => {
    const sync = planGroundSync({}, groundLayout());
    expect(sync.direction).toBe('to-plan');
    expect(sync.direction === 'to-plan' && sync.ground.image).toBe(IMAGE);
  });

  it('正源已经有 ground → 不再投影回 layout，只报 already-current', () => {
    expect(planGroundSync({ ground: { image: 'data:image/jpeg;base64,NEW', polygon: POLYGON, frame: FRAME } }, {})).toEqual({ direction: 'none', reason: 'already-current' });
  });

  it('两边都没有底图 → 不动（不虚构 empty ground）', () => {
    expect(planGroundSync({}, {})).toEqual({ direction: 'none', reason: 'no-ground-anywhere' });
    expect(planGroundSync(null, groundLayout())).toEqual({ direction: 'none', reason: 'no-plan' });
  });

  it('正源与缓存同一张图，且框/多边形都在 → already-current（不重复写 layout）', () => {
    const ground = planGroundFromLayout(groundLayout())!;
    expect(planGroundSync({ ground }, groundLayout())).toEqual({ direction: 'none', reason: 'already-current' });
  });

  it('正源只有定位没有图 → 不动（没有可视底图可补）', () => {
    expect(planGroundSync({ ground: { polygon: POLYGON, frame: FRAME } }, {}))
      .toEqual({ direction: 'none', reason: 'already-current' });
  });
});

describe('分享前剥掉底图字节', () => {
  it('删掉 image，保留定位与开关', () => {
    const stripped = stripPlanGroundImage({
      schemaVersion: 1 as const, boundary: [{ x: 0, y: 0 }],
      ground: { image: IMAGE, opacity: 0.9, polygon: POLYGON, frame: FRAME, satelliteRef: true },
    });
    expect(stripped.ground).toEqual({ opacity: 0.9, polygon: POLYGON, frame: FRAME, satelliteRef: true });
  });

  it('ground 只有图时整段删掉，不留空对象', () => {
    const stripped = stripPlanGroundImage({ schemaVersion: 1 as const, boundary: [], ground: { image: IMAGE } });
    expect('ground' in stripped).toBe(false);
  });

  it('没有图时原样返回同一引用（不制造无意义拷贝）', () => {
    const plan = { schemaVersion: 1 as const, boundary: [], ground: { frame: FRAME } };
    expect(stripPlanGroundImage(plan)).toBe(plan);
  });
});
