import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { catalog, corners, type SceneObject } from '../../../supabase/functions/_shared/domain';
import { disposeOwnedModel } from '../room-organizer/three/glb-assets';
import { createPreviewObject } from './scene-preview';

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
