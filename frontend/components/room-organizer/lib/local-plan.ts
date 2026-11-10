import { HEADCOUNT_MAX } from './workbench-agent';
import { proposePlan, type PlanProposal } from './agent-proposal';
import { sceneScriptFromBrief } from './scene-script';
import { compileSceneScript, type SceneScriptCompileResult } from './scene-script-compiler';
import { itemsOverlap, isLowProfile } from './geometry';
import { checkRequiredSeats, checkRestArea, countSingleSeats } from './seat-requirement';
import { isStructuralMarker, structuralItemCollides, usableFloorPolygon, usableSeatingRect } from './structural-layout';
import { proposeRestArea } from './rest-area-plan';
import { proposeStagePlatform } from './stage-platform-plan';
import { checkFunctionalRequirements, type FunctionalNeeds } from './functional-requirements';
import { materializeFurnishing, type FurnishingChoice, type MaterializedFurnishing } from './furnishing-select';
import { resolveTableArrangement, type TableArrangement } from './table-seat-plan';
import type { FurnitureItem, RoomLayout } from './types';

/**
 * The local generation door. One call, two implementations behind it:
 *
 * - the scene-script path: brief → declarative plan → deterministic compiler (the
 *   plan-then-build discipline), and
 * - the original slot heuristic in `proposePlan`, kept as the fallback for the geometry
 *   the compiler refuses (a preset shell, a locked item through the seating grid, a venue
 *   too small for any zone).
 *
 * Both return the same `PlanProposal`, so the preview, the confirm button and the undo
 * step never learn which one ran. Callers that care can read `via`.
 */

export interface LocalPlanInput {
  base: RoomLayout;
  floorIndex: number;
  widthM: number;
  depthM: number;
  /** 换一版：同一份需求换一个 seed，槽位顺序变，可行域不变。 */
  variant: number;
  guests?: number | null;
  /** 用户明确要求全部入座时，未达到人数的候选不能确认。 */
  requireSeats?: boolean;
  requireRest?: boolean;
  mobilityRequired?: boolean;
  mobilityEvidence?: string;
  /** 用户确认的功能要求，不能用生成开关的默认值替代。 */
  functionalNeeds?: FunctionalNeeds;
  seatPriority?: boolean;
  layoutMode?: 'dining' | 'desk-chair';
  /** ring = round tables on a loop. Omitted keeps the existing dining grid. */
  seatingShape?: 'ring' | 'grid';
  /**
   * Table size or people-per-table from the brief. Absent on a ring brief
   * still resolves the default diameter; the compiler does not invent a count.
   */
  table?: { shape?: 'round' | 'rect'; width?: number | null; depth?: number | null; peoplePerTable?: number | null };
  /** Selection-tool result. The layout materializes this asset and does not choose another. */
  furnishing?: FurnishingChoice;
  stage?: boolean;
  checkin?: boolean;
  /** Omit the front keep-out when a banquet cannot seat the asked headcount. */
  aisle?: boolean;
}

export interface LocalPlanResult extends PlanProposal {
  /** Which door produced this version. The UI does not need it; tests and logs do. */
  via: 'script' | 'fallback';
  /** Why the script door was skipped, when it was. */
  fallbackReason?: string;
  /** The plan read back in words, when the script door ran. */
  summary?: string[];
  /** The add-seats pass could not place another whole table in the usable interior. */
  interiorFull?: boolean;
}

export function localPlan(input: LocalPlanInput): LocalPlanResult {
  if (!Number.isSafeInteger(input.guests) || !input.guests || input.guests < 1 || input.guests > HEADCOUNT_MAX) return {layouts:[input.base],added:0,removing:0,keptLocked:0,dropped:0,overlapCount:0,overlapNames:[],blocked:'请先说明本场预计人数，再生成布置方案。',guests:null,via:'fallback'};
  let result = buildLocalPlan(input);
  const issues = result.blocked ? [result.blocked] : [];
  const candidate = result.layouts.at(-1);
  let restFailure = false;
  if (input.requireRest && candidate && !result.blocked && checkRestArea(candidate, input.floorIndex, true).status === 'unknown') {
    const restCandidate = proposeRestArea(candidate, input.floorIndex);
    if (!restCandidate.ok) { issues.push(restCandidate.reason); restFailure = true; }
    else result = { ...result, layouts: [...result.layouts, restCandidate.layout], added: result.added + 1,
      summary: [...(result.summary ?? []), '新增休息区与示意长椅；出入口、通行和物料库存仍需核对，休息区标注的云端保存尚未确认'] };
  }
  if (input.functionalNeeds?.stage === true && !result.blocked &&
      checkFunctionalRequirements(result.layouts.at(-1), input.floorIndex, { checkin: null, stage: true })[1]?.status === 'unknown') {
    const current = result.layouts.at(-1);
    const stage = current && proposeStagePlatform(current, input.floorIndex);
    if (!stage || !stage.ok) issues.push(stage?.reason ?? '无法读取楼层，舞台位置待核对。');
    else result = { ...result, layouts: [...result.layouts, stage.layout], added: result.added + 1,
      summary: [...(result.summary ?? []), '新增舞台平台示意模块；尺寸与公共模型一致，场地许可、库存、通行及消防仍需核对。'] };
  }
  const check = checkRequiredSeats(result.layouts.at(-1), input.floorIndex, input.guests, input.requireSeats === true);
  if (check.status === 'unknown' && check.message) issues.push(check.message);
  const rest = checkRestArea(result.layouts.at(-1), input.floorIndex, input.requireRest === true);
  if (rest.status === 'unknown' && rest.message && !restFailure) issues.push(rest.message);
  if(input.mobilityRequired)result={...result,summary:[...(result.summary??[]),`已记录轮椅或行动辅助通行需求${input.mobilityEvidence?`（用户原话：${input.mobilityEvidence}）`:''}；现场通行与无障碍条件待核验，不代表合规通过`]};
  const needs = input.functionalNeeds ?? { checkin: null, stage: null };
  const functional = checkFunctionalRequirements(result.layouts.at(-1), input.floorIndex, needs);
  issues.push(...functional.filter(item => item.status === 'unknown' && needs[item.kind] !== null).map(item => item.message));
  const unresolved = functional.filter(item => needs[item.kind] === null).map(item => item.message);
  if (unresolved.length) result = { ...result, summary: [...(result.summary ?? []), ...unresolved] };
  const actualSeats = countSingleSeats(result.layouts.at(-1), input.floorIndex);
  if (actualSeats !== null) result = { ...result, seats: actualSeats,
    ...(result.summary ? { summary: result.summary.map(line => /^座位\s/.test(line)
      ? `${line.split('，')[0]}，候选共识别 ${actualSeats} 把单人椅` : line) } : {}) };
  result = banquetLandedSeats(input, result);
  return issues.length ? { ...result, blocked: result.blocked ?? [...new Set(issues)].join('；') } : result;
}

/**
 * Chairs and tables this pass that never cleared the usable interior stay out of the
 * preview. A wall-grazing or out-of-shell footprint is drawn as a dashed outline and
 * must not be counted as a landed seat. Chairs already in the room do not fill the headcount.
 */
/** A chair box that merely misses the wall volume can still sit in the wall the eye sees. */
const WALL_FACE_MARGIN_M = 0.1;

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const length = dx * dx + dz * dz;
  const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / length)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

function grazesWall(item: FurnitureItem, layout: RoomLayout, floorIndex: number): boolean {
  if (!item.position) return false;
  const walls = layout.floors[floorIndex]?.interiorWalls ?? [];
  if (!walls.length) return false;
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const halfW = item.width / 2, halfD = item.depth / 2;
  const cx = item.position.x + layout.width / 2;
  const cz = item.position.z + layout.height / 2;
  const corners = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]].map(([x, z]) => ({
    x: cx + x * cos - z * sin,
    z: cz + x * sin + z * cos,
  }));
  for (const wall of walls) {
    const limit = (wall.thickness ?? 0.16) / 2 + WALL_FACE_MARGIN_M;
    const ax = wall.x1 + layout.width / 2, az = wall.z1 + layout.height / 2;
    const bx = wall.x2 + layout.width / 2, bz = wall.z2 + layout.height / 2;
    if (corners.some(corner => distanceToSegment(corner.x, corner.z, ax, az, bx, bz) < limit)) return true;
  }
  return false;
}

function pointInRing(x: number, z: number, poly: readonly { x: number; z: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    const onEdge = Math.abs((b.x - a.x) * (z - a.z) - (x - a.x) * (b.z - a.z)) <= 1e-6
      && x >= Math.min(a.x, b.x) - 1e-6 && x <= Math.max(a.x, b.x) + 1e-6
      && z >= Math.min(a.z, b.z) - 1e-6 && z <= Math.max(a.z, b.z) + 1e-6;
    if (onEdge) return true;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

/** Outside the drawn floor, or in the last 12 cm of it, the mesh reads as an outline. */
function missesUsableFloor(item: FurnitureItem, layout: RoomLayout, floorIndex: number): boolean {
  const poly = usableFloorPolygon(layout, floorIndex);
  if (!poly || !item.position) return false;
  const rotation = item.rotation ?? 0;
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const halfW = item.width / 2, halfD = item.depth / 2;
  const cx = item.position.x + layout.width / 2;
  const cz = item.position.z + layout.height / 2;
  const corners = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]].map(([x, z]) => ({
    x: cx + x * cos - z * sin,
    z: cz + x * sin + z * cos,
  }));
  const margin = 0.12;
  for (const corner of corners) {
    if (!pointInRing(corner.x, corner.z, poly)) return true;
    for (let index = 0; index < poly.length; index++) {
      const a = poly[index]!, b = poly[(index + 1) % poly.length]!;
      if (distanceToSegment(corner.x, corner.z, a.x, a.z, b.x, b.z) < margin) return true;
    }
  }
  return false;
}

function isBanquetSeat(item: FurnitureItem): boolean {
  return item.type === 'dining-chair' || item.type === 'chair' || item.type === 'desk-chair';
}

export function omitUnlandedBanquetItems(layout: RoomLayout, floorIndex: number, baseIds: ReadonlySet<string>): RoomLayout {
  const floor = layout.floors[floorIndex];
  if (!floor) return layout;
  const kept: FurnitureItem[] = [];
  const pendingSeats: FurnitureItem[] = [];
  for (const item of floor.items) {
    if (baseIds.has(item.id) || isStructuralMarker(item)) { kept.push(item); continue; }
    const seat = isBanquetSeat(item);
    const table = item.type === 'dining-table';
    if (!seat && !table) { kept.push(item); continue; }
    if (structuralItemCollides(item, layout, floorIndex) || grazesWall(item, layout, floorIndex) || missesUsableFloor(item, layout, floorIndex)) continue;
    if (seat) pendingSeats.push(item);
    else kept.push(item);
  }
  for (const item of pendingSeats) {
    if (kept.some(other => other.position && !isLowProfile(other) && itemsOverlap(item, other))) continue;
    kept.push(item);
  }
  const seated = kept.filter(item => isBanquetSeat(item) && item.position);
  const lonely = new Set(kept.filter(item => item.type === 'dining-table' && !baseIds.has(item.id) && item.position && !seated.some(chair => Math.hypot(chair.position!.x - item.position!.x, chair.position!.z - item.position!.z) < item.width + 0.8)).map(item => item.id));
  const items = lonely.size ? kept.filter(item => !lonely.has(item.id)) : kept;
  if (items.length === floor.items.length) return layout;
  return { ...layout, floors: layout.floors.map((entry, index) => index === floorIndex ? { ...entry, items } : entry) };
}

function landedChairCount(layout: RoomLayout | undefined, floorIndex: number, baseIds: ReadonlySet<string>): number {
  const cleaned = layout ? omitUnlandedBanquetItems(layout, floorIndex, baseIds) : undefined;
  return cleaned?.floors[floorIndex]?.items.filter(item => isBanquetSeat(item) && !baseIds.has(item.id)).length ?? 0;
}

/** Same door a later 「换成 ØX」 preview uses: script first, then the card's own fallback. */
function previewAtDiameter(input: LocalPlanInput, diameter: number): LocalPlanResult | null {
  const choice = input.furnishing;
  if (!choice || choice.shape !== 'round') return null;
  const nextChoice = { ...choice, width: diameter, depth: diameter };
  if (!materializeFurnishing(nextChoice)) return null;
  return buildLocalPlan({
    ...input,
    furnishing: nextChoice,
    table: { ...(input.table ?? {}), shape: 'round', width: diameter, depth: diameter },
    seatPriority: false,
  });
}

/** A smaller round table, quoted only at the seat count that door would actually land. */
function probeSmallerRound(input: LocalPlanInput, current: number): { diameter: number; seats: number } | null {
  const choice = input.furnishing;
  if (!choice || choice.shape !== 'round' || !(choice.width > 1.2)) return null;
  const baseIds = new Set((input.base.floors[input.floorIndex]?.items ?? []).map(item => item.id));
  let best: { diameter: number; seats: number } | null = null;
  for (const diameter of [2, 1.8, 1.6, 1.4, 1.2]) {
    if (diameter >= choice.width - 0.05) continue;
    const preview = previewAtDiameter(input, diameter);
    const seats = landedChairCount(preview?.layouts.at(-1), input.floorIndex, baseIds);
    if (seats > current && (!best || seats > best.seats)) best = { diameter, seats };
  }
  return best;
}

function banquetLandedSeats(input: LocalPlanInput, result: LocalPlanResult): LocalPlanResult {
  const guests = input.guests ?? 0;
  if (!input.furnishing || guests <= 0) return result;
  const baseItems = input.base.floors[input.floorIndex]?.items ?? [];
  const baseIds = new Set(baseItems.map(item => item.id));
  const layouts = result.layouts.map(layout => omitUnlandedBanquetItems(layout, input.floorIndex, baseIds));
  const landed = landedChairCount(layouts.at(-1), input.floorIndex, baseIds);
  const next = { ...result, layouts, seats: landed };
  if (landed >= guests) return next;
  const candidate = layouts.at(-1);
  const floor = candidate?.floors[input.floorIndex];
  const tables = floor?.items.filter(item => item.type === 'dining-table' && !item.structuralColumnId && !baseIds.has(item.id)).length ?? 0;
  const width = input.furnishing.shape === 'round' ? input.furnishing.width : undefined;
  const alternative = probeSmallerRound(input, landed);
  const capacity = width
    ? `这间厅按 Ø${width.toFixed(2)} 米这版坐下 ${landed} 人${alternative ? `。换成 Ø${alternative.diameter.toFixed(2)} 米，同一间室内可以落下 ${alternative.seats} 座` : ''}`
    : `这间厅按这版桌型最多坐下 ${landed} 人`;
  const placed = `放下 ${tables} 桌、${landed} 座，离 ${guests} 人还差 ${guests - landed}。没有按满员桌数确认。`;
  const short = result.interiorFull
    ? `室内已经排满，这版加不进更多整桌。${capacity}。${placed}`
    : `${capacity}。${placed}`;
  return { ...next, blocked: short, summary: [short] };
}

function arrangementFor(input: LocalPlanInput): TableArrangement | undefined {
  if (input.layoutMode === 'desk-chair') return undefined;
  const shape = input.table?.shape ?? (input.seatingShape === 'ring' ? 'round' : undefined);
  if (!shape) return undefined;
  return resolveTableArrangement({
    shape,
    ...(input.guests !== undefined ? { guests: input.guests } : {}),
    ...(input.table?.width !== undefined ? { width: input.table.width } : {}),
    ...(input.table?.depth !== undefined ? { depth: input.table.depth } : {}),
    ...(input.table?.peoplePerTable !== undefined ? { peoplePerTable: input.table.peoplePerTable } : {}),
  });
}

function withArrangement<T extends PlanProposal>(result: T, arrangement: TableArrangement | undefined): T {
  if (!arrangement) return result;
  const previous = 'summary' in result && Array.isArray(result.summary) ? result.summary : [];
  return { ...result, summary: [arrangement.explanation, ...previous] };
}

function landedSeatScore(input: LocalPlanInput, proposal: { layouts: RoomLayout[]; seats?: number | null }): number {
  if (!input.furnishing) return proposal.seats ?? 0;
  const baseIds = new Set((input.base.floors[input.floorIndex]?.items ?? []).map(item => item.id));
  return landedChairCount(proposal.layouts.at(-1), input.floorIndex, baseIds);
}

function buildLocalPlan(input: LocalPlanInput): LocalPlanResult {
  const placed = input.furnishing ? materializeFurnishing(input.furnishing) ?? undefined : undefined;
  if (input.furnishing && !placed) {
    return { layouts: [input.base], added: 0, removing: 0, keptLocked: 0, dropped: 0, overlapCount: 0, overlapNames: [], blocked: '没有选中可用的桌椅，这版没有摆。', guests: input.guests ?? null, via: 'fallback' };
  }
  const arrangement = arrangementFor(input);
  const scriptPlan = scriptAttempt(input, arrangement, placed);
  const seated = (input.guests ?? 0) > 0;

  if (scriptPlan && !scriptPlan.blocked) {
    const scriptWrappedEarly = withArrangement({ ...scriptPlan, via: 'script' as const, summary: scriptPlan.summary }, arrangement);
    const seats = landedSeatScore(input, scriptWrappedEarly);
    // "加座，再排一版" replans on a tighter grid inside the same interior. Keep the
    // pass that lands more real seats, not the one whose raw chair count is higher.
    if (input.seatPriority && input.guests) {
      const fill = scriptAttempt({ ...input, guests: null, aisle: false }, arrangement, placed);
      const dense = fallbackPlan(input, arrangement, placed);
      const options = [
        { via: 'script' as const, proposal: scriptWrappedEarly },
        fill && !fill.blocked ? { via: 'script' as const, proposal: withArrangement(fill, arrangement) } : null,
        dense.blocked ? null : { via: 'fallback' as const, proposal: withArrangement(dense, arrangement) },
      ].flatMap(entry => entry ? [entry] : [])
        .sort((left, right) => landedSeatScore(input, right.proposal) - landedSeatScore(input, left.proposal));
      const best = options[0];
      const bestSeats = best ? landedSeatScore(input, best.proposal) : seats;
      if (best && bestSeats > seats) {
        const chosen: LocalPlanResult = best.via === 'script'
          ? { ...best.proposal, via: 'script', summary: best.proposal.summary ?? [], guests: input.guests, seatPriority: true }
          : { ...best.proposal, via: 'fallback', fallbackReason: `脚本这一版只排到 ${seats} 座，改用了更密的排法。`, guests: input.guests, seatPriority: true };
        if (input.furnishing && bestSeats < input.guests) return recoverBanquetSeats(input, arrangement, placed, chosen);
        return chosen;
      }
      if (input.furnishing) return { ...recoverBanquetSeats(input, arrangement, placed, { ...scriptWrappedEarly, seatPriority: true }), interiorFull: true, seatPriority: true };
    }
    // A script that seats nobody while people were asked for is a worse answer than the
    // slot heuristic's. Compare instead of assuming the newer door is always better: a room
    // too shallow for a table set (8 × 6 with a stage) still deserves chairs.
    if (seated && seats === 0 && !input.furnishing) {
      const heuristic = fallbackPlan(input, arrangement, placed);
      if ((heuristic.seats ?? 0) > 0) {
        return { ...heuristic, via: 'fallback', fallbackReason: '脚本这一版一个座位都没排出来，改用了原来的摆放方式。' };
      }
    }
    const scriptWrapped = withArrangement({ ...scriptPlan, via: 'script' as const, summary: scriptPlan.summary }, arrangement);
    if (input.furnishing && seated && landedSeatScore(input, scriptWrapped) < (input.guests ?? 0)) {
      return recoverBanquetSeats(input, arrangement, placed, scriptWrapped);
    }
    return scriptWrapped;
  }

  const fallback = withArrangement({
    ...fallbackPlan(input, arrangement, placed),
    via: 'fallback' as const,
    summary: [] as string[],
    ...(scriptPlan?.blocked ? { fallbackReason: scriptPlan.blocked } : {}),
  }, arrangement);
  if (input.furnishing && seated && (fallback.seats ?? 0) < (input.guests ?? 0)) {
    return recoverBanquetSeats(input, arrangement, placed, fallback);
  }
  return fallback;
}

/** The original slot heuristic, kept whole behind one name. */
function fallbackPlan(input: LocalPlanInput, arrangement?: TableArrangement, placed?: MaterializedFurnishing): PlanProposal {
  return proposePlan({
    base: input.base,
    floorIndex: input.floorIndex,
    widthM: input.widthM,
    depthM: input.depthM,
    variant: input.variant,
    guests: input.guests ?? null,
    ...(input.seatPriority !== undefined ? { seatPriority: input.seatPriority } : {}),
    ...(input.layoutMode ? { layoutMode: input.layoutMode } : {}),
    ...(input.seatingShape === 'ring' ? { seatingShape: 'ring' as const } : {}),
    ...(arrangement ? { tablePlan: arrangement } : {}),
    ...(placed ? { furnishing: placed } : {}),
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    ...(input.checkin !== undefined ? { checkin: input.checkin } : {}),
  });
}

/** The script door, isolated so a compiler refusal can never take down generation. */
function recoverBanquetSeats(
  input: LocalPlanInput,
  arrangement: TableArrangement | undefined,
  placed: MaterializedFurnishing | undefined,
  current: LocalPlanResult,
): LocalPlanResult {
  const guests = input.guests ?? 0;
  const opened = input.aisle === false ? null : scriptAttempt({ ...input, aisle: false }, arrangement, placed);
  const heuristic = fallbackPlan(input, arrangement, placed);
  const options: LocalPlanResult[] = [
    current,
    opened && !opened.blocked ? withArrangement({ ...opened, via: 'script' as const, summary: opened.summary }, arrangement) : null,
    heuristic.blocked ? null : withArrangement({ ...heuristic, via: 'fallback' as const, summary: [] }, arrangement),
  ].flatMap(entry => entry ? [entry] : []);
  options.sort((left, right) => landedSeatScore(input, right) - landedSeatScore(input, left));
  const best = options[0] ?? current;
  const seats = landedSeatScore(input, best);
  if (seats >= guests) {
    return best.via === 'script' && best !== current
      ? { ...best, fallbackReason: '前侧预留带放不下这些圆桌，改用了整间场地。' }
      : best;
  }
  const tables = best.layouts.at(-1)?.floors[input.floorIndex]?.items.filter(item => item.type === 'dining-table').length ?? 0;
  const short = `这版放下 ${tables} 桌、${seats} 座，离 ${guests} 人还差 ${guests - seats}。没有按满员桌数确认。可以说小一号的圆桌，或说「加座，再排一版」。`;
  return { ...best, blocked: short, summary: [short] };
}

function scriptAttempt(input: LocalPlanInput, arrangement?: TableArrangement, placed?: MaterializedFurnishing): SceneScriptCompileResult | null {
  try {
    const floor = usableSeatingRect(input.base, input.floorIndex);
    const script = sceneScriptFromBrief({
      widthM: input.widthM,
      depthM: input.depthM,
      guests: input.guests ?? null,
      ...(input.layoutMode ? { layoutMode: input.layoutMode } : {}),
      stage: input.stage ?? true,
      checkin: input.checkin ?? false,
      seed: input.variant >>> 0,
      ...(floor ? { floor } : {}),
      // A tighter shell is already the room. A front aisle on that small floor
      // leaves one lucky table and throws the rest of the interior away.
      ...(input.aisle === false || (floor && input.stage !== true) ? { aisle: false } : {}),
    });
    return compileSceneScript(script, {
      base: input.base,
      floorIndex: input.floorIndex,
      ...(input.seatingShape === 'ring' && arrangement?.shape !== 'rect' ? { seatingShape: 'ring' as const } : {}),
      ...(arrangement ? { tablePlan: arrangement } : {}),
      ...(placed ? { furnishing: placed } : {}),
    });
  } catch {
    return null;
  }
}
