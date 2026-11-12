import { structureSchema, type Scene } from '../../../../supabase/functions/_shared/domain';
import { canApplyStructuralChange, structuralViolations, structuralWarnings, dimensionConflicts } from '../../../../supabase/functions/_shared/structural-geometry';
import { isWallHung, mountBand } from './mount-band';
import { isWallMounted } from './opening-snap';
import type { FurnitureItem, RoomLayout } from './types';

type SceneV2 = Extract<Scene, { schemaVersion: 2 }>;
/** Preserve unedited wire numbers exactly; inverse coordinate transforms add machine noise. */
export function stableMeasurement(value: number, original?: number): number {
  return original !== undefined && Math.abs(value - original) <= 1e-12 ? original : value;
}

type ShellPoint = { x: number; z: number };

function ringArea(points: readonly ShellPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!, b = points[(index + 1) % points.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

function signedRing(points: readonly ShellPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index]!, b = points[(index + 1) % points.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

/** Pull a closed loop in to the wall's inner face. A bad offset keeps the centerline. */
function insetLoop(loop: readonly ShellPoint[], distance: number): ShellPoint[] | null {
  if (!(distance > 0) || loop.length < 3) return null;
  const ccw = signedRing(loop) > 0;
  const edges = loop.map((start, index) => {
    const end = loop[(index + 1) % loop.length]!;
    const dx = end.x - start.x, dz = end.z - start.z;
    const length = Math.hypot(dx, dz) || 1;
    const nx = (ccw ? -dz : dz) / length, nz = (ccw ? dx : -dx) / length;
    return { x: start.x + nx * distance, z: start.z + nz * distance, dx, dz };
  });
  const verts: ShellPoint[] = [];
  for (let index = 0; index < edges.length; index++) {
    const prev = edges[(index + edges.length - 1) % edges.length]!;
    const next = edges[index]!;
    const den = prev.dx * next.dz - prev.dz * next.dx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((next.x - prev.x) * next.dz - (next.z - prev.z) * next.dx) / den;
    const point = { x: prev.x + prev.dx * t, z: prev.z + prev.dz * t };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
    verts.push(point);
  }
  const area = ringArea(verts);
  if (!(area > 1) || area >= ringArea(loop) - 1e-6 || signedRing(verts) * signedRing(loop) <= 0) return null;
  return verts;
}

/** A closed exterior shell smaller than the activity frame. Endpoints are world metres. */
function shellInterior(walls: readonly { start: ShellPoint; end: ShellPoint; kind?: string; thickness?: number }[], width: number, depth: number): ShellPoint[] | null {
  const exterior = walls.filter(wall => wall.kind === 'exterior');
  if (exterior.length < 3 || !(width > 0) || !(depth > 0)) return null;
  const key = (point: ShellPoint) => `${point.x.toFixed(3)},${point.z.toFixed(3)}`;
  const pending = exterior.map(wall => ({ start: wall.start, end: wall.end }));
  const loop = [pending[0]!.start, pending[0]!.end];
  pending.shift();
  while (pending.length) {
    const end = loop[loop.length - 1]!;
    const index = pending.findIndex(wall => key(wall.start) === key(end) || key(wall.end) === key(end));
    if (index < 0) return null;
    const wall = pending.splice(index, 1)[0]!;
    const next = key(wall.start) === key(end) ? wall.end : wall.start;
    if (key(next) === key(loop[0]!)) break;
    loop.push(next);
  }
  if (pending.length || loop.length < 3) return null;
  const area = ringArea(loop);
  // Walls sitting on the activity frame are the frame itself. An inset shell is the usable room.
  if (!(area > 1) || area > width * depth * 0.98) return null;
  // The recorded line is the wall centerline. Seats have to clear the inner face, not the middle of the wall.
  const half = Math.max(0, ...exterior.map(wall => wall.thickness ?? 0)) / 2;
  const inner = insetLoop(loop, half);
  const chosen = inner ?? loop;
  return chosen.map(point => ({
    x: Math.min(width, Math.max(0, point.x)),
    z: Math.min(depth, Math.max(0, point.z)),
  }));
}

export interface SeatingRect { x: number; z: number; w: number; d: number }

/**
 * The room people can sit in, in layout coordinates (origin at the frame centre).
 * A tighter exterior loop uses its inner face. No such loop means the activity
 * frame itself is the floor — callers must not invent a smaller room.
 */
function exteriorWalls(layout: RoomLayout, floorIndex: number) {
  const floor = layout.floors[floorIndex];
  const stored = layout.backendSceneV2;
  const floorWalls = floor?.interiorWalls ?? [];
  return floorWalls.length
    ? floorWalls.map(wall => ({
        start: { x: wall.x1 + layout.width / 2, z: wall.z1 + layout.height / 2 },
        end: { x: wall.x2 + layout.width / 2, z: wall.z2 + layout.height / 2 },
        ...(wall.kind ? { kind: wall.kind } : {}),
        ...(wall.thickness !== undefined ? { thickness: wall.thickness } : {}),
      }))
    : (stored?.structure?.walls ?? []).map(wall => ({
        start: wall.start, end: wall.end,
        ...(wall.kind ? { kind: wall.kind } : {}),
        ...(wall.thickness !== undefined ? { thickness: wall.thickness } : {}),
      }));
}

/** World-metre polygon the floor is actually drawn from, when it is tighter than the frame. */
export function usableFloorPolygon(layout: RoomLayout, floorIndex = 0): ShellPoint[] | null {
  const shell = shellInterior(exteriorWalls(layout, floorIndex), layout.width, layout.height);
  const recorded = layout.backendVenue?.polygon;
  const frame = layout.width * layout.height;
  const shellOk = !!shell && ringArea(shell) < (recorded ? ringArea(recorded) : frame) * 0.98;
  const recordedOk = !!recorded && ringArea(recorded) < frame * 0.98;
  if (shellOk && recordedOk && recorded && shell && ringArea(recorded) < ringArea(shell)) return recorded.map(point => ({ x: point.x, z: point.z }));
  if (shellOk && shell) return shell;
  if (recordedOk && recorded) return recorded.map(point => ({ x: point.x, z: point.z }));
  return null;
}

export function usableSeatingRect(layout: RoomLayout, floorIndex = 0): SeatingRect | null {
  const shell = shellInterior(exteriorWalls(layout, floorIndex), layout.width, layout.height);
  if (!shell) return null;
  const recorded = layout.backendVenue?.polygon;
  if (!(ringArea(shell) < (recorded ? ringArea(recorded) : layout.width * layout.height) * 0.98)) return null;
  const xs = shell.map(point => point.x);
  const zs = shell.map(point => point.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const w = maxX - minX, d = maxZ - minZ;
  if (!(w > 1) || !(d > 1)) return null;
  return { x: minX - layout.width / 2, z: minZ - layout.height / 2, w, d };
}

/** Geometry-only conversion. No asset IDs are invented and this is never persisted. */
export function layoutGeometryScene(layout: RoomLayout, floorIndex = 0): SceneV2 {
  const floor = layout.floors[floorIndex];
  const world = (p: { x: number; z: number }, original?: {x:number;z:number}) => ({ x: stableMeasurement(p.x + layout.width / 2, original?.x), z: stableMeasurement(p.z + layout.height / 2, original?.z) });
  const stored = layout.backendSceneV2;
  const floorWalls = floor?.interiorWalls ?? [];
  const walls = floorWalls.length ? floorWalls.map(w => ({
    ...stored?.structure.walls.find(original => original.id === w.id),
    id: w.id, start: world({ x: w.x1, z: w.z1 }, stored?.structure.walls.find(o=>o.id===w.id)?.start), end: world({ x: w.x2, z: w.z2 }, stored?.structure.walls.find(o=>o.id===w.id)?.end),
    height: w.height ?? floor?.height ?? 3, thickness: w.thickness ?? 0.16,
    kind: w.kind ?? 'interior', status: w.status ?? 'inferred',
  })) : (stored?.structure?.walls ?? []).map(wall => ({ ...wall }));
  const shell = shellInterior(walls, layout.width, layout.height);
  const recorded = layout.backendVenue?.polygon;
  // A map pick stores the outer activity outline. A tighter wall loop is the room people can sit in.
  const useShell = !!shell && ringArea(shell) < (recorded ? ringArea(recorded) : layout.width * layout.height) * 0.98;
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
      status: old?.status ?? (stored ? 'inferred' : 'confirmed') });
  }
  const columns = (floor?.items ?? []).filter(i => i.structuralColumnId && i.position).map(i => ({
    ...stored?.structure.columns.find(c => c.id === i.structuralColumnId),
    id: i.structuralColumnId!, position: world(i.position!, stored?.structure.columns.find(c=>c.id===i.structuralColumnId)?.position),
    size: { width: i.width, depth: i.depth, height: i.height }, rotation: stableMeasurement(-(i.rotation ?? 0) * 180 / Math.PI, stored?.structure.columns.find(c=>c.id===i.structuralColumnId)?.rotation),
    status: stored?.structure.columns.find(c => c.id === i.structuralColumnId)?.status ?? (stored ? 'inferred' : 'confirmed') as 'inferred' | 'confirmed',
  }));
  const objects = (floor?.items ?? []).filter(i => i.position && !i.structuralOpeningId && !i.structuralColumnId && !i.venueEntranceId && !isWallMounted(i.type) && i.category !== 'outdoor').map(i => ({
    id: i.id, materialId: i.materialId ?? 'decoration' as const,
    position: world(i.position!), size: { width: i.width, depth: i.depth, height: i.height },
    rotation: -(i.rotation ?? 0) * 180 / Math.PI, color: i.color, locked: !!i.locked, notes: i.notes ?? '',
    elevation: i.elevation ?? mountBand(i).bottom,
    ...(i.wallId ? { wallId: i.wallId } : isWallHung(i.type) ? { wallId: nearestWallId(i, walls, layout.width, layout.height) } : {}),
  }));
  return {
    schemaVersion: 2, venue: { ...(layout.backendVenue ?? { entrances: [], shape: 'rectangle' as const }),
      width: layout.width, depth: layout.height, height: floor?.height ?? 3,
      ...(useShell && shell ? { shape: 'polygon' as const, polygon: shell } : {}) },
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

/**
 * 严格几何闸门（保存 / 提交前用）：穿透不能变坏 + 无尺寸冲突 + schema 合法 + 洞口 marker 数对齐。
 * 语义保持不变——有任何一条不满足就 false。
 */
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

/**
 * 宽松"画布交互"闸门（拖拽 / 拖动 / 移动物料时用）：只拦**数据损坏**——
 * schema 非法 或 洞口 marker 数与 Scene 不对齐。穿透 / 尺寸冲突 / 边界越界都放行，
 * 交给 `collectLayoutGeometryWarnings` 给 UI 提示。
 *
 * 2026-11-11 新主线（地理优先）拍板：规划阶段应该允许草图"先过、再调"，硬闸门让 AI 出方案被卡死，
 * 真正的结构一致性在保存 / 提交前再严格校验（走 canApplyLayoutGeometry）。
 */
export function layoutGeometryIsAcceptable(before: RoomLayout, after: RoomLayout): boolean {
  return after.floors.every((floor, index) => {
    const next = layoutGeometryScene(after, index);
    if (after.backendSceneV2 && !structureSchema.safeParse(next.structure).success) return false;
    if (after.backendSceneV2 && next.structure.openings.length !== floor.items.filter(i => i.structuralOpeningId).length) return false;
    void before; // 宽松闸门不比较 before/after 的穿透单调性——允许规划阶段"先坏后好"。
    return true;
  });
}

/**
 * 收集当前 layout 的结构警告（穿透 / 尺寸冲突 / 边界越界），用于 UI 上的红框 / tooltip 提示。
 * 没有警告返回空数组。
 */
export function collectLayoutGeometryWarnings(layout: RoomLayout): string[] {
  const warnings: string[] = [];
  if (!layout.backendSceneV2) return warnings;
  for (let index = 0; index < layout.floors.length; index++) {
    const scene = layoutGeometryScene(layout, index);
    for (const conflict of dimensionConflicts(scene)) warnings.push(conflict.message);
    for (const { code, ids } of structuralWarnings(scene)) {
      if (code === 'OUT_OF_BOUNDS') warnings.push(`${ids[0] ?? '物件'} 超出场地边界`);
      else if (code === 'COLUMN_COLLISION') warnings.push(`${ids[0] ?? '物件'} 与柱子冲突`);
      else warnings.push(`${ids[0] ?? '物件'} 与结构冲突 (${code})`);
    }
  }
  return warnings;
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
/** Existing confirmed or source-linked walls require the dedicated review workflow. */
export function isEvidenceProtectedWall(layout: RoomLayout, wallId: string): boolean {
  const source=layout.backendSceneV2;
  if(!source)return false;
  const wall=source.structure.walls.find(value=>value.id===wallId);
  return layout.floors.some(floor=>floor.interiorWalls?.some(value=>value.id===wallId&&value.status==='confirmed')) ||
    wall?.status==='confirmed' || (wall?.evidence?.length??0)>0 ||
    source.dimensions.some(value=>value.status==='confirmed'&&(value.targetId===wallId||value.targetEndId===wallId));
}

/** 门、柱、出入口的现场标记：它们是场地真相的一部分，不算物料。 */
export function isStructuralMarker(item: Pick<FurnitureItem, 'structuralOpeningId' | 'structuralColumnId' | 'venueEntranceId'>): boolean {
  return !!(item.structuralOpeningId || item.structuralColumnId || item.venueEntranceId);
}
export function materialCount(items: readonly FurnitureItem[]): number {
  return items.filter(item=>!isStructuralMarker(item)).length;
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
