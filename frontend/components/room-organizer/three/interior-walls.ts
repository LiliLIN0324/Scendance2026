import { mergeHoleRects } from './wall-openings';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

/** Opening hole punched through an extruded wall segment. */
interface WallOpeningRect {
  centerAlongWall: number;
  bottomFromFloor: number;
  width: number;
  height: number;
}

/**
 * Extrude a wall segment along +X and punch merged opening rectangles.
 * Shared by the plan footprint indoor-zone walls; the legacy interior-wall
 * mesh renderer and its preview/clear helpers have been retired with the
 * indoor shell, so this file now holds only the shared wall geometry.
 */
export function buildExtrudedWallGeometry(
  THREE: ThreeModule,
  length: number,
  height: number,
  thickness: number,
  openings: readonly WallOpeningRect[],
): ThreeNS.BufferGeometry {
  const halfLen = length / 2;

  // Wall is built lying flat: 2D shape spans (x = along wall, y = vertical),
  // then extruded `thickness` deep. After extrusion we recentre on Z.
  const shape = new THREE.Shape();
  shape.moveTo(-halfLen, 0);
  shape.lineTo(halfLen, 0);
  shape.lineTo(halfLen, height);
  shape.lineTo(-halfLen, height);
  shape.closePath();

  // Merge overlapping openings before punching holes — earcut rejects
  // overlapping holes and yields phantom fill / self-intersecting triangles.
  const rects = openings.map(
    (o) =>
      [
        o.centerAlongWall - o.width / 2,
        o.bottomFromFloor,
        o.centerAlongWall + o.width / 2,
        o.bottomFromFloor + o.height,
      ] as [number, number, number, number]
  );
  for (const [x0, y0, x1, y1] of mergeHoleRects(rects)) {
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
    const hole = new THREE.Path();
    hole.moveTo(x0, y0);
    hole.lineTo(x1, y0);
    hole.lineTo(x1, y1);
    hole.lineTo(x0, y1);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  // Centre the extrude on Z so the wall sits symmetrically around its line.
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}
