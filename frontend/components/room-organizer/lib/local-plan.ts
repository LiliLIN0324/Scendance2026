import { HEADCOUNT_MAX } from './workbench-agent';
import { proposePlan, type PlanProposal } from './agent-proposal';
import { sceneScriptFromBrief } from './scene-script';
import { compileSceneScript, type SceneScriptCompileResult } from './scene-script-compiler';
import { checkRequiredSeats, checkRestArea, countSingleSeats } from './seat-requirement';
import { proposeRestArea } from './rest-area-plan';
import { proposeStagePlatform } from './stage-platform-plan';
import { checkFunctionalRequirements, type FunctionalNeeds } from './functional-requirements';
import { materializeFurnishing, type FurnishingChoice, type MaterializedFurnishing } from './furnishing-select';
import { resolveTableArrangement, type TableArrangement } from './table-seat-plan';
import type { RoomLayout } from './types';

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
}

export interface LocalPlanResult extends PlanProposal {
  /** Which door produced this version. The UI does not need it; tests and logs do. */
  via: 'script' | 'fallback';
  /** Why the script door was skipped, when it was. */
  fallbackReason?: string;
  /** The plan read back in words, when the script door ran. */
  summary?: string[];
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
  return issues.length ? { ...result, blocked: [...new Set(issues)].join('；') } : result;
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

function buildLocalPlan(input: LocalPlanInput): LocalPlanResult {
  const placed = input.furnishing ? materializeFurnishing(input.furnishing) ?? undefined : undefined;
  if (input.furnishing && !placed) {
    return { layouts: [input.base], added: 0, removing: 0, keptLocked: 0, dropped: 0, overlapCount: 0, overlapNames: [], blocked: '没有选中可用的桌椅，这版没有摆。', guests: input.guests ?? null, via: 'fallback' };
  }
  const arrangement = arrangementFor(input);
  const scriptPlan = scriptAttempt(input, arrangement, placed);
  const seated = (input.guests ?? 0) > 0;

  if (scriptPlan && !scriptPlan.blocked) {
    const seats = scriptPlan.seats ?? 0;
    // "加座，再排一版" has to actually re-plan, and it has to be able to seat more. The script
    // door tops out at one row of whole sets (filling the zone with guests:null changes nothing
    // once the ask already exceeded the probed ceiling), while the original arrangement gets
    // denser. Run both, keep the one that seats more: a button that cannot change the result
    // must not be offered.
    if (input.seatPriority && input.guests) {
      const fill = scriptAttempt({ ...input, guests: null }, arrangement, placed);
      const dense = fallbackPlan(input, arrangement, placed);
      const options = [
        fill && !fill.blocked ? { via: 'script' as const, proposal: withArrangement(fill, arrangement) } : null,
        dense.blocked ? null : { via: 'fallback' as const, proposal: withArrangement(dense, arrangement) },
      ].flatMap(entry => entry ? [entry] : [])
        .sort((left, right) => (right.proposal.seats ?? 0) - (left.proposal.seats ?? 0));
      const best = options[0];
      if (best && (best.proposal.seats ?? 0) > seats) {
        return best.via === 'script'
          ? { ...best.proposal, via: 'script', summary: fill!.summary, guests: input.guests }
          : { ...best.proposal, via: 'fallback', fallbackReason: `脚本这一版只排到 ${seats} 座，改用了更密的排法。`, guests: input.guests };
      }
    }
    // A script that seats nobody while people were asked for is a worse answer than the
    // slot heuristic's. Compare instead of assuming the newer door is always better: a room
    // too shallow for a table set (8 × 6 with a stage) still deserves chairs.
    if (seated && seats === 0) {
      const heuristic = fallbackPlan(input, arrangement, placed);
      if ((heuristic.seats ?? 0) > 0) {
        return { ...heuristic, via: 'fallback', fallbackReason: '脚本这一版一个座位都没排出来，改用了原来的摆放方式。' };
      }
    }
    return withArrangement({ ...scriptPlan, via: 'script', summary: scriptPlan.summary }, arrangement);
  }

  const fallback = fallbackPlan(input, arrangement, placed);
  return withArrangement({
    ...fallback,
    via: 'fallback',
    ...(scriptPlan?.blocked ? { fallbackReason: scriptPlan.blocked } : {}),
  }, arrangement);
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
function scriptAttempt(input: LocalPlanInput, arrangement?: TableArrangement, placed?: MaterializedFurnishing): SceneScriptCompileResult | null {
  try {
    const script = sceneScriptFromBrief({
      widthM: input.widthM,
      depthM: input.depthM,
      guests: input.guests ?? null,
      ...(input.layoutMode ? { layoutMode: input.layoutMode } : {}),
      stage: input.stage ?? true,
      checkin: input.checkin ?? false,
      seed: input.variant >>> 0,
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
