import { describe, expect, it } from 'vitest';
import { sceneSchema, sceneWarnings, type Scene } from '../supabase/functions/_shared/domain.ts';
import { structuralViolations } from '../supabase/functions/_shared/structural-geometry.ts';
import { findFreeAreas, footprintsIntersect } from '../supabase/functions/_shared/placement-search.ts';
import { footprint } from '../supabase/functions/_shared/structural-geometry.ts';

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A 16x12 m room: four exterior walls with one door, an interior wall with a window, two columns, three objects. */
function room(): Scene {
  return sceneSchema.parse({
    schemaVersion: 2,
    venue: { shape: 'rectangle', width: 16, depth: 12, height: 3.5, entrances: [{ id: id(90), position: { x: 0, z: 6 }, width: 1.6 }] },
    structure: {
      walls: [
        { id: id(1), start: { x: 0, z: 0 }, end: { x: 16, z: 0 }, thickness: 0.2, height: 3.5, kind: 'exterior', status: 'confirmed' },
        { id: id(2), start: { x: 16, z: 0 }, end: { x: 16, z: 12 }, thickness: 0.2, height: 3.5, kind: 'exterior', status: 'confirmed' },
        { id: id(3), start: { x: 16, z: 12 }, end: { x: 0, z: 12 }, thickness: 0.2, height: 3.5, kind: 'exterior', status: 'confirmed' },
        { id: id(4), start: { x: 0, z: 0 }, end: { x: 0, z: 12 }, thickness: 0.2, height: 3.5, kind: 'exterior', status: 'confirmed' },
        { id: id(5), start: { x: 11, z: 0 }, end: { x: 11, z: 12 }, thickness: 0.15, height: 3.5, kind: 'interior', status: 'confirmed' },
      ],
      openings: [{ id: id(91), wallId: id(4), kind: 'door', offset: 5.2, width: 1.6, height: 2.1, sillHeight: 0, status: 'confirmed' }],
      columns: [
        { id: id(6), position: { x: 5, z: 5 }, size: { width: 0.4, depth: 0.4, height: 3.5 }, rotation: 0, status: 'confirmed' },
        { id: id(7), position: { x: 8, z: 9 }, size: { width: 0.4, depth: 0.4, height: 3.5 }, rotation: 0, status: 'confirmed' },
      ],
    },
    sources: [], dimensions: [],
    objects: [
      { id: id(21), materialId: 'table', position: { x: 3, z: 3 }, rotation: 0, size: { width: 1.2, depth: 0.6, height: 0.75 }, color: '#ffffff', locked: false, notes: '' },
      { id: id(22), materialId: 'chair', position: { x: 4.2, z: 3 }, rotation: 0, size: { width: 0.5, depth: 0.5, height: 0.85 }, color: '#ffffff', locked: false, notes: '' },
      { id: id(23), materialId: 'carpet', position: { x: 7, z: 5 }, rotation: 0, size: { width: 2, depth: 3, height: 0.01 }, color: '#dddddd', locked: false, notes: '' },
    ],
    camera: 'overview', lighting: 'neutral',
  });
}

/** The same scene with one extra object, so a returned anchor can be checked against the app's own validator. */
function withProbe(scene: Scene, x: number, z: number, width: number, depth: number): Scene {
  return {
    ...scene,
    objects: [...scene.objects, { id: id(99), materialId: 'table', position: { x, z }, rotation: 0, size: { width, depth, height: 0.75 }, color: '#000000', locked: false, notes: '' }],
  };
}

describe('find_free_areas answers with anchors the editor itself accepts', () => {
  it('returns anchors that pass the same checks a hand-placed object must pass', () => {
    const scene = room();
    const result = findFreeAreas(scene, { width: 1.2, depth: 0.6, clearance: 0.5 });
    expect(result.sites.length).toBeGreaterThan(0);
    expect(result.scanned).toBeGreaterThan(0);
    for (const site of result.sites) {
      const probed = withProbe(scene, site.x, site.z, 1.2, 0.6);
      const warnings = sceneWarnings(probed).filter(w => w.ids.includes(id(99)));
      expect(warnings, `anchor ${site.x},${site.z} produced ${JSON.stringify(warnings)}`).toEqual([]);
      const violations = structuralViolations(probed).filter(v => v.objectId === id(99));
      expect(violations, `anchor ${site.x},${site.z} hit structure`).toEqual([]);
    }
  });

  it('keeps the requested gap from other objects and columns', () => {
    const scene = room();
    const clearance = 0.6;
    const result = findFreeAreas(scene, { width: 0.8, depth: 0.8, clearance });
    expect(result.sites.length).toBeGreaterThan(0);
    const padded = { width: 0.8 + clearance * 2, depth: 0.8 + clearance * 2, height: 1 };
    const obstacles = [
      ...scene.objects.filter(o => o.materialId !== 'carpet').map(o => footprint(o)),
      ...(scene.schemaVersion === 2 ? scene.structure.columns.map(c => footprint(c)) : []),
    ];
    for (const site of result.sites) {
      const probe = footprint({ position: { x: site.x, z: site.z }, rotation: 0, size: padded });
      for (const obstacle of obstacles) expect(footprintsIntersect(probe, obstacle)).toBe(false);
    }
  });

  it('never answers with an anchor in the wall or outside the venue', () => {
    const scene = room();
    const result = findFreeAreas(scene, { width: 3, depth: 0.15, clearance: 0 });
    for (const site of result.sites) {
      expect(site.x).toBeGreaterThan(0.2);
      expect(site.x).toBeLessThan(15.8);
      expect(site.z).toBeGreaterThan(0.2);
      expect(site.z).toBeLessThan(11.8);
    }
  });

  it('ranks by the requested neighbourhood and reports the nearest entrance', () => {
    const scene = room();
    const result = findFreeAreas(scene, { width: 1, depth: 1, near: { x: 15, z: 11 }, clearance: 0.2 });
    expect(result.sites.length).toBeGreaterThan(1);
    const distances = result.sites.map(s => s.distanceToNear ?? Infinity);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(result.sites[0].nearestEntrance?.id).toBe(id(90));
  });

  it('refuses an impossible ask and says what to change instead of offering近邻坐标', () => {
    const result = findFreeAreas(room(), { width: 20, depth: 4 });
    expect(result.sites).toEqual([]);
    expect(result.note).toContain('没有满足条件的落点');
  });

  it('skips an obstacle stacked well above the floor being searched', () => {
    const base = room();
    const elevated: Scene = {
      ...base,
      objects: [...base.objects, { id: id(98), materialId: 'display', position: { x: 13, z: 3 }, rotation: 0, size: { width: 0.8, depth: 0.4, height: 1.8 }, color: '#ffffff', locked: false, notes: '', elevation: 3 }],
    };
    const low = findFreeAreas(base, { width: 1, depth: 1, near: { x: 13, z: 3 }, clearance: 0, limit: 1 });
    const withShelf = findFreeAreas(elevated, { width: 1, depth: 1, near: { x: 13, z: 3 }, clearance: 0, limit: 1 });
    expect(withShelf.sites[0].distanceToNear).toBeCloseTo(low.sites[0].distanceToNear ?? 0, 1);
  });

  it('rejects a non-positive footprint instead of scanning forever', () => {
    expect(() => findFreeAreas(room(), { width: 0, depth: 1 })).toThrowError(/INVALID_SEARCH_SIZE|占地宽和深/);
  });
});
