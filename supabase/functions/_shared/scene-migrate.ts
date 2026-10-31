import { sceneSchema, type Point, type SceneV2 } from './domain.ts';

/**
 * Explicit, deterministic upgrades between saved Scene versions.
 *
 * Version 2 adds a structure layer, but nothing here invents a wall that the
 * saved venue does not already imply. Perimeter walls follow the explicit
 * venue boundary, entrances become inferred door openings on those walls, and
 * everything else (objects, camera, lighting, preset, sources) is preserved.
 * Anything that would need human measurement - interior walls, main-entrance
 * status, dimension calibration - is deliberately left absent.
 */
export class SceneMigrationError extends Error {
  constructor(public readonly code: 'INVALID_SCENE' | 'ENTRANCE_REQUIRES_REVIEW', message: string) {
    super(message);
    this.name = 'SceneMigrationError';
  }
}

export const LATEST_SCENE_VERSION = 2 as const;

export interface SceneMigrationResult {
  scene: SceneV2;
  fromVersion: 1 | 2;
  toVersion: 2;
  changed: boolean;
  notes: string[];
}

const EPS = 1e-8;

function boundaryPoints(venue: SceneV2['venue']): Point[] {
  return venue.polygon ?? [
    { x: 0, z: 0 }, { x: venue.width, z: 0 },
    { x: venue.width, z: venue.depth }, { x: 0, z: venue.depth },
  ];
}

function onSegment(point: Point, start: Point, end: Point): boolean {
  const cross = (end.x - start.x) * (point.z - start.z) - (end.z - start.z) * (point.x - start.x);
  return Math.abs(cross) < EPS
    && point.x >= Math.min(start.x, end.x) - EPS && point.x <= Math.max(start.x, end.x) + EPS
    && point.z >= Math.min(start.z, end.z) - EPS && point.z <= Math.max(start.z, end.z) + EPS;
}

interface EntranceSeat { edge: number; offset: number; along: number }

/** Seat an entrance on the first boundary edge that can contain its full width. */
function seatEntrance(boundary: readonly Point[], entrance: SceneV2['venue']['entrances'][number]): EntranceSeat | null {
  for (let edge = 0; edge < boundary.length; edge++) {
    const start = boundary[edge]!, end = boundary[(edge + 1) % boundary.length]!;
    if (!onSegment(entrance.position, start, end)) continue;
    const dx = end.x - start.x, dz = end.z - start.z, length = Math.hypot(dx, dz);
    if (length < EPS) continue;
    const along = ((entrance.position.x - start.x) * dx + (entrance.position.z - start.z) * dz) / length;
    const offset = along - entrance.width / 2;
    if (offset < -EPS || offset + entrance.width > length + EPS) continue;
    return { edge, offset: Math.min(Math.max(0, offset), length - entrance.width), along };
  }
  return null;
}

/** Synchronous 128-bit name hash so migrated IDs are stable across reloads and clients. */
function nameUuid(seed: string): string {
  const fnv = (text: string, offset: bigint): bigint => {
    let value = offset;
    for (const byte of new TextEncoder().encode(text)) {
      value ^= BigInt(byte);
      value = (value * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return value;
  };
  const hex = fnv(`${seed}:hi`, 0xcbf29ce484222325n).toString(16).padStart(16, '0')
    + fnv(`${seed}:lo`, 0x84222325cbf29ce4n).toString(16).padStart(16, '0');
  // Version 4 and RFC 4122 variant so every consumer's UUID parser accepts it.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Upgrade one saved Scene to the current wire schema without model inference. */
export function migrateScene(input: unknown): SceneMigrationResult {
  const parsed = sceneSchema.safeParse(input);
  if (!parsed.success) {
    throw new SceneMigrationError('INVALID_SCENE', parsed.error.issues[0]?.message ?? '场景格式无效');
  }
  if (parsed.data.schemaVersion === 2) {
    return { scene: parsed.data, fromVersion: 2, toVersion: 2, changed: false, notes: [] };
  }
  const legacy = parsed.data;
  const boundary = boundaryPoints(legacy.venue);
  const walls: SceneV2['structure']['walls'] = boundary.map((start, index) => ({
    id: nameUuid(`scene-migrate:wall:${index}`),
    start, end: boundary[(index + 1) % boundary.length]!,
    thickness: 0.16, height: legacy.venue.height, kind: 'exterior', status: 'inferred',
  }));
  const openings: SceneV2['structure']['openings'] = legacy.venue.entrances.map(entrance => {
    const seat = seatEntrance(boundary, entrance);
    if (!seat) {
      throw new SceneMigrationError('ENTRANCE_REQUIRES_REVIEW',
        `出入口 ${entrance.id} 无法在不改变尺寸的前提下放入场界墙段，请先在编辑器中核对位置与宽度。`);
    }
    return { id: entrance.id, wallId: walls[seat.edge]!.id, kind: 'door', offset: seat.offset,
      width: entrance.width, height: Math.min(2.2, legacy.venue.height), sillHeight: 0, status: 'inferred' };
  });
  const notes = ['已按保存的场地边界推导外墙与门洞，结构状态为 inferred，未改动物件与场地尺寸。'];
  let droppedWallReferences = false;
  const objects = legacy.objects.map(object => {
    const { wallId, ...rest } = object;
    if (wallId !== undefined) droppedWallReferences = true;
    return rest;
  });
  if (droppedWallReferences) notes.push('已移除 v1 中无对应墙体的挂墙引用。');
  const candidate = {
    ...legacy,
    schemaVersion: 2 as const,
    objects,
    structure: { walls, openings, columns: [] },
    sources: [],
    dimensions: [],
  };
  const checked = sceneSchema.safeParse(candidate);
  if (!checked.success || checked.data.schemaVersion !== 2) {
    throw new SceneMigrationError('INVALID_SCENE',
      checked.success ? '场景升级结果版本无效' : checked.error.issues[0]?.message ?? '场景升级结果无效');
  }
  return { scene: checked.data, fromVersion: 1, toVersion: 2, changed: true, notes };
}
