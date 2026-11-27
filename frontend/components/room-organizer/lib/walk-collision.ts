/**
 * Walkthrough collision (#156): the first-person walker is a circle in the XZ
 * plane that must not pass through furniture. Everything solid is reduced to an
 * oriented box, and the walker is pushed out of whichever boxes it overlaps,
 * sliding along their faces rather than stopping dead.
 *
 * The footprint clamp in `hooks/use-walkthrough.ts` remains the outer guard:
 * exterior walls are never colliders here.
 */

import { isWallHung } from './mount-band';
import { isWallMounted } from './opening-snap';
import type { FurnitureItem, Vec2 } from './types';

/** One solid box in the XZ plane, in the `lib/geometry` OBB convention. */
export interface WalkCollider {
  cx: number;
  cz: number;
  hw: number;
  hd: number;
  /** Unit axis of the width dimension. */
  ax: number;
  az: number;
  /** Unit axis of the depth dimension. */
  bx: number;
  bz: number;
  /** Rotation-aware AABB half-extents — the cheap broad-phase reject. */
  aabbHalfW: number;
  aabbHalfD: number;
  /** Outdoor items only block a walker who is outside the room. */
  outdoor: boolean;
}

export interface WalkerPosition {
  x: number;
  z: number;
}

export interface WalkCollisionOptions {
  /**
   * Room footprint (metres). Decides whether the walker is inside the room
   * (outdoor items are then ignored) and which wall a door belongs to when it
   * sits at a junction of an interior and an exterior wall.
   */
  roomWidth?: number;
  roomDepth?: number;
}

/**
 * Anything at or under this height goes UNDER furniture by design (rugs are
 * 0.02 m) — the walker steps over it. Mirrors the collision indicator's
 * low-profile layer in `lib/geometry` (#120).
 */
const LOW_PROFILE_MAX_HEIGHT = 0.05;

/**
 * Overshoot on every push-out so the walker settles just clear of the surface
 * and is not re-detected on the next frame (jitter).
 */
const SEPARATION_EPSILON = 1e-4;
/**
 * A move longer than this fraction of the radius is split into substeps so
 * the walker can never cross a thin box's centreline in one go and be pushed
 * out the far side (tunnelling).
 */
const SUBSTEP_FRACTION = 0.5;
const MAX_SUBSTEPS = 64;
/** Push-out passes per axis: a push clear of one box may land in a neighbour. */
const RESOLVE_PASSES = 2;

/**
 * Build the walker's colliders for a floor. Call when the items or walls
 * change — not per frame — and feed the result to `resolveWalkerStep`.
 *
 * Skipped: unplaced items, low-profile items (rugs), wall-plane items
 * (doors, windows, cameras — they live in the wall, and a door is a gap),
 * wall-hung decor (a painting or clock hangs on the wall above the walker's
 * path, #376).
 * Outdoor items are kept but flagged so the resolver can ignore them while
 * the walker is inside the room.
 */
export function buildWalkColliders(
  items: readonly FurnitureItem[]
): WalkCollider[] {
  const colliders: WalkCollider[] = [];
  for (const item of items) {
    if (!item.position) continue;
    if (isWallMounted(item.type) || isWallHung(item.type)) continue;
    if (item.height <= LOW_PROFILE_MAX_HEIGHT) continue;
    // 带路线的人物（PEOPLE-04）会离开锚点行走，锚点处留一个静态碰撞盒会挡住
    // 它自己和其他行走者；人群 NPC 本来就不是碰撞体，同款处理。静态人物照旧是实体。
    if (item.walkRoute && item.walkRoute.points.length >= 2) continue;
    colliders.push(
      boxCollider(
        item.position.x,
        item.position.z,
        item.width,
        item.depth,
        item.rotation ?? 0,
        item.category === 'outdoor'
      )
    );
  }
  return colliders;
}

/**
 * Build one rotated-box collider in the OBB convention. Exported so outdoor
 * facility objects can reuse the same footprint math (see `lib/vehicle-follower-profile.ts`)
 * without duplicating the half-extent / axis derivation.
 */
export function boxCollider(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  rotation: number,
  outdoor: boolean
): WalkCollider {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  // lib/geometry's rotatedHalfExtents, inlined: geometry builds its interior
  // wall boxes from this module, so importing it back would be a cycle.
  const halfW = (width * Math.abs(cos) + depth * Math.abs(sin)) / 2;
  const halfD = (width * Math.abs(sin) + depth * Math.abs(cos)) / 2;
  return {
    cx,
    cz,
    hw: width / 2,
    hd: depth / 2,
    ax: cos,
    az: -sin,
    bx: sin,
    bz: cos,
    aabbHalfW: halfW,
    aabbHalfD: halfD,
    outdoor,
  };
}

/**
 * Advance the walker from `from` toward `to` against prebuilt colliders and
 * write the position it actually reaches into `out` (which is also returned).
 * Allocation-free, so the walkthrough RAF loop can call it every frame.
 *
 * The move is split into substeps no longer than half the radius (no
 * tunnelling through a thin wall), and within each substep the X and Z
 * components are applied and resolved separately, so a diagonal push into a
 * face slides along it and a brushed corner never sticks. A walker that
 * already overlaps a box (a floor switch, furniture dropped on it) is pushed
 * out through the nearest face.
 */
export function resolveWalkerStep(
  colliders: readonly WalkCollider[],
  from: Readonly<WalkerPosition>,
  to: Readonly<WalkerPosition>,
  radius: number,
  out: WalkerPosition,
  options: WalkCollisionOptions = {}
): WalkerPosition {
  const insideRoom = walkerInsideRoom(from, options);
  const totalX = to.x - from.x;
  const totalZ = to.z - from.z;
  const distance = Math.hypot(totalX, totalZ);
  const steps = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(distance / (radius * SUBSTEP_FRACTION))));
  const stepX = totalX / steps;
  const stepZ = totalZ / steps;

  out.x = from.x;
  out.z = from.z;
  for (let i = 0; i < steps; i++) {
    out.x += stepX;
    pushOut(colliders, out, radius, insideRoom);
    out.z += stepZ;
    pushOut(colliders, out, radius, insideRoom);
  }
  return out;
}

/**
 * Convenience wrapper for callers that don't cache colliders: build them from
 * the floor's items and resolve one move. Returns a new position.
 */
export function resolveWalkerPosition(
  from: Vec2,
  to: Vec2,
  radius: number,
  items: readonly FurnitureItem[],
  options: WalkCollisionOptions = {}
): WalkerPosition {
  const colliders = buildWalkColliders(items);
  return resolveWalkerStep(colliders, from, to, radius, { x: from.x, z: from.z }, options);
}

/**
 * Distance (metres) from a ground point to the nearest solid surface a walker
 * would collide with — 0 when the point is inside a box, `Infinity` when there
 * are no colliders. Outdoor boxes are ignored while the point is inside the
 * room, the same rule the resolver applies (`pushOut`), so the value reflects
 * what a walker at that point would actually rub against. Used by route
 * drawing to warn about waypoints placed too close to an obstacle.
 */
export function walkerClearanceAt(
  colliders: readonly WalkCollider[],
  point: Readonly<WalkerPosition>,
  options: WalkCollisionOptions = {}
): number {
  const insideRoom = walkerInsideRoom(point, options);
  let best = Infinity;
  for (const box of colliders) {
    if (box.outdoor && insideRoom) continue;
    const dx = point.x - box.cx;
    const dz = point.z - box.cz;
    const lx = dx * box.ax + dz * box.az;
    const lz = dx * box.bx + dz * box.bz;
    const gapX = Math.max(Math.abs(lx) - box.hw, 0);
    const gapZ = Math.max(Math.abs(lz) - box.hd, 0);
    const dist = Math.hypot(gapX, gapZ);
    if (dist < best) best = dist;
  }
  return best;
}

function walkerInsideRoom(position: Readonly<WalkerPosition>, options: WalkCollisionOptions): boolean {
  const { roomWidth, roomDepth } = options;
  if (roomWidth === undefined || roomDepth === undefined) return false;
  return Math.abs(position.x) <= roomWidth / 2 && Math.abs(position.z) <= roomDepth / 2;
}

function pushOut(
  colliders: readonly WalkCollider[],
  position: WalkerPosition,
  radius: number,
  insideRoom: boolean
): void {
  for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
    let moved = false;
    for (const box of colliders) {
      if (box.outdoor && insideRoom) continue;
      if (pushOutOfBox(box, position, radius)) moved = true;
    }
    if (!moved) return;
  }
}

/**
 * Circle-vs-OBB minimum-translation push. Works in the box's local frame:
 * outside the box the push is along the vector from the closest surface point
 * to the circle centre; a centre inside the box leaves through its nearest
 * face. Returns true when the position was changed.
 */
function pushOutOfBox(box: WalkCollider, position: WalkerPosition, radius: number): boolean {
  const dx = position.x - box.cx;
  const dz = position.z - box.cz;
  // Broad phase: rotation-aware AABB, grown by the radius.
  if (Math.abs(dx) >= box.aabbHalfW + radius || Math.abs(dz) >= box.aabbHalfD + radius) return false;

  const lx = dx * box.ax + dz * box.az;
  const lz = dx * box.bx + dz * box.bz;
  let pushX: number;
  let pushZ: number;
  if (Math.abs(lx) <= box.hw && Math.abs(lz) <= box.hd) {
    const toFaceX = box.hw - Math.abs(lx);
    const toFaceZ = box.hd - Math.abs(lz);
    if (toFaceX <= toFaceZ) {
      pushX = (lx < 0 ? -1 : 1) * (toFaceX + radius + SEPARATION_EPSILON);
      pushZ = 0;
    } else {
      pushX = 0;
      pushZ = (lz < 0 ? -1 : 1) * (toFaceZ + radius + SEPARATION_EPSILON);
    }
  } else {
    const nx = lx - Math.max(-box.hw, Math.min(box.hw, lx));
    const nz = lz - Math.max(-box.hd, Math.min(box.hd, lz));
    const gap = Math.hypot(nx, nz);
    if (gap >= radius) return false;
    const scale = (radius - gap + SEPARATION_EPSILON) / gap;
    pushX = nx * scale;
    pushZ = nz * scale;
  }
  position.x += pushX * box.ax + pushZ * box.bx;
  position.z += pushX * box.az + pushZ * box.bz;
  return true;
}
