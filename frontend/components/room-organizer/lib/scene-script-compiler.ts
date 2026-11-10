import type { PlanProposal } from './agent-proposal';
import { EVENT_CATALOG, FURNITURE_CATALOG } from './constants';
import { DIAGNOSTIC_REASON, mergeDiagnostics, type PlanDiagnostic } from './diagnostics';
import { floorKeepOut } from './floor-keep-out';
import { buildFurnitureSet, FURNITURE_SETS, type FurnitureSet } from './furniture-sets';
import { rectDiningSet, ringCenters, ringDiningSet, RING_TABLE_SIDE_M } from './ring-seating';
import type { TableArrangement } from './table-seat-plan';
import { hasCollisions, rotatedHalfExtents, type CollisionContext } from './geometry';
import { randomSuffix } from './ids';
import {
  describeSceneScript,
  keepOutZones,
  normalizeSceneScript,
  SCENE_SCRIPT_ROLE_LABEL,
  validateSceneScript,
  zoneRectOf,
  zonesWithRole,
  type SceneScriptVenue,
} from './scene-script';
import { canApplyLayoutGeometry, isStructuralMarker } from './structural-layout';
import type { CatalogItem, FurnitureItem, RoomLayout, Vec2 } from './types';
import type { ZoneRect } from './zones';
import type {
  SceneScript,
  SceneScriptIssue,
  SceneScriptIssueCode,
  SceneScriptZone,
  SceneScriptZoneRole,
} from '../../../../supabase/functions/_shared/scene-script-contract';

/**
 * Compiles a scene script into placeable furniture. Pure: same script + same venue + same
 * seed give the same room, and nothing is written until the caller applies the result.
 *
 * The order is the discipline borrowed from the two reference implementations: structure
 * first (stage), then the approach (check-in), then the field that depends on both
 * (seating), then decoration — and every drop is counted, never hidden. A refusal is a
 * value, not an exception: the caller shows it, whoever wrote the script fixes it, and the
 * next compile starts from the untouched room again.
 */

export interface SceneScriptCompileContext {
  base: RoomLayout;
  floorIndex: number;
  /** Test seam: deterministic ids so two compiles can be compared field by field. */
  makeId?: () => string;
  /** Round tables on a ring. Omitted keeps the rectangular dining grid. */
  seatingShape?: 'ring';
  /** Size and seats already decided. The compiler places this set and does not pick another count. */
  tablePlan?: TableArrangement;
}

/** One line of the ledger: what a role asked for, what landed, what was refused. */
export interface SceneScriptOp {
  role: SceneScriptZoneRole;
  placed: number;
  refused: number;
}

export interface SceneScriptRefusal {
  code: SceneScriptIssue['code'];
  role?: SceneScriptZoneRole;
  message: string;
  hint?: string;
  /** 座位口径的缺口：这块地给不起的要的那几个人，一件物料都没被拒时用这个数说话。 */
  seats?: number;
  /** 这一区按这套排法排到顶的座位数（探出来的可达上限，不是这块地的极限）。 */
  capacity?: number;
}

export interface SceneScriptCompileResult extends PlanProposal {
  script: SceneScript;
  issues: SceneScriptIssue[];
  refusals: SceneScriptRefusal[];
  ops: SceneScriptOp[];
  /** Fixed-point accounting for the seating field: did reducing the request converge? */
  settled: { passes: number; converged: boolean };
  /** How many seats this arrangement can hold at all (probed slot by slot; the ask may exceed it). */
  capacity: number;
  /** The script read back in words, for the chat line before the preview. */
  summary: string[];
}

/**
 * 脚本的拒绝原因对到共享诊断词表（`lib/diagnostics`），卡片、气泡和旧路径念同一套话。
 * 一条原因都没有对上的按「超出场地容量」记：脚本要的和这块地给得起的之间差的就是件数。
 */
function diagnosticCodeFor(cause: SceneScriptIssueCode | undefined): PlanDiagnostic['code'] {
  if (cause === 'E_ROLE_UNFIT') return 'ROLE_UNFIT';
  if (cause === 'E_KEEP_OUT') return 'KEEP_OUT';
  if (cause === 'E_SET_BLOCKED') return 'NO_SPOT';
  if (cause === 'E_FINAL_GEOMETRY') return 'STRUCTURAL_COLLISION';
  return 'CAPACITY_EXCEEDED';
}

/**
 * 一区一条：件数直接取账本里那一区的 `refused`，所以 `Σ count` 恒等于 `dropped`。
 * 原因取这一区第一条拒绝的码——同一区在一版里只会拒一次，多座位区各记各的。
 */
export function sceneScriptDiagnostics(
  ops: readonly SceneScriptOp[],
  refusals: readonly SceneScriptRefusal[],
): PlanDiagnostic[] {
  const causeByRole = new Map<SceneScriptZoneRole, SceneScriptIssueCode>();
  for (const refusal of refusals) {
    if (refusal.role && !causeByRole.has(refusal.role)) causeByRole.set(refusal.role, refusal.code);
  }
  // 座位缺口另记一条：一件物料都没被拒，缺的是人头。count 记 0，「没放进去 N 件」那句就不去
  // 抢它的数字——同一件事只按座说一次，卡片下面「座位 K / N」那行才是它的口径。
  const seatLines = refusals.filter((refusal) => (refusal.seats ?? 0) > 0).map((refusal) => {
    const code: PlanDiagnostic['code'] = diagnosticCodeFor(refusal.code);
    return {
      severity: 'warning' as const,
      code,
      count: 0,
      seats: refusal.seats,
      ...(refusal.capacity !== undefined ? { capacity: refusal.capacity } : {}),
      names: [SCENE_SCRIPT_ROLE_LABEL[refusal.role ?? 'seating']],
      message: refusal.capacity ? `按这套排法这块座位区排到 ${refusal.capacity} 座就是头` : DIAGNOSTIC_REASON[code],
    };
  });
  return mergeDiagnostics([], [
    ...ops.filter((op) => op.refused > 0).map((op) => {
      const code = diagnosticCodeFor(causeByRole.get(op.role));
      return {
        severity: 'warning' as const,
        code,
        count: op.refused,
        names: [SCENE_SCRIPT_ROLE_LABEL[op.role]],
        message: DIAGNOSTIC_REASON[code],
      };
    }),
    ...seatLines,
  ]);
}

/** A piece is refused, never half-placed: a table without its chairs is a broken set. */
const MAX_SETTLE_PASSES = 6;
/** Air between neighbouring sets, on top of their real footprints. */
const SET_GAP_M = 0.5;

const DEFAULT_ID = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${randomSuffix()}`;

export function compileSceneScript(script: SceneScript, context: SceneScriptCompileContext): SceneScriptCompileResult {
  const { base, floorIndex } = context;
  const makeId = context.makeId ?? DEFAULT_ID;
  const venue: SceneScriptVenue = { width: base.width, depth: base.height };
  // The read-back is regenerated from the normalized script below; a summary of the raw
  // numbers would describe rects the compiler never used.
  let summary = describeSceneScript(script);

  const refused = (issues: SceneScriptIssue[], blocked: string): SceneScriptCompileResult => ({
    layouts: [base],
    added: 0,
    removing: 0,
    keptLocked: 0,
    dropped: 0,
    overlapCount: 0,
    overlapNames: [],
    blocked,
    guests: script.guests ?? null,
    script,
    issues,
    refusals: [{ code: 'E_FINAL_GEOMETRY', message: blocked }],
    ops: [],
    settled: { passes: 0, converged: true },
    capacity: 0,
    summary,
  });

  const floor = base.floors[floorIndex];
  if (!floor) return refused([], '这一层不存在，脚本没有可以落的楼层。');

  const normalized = normalizeSceneScript(script, venue);
  const issues = [...normalized.issues, ...validateSceneScript(normalized.script, venue)];
  const errors = issues.filter((entry) => entry.severity === 'error');
  if (errors.length) return refused(issues, errors[0]!.message);
  const plan = normalized.script;
  summary = describeSceneScript(plan);

  // 1. Clear what this plan owns: unlocked items go, locked items stay, structural markers
  //    are the venue's truth and are never touched. The count is reported, not just done.
  const currentItems = floor.items;
  const markers = currentItems.filter(isStructuralMarker);
  const locked = currentItems.filter((item) => item.locked === true && !isStructuralMarker(item));
  const removing = currentItems.filter((item) => item.locked !== true && !isStructuralMarker(item)).length;
  let current = withItems(base, floorIndex, [...markers, ...locked]);
  const layouts: RoomLayout[] = [current];

  const issuesOut: SceneScriptIssue[] = [...issues];
  const refusals: SceneScriptRefusal[] = [];
  const ledgerMap = new Map<SceneScriptZoneRole, SceneScriptOp>();
  const ledger = (role: SceneScriptZoneRole): SceneScriptOp => {
    const existing = ledgerMap.get(role);
    if (existing) return existing;
    const created: SceneScriptOp = { role, placed: 0, refused: 0 };
    ledgerMap.set(role, created);
    return created;
  };

  const keepOut = keepOutZones(plan).map(zoneRectOf);
  const collisionContext = (): CollisionContext => ({
    keepOut: floorKeepOut(base, floorIndex),
    structureValidated: !!base.backendSceneV2,
    interiorWalls: base.backendSceneV2 ? [] : (base.floors[floorIndex]?.interiorWalls ?? []),
  });
  const itemsOnFloor = (layout: RoomLayout): FurnitureItem[] => layout.floors[floorIndex]?.items ?? [];

  /** A piece may not stand in an aisle or a reserved zone. Dropped, not nudged. */
  const intrudesKeepOut = (item: FurnitureItem): boolean => {
    if (!item.position) return false;
    const { halfW, halfD } = rotatedHalfExtents({ width: item.width, depth: item.depth, rotation: item.rotation ?? 0 });
    const x0 = item.position.x - halfW;
    const x1 = item.position.x + halfW;
    const z0 = item.position.z - halfD;
    const z1 = item.position.z + halfD;
    return keepOut.some(
      (rect) => x0 < rect.x + rect.w - 1e-6 && rect.x < x1 - 1e-6 && z0 < rect.z + rect.d - 1e-6 && rect.z < z1 - 1e-6
    );
  };

  /**
   * Try a whole batch without writing a byte: when it fits, the candidate floor comes back.
   * This is what the capacity probe in `fillSeating` stands on — the ceiling has to be known
   * before anything is placed, not counted off afterwards.
   */
  const fitsBatch = (
    items: readonly FurnitureItem[]
  ): { accepted: boolean; reason?: string; code?: SceneScriptIssue['code']; next?: RoomLayout } => {
    if (!items.length) return { accepted: false, reason: '这一区按尺寸放不下任何一组', code: 'E_ROLE_UNFIT' };
    const nextItems = [...itemsOnFloor(current)];
    const options = collisionContext();
    for (const item of items) {
      if (intrudesKeepOut(item)) return { accepted: false, reason: `${item.name} 会压在通道或预留区上`, code: 'E_KEEP_OUT' };
      const others = nextItems.filter((other) => !items.some((entry) => entry.id === other.id));
      if (hasCollisions(item, [...others, ...items], base.width, base.height, options)) {
        return { accepted: false, reason: `${item.name} 跟场上已有的东西撞上了`, code: 'E_SET_BLOCKED' };
      }
      nextItems.push(item);
    }
    const next = withItems(current, floorIndex, nextItems);
    if (!canApplyLayoutGeometry(base, next)) return { accepted: false, reason: '这一组跟墙体或场地边界冲突', code: 'E_FINAL_GEOMETRY' };
    return { accepted: true, next };
  };

  /**
   * Take a whole batch or none of it. A set that would put one chair through a wall is a
   * set that is not placed at all — the alternative is a table with three chairs, which
   * reads as a bug rather than a compromise. The code travels with the refusal so the
   * caller can say whether it hit an aisle or another piece of furniture.
   */
  const acceptBatch = (items: readonly FurnitureItem[]): { accepted: boolean; reason?: string; code?: SceneScriptIssue['code'] } => {
    const result = fitsBatch(items);
    if (result.accepted && result.next) current = result.next;
    return result;
  };

  const stamp = (entry: CatalogItem, position: Vec2, rotation = 0): FurnitureItem => ({
    ...entry,
    id: makeId(),
    position,
    rotation,
  });

  // 2. Stage: the mass the rest of the room faces. It goes on the zone's north edge and
  //    faces south; if even the narrowest backdrop does not fit, the script is told why
  //    instead of getting a backdrop through a wall.
  for (const zone of zonesWithRole(plan, 'stage')) {
    const piece = EVENT_CATALOG.find((entry) => entry.materialId === 'backdrop');
    if (!piece) break;
    const rect = zoneRectOf(zone);
    if (piece.width > rect.w - 2 * plan.constraints.wallGapM) {
      ledger('stage').refused += 1;
      refusals.push({
        code: 'E_ROLE_UNFIT',
        role: 'stage',
        message: `舞台区只有 ${rect.w.toFixed(1)} m 宽，最窄的背板也横不下。`,
        hint: '把 stage 区加宽到 3 m 以上，或者这次不用舞台。',
      });
      continue;
    }
    const position = { x: rect.x + rect.w / 2, z: rect.z + plan.constraints.wallGapM + piece.depth / 2 };
    const result = acceptBatch([stamp(piece, position, 0)]);
    if (result.accepted) ledger('stage').placed += 1;
    else {
      ledger('stage').refused += 1;
      refusals.push({
        code: result.code ?? 'E_SET_BLOCKED',
        role: 'stage',
        message: `舞台背板放不下：${result.reason ?? '位置被占'}。`,
        hint: '挪开挡住舞台的物料，或者把 stage 区换到别的边。',
      });
    }
  }
  layouts.push(current);

  // 3. Check-in: where people are met, facing the room. Same fit check as the stage: a
  //    counter that hangs out of its zone is furniture in the aisle, not a compromise.
  for (const zone of zonesWithRole(plan, 'checkin')) {
    const piece = EVENT_CATALOG.find((entry) => entry.materialId === 'reception');
    if (!piece) break;
    const rect = zoneRectOf(zone);
    // The zone is already inset from the venue wall by the brief, so one gap of clearance is
    // enough here: a 1.8 m counter in a 2.4 m zone fits, and demanding a gap on both sides
    // would reject a perfectly good check-in desk.
    if (piece.width > rect.w - plan.constraints.wallGapM || piece.depth > rect.d - plan.constraints.wallGapM) {
      ledger('checkin').refused += 1;
      refusals.push({
        code: 'E_ROLE_UNFIT',
        role: 'checkin',
        message: `签到区 ${rect.w.toFixed(1)} × ${rect.d.toFixed(1)} m，${piece.width.toFixed(1)} × ${piece.depth.toFixed(1)} m 的签到台放不进去。`,
        hint: '把 checkin 区放大，或者换成窄一点的接待台。',
      });
      continue;
    }
    const position = { x: rect.x + rect.w / 2, z: rect.z + rect.d / 2 };
    const result = acceptBatch([stamp(piece, position, Math.PI)]);
    if (result.accepted) ledger('checkin').placed += 1;
    else {
      ledger('checkin').refused += 1;
      refusals.push({
        code: result.code ?? 'E_SET_BLOCKED',
        role: 'checkin',
        message: `签到台放不下：${result.reason ?? '位置被占'}。`,
        hint: '把 checkin 区挪到入口一侧，或者少摆一件。',
      });
    }
  }
  layouts.push(current);

  // 4. Seating: the ceiling is probed slot by slot first, then the field is filled. A zone
  //    that can only hold 24 seats never gets 80 sets asked for, so the shortfall stays one
  //    honest number in 座 instead of turning into 75 refused 件 nobody can picture.
  let settled = { passes: 0, converged: true };
  let capacity = 0;
  let seatUpper = 0;
  const seatCeilings = new Map<SceneScriptZone, number>();
  for (const zone of zonesWithRole(plan, 'seating')) {
    const outcome = fillSeating(plan, zone, {
      base,
      floorIndex,
      start: current,
      makeId,
      acceptBatch,
      fitsSet: (center, variant) => fitsBatch(variant.build(center)),
      setCurrent: (layout) => {
        current = layout;
      },
      refusals,
      ledger,
      ...(context.seatingShape === 'ring' ? { seatingShape: 'ring' as const } : {}),
      ...(context.tablePlan ? { tablePlan: context.tablePlan } : {}),
    });
    // Several seating zones: the worst one decides. A zone that could not settle must not be
    // hidden by the next zone reporting a clean pass.
    settled = {
      passes: Math.max(settled.passes, outcome.passes),
      converged: settled.converged && outcome.converged,
    };
    capacity += outcome.capacity;
    seatUpper += outcome.upper;
    seatCeilings.set(zone, outcome.capacity);
  }
  // 读白在这一句之后才写：座位那一行的数必须来自刚探出来的上限，不能来自要价。
  summary = describeSceneScript(plan, seatCeilings);
  layouts.push(current);

  // 5. Booths and planting: decoration, so a refusal is normal and reported, never fatal.
  for (const zone of zonesWithRole(plan, 'booth')) fillBooth(plan, zone, { stamp, acceptBatch, refusals, ledger });
  for (const zone of zonesWithRole(plan, 'plant')) fillPlants(plan, zone, { stamp, acceptBatch, refusals, ledger });
  layouts.push(current);

  // 6. Read back what landed: overlaps are counted on the candidate, not on the canvas.
  //    The last frame is the decorated room itself, so the preview does not repeat a frame.
  const overlaps = countOverlaps(current, floorIndex);
  const blocked = canApplyLayoutGeometry(base, current) ? null : '这版里有跟墙体或边界冲突的物料，先挪开或解锁再重新出一版。';
  const placedItems = itemsOnFloor(current).filter((item) => !isStructuralMarker(item) && item.locked !== true);
  // Every chair on the floor counts, locked ones included: a locked chair still seats
  // somebody, and the old heuristic counted it — switching engines must not drop a seat.
  const seats = itemsOnFloor(current).filter(
    (item) => !isStructuralMarker(item) && (item.type === 'chair' || item.type === 'dining-chair')
  ).length;
  if (plan.guests && seats < plan.guests) {
    issuesOut.push({
      code: 'W_CAPACITY',
      severity: 'warning',
      path: 'guests',
      message: capacity > 0
        ? `脚本要 ${plan.guests} 个座位，按这套排法这块座位区排到 ${capacity} 座就是头，这一版摆出 ${seats} 个。`
        + (seatUpper > capacity
          ? `按面积粗算这块座位区还余着约 ${seatUpper - capacity} 座的地，要多吃干得换排法。`
          : '')
        : `脚本要 ${plan.guests} 个座位，可座位区一组桌椅都放不下。`,
      hint: '加宽 seating 区、少占舞台和签到的地，或者让人数降到这个数以下。',
    });
  }

  return {
    layouts,
    added: placedItems.length,
    removing,
    keptLocked: locked.length,
    dropped: [...ledgerMap.values()].reduce((sum, op) => sum + op.refused, 0),
    overlapCount: overlaps.count,
    overlapNames: overlaps.names,
    blocked,
    guests: plan.guests ?? null,
    seats,
    diagnostics: sceneScriptDiagnostics([...ledgerMap.values()], refusals),
    script: plan,
    issues: issuesOut,
    refusals,
    ops: [...ledgerMap.values()],
    settled,
    capacity,
    summary,
  };
}

interface SeatingDeps {
  base: RoomLayout;
  floorIndex: number;
  start: RoomLayout;
  makeId: () => string;
  acceptBatch: (items: readonly FurnitureItem[]) => { accepted: boolean; reason?: string };
  /** 空跑一组：摆得进吗？上限靠它逐格探出来，探的时候画布一个字节都不动。 */
  fitsSet: (center: Vec2, variant: MeasuredSet) => { accepted: boolean; reason?: string; code?: SceneScriptIssue['code'] };
  setCurrent: (layout: RoomLayout) => void;
  refusals: SceneScriptRefusal[];
  ledger: (role: SceneScriptZoneRole) => SceneScriptOp;
  seatingShape?: 'ring';
  tablePlan?: TableArrangement;
}

/**
 * Fill one seating zone. The grid is measured from the real footprint of one set (chairs
 * included), not from a guessed pitch: a 2.4 m table with four chairs is about 2.9 m wide
 * in practice, and a grid that forgets the chairs puts them inside each other. The set is
 * tried in both orientations and the roomier one wins.
 *
 * Settle: a slot that refuses once is dropped from the candidate list and the pass restarts
 * from the pre-seating room, bounded by MAX_SETTLE_PASSES. Asking for less while keeping the
 * dead slot in the prefix never terminates on a script whose zone is simply too small.
 */
/**
 * 一区座位的账：`capacity` 是这套整排摆法逐格空跑探到的顶，`upper` 是同一块地按面积的宽松上界。
 * 两者之间的差就是我们这套排法还没吃干的地，所以两个数一起给，别把前者说成这块地的极限。
 */
type SeatingOutcome = { passes: number; converged: boolean; capacity: number; upper: number };

function fillSeating(script: SceneScript, zone: SceneScriptZone, deps: SeatingDeps): SeatingOutcome {
  const rect = zoneRectOf(zone);
  const mode = script.layoutMode;
  const ring = deps.seatingShape === 'ring' && mode !== 'desk-chair' && deps.tablePlan?.shape !== 'rect';
  const planned = deps.tablePlan;
  const set = mode === 'desk-chair'
    ? null
    : ring || planned?.shape === 'round'
      ? ringDiningSet({ sideM: planned?.shape === 'round' ? planned.width : RING_TABLE_SIDE_M })
      : planned?.shape === 'rect'
        ? rectDiningSet({ width: planned.width, depth: planned.depth })
        : FURNITURE_SETS.find((entry) => entry.key === 'dining');
  const measured = set ? measureSet(set, deps.base, deps.makeId) : measurePair(deps.makeId);
  const asked = zone.count ?? script.guests ?? 0;
  // A build that comes back empty means the set itself cannot exist in this venue (a 2 m
  // wide room has no 2.5 m table-and-chairs footprint). Measuring its empty box would
  // invent a grid of zero-size sets — and a fake capacity to go with it.
  if (measured.count === 0 || measured.halfX <= 0 || measured.halfZ <= 0) {
    deps.ledger('seating').refused += Math.max(1, zone.count ?? script.guests ?? 1);
    deps.refusals.push({
      code: 'E_ROLE_UNFIT',
      role: 'seating',
      message: `座位区 ${rect.w.toFixed(1)} × ${rect.d.toFixed(1)} m，连一组${mode === 'desk-chair' ? '课桌' : '餐桌'}都摆不下。`,
      hint: '把场地加宽，或者换成不用整组桌椅的排法。',
      seats: asked,
      capacity: 0,
    });
    return { passes: 0, converged: false, capacity: 0, upper: 0 };
  }
  const seatsPerSet = measured.seats > 0 ? measured.seats : 1;
  // 可行域先行：每个格子先空跑一遍，摆不进的在排位之前就出局——顶死在座位区里的衣柜、压在通道上
  // 的那一格，不用等到试第六遍才承认。格子之间按实测占位互不相撞，所以这一遍数出来的就是这块地的
  // 上限；朝向也按摆得进的格子数选，两样多时用不转的，同一份脚本永远给同一间房。
  const evaluated = [measured, rotatedVariant(measured)]
    .map((variant) => {
      const live: Vec2[] = [];
      let blocker: { accepted?: boolean; reason?: string; code?: SceneScriptIssue['code'] } = {};
      for (const center of seatingSlots(rect, variant, script, ring)) {
        const probe = deps.fitsSet(center, variant);
        if (probe.accepted) live.push(center);
        else if (!blocker.code) blocker = probe;
      }
      return { variant, live, blocker };
    })
    .sort((left, right) => right.live.length - left.live.length)[0]!;
  const oriented = evaluated.variant;
  const candidates = evaluated.live;
  // Capacity follows the surviving slots: a slot lost to a locked wardrobe is gone for good,
  // so the number quoted to the user must not count it.
  let ceiling = candidates.length * seatsPerSet;
  // 排到顶是几座 ≠ 这块地最多几座。整排摆法在切割处一定浪费地，所以另算一个按面积的宽松上界：
  // 两者的差就是我们这套排法还没吃干的余地。对它说话时只说「这一版排到 N 座就是头」，
  // 不说「这块地最多 N 座」——后者我们证不了。
  const cellArea = (2 * oriented.halfX + SET_GAP_M) * (2 * oriented.halfZ + SET_GAP_M);
  const usableArea = Math.max(0, rect.w - 2 * script.constraints.wallGapM)
    * Math.max(0, rect.d - 2 * script.constraints.wallGapM);
  const areaSets = cellArea > 0 ? Math.floor(usableArea / cellArea) : 0;
  const slotCount = seatingSlots(rect, oriented, script, ring).length;
  const upperOf = (alive: number) => Math.max(alive * seatsPerSet, (areaSets - (slotCount - alive)) * seatsPerSet);
  let upper = upperOf(candidates.length);
  if (!candidates.length) {
    deps.ledger('seating').refused += Math.max(1, zone.count ?? script.guests ?? 1);
    deps.refusals.push({
      code: evaluated.blocker.code ?? 'E_ROLE_UNFIT',
      role: 'seating',
      message: `座位区 ${rect.w.toFixed(1)} × ${rect.d.toFixed(1)} m，一组桌椅都放不下${evaluated.blocker.reason ? `：${evaluated.blocker.reason}` : ''}。`,
      hint: '把 seating 区放大，或者把通道/预留区挪出这块地。',
      seats: asked,
      capacity: 0,
    });
    return { passes: 0, converged: false, capacity: 0, upper };
  }

  // 要 80 座而这一版只排得进 24，不是 56 次拒绝，是一句关于这块地的实话。所以先收要价再排位，
  // 缺的那几个人头按「座」单独记一条；人数（guests）仍原样留给卡片去说「座位 24 / 80」。
  const wanted = asked > 0 ? Math.min(candidates.length, Math.ceil(asked / seatsPerSet)) : candidates.length;
  // Settle: a slot that refused once is dropped from the candidate list, not merely asked
  // for less often — shrinking the request while keeping a dead slot in the prefix loops
  // forever on the same wall. Each pass learns one bad slot, so the loop terminates on any
  // script it can honour at all.
  let passes = 0;
  let placed = 0;
  let lastReason: string | undefined;

  const finish = (): SeatingOutcome => {
    const shortfall = Math.max(0, asked - placed * seatsPerSet);
    deps.ledger('seating').placed += placed * measured.count;
    deps.ledger('seating').refused += Math.max(0, wanted - placed) * measured.count;
    if (shortfall > 0) {
      deps.refusals.push({
        code: 'W_CAPACITY',
        role: 'seating',
        message: `按这套排法这块座位区排到 ${ceiling} 座就是头，要 ${asked} 座。`,
        hint: '加宽 seating 区、少占舞台和签到的地，或者换更大的场地。',
        seats: shortfall,
        capacity: ceiling,
      });
    }
    return { passes, converged: true, capacity: ceiling, upper };
  };

  while (passes < MAX_SETTLE_PASSES && candidates.length > 0) {
    passes += 1;
    deps.setCurrent(deps.start);
    const requested = candidates.slice(0, Math.min(wanted, candidates.length));
    const failed: Vec2[] = [];
    placed = 0;
    for (const center of requested) {
      const result = deps.acceptBatch(oriented.build(center));
      if (result.accepted) placed += 1;
      else {
        failed.push(center);
        lastReason = result.reason;
      }
    }
    if (!failed.length) return finish();
    // Drop exactly the slots that just failed: they are permanently dead, everything else is
    // still worth trying on the next pass (the previous pass is rolled back in full first).
    const dead = new Set(failed.map((center) => `${center.x},${center.z}`));
    candidates.splice(0, candidates.length, ...candidates.filter((slot) => !dead.has(`${slot.x},${slot.z}`)));
    ceiling = candidates.length * seatsPerSet;
    upper = upperOf(candidates.length);
    if (passes === MAX_SETTLE_PASSES) {
      deps.ledger('seating').placed += placed * measured.count;
      deps.ledger('seating').refused += Math.max(0, wanted - placed) * measured.count;
      deps.refusals.push({
        code: 'E_SET_BLOCKED',
        role: 'seating',
        message: `座位区试了 ${passes} 遍，还是有 ${wanted - placed} 组摆不进去${lastReason ? `（${lastReason}）` : ''}。`,
        hint: '把 seating 区加宽或挪开障碍物；锁定的物料不参与重排。',
        seats: Math.max(0, asked - placed * seatsPerSet),
        capacity: ceiling,
      });
      return { passes, converged: false, capacity: ceiling, upper };
    }
  }
  deps.ledger('seating').placed += placed * measured.count;
  deps.ledger('seating').refused += Math.max(0, wanted - placed) * measured.count;
  deps.refusals.push({
    code: 'E_SET_BLOCKED',
    role: 'seating',
    message: `座位区里再没有能摆的位置了${lastReason ? `：${lastReason}` : ''}。`,
    hint: '挪开锁定的障碍物，或者把 seating 区放大。',
    seats: Math.max(0, asked - placed * seatsPerSet),
    capacity: ceiling,
  });
  return { passes, converged: false, capacity: ceiling, upper };
}

interface MeasuredSet {
  halfX: number;
  halfZ: number;
  count: number;
  /** Seats one set provides (chairs in the built sample), not `count - 1` guesses. */
  seats: number;
  build: (center: Vec2) => FurnitureItem[];
}

/**
 * The same set turned a quarter turn, centre kept. A long table with chairs at its short
 * ends fits a shallow zone one way and a narrow zone the other, so the compiler keeps both
 * options and picks the one that seats more — deterministically, ties to the unrotated one.
 */
function rotatedVariant(measured: MeasuredSet): MeasuredSet {
  return {
    halfX: measured.halfZ,
    halfZ: measured.halfX,
    count: measured.count,
    seats: measured.seats,
    build: (center) => rotateBatch(measured.build(center), center),
  };
}

/**
 * Rotate a built set 90° about its own centre. Positions and facing must turn together: this
 * grid-code convention has facing = (sin θ, cos θ), so (dx, dz) → (cx − dz, cz + dx) is
 * θ = −π/2, and the rotation added to each item is −π/2 as well. Turning one and not the
 * other put every chair's back to its table (a real bug, caught by review).
 */
function rotateBatch(items: readonly FurnitureItem[], center: Vec2): FurnitureItem[] {
  return items.map((item) => {
    const point = item.position ?? center;
    const dx = point.x - center.x;
    const dz = point.z - center.z;
    return {
      ...item,
      position: { x: center.x - dz, z: center.z + dx },
      rotation: (item.rotation ?? 0) - Math.PI / 2,
    };
  });
}

/** Real footprint of one set around its centre, chairs included. */
function measureSet(set: FurnitureSet, base: RoomLayout, makeId: () => string): MeasuredSet {
  const sample = buildFurnitureSet(set, { center: { x: 0, z: 0 }, roomWidth: base.width, roomDepth: base.height, idPrefix: 'measure' });
  let halfX = 0;
  let halfZ = 0;
  for (const item of sample) {
    const { halfW, halfD } = rotatedHalfExtents({ width: item.width, depth: item.depth, rotation: item.rotation ?? 0 });
    halfX = Math.max(halfX, Math.abs(item.position?.x ?? 0) + halfW);
    halfZ = Math.max(halfZ, Math.abs(item.position?.z ?? 0) + halfD);
  }
  return {
    halfX,
    halfZ,
    count: sample.length,
    seats: seatCountIn(sample),
    build: (center) => buildFurnitureSet(set, { center, roomWidth: base.width, roomDepth: base.height, idPrefix: `seat-${makeId()}` }),
  };
}

/** A chair is a chair; "all items minus the table" was a guess that broke on custom sets. */
function seatCountIn(items: readonly FurnitureItem[]): number {
  return items.filter((item) => item.type === 'chair' || item.type === 'dining-chair').length;
}

/** Rows of desk + chair, measured the same way a dining set is. */
function measurePair(makeId: () => string): MeasuredSet {
  const probe = deskChairPair({ x: 0, z: 0 }, 'measure-pair');
  let halfX = 0;
  let halfZ = 0;
  for (const item of probe) {
    const { halfW, halfD } = rotatedHalfExtents({ width: item.width, depth: item.depth, rotation: item.rotation ?? 0 });
    halfX = Math.max(halfX, Math.abs(item.position?.x ?? 0) + halfW);
    halfZ = Math.max(halfZ, Math.abs(item.position?.z ?? 0) + halfD);
  }
  return { halfX, halfZ, count: probe.length, seats: seatCountIn(probe), build: (center) => deskChairPair(center, `pair-${makeId()}`) };
}

function deskChairPair(center: Vec2, pairId: string): FurnitureItem[] {
  const desk = FURNITURE_CATALOG.find((entry) => entry.type === 'desk');
  const chair = FURNITURE_CATALOG.find((entry) => entry.type === 'chair');
  if (!desk || !chair) return [];
  return [
    { ...desk, id: `${pairId}-desk`, position: { x: center.x, z: center.z - 0.3 }, rotation: 0 },
    { ...chair, id: `${pairId}-chair`, position: { x: center.x, z: center.z + 0.5 }, rotation: Math.PI },
  ];
}

/** Grid of set centres inside a zone, measured from the set's real footprint. */
function seatingSlots(rect: ZoneRect, measured: MeasuredSet, script: SceneScript, ring: boolean): Vec2[] {
  if (!ring) return gridSlots(rect, measured, script.constraints.wallGapM);
  return ringCenters(
    { x: rect.x, z: rect.z, w: rect.w, d: rect.d },
    { halfX: measured.halfX, halfZ: measured.halfZ },
    script.constraints.wallGapM,
    script.constraints.aisleMinM,
  );
}

function gridSlots(rect: ZoneRect, measured: MeasuredSet, wallGap: number): Vec2[] {
  const usableW = rect.w - 2 * wallGap;
  const usableD = rect.d - 2 * wallGap;
  const cellW = 2 * measured.halfX + SET_GAP_M;
  const cellD = 2 * measured.halfZ + SET_GAP_M;
  const cols = Math.max(0, Math.floor((usableW + SET_GAP_M) / cellW));
  const rows = Math.max(0, Math.floor((usableD + SET_GAP_M) / cellD));
  const slots: Vec2[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      slots.push({ x: rect.x + wallGap + measured.halfX + col * cellW, z: rect.z + wallGap + measured.halfZ + row * cellD });
    }
  }
  return slots;
}

function fillBooth(
  script: SceneScript,
  zone: SceneScriptZone,
  deps: {
    stamp: (entry: CatalogItem, position: Vec2, rotation?: number) => FurnitureItem;
    acceptBatch: (items: readonly FurnitureItem[]) => { accepted: boolean; reason?: string };
    refusals: SceneScriptRefusal[];
    ledger: (role: SceneScriptZoneRole) => SceneScriptOp;
  }
): void {
  const piece = EVENT_CATALOG.find((entry) => entry.materialId === 'display');
  if (!piece) return;
  const rect = zoneRectOf(zone);
  const gap = script.constraints.wallGapM;
  const pitch = piece.width + 0.6;
  const fit = Math.max(0, Math.floor((rect.w - 2 * gap + 0.6) / pitch));
  const count = Math.min(zone.count ?? fit, fit);
  for (let index = 0; index < count; index++) {
    const position = { x: rect.x + gap + piece.width / 2 + index * pitch, z: rect.z + gap + piece.depth / 2 };
    const result = deps.acceptBatch([deps.stamp(piece, position, Math.PI)]);
    if (result.accepted) deps.ledger('booth').placed += 1;
    else deps.ledger('booth').refused += 1;
  }
  if (count === 0) {
    deps.ledger('booth').refused += 1;
    deps.refusals.push({ code: 'E_ROLE_UNFIT', role: 'booth', message: '展位区一件展架都放不下。', hint: '把 booth 区加宽到 2 m 以上。' });
  }
}

function fillPlants(
  script: SceneScript,
  zone: SceneScriptZone,
  deps: {
    stamp: (entry: CatalogItem, position: Vec2, rotation?: number) => FurnitureItem;
    acceptBatch: (items: readonly FurnitureItem[]) => { accepted: boolean; reason?: string };
    refusals: SceneScriptRefusal[];
    ledger: (role: SceneScriptZoneRole) => SceneScriptOp;
  }
): void {
  const piece = FURNITURE_CATALOG.find((entry) => entry.type === 'plant');
  if (!piece) return;
  const rect = zoneRectOf(zone);
  const wanted = Math.max(1, zone.count ?? 3);
  const random = mulberry32(script.seed ^ 0x9e3779b9);
  const { halfW, halfD } = rotatedHalfExtents({ width: piece.width, depth: piece.depth, rotation: 0 });
  let placed = 0;
  for (let attempt = 0; attempt < wanted * 6 && placed < wanted; attempt++) {
    const x = rect.x + halfW + random() * Math.max(0, rect.w - 2 * halfW);
    const z = rect.z + halfD + random() * Math.max(0, rect.d - 2 * halfD);
    const result = deps.acceptBatch([deps.stamp(piece, { x, z }, 0)]);
    if (result.accepted) {
      placed += 1;
      deps.ledger('plant').placed += 1;
    }
  }
  deps.ledger('plant').refused += wanted - placed;
  if (placed === 0) {
    deps.refusals.push({ code: 'E_ROLE_UNFIT', role: 'plant', message: '绿植区连一盆都放不下。', hint: '把 plant 区放大到 0.8 m 见方以上。' });
  }
}

function withItems(layout: RoomLayout, floorIndex: number, items: FurnitureItem[]): RoomLayout {
  return { ...layout, floors: layout.floors.map((floor, index) => (index === floorIndex ? { ...floor, items } : floor)) };
}

/** Overlaps counted on the candidate with the editor's own collision rules. */
function countOverlaps(layout: RoomLayout, floorIndex: number): { count: number; names: string[] } {
  const floor = layout.floors[floorIndex];
  if (!floor) return { count: 0, names: [] };
  const keepOut = floorKeepOut(layout, floorIndex);
  const interiorWalls = layout.backendSceneV2 ? [] : floor.interiorWalls;
  const names: string[] = [];
  for (const item of floor.items) {
    if (isStructuralMarker(item) || !item.position) continue;
    const hit = hasCollisions(item, floor.items, layout.width, layout.height, {
      keepOut,
      structureValidated: !!layout.backendSceneV2,
      interiorWalls,
    });
    if (hit) names.push(item.name);
  }
  return { count: names.length, names };
}

/** Tiny seeded PRNG — the same Mulberry32 the outdoor scatters use. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
