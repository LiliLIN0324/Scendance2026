// A compact, human-readable picture of a scene for the model: the same idea as a
// floor plan on paper — one character per grid cell, plus counted facts.
import { footprint, footprintsIntersect } from './structural-geometry.ts';
import type { Point, Scene, SceneObject, SceneV2 } from './domain.ts';

export type Structure = SceneV2['structure'];
/** V1 scenes have no structural layer; reading one must not pretend otherwise. */
export function structureOf(scene: Scene): Structure {
  return scene.schemaVersion === 2 ? (scene as SceneV2).structure : { walls: [], openings: [], columns: [] };
}

const GLYPH: Record<string, string> = {
  chair: 'c', table: 't', reception: 'r', backdrop: 'b',
  display: 'd', partition: 'p', carpet: ',', decoration: 'x', asset: 'A',
};
const NAMES: Record<string, string> = {
  chair: '椅子', table: '桌子', reception: '签到台', backdrop: '背景板',
  display: '展架', partition: '隔断', carpet: '地毯', decoration: '装饰道具', asset: '外部模型',
};
export const PLAN_LEGEND = 'c 椅子 t 桌子 r 签到台 b 背景板 d 展架 p 隔断 , 地毯 x 装饰道具 A 外部模型 O 柱子 # 墙 = 门/窗洞 E 出入口 . 空地 （空格）场地外';

export type Rect = { x1: number; z1: number; x2: number; z2: number };
export type Plan = { cell: number; cols: number; rows: number; lines: string[]; legend: string };

export function venuePolygon(scene: Scene): Point[] {
  const v = scene.venue;
  return v.polygon ?? [{ x: 0, z: 0 }, { x: v.width, z: 0 }, { x: v.width, z: v.depth }, { x: 0, z: v.depth }];
}
function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}
function onSegment(p: Point, a: Point, b: Point) {
  return Math.abs(cross(a, b, p)) < 1e-6 && p.x >= Math.min(a.x, b.x) - 1e-6 && p.x <= Math.max(a.x, b.x) + 1e-6 && p.z >= Math.min(a.z, b.z) - 1e-6 && p.z <= Math.max(a.z, b.z) + 1e-6;
}
function insidePolygon(p: Point, poly: Point[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (onSegment(p, a, b)) return true;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}
/** 墙的占地矩形（按厚度向两侧各展开一半）。净距报告要用它量「到墙还有多远」。 */
export function wallPolygons(scene: Scene): Point[][] {
  return structureOf(scene).walls.map(wall => {
    const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z, length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length * wall.thickness / 2, nz = dx / length * wall.thickness / 2;
    return [
      { x: wall.start.x + nx, z: wall.start.z + nz }, { x: wall.end.x + nx, z: wall.end.z + nz },
      { x: wall.end.x - nx, z: wall.end.z - nz }, { x: wall.start.x - nx, z: wall.start.z - nz },
    ];
  });
}
function glyphOf(object: SceneObject) {
  const glyph = GLYPH[object.materialId] ?? '?';
  return object.locked ? glyph.toUpperCase() : glyph;
}

/** Render a floor plan: one character per `cell` metres, x across, z down. */
export function renderPlan(scene: Scene, options: { cell?: number; rect?: Rect } = {}): Plan {
  const poly = venuePolygon(scene);
  const area = options.rect ?? {
    x1: Math.min(...poly.map(p => p.x)), z1: Math.min(...poly.map(p => p.z)),
    x2: Math.max(...poly.map(p => p.x)), z2: Math.max(...poly.map(p => p.z)),
  };
  const spanX = Math.max(1e-6, area.x2 - area.x1), spanZ = Math.max(1e-6, area.z2 - area.z1);
  const cell = options.cell ?? Math.max(0.5, Math.ceil(Math.max(spanX / 48, spanZ / 30) * 2) / 2);
  const cols = Math.max(1, Math.ceil(spanX / cell)), rows = Math.max(1, Math.ceil(spanZ / cell));
  const walls = wallPolygons(scene);
  const columns = scene.schemaVersion === 2 ? structureOf(scene).columns : [];
  const openings = scene.schemaVersion === 2 ? structureOf(scene).openings : [];
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    for (let col = 0; col < cols; col++) {
      const x0 = area.x1 + col * cell, z0 = area.z1 + row * cell, x1 = x0 + cell, z1 = z0 + cell;
      const point = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
      if (!insidePolygon(point, poly)) { line += ' '; continue; }
      // Sample the whole cell, not its centre: a 0.15 m backdrop or a 0.2 m wall would vanish otherwise.
      const square = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
      let glyph = '.';
      if (walls.some(wall => footprintsIntersect(square, wall))) glyph = '#';
      if (columns.some(column => footprintsIntersect(square, footprint(column)))) glyph = 'O';
      const object = scene.objects.find(candidate => footprintsIntersect(square, footprint(candidate)));
      if (object) glyph = glyphOf(object);
      if (openings.some(opening => {
        const wall = structureOf(scene).walls.find(w => w.id === opening.wallId);
        if (!wall) return false;
        const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z, length = Math.hypot(dx, dz) || 1;
        const center = { x: wall.start.x + dx * (opening.offset + opening.width / 2) / length, z: wall.start.z + dz * (opening.offset + opening.width / 2) / length };
        return Math.hypot(point.x - center.x, point.z - center.z) <= cell * 0.75;
      })) glyph = '=';
      if (scene.venue.entrances.some(entrance => Math.hypot(point.x - entrance.position.x, point.z - entrance.position.z) <= cell * 0.75)) glyph = 'E';
      line += glyph;
    }
    lines.push(line);
  }
  return { cell, cols, rows, lines, legend: PLAN_LEGEND };
}

function overlaps(a: Rect, b: Rect) {
  return a.x1 < b.x2 - 1e-6 && b.x1 < a.x2 - 1e-6 && a.z1 < b.z2 - 1e-6 && b.z1 < a.z2 - 1e-6;
}
function rectOfObject(object: Pick<SceneObject, 'position' | 'size' | 'rotation'>): Rect {
  const points = footprint(object);
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  return { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };
}

/** Largest empty square on the rendered grid, reported at its centre in venue coordinates. */
function largestEmptySquare(lines: string[], cell: number, origin: { x: number; z: number }) {
  const rows = lines.length, cols = rows ? lines[0].length : 0;
  const best: number[][] = Array.from({ length: rows + 1 }, () => new Array(cols + 1).fill(0));
  let size = 0, at = { col: 0, row: 0 };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (lines[row][col] !== '.') continue;
      const value = Math.min(best[row][col + 1], best[row + 1][col], best[row][col]) + 1;
      best[row + 1][col + 1] = value;
      if (value > size) { size = value; at = { col, row }; }
    }
  }
  if (!size) return null;
  // (col,row) is the far corner of the square; its centre sits half a square back on both axes.
  const centerCol = at.col - (size - 1) / 2 + 0.5, centerRow = at.row - (size - 1) / 2 + 0.5;
  return {
    cells: size,
    meters: Number((size * cell).toFixed(2)),
    at: { x: Number((origin.x + centerCol * cell).toFixed(2)), z: Number((origin.z + centerRow * cell).toFixed(2)) },
  };
}

export type SceneDigest = {
  venue: { width: number; depth: number; height: number; shape: string; polygonVertices: number; floorArea: number; entrances: { id: string; x: number; z: number; width: number }[]; mainEntrance?: string };
  structure: { walls: number; exterior: number; interior: number; wallLength: number; doors: number; windows: number; columns: number };
  occupancy: {
    objects: number; locked: number; coveragePercent: number; footprintArea: number;
    byMaterial: { materialId: string; name: string; count: number; area: number }[];
    unplacedFloorArea: number;
  };
  footprint: { x1: number; z1: number; x2: number; z2: number };
  largestEmptySquare: { cells: number; meters: number; at: { x: number; z: number } } | null;
  plan: Plan;
  notes: string[];
};

export function sceneDigest(scene: Scene): SceneDigest {
  const poly = venuePolygon(scene);
  const box = {
    x1: Math.min(...poly.map(p => p.x)), z1: Math.min(...poly.map(p => p.z)),
    x2: Math.max(...poly.map(p => p.x)), z2: Math.max(...poly.map(p => p.z)),
  };
  const floorArea = scene.venue.width * scene.venue.depth;
  const groups = new Map<string, { count: number; area: number }>();
  let footprintArea = 0, locked = 0;
  for (const object of scene.objects) {
    const area = object.size.width * object.size.depth;
    footprintArea += area;
    if (object.locked) locked++;
    const group = groups.get(object.materialId) ?? { count: 0, area: 0 };
    groups.set(object.materialId, { count: group.count + 1, area: group.area + area });
  }
  const plan = renderPlan(scene);
  const structure = structureOf(scene);
  const notes: string[] = [
    `概览按 ${plan.cell} 米一格渲染，只表示占位与相邻关系，不代表可通行宽度；要判断摆不摆得下，用 find_free_areas。`,
    '物件坐标是占地中心（米），rotation 单位是度，逆时针为正。',
  ];
  if (scene.schemaVersion === 2 && scene.venue.heightSource === 'default') notes.push('层高仍是默认回退值，未确认；涉及高度合规的结论需要先确认。');
  if (scene.venue.entrances.length === 0) notes.push('场地没有登记出入口：动线只能按墙体洞口推断。');
  return {
    venue: {
      width: scene.venue.width, depth: scene.venue.depth, height: scene.venue.height,
      shape: scene.venue.shape, polygonVertices: poly.length, floorArea,
      entrances: scene.venue.entrances.map(e => ({ id: e.id, x: e.position.x, z: e.position.z, width: e.width })),
      ...(scene.venue.site?.mainEntrance ? { mainEntrance: scene.venue.site.mainEntrance.openingId } : {}),
    },
    structure: {
      walls: structure.walls.length,
      exterior: structure.walls.filter(w => w.kind === 'exterior').length,
      interior: structure.walls.filter(w => w.kind === 'interior').length,
      wallLength: Number(structure.walls.reduce((sum, w) => sum + Math.hypot(w.end.x - w.start.x, w.end.z - w.start.z), 0).toFixed(2)),
      doors: structure.openings.filter(o => o.kind === 'door').length,
      windows: structure.openings.filter(o => o.kind === 'window').length,
      columns: structure.columns.length,
    },
    occupancy: {
      objects: scene.objects.length, locked, coveragePercent: Number((footprintArea / Math.max(1e-6, floorArea) * 100).toFixed(1)),
      footprintArea: Number(footprintArea.toFixed(2)),
      byMaterial: [...groups.entries()].map(([materialId, group]) => ({ materialId, name: NAMES[materialId] ?? materialId, count: group.count, area: Number(group.area.toFixed(2)) })).sort((a, b) => b.count - a.count),
      unplacedFloorArea: Number(Math.max(0, floorArea - footprintArea).toFixed(2)),
    },
    footprint: box,
    largestEmptySquare: largestEmptySquare(plan.lines, plan.cell, { x: box.x1, z: box.z1 }),
    plan,
    notes,
  };
}

export type ZoneView = {
  cell: number;
  lines: string[];
  legend: string;
  walls: { id: string; from: Point; to: Point; thickness: number; height: number; kind: string }[];
  openings: { id: string; wallId: string; kind: string; offset: number; width: number; sillHeight: number; height: number }[];
  columns: { id: string; x: number; z: number; width: number; depth: number; height: number }[];
  objects: { id: string; materialId: string; name: string; x: number; z: number; width: number; depth: number; rotation: number; locked: boolean; elevation?: number }[];
  entrances: { id: string; x: number; z: number; width: number }[];
  empty: boolean;
};

/** Read one rectangle before editing it: the drawn local plan plus the entities inside. */
export function inspectZone(scene: Scene, rect: Rect): ZoneView {
  const cell = Math.max(0.25, Math.min(1, Math.ceil(Math.max((rect.x2 - rect.x1) / 40, (rect.z2 - rect.z1) / 24) * 4) / 4 || 0.25));
  const plan = renderPlan(scene, { rect, cell });
  const structure = scene.schemaVersion === 2 ? scene.structure : { walls: [], openings: [], columns: [] };
  const walls = structure.walls
    .map(wall => ({ wall, box: { x1: Math.min(wall.start.x, wall.end.x), z1: Math.min(wall.start.z, wall.end.z), x2: Math.max(wall.start.x, wall.end.x), z2: Math.max(wall.start.z, wall.end.z) } }))
    .filter(({ box }) => overlaps(rect, { x1: box.x1 - 0.2, z1: box.z1 - 0.2, x2: box.x2 + 0.2, z2: box.z2 + 0.2 }))
    .map(({ wall }) => ({ id: wall.id, from: wall.start, to: wall.end, thickness: wall.thickness, height: wall.height, kind: wall.kind }));
  const wallIds = new Set(walls.map(w => w.id));
  const objects = scene.objects.filter(object => overlaps(rect, rectOfObject(object))).map(object => ({
    id: object.id, materialId: object.materialId, name: NAMES[object.materialId] ?? object.materialId,
    x: object.position.x, z: object.position.z, width: object.size.width, depth: object.size.depth,
    rotation: object.rotation, locked: object.locked, ...(object.elevation !== undefined ? { elevation: object.elevation } : {}),
  }));
  return {
    cell, lines: plan.lines, legend: plan.legend,
    walls,
    openings: structure.openings.filter(opening => wallIds.has(opening.wallId)).map(opening => ({ id: opening.id, wallId: opening.wallId, kind: opening.kind, offset: opening.offset, width: opening.width, sillHeight: opening.sillHeight, height: opening.height })),
    columns: structure.columns.filter(column => overlaps(rect, rectOfObject(column))).map(column => ({ id: column.id, x: column.position.x, z: column.position.z, width: column.size.width, depth: column.size.depth, height: column.size.height })),
    objects,
    entrances: scene.venue.entrances.filter(e => e.position.x >= rect.x1 - 1 && e.position.x <= rect.x2 + 1 && e.position.z >= rect.z1 - 1 && e.position.z <= rect.z2 + 1).map(e => ({ id: e.id, x: e.position.x, z: e.position.z, width: e.width })),
    empty: !walls.length && !objects.length && !structure.columns.some(column => overlaps(rect, rectOfObject(column))),
  };
}
