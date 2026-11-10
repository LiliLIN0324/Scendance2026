import { HEADCOUNT_MAX } from './workbench-agent';
import type { SceneV2 } from '../../../../supabase/functions/_shared/domain';
import { EVENT_CATALOG, FURNITURE_CATALOG } from './constants';
import { backendSceneToLayout } from './backend-adapter';
import { mergeDiagnostics, rejectedDiagnostics, type PlanDiagnostic } from './diagnostics';
import { FURNITURE_SETS, buildFurnitureSet, setPlacementSlots } from './furniture-sets';
import { layoutRoleFromAssetName, layoutRoleFromNote, layoutRoleNote } from './layout-role';
import { rectDiningSet, ringCenters, ringDiningSet, setFootprint } from './ring-seating';
import type { TableArrangement } from './table-seat-plan';
import { hasCollisions, itemsOverlap, rotatedHalfExtents } from './geometry';
import { randomSuffix } from './ids';
import { floorKeepOut } from './floor-keep-out';
import { presetModelUrl } from './scene-presets';
import { canApplyLayoutGeometry, isStructuralMarker, structuralItemCollides } from './structural-layout';
import type { FurnitureItem, RoomLayout, Vec2 } from './types';
import { buildVenueShell, type ScaleOrigin } from './venue-shell';
import type { PlanArtifact } from './plan-artifact';
import {reviewLocalSeatingWitness,type LocalSeatingReview,type LocalSeatingWitness} from './local-seating-witness';

/**
 * Bingo出布置方案用的两块纯函数：先立场地（T-01 的真相），再在立好的壳体上算一份**没写进画布**的候选。
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
  /** 地图圈画真轮廓（本地米）；有则立多边形壳。 */
  polygonMeters?: ReadonlyArray<{ x: number; z: number }>;
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
  /** desk-chair = 一人一套课桌椅（「课桌配椅子」「80 套」）；缺省按餐桌组摆。 */
  layoutMode?: 'dining' | 'desk-chair';
  /** ring = 圆桌沿环/扇形摆。缺省仍用原来的方格槽位。 */
  seatingShape?: 'ring' | 'grid';
  /** Already resolved size and seat count. Placement uses it and does not assume 4 or 8. */
  tablePlan?: TableArrangement;
  /** 缺省仍放舞台背景板。显式 false 才跳过（课室、或人说不要舞台）。 */
  stage?: boolean;
  /** 缺省不放签到台。发布会等活动或人点了签到才放，放不下就丢这一件。 */
  checkin?: boolean;
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
  /** 座位区逐格空跑探到的顶：这一版按这套整排桌椅排到几座就是头，不是这块地最多几座，也不是要价。 */
  capacity?: number;
  /** 这版已经按「加座」重排过：仍不够就直接说这一版排到几座，不再暗示再点一次就行。 */
  seatPriority?: boolean;
  /** 体检改法真正挪了多少件（只挪位置，不新增不删除）。 */
  moved?: number;
  /** 这版来自「看看哪里有问题」的体检，不是重新生成。 */
  kind?: 'review';
  /** 体检改法里锁着或找不到落点、没动的物料名；不能装作全挪了。 */
  skipped?: string[];
  /** 没放进去的件数与原因；dropped 是它的件数合计。 */
  diagnostics?: PlanDiagnostic[];
  /** 这一版的内容身份：确认前比对场地与候选，不看对象引用。 */
  artifact?: PlanArtifact;
  /** Local-only generated associations; never inferred from nearby furniture or cloud data. */
  seatingWitness?: LocalSeatingWitness|null;
  /** Recomputed against the current candidate, not a safety or inventory verdict. */
  seatingReview?: LocalSeatingReview;
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
  const { base, floorIndex, widthM, depthM, indoorOutdoor, scaleOrigin, polygonMeters } = input;
  if (base.scenePreset || base.backendSceneV2 || base.floors.length !== 1) return null;
  const scene = buildVenueShell({ widthM, depthM, indoorOutdoor, scaleOrigin, ...(polygonMeters?.length ? { polygonMeters } : {}) });
  const shellLayout = backendSceneToLayout(scene, { name: base.name, ...(base.id ? { projectId: base.id } : {}) });
  // 壳体只换结构这几栏：底图、层高、屋顶这些跟布置无关的现场信息得跟着人原来填的走。
  const originalFloor=base.floors[0];
  const shell: RoomLayout = { ...base, ...shellLayout, ...(base.roof ? { roof: base.roof } : {}),
    floors:shellLayout.floors.map(floor=>({...floor,...(originalFloor?{id:originalFloor.id,name:originalFloor.name}:{}),
      ...(originalFloor?.zones ? {zones:originalFloor.zones} : {})})) };
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

/** 编辑器自己立起来的壳（矩形或地图多边形）：没有内墙、柱子、多门窗或图纸证据，整壳可按新圈画重立。 */
function rebuildableShell(layout: RoomLayout): boolean {
  const scene = layout.backendSceneV2;
  if (!scene || layout.floors.length !== 1 || (layout.roof?.style && layout.roof.style !== 'none')) return false;
  if ((scene.venue.shape !== 'rectangle' && scene.venue.shape !== 'polygon') || scene.sources.length > 0 || scene.design) return false;
  const { walls, openings, columns } = scene.structure;
  const wallOk = scene.venue.shape === 'polygon'
    ? walls.every(wall => wall.kind === 'exterior')
    : walls.length <= 4 && walls.every(wall => wall.kind === 'exterior');
  return columns.length === 0 && openings.length <= 1 && wallOk
    && !layout.floors.some(floor => (floor.interiorWalls ?? []).some(wall => wall.kind === 'interior'));
}

/**
 * 尺寸不跟改的正解：GLB 模板是固定概念外壳，改边界米数就卸模板、按新尺寸重立矩形壳。
 * 模板自带的夹具跟着模板一起卸（留着会浮在空壳上，也会挡住云端保存）；人自己加的物料
 * 放得下就留下，放不下才撤，报数规则和 raiseVenue 同一条。
 */
export function replaceVenueWithShell(input: VenueInput): VenuePlan | null {
  const { base, floorIndex, widthM, depthM, indoorOutdoor, scaleOrigin, polygonMeters } = input;
  if (base.floors.length !== 1) return null;
  if (!base.scenePreset && !rebuildableShell(base)) return null;
  const scene = buildVenueShell({ widthM, depthM, indoorOutdoor, scaleOrigin, ...(polygonMeters?.length ? { polygonMeters } : {}) });
  const shellLayout = backendSceneToLayout(scene, { name: base.name, ...(base.id ? { projectId: base.id } : {}) });
  const {
    scenePreset: _preset, backendSceneV2: _structure, backendVenue: _venue,
    backendCamera: _camera, backendLighting: _lighting, floors: _floors, roof: _roof, ...rest
  } = base;
  const oldFloor = base.floors[floorIndex];
  const shell: RoomLayout = {
    ...rest, ...shellLayout,
    floors: shellLayout.floors.map(floor => ({
      ...floor,
      ...(oldFloor ? {id:oldFloor.id,name:oldFloor.name} : {}),
      ...(oldFloor?.zones ? {zones:oldFloor.zones} : {}),
      ...(oldFloor?.floorColor ? { floorColor: oldFloor.floorColor } : {}),
      ...(oldFloor?.floorPattern ? { floorPattern: oldFloor.floorPattern } : {}),
    })),
  };
  const index = Math.min(floorIndex, shell.floors.length - 1);
  const markers = structuralOnly(shell.floors[index]?.items ?? []);
  const presetUrl = base.scenePreset ? presetModelUrl(base.scenePreset) : null;
  const current = oldFloor?.items ?? [];
  const kept = current.filter(item => !isStructuralMarker(item) && !(presetUrl && item.glbUrl === presetUrl));
  const withOld = withItems(shell, index, [...markers, ...kept]);
  if (canApplyLayoutGeometry(base, withOld)) return { layout: withOld, scene, cleared: 0 };
  const locked = kept.filter(item => item.locked);
  const clearedLayout = withItems(shell, index, [...markers, ...locked]);
  if (!canApplyLayoutGeometry(base, clearedLayout)) {
    const stuck = locked.filter(item => structuralItemCollides(item, clearedLayout, index)).map(item => item.name);
    throw new Error(stuck.length
      ? `这个尺度立不起来：锁着的 ${stuck.slice(0, 3).join('、')}${stuck.length > 3 ? ' 等' : ''} 压在新墙体或边界上，先解锁挪开它们。`
      : '这个尺度立不起来，先改一下长宽。');
  }
  return { layout: clearedLayout, scene, cleared: kept.filter(item => !item.locked).length };
}

/**
 * 一批一批试：`addItems` 在 reducer 里是**整批**几何否决，一批中有一件穿墙就整批消失
 * （换一版曾经清空桌子）。这里先整批试，被拒再逐件试，越界的只丢它自己。
 */
function tryAdd(base: RoomLayout, current: RoomLayout, floorIndex: number, items: FurnitureItem[]): {
  layout: RoomLayout;
  accepted: number;
  dropped: number;
  rejected: Array<{ name: string; code: 'STRUCTURAL_COLLISION' | 'OUT_OF_BOUNDS' }>;
} {
  const existing = current.floors[floorIndex]?.items ?? [];
  const batch = withItems(current, floorIndex, [...existing, ...items]);
  if (canApplyLayoutGeometry(base, batch)) return { layout: batch, accepted: items.length, dropped: 0, rejected: [] };
  let layout = current;
  let accepted = 0;
  const rejected: Array<{ name: string; code: 'STRUCTURAL_COLLISION' | 'OUT_OF_BOUNDS' }> = [];
  for (const item of items) {
    const next = withItems(layout, floorIndex, [...(layout.floors[floorIndex]?.items ?? []), item]);
    if (canApplyLayoutGeometry(base, next)) { layout = next; accepted++; continue; }
    // 逐件试还过不了：是压到墙/柱，还是整件出了场地边界——先分清楚，别混成一句「放不下」。
    rejected.push({
      name: item.name,
      code: structuralItemCollides(item, next, floorIndex) ? 'STRUCTURAL_COLLISION' : 'OUT_OF_BOUNDS',
    });
  }
  return { layout, accepted, dropped: items.length - accepted, rejected };
}

/** 候选场景里的重叠：跟编辑器同一套算法，只是跑在没落盘的候选上。 */
export function countOverlaps(layout: RoomLayout, floorIndex: number): { count: number; names: string[] } {
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

/**
 * 一人一套课桌椅的课室行列：按场地铺「desk + 桌后一把 chair」的格子，
 * 前排贴北（讲台位），放多少套由人数定、场地容量封顶。墙内缩与壳体同款 0.35 m。
 */
function classroomPairSlots(widthM: number, depthM: number, wanted: number): { slots: Vec2[]; cols: number } {
  const wall = 0.35;
  const chairGap = 0.7;
  const colGap = 1.7;
  const rowGap = 2.1;
  const cols = Math.max(1, Math.floor((widthM - 2 * wall - 1.2) / colGap) + 1);
  const rows = Math.max(1, Math.floor((depthM - 2 * wall - 0.6 - chairGap) / rowGap) + 1);
  const total = Math.max(0, Math.min(wanted, cols * rows));
  const gridW = (cols - 1) * colGap;
  const gridD = (rows - 1) * rowGap;
  const startX = -gridW / 2;
  const startZ = -gridD / 2 - 0.3;
  const slots: Vec2[] = [];
  for (let index = 0; index < total; index++) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    slots.push({ x: Math.round((startX + col * colGap) * 100) / 100, z: Math.round((startZ + row * rowGap) * 100) / 100 });
  }
  return { slots, cols };
}

/** 布置提案：读场地（撤掉旧物料）→ 定舞台 → 摆桌椅 → 放绿植 → 检查重叠，全程只算不写。 */
export function proposePlan(input: PlanInput): PlanProposal {
  if (!Number.isSafeInteger(input.guests) || !input.guests || input.guests < 1 || input.guests > HEADCOUNT_MAX) return {layouts:[input.base],added:0,removing:0,keptLocked:0,dropped:0,overlapCount:0,overlapNames:[],blocked:'请先说明本场预计人数，再生成布置方案。',guests:null};
  const { widthM, depthM, variant } = input;
  const base = input.base;
  const floorIndex = Math.min(input.floorIndex, base.floors.length - 1);
  const layouts: RoomLayout[] = [];
  const seatPriority = !!input.seatPriority;
  const deskChair = input.layoutMode === 'desk-chair';
  let added = 0;
  let dropped = 0;
  let diagnostics: PlanDiagnostic[] = [];

  const current0 = base.floors[floorIndex]?.items ?? [];
  const markers = structuralOnly(current0);
  const locked = current0.filter(item => item.locked && !isStructuralMarker(item));
  let current = withItems(base, floorIndex, [...markers, ...locked]);
  const removing = current0.length - markers.length - locked.length;
  const accept = (result: ReturnType<typeof tryAdd>): void => {
    current = result.layout;
    added += result.accepted;
    dropped += result.dropped;
    diagnostics = mergeDiagnostics(diagnostics, rejectedDiagnostics(result.rejected));
  };
  layouts.push(current);

  // 1 定舞台位置：背景板贴后墙居中（现有物料条目）。课室、或人说不要舞台，跳过。
  const backdrop = EVENT_CATALOG.find(entry => entry.materialId === 'backdrop');
  if (backdrop && !deskChair && input.stage !== false) {
    const item = { ...backdrop, id: uid(), position: { x: 0, z: -depthM / 2 + backdrop.depth / 2 + 0.4 }, rotation: 0 } as FurnitureItem;
    accept(tryAdd(base, current, floorIndex, [item]));
  }
  // 签到台靠近南边入口、偏一侧，别堵在门洞正中。放不下只丢这一件。
  const reception = EVENT_CATALOG.find(entry => entry.materialId === 'reception');
  if (reception && !deskChair && input.checkin) {
    const item = {
      ...reception, id: uid(), rotation: Math.PI,
      position: { x: -widthM / 2 + reception.width / 2 + 0.9, z: depthM / 2 - reception.depth / 2 - 0.9 },
    } as FurnitureItem;
    accept(tryAdd(base, current, floorIndex, [item]));
  }
  layouts.push(current);

  // 2 摆桌椅：课室按一人一套铺行列，其余按 dining 物料组放 1–4 组（槽位收在墙内也收在舞台前面）
  if (deskChair) {
    const deskEntry = FURNITURE_CATALOG.find(entry => entry.type === 'desk');
    const chairEntry = FURNITURE_CATALOG.find(entry => entry.type === 'chair');
    if (deskEntry && chairEntry) {
      // 一套 = 一个座位：说了人数就按套数摆，没说就按 1.8 ㎡/人 估。
      const wanted = input.guests && input.guests > 0 ? input.guests : Math.max(1, Math.floor((widthM * depthM) / 1.8));
      const { slots, cols } = classroomPairSlots(widthM, depthM, wanted);
      for (let index = 0; index < slots.length; index++) {
        const slot = slots[index]!;
        const desk = { ...deskEntry, id: uid(), position: slot, rotation: 0 } as FurnitureItem;
        const chair = { ...chairEntry, id: uid(), position: { x: slot.x, z: slot.z + 0.7 }, rotation: Math.PI } as FurnitureItem;
        accept(tryAdd(base, current, floorIndex, [desk, chair]));
        // 一排长一帧：80 套别播成 160 帧把预览拖穿。
        if (index % cols === cols - 1 || index === slots.length - 1) layouts.push(current);
      }
    }
  } else if (input.seatingShape === 'ring' || input.tablePlan?.shape === 'round') {
    const sideM = input.tablePlan?.shape === 'round' ? input.tablePlan.width : undefined;
    const dining = sideM === undefined ? ringDiningSet() : ringDiningSet({ sideM });
    const sample = buildFurnitureSet(dining, { roomWidth: widthM, roomDepth: depthM, idPrefix: 'ring-measure' });
    if (sample.length) {
      const footprint = setFootprint(sample);
      const seatsEach = sample.filter(item => item.type === 'dining-chair' || item.type === 'chair').length || input.tablePlan?.seatsPerTable || 1;
      const centers = ringCenters({ x: -widthM / 2, z: -depthM / 2, w: widthM, d: depthM }, footprint, 0.6, 1.2);
      const areaSets = Math.max(1, Math.floor((widthM * depthM) / 30));
      const wantedSets = input.guests && input.guests > 0 ? Math.ceil(input.guests / seatsEach) : areaSets;
      const count = Math.max(1, Math.min(centers.length, wantedSets));
      for (const center of centers.slice(0, count)) {
        const items = buildFurnitureSet(dining, { center, roomWidth: widthM, roomDepth: depthM }).map(withId);
        accept(tryAdd(base, current, floorIndex, items));
      }
    }
  } else if (input.tablePlan?.shape === 'rect') {
    const dining = rectDiningSet({ width: input.tablePlan.width, depth: input.tablePlan.depth });
    const sample = buildFurnitureSet(dining, { roomWidth: widthM, roomDepth: depthM, idPrefix: 'rect-measure' });
    if (sample.length) {
      const stageSouth = backdrop ? -depthM / 2 + backdrop.depth + 0.4 : -depthM / 2;
      const slots = setPlacementSlots(dining, widthM, depthM, variant, { clearNorthOfZ: stageSouth });
      const seatsEach = sample.filter(item => item.type === 'dining-chair' || item.type === 'chair').length || input.tablePlan.seatsPerTable || 1;
      const areaSets = Math.max(1, Math.floor((widthM * depthM) / 30));
      const wantedSets = input.guests && input.guests > 0 ? Math.ceil(input.guests / seatsEach) : areaSets;
      const count = Math.max(1, Math.min(slots.length, wantedSets, areaSets * 2));
      for (const center of slots.slice(0, count)) {
        const items = buildFurnitureSet(dining, { center, roomWidth: widthM, roomDepth: depthM }).map(withId);
        accept(tryAdd(base, current, floorIndex, items));
      }
    }
  } else {
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
        accept(tryAdd(base, current, floorIndex, items));
      }
      // 座位优先：只给这一版新摆的桌子补座，锁着的老桌子不碰。
      if (seatPriority && (input.guests ?? 0) > 0) {
        const tables = (current.floors[floorIndex]?.items ?? []).filter(item => item.type === 'dining-table' && !tableIdsBefore.has(item.id));
        const extra = addExtraSeats({ base, floorIndex, layout: current, tables, target: input.guests! });
        if (extra.added) { current = extra.layout; added += extra.added; layouts.push(current); }
      }
    }
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
    guests: input.guests ?? null, seats, seatPriority, diagnostics,
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
  const diagnostics: PlanDiagnostic[] = [];
  let added = 0;
  let dropped = 0;
  for (const request of input.requests) {
    const entry = EVENT_CATALOG.find(catalogItem => catalogItem.materialId === request.materialId);
    if (!entry) {
      dropped += request.count;
      accepted.push({ materialId: request.materialId, name: request.materialId, requested: request.count, placed: 0 });
      diagnostics.push({ severity: 'warning', code: 'UNKNOWN_MATERIAL', count: request.count, names: [request.materialId], message: '物料目录里没有这件' });
      continue;
    }
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
    if (request.count > placed) {
      diagnostics.push({ severity: 'warning', code: 'NO_SPOT', count: request.count - placed, names: [entry.name], message: '附近没有空位' });
    }
    dropped += request.count - placed;
    accepted.push({ materialId: request.materialId, name: entry.name, requested: request.count, placed });
  }
  const final = withItems(base, floorIndex, items);
  const overlaps = countOverlaps(final, floorIndex);
  const blocked = canApplyLayoutGeometry(base, final) ? null : '这版加完有物料过不了几何闸，先挪开再加。';
  return {
    layouts, added, removing: 0, keptLocked: floor.items.filter(item => item.locked && !isStructuralMarker(item)).length,
    dropped, overlapCount: overlaps.count, overlapNames: overlaps.names, blocked, accepted, guests: null, seats: 0,
    diagnostics,
  };
}

/* ───────── plan.revise：按对象做增量修改，不清场重摆 ───────── */

export type SiteSide = 'north' | 'south' | 'east' | 'west';

/** 不许压的带状区域（湖侧景观带、保留带）。从对应边向内量，单位米。 */
export interface SiteBand {
  side: SiteSide;
  depth: number;
  label: string;
}

export type RevisionConflictCode =
  | 'TARGET_NOT_FOUND'
  | 'TARGET_AMBIGUOUS'
  | 'LOCKED'
  | 'UNKNOWN_ASSET'
  | 'BBOX_OVERLAP'
  | 'KEEP_OUT_BAND'
  | 'OUT_OF_BOUNDS'
  | 'STRUCTURAL'
  | 'NO_SPOT';

export interface RevisionConflict {
  code: RevisionConflictCode;
  /** 被点名的物件（itemId 或 assetId）。 */
  target: string;
  message: string;
  /** 命令算出来、但过不了约束的落点。 */
  requested?: Vec2;
  /** 冲突时建议挪到的最近可用落点；确实没有就省略。 */
  alternative?: Vec2;
}

/** 按对象改的统一寻址：优先 itemId；否则按角色 + 序号 + 左右侧认。 */
export interface PlanTargetHint {
  itemId?: string;
  /** 文本层还没拿到 itemId 时按明确名字或类型识别。 */
  role?: string;
  /** 「左边第二张桌子」里的 2。 */
  ordinal?: number;
  /** 同角色多件时从哪头数：左边 = x 从小到大。 */
  side?: 'left' | 'right';
}

export interface PlanMoveOp extends PlanTargetHint {
  kind: 'move';
  delta?: Vec2;
  to?: Vec2;
}

export interface PlanRotateOp extends PlanTargetHint {
  kind: 'rotate';
  /** 顺时针为正，单位度。 */
  deltaDeg: number;
}

export interface PlanScaleOp extends PlanTargetHint {
  kind: 'scale';
  factor: number;
}

export interface PlanRemoveOp extends PlanTargetHint {
  kind: 'remove';
}

export interface PlanRecolorOp extends PlanTargetHint {
  kind: 'recolor';
  /** 十六进制颜色；只改材质色，不动几何。 */
  color: string;
}

export interface PlanAddOp {
  kind: 'add';
  /** 物料目录 type（lamp / tree…）、活动物料 materialId，或外部 GLB 资产的 assetId。 */
  assetId: string;
  count?: number;
  position?: Vec2;
  /** 朝向，度；0 = 朝南（观众席方向）。与 facing 二选一。 */
  rotation?: number;
  facing?: SiteSide;
  /** 相对某件（通常是舞台）左/右/两侧各放。 */
  anchor?: { role: string; sides?: 'both' | 'left' | 'right'; gapM?: number };
  /** 按 assetId 找不到目录时，用这组尺寸现场建一件（Lux3D 生成的 GLB 走这里）。 */
  name?: string;
  width?: number;
  depth?: number;
  height?: number;
  glbUrl?: string;
}

export type PlanRevisionOp = PlanMoveOp | PlanRotateOp | PlanScaleOp | PlanRemoveOp | PlanRecolorOp | PlanAddOp;

export interface RevisionProposal extends PlanProposal {
  /** 真正落进候选的改动数（新增 + 删除 + 挪/转/缩放）。 */
  applied: number;
  /** 被约束挡下、没有落进候选的每次尝试，带建议替代位置。 */
  conflicts: RevisionConflict[];
}

/** 舞台和背景板是不同的物料；灯按目录里的三种灯认。 */
const ROLE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  舞台: ['stage', 'stage-platform'],
  背景板: ['backdrop', '背景板'],
  背景墙: ['backdrop'],
  灯: ['lamp', 'floor-lamp', 'pendant-light', 'lamppost', '灯'],
  灯光: ['lamp', 'floor-lamp', 'pendant-light', 'lamppost', '灯', 'light'],
  射灯: ['lamp', 'floor-lamp', 'pendant-light', '射灯'],
  绿植: ['plant', 'flowerpot', '绿植'],
  树: ['tree', 'pine-tree', '树'],
  桌子: ['table', 'desk', 'dining-table', '桌子'],
  桌: ['table', 'desk', '桌'],
  椅子: ['chair', 'dining-chair', '椅子'],
  椅: ['chair', '椅'],
  签到台: ['checkin', 'reception', '签到台'],
};

function matchesRole(item: FurnitureItem, role: string): boolean {
  const key = role.replace(/[（）()【】[\]·\s]/g, '');
  if (!key) return false;
  const noted = layoutRoleFromNote(item.notes);
  if (key === '舞台') {
    if (noted === '舞台') return true;
    if (item.type === 'backdrop' || item.materialId === 'backdrop' || /(背景|背板|指示|标识|灯|音箱|屏幕|幕布)/.test(item.name)) return false;
    return item.type === 'stage' || item.type === 'stage-platform'
      || (item.materialId === 'asset' && item.assetId === '2476e655-516e-5563-baad-aa821272acb7')
      || /^(主|临时)?(舞台|讲台)(平台)?([（(].*[）)])?$/.test(item.name.trim());
  }
  const aliases = ROLE_ALIASES[key] ?? [key];
  const fields = [String(item.type), item.name, item.materialId ?? '', item.assetId ?? '', noted];
  return aliases.some(alias => fields.some(field => field === alias || (alias.length > 1 && field.includes(alias))));
}

function resolveTarget(items: readonly FurnitureItem[], op: PlanTargetHint): { item: FurnitureItem | null; ambiguous: boolean } {
  if (op.itemId) return { item: items.find(item => item.id === op.itemId) ?? null, ambiguous: false };
  if (!op.role) return { item: null, ambiguous: false };
  const matches = items.filter(item => !isStructuralMarker(item) && matchesRole(item, op.role!));
  if (!matches.length) return { item: null, ambiguous: false };
  if (matches.length > 1 && !op.side) return { item: null, ambiguous: true };
  if (op.side && matches.some(item => !item.position || !Number.isFinite(item.position.x) || !Number.isFinite(item.position.z))) return { item: null, ambiguous: true };
  // 「左边第二张桌子」：同角色按 x 排，左边从最小 x 数，右边从最大 x 数。
  const ordered = op.side === 'left'
    ? [...matches].sort((left, right) => (left.position?.x ?? 0) - (right.position?.x ?? 0))
    : op.side === 'right'
      ? [...matches].sort((left, right) => (right.position?.x ?? 0) - (left.position?.x ?? 0))
      : matches;
  const index = Math.max(0, (op.ordinal ?? 1) - 1);
  const item = ordered[index] ?? null;
  if (item && ordered.some((other, i) => i !== index && other.position?.x === item.position?.x)) return { item: null, ambiguous: true };
  return { item, ambiguous: false };
}

/** 按 assetId 取一件可放的物料；目录里没有但带了尺寸，就按外部 GLB 资产现场建。 */
function buildRevisionItem(op: PlanAddOp): { item: FurnitureItem; name: string } | null {
  const furniture = FURNITURE_CATALOG.find(entry => entry.type === op.assetId);
  if (furniture) {
    return { item: { ...furniture, id: uid(), position: { x: 0, z: 0 }, rotation: 0 } as FurnitureItem, name: furniture.name };
  }
  const material = EVENT_CATALOG.find(entry => entry.materialId === op.assetId);
  if (material) {
    return { item: { ...material, id: uid(), position: { x: 0, z: 0 }, rotation: 0 } as FurnitureItem, name: material.name };
  }
  if (!(op.width && op.depth && op.width > 0 && op.depth > 0)) return null;
  const height = op.height && op.height > 0 ? op.height : Math.max(op.width, op.depth);
  const role = layoutRoleFromAssetName(op.name ?? op.assetId);
  const item: FurnitureItem = {
    id: uid(), type: 'glb-asset', name: op.name ?? op.assetId,
    width: op.width, depth: op.depth, height,
    color: '#9aa3ad', icon: '📦', materialId: 'asset', assetId: op.assetId, source: 'generated',
    ...(op.glbUrl ? { glbUrl: op.glbUrl } : {}),
    ...(role ? { notes: layoutRoleNote(role) } : {}),
    position: { x: 0, z: 0 }, rotation: 0,
  };
  return { item, name: item.name };
}

/** rotation 0 朝 +z（南，观众席）；rotation 单位是弧度，操作契约里给人写度数。 */
const FACE_RAD: Readonly<Record<SiteSide, number>> = {
  south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2,
};

function facingRotation(op: PlanAddOp): number {
  if (typeof op.rotation === 'number') return (op.rotation * Math.PI) / 180;
  return op.facing ? FACE_RAD[op.facing] : 0;
}

interface XzRect { x0: number; x1: number; z0: number; z1: number }

function bandRect(layout: RoomLayout, band: SiteBand): XzRect {
  const halfW = layout.width / 2;
  const halfD = layout.height / 2;
  const depth = Math.max(0, band.depth);
  if (band.side === 'west') return { x0: -halfW, x1: -halfW + depth, z0: -halfD, z1: halfD };
  if (band.side === 'east') return { x0: halfW - depth, x1: halfW, z0: -halfD, z1: halfD };
  if (band.side === 'north') return { x0: -halfW, x1: halfW, z0: -halfD, z1: -halfD + depth };
  return { x0: -halfW, x1: halfW, z0: halfD - depth, z1: halfD };
}

function boundsOf(item: FurnitureItem): XzRect {
  const { halfW, halfD } = rotatedHalfExtents(item);
  const position = item.position ?? { x: 0, z: 0 };
  return { x0: position.x - halfW, x1: position.x + halfW, z0: position.z - halfD, z1: position.z + halfD };
}

const rectsOverlap = (a: XzRect, b: XzRect): boolean =>
  Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.z1, b.z1) > Math.max(a.z0, b.z0);

/** 地毯、地垫这类低矮件允许被别的物件压着，不参与包围盒冲突。 */
const isLowProfile = (item: FurnitureItem): boolean =>
  item.type === 'rug' || item.type === 'carpet' || (item.height ?? 0) <= 0.05;

const round2 = (value: number): number => Math.round(value * 100) / 100;

interface PlacementProblem { code: RevisionConflictCode; message: string }

/**
 * 一件候选落点的最小约束：景观带 → 既有物件包围盒 → 场地边界 → 墙柱 → 整场几何闸。
 * 与编辑器同一套算法，只是跑在没落盘的候选上。
 */
function placementProblem(input: {
  layout: RoomLayout;
  floorIndex: number;
  candidate: FurnitureItem;
  others: readonly FurnitureItem[];
  bands: readonly SiteBand[];
}): PlacementProblem | null {
  const { layout, floorIndex, candidate, others, bands } = input;
  if (!candidate.position) return { code: 'NO_SPOT', message: '这件没有落点' };
  if (isStructuralMarker(candidate)) return { code: 'STRUCTURAL', message: '不能改场地结构件' };
  const bounds = boundsOf(candidate);
  const band = bands.find(entry => rectsOverlap(bounds, bandRect(layout, entry)));
  if (band) return { code: 'KEEP_OUT_BAND', message: `越过${band.label}` };
  const overlapping = others.find(other => other.id !== candidate.id && !isStructuralMarker(other)
    && !isLowProfile(other) && itemsOverlap(candidate, other));
  if (overlapping) return { code: 'BBOX_OVERLAP', message: `压在「${overlapping.name}」的包围盒里` };
  const halfW = layout.width / 2;
  const halfD = layout.height / 2;
  if (bounds.x0 < -halfW || bounds.x1 > halfW || bounds.z0 < -halfD || bounds.z1 > halfD) {
    return { code: 'OUT_OF_BOUNDS', message: '超出场地边界' };
  }
  const floor = layout.floors[floorIndex];
  if (!floor) return { code: 'NO_SPOT', message: '这层楼不存在' };
  const keepOut = floorKeepOut(layout, floorIndex);
  const interiorWalls = layout.backendSceneV2 ? [] : floor.interiorWalls;
  if (hasCollisions(candidate, [...others], layout.width, layout.height, {
    keepOut, structureValidated: !!layout.backendSceneV2, interiorWalls,
  })) {
    return { code: 'STRUCTURAL', message: '压到墙体、立柱或保留区' };
  }
  const next = withItems(layout, floorIndex, [...others, candidate]);
  if (!canApplyLayoutGeometry(layout, next)) return { code: 'STRUCTURAL', message: '过不了场地几何校验' };
  return null;
}

/** 冲突时沿半径一圈圈找最近的可落点；找不到再退回全场地空位扫描。 */
function nearbySpot(input: {
  layout: RoomLayout;
  floorIndex: number;
  candidate: FurnitureItem;
  others: readonly FurnitureItem[];
  bands: readonly SiteBand[];
  requested: Vec2;
}): Vec2 | null {
  const radii = [0.3, 0.5, 0.8, 1, 1.5, 2, 2.5, 3, 4, 5, 6];
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  for (const radius of radii) {
    for (const angle of angles) {
      const radians = (angle * Math.PI) / 180;
      const position = { x: round2(input.requested.x + Math.cos(radians) * radius), z: round2(input.requested.z + Math.sin(radians) * radius) };
      const candidate = { ...input.candidate, position };
      if (!placementProblem({ ...input, candidate })) return position;
    }
  }
  return findAdditionSpot(input.layout, input.floorIndex, input.candidate, [...input.others]);
}

/**
 * `plan.revise` 的纯函数实现：按 itemId（或角色）挪/转/缩放/删单件，按 assetId 加件。
 * 只换目标物件：其它物件的对象引用原样保留；每一步成功都长一帧候选，供预览逐帧走。
 * 加灯这类显式落点过不了约束时，不硬放，改为记录冲突 + 建议替代位置。
 */
export function revisePlan(input: {
  base: RoomLayout;
  floorIndex: number;
  ops: readonly PlanRevisionOp[];
  /** 不许压的带状区域；湖侧景观带由调用方从这句话里解析出来。 */
  bands?: readonly SiteBand[];
  /** Only generator-origin in-memory witnesses may be supplied by the caller. */
  seatingWitness?: LocalSeatingWitness|null;
}): RevisionProposal {
  const base = input.base;
  const floorIndex = Math.min(input.floorIndex, Math.max(0, base.floors.length - 1));
  const floor = base.floors[floorIndex];
  if (!floor) throw new Error('场地还没立起来，先说出长宽，我再改。');
  const bands = input.bands ?? [];
  let items = floor.items.slice();
  const layouts: RoomLayout[] = [base];
  const conflicts: RevisionConflict[] = [];
  const skipped: string[] = [];
  const diagnostics: PlanDiagnostic[] = [];
  let added = 0;
  let removed = 0;
  let moved = 0;
  let dropped = 0;

  const note = (code: PlanDiagnostic['code'], count: number, names: string[], message: string): void => {
    diagnostics.push({ severity: 'warning', code, count, names, message });
  };
  const commit = (next: FurnitureItem[]): void => {
    items = next;
    layouts.push(withItems(base, floorIndex, items));
  };
  const fail = (conflict: RevisionConflict, diagnostic: PlanDiagnostic['code'], message: string): void => {
    conflicts.push(conflict);
    note(diagnostic, 1, [conflict.target], message);
    dropped += 1;
    if (conflict.code === 'LOCKED' || conflict.code === 'TARGET_NOT_FOUND') skipped.push(conflict.target);
  };

  for (const op of input.ops) {
    if (op.kind === 'add') {
      const built = buildRevisionItem(op);
      if (!built) {
        fail({ code: 'UNKNOWN_ASSET', target: op.assetId, message: '按 assetId 找不到这件，也没给尺寸' }, 'UNKNOWN_MATERIAL', '按 assetId 找不到这件');
        continue;
      }
      const asset = built.item;
      const bothSides = op.anchor?.sides === 'both';
      const wanted = bothSides ? 2 : Math.max(1, Math.min(20, op.count ?? 1));
      const anchor = op.anchor ? resolveTarget(items, { role: op.anchor.role }) : null;
      const anchorItem = anchor?.item ?? null;
      if (op.anchor && !anchorItem) {
        const message = anchor?.ambiguous ? `有多个「${op.anchor.role}」，请明确选择物件后再放灯。` : `场地里没有「${op.anchor.role}」，没法按它两侧落灯`;
        fail({ code: anchor?.ambiguous ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND', target: op.anchor.role, message }, 'NO_SPOT', message);
        continue;
      }
      let changed = false;
      for (let index = 0; index < wanted; index++) {
        let requested: Vec2 | null = null;
        if (op.position) requested = { x: op.position.x, z: op.position.z };
        else if (anchorItem) {
          const center = anchorItem.position ?? { x: 0, z: 0 };
          const gap = op.anchor?.gapM ?? 0.4;
          const offset = anchorItem.width / 2 + asset.width / 2 + gap;
          const side = bothSides ? (index === 0 ? 'left' : 'right') : (op.anchor?.sides === 'right' ? 'right' : 'left');
          requested = { x: round2(center.x + (side === 'left' ? -offset : offset)), z: round2(center.z) };
        } else {
          requested = findAdditionSpot(base, floorIndex, asset, items);
        }
        if (!requested) {
          fail({ code: 'NO_SPOT', target: built.name, message: '附近没有空位' }, 'NO_SPOT', '附近没有空位');
          continue;
        }
        const candidate: FurnitureItem = { ...asset, id: uid(), position: requested, rotation: facingRotation(op) };
        const problem = placementProblem({ layout: base, floorIndex, candidate, others: items, bands });
        if (problem) {
          const alternative = nearbySpot({ layout: base, floorIndex, candidate, others: items, bands, requested });
          fail({
            code: problem.code, target: built.name, message: problem.message,
            requested, ...(alternative ? { alternative } : {}),
          }, problem.code === 'KEEP_OUT_BAND' || problem.code === 'OUT_OF_BOUNDS' ? 'OUT_OF_BOUNDS' : 'NO_SPOT', problem.message);
          continue;
        }
        items = [...items, candidate];
        added += 1;
        changed = true;
      }
      if (changed) commit(items);
      continue;
    }

    if (op.kind === 'scale' && (!Number.isFinite(op.factor) || op.factor < 0.2 || op.factor > 5)) {
      fail({code:'NO_SPOT', target:op.itemId ?? op.role ?? '?', message:`缩放倍数 ${op.factor} 超出支持范围 0.2–5 倍，请调整后重试。`}, 'NO_SPOT', '缩放倍数超出支持范围');
      continue;
    }
    const resolution = resolveTarget(items, op);
    const target = resolution.item;
    if (!target) {
      const message = resolution.ambiguous ? `找到多件「${op.role}」，请先补齐可区分的位置，再说明左右位置或选择具体物件。` : '场地里没有这件';
      fail({ code: resolution.ambiguous ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND', target: op.itemId ?? op.role ?? '?', message }, 'UNKNOWN_MATERIAL', message);
      continue;
    }
    if (target.locked) {
      fail({ code: 'LOCKED', target: target.name, message: `「${target.name}」锁着，我不动` }, 'NO_SPOT', '锁着没动');
      continue;
    }
    if (op.kind === 'remove') {
      commit(items.filter(item => item.id !== target.id));
      removed += 1;
      continue;
    }
    if (op.kind === 'recolor') {
      if (!/^#[0-9a-f]{3,8}$/i.test(op.color)) {
        fail({ code: 'TARGET_NOT_FOUND', target: target.name, message: '颜色值不合法' }, 'NO_SPOT', '颜色值不合法');
        continue;
      }
      commit(items.map(item => (item.id === target.id ? { ...item, color: op.color } : item)));
      moved += 1;
      continue;
    }

    let candidate: FurnitureItem;
    let requested: Vec2 | undefined;
    if (op.kind === 'move') {
      const before = target.position ?? { x: 0, z: 0 };
      requested = op.to ?? { x: round2(before.x + (op.delta?.x ?? 0)), z: round2(before.z + (op.delta?.z ?? 0)) };
      candidate = { ...target, position: requested };
    } else if (op.kind === 'rotate') {
      candidate = { ...target, rotation: (target.rotation ?? 0) + (op.deltaDeg * Math.PI) / 180 };
    } else {
      const factor = op.factor;
      candidate = {
        ...target,
        width: round2(target.width * factor),
        depth: round2(target.depth * factor),
        height: round2(target.height * factor),
      };
    }
    const others = items.filter(item => item.id !== target.id);
    const problem = placementProblem({ layout: base, floorIndex, candidate, others, bands });
    if (problem) {
      const alternative = requested
        ? nearbySpot({ layout: base, floorIndex, candidate, others, bands, requested })
        : undefined;
      fail({
        code: problem.code, target: target.name, message: problem.message,
        ...(requested ? { requested } : {}), ...(alternative ? { alternative } : {}),
      }, problem.code === 'KEEP_OUT_BAND' || problem.code === 'OUT_OF_BOUNDS' ? 'OUT_OF_BOUNDS' : 'NO_SPOT', problem.message);
      skipped.push(target.name);
      continue;
    }
    commit(items.map(item => (item.id === target.id ? candidate : item)));
    moved += 1;
  }

  const final = withItems(base, floorIndex, items);
  const overlaps = countOverlaps(final, floorIndex);
  const keptLocked = floor.items.filter(item => item.locked && !isStructuralMarker(item)).length;
  const blocked = canApplyLayoutGeometry(base, final) ? null : '这版改完过不了几何闸，先挪开再加。';
  return {
    layouts, added, removing: removed, keptLocked, dropped,
    overlapCount: overlaps.count, overlapNames: overlaps.names,
    blocked, moved, skipped: [...new Set(skipped)], diagnostics, guests: null, seats: 0,
    applied: added + removed + moved, conflicts,
    ...(Object.hasOwn(input,'seatingWitness')?{
      seatingWitness:input.seatingWitness?structuredClone(input.seatingWitness):null,
      seatingReview:reviewLocalSeatingWitness(input.seatingWitness,final),
    }:{}),
  };
}
