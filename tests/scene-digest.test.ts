import { describe, expect, it } from 'vitest';
import { sceneSchema, type Scene } from '../supabase/functions/_shared/domain.ts';
import { inspectZone, renderPlan, sceneDigest } from '../supabase/functions/_shared/scene-digest.ts';
import { scene } from './fixtures.ts';

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function room(): Scene {
  return sceneSchema.parse({
    schemaVersion: 2,
    venue: { shape: 'rectangle', width: 16, depth: 12, height: 3.5, heightSource: 'confirmed', entrances: [{ id: id(90), position: { x: 0, z: 6 }, width: 1.6 }], site: { mainEntrance: { openingId: id(91) } } },
    structure: {
      walls: [
        { id: id(1), start: { x: 0, z: 0 }, end: { x: 16, z: 0 }, thickness: 0.2, height: 3.5, kind: 'exterior', status: 'confirmed' },
        { id: id(2), start: { x: 16, z: 0 }, end: { x: 16, z: 12 }, thickness: 0.2, height: 3.5, kind: 'exterior', status: 'confirmed' },
        { id: id(3), start: { x: 16, z: 12 }, end: { x: 0, z: 12 }, thickness: 0.2, height: 3.5, kind: 'exterior', status: 'confirmed' },
        { id: id(4), start: { x: 0, z: 0 }, end: { x: 0, z: 12 }, thickness: 0.2, height: 3.5, kind: 'exterior', status: 'confirmed' },
      ],
      openings: [
        { id: id(91), wallId: id(4), kind: 'door', offset: 5.2, width: 1.6, height: 2.1, sillHeight: 0, status: 'confirmed' },
        { id: id(92), wallId: id(3), kind: 'window', offset: 6, width: 2, height: 1.2, sillHeight: 1, status: 'confirmed' },
      ],
      columns: [{ id: id(6), position: { x: 5, z: 5 }, size: { width: 0.4, depth: 0.4, height: 3.5 }, rotation: 0, status: 'confirmed' }],
    },
    sources: [], dimensions: [],
    objects: [
      { id: id(21), materialId: 'table', position: { x: 3, z: 3 }, rotation: 0, size: { width: 1.2, depth: 0.6, height: 0.75 }, color: '#ffffff', locked: false, notes: '' },
      { id: id(22), materialId: 'chair', position: { x: 4.2, z: 3 }, rotation: 0, size: { width: 0.5, depth: 0.5, height: 0.85 }, color: '#ffffff', locked: true, notes: '' },
      { id: id(23), materialId: 'carpet', position: { x: 7, z: 5 }, rotation: 0, size: { width: 2, depth: 3, height: 0.01 }, color: '#dddddd', locked: false, notes: '' },
    ],
    camera: 'overview', lighting: 'neutral',
  });
}

describe('the plan overview is a picture the model can reason about', () => {
  it('renders one character per grid cell inside the venue', () => {
    const plan = renderPlan(room());
    expect(plan.lines).toHaveLength(plan.rows);
    expect(plan.lines.every(line => line.length === plan.cols)).toBe(true);
    const drawn = plan.lines.join('\n');
    expect(drawn).toContain('#');          // walls
    expect(drawn).toContain('E');          // entrance
    expect(drawn).toContain('t');          // table
    expect(drawn).toContain('C');          // locked chair is upper-case
    expect(drawn).toContain('O');          // column
    expect(drawn).toContain('=');          // door on the left wall
    expect(plan.legend).toContain('空地');
  });

  it('counts what is actually on the floor', () => {
    const digest = sceneDigest(room());
    expect(digest.venue.width).toBe(16);
    expect(digest.venue.mainEntrance).toBe(id(91));
    expect(digest.structure.walls).toBe(4);
    expect(digest.structure.doors).toBe(1);
    expect(digest.structure.windows).toBe(1);
    expect(digest.structure.columns).toBe(1);
    expect(digest.occupancy.objects).toBe(3);
    expect(digest.occupancy.locked).toBe(1);
    expect(digest.occupancy.footprintArea).toBeCloseTo(6.97, 2);
    expect(digest.occupancy.coveragePercent).toBeCloseTo(3.6, 1);
    expect(digest.occupancy.byMaterial.map(m => m.materialId).sort()).toEqual(['carpet', 'chair', 'table']);
    expect(digest.occupancy.byMaterial.find(m => m.materialId === 'table')?.name).toBe('桌子');
    expect(digest.largestEmptySquare?.meters).toBeGreaterThan(1);
    expect(digest.notes.join(' ')).toContain('find_free_areas');
  });

  it('reads a local rectangle before editing it, with the ids inside', () => {
    const view = inspectZone(room(), { x1: 2, z1: 2, x2: 6, z2: 6 });
    expect(view.cell).toBeLessThanOrEqual(1);
    expect(view.objects.map(o => o.id)).toContain(id(21));
    expect(view.objects.find(o => o.id === id(21))?.name).toBe('桌子');
    expect(view.columns.map(c => c.id)).toContain(id(6));
    expect(view.empty).toBe(false);
    const quiet = inspectZone(room(), { x1: 13, z1: 6, x2: 15, z2: 9 });
    expect(quiet.objects).toEqual([]);
    expect(quiet.empty).toBe(true);
  });

  it('still answers for a v1 scene that has no structural layer', () => {
    const digest = sceneDigest(scene());
    expect(digest.structure).toEqual({ walls: 0, exterior: 0, interior: 0, wallLength: 0, doors: 0, windows: 0, columns: 0 });
    expect(digest.plan.lines.length).toBeGreaterThan(0);
    expect(digest.occupancy.objects).toBe(0);
  });
});
