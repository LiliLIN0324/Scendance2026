import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FURNITURE_CATALOG } from '../../lib/constants';
import { createFurnitureModel } from '../furniture-builders';
import type { FurnitureItem } from '../../lib/types';

function place(entry: { type: string; name: string; width: number; depth: number; height: number; color: string; icon: string; tableShape?: 'round' | 'rect' }): FurnitureItem {
  return { ...entry, id: entry.name, position: { x: 0, z: 0 }, rotation: 0, category: 'tables', price: 0 };
}

describe('banquet round table mesh', () => {
  it('keeps a rectangular dining table as a slab', () => {
    const entry = FURNITURE_CATALOG.find(item => item.name === 'Dining Table')!;
    const model = createFurnitureModel(THREE, place(entry), false);
    const boxes: THREE.BoxGeometry[] = [];
    model.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry.type === 'BoxGeometry') boxes.push(mesh.geometry as THREE.BoxGeometry);
      expect(mesh.userData.part).not.toBe('round-top');
    });
    expect(boxes.some(box => box.parameters.width === entry.width && box.parameters.depth === entry.depth)).toBe(true);
  });

  it('builds a named 圆桌 as a cylinder even when an older layout omitted tableShape', () => {
    const model = createFurnitureModel(THREE, place({
      type: 'dining-table', name: '圆桌', width: 1.8, depth: 1.8, height: 0.7, color: '#A0522D', icon: '🟫',
    }), false);
    model.updateMatrixWorld(true);
    let top: THREE.Mesh | undefined;
    model.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.part === 'round-top') top = mesh;
    });
    expect(top?.geometry.type).toBe('CylinderGeometry');
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1.8, 2);
    expect(size.z).toBeCloseTo(1.8, 2);
    expect(size.y).toBeCloseTo(0.7, 2);
    expect(new THREE.Box3().setFromObject(model).min.y).toBeCloseTo(0, 2);
  });
});
