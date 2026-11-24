import { describe, expect, it } from 'vitest';
import { planGroundSchema } from '../../../../supabase/functions/_shared/site-plan';
import { rememberPlanGroundBounds } from './amap-venue';
import { layoutGroundPatch, PLAN_GROUND_OPACITY, planGroundFromLayout, stripPlanGroundImage } from './plan-ground';
import type { RoomLayout } from './types';

const POLYGON = [
  { lng: 120.1413, lat: 30.2489 },
  { lng: 120.1433, lat: 30.2489 },
  { lng: 120.1433, lat: 30.2469 },
  { lng: 120.1413, lat: 30.2469 },
];
const FRAME = { lng0: 120.1413, lat0: 30.2489, latMid: 30.2479, scale: 1, latSign: -1 as const };
const IMAGE = `data:image/png;base64,${'A'.repeat(120)}`;

function groundLayout(extra: Partial<RoomLayout> = {}): Pick<RoomLayout,
  'floorPlanImage' | 'floorPlanOpacity' | 'satelliteGroundRef' | 'mapGroundPolygon' | 'mapLngLat' | 'mapGroundFrame'> {
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

describe('plan.ground → layout 视图缓存投影', () => {
  it('逐字段投影，缺省的透明度按 0.94 补齐（与旧写入口径一致）', () => {
    const patch = layoutGroundPatch({ image: IMAGE, polygon: POLYGON, frame: FRAME });
    expect(patch).toEqual({
      floorPlanImage: IMAGE,
      floorPlanOpacity: PLAN_GROUND_OPACITY,
      mapGroundPolygon: POLYGON,
      mapGroundFrame: FRAME,
    });
    expect(PLAN_GROUND_OPACITY).toBe(0.94);
  });

  it('没有 ground / 空 ground 时返回 null，不当成「清空底图」', () => {
    expect(layoutGroundPatch(undefined)).toBeNull();
    expect(layoutGroundPatch({ opacity: 0.5 })).toBeNull();
  });

  it('只投影 ground 里真有的字段，不补 satelliteRef=false 这类假信息', () => {
    const patch = layoutGroundPatch({ image: IMAGE, center: { lng: 1, lat: 2 } });
    expect(patch).toEqual({ floorPlanImage: IMAGE, floorPlanOpacity: PLAN_GROUND_OPACITY, mapLngLat: { lng: 1, lat: 2 } });
    expect('satelliteGroundRef' in (patch ?? {})).toBe(false);
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
