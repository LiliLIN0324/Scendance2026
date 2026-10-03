import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { catalog, corners, type Scene, type SceneObject } from '../../../supabase/functions/_shared/domain';
import { disposeOwnedModel } from '../room-organizer/three/glb-assets';
import { createPreviewObject, createPreviewStructure } from './scene-preview';

describe('read-only scene mesh contract', () => {
  const object: SceneObject = { id: '50000000-0000-4000-8000-000000000001', materialId: 'table', position: { x: 5, z: 3 }, rotation: 32, size: { width: 2, depth: 1, height: .8 }, color: '#ccbbdd', locked: true, notes: 'private' };
  it('uses the same metre origin and positive rotation direction as backend footprints', () => {
    const model = createPreviewObject(object);
    model.updateMatrixWorld(true);
    const actual = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3(x / 2, 0, z / 2).applyMatrix4(model.matrixWorld));
    const expected = corners(object);
    for (let i = 0; i < expected.length; i += 1) {
      expect(actual[i].x).toBeCloseTo(expected[i].x);
      expect(actual[i].z).toBeCloseTo(expected[i].z);
    }
    expect(JSON.stringify(model.userData)).not.toContain('private');
    disposeOwnedModel(model);
  });

  it('renders all eight built-ins grounded within their specified dimensions', () => {
    for (const material of catalog) {
      const model = createPreviewObject({ ...object, materialId: material.id, rotation: 0, size: material.size });
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      expect(bounds.min.y).toBeCloseTo(0);
      expect(size.x).toBeCloseTo(material.size.width);
      expect(size.z).toBeCloseTo(material.size.depth);
      expect(size.y).toBeLessThanOrEqual(material.size.height + .000001);
      expect(size.y).toBeGreaterThan(material.size.height * .9);
      disposeOwnedModel(model);
    }
  });
});

describe('Scene v2 public structure', () => {
  it('keeps elevated object bases at their stored height', () => {
    const model = createPreviewObject({ id: 'object', materialId: 'table', position: { x: 2, z: 3 }, size: { width: 2, depth: 1, height: .8 }, elevation: 1.4, rotation: 0, color: '#ffffff', locked: false, notes: '' });
    expect(new THREE.Box3().setFromObject(model).min.y).toBeCloseTo(1.4);
    disposeOwnedModel(model);
  });
});

it('shows real door and window gaps, wall thickness and rotated columns in backend coordinates', () => {
  const scene: Scene = { schemaVersion: 2, venue: { shape: 'rectangle', width: 12, depth: 10, height: 4, entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral', sources: [], dimensions: [], structure: {
    walls: [{ id: 'wall', start: { x: 2, z: 1 }, end: { x: 2, z: 9 }, thickness: .2, height: 4, kind: 'interior', status: 'confirmed' }],
    openings: [{ id: 'door', wallId: 'wall', kind: 'door', offset: 1, width: 1, height: 2.2, sillHeight: 0, status: 'confirmed' }, { id: 'window', wallId: 'wall', kind: 'window', offset: 4, width: 1, height: 1, sillHeight: 1, status: 'confirmed' }],
    columns: [{ id: 'column', position: { x: 8, z: 6 }, size: { width: .5, depth: 1, height: 3 }, rotation: 90, status: 'confirmed' }],
  } };
  const model = createPreviewStructure(scene); model.updateMatrixWorld(true);
  const wall = model.children[0];
  const hit = (z: number, y: number) => new THREE.Raycaster(new THREE.Vector3(0, y, z), new THREE.Vector3(1, 0, 0)).intersectObject(wall).length;
  expect(hit(2.5, 1)).toBe(0);
  expect(hit(5.5, 1.5)).toBe(0);
  expect(hit(5.5, .5)).toBeGreaterThan(0);
  expect(hit(2.5, 3)).toBeGreaterThan(0);
  const wallBounds = new THREE.Box3().setFromObject(wall);
  expect(wallBounds.min.x).toBeCloseTo(1.9); expect(wallBounds.max.y).toBeCloseTo(4);
  expect(wallBounds.min.z).toBeCloseTo(1); expect(wallBounds.max.z).toBeCloseTo(9);
  const pillar = new THREE.Box3().setFromObject(model.children[1]);
  expect(pillar.getCenter(new THREE.Vector3()).toArray()).toEqual([8, 1.5, 6]);
  expect(pillar.getSize(new THREE.Vector3()).x).toBeCloseTo(1);
  expect(pillar.getSize(new THREE.Vector3()).z).toBeCloseTo(.5);
  disposeOwnedModel(model);
});
