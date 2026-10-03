import { structureSchema, type Scene } from '../../../../supabase/functions/_shared/domain';
import { canApplyStructuralChange, structuralViolations, dimensionConflicts } from '../../../../supabase/functions/_shared/structural-geometry';
import { isWallHung, mountBand } from './mount-band';
import { isWallMounted } from './opening-snap';
import type { FurnitureItem, RoomLayout } from './types';

type SceneV2 = Extract<Scene, { schemaVersion: 2 }>;
/** Preserve unedited wire numbers exactly; inverse coordinate transforms add machine noise. */
export function stableMeasurement(value: number, original?: number): number {
  return original !== undefined && Math.abs(value - original) <= 1e-12 ? original : value;
}

/** Geometry-only conversion. No asset IDs are invented and this is never persisted. */
export function layoutGeometryScene(layout: RoomLayout, floorIndex = 0): SceneV2 {
  const floor = layout.floors[floorIndex];
  const world = (p: { x: number; z: number }, original?: {x:number;z:number}) => ({ x: stableMeasurement(p.x + layout.width / 2, original?.x), z: stableMeasurement(p.z + layout.height / 2, original?.z) });
  const stored = layout.backendSceneV2;
  const walls = (floor?.interiorWalls ?? []).map(w => ({
    ...stored?.structure.walls.find(original => original.id === w.id),
    id: w.id, start: world({ x: w.x1, z: w.z1 }, stored?.structure.walls.find(o=>o.id===w.id)?.start), end: world({ x: w.x2, z: w.z2 }, stored?.structure.walls.find(o=>o.id===w.id)?.end),
    height: w.height ?? floor?.height ?? 3, thickness: w.thickness ?? 0.16,
    kind: w.kind ?? 'interior', status: w.status ?? 'confirmed',
  }));
  const openings: SceneV2['structure']['openings'] = [];
  for (const item of floor?.items ?? []) {
    if (!item.position || (item.type !== 'door' && item.type !== 'window')) continue;
    const old = stored?.structure.openings.find(o => o.id === item.structuralOpeningId);
    let best: { wall: typeof walls[number]; offset: number; distance: number } | undefined;
    const p = world(item.position);
    for (const wall of walls) {
      if (old && wall.id !== old.wallId) continue;
      const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z;
      const length = Math.hypot(dx, dz);
      if (!length) continue;
      const offset = ((p.x - wall.start.x) * dx + (p.z - wall.start.z) * dz) / length;
      const distance = Math.abs((p.x - wall.start.x) * dz - (p.z - wall.start.z) * dx) / length;
      if (offset < 0 || offset > length || distance > (stored ? 1e-6 : 0.4)) continue;
      if (!best || distance < best.distance) best = { wall, offset, distance };
    }
    if (best) openings.push({ ...old, id: item.structuralOpeningId ?? item.id,
      wallId: best.wall.id, kind: item.type as 'door' | 'window', offset: stableMeasurement(Math.max(0, best.offset - item.width / 2), old?.offset),
      width: item.width, height: item.height, sillHeight: item.sillHeight ?? (item.type === 'window' ? 0.8 : 0),
      status: old?.status ?? 'confirmed' });
  }
  const columns = (floor?.items ?? []).filter(i => i.structuralColumnId && i.position).map(i => ({
    ...stored?.structure.columns.find(c => c.id === i.structuralColumnId),
    id: i.structuralColumnId!, position: world(i.position!, stored?.structure.columns.find(c=>c.id===i.structuralColumnId)?.position),
    size: { width: i.width, depth: i.depth, height: i.height }, rotation: stableMeasurement(-(i.rotation ?? 0) * 180 / Math.PI, stored?.structure.columns.find(c=>c.id===i.structuralColumnId)?.rotation),
    status: stored?.structure.columns.find(c => c.id === i.structuralColumnId)?.status ?? 'confirmed' as const,
  }));
  const objects = (floor?.items ?? []).filter(i => i.position && !i.structuralOpeningId && !i.structuralColumnId && !i.venueEntranceId && !isWallMounted(i.type) && i.category !== 'outdoor').map(i => ({
    id: i.id, materialId: i.materialId ?? 'decoration' as const,
    position: world(i.position!), size: { width: i.width, depth: i.depth, height: i.height },
    rotation: -(i.rotation ?? 0) * 180 / Math.PI, color: i.color, locked: !!i.locked, notes: i.notes ?? '',
    elevation: i.elevation ?? mountBand(i).bottom,
    ...(i.wallId ? { wallId: i.wallId } : isWallHung(i.type) ? { wallId: nearestWallId(i, walls, layout.width, layout.height) } : {}),
  }));
  return {
    schemaVersion: 2, venue: { ...(layout.backendVenue ?? { entrances: [], shape: 'rectangle' }),
      width: layout.width, depth: layout.height, height: floor?.height ?? 3 },
    objects, camera: layout.backendCamera ?? 'overview', lighting: layout.backendLighting ?? 'neutral',
    structure: { walls, openings, columns }, sources: stored?.sources ?? [], dimensions: stored?.dimensions ?? [],
    ...(stored?.design ? { design: stored.design } : {}),
  } as SceneV2;
}

function nearestWallId(item: FurnitureItem, walls: SceneV2['structure']['walls'], width: number, depth: number): string | undefined {
  if (!item.position) return undefined;
  let result: string | undefined, best = 0.25;
  for (const wall of walls) {
    const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z, length = Math.hypot(dx, dz);
    if (!length) continue;
    const px = item.position.x + width / 2 - wall.start.x, pz = item.position.z + depth / 2 - wall.start.z;
    const along = (px * dx + pz * dz) / length;
    const distance = Math.abs(px * dz - pz * dx) / length;
    if (along >= 0 && along <= length && distance < best) { best = distance; result = wall.id; }
  }
  return result;
}

export function canApplyLayoutGeometry(before: RoomLayout, after: RoomLayout): boolean {
  return after.floors.every((floor, index) => {
    const next = layoutGeometryScene(after, index);
    if (after.backendSceneV2 && (!structureSchema.safeParse(next.structure).success || dimensionConflicts(next).length > 0)) return false;
    if (after.backendSceneV2 && next.structure.openings.length !== floor.items.filter(i => i.structuralOpeningId).length) return false;
    return canApplyStructuralChange(
    layoutGeometryScene(before, Math.min(index, before.floors.length - 1)), next
    );
  });
}

export function structuralItemCollides(item: FurnitureItem, layout: RoomLayout, floorIndex = 0): boolean {
  return structuralViolations(layoutGeometryScene(layout, floorIndex)).some(v => v.objectId === item.id);
}

/** Actual usable polygon footprint and material count, excluding structure markers. */
export function venueArea(layout: RoomLayout): number {
  const points = layout.backendVenue?.polygon;
  if (!points) return layout.width * layout.height;
  return Math.abs(points.reduce((sum,p,i)=>{ const q=points[(i+1)%points.length]!;return sum+p.x*q.z-q.x*p.z; },0))/2;
}
export function materialCount(items: readonly FurnitureItem[]): number {
  return items.filter(item=>!item.structuralOpeningId && !item.structuralColumnId && !item.venueEntranceId).length;
}

/** Seat measured openings only on actual walls; polygon bounds are not walls. */
export function snapMeasuredOpening(layout: RoomLayout, item: Pick<FurnitureItem,'id'|'type'|'width'|'structuralOpeningId'>, position: {x:number;z:number}, floorIndex = 0): Pick<FurnitureItem,'position'|'rotation'|'depth'|'structuralOpeningId'> | null {
  const owned = layout.backendSceneV2?.structure.openings.find(o=>o.id===item.structuralOpeningId);
  let best: {wall: NonNullable<RoomLayout['floors'][number]['interiorWalls']>[number]; position:{x:number;z:number}; distance:number} | undefined;
  for (const wall of layout.floors[floorIndex]?.interiorWalls ?? []) {
    if (owned && wall.id !== owned.wallId) continue;
    const dx=wall.x2-wall.x1,dz=wall.z2-wall.z1,length=Math.hypot(dx,dz);
    if (length < item.width || !length) continue;
    const along=Math.max(item.width/2,Math.min(length-item.width/2,((position.x-wall.x1)*dx+(position.z-wall.z1)*dz)/length));
    const projected={x:wall.x1+dx*along/length,z:wall.z1+dz*along/length};
    const distance=Math.hypot(position.x-projected.x,position.z-projected.z);
    if (!best || distance < best.distance) best={wall,position:projected,distance};
  }
  return best ? {position:best.position,rotation:-Math.atan2(best.wall.z2-best.wall.z1,best.wall.x2-best.wall.x1),depth:best.wall.thickness??0.16,structuralOpeningId:item.structuralOpeningId??item.id} : null;
}
