import { sceneV2Schema, type SceneV2 } from '../../supabase/functions/_shared/domain';
import { dimensionConflicts, measurement } from '../../supabase/functions/_shared/structural-geometry';
import { backendSceneToLayout, layoutToBackendScene } from '../components/room-organizer/lib/backend-adapter';
import { MAX_ROOM_DIMENSION } from '../components/room-organizer/lib/constants';
import { mergeProposalPresentation } from '../components/room-organizer/lib/creative-brief';
import { isWallHung } from '../components/room-organizer/lib/mount-band';
import { canApplyLayoutGeometry, layoutGeometryScene } from '../components/room-organizer/lib/structural-layout';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const EPS = 1e-8;
const openingFields = ['offset', 'width', 'height', 'sillHeight'] as const;
const same = (a: number, b: number) => Math.abs(a - b) <= EPS;

function rectangleEdges(points: readonly { x: number; z: number }[], width: number, depth: number): Set<string> | null {
  const corners = [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
  const indices = points.map(point => corners.findIndex(corner => same(point.x, corner.x) && same(point.z, corner.z)));
  if (indices.length !== 4 || indices.includes(-1) || new Set(indices).size !== 4) return null;
  const edges = indices.map((index, i) => [index, indices[(i + 1) % 4]].sort().join(':'));
  return edges.every(edge => ['0:1', '1:2', '2:3', '0:3'].includes(edge)) ? new Set(edges) : null;
}

/** Read the live edited scene, never the stored pre-edit structure. */
export function readEditableVenue(layout: RoomLayout): SceneV2 {
  const scene = layoutToBackendScene(layout);
  if (scene.schemaVersion !== 2) throw new Error('当前场地尚未建立建筑结构，请先核对场地尺寸。');
  if (scene.venue.entrances.length) throw new Error('这个场地仍有独立出入口记录，暂不能在这里修改。原出入口和场景已保留。');
  const { width, depth, polygon } = scene.venue;
  if (polygon && !rectangleEdges(polygon, width, depth)) throw new Error('当前场地是复杂轮廓，暂只能在这里修改明确的矩形场地。原轮廓已保留。');
  const corners = [{ x: 0, z: 0 }, { x: width, z: 0 }, { x: width, z: depth }, { x: 0, z: depth }];
  const exterior = scene.structure.walls.filter(wall => wall.kind === 'exterior');
  const edges = exterior.map(wall => {
    const a = corners.findIndex(corner => same(wall.start.x, corner.x) && same(wall.start.z, corner.z));
    const b = corners.findIndex(corner => same(wall.end.x, corner.x) && same(wall.end.z, corner.z));
    return [a, b].sort().join(':');
  });
  if (exterior.length !== 4 || new Set(edges).size !== 4 || edges.some(edge => !['0:1', '1:2', '2:3', '0:3'].includes(edge))) {
    throw new Error('需要四条完整闭合的矩形外墙才能修改总宽和总深。当前墙体保持原样。');
  }
  return scene;
}

/** Fixed wire origin (0,0): resize only outer wall endpoints, not objects or interior structure. */
export function previewVenueEdit(base: RoomLayout, input: { width: number; depth: number; openings: SceneV2['structure']['openings'] }): RoomLayout {
  const current = readEditableVenue(base);
  const { width, depth } = input;
  if (![width, depth].every(value => Number.isFinite(value) && value >= 0.02 && value <= MAX_ROOM_DIMENSION)) {
    throw new Error(`请填写 0.02–${MAX_ROOM_DIMENSION} 米之间的总宽和总深。`);
  }
  const originals = new Map(current.structure.openings.map(opening => [opening.id, opening]));
  if (input.openings.length !== originals.size || new Set(input.openings.map(opening => opening.id)).size !== originals.size || input.openings.some(opening => !originals.has(opening.id))) {
    throw new Error('门窗清单已经变化，不能新增、删除或替换门窗。请重新打开当前场地核对。');
  }
  const edits = new Map(input.openings.map(opening => [opening.id, opening]));
  const changedOpenings = new Set<string>();
  const next = structuredClone(current);
  next.venue.width = width;
  next.venue.depth = depth;
  const resized = width !== current.venue.width || depth !== current.venue.depth;
  const point = (p: { x: number; z: number }) => ({
    x: width !== current.venue.width && same(p.x, current.venue.width) ? width : p.x,
    z: depth !== current.venue.depth && same(p.z, current.venue.depth) ? depth : p.z,
  });
  if (next.venue.polygon) next.venue.polygon = next.venue.polygon.map(point);
  const movedWalls = new Set<string>();
  next.structure.walls = next.structure.walls.map(wall => {
    if (wall.kind !== 'exterior') return wall;
    const start = point(wall.start), end = point(wall.end);
    if (start.x === wall.start.x && start.z === wall.start.z && end.x === wall.end.x && end.z === wall.end.z) return wall;
    movedWalls.add(wall.id);
    return { ...wall, start, end, status: 'confirmed' };
  });
  if (resized) {
    const geometric = layoutGeometryScene(base);
    const affected = base.floors[0].items.find(item => {
      if (item.structuralOpeningId || item.structuralColumnId) return false;
      const wallId = item.wallId ?? geometric.objects.find(object => object.id === item.id)?.wallId;
      return wallId ? movedWalls.has(wallId) : isWallHung(item.type);
    });
    if (affected) throw new Error(`“${affected.name}”关联的墙体会变化，请先核对这件挂墙物件。物件位置保持不变。`);
    const outside = next.structure.walls.some(wall => wall.kind === 'interior' && [wall.start, wall.end].some(p => p.x < -EPS || p.z < -EPS || p.x > width + EPS || p.z > depth + EPS));
    if (outside) throw new Error('新尺寸会使现有内墙超出场地，请先核对内墙。内墙位置保持不变。');
  }
  next.structure.openings = next.structure.openings.map(opening => {
    const edit = edits.get(opening.id)!;
    if (edit.wallId !== opening.wallId || edit.kind !== opening.kind) throw new Error('门窗所属墙体或类型已经变化，请重新打开当前场地核对。');
    if (openingFields.some(field => !Number.isFinite(edit[field]))) throw new Error('请填写有效的门窗米制尺寸。');
    if (!openingFields.some(field => edit[field] !== opening[field])) return opening;
    changedOpenings.add(opening.id);
    return { ...opening, offset: edit.offset, width: edit.width, height: edit.height, sillHeight: edit.sillHeight, status: 'confirmed' };
  });
  next.dimensions = next.dimensions.map(dimension => {
    if (dimension.kind === 'width' && width !== current.venue.width) return { ...dimension, valueMeters: width, status: 'confirmed' };
    if (dimension.kind === 'depth' && depth !== current.venue.depth) return { ...dimension, valueMeters: depth, status: 'confirmed' };
    // Image distances and pairs remain constraints; only an explicitly edited direct opening size is replaced.
    if (!dimension.targetId || !changedOpenings.has(dimension.targetId) || dimension.targetEndId || dimension.sourceAssetId || ['width', 'depth', 'height'].includes(dimension.kind) || dimension.measure && !['width', 'height'].includes(dimension.measure)) return dimension;
    const actual = measurement(next, dimension);
    return actual === undefined || actual === measurement(current, dimension) ? dimension : { ...dimension, valueMeters: actual, status: 'confirmed' };
  });
  const valid = sceneV2Schema.safeParse(next);
  if (!valid.success) throw new Error(valid.error.issues[0]?.message ?? '场地或门窗尺寸不合法，请重新核对。');
  const conflicts = dimensionConflicts(valid.data);
  if (conflicts.length) throw new Error(`尺寸仍有冲突，请核对：${conflicts.map(conflict => conflict.message).join('；')}`);
  const assets = base.floors[0].items.filter(item => item.assetId && item.glbUrl);
  const converted = backendSceneToLayout(valid.data, {
    name: base.name, ...(base.id ? { projectId: base.id } : {}),
    assetUrls: Object.fromEntries(assets.map(item => [item.assetId!, item.glbUrl!])),
    assetNames: Object.fromEntries(assets.map(item => [item.assetId!, item.name])),
  });
  const merged = mergeProposalPresentation(base, converted);
  const oldItems = new Map(base.floors[0].items.map(item => [item.id, item]));
  const oldWalls = new Map((base.floors[0].interiorWalls ?? []).map(wall => [wall.id, wall]));
  const candidate: RoomLayout = { ...merged, floors: merged.floors.map(floor => ({ ...floor,
    items: floor.items.map(item => {
      const old = oldItems.get(item.id);
      return old ? { ...old, position: item.position!, rotation: item.rotation!, width: item.width, depth: item.depth, height: item.height,
        ...(item.sillHeight !== undefined ? { sillHeight: item.sillHeight } : {}) } : item;
    }),
    interiorWalls: floor.interiorWalls!.map(wall => ({ ...oldWalls.get(wall.id), ...wall })),
  })) };
  if (!canApplyLayoutGeometry(base, candidate)) throw new Error('新尺寸或门窗位置会让物件穿墙、进入柱子或超出场地。请先调整物件位置。');
  // Run the ordinary persistence validator too, including references and retained dimensions.
  layoutToBackendScene(candidate);
  return candidate;
}
