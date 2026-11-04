import { proposePlan, type PlanProposal } from './agent-proposal';
import { sceneScriptFromBrief } from './scene-script';
import { compileSceneScript, type SceneScriptCompileResult } from './scene-script-compiler';
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
  seatPriority?: boolean;
  layoutMode?: 'dining' | 'desk-chair';
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
  const scriptPlan = scriptAttempt(input);
  const seated = (input.guests ?? 0) > 0;

  if (scriptPlan && !scriptPlan.blocked) {
    const seats = scriptPlan.seats ?? 0;
    // "加座，再排一版" has to actually re-plan, and it has to be able to seat more. The script
    // door tops out at one row of whole sets (filling the zone with guests:null changes nothing
    // once the ask already exceeded the probed ceiling), while the original arrangement gets
    // denser. Run both, keep the one that seats more: a button that cannot change the result
    // must not be offered.
    if (input.seatPriority && input.guests) {
      const fill = scriptAttempt({ ...input, guests: null });
      const dense = fallbackPlan(input);
      const options = [
        fill && !fill.blocked ? { via: 'script' as const, proposal: fill as PlanProposal } : null,
        dense.blocked ? null : { via: 'fallback' as const, proposal: dense },
      ].filter((entry): entry is { via: 'script' | 'fallback'; proposal: PlanProposal } => !!entry)
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
      const heuristic = fallbackPlan(input);
      if ((heuristic.seats ?? 0) > 0) {
        return { ...heuristic, via: 'fallback', fallbackReason: '脚本这一版一个座位都没排出来，改用了原来的摆放方式。' };
      }
    }
    return { ...scriptPlan, via: 'script', summary: scriptPlan.summary };
  }

  const fallback = fallbackPlan(input);
  return {
    ...fallback,
    via: 'fallback',
    ...(scriptPlan?.blocked ? { fallbackReason: scriptPlan.blocked } : {}),
  };
}

/** The original slot heuristic, kept whole behind one name. */
function fallbackPlan(input: LocalPlanInput): PlanProposal {
  return proposePlan({
    base: input.base,
    floorIndex: input.floorIndex,
    widthM: input.widthM,
    depthM: input.depthM,
    variant: input.variant,
    guests: input.guests ?? null,
    ...(input.seatPriority !== undefined ? { seatPriority: input.seatPriority } : {}),
    ...(input.layoutMode ? { layoutMode: input.layoutMode } : {}),
    ...(input.stage !== undefined ? { stage: input.stage } : {}),
    ...(input.checkin !== undefined ? { checkin: input.checkin } : {}),
  });
}

/** The script door, isolated so a compiler refusal can never take down generation. */
function scriptAttempt(input: LocalPlanInput): SceneScriptCompileResult | null {
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
    return compileSceneScript(script, { base: input.base, floorIndex: input.floorIndex });
  } catch {
    return null;
  }
}
