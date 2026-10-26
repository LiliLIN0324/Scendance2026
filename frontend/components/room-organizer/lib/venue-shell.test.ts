import { describe, expect, it } from 'vitest';
import { sceneSchema } from '../../../../supabase/functions/_shared/domain';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';
import { isStructuralMarker, materialCount } from './structural-layout';
import { buildVenueShell, pruneVenueSite, resolveVenueHeight, VENUE_DEFAULT_HEIGHT_M } from './venue-shell';

describe('T-01 venue shell truth', () => {
  it('falls back to the pinned 4 m height and labels it default', () => {
    expect(resolveVenueHeight()).toEqual({ heightM: VENUE_DEFAULT_HEIGHT_M, heightSource: 'default' });
    expect(resolveVenueHeight(3.24)).toEqual({ heightM: 3.2, heightSource: 'confirmed' });
    expect(resolveVenueHeight(0).heightSource).toBe('default');
  });

  it('walls an indoor venue with one main entrance pointing at a real door', () => {
    const shell = buildVenueShell({ widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' });
    expect(shell.venue.height).toBe(VENUE_DEFAULT_HEIGHT_M);
    expect(shell.venue.heightSource).toBe('default');
    expect(shell.structure.walls).toHaveLength(4);
    expect(shell.structure.walls.every(wall => wall.kind === 'exterior')).toBe(true);
    expect(shell.structure.openings).toHaveLength(1);
    const door = shell.structure.openings[0]!;
    expect(shell.venue.site?.mainEntrance?.openingId).toBe(door.id);
    expect(shell.venue.site?.indoorOutdoor).toBe('indoor');
    expect(shell.venue.site?.scale?.confidence).toBe('high');
    expect(sceneSchema.safeParse(shell).success).toBe(true);
  });

  it('only claims confirmed walls when a human gave the scale', () => {
    const stated = buildVenueShell({ widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'typed' });
    expect(stated.structure.walls.every(wall => wall.status === 'confirmed')).toBe(true);
    for (const origin of ['area', 'plan', 'canvas'] as const) {
      const shell = buildVenueShell({ widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: origin });
      expect(shell.structure.walls.every(wall => wall.status === 'inferred'), origin).toBe(true);
      // 尺寸是推的，就不能当成已确认的米数写进尺寸约束。
      expect(shell.dimensions.every(dimension => dimension.status === 'inferred'), origin).toBe(true);
    }
    expect(buildVenueShell({ widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'area' }).venue.site?.scale?.confidence).toBe('medium');
    expect(buildVenueShell({ widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'canvas' }).venue.site?.scale?.confidence).toBe('low');
  });

  it('does not fake walls for an outdoor site and leaves the entrance unset', () => {
    const shell = buildVenueShell({ widthM: 28, depthM: 20, indoorOutdoor: 'outdoor', scaleOrigin: 'stated' });
    expect(shell.structure.walls).toHaveLength(0);
    expect(shell.structure.openings).toHaveLength(0);
    expect(shell.venue.site?.mainEntrance).toBeUndefined();
    expect(shell.venue.site?.indoorOutdoor).toBe('outdoor');
    expect(sceneSchema.safeParse(shell).success).toBe(true);
  });

  it('rejects a scale outside the metre range instead of building nonsense', () => {
    expect(() => buildVenueShell({ widthM: 0.4, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' })).toThrow();
    expect(() => buildVenueShell({ widthM: 900, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' })).toThrow();
  });

  it('survives the editor round trip with the entrance truth attached', () => {
    const shell = buildVenueShell({ widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' });
    const layout = backendSceneToLayout(shell, { name: '品牌沙龙' });
    expect(layout.floors[0]!.height).toBe(VENUE_DEFAULT_HEIGHT_M);
    expect(layout.floors[0]!.items.filter(item => item.structuralOpeningId)).toHaveLength(1);
    const saved = layoutToBackendScene(layout);
    expect(saved.schemaVersion).toBe(2);
    if (saved.schemaVersion !== 2) throw new Error('unreachable');
    expect(saved.venue.site?.mainEntrance?.openingId).toBe(shell.venue.site?.mainEntrance?.openingId);
    expect(saved.venue.height).toBe(VENUE_DEFAULT_HEIGHT_M);
    expect(saved.venue.heightSource).toBe('default');
    expect(saved.structure.walls).toHaveLength(4);
  });

  it('prunes a dangling main entrance on save instead of blocking the save', () => {
    const shell = buildVenueShell({ widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' });
    const layout = backendSceneToLayout(shell, { name: '品牌沙龙' });
    const withoutDoor = {
      ...layout,
      floors: layout.floors.map(floor => ({ ...floor, items: floor.items.filter(item => !item.structuralOpeningId) })),
    };
    const saved = layoutToBackendScene(withoutDoor);
    expect(saved.venue.site?.mainEntrance).toBeUndefined();
    expect(saved.venue.site?.indoorOutdoor).toBe('indoor');
    expect(saved.venue.site?.scale?.confidence).toBe('high');
  });

  it('keeps the entrance marker when the agent clears the floor for a new variant', () => {
    const shell = buildVenueShell({ widthM: 12, depthM: 9, indoorOutdoor: 'indoor', scaleOrigin: 'stated' });
    const layout = backendSceneToLayout(shell, { name: '品牌沙龙' });
    const kept = layout.floors[0]!.items.filter(item => isStructuralMarker(item));
    expect(kept).toHaveLength(1);
    expect(materialCount(kept)).toBe(0);
    const saved = layoutToBackendScene({ ...layout, floors: layout.floors.map(floor => ({ ...floor, items: kept })) });
    if (saved.schemaVersion !== 2) throw new Error('unreachable');
    expect(saved.venue.site?.mainEntrance?.openingId).toBe(shell.venue.site?.mainEntrance?.openingId);
  });

  it('keeps an untouched site block as is', () => {
    const site = { indoorOutdoor: 'indoor' as const, scale: { confidence: 'low' as const } };
    expect(pruneVenueSite(site, ['any'])).toBe(site);
    expect(pruneVenueSite(undefined, [])).toBeUndefined();
    expect(pruneVenueSite({ mainEntrance: { openingId: 'a' }, indoorOutdoor: 'outdoor' }, ['b'])).toEqual({ indoorOutdoor: 'outdoor' });
    expect(pruneVenueSite({ mainEntrance: { openingId: 'a' } }, ['b'])).toBeUndefined();
  });
});
