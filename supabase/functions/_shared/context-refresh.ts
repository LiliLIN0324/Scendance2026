// 每轮刷新的地图上下文：把「现在是什么样」和「上一轮改了什么」压成一段可读文本。
//
// 这个模块只有纯函数：快照进、字符串出；不读文件、不取时间、不调模型。runner 负责
// 在每次模型调用前把结果拼进消息里，测试因此可以逐字断言。
//
// 仓库现有的 domain.Scene 是米制室内平面（venue + objects + structure），没有
// 水/山/路这类地图网格。这里只声明本模块消费的最小结构性快照契约；接线时由
// adapter 从真实快照投影成这个形状，不改动 domain 里的任何类型。
import { phaseLabel, type AgentPhase } from './agent-progress.ts';

/** 地形只有四类；比较时按数组下标遍历，不对每格调用函数。 */
export type TerrainKind = 'water' | 'mountain' | 'road' | 'flat';

/** 与 AGENT_PHASES 同源，避免本模块另写一份阶段枚举。 */
export type Phase = AgentPhase;

/** 闭区间矩形，单位是地图格。 */
export interface GridRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 地图上的一个矩形实体：物件或不可覆盖结构。 */
export interface SceneBox {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 地图网格快照。
 *
 * 字段刻意保持扁平：调用方从真实快照投影时只需填宽高、地形数组、可建矩形与实体，
 * 不需要构造第二套场景对象。`cells` 行优先，索引 = y * width + x。
 */
export interface SceneSnapshot {
  width: number;
  height: number;
  /** 行优先地形；长度应为 width * height，缺省位置按 flat 处理。 */
  cells: readonly TerrainKind[];
  /** 单元格 (0,0) 对应的世界坐标；默认 0。 */
  originX?: number;
  originY?: number;
  /** 可建矩形（闭区间，世界坐标）；缺省表示全图可建。 */
  buildable?: GridRect;
  /** 不可覆盖的结构，例如广场、设施站。 */
  structures?: readonly SceneBox[];
  /** 可移动物件。 */
  objects?: readonly SceneBox[];
}

export interface SceneDelta {
  cellsChanged: number;
  cellsAdded: { water: number; mountain: number; road: number; flat: number };
  cellsRemoved: { water: number; mountain: number; road: number; flat: number };
  objectsAdded: Array<{ id: string; kind: string; x: number; y: number; w: number; h: number }>;
  objectsRemoved: string[];
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  isEmpty: boolean;
}

export interface RoundContextInput {
  scene: SceneSnapshot;
  /** 当前第几轮，从 1 起。 */
  round: number;
  maxRounds: number;
  phase: Phase;
  /** 上一轮的增量；第一轮不传。 */
  delta?: SceneDelta;
  /** 用户当前选中的格子，用于代词消解。 */
  selection?: { x: number; y: number } | null;
  lastError?: { code: string; target?: string } | null;
}

const TERRAIN_ORDER: readonly TerrainKind[] = ['water', 'mountain', 'road', 'flat'];
/** 5×5 块内出现平局时，优先显示更“显眼”的地形。 */
const TERRAIN_PRIORITY: readonly TerrainKind[] = ['mountain', 'water', 'road', 'flat'];
const TERRAIN_GLYPHS: Record<TerrainKind, string> = { water: '~', mountain: '1', road: '=', flat: '.' };
const TERRAIN_LABELS: Record<TerrainKind, string> = { water: '水', mountain: '山', road: '路', flat: '平' };
const TERRAIN_NAMES: Record<TerrainKind, string> = { water: '水面', mountain: '山地', road: '道路', flat: '平地' };
const BLOCK = 5;
const MAX_PLANE_ROWS = 32;
const MAX_CONTEXT_CHARS = 1400;
const STRUCTURE_LIMITS: readonly number[] = [Number.POSITIVE_INFINITY, 8, 4, 2, 1, 0];

function emptyTerrainCounts(): Record<TerrainKind, number> {
  return { water: 0, mountain: 0, road: 0, flat: 0 };
}

function floorCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function safeRound(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function sameBox(left: SceneBox, right: SceneBox): boolean {
  return left.kind === right.kind && left.x === right.x && left.y === right.y && left.w === right.w && left.h === right.h;
}

function formatPlaced(box: SceneBox): string {
  return `${box.kind}@(${box.x},${box.y}) ${box.w}×${box.h}`;
}

function formatStructure(box: SceneBox): string {
  return `${box.kind}(${box.x},${box.y}) ${box.w}×${box.h}`;
}

/**
 * 对比两次快照。
 *
 * 地形相同布局走单次下标遍历；只有宽高或原点变了才退回坐标 Map，避免把“原点平移”
 * 误判成整图重画。物件按 id 对齐；同一 id 但位置/尺寸/类型变了，按“删旧的、放新的”计。
 */
export function diffScene(before: SceneSnapshot, after: SceneSnapshot): SceneDelta {
  const cellsAdded = emptyTerrainCounts();
  const cellsRemoved = emptyTerrainCounts();
  let cellsChanged = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const beforeOriginX = before.originX ?? 0;
  const beforeOriginY = before.originY ?? 0;
  const afterOriginX = after.originX ?? 0;
  const afterOriginY = after.originY ?? 0;
  const afterWidth = Math.max(0, Math.floor(after.width));
  const afterHeight = Math.max(0, Math.floor(after.height));
  const total = afterWidth * afterHeight;
  const sameGrid = before.width === after.width
    && before.height === after.height
    && beforeOriginX === afterOriginX
    && beforeOriginY === afterOriginY;

  if (sameGrid) {
    for (let index = 0; index < total; index++) {
      const oldKind = before.cells[index] ?? 'flat';
      const newKind = after.cells[index] ?? 'flat';
      if (oldKind === newKind) continue;
      cellsChanged++;
      cellsRemoved[oldKind]++;
      cellsAdded[newKind]++;
      const x = afterOriginX + (index % Math.max(1, afterWidth));
      const y = afterOriginY + Math.floor(index / Math.max(1, afterWidth));
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  } else {
    const beforeWidth = Math.max(0, Math.floor(before.width));
    const beforeTotal = beforeWidth * Math.max(0, Math.floor(before.height));
    const previous = new Map<string, { kind: TerrainKind; x: number; y: number }>();
    for (let index = 0; index < beforeTotal; index++) {
      const x = beforeOriginX + (index % Math.max(1, beforeWidth));
      const y = beforeOriginY + Math.floor(index / Math.max(1, beforeWidth));
      previous.set(`${x},${y}`, { kind: before.cells[index] ?? 'flat', x, y });
    }
    for (let index = 0; index < total; index++) {
      const x = afterOriginX + (index % Math.max(1, afterWidth));
      const y = afterOriginY + Math.floor(index / Math.max(1, afterWidth));
      const key = `${x},${y}`;
      const old = previous.get(key);
      const newKind = after.cells[index] ?? 'flat';
      if (old) {
        previous.delete(key);
        if (old.kind === newKind) continue;
        cellsRemoved[old.kind]++;
      }
      cellsChanged++;
      cellsAdded[newKind]++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    for (const { kind, x, y } of previous.values()) {
      cellsChanged++;
      cellsRemoved[kind]++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const beforeObjects = new Map<string, SceneBox>();
  for (const box of before.objects ?? []) beforeObjects.set(box.id, box);
  const afterObjects = new Map<string, SceneBox>();
  for (const box of after.objects ?? []) afterObjects.set(box.id, box);

  const objectsAdded: SceneBox[] = [];
  const objectsRemoved: string[] = [];
  const matched = new Set<string>();
  const includeBox = (box: SceneBox) => {
    const width = Math.max(1, Math.floor(box.w));
    const height = Math.max(1, Math.floor(box.h));
    const x0 = Math.floor(box.x);
    const y0 = Math.floor(box.y);
    const x1 = x0 + width - 1;
    const y1 = y0 + height - 1;
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
    if (y0 < minY) minY = y0;
    if (y1 > maxY) maxY = y1;
  };

  for (const [id, box] of afterObjects) {
    const old = beforeObjects.get(id);
    if (!old) {
      objectsAdded.push(box);
      includeBox(box);
      continue;
    }
    matched.add(id);
    if (!sameBox(old, box)) {
      // 同一 id 被移动/缩放/改类型：按删旧放新计，避免 isEmpty 漏报。
      objectsAdded.push(box);
      objectsRemoved.push(id);
      includeBox(old);
      includeBox(box);
    }
  }
  for (const [id, box] of beforeObjects) {
    if (matched.has(id)) continue;
    objectsRemoved.push(id);
    includeBox(box);
  }

  const bounds = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined;
  return {
    cellsChanged,
    cellsAdded,
    cellsRemoved,
    objectsAdded,
    objectsRemoved,
    bounds,
    isEmpty: cellsChanged === 0 && objectsAdded.length === 0 && objectsRemoved.length === 0,
  };
}

/** 把增量渲染成一行紧凑中文；空增量就是“模型空转”的显式信号。 */
export function renderDelta(delta: SceneDelta): string {
  if (delta.isEmpty) return '上一步：地图没有变化。';
  const parts: string[] = [];

  if (delta.cellsChanged > 0) {
    const positive: string[] = [];
    const negative: string[] = [];
    for (const kind of TERRAIN_ORDER) {
      const net = delta.cellsAdded[kind] - delta.cellsRemoved[kind];
      if (net > 0) positive.push(`${TERRAIN_LABELS[kind]} +${net}`);
      else if (net < 0) negative.push(`${TERRAIN_LABELS[kind]} ${net}`);
    }
    // 草地→水只报「水 +32」：背景地的减少不占篇幅；没有净增时报净减。
    parts.push(`改地形 ${delta.cellsChanged} 格（${(positive.length ? positive : negative).join('、') || '净变化 0'}）`);
  } else {
    parts.push('未改地形');
  }

  if (delta.objectsAdded.length > 0) {
    const shown = delta.objectsAdded.slice(0, 3).map(formatPlaced);
    const more = delta.objectsAdded.length > 3 ? `，等 ${delta.objectsAdded.length} 个` : '';
    parts.push(`放物件 ${delta.objectsAdded.length} 个（${shown.join('、')}${more}）`);
  } else {
    parts.push('未放物件');
  }

  if (delta.objectsRemoved.length > 0) {
    const shown = delta.objectsRemoved.slice(0, 3);
    const more = delta.objectsRemoved.length > 3 ? `，等 ${delta.objectsRemoved.length} 个` : '';
    parts.push(`删物件 ${delta.objectsRemoved.length} 个（${shown.join('、')}${more}）`);
  } else {
    parts.push('未删任何东西');
  }

  const range = delta.bounds
    ? `；变化范围 x${delta.bounds.minX}-${delta.bounds.maxX} / y${delta.bounds.minY}-${delta.bounds.maxY}`
    : '';
  return `上一步：${parts.join('、')}${range}。`;
}

function countTerrain(scene: SceneSnapshot): Record<TerrainKind, number> {
  const counts = emptyTerrainCounts();
  const width = floorCount(scene.width);
  const height = floorCount(scene.height);
  for (let index = 0; index < width * height; index++) {
    counts[scene.cells[index] ?? 'flat']++;
  }
  return counts;
}

function terrainAt(scene: SceneSnapshot, x: number, y: number): TerrainKind | null {
  const width = floorCount(scene.width);
  const height = floorCount(scene.height);
  if (width === 0 || height === 0) return null;
  const column = Math.floor(x - (scene.originX ?? 0));
  const row = Math.floor(y - (scene.originY ?? 0));
  if (column < 0 || row < 0 || column >= width || row >= height) return null;
  return scene.cells[row * width + column] ?? 'flat';
}

function buildableText(rect: GridRect | undefined): string {
  return rect ? `可建 ${rect.minX},${rect.minY}-${rect.maxX},${rect.maxY}` : '可建 全图';
}

function structureText(structures: readonly SceneBox[], limit: number): string {
  if (structures.length === 0) return '无';
  if (limit <= 0) return `共 ${structures.length} 个（略）`;
  const shown = structures.slice(0, limit).map(formatStructure);
  if (structures.length > limit) shown.push(`等 ${structures.length - limit} 个`);
  return shown.join('；');
}

function selectionLine(scene: SceneSnapshot, selection: { x: number; y: number }): string {
  const kind = terrainAt(scene, selection.x, selection.y);
  return `你选中的格子：(${selection.x},${selection.y}) ${kind ? TERRAIN_NAMES[kind] : '地图外'} —— 用户说的"这里/它"指这里`;
}

function dominantTerrain(counts: Record<TerrainKind, number>): string {
  let best: TerrainKind = 'flat';
  let bestCount = -1;
  for (const kind of TERRAIN_PRIORITY) {
    if (counts[kind] > bestCount) {
      best = kind;
      bestCount = counts[kind];
    }
  }
  return TERRAIN_GLYPHS[best];
}

function markBox(mask: Uint8Array, width: number, height: number, scene: SceneSnapshot, box: SceneBox, value: 1 | 2): void {
  const originX = scene.originX ?? 0;
  const originY = scene.originY ?? 0;
  const x0 = Math.max(0, Math.floor(box.x - originX));
  const y0 = Math.max(0, Math.floor(box.y - originY));
  const x1 = Math.min(width - 1, Math.floor(box.x - originX + Math.max(1, Math.floor(box.w)) - 1));
  const y1 = Math.min(height - 1, Math.floor(box.y - originY + Math.max(1, Math.floor(box.h)) - 1));
  if (x0 > x1 || y0 > y1) return;
  for (let y = y0; y <= y1; y++) {
    const row = y * width;
    for (let x = x0; x <= x1; x++) {
      const index = row + x;
      if (mask[index] < value) mask[index] = value;
    }
  }
}

interface PlaneRow {
  line: string;
  empty: boolean;
}

function insideRect(rect: GridRect | undefined, x: number, y: number): boolean {
  return !!rect && x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;
}

/** 5×5 格一字；对象/结构优先于地形，保证落笔位置不会被草地淹没。 */
function renderPlaneRows(scene: SceneSnapshot): PlaneRow[] {
  const width = Math.max(1, floorCount(scene.width));
  const height = Math.max(1, floorCount(scene.height));
  const originX = scene.originX ?? 0;
  const originY = scene.originY ?? 0;
  const mask = new Uint8Array(width * height);
  for (const box of scene.structures ?? []) markBox(mask, width, height, scene, box, 2);
  for (const box of scene.objects ?? []) markBox(mask, width, height, scene, box, 1);

  const columns = Math.ceil(width / BLOCK);
  const rowCount = Math.ceil(height / BLOCK);
  const yWidth = Math.max(1, String(Math.trunc(originY + height - 1)).length);
  const rows: PlaneRow[] = [];

  for (let row = 0; row < rowCount; row++) {
    const y0 = row * BLOCK;
    const y1 = Math.min(height, y0 + BLOCK);
    let line = '';
    let content = false;
    for (let column = 0; column < columns; column++) {
      const x0 = column * BLOCK;
      const x1 = Math.min(width, x0 + BLOCK);
      let structures = 0;
      let objects = 0;
      const counts = emptyTerrainCounts();
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const index = y * width + x;
          const flag = mask[index];
          if (flag === 2) structures++;
          else if (flag === 1) objects++;
          const kind = scene.cells[index] ?? 'flat';
          counts[kind]++;
          if (kind !== 'flat' || flag !== 0) content = true;
          if (insideRect(scene.buildable, originX + x, originY + y)) content = true;
        }
      }
      line += structures > 0 ? '#' : objects > 0 ? 'o' : dominantTerrain(counts);
    }
    // 没有可建矩形时，整张图都是工作区，不能因为“全是草地”把整行折掉。
    if (!scene.buildable) content = true;
    rows.push({ line: `y=${String(Math.trunc(originY + y0)).padStart(yWidth)} ${line}`, empty: !content });
  }
  return rows;
}

/** 只保留有内容的行区间；中间连续 3 行以上全空折成一行 `...`。 */
function foldPlaneRows(rows: PlaneRow[]): string[] {
  const first = rows.findIndex(row => !row.empty);
  if (first < 0) return rows.length > 0 ? ['  ...'] : [];
  let last = rows.length - 1;
  while (last > first && rows[last].empty) last--;

  const kept: string[] = [];
  let run: string[] = [];
  for (const row of rows.slice(first, last + 1)) {
    if (row.empty) {
      run.push(row.line);
      continue;
    }
    if (run.length >= 3) kept.push('  ...');
    else kept.push(...run);
    run = [];
    kept.push(row.line);
  }
  if (run.length >= 3) kept.push('  ...');
  else kept.push(...run);
  return kept;
}

/** 超预算时先砍平面行数：保留首尾，中间折一行 `...`。 */
function trimPlaneRows(rows: string[], maxRows: number): string[] {
  if (maxRows <= 0) return [];
  if (rows.length <= maxRows) return rows;
  if (maxRows === 1) return ['  ...'];
  const keep = maxRows - 1;
  const top = Math.ceil(keep / 2);
  const bottom = keep - top;
  return [...rows.slice(0, top), '  ...', ...rows.slice(rows.length - bottom)];
}

function renderWithStructureLimit(
  input: RoundContextInput,
  structureLimit: number,
  plane: string[],
  counts: Record<TerrainKind, number>,
): string {
  const scene = input.scene;
  const round = safeRound(input.round);
  const maxRounds = Math.max(round, safeRound(input.maxRounds));
  const lines: string[] = [
    '<round_context>',
    `轮次：第 ${round}/${maxRounds} 轮 · 阶段：${phaseLabel(input.phase)}`,
    `地图：${scene.width}×${scene.height}，${buildableText(scene.buildable)}`,
    `地形：水 ${counts.water} 格 / 山 ${counts.mountain} 格 / 路 ${counts.road} 格`,
    `结构（不可覆盖）：${structureText(scene.structures ?? [], structureLimit)}`,
  ];

  if (input.selection) lines.push(selectionLine(scene, input.selection));
  lines.push(input.delta ? renderDelta(input.delta) : '上一步：首轮，没有上一轮增量。');
  if (input.lastError) {
    const target = input.lastError.target ? `（target=${input.lastError.target}）` : '';
    lines.push(`上一步错误：${input.lastError.code}${target}—— 重试前先重新读该区域`);
  }

  const header = '平面（每字符=5×5 格，. 草地 ~ 水 1 山 = 路 o 物件 # 结构）：';
  let chosen = plane;
  for (;;) {
    const text = [...lines, header, ...chosen, '</round_context>'].join('\n');
    if (text.length <= MAX_CONTEXT_CHARS || chosen.length === 0) return text;
    const next = Math.max(0, chosen.length - Math.max(1, Math.ceil(chosen.length / 8)));
    chosen = trimPlaneRows(plane, next);
  }
}

/**
 * 每轮注入的完整上下文块。
 *
 * 预算顺序：先砍平面行数，再砍结构清单条数；轮次、地图、地形、上一轮增量、
 * 选中格与 lastError 始终保留。
 */
export function renderRoundContext(input: RoundContextInput): string {
  const counts = countTerrain(input.scene);
  const plane = foldPlaneRows(renderPlaneRows(input.scene)).slice(0, MAX_PLANE_ROWS);
  for (const limit of STRUCTURE_LIMITS) {
    const text = renderWithStructureLimit(input, limit, plane, counts);
    if (text.length <= MAX_CONTEXT_CHARS) return text;
  }
  return renderWithStructureLimit(input, 0, plane, counts);
}

/**
 * 无进展闸门：只判断，不抛错。
 *
 * errorCodes 按轮次顺序传入（没有错误的那轮传空串）；最后两项就是最近两轮。
 * 连续两轮“地图没变且都报错”说明模型在空转；同一错误码出现两次说明被同一规则
 * 反复挡住，继续往返只会烧预算。
 */
export function shouldStopForNoProgress(
  deltas: SceneDelta[],
  errorCodes: string[],
): { stop: boolean; reason?: string } {
  const lastTwo = deltas.slice(-2);
  const lastTwoErrors = errorCodes.slice(-2);
  if (
    lastTwo.length === 2
    && lastTwo.every(delta => delta.isEmpty)
    && lastTwoErrors.length === 2
    && lastTwoErrors.every(code => code.trim().length > 0)
  ) {
    return { stop: true, reason: 'NO_PROGRESS' };
  }

  const seen = new Map<string, number>();
  for (const raw of errorCodes) {
    const code = raw.trim();
    if (!code) continue;
    const next = (seen.get(code) ?? 0) + 1;
    if (next >= 2) return { stop: true, reason: 'REPEAT_BLOCKED' };
    seen.set(code, next);
  }
  return { stop: false };
}
