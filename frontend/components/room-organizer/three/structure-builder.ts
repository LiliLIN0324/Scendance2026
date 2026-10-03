import { layoutGeometryScene } from '../lib/structural-layout';
import { buildFloorMaterial } from './floor-patterns';
import { buildExtrudedWallGeometry } from './interior-walls';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

/** Measured v2 shell: floor polygon and each wall's own thickness, height and holes. */
export function buildStructureShell(THREE: typeof import('three'), scene: ThreeNS.Scene, layout: RoomLayout): void {
  const canonical = layoutGeometryScene(layout);
  const floor = layout.floors[0];
  const points = canonical.venue.polygon ?? [{ x: 0, z: 0 }, { x: layout.width, z: 0 },
    { x: layout.width, z: layout.height }, { x: 0, z: layout.height }];
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    const x = p.x - layout.width / 2, y = -(p.z - layout.height / 2);
    if (!i) shape.moveTo(x, y); else shape.lineTo(x, y);
  });
  shape.closePath();
  const floorMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), buildFloorMaterial(THREE, {
    pattern: floor.floorPattern ?? 'solid', color: floor.floorColor, roomWidth: layout.width, roomDepth: layout.height }));
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  floorMesh.userData.type = 'floor';
  scene.add(floorMesh);
  const signedArea = points.reduce((total, p, i) => {
    const q = points[(i + 1) % points.length]; return total + p.x * q.z - q.x * p.z;
  }, 0);
  for (const wall of canonical.structure.walls) {
    const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const openings = canonical.structure.openings.filter(o => o.wallId === wall.id).map(o => ({
      centerAlongWall: o.offset + o.width / 2 - length / 2,
      bottomFromFloor: o.sillHeight, width: o.width, height: o.height,
    }));
    const geometry = openings.length
      ? buildExtrudedWallGeometry(THREE, length, wall.height, wall.thickness, openings)
      : new THREE.BoxGeometry(length, wall.height, wall.thickness).translate(0, wall.height / 2, 0);
    const source = floor.interiorWalls?.find(w => w.id === wall.id);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: source?.color ?? (wall.status === 'inferred' ? '#d9b97f' : '#e8e1d4'), roughness: 0.86,
    }));
    mesh.position.set((wall.start.x + wall.end.x) / 2 - layout.width / 2, 0,
      (wall.start.z + wall.end.z) / 2 - layout.height / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.castShadow = true; mesh.receiveShadow = true;
    // Shell owns all v2 walls so one rebuild and one disposal cover them.
    mesh.userData.type = 'wall'; mesh.userData.wallId = wall.id;
    mesh.userData.structureKind = wall.kind;
    mesh.userData.normal = { x: (signedArea >= 0 ? dz : -dz) / length, z: (signedArea >= 0 ? -dx : dx) / length };
    scene.add(mesh);
  }
}
