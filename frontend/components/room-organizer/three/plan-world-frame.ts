import * as THREE from 'three';
import { worldFromPlanPoint } from '../lib/scan-placement';
import type { RoomLayout } from '../lib/types';
import type { PlanAnchor, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** Map tiles and venue scans share the same anchor, metre scale and orientation. */
export function planWorldMatrix(layout: RoomLayout, anchor: PlanAnchor): THREE.Matrix4 {
  const origin = worldFromPlanPoint(layout, anchor, { x: 0, y: 0 });
  const east = worldFromPlanPoint(layout, anchor, { x: 1, y: 0 });
  const south = worldFromPlanPoint(layout, anchor, { x: 0, y: -1 });
  return new THREE.Matrix4().set(
    east.x - origin.x, 0, south.x - origin.x, origin.x,
    0, 1, 0, 0,
    east.z - origin.z, 0, south.z - origin.z, origin.z,
    0, 0, 0, 1,
  );
}

/** Undo the old room-sized plan projection before placing plan objects on the map. */
export function planShellWorldMatrix(layout: RoomLayout, anchor: PlanAnchor, boundary: readonly PlanPoint[]): THREE.Matrix4 {
  const xs = boundary.map(p => p.x), ys = boundary.map(p => p.y);
  const west = Math.min(...xs), east = Math.max(...xs), south = Math.min(...ys), north = Math.max(...ys);
  const shellToPlan = new THREE.Matrix4().makeScale((east - west) / layout.width, 1, (north - south) / layout.height);
  shellToPlan.setPosition((west + east) / 2, 0, -(south + north) / 2);
  return planWorldMatrix(layout, anchor).multiply(shellToPlan);
}
