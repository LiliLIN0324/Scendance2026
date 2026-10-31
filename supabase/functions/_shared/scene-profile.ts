// Read-only object dossiers for the scene Agent. Pure functions only: no network,
// no scene mutation and no persistence. Geometry comes from the shared metre-space
// helpers so these relations agree with analyze_layout instead of re-inventing rules.
import { z } from 'zod';
import { catalog, uuid, type Point, type Scene, type SceneObject } from './domain.ts';
import { footprint, pointInPolygon, polygonPenetration } from './structural-geometry.ts';
import { assetUuidKey, presetObjectLabels, type SceneResource } from './scene-resources.ts';

/** Hard bound keeps the model-facing payload small even if a caller forwards more IDs. */
export const MAX_OBJECT_PROFILES = 50;
/** Compact, JSON-safe envelope description. Never a safety/compliance statement. */
export const OBJECT_PROFILE_SCOPE = '只读物件档案：不修改场景；几何关系为程序测量结果，不是消防、承重或施工合规结论；不含价格、库存、供应商或承重数据。';

export const objectProfileRequestSchema = z.strictObject({ objectIds: z.array(uuid).min(1).max(MAX_OBJECT_PROFILES) });
export type ObjectProfileRequest = z.infer<typeof objectProfileRequestSchema>;

export type ProfileFieldSource = 'user-input' | 'catalog-default' | 'derived' | 'unknown';
export type ProfileNameSource = 'preset-label' | 'resource-library' | 'catalog' | 'unknown';
export type ProfileIdentitySource = 'preset' | 'asset' | 'catalog';

export interface SceneObjectOutOfBounds {
  measured: true;
  outside: boolean;
  rule: string;
}
export interface SceneObjectOverlap {
  objectId: string;
  penetrationMeters: number;
}
export interface SceneObjectNearestEntrance {
  measured: true;
  entranceId: string;
  distanceMeters: number;
  method: string;
}
export interface SceneObjectRelations {
  outOfBounds: SceneObjectOutOfBounds;
  /** XZ footprint intersections with other existing instances; carpets are skipped. */
  overlaps: SceneObjectOverlap[];
  overlapCount: number;
  nearestEntrance: SceneObjectNearestEntrance | null;
}
export interface SceneObjectProfile {
  id: string;
  name: string | null;
  materialId: SceneObject['materialId'];
  assetId?: string;
  presetNode?: number;
  source: ProfileIdentitySource;
  /** Preset group, only when the instance belongs to an archived preset scene. */
  group?: string;
  /** Wall attachment from the V2 structure, only when it resolves. */
  wall?: { id: string; kind: 'exterior' | 'interior' };
  sizeMeters: { width: number; depth: number; height: number };
  position: { x: number; z: number };
  rotation: number;
  locked: boolean;
  elevation: number;
  notes?: string;
  relations: SceneObjectRelations;
  dataQuality: {
    name: ProfileNameSource;
    size: ProfileFieldSource;
    elevation: 'user-input' | 'derived';
    relations: 'derived';
  };
}
export interface SceneProfiles {
  scope: string;
  requestedCount: number;
  returnedCount: number;
  missingIds: string[];
  /** Requested instances that exist but were dropped by the 50-profile cap. */
  omittedIds: string[];
  truncated: boolean;
  preset: string | null;
  venue: { widthMeters: number; depthMeters: number; heightMeters: number; shape: 'rectangle' | 'polygon' };
  profiles: SceneObjectProfile[];
  dataQuality: {
    legend: Record<ProfileFieldSource, string>;
    notes: string[];
  };
}

const MAX_OVERLAP_REPORTS = 20;
const roundMeters = (value: number) => Math.round(value * 1000) / 1000;
const sameSize = (a: SceneObject['size'], b: SceneObject['size']) =>
  Math.abs(a.width - b.width) < 1e-6 && Math.abs(a.depth - b.depth) < 1e-6 && Math.abs(a.height - b.height) < 1e-6;

function venuePolygon(scene: Scene): Point[] {
  const venue = scene.venue;
  return venue.polygon ?? [{ x: 0, z: 0 }, { x: venue.width, z: 0 }, { x: venue.width, z: venue.depth }, { x: 0, z: venue.depth }];
}

function strictCross(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12;
}

/** Boundary-only test: every footprint corner inside and no edge exits the venue polygon. */
function footprintOutsideVenue(object: SceneObject, polygon: Point[]) {
  const corners = footprint(object);
  if (corners.some(corner => !pointInPolygon(corner, polygon))) return true;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    for (let j = 0; j < polygon.length; j++) {
      if (strictCross(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return true;
    }
  }
  return false;
}

function pointSegmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
}

function nearestEntrance(object: SceneObject, scene: Scene): SceneObjectNearestEntrance | null {
  if (!scene.venue.entrances.length) return null;
  const corners = footprint(object);
  let best: SceneObjectNearestEntrance | null = null;
  for (const entrance of scene.venue.entrances) {
    const distance = pointInPolygon(entrance.position, corners)
      ? 0
      : Math.min(...corners.map((a, i) => pointSegmentDistance(entrance.position, a, corners[(i + 1) % corners.length])));
    if (!best || distance < best.distanceMeters) {
      best = { measured: true, entranceId: entrance.id, distanceMeters: roundMeters(distance), method: 'entrance-point-to-footprint-edge' };
    }
  }
  return best;
}

function overlapsWith(object: SceneObject, scene: Scene): { entries: SceneObjectOverlap[]; count: number } {
  // Carpet is a floor covering: analyze_layout also exempts it from overlap reports.
  if (object.materialId === 'carpet') return { entries: [], count: 0 };
  const shape = footprint(object);
  const found: SceneObjectOverlap[] = [];
  for (const other of scene.objects) {
    if (other.id === object.id || other.materialId === 'carpet') continue;
    const penetration = polygonPenetration(shape, footprint(other));
    if (penetration > 1e-6) found.push({ objectId: other.id, penetrationMeters: roundMeters(penetration) });
  }
  found.sort((a, b) => b.penetrationMeters - a.penetrationMeters || a.objectId.localeCompare(b.objectId));
  return { entries: found.slice(0, MAX_OVERLAP_REPORTS), count: found.length };
}

export function buildSceneProfiles(scene: Scene, objectIds: readonly string[], resources: readonly SceneResource[] = []): SceneProfiles {
  const byId = new Map(scene.objects.map(object => [object.id.toLowerCase(), object]));
  const resourceByAsset = new Map<string, SceneResource>();
  for (const resource of resources) {
    try {
      const key = assetUuidKey(resource.assetId);
      if (!resourceByAsset.has(key)) resourceByAsset.set(key, resource);
    } catch {
      // Opaque or malformed asset references cannot match a scene instance.
    }
  }
  const labels: Record<string, string> = scene.scenePreset ? presetObjectLabels(scene) : {};
  const catalogById = new Map(catalog.map(item => [item.id, item]));

  const requested: string[] = [];
  const seen = new Set<string>();
  for (const raw of objectIds) {
    const id = raw.trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    requested.push(id);
  }

  const found: { requested: string; object: SceneObject }[] = [];
  const missingIds: string[] = [];
  for (const id of requested) {
    const object = byId.get(id.toLowerCase());
    if (object) found.push({ requested: id, object });
    else missingIds.push(id);
  }
  const selected = found.slice(0, MAX_OBJECT_PROFILES);
  const omittedIds = found.slice(MAX_OBJECT_PROFILES).map(item => item.requested);
  const polygon = venuePolygon(scene);

  const profiles = selected.map(({ object }): SceneObjectProfile => {
    const resource = object.assetId ? resourceByAsset.get(safeAssetKey(object.assetId)) : undefined;
    const presetName = labels[object.id];
    const builtin = catalogById.get(object.materialId as (typeof catalog)[number]['id']);
    const name = presetName || resource?.name || builtin?.name || null;
    const nameSource: ProfileNameSource = presetName ? 'preset-label' : resource?.name ? 'resource-library' : builtin?.name ? 'catalog' : 'unknown';
    const source: ProfileIdentitySource = object.presetNode !== undefined ? 'preset' : object.assetId ? 'asset' : 'catalog';
    const sizeSource: ProfileFieldSource =
      (resource?.size && sameSize(resource.size, object.size)) || (builtin && sameSize(builtin.size, object.size))
        ? 'catalog-default'
        : resource?.size || builtin
          ? 'user-input'
          : 'unknown';
    const wall = object.wallId && scene.schemaVersion === 2 ? scene.structure.walls.find(candidate => candidate.id === object.wallId) : undefined;
    const overlaps = overlapsWith(object, scene);
    const entrances = nearestEntrance(object, scene);

    return {
      id: object.id,
      name,
      materialId: object.materialId,
      ...(object.assetId ? { assetId: object.assetId } : {}),
      ...(object.presetNode !== undefined ? { presetNode: object.presetNode } : {}),
      source,
      ...(object.presetNode !== undefined && scene.scenePreset ? { group: scene.scenePreset } : {}),
      ...(wall ? { wall: { id: wall.id, kind: wall.kind } } : {}),
      sizeMeters: { width: object.size.width, depth: object.size.depth, height: object.size.height },
      position: { x: object.position.x, z: object.position.z },
      rotation: object.rotation,
      locked: object.locked,
      elevation: object.elevation ?? 0,
      ...(object.notes ? { notes: object.notes } : {}),
      relations: {
        outOfBounds: { measured: true, outside: footprintOutsideVenue(object, polygon), rule: 'footprint-vs-venue-boundary (XZ only, excludes ceiling height)' },
        overlaps: overlaps.entries,
        overlapCount: overlaps.count,
        nearestEntrance: entrances,
      },
      dataQuality: { name: nameSource, size: sizeSource, elevation: object.elevation === undefined ? 'derived' : 'user-input', relations: 'derived' },
    };
  });

  return {
    scope: OBJECT_PROFILE_SCOPE,
    requestedCount: requested.length,
    returnedCount: profiles.length,
    missingIds,
    omittedIds,
    truncated: omittedIds.length > 0,
    preset: scene.scenePreset ?? null,
    venue: { widthMeters: scene.venue.width, depthMeters: scene.venue.depth, heightMeters: scene.venue.height, shape: scene.venue.shape },
    profiles,
    dataQuality: {
      legend: {
        'user-input': '当前草稿中的用户/场景数据',
        'catalog-default': '内置目录或资源默认尺寸',
        derived: '程序按当前几何推算或测量',
        unknown: '缺少资源或目录数据，未猜测',
      },
      notes: [
        'position/rotation/locked/notes 直接来自当前草稿（user-input）。',
        'elevation 未提供时按物件落地折算为 0（derived）。',
        'outOfBounds 只看 XZ 占地边界；层高与压墙柱见 analyze_layout。',
        'overlaps 为 XZ 占地相交，跳过地毯；nearestEntrance 由入口点量到占地边缘，仅在场所有入口数据时给出。',
        '所有关系均为实测/推算，不代表安全、承重或施工合规结论。',
      ],
    },
  };
}

function safeAssetKey(assetId: string): string {
  try {
    return assetUuidKey(assetId);
  } catch {
    return assetId.toLowerCase();
  }
}
