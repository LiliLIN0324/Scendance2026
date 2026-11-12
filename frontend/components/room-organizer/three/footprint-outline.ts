import { isRoundTable } from '../lib/table-shape';
import type { FurnitureItem } from '../lib/types';
import type * as ThreeNS from 'three';

type OutlineItem = Pick<FurnitureItem, 'tableShape' | 'name' | 'width' | 'depth'>;

/**
 * Edge lines for a footprint. Round tables use the cylinder rim so the
 * top view is a circle; everything else keeps the collision box.
 */
export function footprintEdges(
  THREE: typeof import('three'),
  item: OutlineItem,
  width: number,
  height: number,
  depth: number,
): ThreeNS.BufferGeometry {
  if (isRoundTable(item)) {
    const radius = Math.min(width, depth) / 2;
    const drum = new THREE.CylinderGeometry(radius, radius, height, 48);
    const edges = new THREE.EdgesGeometry(drum);
    drum.dispose();
    return edges;
  }
  const box = new THREE.BoxGeometry(width, height, depth);
  const edges = new THREE.EdgesGeometry(box);
  box.dispose();
  return edges;
}
