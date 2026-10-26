import type { SceneV2 } from '../../../../supabase/functions/_shared/domain';
import { EVENT_CATALOG, FURNITURE_CATALOG } from './constants';
import { backendSceneToLayout } from './backend-adapter';
import { FURNITURE_SETS, buildFurnitureSet, setPlacementSlots } from './furniture-sets';
import { hasCollisions, itemsOverlap } from './geometry';
import { randomSuffix } from './ids';
import { floorKeepOut } from './floor-keep-out';
import { canApplyLayoutGeometry, isStructuralMarker, structuralItemCollides } from './structural-layout';
import { surpriseLayout } from './surprise';
import type { FurnitureItem, RoomLayout, Vec2 } from './types';
import { buildVenueShell, type ScaleOrigin } from './venue-shell';

/**
 * 晴光出布置方案用的两块纯函数：先立场地（T-01 的真相），再在立好的壳体上算一份**没写进画布**的候选。
 *
 * 对话四步 ② 的硬钉是「建议 → 预览 → 确认」，所以布置这一层只算不写：每一步给一份快照，
 * 画布按快照画绿框（新摆）/ 红框（将被撤掉）预览，用户点「确认布置」才由调用方一次性 applyLayout。
 * 生成器本身不碰 reducer，也就碰不到自动存档与撤销栈。
 *
 * 场地壳子中排在预览之前，是因为它要改的是 `structure`（墙体、门洞、尺寸）而不是 `objects`：
 * 候选里的物料坐标全部按新场地算，如果壳体还悬在半空，预览就会把绿框画在看不见的墙上。
 * 旧物料能塞进新壳体的就留着（撤不撤由预览里的红框说话），塞不下的才随壳体一起清掉，并且要报数。
 */

export interface VenueInput {
  /** 画布当前场景。 */
  base: RoomLayout;
  floorIndex: number;
  /** 人已确认（或沿用画布）的场地尺度，米。 */
  widthM: number;
  depthM: number;
  indoorOutdoor: 'indoor' | 'outdoor';
  scaleOrigin: ScaleOrigin;
}

export interface VenuePlan {
  /** 要落场的场地真相（结构 + 门洞标记 + 锁定件）。 */
  layout: RoomLayout;
  /** 立起来的壳体，播报尺寸/墙/层高要用。 */
  scene: SceneV2;
  /** 因为塞不进新壳体而随清场撤掉的旧物料件数。 */
  cleared: number;
}

export interface PlanInput {
  /** 已确认的场地：候选在它之上摆物件，确认前不改它一根线。 */
  base: RoomLayout;
  floorIndex: number;
  widthM: number;
  depthM: number;
  /** 换一版：只换桌椅槽位顺序，不改可行域。 */
  variant: number;
  /** 人说过的人数：只影响桌椅组数，不影响壳体真相。 */
  guests?: number | null;
  /** 座位优先：人还站着就继续往桌边、空位补座；仍然只出候选，不写画布。 */
  seatPriority?: boolean;
}

export interface PlanProposal {
  /** 每完成一步的候选快照，长度就是步数；预览按它逐帧长出来。 */
  layouts: RoomLayout[];
  /** 本次新增的物料件数（不含墙门柱这些场地真相）。 */
  added: number;
  /** 预览里会被撤掉的旧物料（锁定件与门洞标记不在内）。 */
  removing: number;
  /** 锁定件：Agent 一律不动，提案里要报出来。 */
  keptLocked: number;
  /** 因为越界/撞墙被丢掉、没有采纳的件数。 */
  dropped: number;
  /** 候选场景里重叠或超出场地的件数与名字。 */
  overlapCount: number;
  overlapNames: string[];
  /** 候选整体过不了几何闸（例如锁定件和新墙冲突）：确认会被拒，得先说。 */
  blocked: string | null;
  /** 这一版按多少人摆的；没说过人数就是 null。 */
  guests?: number | null;
  /** 实际摆出了多少个座位（餐桌一组 4 座 + 散椅），只对完整方案有意义。 */
  seats?: number;
  /** 这版已经按「加座」重排过：仍不够时直接报场地最多能坐多少，不再暗示再点一次就行。 */
  seatPriority?: boolean;
  /** 体检改法真正挪了多少件（只挪位置，不新增不删除）。 */
  moved?: number;
  /** 这版来自「看看哪里有问题」的体检，不是重新生成。 */
  kind?: 'review';
  /** 体检改法里锁着或找不到落点、没动的物料名；不能装作全挪了。 */
  skipped?: string[];
}

const uid = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${randomSuffix()}`);
const withId = (item: FurnitureItem): FurnitureItem => ({ ...item, id: uid() });

/** 只换一层里的物料，其余字段原样带着（引用不变，预览差分才认得出「只多了这几件」）。 */
function withItems(layout: RoomLayout, floorIndex: number, items: FurnitureItem[]): RoomLayout {
  return { ...layout, floors: layout.floors.map((floor, index) => (index === floorIndex ? { ...floor, items } : floor)) };
}

const structuralOnly = (items: FurnitureItem[]): FurnitureItem[] => items.filter(item => isStructuralMarker(item));

const isSeat = (item: FurnitureItem): boolean => item.type === 'chair' || item.type === 'dining-chair';
/** 座位按物料件数如实数：桌边椅和散椅都算，锁定件也算，但不把站立人数凑进来。 */
const seatCountIn = (items: readonly FurnitureItem[]): number => items.filter(item => !isStructuralMarker(item) && isSeat(item)).length;

/**
 * 第 1 步的场地：把确认过的尺度立成可布置壳体。已有结构（云端场景、重建场景、预设建筑）
 * 返回 null——本卡不动场地真相。
 */
export function raiseVenue(input: VenueInput): VenuePlan | null {
  const { base, floorIndex, widthM, depthM, indoorOutdoor, scaleOrigin } = input;
  if (base.scenePreset || base.backendSceneV2) return null;
  const scene = buildVenueShell({ widthM, depthM, indoorOutdoor, scaleOrigin });
  const shellLayout = backendSceneToLayout(scene, { name: base.name, ...(base.id ? { projectId: base.id } : {}) });
  // 壳体只换结构这几栏：底图、层高、屋顶这些跟布置无关的现场信息得跟着人原来填的走。
  const shell: RoomLayout = { ...base, ...shellLayout, ...(base.roof ? { roof: base.roof } : {}) };
  const index = Math.min(floorIndex, shell.floors.length - 1);
  const markers = structuralOnly(shell.floors[index]?.items ?? []);
  const current = base.floors[floorIndex]?.items ?? [];
  const keep = current.filter(item => item.locked && !isStructuralMarker(item));
  const withOld = withItems(shell, index, [...markers, ...current]);
  // 旧物料在新壳体里还放得下就留着：撤不撤是布置这一步的决定，不该由场地偷偷代劳。
  if (canApplyLayoutGeometry(base, withOld)) return { layout: withOld, scene, cleared: 0 };
  const clearedLayout = withItems(shell, index, [...markers, ...keep]);
  if (!canApplyLayoutGeometry(base, clearedLayout)) {
    const stuck = keep.filter(item => structuralItemCollides(item, clearedLayout, index)).map(item => item.name);
    throw new Error(stuck.length
      ? `这个尺度立不起来：锁着的 ${stuck.slice(0, 3).join('、')}${stuck.length > 3 ? ' 等' : ''} 压在新墙体或边界上，先解锁挪开它们。`
      : '这个尺度立不起来，先改一下长宽。');
  }
  return { layout: clearedLayout, scene, cleared: current.filter(item => !item.locked && !isStructuralMarker(item)).length };
}

/**
 * 一批一批试：`addItems` 在 reducer 里是**整批**几何否决，一批中有一件穿墙就整批消失
 * （换一版曾经清空桌子）。这里先整批试，被拒再逐件试，越界的只丢它自己。
 */
function tryAdd(base: RoomLayout, current: RoomLayout, floorIndex: number, items: FurnitureItem[]): { layout: RoomLayout; accepted: number; dropped: number } {
  const existing = current.floors[floorIndex]?.items ?? [];
  const batch = withItems(current, floorIndex, [...existing, ...items]);
  if (canApplyLayoutGeometry(base, batch)) return { layout: batch, accepted: items.length, dropped: 0 };
  let layout = current;
  let accepted = 0;
  for (const item of items) {
    const next = withItems(layout, floorIndex, [...(layout.floors[floorIndex]?.items ?? []), item]);
    if (canApplyLayoutGeometry(base, next)) { layout = next; accepted++; }
  }
  return { layout, accepted, dropped: items.length - accepted };
}

/** 候选场景里的重叠：跟编辑器同一套算法，只是跑在没落盘的候选上。 */
function countOverlaps(layout: RoomLayout, floorIndex: number): { count: number; names: string[] } {
  const floor = layout.floors[floorIndex];
  if (!floor) return { count: 0, names: [] };
  const keepOut = floorKeepOut(layout, floorIndex);
  const interiorWalls = layout.backendSceneV2 ? [] : floor.interiorWalls;
  const names: string[] = [];
  for (const item of floor.items) {
    if (isStructuralMarker(item)) continue;
    const hit = structuralItemCollides(item, layout, floorIndex)
      || hasCollisions(item, floor.items, layout.width, layout.height, { keepOut, structureValidated: !!layout.backendSceneV2, interiorWalls });
    if (hit) names.push(item.name);
  }
  return { count: names.length, names };
}

/**
 * 座位优先的补座：先贴着桌子的四角加座（一组餐桌从 4 座加到 8 座），
 * 再退到空位里放散椅。每一件都过同一套墙/边界/重叠校验，放不下就停，不硬塞。
 */
function addExtraSeats(input: {
  base: RoomLayout;
  floorIndex: number;
  layout: RoomLayout;
  tables: readonly FurnitureItem[];
  target: number;
}): { layout: RoomLayout; added: number } {
  const { base, floorIndex, target } = input;
  let current = input.layout;
  let added = 0;
  const chairBase = FURNITURE_CATALOG.find(entry => entry.type === 'dining-chair');
  if (!chairBase) return { layout: current, added };
  const keepOut = floorKeepOut(base, floorIndex);
  const interiorWalls = base.backendSceneV2 ? [] : (base.floors[floorIndex]?.interiorWalls ?? []);
  const options = { keepOut, structureValidated: !!base.backendSceneV2, interiorWalls };
  const currentItems = (): FurnitureItem[] => current.floors[floorIndex]?.items ?? [];
  const enough = (): boolean => seatCountIn(currentItems()) >= target;
  const tryPlace = (position: Vec2, rotation: number): boolean => {
    const chair = { ...chairBase, id: uid(), position, rotation } as FurnitureItem;
    const items = currentItems();
    // 碰撞层把「椅子放在桌面上」当有意的叠放，补座时不能借这条规则把椅子塞到桌面上。
    if (items.some(item => item.type === 'dining-table' && itemsOverlap(chair, item))) return false;
    if (hasCollisions(chair, items, base.width, base.height, options)) return false;
    const next = withItems(current, floorIndex, [...items, chair]);
    if (!canApplyLayoutGeometry(base, next)) return false;
    current = next;
    added += 1;
    return true;
  };

  const corners = [
    { x: -1.2, z: -0.85 }, { x: 1.2, z: -0.85 },
    { x: -1.2, z: 0.85 }, { x: 1.2, z: 0.85 },
  ];
  for (const table of input.tables) {
    const center = table.position ?? { x: 0, z: 0 };
    for (const corner of corners) {
      if (enough()) return { layout: current, added };
      tryPlace({ x: center.x + corner.x, z: center.z + corner.z }, Math.atan2(-corner.x, -corner.z));
    }
  }
  while (!enough()) {
    const spot = findAdditionSpot(base, floorIndex, { ...chairBase, id: uid(), rotation: 0 } as FurnitureItem, currentItems());
    if (!spot || !tryPlace(spot, 0)) break;
  }
  return { layout: current, added };
}

/** 布置提案：读场地（撤掉旧物料）→ 定舞台 → 摆桌椅 → 放绿植 → 检查重叠，全程只算不写。 */
export function proposePlan(input: PlanInput): PlanProposal {
  const { widthM, depthM, variant } = input;
  const base = input.base;
  const floorIndex = Math.min(input.floorIndex, base.floors.length - 1);
  const layouts: RoomLayout[] = [];
  const seatPriority = !!input.seatPriority;
  let added = 0;
  let dropped = 0;

  const current0 = base.floors[floorIndex]?.items ?? [];
  const markers = structuralOnly(current0);
  const locked = current0.filter(item => item.locked && !isStructuralMarker(item));
  let current = withItems(base, floorIndex, [...markers, ...locked]);
  const removing = current0.length - markers.length - locked.length;
  layouts.push(current);

  // 1 定舞台位置：背景板贴后墙居中（现有物料库条目）
  const backdrop = EVENT_CATALOG.find(entry => entry.materialId === 'backdrop');
  if (backdrop) {
    const item = { ...backdrop, id: uid(), position: { x: 0, z: -depthM / 2 + backdrop.depth / 2 + 0.4 }, rotation: 0 } as FurnitureItem;
    const result = tryAdd(base, current, floorIndex, [item]);
    current = result.layout; added += result.accepted; dropped += result.dropped;
  }
  layouts.push(current);

  // 2 摆桌椅：现有 dining 物料组，按面积放 1–4 组，槽位收在墙内也收在舞台前面
  const dining = FURNITURE_SETS.find(set => set.key === 'dining');
  if (dining) {
    const stageSouth = backdrop ? -depthM / 2 + backdrop.depth + 0.4 : -depthM / 2;
    const slots = setPlacementSlots(dining, widthM, depthM, variant, { clearNorthOfZ: stageSouth });
    // 一组餐椅坐 4 人：说了人数就按人数定组数，但别把场地塞爆（面积给的是上限）。
    const areaSets = Math.max(1, Math.floor((widthM * depthM) / 30));
    const wantedSets = input.guests && input.guests > 0 ? Math.ceil(input.guests / 4) : areaSets;
    const count = Math.max(1, Math.min(slots.length, wantedSets, areaSets * 2));
    const tableIdsBefore = new Set((current.floors[floorIndex]?.items ?? []).filter(item => item.type === 'dining-table').map(item => item.id));
    for (const center of slots.slice(0, count)) {
      const items = buildFurnitureSet(dining, { center, roomWidth: widthM, roomDepth: depthM }).map(withId);
      const result = tryAdd(base, current, floorIndex, items);
      current = result.layout; added += result.accepted; dropped += result.dropped;
    }
    // 座位优先：只给这一版新摆的桌子补座，锁着的老桌子不碰。
    if (seatPriority && (input.guests ?? 0) > 0) {
      const tables = (current.floors[floorIndex]?.items ?? []).filter(item => item.type === 'dining-table' && !tableIdsBefore.has(item.id));
      const extra = addExtraSeats({ base, floorIndex, layout: current, tables, target: input.guests! });
      if (extra.added) { current = extra.layout; added += extra.added; layouts.push(current); }
    }
  }
  layouts.push(current);

  // 3 放绿植：现有 surprise 生成器里的装饰，只取植物
  const plants = surpriseLayout({ roomWidth: widthM, roomDepth: depthM, seed: 1000 + variant })
    .filter(item => item.id.includes('decor') && (item.type === 'plant' || item.type === 'flowerpot'))
    .map(withId);
  if (plants.length) {
    const result = tryAdd(base, current, floorIndex, plants);
    current = result.layout; added += result.accepted; dropped += result.dropped;
  }
  layouts.push(current);

  // 4 检查重叠：算在候选上，不是算在还没改过的画布上
  const overlaps = countOverlaps(current, floorIndex);
  layouts.push(current);

  const blocked = canApplyLayoutGeometry(base, current)
    ? null
    : '这版提案里有跟墙体或边界冲突的物料，先挪开或解锁再重新出一版。';
  const seats = seatCountIn(current.floors[floorIndex]?.items ?? []);

  return {
    layouts, added, removing, keptLocked: locked.length, dropped,
    overlapCount: overlaps.count, overlapNames: overlaps.names, blocked,
    guests: input.guests ?? null, seats, seatPriority,
  };
}

/* ───────── 对话加物料：只加指定的几件，仍然只出候选、不写画布 ───────── */

export interface AdditionRequest {
  materialId: string;
  count: number;
}

export interface AdditionProposal extends PlanProposal {
  /** 每个请求实际放下的件数，用来如实播报「要 2 件、只放得下 1 件」。 */
  accepted: Array<{ materialId: string; name: string; requested: number; placed: number }>;
}

/** 往哪边找空位：背景/展架靠北墙，签到台靠近南边入口，其余从中间往外找。 */
function placementBias(item: FurnitureItem): 'north' | 'south' | 'center' {
  if (item.type === 'backdrop' || item.type === 'bookshelf' || item.type === 'partition') return 'north';
  if (item.type === 'counter') return 'south';
  return 'center';
}

/** 1 米网格扫一遍，挑第一个既不撞墙也不压物件的落点；找不到就报没位置，不硬塞。 */
function findAdditionSpot(layout: RoomLayout, floorIndex: number, item: FurnitureItem, items: FurnitureItem[]): Vec2 | null {
  const floor = layout.floors[floorIndex];
  if (!floor) return null;
  const keepOut = floorKeepOut(layout, floorIndex);
  const interiorWalls = layout.backendSceneV2 ? [] : floor.interiorWalls;
  const inset = 0.25;
  const step = Math.max(1, Math.ceil(Math.max(item.width, item.depth)));
  const xs: number[] = [];
  const zs: number[] = [];
  for (let x = -layout.width / 2 + inset + item.width / 2; x <= layout.width / 2 - inset - item.width / 2 + 1e-9; x += step) xs.push(Math.round(x * 100) / 100);
  for (let z = -layout.height / 2 + inset + item.depth / 2; z <= layout.height / 2 - inset - item.depth / 2 + 1e-9; z += step) zs.push(Math.round(z * 100) / 100);
  if (xs.length === 0 || zs.length === 0) return null;
  const bias = placementBias(item);
  const slots = xs.flatMap(x => zs.map(z => ({
    x, z,
    score: bias === 'north' ? z + layout.height / 2 + Math.abs(x) * 0.15
      : bias === 'south' ? layout.height / 2 - z + Math.abs(x) * 0.15
      : Math.abs(x) + Math.abs(z),
  }))).sort((a, b) => a.score - b.score);
  for (const slot of slots) {
    const placed = { ...item, position: { x: slot.x, z: slot.z } };
    if (hasCollisions(placed, items, layout.width, layout.height, { keepOut, structureValidated: !!layout.backendSceneV2, interiorWalls })) continue;
    if (!canApplyLayoutGeometry(layout, withItems(layout, floorIndex, [...items, placed]))) continue;
    return placed.position;
  }
  return null;
}

/** 加物料提案：以当前画布为基线，只往空位里放人点名的那几件；锁定件原样不动。 */
export function proposeAddition(input: { base: RoomLayout; floorIndex: number; requests: readonly AdditionRequest[] }): AdditionProposal {
  const base = input.base;
  const floorIndex = Math.min(input.floorIndex, base.floors.length - 1);
  const floor = base.floors[floorIndex];
  if (!floor) throw new Error('场地还没立起来，先说出长宽，我再往里加。');
  let items = floor.items.slice();
  const layouts: RoomLayout[] = [base];
  const accepted: AdditionProposal['accepted'] = [];
  let added = 0;
  let dropped = 0;
  for (const request of input.requests) {
    const entry = EVENT_CATALOG.find(catalogItem => catalogItem.materialId === request.materialId);
    if (!entry) { dropped += request.count; accepted.push({ materialId: request.materialId, name: request.materialId, requested: request.count, placed: 0 }); continue; }
    let placed = 0;
    for (let index = 0; index < request.count; index++) {
      const item = { ...entry, id: uid(), rotation: 0 } as FurnitureItem;
      const spot = findAdditionSpot(base, floorIndex, item, items);
      if (!spot) break;
      items = [...items, { ...item, position: spot }];
      placed += 1; added += 1;
    }
    // 一次请求只长一帧：加 10 把椅子不该播 10 帧、把预览拖成十几秒。
    if (placed) layouts.push(withItems(base, floorIndex, items));
    dropped += request.count - placed;
    accepted.push({ materialId: request.materialId, name: entry.name, requested: request.count, placed });
  }
  const final = withItems(base, floorIndex, items);
  const overlaps = countOverlaps(final, floorIndex);
  const blocked = canApplyLayoutGeometry(base, final) ? null : '这版加完有物料过不了几何闸，先挪开再加。';
  return {
    layouts, added, removing: 0, keptLocked: floor.items.filter(item => item.locked && !isStructuralMarker(item)).length,
    dropped, overlapCount: overlaps.count, overlapNames: overlaps.names, blocked, accepted, guests: null, seats: 0,
  };
}
