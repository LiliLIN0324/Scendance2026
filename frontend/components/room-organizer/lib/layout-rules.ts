import { isLowProfile, itemEntersRect, type KeepOutRect } from './geometry';
import { isWallHung } from './mount-band';
import { isWallMounted } from './opening-snap';
import { entranceGeometry } from './street';
import type { FloorLayout, FurnitureItem, RoomLayout } from './types';
import { buildWalkColliders } from './walk-collision';

/**
 * Business rules a layout must satisfy before an AI proposal may replace the
 * scene or a delivery may be issued. They live here as a registry instead of
 * being sprinkled through the reducer: each issue names the rule, the objects
 * that broke it and where, so the UI can point at the evidence (#rule-registry).
 *
 * They are deliberately NOT enforced on ordinary editing: a designer may be
 * halfway through clearing a doorway, and refusing every keystroke would make
 * the editor unusable. The gates are proposal apply and delivery.
 */
export type LayoutRuleId = 'entrance-clearance' | 'exit-obstruction' | 'main-aisle';

export type LayoutRuleSeverity = 'error' | 'warning';

export interface LayoutRuleIssue {
  rule: LayoutRuleId;
  code: string;
  severity: LayoutRuleSeverity;
  /** Chinese, ready for the notice / delivery report. */
  message: string;
  floorIndex: number;
  /** Items (or the door itself) the evidence points at. */
  objectIds: string[];
  /** What was measured, in metres, for a report or a test. */
  evidence: Record<string, number | string>;
}

/** A clear rectangle a person must be able to walk through. */
interface ClearZone {
  cx: number;
  cz: number;
  width: number;
  depth: number;
  rotation: number;
  /** Unit vector from the door into the room. */
  inwardX: number;
  inwardZ: number;
  doorId: string;
  doorWidth: number;
}

const CLEARANCE_DEPTH = 1.2;
const MIN_CLEAR_WIDTH = 1.2;
const AISLE_HALF_WIDTH = 0.6;
const GRID_CELL = 0.25;

function inwardForWall(wallId: string | undefined, position: { x: number; z: number }, room: RoomLayout): { x: number; z: number } | null {
  if (wallId === 'north') return { x: 0, z: 1 };
  if (wallId === 'south') return { x: 0, z: -1 };
  if (wallId === 'east') return { x: -1, z: 0 };
  if (wallId === 'west') return { x: 1, z: 0 };
  const edgeX = room.width / 2 - Math.abs(position.x);
  const edgeZ = room.height / 2 - Math.abs(position.z);
  if (edgeX <= edgeZ) return { x: position.x > 0 ? -1 : 1, z: 0 };
  return { x: 0, z: position.z > 0 ? -1 : 1 };
}

function isExitDoor(item: FurnitureItem): boolean {
  if (item.type !== 'door') return false;
  return Boolean(item.venueEntranceId || item.structuralOpeningId);
}

function doorZone(item: FurnitureItem, room: RoomLayout): ClearZone | null {
  if (!item.position) return null;
  const inward = inwardForWall(item.wallId, item.position, room);
  if (!inward) return null;
  const width = Math.max(item.width, MIN_CLEAR_WIDTH);
  const alongWall = inward.x !== 0;
  return {
    cx: item.position.x + inward.x * (CLEARANCE_DEPTH / 2),
    cz: item.position.z + inward.z * (CLEARANCE_DEPTH / 2),
    width,
    depth: CLEARANCE_DEPTH,
    // Rotated a quarter turn for side walls: the rectangle's width runs along z.
    rotation: alongWall ? Math.PI / 2 : 0,
    inwardX: inward.x,
    inwardZ: inward.z,
    doorId: item.venueEntranceId ?? item.structuralOpeningId ?? item.id,
    doorWidth: width,
  };
}

function porchZone(layout: RoomLayout, floorIndex: number): ClearZone | null {
  if (!layout.entrance || layout.entrance.door === false) return null;
  const geometry = entranceGeometry(layout.entrance, {
    width: layout.width,
    depth: layout.height,
    floors: layout.floors,
    ...(layout.terrain ? { terrain: layout.terrain } : {}),
  });
  if (!geometry || geometry.floorIndex !== floorIndex) return null;
  return {
    cx: (geometry.x0 + geometry.x1) / 2,
    cz: geometry.backZ + CLEARANCE_DEPTH / 2,
    width: Math.max(geometry.x1 - geometry.x0, MIN_CLEAR_WIDTH),
    depth: CLEARANCE_DEPTH,
    rotation: 0,
    inwardX: 0,
    inwardZ: 1,
    doorId: layout.entrance.door === undefined ? 'entrance' : 'entrance-door',
    doorWidth: geometry.x1 - geometry.x0,
  };
}

function zoneRect(zone: ClearZone): KeepOutRect {
  return {
    x0: zone.cx - zone.width / 2,
    x1: zone.cx + zone.width / 2,
    z0: zone.cz - zone.depth / 2,
    z1: zone.cz + zone.depth / 2,
    ...(zone.rotation ? { rotation: zone.rotation } : {}),
  };
}

function blockers(floor: FloorLayout, zone: ClearZone): FurnitureItem[] {
  return floor.items.filter((item) => {
    if (!item.position) return false;
    if (item.category === 'outdoor') return false;
    if (isLowProfile(item) || isWallHung(item.type) || isWallMounted(item.type)) return false;
    return itemEntersRect(item, zoneRect(zone));
  });
}

function describe(items: readonly FurnitureItem[], limit = 3): string {
  const names = items.slice(0, limit).map((item) => `「${item.name}」`);
  return items.length > limit ? `${names.join('')}等 ${items.length} 件物料` : names.join('');
}

function entranceClearance(layout: RoomLayout, floorIndex: number): LayoutRuleIssue[] {
  const zone = porchZone(layout, floorIndex);
  if (!zone) return [];
  const floor = layout.floors[floorIndex];
  if (!floor) return [];
  const blockedBy = blockers(floor, zone);
  if (blockedBy.length === 0) return [];
  return [{
    rule: 'entrance-clearance',
    code: 'ENTRANCE_BLOCKED',
    severity: 'error',
    message: `门厅净空：主入口内侧 ${CLEARANCE_DEPTH} 米内有${describe(blockedBy)}，请留出通行与疏散空间。`,
    floorIndex,
    objectIds: blockedBy.map((item) => item.id),
    evidence: { doorId: zone.doorId, clearanceDepth: CLEARANCE_DEPTH, blockers: blockedBy.length },
  }];
}

function exitObstruction(layout: RoomLayout, floorIndex: number): LayoutRuleIssue[] {
  const floor = layout.floors[floorIndex];
  if (!floor) return [];
  const issues: LayoutRuleIssue[] = [];
  for (const door of floor.items.filter(isExitDoor)) {
    if (door.venueEntranceId && layout.entrance?.door === false) continue;
    const zone = doorZone(door, layout);
    if (!zone) continue;
    const blockedBy = blockers(floor, zone);
    if (blockedBy.length === 0) continue;
    issues.push({
      rule: 'exit-obstruction',
      code: 'EXIT_BLOCKED',
      severity: 'error',
      message: `出口阻塞：${describe(blockedBy)}挡在出入口「${door.name}」内侧 ${CLEARANCE_DEPTH} 米内，请移开后再交付。`,
      floorIndex,
      objectIds: [door.id, ...blockedBy.map((item) => item.id)],
      evidence: { doorId: door.id, clearanceDepth: CLEARANCE_DEPTH, blockers: blockedBy.length },
    });
  }
  return issues;
}

function doorZones(layout: RoomLayout, floorIndex: number): ClearZone[] {
  const floor = layout.floors[floorIndex];
  if (!floor) return [];
  const porch = porchZone(layout, floorIndex);
  const zones = floor.items
    .filter((item) => isExitDoor(item) && !(item.venueEntranceId && layout.entrance?.door === false))
    .map((item) => doorZone(item, layout))
    .filter((zone): zone is ClearZone => zone !== null);
  return porch ? [porch, ...zones] : zones;
}

/**
 * Distance from a point to an oriented box's surface; 0 inside. The aisle
 * needs its centre at least half an aisle away from every solid, so this is
 * the clearance the grid stores.
 */
function distanceToBox(x: number, z: number, box: { cx: number; cz: number; hw: number; hd: number; ax: number; az: number; bx: number; bz: number }): number {
  const dx = x - box.cx;
  const dz = z - box.cz;
  const alongWidth = Math.abs(dx * box.ax + dz * box.az) - box.hw;
  const alongDepth = Math.abs(dx * box.bx + dz * box.bz) - box.hd;
  const outsideWidth = Math.max(0, alongWidth);
  const outsideDepth = Math.max(0, alongDepth);
  return Math.hypot(outsideWidth, outsideDepth);
}

function mainAisle(layout: RoomLayout, floorIndex: number): LayoutRuleIssue[] {
  const floor = layout.floors[floorIndex];
  if (!floor) return [];
  const zones = doorZones(layout, floorIndex);
  if (zones.length === 0) return [];

  const halfWidth = layout.width / 2;
  const halfDepth = layout.height / 2;
  const cols = Math.max(1, Math.ceil(layout.width / GRID_CELL));
  const rows = Math.max(1, Math.ceil(layout.height / GRID_CELL));
  const blocked = new Uint8Array(cols * rows);
  const colliders = buildWalkColliders(
    floor.items,
    layout.backendSceneV2 ? [] : floor.interiorWalls ?? [],
    { roomWidth: layout.width, roomDepth: layout.height }
  ).filter((collider) => !collider.outdoor && collider.hw > 0 && collider.hd > 0);

  const cellX = (col: number): number => -halfWidth + (col + 0.5) * GRID_CELL;
  const cellZ = (row: number): number => -halfDepth + (row + 0.5) * GRID_CELL;

  for (let row = 0; row < rows; row++) {
    const z = cellZ(row);
    for (let col = 0; col < cols; col++) {
      const x = cellX(col);
      // Keep the aisle off the walls too.
      if (Math.abs(x) > halfWidth - AISLE_HALF_WIDTH || Math.abs(z) > halfDepth - AISLE_HALF_WIDTH) {
        blocked[row * cols + col] = 1;
        continue;
      }
      for (const collider of colliders) {
        if (distanceToBox(x, z, collider) < AISLE_HALF_WIDTH - 1e-9) {
          blocked[row * cols + col] = 1;
          break;
        }
      }
    }
  }

  const column = (x: number): number => Math.max(0, Math.min(cols - 1, Math.floor((x + halfWidth) / GRID_CELL)));
  const row = (z: number): number => Math.max(0, Math.min(rows - 1, Math.floor((z + halfDepth) / GRID_CELL)));

  const queue: number[] = [];
  const seen = new Uint8Array(cols * rows);
  for (const zone of zones) {
    const alongWall = zone.inwardX !== 0;
    const spanX = alongWall ? zone.depth / 2 : zone.width / 2;
    const spanZ = alongWall ? zone.width / 2 : zone.depth / 2;
    for (let z = zone.cz - spanZ; z <= zone.cz + spanZ; z += GRID_CELL / 2) {
      for (let x = zone.cx - spanX; x <= zone.cx + spanX; x += GRID_CELL / 2) {
        const index = row(z) * cols + column(x);
        if (blocked[index] || seen[index]) continue;
        seen[index] = 1;
        queue.push(index);
      }
    }
  }

  let reached = false;
  for (let head = 0; head < queue.length && !reached; head++) {
    const index = queue[head]!;
    const col = index % cols;
    const gridRow = Math.floor(index / cols);
    const x = cellX(col);
    const z = cellZ(gridRow);
    // The aisle must cross at least the middle of the room: shallow dimmers
    // that only clear the door do not count as a main aisle.
    if (zones.some((zone) => x * zone.inwardX + z * zone.inwardZ >= 0)) {
      reached = true;
      break;
    }
    const neighbours = [
      gridRow > 0 ? index - cols : -1,
      gridRow < rows - 1 ? index + cols : -1,
      col > 0 ? index - 1 : -1,
      col < cols - 1 ? index + 1 : -1,
    ];
    for (const neighbour of neighbours) {
      if (neighbour < 0 || blocked[neighbour] || seen[neighbour]) continue;
      seen[neighbour] = 1;
      queue.push(neighbour);
    }
  }

  if (reached) return [];
  return [{
    rule: 'main-aisle',
    code: 'AISLE_BLOCKED',
    severity: 'error',
    message: `主通道不贯通：从出入口到场地中部没有 ${MIN_CLEAR_WIDTH} 米宽的空隙，请调整家具或隔墙。`,
    floorIndex,
    objectIds: [],
    evidence: { aisleWidth: MIN_CLEAR_WIDTH, entrances: zones.length, grid: GRID_CELL },
  }];
}

export interface LayoutRule {
  id: LayoutRuleId;
  severity: LayoutRuleSeverity;
  check(layout: RoomLayout, floorIndex: number): LayoutRuleIssue[];
}

export const LAYOUT_RULES: readonly LayoutRule[] = [
  { id: 'entrance-clearance', severity: 'error', check: entranceClearance },
  { id: 'exit-obstruction', severity: 'error', check: exitObstruction },
  { id: 'main-aisle', severity: 'error', check: mainAisle },
];

/** Every issue on one floor; callers gate on `severity === 'error'`. */
export function checkLayoutRules(layout: RoomLayout, floorIndex = 0): LayoutRuleIssue[] {
  return LAYOUT_RULES.flatMap((rule) => rule.check(layout, floorIndex));
}

/** Every error on every floor (deliveries and proposal applies check the whole house). */
export function layoutRuleErrors(layout: RoomLayout): LayoutRuleIssue[] {
  return layout.floors.flatMap((_, floorIndex) =>
    checkLayoutRules(layout, floorIndex).filter((issue) => issue.severity === 'error')
  );
}
