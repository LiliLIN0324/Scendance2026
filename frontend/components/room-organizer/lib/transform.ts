import { MAX_ITEM_DIMENSION, MIN_ITEM_FOOTPRINT } from './constants';
import type { FurnitureItem } from './types';

/**
 * Gizmo modes for the 3D/2D transform drag (#P0-3). "move" is the plain
 * ground-plane drag the editor already had; "rotate" turns the item under the
 * pointer like a dial; "scale" grows it radially. The property panel stays the
 * numeric fallback for every mode.
 */
export type GizmoMode = 'move' | 'rotate' | 'scale';

/** Rotation snaps to 15° — the angle step planners actually use for walls and rows. */
export const ROTATE_SNAP_RAD = Math.PI / 12;
/** Radii shorter than this cannot define a stable dial/distance (m). */
const MIN_RADIUS_M = 0.25;
/** Scale snaps to 5 cm so hand-dragged sizes stay on round numbers (m). */
const SCALE_STEP_M = 0.05;
/** The gizmo scales within these multiples of the base footprint; beyond them it clamps. */
export const MIN_SCALE_RATIO = 0.2;
export const MAX_SCALE_RATIO = 5;
export type ScaleLimit = 'min' | 'max';

export interface TransformResult {
  rotation: number;
  width: number;
  depth: number;
  /** Set while the scale ratio sits outside 0.2×–5× (drives the visible notice). */
  limit: ScaleLimit | null;
}

export interface TransformSession extends TransformResult {
  itemId: string;
  centerX: number;
  centerZ: number;
  baseRotation: number;
  baseWidth: number;
  baseDepth: number;
  /** First move fixes the dial angle and the baseline radius. */
  started: boolean;
  startAngle: number;
  startDistance: number;
  /** True once the gesture actually changed rotation or size. */
  moved: boolean;
}

function normalizeAngle(rad: number): number {
  const turns = rad / (Math.PI * 2);
  return (turns - Math.floor(turns)) * Math.PI * 2;
}

/** Shortest distance between two angles, in radians (handles the 0/2π seam). */
function angularDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a - b));
  return Math.min(diff, Math.PI * 2 - diff);
}

/** Three's rotateY maps local +X to (cos, −sin), so the pointer angle is atan2(−dz, dx). */
function pointerAngle(x: number, z: number, centerX: number, centerZ: number): number {
  return Math.atan2(-(z - centerZ), x - centerX);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function clampSize(value: number): number {
  return Math.min(MAX_ITEM_DIMENSION, Math.max(MIN_ITEM_FOOTPRINT, value));
}

/** Build the state a rotate/scale drag mutates; null when the item has no position. */
export function createTransformSession(item: FurnitureItem): TransformSession | null {
  if (!item.position) return null;
  const rotation = item.rotation ?? 0;
  return {
    itemId: item.id,
    centerX: item.position.x,
    centerZ: item.position.z,
    baseRotation: rotation,
    baseWidth: item.width,
    baseDepth: item.depth,
    rotation,
    width: item.width,
    depth: item.depth,
    started: false,
    startAngle: 0,
    startDistance: 0,
    moved: false,
    limit: null,
  };
}

/**
 * Feed the pointer's world point to a rotate/scale session and return the
 * candidate transform. Pure except for the session's baseline fields — both
 * the 2D ghost repaint and use-item-drag call it with the same points so the
 * preview and the committed value always agree.
 */
export function advanceTransformSession(
  session: TransformSession,
  x: number,
  z: number,
  mode: Exclude<GizmoMode, 'move'>,
  snapAngle = true
): TransformResult {
  const dx = x - session.centerX;
  const dz = z - session.centerZ;
  const distance = Math.max(Math.hypot(dx, dz), MIN_RADIUS_M);

  if (!session.started) {
    session.started = true;
    session.startAngle = pointerAngle(x, z, session.centerX, session.centerZ);
    session.startDistance = distance;
    return session;
  }

  if (mode === 'rotate') {
    session.limit = null;
    const delta = pointerAngle(x, z, session.centerX, session.centerZ) - session.startAngle;
    const raw = normalizeAngle(session.baseRotation + delta);
    const rotation = snapAngle ? normalizeAngle(Math.round(raw / ROTATE_SNAP_RAD) * ROTATE_SNAP_RAD) : raw;
    if (angularDistance(rotation, session.baseRotation) > ROTATE_SNAP_RAD / 3) session.moved = true;
    session.rotation = rotation;
    return session;
  }

  const rawRatio = 1 + (distance - session.startDistance) / session.startDistance;
  const ratio = Math.max(MIN_SCALE_RATIO, Math.min(MAX_SCALE_RATIO, rawRatio));
  session.limit = rawRatio > MAX_SCALE_RATIO ? 'max' : rawRatio < MIN_SCALE_RATIO ? 'min' : null;
  const width = clampSize(roundTo(session.baseWidth * ratio, SCALE_STEP_M));
  const depth = clampSize(roundTo(session.baseDepth * ratio, SCALE_STEP_M));
  if (Math.abs(width - session.baseWidth) > SCALE_STEP_M * 0.6 || Math.abs(depth - session.baseDepth) > SCALE_STEP_M * 0.6) {
    session.moved = true;
  }
  session.width = width;
  session.depth = depth;
  return session;
}

/** One member of a multi-selection scaled as a group. */
export interface GroupScaleMember {
  id: string;
  baseX: number;
  baseZ: number;
  baseWidth: number;
  baseDepth: number;
}

export interface GroupScaleSession {
  members: GroupScaleMember[];
  /** Centroid the group grows/shrinks around. */
  centerX: number;
  centerZ: number;
  started: boolean;
  startDistance: number;
  ratio: number;
  limit: ScaleLimit | null;
  moved: boolean;
  result: GroupScaleMemberFrame[];
}

export interface GroupScaleMemberFrame {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  scaleX: number;
  scaleZ: number;
}

export interface GroupScaleResult {
  ratio: number;
  limit: ScaleLimit | null;
  moved: boolean;
  members: GroupScaleMemberFrame[];
}

function groupFrame(session: GroupScaleSession, ratio: number): GroupScaleMemberFrame[] {
  return session.members.map((member) => {
    const width = clampSize(roundTo(member.baseWidth * ratio, SCALE_STEP_M));
    const depth = clampSize(roundTo(member.baseDepth * ratio, SCALE_STEP_M));
    return {
      id: member.id,
      x: session.centerX + (member.baseX - session.centerX) * ratio,
      z: session.centerZ + (member.baseZ - session.centerZ) * ratio,
      width,
      depth,
      scaleX: width / member.baseWidth,
      scaleZ: depth / member.baseDepth,
    };
  });
}

/** Build the group-scale state for a multi-selection (single-item uses the dial session). */
export function createGroupScaleSession(items: readonly FurnitureItem[]): GroupScaleSession | null {
  const members: GroupScaleMember[] = [];
  for (const item of items) {
    if (!item.position) continue;
    members.push({
      id: item.id,
      baseX: item.position.x,
      baseZ: item.position.z,
      baseWidth: item.width,
      baseDepth: item.depth,
    });
  }
  if (members.length < 2) return null;
  let centerX = 0;
  let centerZ = 0;
  for (const member of members) {
    centerX += member.baseX;
    centerZ += member.baseZ;
  }
  centerX /= members.length;
  centerZ /= members.length;
  const session: GroupScaleSession = {
    members,
    centerX,
    centerZ,
    started: false,
    startDistance: 0,
    ratio: 1,
    limit: null,
    moved: false,
    result: [],
  };
  session.result = groupFrame(session, 1);
  return session;
}

/**
 * Feed the pointer to a group-scale session. Every member grows by the same
 * ratio and its centre moves away from the group centroid by that ratio, so
 * the arrangement keeps its proportions (matching keyboard group rotation).
 */
export function advanceGroupScaleSession(session: GroupScaleSession, x: number, z: number): GroupScaleResult {
  const distance = Math.max(Math.hypot(x - session.centerX, z - session.centerZ), MIN_RADIUS_M);
  if (!session.started) {
    session.started = true;
    session.startDistance = distance;
    session.ratio = 1;
    session.limit = null;
    session.result = groupFrame(session, 1);
    return { ratio: 1, limit: null, moved: session.moved, members: session.result };
  }
  const rawRatio = 1 + (distance - session.startDistance) / session.startDistance;
  const ratio = Math.max(MIN_SCALE_RATIO, Math.min(MAX_SCALE_RATIO, rawRatio));
  session.limit = rawRatio > MAX_SCALE_RATIO ? 'max' : rawRatio < MIN_SCALE_RATIO ? 'min' : null;
  session.ratio = ratio;
  session.result = groupFrame(session, ratio);
  session.moved = Math.abs(ratio - 1) > 1e-4;
  return { ratio, limit: session.limit, moved: session.moved, members: session.result };
}

/** Item corners in world XZ, same convention as the 2D hit test (lib/geometry). */
export function itemCorners(item: FurnitureItem): Array<{ x: number; z: number }> {
  const position = item.position ?? { x: 0, z: 0 };
  const cos = Math.cos(item.rotation ?? 0);
  const sin = Math.sin(item.rotation ?? 0);
  const halfW = item.width / 2;
  const halfD = item.depth / 2;
  return [
    { x: position.x + halfW * cos - halfD * sin, z: position.z - halfW * sin - halfD * cos },
    { x: position.x + halfW * cos + halfD * sin, z: position.z - halfW * sin + halfD * cos },
    { x: position.x - halfW * cos + halfD * sin, z: position.z + halfW * sin + halfD * cos },
    { x: position.x - halfW * cos - halfD * sin, z: position.z + halfW * sin - halfD * cos },
  ];
}

/** Does the item (centre or any corner) fall inside the marquee rectangle? */
export function itemInsideRect(
  item: FurnitureItem,
  rect: { x: number; z: number; w: number; d: number }
): boolean {
  const inside = (point: { x: number; z: number }): boolean =>
    point.x >= rect.x && point.x <= rect.x + rect.w && point.z >= rect.z && point.z <= rect.z + rect.d;
  if (item.position && inside(item.position)) return true;
  return itemCorners(item).some(inside);
}
