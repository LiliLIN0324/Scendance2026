import type { RoomLayout } from '../components/room-organizer/lib/types';
import type { PlanAnnotation } from './plan-annotation';

/** 将可定位到矩形外墙的场景门记录提供给草案检查；不把记录当现场确认。 */
export function sceneDoorAnnotations(layout: RoomLayout, floorIndex: number): PlanAnnotation[] {
  const floor = layout.floors[floorIndex];
  const width = layout.width, depth = layout.height;
  if (!floor || layout.backendVenue?.shape === 'polygon' || !Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) return [];
  const out: PlanAnnotation[] = [];
  for (const item of floor.items) {
    if (item.type !== 'door' || (!item.structuralOpeningId && !item.venueEntranceId) || !item.position) continue;
    const widthM = Number.isFinite(item.width) && item.width > 0 ? item.width : null;
    const { x, z } = item.position;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const edges = [
      { wall: 'north' as const, distance: Math.abs(z + depth / 2), position: x, span: width },
      { wall: 'south' as const, distance: Math.abs(z - depth / 2), position: x, span: width },
      { wall: 'west' as const, distance: Math.abs(x + width / 2), position: z, span: depth },
      { wall: 'east' as const, distance: Math.abs(x - width / 2), position: z, span: depth },
    ].sort((a, b) => a.distance - b.distance);
    const edge = edges[0]!;
    const tolerance = Math.max(0.2, Number.isFinite(item.depth) ? item.depth / 2 + 0.05 : 0.2);
    if (edge.distance > tolerance || edges[1]!.distance <= tolerance || Math.abs(edge.position) > edge.span / 2 + 0.02
      || (widthM !== null && Math.abs(edge.position) + widthM / 2 > edge.span / 2 + 0.02)) continue;
    out.push({ id: item.structuralOpeningId ?? item.venueEntranceId!, kind: 'door', label: `${item.name || '门'}（场景记录，待核验）`, stageNo: 1,
      geometry: { kind: 'door', wall: edge.wall, position: edge.position, widthM, inferred: true, source: 'scene' } });
  }
  return out;
}
