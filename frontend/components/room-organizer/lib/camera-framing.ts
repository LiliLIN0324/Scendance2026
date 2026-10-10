import type { PerspectiveCamera } from 'three';

export interface RoomFrameBounds {
  width: number;
  depth: number;
  height: number;
}

export interface ViewportPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_VIEWPORT_PADDING: Readonly<ViewportPadding> = { top: 44, right: 16, bottom: 16, left: 16 };

interface RoomFramingOptions {
  viewport?: { width: number; height: number };
  padding?: Partial<ViewportPadding>;
  orbitTarget?: { x: number; y: number; z: number };
  minDistance?: number;
}

/** Calculate a dolly along camera-local +Z; position, orientation and target stay untouched. */
export function calculateRoomFraming(
  camera: PerspectiveCamera,
  room: RoomFrameBounds,
  { viewport, padding = DEFAULT_VIEWPORT_PADDING, orbitTarget, minDistance = 0 }: RoomFramingOptions = {},
): { dollyOut: number; far: number } | null {
  const { width, depth, height } = room;
  const p = camera.position;
  const q = camera.quaternion;
  const projection = camera.projectionMatrix.elements;
  if (![width, depth, height, camera.near, camera.far, projection[0], projection[5]].every(value => Number.isFinite(value) && value > 0)
    || ![p.x, p.y, p.z, q.x, q.y, q.z, q.w, projection[8], projection[9]].every(Number.isFinite)) return null;

  let left = -1;
  let right = 1;
  let bottom = -1;
  let top = 1;
  if (viewport) {
    if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0)) return null;
    const inset = { ...DEFAULT_VIEWPORT_PADDING, ...padding };
    if (!Object.values(inset).every(value => Number.isFinite(value) && value >= 0)) return null;
    left += 2 * inset.left / viewport.width;
    right -= 2 * inset.right / viewport.width;
    bottom += 2 * inset.bottom / viewport.height;
    top -= 2 * inset.top / viewport.height;
  }

  const slopeLeft = (left + projection[8]) / projection[0];
  const slopeRight = (right + projection[8]) / projection[0];
  const slopeBottom = (bottom + projection[9]) / projection[5];
  const slopeTop = (top + projection[9]) / projection[5];
  // Dolly cannot put the room into an empty viewport or one excluding the optical axis.
  if (!(slopeLeft < 0 && slopeRight > 0 && slopeBottom < 0 && slopeTop > 0)) return null;

  const rightAxis = [1 - 2 * (q.y * q.y + q.z * q.z), 2 * (q.x * q.y + q.z * q.w), 2 * (q.x * q.z - q.y * q.w)];
  const upAxis = [2 * (q.x * q.y - q.z * q.w), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z + q.x * q.w)];
  const backAxis = [2 * (q.x * q.z + q.y * q.w), 2 * (q.y * q.z - q.x * q.w), 1 - 2 * (q.x * q.x + q.y * q.y)];
  let dollyOut = 0;
  let farthestDepth = 0;
  for (const x of [-width / 2, width / 2]) {
    for (const y of [0, height]) {
      for (const z of [-depth / 2, depth / 2]) {
        const dx = x - p.x;
        const dy = y - p.y;
        const dz = z - p.z;
        const screenX = dx * rightAxis[0] + dy * rightAxis[1] + dz * rightAxis[2];
        const screenY = dx * upAxis[0] + dy * upAxis[1] + dz * upAxis[2];
        const viewDepth = -(dx * backAxis[0] + dy * backAxis[1] + dz * backAxis[2]);
        dollyOut = Math.max(dollyOut, camera.near - viewDepth,
          screenX / (screenX < 0 ? slopeLeft : slopeRight) - viewDepth,
          screenY / (screenY < 0 ? slopeBottom : slopeTop) - viewDepth);
        farthestDepth = Math.max(farthestDepth, viewDepth);
      }
    }
  }

  if (orbitTarget && Number.isFinite(minDistance) && minDistance > 0) {
    const dx = p.x - orbitTarget.x;
    const dy = p.y - orbitTarget.y;
    const dz = p.z - orbitTarget.z;
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared < minDistance * minDistance) {
      const alongBack = dx * backAxis[0] + dy * backAxis[1] + dz * backAxis[2];
      dollyOut = Math.max(dollyOut, -alongBack + Math.sqrt(alongBack * alongBack + minDistance * minDistance - distanceSquared));
    }
  }
  // Numerical slack prevents a corner on the boundary triggering another dolly on the next resize.
  if (dollyOut > 0) dollyOut += Math.max(1, dollyOut) * 1e-6;
  const requiredFar = Math.max(farthestDepth + dollyOut, camera.near);
  const far = requiredFar >= camera.far ? requiredFar * (1 + 1e-6) : camera.far;
  return Number.isFinite(dollyOut) && Number.isFinite(far) ? { dollyOut, far } : null;
}
