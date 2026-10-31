import { structuralViolations } from '../../../../supabase/functions/_shared/structural-geometry';
import { floorKeepOut } from './floor-keep-out';
import { hasCollisions, rotatedHalfExtents, type CollisionContext } from './geometry';
import { isWallMounted } from './opening-snap';
import { canApplyLayoutGeometry, isStructuralMarker, layoutGeometryScene } from './structural-layout';
import type { FurnitureItem, RoomLayout, Vec2 } from './types';

/**
 * T-03 ③ 快速优化：只读画布几何，报冲突与动线，并给一条能当场预览的改法。
 *
 * 边界钉死：
 * - 只报画布上的几何事实（重叠 / 出界 / 压墙柱 / 挡入口留空 / 桌椅间距 / 桌椅配套），
 *   不写消防、疏散、无障碍之类的合规结论。
 * - 桌椅配套（孤椅 / 空桌）只报净距和座位数这类量得出来的事实，给不出稳妥改法就
 *   `fix: null`，不替人补椅子、也不猜这桌本来要坐几个人。
 * - 改法只算候选布局，不写画布；确认仍由调用方走 T-02 的「确认布置」。
 * - 锁着的、结构标记、墙上门窗、户外物件一律不挪；跳过的要报出来。
 */

export const SEAT_PULLOUT_METERS = 0.45;
export const TABLE_PASSAGE_METERS = 0.9;
/**
 * 椅子到最近桌沿的净距不超过这个值，才算「配到了桌」。
 * 比按中心点量的 1.6 m 更宽松：长桌两端的椅子中心离得远，但桌沿是挨着的。
 */
export const SEAT_TABLE_GAP_METERS = 1.8;

const SEAT_TYPES = new Set(['chair', 'dining-chair', 'bench', 'armchair', 'garden-bench']);
const TABLE_TYPES = new Set(['dining-table', 'table', 'counter', 'picnic-table', 'desk']);
/** 会配椅子的桌：再加咖啡桌、边几——椅子、扶手椅围着它们坐是正常摆法。 */
const PAIRING_TABLE_TYPES = new Set([...TABLE_TYPES, 'coffee-table', 'side-table']);
/** 会按「有没有座位」来报空桌的桌：吧台/收银台本来就不配椅，咖啡桌、边几可以单独摆。 */
const SEATING_TABLE_TYPES = new Set(['dining-table', 'table', 'picnic-table', 'desk']);
/** 能按座位数估的桌：吧台和书桌的座位口径不统一，不判「座位不足」。 */
const CAPACITY_TABLE_TYPES = new Set(['dining-table', 'table', 'picnic-table']);
/** 「孤椅」只认椅子；长凳、扶手椅本来就可以单独摆，不合成对来报。 */
const LOOSE_SEAT_TYPES = new Set(['chair', 'dining-chair']);
/** 桌边每 0.75 m 保守估一个座位（经验估法，不是规范，也不写进结论）。 */
const SEAT_PITCH_METERS = 0.75;
/** 长边前留不到 0.3 m 就当这侧贴着墙，那侧按坐不了人算。 */
const SIDE_CLEARANCE_METERS = 0.3;
/** 4 座以内的小桌按人数摆都说得通，不判「座位不足」；估出的座位数至少到这个数才判。 */
const MIN_CAPACITY_FOR_DEFICIT = 6;
/** 明显不足：现有座位不到估出的一半，并且至少少这么多。 */
const DEFICIT_MARGIN = 3;
const CLUSTER_RADIUS = 1.8;
const CLEARANCE_EPSILON = 1e-6;

export type ReviewIssueKind =
  | 'overlap' | 'structure' | 'bounds' | 'keep-out' | 'table-gap' | 'seat-clearance'
  | 'orphan-seat' | 'unpaired-table';
export type ReviewFixKind = 'separate' | 'move-inside' | 'clear-structure' | 'clear-entrance' | 'widen-gap' | 'pull-in';

export interface ReviewFix {
  label: string;
  kind: ReviewFixKind;
  /** 这条改法要处理的物料；点击时再算候选，不在这里存布局。 */
  itemIds: string[];
}

export interface ReviewIssue {
  id: string;
  kind: ReviewIssueKind;
  title: string;
  detail: string;
  itemIds: string[];
  fix: ReviewFix | null;
}

export interface ReviewReport {
  issues: ReviewIssue[];
  /** 入口缺失、隔墙未量这类「我没查什么」的说明；不伪装成问题。 */
  notes: string[];
  entranceKnown: boolean;
  checked: number;
  clean: boolean;
}

export interface ReviewSkip {
  name: string;
  /** locked = 锁着/结构标记，按规矩不动；no-spot = 附近找不到不压墙、不碰撞的落点。 */
  reason: 'locked' | 'no-spot';
}

export interface ReviewFixResult {
  layout: RoomLayout;
  /** 真正挪了位置的件数（同一件只算一次）。 */
  moved: number;
  /** 没动的物料，按原因点名。 */
  skipped: ReviewSkip[];
  /** 改完再体检一次，还剩下的问题。 */
  remaining: ReviewIssue[];
}

const ISSUE_ORDER: Record<ReviewIssueKind, number> = {
  overlap: 0, structure: 1, bounds: 2, 'keep-out': 3, 'table-gap': 4, 'seat-clearance': 5,
  // 配套只报证据、没有改法，排在所有能动的改法之后。
  'orphan-seat': 6, 'unpaired-table': 7,
};

const sideLabel: Record<'north' | 'south' | 'east' | 'west', string> = {
  north: '北侧', south: '南侧', east: '东侧', west: '西侧',
};

function displayName(item: Pick<FurnitureItem, 'name'>): string {
  return item.name === 'Dining Chair' ? '椅子' : item.name === 'Dining Table' ? '桌子' : item.name;
}

function isSeat(item: FurnitureItem): boolean { return SEAT_TYPES.has(item.type); }
function isTable(item: FurnitureItem): boolean { return TABLE_TYPES.has(item.type); }

function isReviewable(item: FurnitureItem): boolean {
  return !!item.position && !isStructuralMarker(item) && !isWallMounted(item.type) && item.category !== 'outdoor';
}

function isMovable(item: FurnitureItem): boolean {
  return isReviewable(item) && !item.locked;
}

function floorOf(layout: RoomLayout, floorIndex: number) {
  return layout.floors[Math.min(floorIndex, layout.floors.length - 1)];
}

function withItems(layout: RoomLayout, floorIndex: number, items: FurnitureItem[]): RoomLayout {
  const index = Math.min(floorIndex, layout.floors.length - 1);
  return { ...layout, floors: layout.floors.map((floor, i) => (i === index ? { ...floor, items } : floor)) };
}

function collisionContext(layout: RoomLayout, floorIndex: number): CollisionContext {
  return {
    // 边界、墙体、柱子统一交给 structuralViolations；这里只查互相碰撞与门前留空。
    structureValidated: true,
    keepOut: floorKeepOut(layout, floorIndex),
    interiorWalls: layout.backendSceneV2 ? [] : floorOf(layout, floorIndex)?.interiorWalls ?? [],
  };
}

function structuralCodes(layout: RoomLayout, floorIndex: number): Map<string, Set<string>> {
  const codes = new Map<string, Set<string>>();
  for (const violation of structuralViolations(layoutGeometryScene(layout, floorIndex))) {
    const set = codes.get(violation.objectId) ?? new Set<string>();
    set.add(violation.code);
    codes.set(violation.objectId, set);
  }
  return codes;
}

function overlapsPair(a: FurnitureItem, b: FurnitureItem, layout: RoomLayout): boolean {
  return hasCollisions(a, [a, b], layout.width, layout.height, { structureValidated: true });
}

function blocksKeepOut(item: FurnitureItem, layout: RoomLayout, floorIndex: number): boolean {
  const keepOut = floorKeepOut(layout, floorIndex);
  if (keepOut.length === 0) return false;
  return hasCollisions(item, [item], layout.width, layout.height, { structureValidated: true, keepOut });
}

function namesOf(items: readonly FurnitureItem[], limit = 3): string {
  const names = items.map(displayName).filter(Boolean);
  return `${names.slice(0, limit).join('、')}${names.length > limit ? ` 等 ${names.length} 件` : ''}`;
}

function boundaryGap(item: FurnitureItem, layout: RoomLayout): { side: 'north' | 'south' | 'east' | 'west'; gap: number } {
  const { halfW, halfD } = rotatedHalfExtents(item);
  const x = item.position?.x ?? 0, z = item.position?.z ?? 0;
  const gaps: Array<{ side: 'north' | 'south' | 'east' | 'west'; gap: number }> = [
    { side: 'west', gap: x - halfW + layout.width / 2 },
    { side: 'east', gap: layout.width / 2 - (x + halfW) },
    { side: 'north', gap: z - halfD + layout.height / 2 },
    { side: 'south', gap: layout.height / 2 - (z + halfD) },
  ];
  return gaps.reduce((best, next) => (next.gap < best.gap ? next : best));
}

interface OrientedBox { cx: number; cz: number; hw: number; hd: number; ax: number; az: number; bx: number; bz: number; }

function boxOf(item: FurnitureItem): OrientedBox {
  const rotation = item.rotation ?? 0, cos = Math.cos(rotation), sin = Math.sin(rotation);
  return {
    cx: item.position?.x ?? 0, cz: item.position?.z ?? 0,
    hw: item.width / 2, hd: item.depth / 2,
    ax: cos, az: -sin, bx: sin, bz: cos,
  };
}

/** 两个 OBB 的最近净距（沿分离轴的最大间隙）；重叠时为负数。 */
function boxGap(a: FurnitureItem, b: FurnitureItem): number {
  const first = boxOf(a), second = boxOf(b);
  const axes: ReadonlyArray<readonly [number, number]> = [
    [first.ax, first.az], [first.bx, first.bz], [second.ax, second.az], [second.bx, second.bz],
  ];
  const dx = second.cx - first.cx, dz = second.cz - first.cz;
  let best = -Infinity;
  for (const [axisX, axisZ] of axes) {
    const distance = Math.abs(dx * axisX + dz * axisZ);
    const extentA = first.hw * Math.abs(first.ax * axisX + first.az * axisZ) + first.hd * Math.abs(first.bx * axisX + first.bz * axisZ);
    const extentB = second.hw * Math.abs(second.ax * axisX + second.az * axisZ) + second.hd * Math.abs(second.bx * axisX + second.bz * axisZ);
    best = Math.max(best, distance - extentA - extentB);
  }
  return best;
}

interface Cluster { items: FurnitureItem[]; }

/** 把挨得近的桌椅并成一组：挪一组比挪一把椅子更接近现场做法。 */
function tableClusters(layout: RoomLayout, floorIndex: number): Cluster[] {
  const items = (floorOf(layout, floorIndex)?.items ?? []).filter(item => isReviewable(item) && (isSeat(item) || isTable(item)));
  const parent = items.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index]!)));
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      const distance = Math.hypot((a.position?.x ?? 0) - (b.position?.x ?? 0), (a.position?.z ?? 0) - (b.position?.z ?? 0));
      if (distance <= CLUSTER_RADIUS) union(i, j);
    }
  }
  const groups = new Map<number, FurnitureItem[]>();
  items.forEach((item, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(item);
    groups.set(root, group);
  });
  return [...groups.values()].map(group => ({ items: group }));
}

function nearestTable(seat: FurnitureItem, tables: readonly FurnitureItem[]): FurnitureItem | null {
  let best: FurnitureItem | null = null, bestDistance = Infinity;
  for (const table of tables) {
    const distance = Math.hypot((seat.position?.x ?? 0) - (table.position?.x ?? 0), (seat.position?.z ?? 0) - (table.position?.z ?? 0));
    if (distance < bestDistance) { bestDistance = distance; best = table; }
  }
  return bestDistance <= 1.6 ? best : null;
}

interface TightSeat { item: FurnitureItem; side: 'north' | 'south' | 'east' | 'west'; gap: number; }

function tightSeats(layout: RoomLayout, floorIndex: number): TightSeat[] {
  const items = (floorOf(layout, floorIndex)?.items ?? []).filter(isReviewable);
  const tables = items.filter(isTable);
  if (tables.length === 0) return [];
  const tight: TightSeat[] = [];
  for (const seat of items.filter(isSeat)) {
    if (!nearestTable(seat, tables)) continue;
    const { side, gap } = boundaryGap(seat, layout);
    if (gap >= -CLEARANCE_EPSILON && gap < SEAT_PULLOUT_METERS - CLEARANCE_EPSILON) tight.push({ item: seat, side, gap: Math.max(0, gap) });
  }
  return tight;
}

interface TightTablePair { a: FurnitureItem; b: FurnitureItem; gap: number; }

function tightTablePairs(layout: RoomLayout, floorIndex: number): TightTablePair[] {
  const tables = (floorOf(layout, floorIndex)?.items ?? []).filter(item => isReviewable(item) && isTable(item));
  const pairs: TightTablePair[] = [];
  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const a = tables[i]!, b = tables[j]!;
      const gap = boxGap(a, b);
      if (gap > 0.02 && gap < TABLE_PASSAGE_METERS - CLEARANCE_EPSILON) pairs.push({ a, b, gap });
    }
  }
  return pairs;
}

/* ───────── 桌椅配套：只量净距和座位数，不给改法 ───────── */

function isPairingTable(item: FurnitureItem): boolean { return PAIRING_TABLE_TYPES.has(item.type); }
function isSeatingTable(item: FurnitureItem): boolean { return SEATING_TABLE_TYPES.has(item.type); }
function isCapacityTable(item: FurnitureItem): boolean { return CAPACITY_TABLE_TYPES.has(item.type); }
function isLooseSeat(item: FurnitureItem): boolean { return LOOSE_SEAT_TYPES.has(item.type); }

/**
 * 沿世界方向 `dir`（单位向量）从物件中心量到场地墙的净空，已扣掉物件在该方向的半宽。
 * 旋转件按局部宽度轴 / 进深轴投影，和 boxOf 用同一套轴。
 */
function clearanceAlong(item: FurnitureItem, layout: RoomLayout, dir: Vec2): number {
  const rotation = item.rotation ?? 0, cos = Math.cos(rotation), sin = Math.sin(rotation);
  const halfAlong = (item.width / 2) * Math.abs(cos * dir.x - sin * dir.z)
    + (item.depth / 2) * Math.abs(sin * dir.x + cos * dir.z);
  const cx = item.position?.x ?? 0, cz = item.position?.z ?? 0;
  const toX = dir.x > 0 ? (layout.width / 2 - cx) / dir.x : dir.x < 0 ? (-layout.width / 2 - cx) / dir.x : Infinity;
  const toZ = dir.z > 0 ? (layout.height / 2 - cz) / dir.z : dir.z < 0 ? (-layout.height / 2 - cz) / dir.z : Infinity;
  return Math.min(toX, toZ) - halfAlong;
}

/**
 * 桌子两条长边按 SEAT_PITCH_METERS 一个座位保守估出的座位数：只数两长边、贴墙那侧不计，
 * 短边一个不数——估低了才不会把「按人数少摆两张」误报成座位不足。
 */
function tableSeatCapacity(table: FurnitureItem, layout: RoomLayout): number {
  const rotation = table.rotation ?? 0, cos = Math.cos(rotation), sin = Math.sin(rotation);
  // 宽 >= 深时长边沿宽度方向，外法线是进深轴 (sin, cos)；否则长边沿进深方向，外法线是宽度轴。
  const longIsWidth = table.width >= table.depth;
  const slots = Math.floor((longIsWidth ? table.width : table.depth) / SEAT_PITCH_METERS);
  if (slots <= 0) return 0;
  const normal: Vec2 = longIsWidth ? { x: sin, z: cos } : { x: cos, z: -sin };
  const usableSides = [normal, { x: -normal.x, z: -normal.z }]
    .filter(dir => clearanceAlong(table, layout, dir) >= SIDE_CLEARANCE_METERS).length;
  return slots * usableSides;
}

interface SeatPairing { seat: FurnitureItem; table: FurnitureItem; gap: number; }

/**
 * 桌椅配套：报两种画布上量得出来的事实，`fix` 一律为 null。
 * - 孤椅：这层大多数椅子已经配了桌，却有椅子离所有桌沿都超过 SEAT_TABLE_GAP_METERS；
 * - 空桌 / 座位明显不足：桌子周围一个座位都没有，或两条长边的估计座位连一半都不到。
 * 净距用 OBB 最近间隙，座位数是长边换算；都不是审美判断，也不下消防/承重/合规结论。
 */
function pairingIssues(layout: RoomLayout, items: readonly FurnitureItem[]): ReviewIssue[] {
  const tables = items.filter(isPairingTable);
  const seats = items.filter(item => SEAT_TYPES.has(item.type));
  if (tables.length === 0 || seats.length === 0) return [];

  const pairings: SeatPairing[] = seats.map(seat => {
    let table = tables[0]!;
    let gap = boxGap(seat, table);
    for (const candidate of tables.slice(1)) {
      const candidateGap = boxGap(seat, candidate);
      if (candidateGap < gap) { gap = candidateGap; table = candidate; }
    }
    return { seat, table, gap };
  });
  const atTables = pairings.filter(entry => entry.gap <= SEAT_TABLE_GAP_METERS);
  // 一半以上的座位已经挨着桌，才当这层是「桌椅成组」的摆法；整排会议椅、观众席
  // 本来就不配桌，宁可不说，也不能把它们报成孤椅。
  if (atTables.length * 2 < seats.length) return [];

  const issues: ReviewIssue[] = [];
  const pairedLoose = atTables.filter(entry => isLooseSeat(entry.seat));
  const orphans = pairings.filter(entry => isLooseSeat(entry.seat) && entry.gap > SEAT_TABLE_GAP_METERS);
  if (orphans.length > 0 && pairedLoose.length * 2 >= orphans.length + pairedLoose.length) {
    const minGap = Math.min(...orphans.map(entry => entry.gap));
    const worst = orphans.reduce((best, entry) => (entry.gap > best.gap ? entry : best));
    const gapText = orphans.length === 1 ? `${minGap.toFixed(2)} m` : `${minGap.toFixed(2)}–${worst.gap.toFixed(2)} m`;
    const count = `${orphans.length} 把椅子`;
    issues.push({
      id: `orphan-seat:${orphans.map(entry => entry.seat.id).sort().join('|')}`,
      kind: 'orphan-seat',
      title: `${count}离桌沿超过 ${SEAT_TABLE_GAP_METERS.toFixed(2)} m`,
      detail: `${namesOf(orphans.map(entry => entry.seat))}到最近桌沿（${displayName(worst.table)}）${gapText}，`
        + `超过 ${SEAT_TABLE_GAP_METERS.toFixed(2)} m 的成组距离；这一层另有 ${pairedLoose.length} 把椅子已经在桌边。`,
      itemIds: orphans.map(entry => entry.seat.id),
      fix: null,
    });
  }

  const assessed = tables.filter(isSeatingTable).map(table => ({
    table,
    nearSeats: seats.filter(seat => boxGap(seat, table) <= SEAT_TABLE_GAP_METERS).length,
  }));
  const emptyTables = assessed.filter(entry => entry.nearSeats === 0);
  if (emptyTables.length > 0) {
    const count = `${emptyTables.length} 张桌`;
    issues.push({
      id: `unpaired-table:${emptyTables.map(entry => entry.table.id).sort().join('|')}`,
      kind: 'unpaired-table',
      title: `${count}旁边没有椅子`,
      detail: `${namesOf(emptyTables.map(entry => entry.table))}四周 ${SEAT_TABLE_GAP_METERS.toFixed(2)} m 内没有找到座位；`
        + `这一层一共有 ${seats.length} 个座位。`,
      itemIds: emptyTables.map(entry => entry.table.id),
      fix: null,
    });
  }

  const sparse = assessed
    .filter(entry => entry.nearSeats > 0 && isCapacityTable(entry.table))
    .map(entry => ({ ...entry, capacity: tableSeatCapacity(entry.table, layout) }))
    .filter(entry => entry.capacity >= MIN_CAPACITY_FOR_DEFICIT
      && entry.nearSeats * 2 <= entry.capacity
      && entry.capacity - entry.nearSeats >= DEFICIT_MARGIN);
  if (sparse.length > 0) {
    const worst = sparse.reduce((best, entry) => (entry.capacity - entry.nearSeats > best.capacity - best.nearSeats ? entry : best));
    const more = sparse.length > 1 ? `另有 ${sparse.length - 1} 张桌同样偏空。` : '';
    const count = `${sparse.length} 张桌`;
    issues.push({
      id: `unpaired-table:${sparse.map(entry => entry.table.id).sort().join('|')}:seats`,
      kind: 'unpaired-table',
      title: `${count}的座位明显不足`,
      detail: `${displayName(worst.table)}两条长边按 ${SEAT_PITCH_METERS.toFixed(2)} m 一个座位估能坐 ${worst.capacity} 人，`
        + `桌边只量到 ${worst.nearSeats} 个座位。${more}`,
      itemIds: sparse.map(entry => entry.table.id),
      fix: null,
    });
  }
  return issues;
}

export function reviewLayout(layout: RoomLayout, floorIndex = 0): ReviewReport {
  const floor = floorOf(layout, floorIndex);
  const items = (floor?.items ?? []).filter(isReviewable);
  const codes = structuralCodes(layout, floorIndex);
  const issues: ReviewIssue[] = [];

  // 1. 重叠：按连通块归并，一次改法处理一组。
  const parent = items.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index]!)));
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlapsPair(items[i]!, items[j]!, layout)) union(i, j);
    }
  }
  const overlapGroups = new Map<number, FurnitureItem[]>();
  items.forEach((item, index) => {
    const root = find(index);
    const group = overlapGroups.get(root) ?? [];
    group.push(item);
    overlapGroups.set(root, group);
  });
  for (const group of overlapGroups.values()) {
    if (group.length < 2) continue;
    const ids = group.map(item => item.id).sort();
    issues.push({
      id: `overlap:${ids.join('|')}`,
      kind: 'overlap',
      title: `${group.length} 件物料挤在一起`,
      detail: `${namesOf(group)}的位置重叠了。`,
      itemIds: group.map(item => item.id),
      fix: { label: group.length > 2 ? '把这几件拉开' : '把其中一件挪开', kind: 'separate', itemIds: group.map(item => item.id) },
    });
  }

  // 2. 压墙/柱与出界：结构检查统一给 code，不重复报同一件。
  const wallItems = items.filter(item => {
    const set = codes.get(item.id);
    return !!set && (set.has('WALL_COLLISION') || set.has('COLUMN_COLLISION'));
  });
  if (wallItems.length) {
    issues.push({
      id: `structure:${wallItems.map(item => item.id).sort().join('|')}`,
      kind: 'structure',
      title: `${wallItems.length} 件物料压在墙或柱上`,
      detail: `${namesOf(wallItems)}和墙/柱的实体位置冲突。`,
      itemIds: wallItems.map(item => item.id),
      fix: { label: '把压到墙柱的挪开', kind: 'clear-structure', itemIds: wallItems.map(item => item.id) },
    });
  }
  const boundItems = items.filter(item => codes.get(item.id)?.has('OUT_OF_BOUNDS'));
  if (boundItems.length) {
    issues.push({
      id: `bounds:${boundItems.map(item => item.id).sort().join('|')}`,
      kind: 'bounds',
      title: `${boundItems.length} 件物料超出场地`,
      detail: `${namesOf(boundItems)}有一部分在场地边界或层高之外。`,
      itemIds: boundItems.map(item => item.id),
      fix: { label: '把出界的挪回场地', kind: 'move-inside', itemIds: boundItems.map(item => item.id) },
    });
  }

  // 3. 入口/楼梯口留空：只在有入口数据时检查，没有就如实说「不猜」。
  const keepOutItems = items.filter(item => blocksKeepOut(item, layout, floorIndex));
  if (keepOutItems.length) {
    issues.push({
      id: `keep-out:${keepOutItems.map(item => item.id).sort().join('|')}`,
      kind: 'keep-out',
      title: `${keepOutItems.length} 件物料挡住入口或楼梯口`,
      detail: `${namesOf(keepOutItems)}落在门前/楼梯口的留空里。`,
      itemIds: keepOutItems.map(item => item.id),
      fix: { label: '把入口留空让出来', kind: 'clear-entrance', itemIds: keepOutItems.map(item => item.id) },
    });
  }

  // 4. 动线：餐桌旁的拉椅空间、桌子之间的过道。
  const tight = tightSeats(layout, floorIndex);
  if (tight.length) {
    const bySide = new Map<'north' | 'south' | 'east' | 'west', number>();
    for (const seat of tight) bySide.set(seat.side, (bySide.get(seat.side) ?? 0) + 1);
    const minGap = tight.reduce((min, seat) => Math.min(min, seat.gap), Infinity);
    const sides = [...bySide.entries()].map(([side, count]) => `${sideLabel[side]} ${count} 把`).join('、');
    issues.push({
      id: 'seat-clearance',
      kind: 'seat-clearance',
      title: '靠边的椅子拉不开',
      detail: `${sides}椅子背后只有 ${minGap.toFixed(2)} m（不到 ${SEAT_PULLOUT_METERS.toFixed(2)} m）。`,
      itemIds: tight.map(seat => seat.item.id),
      fix: { label: '把靠边的桌椅往场中挪', kind: 'pull-in', itemIds: tight.map(seat => seat.item.id) },
    });
  }
  const tightPairs = tightTablePairs(layout, floorIndex);
  if (tightPairs.length) {
    const worst = tightPairs.reduce((min, pair) => (pair.gap < min.gap ? pair : min));
    const involved = new Set<string>();
    for (const pair of tightPairs) { involved.add(pair.a.id); involved.add(pair.b.id); }
    issues.push({
      id: `table-gap:${[...involved].sort().join('|')}`,
      kind: 'table-gap',
      title: '桌子之间过道偏窄',
      detail: `最窄 ${worst.gap.toFixed(2)} m（不到 ${TABLE_PASSAGE_METERS.toFixed(2)} m）：${displayName(worst.a)}和${displayName(worst.b)}。`,
      itemIds: [...involved],
      fix: { label: '把桌子这组往外让一点', kind: 'widen-gap', itemIds: [worst.a.id, worst.b.id] },
    });
  }

  // 5. 桌椅配套：只报孤椅/空桌这类量得出来的事实，不给改法（挪椅去凑桌是改人意图）。
  issues.push(...pairingIssues(layout, items));

  const entranceKnown = !!layout.entrance || (layout.backendVenue?.entrances?.length ?? 0) > 0
    || (floor?.items ?? []).some(item => !!item.venueEntranceId)
    || floorKeepOut(layout, floorIndex).some(rect => !rect.hole);
  const notes: string[] = [];
  if (!entranceKnown) notes.push('这张场地没有可识别的入口或门，入口通道我不猜。');
  if ((floor?.interiorWalls?.length ?? 0) > 0) notes.push('隔墙边的起身空间这版没量，只查了压墙。');
  if (items.length === 0) notes.push('画布上还没有可检查的物料。');

  const sorted = issues.sort((a, b) => ISSUE_ORDER[a.kind] - ISSUE_ORDER[b.kind]);
  return { issues: sorted, notes, entranceKnown, checked: items.length, clean: sorted.length === 0 };
}

/* ───────── 一点改法：只算候选，不写画布 ───────── */

function roundPosition(point: Vec2): Vec2 {
  return { x: Math.round(point.x * 1000) / 1000, z: Math.round(point.z * 1000) / 1000 };
}

function clampInside(item: FurnitureItem, layout: RoomLayout): Vec2 {
  const { halfW, halfD } = rotatedHalfExtents(item);
  const x = item.position?.x ?? 0, z = item.position?.z ?? 0;
  return {
    x: Math.min(layout.width / 2 - halfW, Math.max(-layout.width / 2 + halfW, x)),
    z: Math.min(layout.height / 2 - halfD, Math.max(-layout.height / 2 + halfD, z)),
  };
}

function candidateContext(layout: RoomLayout, floorIndex: number): CollisionContext {
  return collisionContext(layout, floorIndex);
}

interface SpotSearch { item: FurnitureItem; others: readonly FurnitureItem[]; layout: RoomLayout; floorIndex: number; preferred?: Vec2; }

function findFreeSpot({ item, others, layout, floorIndex, preferred }: SpotSearch): Vec2 | null {
  const start = item.position ?? { x: 0, z: 0 };
  const candidates: Vec2[] = [];
  if (preferred) candidates.push(preferred);
  for (let radius = 0.25; radius <= 3.01; radius += 0.25) {
    for (let step = 0; step < 16; step++) {
      const angle = (step / 16) * Math.PI * 2;
      candidates.push({ x: start.x + Math.cos(angle) * radius, z: start.z + Math.sin(angle) * radius });
    }
  }
  const context = candidateContext(layout, floorIndex);
  for (const point of candidates) {
    const placed = { ...item, position: roundPosition(point) };
    if (hasCollisions(placed, [...others, placed], layout.width, layout.height, context)) continue;
    const next = withItems(layout, floorIndex, [...others, placed]);
    if (structuralViolations(layoutGeometryScene(next, floorIndex)).some(violation => violation.objectId === placed.id)) continue;
    return placed.position;
  }
  return null;
}

function conflictsWith(item: FurnitureItem, items: readonly FurnitureItem[], layout: RoomLayout, kind: ReviewIssueKind, floorIndex: number): boolean {
  if (kind === 'overlap') return items.some(other => other.id !== item.id && overlapsPair(item, other, layout));
  if (kind === 'bounds') return structuralCodes(layout, floorIndex).get(item.id)?.has('OUT_OF_BOUNDS') ?? false;
  if (kind === 'structure') {
    const codes = structuralCodes(layout, floorIndex).get(item.id);
    return !!codes && (codes.has('WALL_COLLISION') || codes.has('COLUMN_COLLISION'));
  }
  if (kind === 'keep-out') return blocksKeepOut(item, layout, floorIndex);
  return false;
}

function fixConflicts(layout: RoomLayout, floorIndex: number, issue: ReviewIssue): ReviewFixResult | null {
  const floor = floorOf(layout, floorIndex);
  if (!floor) return null;
  const ids = new Set(issue.itemIds);
  const targets = floor.items.filter(item => ids.has(item.id));
  if (targets.length === 0) return null;
  const skipped: ReviewSkip[] = targets.filter(item => !isMovable(item)).map(item => ({ name: displayName(item), reason: 'locked' }));
  let items = floor.items.slice();
  let moved = 0;
  for (const target of targets) {
    if (!isMovable(target)) continue;
    const current = items.find(item => item.id === target.id);
    if (!current) continue;
    if (!conflictsWith(current, items, layout, issue.kind, floorIndex)) continue;
    const others = items.filter(item => item.id !== current.id);
    const preferred = issue.kind === 'bounds' ? clampInside(current, layout) : undefined;
    const spot = findFreeSpot({ item: current, others, layout, floorIndex, ...(preferred ? { preferred } : {}) });
    if (!spot) { skipped.push({ name: displayName(current), reason: 'no-spot' }); continue; }
    items = items.map(item => (item.id === current.id ? { ...current, position: spot } : item));
    moved += 1;
  }
  const next = moved > 0 ? withItems(layout, floorIndex, items) : layout;
  if (moved > 0 && !canApplyLayoutGeometry(layout, next)) return null;
  return { layout: next, moved, skipped: dedupeSkips(skipped), remaining: reviewLayout(next, floorIndex).issues };
}

function moveCluster(layout: RoomLayout, floorIndex: number, cluster: readonly FurnitureItem[], delta: Vec2): RoomLayout | null {
  if (!delta.x && !delta.z) return null;
  const floor = floorOf(layout, floorIndex);
  if (!floor) return null;
  const clusterIds = new Set(cluster.map(item => item.id));
  const rest = floor.items.filter(item => !clusterIds.has(item.id));
  const moved = cluster.map(item => ({
    ...item,
    position: roundPosition({ x: (item.position?.x ?? 0) + delta.x, z: (item.position?.z ?? 0) + delta.z }),
  }));
  const context = candidateContext(layout, floorIndex);
  const movedSet = new Set(moved.map(item => item.id));
  if (moved.some(item => hasCollisions(item, [...rest, ...moved], layout.width, layout.height, context))) return null;
  const next = withItems(layout, floorIndex, [...rest, ...moved]);
  if (structuralViolations(layoutGeometryScene(next, floorIndex)).some(violation => movedSet.has(violation.objectId))) return null;
  if (!canApplyLayoutGeometry(layout, next)) return null;
  return next;
}

function dedupeSkips(skips: ReviewSkip[]): ReviewSkip[] {
  const seen = new Set<string>();
  return skips.filter(skip => {
    const key = `${skip.reason}:${skip.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function liveCluster(layout: RoomLayout, floorIndex: number, cluster: Cluster): FurnitureItem[] {
  const items = floorOf(layout, floorIndex)?.items ?? [];
  return cluster.items
    .map(item => items.find(current => current.id === item.id))
    .filter((item): item is FurnitureItem => !!item);
}

function fixSeatClearance(layout: RoomLayout, floorIndex: number, issue: ReviewIssue): ReviewFixResult | null {
  const flagged = new Set(issue.itemIds);
  const clusters = tableClusters(layout, floorIndex).filter(cluster => cluster.items.some(item => flagged.has(item.id)));
  if (clusters.length === 0) return null;
  let working = layout;
  let moved = 0;
  const skipped: ReviewSkip[] = [];
  for (const cluster of clusters) {
    const group = liveCluster(working, floorIndex, cluster);
    if (group.length === 0) continue;
    const blocked = group.filter(item => !isMovable(item));
    if (blocked.length) {
      skipped.push(...blocked.map(item => ({ name: displayName(item), reason: 'locked' as const })));
      continue;
    }
    const tightHere = tightSeats(working, floorIndex).filter(seat => group.some(item => item.id === seat.item.id));
    if (tightHere.length === 0) continue;
    const minBySide = new Map<'north' | 'south' | 'east' | 'west', number>();
    for (const seat of tightHere) minBySide.set(seat.side, Math.min(minBySide.get(seat.side) ?? Infinity, seat.gap));
    // 往场中挪：东侧贴墙就往 -x 走，西侧往 +x，南侧往 -z，北侧往 +z。
    const inward: Vec2[] = [];
    for (const [side, gap] of minBySide) {
      const delta = SEAT_PULLOUT_METERS - gap + 0.05;
      if (side === 'east') inward.push({ x: -delta, z: 0 });
      if (side === 'west') inward.push({ x: delta, z: 0 });
      if (side === 'south') inward.push({ x: 0, z: -delta });
      if (side === 'north') inward.push({ x: 0, z: delta });
    }
    const sum = inward.reduce((total, delta) => ({ x: total.x + delta.x, z: total.z + delta.z }), { x: 0, z: 0 });
    const candidates: Vec2[] = [];
    const add = (delta: Vec2) => {
      if (Math.abs(delta.x) > 1e-9 || Math.abs(delta.z) > 1e-9) candidates.push(delta);
    };
    add(sum);
    for (const delta of inward) {
      add(delta);
      add({ x: delta.x * 1.5, z: delta.z * 1.5 });
      add({ x: delta.x * 2, z: delta.z * 2 });
    }
    let fixed: RoomLayout | null = null;
    for (const delta of candidates) {
      const next = moveCluster(working, floorIndex, group, delta);
      if (!next) continue;
      const stillTight = tightSeats(next, floorIndex).filter(seat => group.some(item => item.id === seat.item.id));
      if (stillTight.length === 0) { fixed = next; break; }
    }
    if (!fixed) {
      skipped.push(...group.map(item => ({ name: displayName(item), reason: 'no-spot' as const })));
      continue;
    }
    working = fixed;
    moved += group.length;
  }
  if (moved > 0 && !canApplyLayoutGeometry(layout, working)) return null;
  return { layout: working, moved, skipped: dedupeSkips(skipped), remaining: reviewLayout(working, floorIndex).issues };
}

function tableWithNearestSeats(layout: RoomLayout, floorIndex: number, table: FurnitureItem): FurnitureItem[] {
  const items = (floorOf(layout, floorIndex)?.items ?? []).filter(isReviewable);
  const tables = items.filter(isTable);
  return [table, ...items.filter(item => isSeat(item) && nearestTable(item, tables)?.id === table.id)];
}

function fixTableGap(layout: RoomLayout, floorIndex: number, issue: ReviewIssue): ReviewFixResult | null {
  const pairs = tightTablePairs(layout, floorIndex);
  const wanted = new Set(issue.itemIds);
  const pair = pairs.filter(candidate => wanted.has(candidate.a.id) && wanted.has(candidate.b.id)).sort((a, b) => a.gap - b.gap)[0];
  if (!pair) return null;
  const skipped: ReviewSkip[] = [];
  const clusters = tableClusters(layout, floorIndex);
  const clusterOf = (id: string) => clusters.find(cluster => cluster.items.some(item => item.id === id));
  const clusterA = clusterOf(pair.a.id), clusterB = clusterOf(pair.b.id);
  const groups: FurnitureItem[][] = [];
  if (clusterB && clusterB !== clusterA) groups.push(clusterB.items);
  else groups.push(tableWithNearestSeats(layout, floorIndex, pair.b));
  if (clusterA && clusterA !== clusterB) groups.push(clusterA.items);
  else groups.push(tableWithNearestSeats(layout, floorIndex, pair.a));
  const alongX = Math.abs(pair.b.position!.x - pair.a.position!.x) >= Math.abs(pair.b.position!.z - pair.a.position!.z);
  const sign = alongX
    ? Math.sign((pair.b.position!.x - pair.a.position!.x) || 1)
    : Math.sign((pair.b.position!.z - pair.a.position!.z) || 1);
  const distance = TABLE_PASSAGE_METERS - pair.gap + 0.1;
  const moves: Vec2[] = alongX
    ? [{ x: sign * distance, z: 0 }, { x: -sign * distance, z: 0 }]
    : [{ x: 0, z: sign * distance }, { x: 0, z: -sign * distance }];
  for (const group of groups) {
    const blocked = group.filter(item => !isMovable(item));
    if (blocked.length) {
      skipped.push(...blocked.map(item => ({ name: displayName(item), reason: 'locked' as const })));
      continue;
    }
    let fixed: RoomLayout | null = null;
    for (const delta of moves) {
      const next = moveCluster(layout, floorIndex, group, delta);
      if (!next) continue;
      const nextItems = floorOf(next, floorIndex)?.items ?? [];
      const a = nextItems.find(item => item.id === pair.a.id), b = nextItems.find(item => item.id === pair.b.id);
      if (!a || !b) continue;
      // 以实际的 OBB 净距验收，不以坐标位移想当然。
      if (boxGap(a, b) < TABLE_PASSAGE_METERS - 0.01) continue;
      fixed = next;
      break;
    }
    if (fixed) return { layout: fixed, moved: group.length, skipped: dedupeSkips(skipped), remaining: reviewLayout(fixed, floorIndex).issues };
    skipped.push(...group.map(item => ({ name: displayName(item), reason: 'no-spot' as const })));
  }
  return { layout, moved: 0, skipped: dedupeSkips(skipped), remaining: reviewLayout(layout, floorIndex).issues };
}

/** 按一条问题算候选布局；返回 null 表示「没有稳妥改法」，调用方必须如实说，不能硬挪。 */
export function proposeReviewFix(layout: RoomLayout, floorIndex: number, issue: ReviewIssue): ReviewFixResult | null {
  if (issue.kind === 'seat-clearance') return fixSeatClearance(layout, floorIndex, issue);
  if (issue.kind === 'table-gap') return fixTableGap(layout, floorIndex, issue);
  // 孤椅/空桌只报证据：把椅子拖去凑桌、或者替人补椅子，都是在改人的摆法意图，
  // 这里不算候选，也不假装有改法。
  if (issue.kind === 'orphan-seat' || issue.kind === 'unpaired-table') return null;
  return fixConflicts(layout, floorIndex, issue);
}
