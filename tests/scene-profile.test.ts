import { describe, expect, it } from 'vitest';
import { buildSceneProfiles, MAX_OBJECT_PROFILES, objectProfileRequestSchema } from '../supabase/functions/_shared/scene-profile.ts';
import { sceneSchema, type Scene } from '../supabase/functions/_shared/domain.ts';
import { scene as baseScene, chair } from './fixtures.ts';

const missingA = 'aaaaaaaa-0000-4000-8000-000000000001';
const missingB = 'bbbbbbbb-0000-4000-8000-000000000002';

function build(objects: unknown[], extra: Record<string, unknown> = {}): Scene {
  return sceneSchema.parse({ ...baseScene(), objects, ...extra });
}
const profileOf = (result: ReturnType<typeof buildSceneProfiles>, id: string) => result.profiles.find(profile => profile.id === id)!;

describe('buildSceneProfiles', () => {
  it('dedupes requested IDs and reports missing instances without inventing them', () => {
    const first = chair('保留备注'), second = chair();
    const draft = build([first, second]);
    const result = buildSceneProfiles(draft, [first.id, second.id, first.id.toUpperCase(), missingA, missingB, missingA]);

    expect(result.requestedCount).toBe(4);
    expect(result.returnedCount).toBe(2);
    expect(result.missingIds).toEqual([missingA, missingB]);
    expect(result.profiles.map(profile => profile.id)).toEqual([first.id, second.id]);
    expect(result.truncated).toBe(false);
    expect(result.profiles.some(profile => profile.id === missingA)).toBe(false);
  });

  it('keeps locked/notes/elevation and labels catalog defaults versus user sizes', () => {
    const locked = { ...chair('保留备注'), locked: true, rotation: 45, elevation: 0.5 };
    const resized = { ...chair(), size: { width: 0.7, depth: 0.5, height: 0.85 } };
    const result = buildSceneProfiles(build([locked, resized]), [locked.id, resized.id]);
    const kept = profileOf(result, locked.id), changed = profileOf(result, resized.id);

    expect(kept).toMatchObject({ name: '椅子', materialId: 'chair', locked: true, rotation: 45, elevation: 0.5, notes: '保留备注', source: 'catalog' });
    expect(kept.sizeMeters).toEqual({ width: 0.5, depth: 0.5, height: 0.85 });
    expect(kept.dataQuality).toMatchObject({ name: 'catalog', size: 'catalog-default', elevation: 'user-input', relations: 'derived' });
    expect(changed.dataQuality.size).toBe('user-input');
    expect(changed.name).toBe('椅子');
  });

  it('caps a 60-instance preset request at 50 and reports the omitted existing IDs', () => {
    const objects = Array.from({ length: 60 }, (_, index) => ({ ...chair(), materialId: 'asset', presetNode: index }));
    const draft = build(objects, { scenePreset: 'gym' });
    const requested = draft.objects.map(object => object.id);
    const result = buildSceneProfiles(draft, [...requested, requested[0]]);

    expect(result.requestedCount).toBe(60);
    expect(result.profiles).toHaveLength(MAX_OBJECT_PROFILES);
    expect(result.omittedIds).toEqual(requested.slice(MAX_OBJECT_PROFILES));
    expect(result.truncated).toBe(true);
    expect(result.preset).toBe('gym');
    const first = result.profiles[0];
    expect(first).toMatchObject({ id: requested[0], source: 'preset', group: 'gym' });
    expect(first.dataQuality.name).toBe('preset-label');
    expect(typeof first.name).toBe('string');
  });

  it('measures XZ overlaps and venue-boundary overruns', () => {
    const inside = { ...chair(), position: { x: 2, z: 2 } };
    const neighbour = { ...chair(), position: { x: 2.2, z: 2 } };
    const outside = { ...chair(), position: { x: 11.9, z: 9.9 } };
    const draft = build([inside, neighbour, outside]);
    const result = buildSceneProfiles(draft, [inside.id, neighbour.id, outside.id]);
    const insideProfile = profileOf(result, inside.id), outsideProfile = profileOf(result, outside.id);

    expect(insideProfile.relations.outOfBounds).toMatchObject({ measured: true, outside: false });
    expect(insideProfile.relations.overlaps).toHaveLength(1);
    expect(insideProfile.relations.overlaps[0].objectId).toBe(neighbour.id);
    expect(insideProfile.relations.overlaps[0].penetrationMeters).toBeCloseTo(0.3, 6);
    expect(insideProfile.relations.overlapCount).toBe(1);
    expect(profileOf(result, neighbour.id).relations.overlaps.map(overlap => overlap.objectId)).toContain(inside.id);
    expect(outsideProfile.relations.outOfBounds).toMatchObject({ measured: true, outside: true });
    expect(outsideProfile.relations.overlaps).toEqual([]);
  });

  it('reports nearest entrance distance only when entrance data exists', () => {
    const entranceId = crypto.randomUUID();
    const object = { ...chair(), position: { x: 1, z: 5 } };
    const withEntrance = build([object], {
      venue: { ...baseScene().venue, entrances: [{ id: entranceId, position: { x: 0, z: 5 }, width: 1 }] },
    });
    const withoutEntrance = build([object]);

    const measured = buildSceneProfiles(withEntrance, [object.id]).profiles[0].relations.nearestEntrance;
    expect(measured).toMatchObject({ measured: true, entranceId });
    expect(measured!.distanceMeters).toBeCloseTo(0.75, 6);
    expect(buildSceneProfiles(withoutEntrance, [object.id]).profiles[0].relations.nearestEntrance).toBeNull();
  });

  it('names resources and marks resource-default versus user sizes, without fabricating names', () => {
    const assetId = crypto.randomUUID();
    const asset = { ...chair(), materialId: 'asset', assetId, size: { width: 1.2, depth: 0.7, height: 0.75 } };
    const draft = build([asset]);
    const resources = [{ resourceId: 'library:test', assetId, name: '测试资源', category: 'table', size: { width: 1.2, depth: 0.7, height: 0.75 } }];

    const bare = buildSceneProfiles(draft, [asset.id]);
    expect(bare.profiles[0]).toMatchObject({ id: asset.id, assetId, name: null, source: 'asset' });
    expect(bare.profiles[0].dataQuality).toMatchObject({ name: 'unknown', size: 'unknown' });

    const named = buildSceneProfiles(draft, [asset.id], resources);
    expect(named.profiles[0].name).toBe('测试资源');
    expect(named.profiles[0].dataQuality).toMatchObject({ name: 'resource-library', size: 'catalog-default' });

    const resized = { ...asset, size: { width: 1.4, depth: 0.7, height: 0.75 } };
    const changed = buildSceneProfiles(build([resized]), [resized.id], resources);
    expect(changed.profiles[0].dataQuality.size).toBe('user-input');
    expect(changed.profiles[0].name).toBe('测试资源');
  });

  it('returns a compact, JSON-safe profile without price/stock/supplier/load fields or the whole scene', () => {
    const asset = { ...chair('现场备注'), materialId: 'asset', assetId: crypto.randomUUID(), position: { x: 4, z: 4 } };
    const result = buildSceneProfiles(build([asset, chair()]), [asset.id]);

    expect(result).not.toHaveProperty('scene');
    expect(result).not.toHaveProperty('objects');
    expect(result.profiles).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    const allowed = new Set(['id', 'name', 'materialId', 'assetId', 'presetNode', 'source', 'group', 'wall', 'sizeMeters', 'position', 'rotation', 'locked', 'elevation', 'notes', 'relations', 'dataQuality']);
    expect(Object.keys(result.profiles[0]).every(key => allowed.has(key))).toBe(true);
    expect(Object.keys(result.profiles[0].relations).sort()).toEqual(['nearestEntrance', 'outOfBounds', 'overlapCount', 'overlaps']);
    expect(result.profiles[0].relations.outOfBounds.measured).toBe(true);
    expect(result.profiles[0].relations.overlaps).toEqual([]);
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of ['"price"', '"stock"', '"supplier"', '"loadbearing"', '"inventory"', '"cost"']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('accepts only 1..50 UUIDs in the tool argument schema', () => {
    const ids = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect(objectProfileRequestSchema.safeParse({ objectIds: [ids[0]] }).success).toBe(true);
    expect(objectProfileRequestSchema.safeParse({ objectIds: ids.slice(0, 50) }).success).toBe(true);
    expect(objectProfileRequestSchema.safeParse({ objectIds: [] }).success).toBe(false);
    expect(objectProfileRequestSchema.safeParse({ objectIds: ids }).success).toBe(false);
    expect(objectProfileRequestSchema.safeParse({ objectIds: ['not-a-uuid'] }).success).toBe(false);
  });
});
