import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { handoffSchema } from '../../../../supabase/functions/_shared/delivery-contract';
import { corners, sceneSchema, type Scene } from '../../../../supabase/functions/_shared/domain';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { backendSceneToLayout, createMeasuredRoomLayout, layoutToBackendScene, SceneAdapterError } from './backend-adapter';
import { parseStoredLayout } from './schema';

const objectId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const entranceId = '00000000-0000-4000-8000-000000000003';
function scene(): Scene {
  return sceneSchema.parse({
    schemaVersion: 1,
    venue: { shape: 'rectangle', width: 10, depth: 8, height: 3,
      entrances: [{ id: entranceId, position: { x: 5, z: 0 }, width: 1.8 }] },
    objects: [{ id: objectId, materialId: 'table', position: { x: 2, z: 3 }, rotation: 30,
      size: { width: 2, depth: 1, height: 0.75 }, color: '#cc9966', locked: true, notes: '场内已有桌子' }],
    camera: 'top', lighting: 'warm',
  });
}

describe('the shared backend scene adapter', () => {
  it.each([1, 2] as const)('requires explicit capability and round-trips saved zones for scene V%s', version => {
    const source = version === 1 ? scene() : sceneSchema.parse({ schemaVersion: 2, venue: { shape: 'rectangle', width: 10, depth: 8, height: 3, entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral', structure: { walls: [], openings: [], columns: [] }, sources: [], dimensions: [] });
    const layout = backendSceneToLayout(source);
    layout.floors[0]!.zones = [{ id: 'keep', name: '保留空间', color: '#4A7C59', x: -2.1, z: -1.2, w: 1.25, d: 2, zoneType: 'reserved' },
      { id: 'legacy', name: '预留区', color: '#ffffff', x: 1, z: 1, w: 1, d: 1 }];
    expect(() => layoutToBackendScene(layout)).toThrow(/本机区域标注/);
    const wire = layoutToBackendScene(layout, { planningZonesV1: true });
    expect(wire.planningZones?.zones).toEqual([{ id: 'keep', name: '保留空间', color: '#4A7C59', x: 2.9, z: 2.8, width: 1.25, depth: 2, zoneType: 'reserved', source: 'unverified' },
      { id: 'legacy', name: '预留区', color: '#ffffff', x: 6, z: 5, width: 1, depth: 1, source: 'unverified' }]);
    const reopened = backendSceneToLayout(wire);
    expect(reopened.floors[0]!.zones![0]).toMatchObject({ id: 'keep', name: '保留空间', color: '#4A7C59', zoneType: 'reserved', w: 1.25, d: 2 });
    expect(Math.abs(reopened.floors[0]!.zones![0]!.x + 2.1)).toBeLessThan(1e-9);
    expect(reopened.floors[0]!.zones![1]).not.toHaveProperty('zoneType');
    expect(layoutToBackendScene(reopened, { planningZonesV1: true }).planningZones).toEqual(wire.planningZones);
  });
  it('keeps old zone-free encoding identical with or without capability', () => {
    const layout = backendSceneToLayout(scene());
    expect(JSON.stringify(layoutToBackendScene(layout, { planningZonesV1: true }))).toBe(JSON.stringify(layoutToBackendScene(layout)));
    expect(layoutToBackendScene(layout)).not.toHaveProperty('planningZones');
    layout.floors[0]!.zones = [];
    expect(JSON.stringify(layoutToBackendScene(layout, { planningZonesV1: true }))).toBe(JSON.stringify(layoutToBackendScene(layout)));
  });
  it('removes the old wire area after the user clears the editable floor zones', () => {
    const source = sceneSchema.parse({ schemaVersion: 2, venue: { shape: 'rectangle', width: 10, depth: 8, height: 3, entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral', structure: { walls: [], openings: [], columns: [] }, sources: [], dimensions: [],
      planningZones: { version: 1, zones: [{ id: 'keep', name: '区域', color: '#fff', x: 1, z: 1, width: 2, depth: 2, zoneType: 'reserved', source: 'unverified' }] } });
    const layout = backendSceneToLayout(source);
    expect(layout.floors[0]!.zones).toHaveLength(1);
    layout.floors[0]!.zones = [];
    const wire = layoutToBackendScene(layout, { planningZonesV1: true });
    expect(wire).not.toHaveProperty('planningZones');
    expect(source.planningZones?.zones).toHaveLength(1);
    expect(() => layoutToBackendScene(layout)).toThrow(/本机区域标注/);
  });
  it('keeps design-history areas blocked even when root-zone capability is present', () => {
    const layout = backendSceneToLayout(scene()), variant = backendSceneToLayout(scene());
    layout.floors[0]!.zones = [{ id: 'root', name: '区域', color: '#fff', x: -1, z: -1, w: 1, d: 1 }];
    variant.floors[0]!.zones = [{ id: 'old', name: '旧区域', color: '#fff', x: -1, z: -1, w: 1, d: 1 }];
    layout.designBook = { activeId: 'a', variants: [{ id: 'a', name: '历史', layout: variant }] };
    expect(() => layoutToBackendScene(layout, { planningZonesV1: true })).toThrow(/本机区域标注/);
  });
  it('states that polygon venues are outside the rectangle-only first version', () => {
    const source = sceneSchema.parse({ schemaVersion: 2, venue: { shape: 'polygon', width: 10, depth: 8, height: 3, entrances: [], polygon: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }] }, objects: [], camera: 'overview', lighting: 'neutral', structure: { walls: [], openings: [], columns: [] }, sources: [], dimensions: [] });
    const layout = backendSceneToLayout(source);
    layout.floors[0]!.zones = [{ id: 'edge', name: '区域', color: '#fff', x: -1, z: -1, w: 1, d: 1 }];
    expect(() => layoutToBackendScene(layout, { planningZonesV1: true })).toThrow(/多边形/);
  });
  it('normalizes floating coordinates once and retains an edge-fitting area without crossing the venue', () => {
    const layout = backendSceneToLayout(scene());
    layout.floors[0]!.zones = [{ id: 'edge', name: '边缘', color: '#fff', x: 4.7, z: 3.0000000001, w: 0.3, d: 0.9999999998 }];
    const wire = layoutToBackendScene(layout, { planningZonesV1: true }), zone = wire.planningZones!.zones[0]!;
    expect(zone).toMatchObject({ x: 9.7, z: 7, width: 0.3, depth: 1 });
    const roundtrip = layoutToBackendScene(backendSceneToLayout(wire), { planningZonesV1: true });
    expect(roundtrip.planningZones).toEqual(wire.planningZones);
    expect(Math.abs(zone.z - (layout.floors[0]!.zones![0]!.z + 4))).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(zone.depth - layout.floors[0]!.zones![0]!.d)).toBeLessThanOrEqual(1e-9);
  });
  it('rejects malformed local zones and wire fields instead of truncating or guessing', () => {
    const layout = backendSceneToLayout(scene());
    (layout.floors[0] as unknown as { zones: unknown }).zones = { unexpected: true };
    expect(() => layoutToBackendScene(layout)).toThrow(/本机区域标注/);
    expect(() => layoutToBackendScene(layout, { planningZonesV1: true })).toThrow();
    const base = { id: 'keep', name: '区域', color: '#fff', x: 0, z: 0, w: 1, d: 1 };
    for (const value of [{ ...base, zoneType: 'invalid' }, { ...base, name: '长'.repeat(201) }, { ...base, hidden: 'do not drop' }, { ...base, x: 9 }]) {
      layout.floors[0]!.zones = [value as never]; expect(() => layoutToBackendScene(layout, { planningZonesV1: true })).toThrow();
    }
    const input = { ...scene(), planningZones: { version: 1, zones: [{ id: 'keep', name: '区域', color: '#fff', x: 0, z: 0, width: 1, depth: 1, source: 'confirmed' }] } };
    expect(() => backendSceneToLayout(input)).toThrow();
  });
  it('does not silently drop a locally marked rest area on a cloud round trip', () => {
    const original = backendSceneToLayout(scene());
    const zone = { id: 'rest-one', name: '休息区（待核验）', color: '#4A7C59', x: -2, z: -2, w: 2.2, d: 1.6 };
    original.floors[0].zones = [zone];
    const localCopy = parseStoredLayout(JSON.parse(JSON.stringify(original)));
    expect(localCopy?.floors[0].zones).toEqual([zone]);
    expect(() => layoutToBackendScene(original)).toThrow(/本机区域标注/);
    try { layoutToBackendScene(original); throw new Error('unexpected success'); }
    catch (error) { expect((error as SceneAdapterError).code).toBe('ZONES_NOT_SUPPORTED'); }
    expect(original.floors[0].zones).toEqual([zone]);
  });

  it('still round-trips a scene with an empty zone list', () => {
    const layout = backendSceneToLayout(scene());
    layout.floors[0].zones = [];
    const roundtrip = backendSceneToLayout(layoutToBackendScene(layout));
    expect(roundtrip.floors[0].zones ?? []).toEqual([]);
    expect(roundtrip.floors[0].items.length).toBe(layout.floors[0].items.length);
  });

  it('also stops if a saved design variant contains a local zone', () => {
    const layout = backendSceneToLayout(scene());
    const variant = backendSceneToLayout(scene());
    variant.floors[0].zones = [{ id: 'rest', name: '休息区', color: '#4A7C59', x: -1, z: -1, w: 2, d: 2 }];
    layout.designBook = { activeId: 'alternative', variants: [{ id: 'alternative', name: '另一版', layout: variant }] };
    expect(() => layoutToBackendScene(layout)).toThrow(/本机区域标注/);
    expect(layout.designBook.variants[0].layout.floors[0].zones).toHaveLength(1);
  });
  it('accepts only known preset nodes and still rejects arbitrary local GLBs', () => {
    const layout = backendSceneToLayout(scene());
    layout.scenePreset = 'gym';
    const item = layout.floors[0].items[0];
    Object.assign(item, { type: 'glb-asset', materialId: 'asset', glbUrl: '/scene-presets/gym/gym.glb', glbNode: 'Preset_Object_0' });
    expect(layoutToBackendScene(layout).objects[0].presetNode).toBe(0);
    item.glbNode = 'Preset_Object_307';
    expect(() => layoutToBackendScene(layout)).toThrow('不在已归档的模型中');
    item.glbNode = 'Preset_Object_0'; item.glbUrl = 'https://example.test/custom.glb';
    expect(() => layoutToBackendScene(layout)).toThrow('不在已归档的模型中');
    delete item.glbNode;
    expect(() => layoutToBackendScene(layout)).toThrow('本地模型尚未归档到云端');
  });

  it('swaps a local generated asset for its cloud asset id and stops with an explicit state until uploaded', () => {
    const localAssetId = '00000000-0000-4000-8000-000000000009';
    const cloudAssetId = '00000000-0000-4000-8000-00000000000a';
    const input = scene();
    input.objects[0] = { ...input.objects[0], materialId: 'asset', assetId: localAssetId };
    const layout = backendSceneToLayout(input);
    expect(() => layoutToBackendScene(layout, { localAssetIds: new Set([localAssetId]) })).toThrow('还在本机或上次上传失败');
    expect(layoutToBackendScene(layout, { localAssetIds: new Set([localAssetId]), assetIdMap: { [localAssetId]: cloudAssetId } }).objects[0].assetId).toBe(cloudAssetId);
    // 预览/指纹路径只传映射，不传本机集合，不应因为「还没上云」提前炸掉。
    expect(layoutToBackendScene(layout, { assetIdMap: {} }).objects[0].assetId).toBe(localAssetId);
  });
  it('maps a non-square 30 degree object to identical physical corners in Three.js', () => {
    const input = scene();
    const layout = backendSceneToLayout(input);
    const item = layout.floors[0].items[0];
    expect(layout.width).toBe(10);
    expect(layout.height).toBe(8); // upstream height is footprint depth
    expect(layout.floors[0].height).toBe(3);
    expect(item.rotation).toBeCloseTo(-Math.PI / 6);
    const actual = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => {
      return new Vector3(x * item.width / 2, 0, z * item.depth / 2)
        .applyAxisAngle(new Vector3(0, 1, 0), item.rotation!)
        .add(new Vector3(item.position!.x + 5, 0, item.position!.z + 4));
    });
    corners(input.objects[0]).forEach((expected, i) => {
      expect(actual[i].x).toBeCloseTo(expected.x, 10);
      expect(actual[i].z).toBeCloseTo(expected.z, 10);
    });
    const output = layoutToBackendScene(layout);
    expect(output.venue).toEqual(input.venue);
    expect(output.objects[0].rotation).toBeCloseTo(input.objects[0].rotation, 10);
    expect(output.objects[0].position).toEqual(input.objects[0].position);
    expect(output.objects[0].size).toEqual(input.objects[0].size);
    expect(output.objects[0].notes).toBe('场内已有桌子');
    expect(output.camera).toBe('top');
    expect(output.lighting).toBe('warm');
    expect(output.objects).toHaveLength(1); // structural entrance is not a material
  });

  it('preserves cloud asset IDs and notes through the upstream serialization whitelist', () => {
    const input = scene();
    input.objects[0] = { ...input.objects[0], materialId: 'asset', assetId };
    const layout = backendSceneToLayout(input, { assetUrls: { [assetId]: 'https://example.test/model.glb?token=short' } });
    layout.floors[0].items[0].source = 'generated';
    const reopened = parseStoredLayout(JSON.parse(JSON.stringify(layout)));
    expect(reopened).not.toBeNull();
    const item = reopened!.floors[0].items[0];
    expect(item).toMatchObject({ assetId, materialId: 'asset', notes: '场内已有桌子', source: 'generated' });
    const output = layoutToBackendScene(reopened!);
    expect(output.objects[0]).toMatchObject({ assetId, materialId: 'asset', notes: '场内已有桌子' });
    expect(JSON.stringify(output)).not.toContain('example.test');
    expect(JSON.stringify(output)).not.toContain('glbUrl');
  });

  it.each(['polygon', 'floorplan'] as const)('rejects unsupported %s without mutating input', kind => {
    const input = scene();
    if (kind === 'polygon') {
      input.venue.shape = 'polygon';
      input.venue.polygon = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }];
    } else input.venue.floorplanAssetId = assetId;
    const before = JSON.stringify(input);
    expect(() => backendSceneToLayout(input)).toThrow(SceneAdapterError);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('rejects a local GLB sample on cloud export rather than assigning a fictitious cloud ID', () => {
    const layout = backendSceneToLayout(scene());
    Object.assign(layout.floors[0].items[0], { type: 'glb-asset', glbUrl: '/assets/models/table.glb', materialId: 'asset' });
    expect(() => layoutToBackendScene(layout)).toThrow('本地模型尚未归档到云端');
  });

  it('rejects multistorey, missing entrances and local floorplans instead of dropping them', () => {
    const a = backendSceneToLayout(scene());
    a.floors.push(structuredClone(a.floors[0]));
    expect(() => layoutToBackendScene(a)).toThrow('多层');
    const b = backendSceneToLayout(scene());
    b.floors[0].items = b.floors[0].items.filter(i => !i.venueEntranceId);
    expect(() => layoutToBackendScene(b)).toThrow('出入口');
    const c = backendSceneToLayout(scene());
    c.floorPlanImage = 'data:image/png;base64,AA==';
    expect(() => layoutToBackendScene(c)).toThrow('平面图');
  });

  it('uses backend validation for UUIDs and the 50 object cap', () => {
    const a = backendSceneToLayout(scene());
    a.floors[0].items[0].id = 'old-local-item';
    expect(() => layoutToBackendScene(a)).toThrow('后端校验');
    const b = backendSceneToLayout(scene());
    b.floors[0].items = Array.from({ length: 51 }, (_, i) => ({
      ...b.floors[0].items[0], id: `00000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}`,
    })).concat(b.floors[0].items.filter(i => i.venueEntranceId));
    expect(() => layoutToBackendScene(b)).toThrow('后端校验');
  });
});


describe('backend dimensions survive the editor', () => {
  it('keeps a one-centimetre carpet through both editing paths and save/reopen', () => {
    const input = scene();
    input.objects[0] = { ...input.objects[0], materialId: 'carpet', locked: false,
      size: { width: 2, depth: 3, height: 0.01 } };
    let state: LayoutState = { layout: backendSceneToLayout(input), activeFloorIndex: 0 };
    state = layoutReducer(state, { type: 'resizeItem', id: objectId, dimension: 'height', value: 0.02 });
    state = layoutReducer(state, { type: 'resizeItem', id: objectId, dimension: 'height', value: 0.01 });
    expect(state.layout.floors[0].items[0].height).toBe(0.01);
    state = layoutReducer(state, { type: 'updateItem', id: objectId, patch: { height: 0.01, width: 2.2 } });
    const reopened = parseStoredLayout(JSON.parse(JSON.stringify(state.layout)));
    const output = layoutToBackendScene(reopened!);
    expect(output.objects[0].size).toEqual({ width: 2.2, depth: 3, height: 0.01 });
  });

  it.each([['width', 0.05], ['depth', 0.05], ['height', 0.005]] as const)(
    'refuses backend %s=%s instead of silently enlarging it', (dimension, value) => {
      const input = scene();
      input.objects[0].size[dimension] = value;
      const before = JSON.stringify(input);
      expect(() => backendSceneToLayout(input)).toThrow('原尺寸未改动');
      expect(JSON.stringify(input)).toBe(before);
    },
  );
});


describe('measured venue upgrade preserves the current local activity', () => {
  it('keeps named materials, handoff, asset loading references and floor style while upgrading geometry', () => {
    const input = scene(), modelId = '00000000-0000-4000-8000-000000000004';
    input.objects.push({ ...input.objects[0], id: modelId, materialId: 'asset', assetId,
      position: { x: 7, z: 5 }, notes: '模型原备注' });
    const base = backendSceneToLayout(input, { projectId: 'local-measured-activity', name: '原本机活动',
      assetUrls: { [assetId]: 'https://example.test/model.glb?token=original' } });
    const floor = base.floors[0], table = floor.items.find(item => item.id === objectId)!, model = floor.items.find(item => item.id === modelId)!;
    floor.id = 'local-floor'; floor.name = '交流区'; floor.floorColor = '#bba577'; floor.floorPattern = 'wood';
    Object.assign(table, { name: '演练桌子1', icon: '桌', groupId: 'local-group',
      handoff: handoffSchema.parse({ ownerName: '演练负责人', status: 'doing', evidenceNote: '本机点验前说明' }) });
    Object.assign(model, { name: '演练资产1', icon: '模', groupId: 'asset-group', source: 'generated',
      handoff: handoffSchema.parse({ ownerName: '模型负责人', acceptance: '核对原模型', status: 'todo' }) });
    base.eventOperations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [
      { id: '00000000-0000-4000-8000-000000000005', title: '原活动任务', phase: 'setup', objectIds: [objectId] },
    ] });
    base.productionPlan = productionPlanSchema.parse({ dataKind: 'rehearsal', acquisitions: [
      { id: '00000000-0000-4000-8000-000000000006', title: '原桌子取得计划', objectIds: [objectId], method: 'rental' },
    ] });
    const before = structuredClone(base), next = createMeasuredRoomLayout(base, { width: 11, depth: 8, height: 3.5 });
    expect(base).toEqual(before);
    expect(next).toMatchObject({ id: base.id, name: base.name, width: 11, height: 8,
      eventOperations: base.eventOperations, productionPlan: base.productionPlan });
    expect(next.floors[0]).toMatchObject({ id: floor.id, name: floor.name, floorColor: floor.floorColor, floorPattern: 'wood', height: 3.5 });
    expect(next.floors[0].items.map(item => item.id)).toEqual(floor.items.map(item => item.id));
    expect(next.floors[0].items.find(item => item.id === objectId)).toMatchObject({
      name: table.name, icon: table.icon, groupId: table.groupId, handoff: table.handoff, notes: table.notes,
      position: { x: -3.5, z: -1 },
    });
    expect(next.floors[0].items.find(item => item.id === modelId)).toMatchObject({
      name: model.name, icon: model.icon, groupId: model.groupId, handoff: model.handoff,
      assetId, glbUrl: model.glbUrl, source: 'generated', notes: model.notes, position: { x: 1.5, z: 1 },
    });
    const entrance = next.floors[0].items.find(item => item.id === entranceId)!;
    expect(entrance.venueEntranceId).toBeUndefined();
    expect(entrance).toMatchObject({ structuralOpeningId: entranceId, wallId: expect.any(String), depth: 0.16 });
    const wire = layoutToBackendScene(next);
    expect(wire.schemaVersion).toBe(2); expect(wire.venue).toMatchObject({ width: 11, depth: 8, height: 3.5, entrances: [] });
    expect(wire.objects).toEqual(layoutToBackendScene(before).objects);
    if (wire.schemaVersion !== 2) throw new Error('expected measured v2');
    expect(wire.structure.walls).toHaveLength(4); expect(wire.structure.walls[0]).toMatchObject({ start: { x: 0, z: 0 }, end: { x: 11, z: 0 }, height: 3.5 });
    expect(wire.structure.walls.every(wall=>wall.status==='inferred')).toBe(true);
    expect(wire.structure.openings[0]).toMatchObject({ id: entranceId, offset: 4.1, width: 1.8 });
    expect(wire.finishes).toMatchObject({ floorColor: floor.floorColor, floorPattern: 'wood' });
    expect(JSON.stringify(wire)).not.toMatch(/eventOperations|productionPlan|handoff|glbUrl|original/);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid measured width %s without altering current records', width => {
    const base = backendSceneToLayout(scene()); base.floors[0].items[0].name = '原命名物件';
    const before = structuredClone(base);
    expect(() => createMeasuredRoomLayout(base, { width, depth: 8, height: 3 })).toThrow();
    expect(base).toEqual(before);
  });
});
