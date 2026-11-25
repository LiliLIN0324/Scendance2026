import { describe, expect, it } from 'vitest';
import { readOutdoorProjectRecord, saveOutdoorProjectRecord, type KeyValueStorage } from './outdoor-project-store';
import { planGroundSync, planGroundFromLayout, stripLayoutGroundBytes } from './plan-ground';
import type { RoomLayout } from './types';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** `planGroundSync` 的 layout 入参形状（`LayoutGroundSource` 未对外导出，仍按函数签名取）。 */
type LayoutSource = Parameters<typeof planGroundSync>[1];

/**
 * 迁移实测（S2/S3 目标 §八「数据」那一条）：老方案只有 layout 缓存（有字节、有定位），
 * plan 里没有 ground —— 打开一次之后，正源必须真的长出 ground，且是同一份字节；
 * layout 那份缓存不许被顺手删掉（防丢存量），第二次打开必须不再写。
 *
 * 这里跑的是真函数：`planGroundSync` 判方向 → `applyGround` 等价的「plan 长出 ground」→
 * `saveOutdoorProjectRecord`（真 schema 校验）→ `readOutdoorProjectRecord` 读回。
 * 组件侧只剩 `adoptPlan → onPlanChange → 保存` 这一条纯接线，另有静态核对。
 */
const PID = 's1-migrate-fixture';
const BYTES = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const POLYGON = [
  { lng: 121.473542418, lat: 31.2303096 },
  { lng: 121.473857582, lat: 31.2303096 },
  { lng: 121.473857582, lat: 31.2304904 },
  { lng: 121.473542418, lat: 31.2304904 },
];
const FRAME = { lng0: 121.473542418, lat0: 31.230490437, latMid: 31.2304, scale: 1, latSign: -1 as const };
const CENTER = { lng: 121.4737, lat: 31.2304 };

function memoryStorage(): KeyValueStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); },
    dump: () => Object.fromEntries(map.entries()),
  };
}

/** 老方案：layout 上有字节与定位（迁移前的形态）。 */
function legacyLayout(overrides: Partial<RoomLayout> = {}): RoomLayout {
  return ({
    id: PID, name: '迁移夹具', width: 30, height: 20, floors: [{ id: 'f1', name: '一层', height: 3, items: [] }],
    floorPlanImage: BYTES, floorPlanOpacity: 0.94, satelliteGroundRef: true,
    mapGroundPolygon: POLYGON, mapLngLat: CENTER, mapGroundFrame: FRAME,
    ...overrides,
  }) as unknown as RoomLayout;
}

function emptyPlan(): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }],
    zones: [], facilities: [], routes: [], nodes: [], workers: [],
  } as unknown as SitePlanData;
}

function layoutSource(layout: RoomLayout): LayoutSource {
  return layout as unknown as LayoutSource;
}

describe('贴地底图迁移实测（layout 缓存 → plan 正源）', () => {
  it('打开一次就把字节与定位迁进正源、读回仍在，layout 缓存不被删', () => {
    const storage = memoryStorage();
    const plan = emptyPlan();
    saveOutdoorProjectRecord({ v: 1, projectId: PID, name: '迁移夹具', createdAt: 'x', updatedAt: 'x', plan }, storage, false);

    const layout = legacyLayout();
    expect(readOutdoorProjectRecord(PID, storage)?.plan?.ground).toBeUndefined();

    // 1) 方向判定（真实函数）
    const sync = planGroundSync({ ground: undefined }, layoutSource(layout));
    expect(sync.direction).toBe('to-plan');
    const ground = sync.direction === 'to-plan' ? sync.ground : null;
    expect(ground?.image).toBe(BYTES);
    expect(ground?.polygon).toEqual(POLYGON);
    expect(ground?.center).toEqual(CENTER);
    expect(ground?.frame).toEqual(FRAME);

    // 2) 画布 `applyGround` 的动作：把 ground 挂上 plan，然后按正常保存链路落盘（真 schema 校验）
    const written = saveOutdoorProjectRecord({ v: 1, projectId: PID, name: '迁移夹具', createdAt: 'x', updatedAt: 'x', plan: { ...plan, ground: ground! } }, storage, false);
    expect(written.ok).toBe(true);

    // 3) 读回：正源长出来了
    const back = readOutdoorProjectRecord(PID, storage);
    expect(back?.plan?.ground?.image).toBe(BYTES);
    expect(back?.plan?.ground?.polygon?.length).toBe(4);
  });

  it('迁移完第二次打开不再写（already-current），layout 字节镜像已被擦掉', () => {
    const storage = memoryStorage();
    const layout = legacyLayout();
    storage.setItem('scendance-editor-local-v1', JSON.stringify(layout));
    const first = planGroundSync({ ground: undefined }, layoutSource(layout));
    expect(first.direction).toBe('to-plan');
    const ground = first.direction === 'to-plan' ? first.ground : null;
    saveOutdoorProjectRecord({ v: 1, projectId: PID, name: '迁移夹具', createdAt: 'x', updatedAt: 'x', plan: { ...emptyPlan(), ground: ground! } }, storage, false);
    // 组件侧迁移落地后的擦镜像动作（S3）：只擦字节/开关，定位三类留给基线读。
    const { layout: stripped } = stripLayoutGroundBytes(layout);
    storage.setItem('scendance-editor-local-v1', JSON.stringify(stripped));

    const again = planGroundSync(readOutdoorProjectRecord(PID, storage)?.plan, layoutSource(stripped));
    expect(again.direction).toBe('none');
    expect(again.direction === 'none' && again.reason).toBe('already-current');

    const kept = JSON.parse(storage.getItem('scendance-editor-local-v1')!) as RoomLayout;
    expect(kept.floorPlanImage).toBeUndefined();
    expect(kept.satelliteGroundRef).toBeUndefined();
    expect(kept.mapGroundPolygon?.length).toBe(4);
  });

  it('正源已有别的图时不被 layout 覆盖（防丢存量）', () => {
    const storage = memoryStorage();
    const layout = legacyLayout();
    const existing = { image: 'https://example.com/newer.jpg', opacity: 0.9, polygon: POLYGON, center: CENTER, frame: FRAME };
    saveOutdoorProjectRecord({ v: 1, projectId: PID, name: '迁移夹具', createdAt: 'x', updatedAt: 'x', plan: { ...emptyPlan(), ground: existing } }, storage, false);

    const sync = planGroundSync(readOutdoorProjectRecord(PID, storage)?.plan, layoutSource(layout));
    expect(sync.direction).toBe('none');
    expect(readOutdoorProjectRecord(PID, storage)?.plan?.ground?.image).toBe('https://example.com/newer.jpg');
  });

  it('layout 侧只有定位没有字节时，迁移到正源的 ground 也只有定位', () => {
    const layout = legacyLayout();
    delete (layout as unknown as Record<string, unknown>).floorPlanImage;
    delete (layout as unknown as Record<string, unknown>).floorPlanOpacity;
    const legacy = planGroundFromLayout(layoutSource(layout));
    expect(legacy?.image).toBeUndefined();
    expect(legacy?.polygon).toEqual(POLYGON);
  });
});
