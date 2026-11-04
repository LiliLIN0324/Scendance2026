import { z } from 'zod';

/**
 * Scene script: the one declarative artifact a planner (human, rule, or model) writes
 * before anything is placed. It says what each part of the venue is FOR — stage, check-in,
 * seating, aisle, plant — not which chair goes where. A deterministic compiler turns it
 * into placements; a validator refuses it before any of that runs.
 *
 * Why a separate artifact instead of a list of ops: an op list can only be checked by
 * replaying it, and a half-applied op list is a broken room. A script can be read, argued
 * about, diffed and recompiled without touching the canvas — the same reason a score is
 * not a keypress log.
 *
 * Units: metres, room-centred. `rect.x`/`rect.z` is the north-west corner (the same
 * convention as `RoomZone`); `w` grows along +x, `d` grows along +z. z = -depth/2 is north.
 */

export const SCENE_SCRIPT_VERSION = 1;
export const SCENE_SCRIPT_MAX_ZONES = 24;
export const SCENE_SCRIPT_MAX_SEED = 0xffffffff;
export const SCENE_SCRIPT_MAX_GUESTS = 10000;

/**
 * The coordinate convention spelled out, not implied. Every producer (the local brief, a
 * cloud tool, a hand-written fixture) speaks this one; a unit or origin that has to be
 * guessed is how a layout arrives 100× too big.
 */
export const SCENE_SCRIPT_AXES = {
  unit: 'm',
  origin: 'center',
  axis: 'XZ',
  southIsPositiveZ: true,
} as const;

/** What a zone is for. `aisle` and `reserved` place nothing: they keep things out. */
export const sceneScriptZoneRoleSchema = z.enum(['stage', 'checkin', 'seating', 'booth', 'plant', 'aisle', 'reserved']);
export type SceneScriptZoneRole = z.infer<typeof sceneScriptZoneRoleSchema>;

/** The roles that actually get furniture. */
export const SCENE_SCRIPT_BUILD_ROLES = ['stage', 'checkin', 'seating', 'booth', 'plant'] as const;
/** The roles that only carve space out of the others. */
export const SCENE_SCRIPT_KEEP_OUT_ROLES = ['aisle', 'reserved'] as const;

/** A zone's rectangle. Bounded so a mis-signed coordinate can never reach the renderer. */
export const sceneScriptRectSchema = z.strictObject({
  x: z.number().min(-10000).max(10000),
  z: z.number().min(-10000).max(10000),
  w: z.number().positive().max(10000),
  d: z.number().positive().max(10000),
});
export type SceneScriptRect = z.infer<typeof sceneScriptRectSchema>;

export const sceneScriptZoneSchema = z.strictObject({
  role: sceneScriptZoneRoleSchema,
  rect: sceneScriptRectSchema,
  /** How many units this zone should hold (seats for `seating`, pieces for `plant`/`booth`). */
  count: z.number().int().positive().max(SCENE_SCRIPT_MAX_GUESTS).optional(),
  /** Shown as the zone's name in the plan; defaults to a role-derived label. */
  label: z.string().max(40).optional(),
});
export type SceneScriptZone = z.infer<typeof sceneScriptZoneSchema>;

/**
 * The two numbers a script is not allowed to be silent about. A 0.9 m aisle is not a
 * style choice, it is a fire lane; a 0 m wall gap puts chairs inside the wall.
 */
export const sceneScriptConstraintsSchema = z.strictObject({
  aisleMinM: z.number().min(0.6).max(4).default(1.2),
  wallGapM: z.number().min(0).max(2).default(0.35),
});

export const sceneScriptSchema = z.strictObject({
  version: z.literal(SCENE_SCRIPT_VERSION),
  /** Same script + same venue + same seed must compile to the same room. */
  seed: z.number().int().min(0).max(SCENE_SCRIPT_MAX_SEED),
  title: z.string().max(60).optional(),
  guests: z.number().int().positive().max(SCENE_SCRIPT_MAX_GUESTS).optional(),
  layoutMode: z.enum(['dining', 'desk-chair']).default('dining'),
  zones: z.array(sceneScriptZoneSchema).min(1).max(SCENE_SCRIPT_MAX_ZONES),
  constraints: sceneScriptConstraintsSchema.default({ aisleMinM: 1.2, wallGapM: 0.35 }),
});
export type SceneScript = z.infer<typeof sceneScriptSchema>;

/**
 * One vocabulary for refusals, shared by the validator, the compiler and whatever shows
 * the result to a person. A refusal is data, never an exception: "this zone is too small
 * for a backdrop" has to survive the trip back to whoever wrote the script.
 */
export const SCENE_SCRIPT_ISSUE_CODES = [
  /** The document itself is malformed (wrong types, missing fields, unknown keys). */
  'E_SCRIPT_SHAPE',
  /** A zone reached past the venue; it is clamped, and the clamp is reported. */
  'E_ZONE_OUTSIDE',
  /** A zone is thinner than the script's own minimum for its role. */
  'E_ZONE_TOO_SMALL',
  /** Two buildable zones claim the same ground; one of them will not get built. */
  'E_ZONE_OVERLAP',
  /** An aisle or reserved zone is narrower than `aisleMinM`. */
  'W_AISLE_NARROW',
  /** The catalogue has nothing that fits this zone at its role. */
  'E_ROLE_UNFIT',
  /** A piece would stand in an aisle/reserved zone. It is dropped, not moved. */
  'E_KEEP_OUT',
  /** A whole furniture set was refused by geometry; the set is dropped, not split. */
  'E_SET_BLOCKED',
  /** The script asks for more people than the seating zones can hold. */
  'W_CAPACITY',
  /** The compiled room fails the structural gate, so it can never be applied. */
  'E_FINAL_GEOMETRY',
  /** A buildable role was asked for more than once; the first one is used. */
  'W_DUPLICATE_ROLE',
] as const;
export type SceneScriptIssueCode = (typeof SCENE_SCRIPT_ISSUE_CODES)[number];

export const sceneScriptIssueSchema = z.strictObject({
  code: z.enum(SCENE_SCRIPT_ISSUE_CODES),
  severity: z.enum(['error', 'warning']),
  /** Where in the script: `zones[2].rect.w`, `guests`, … Empty for the document itself. */
  path: z.string(),
  /** One sentence a person can act on. */
  message: z.string(),
  /** What to do instead, when there is one obvious fix. */
  hint: z.string().optional(),
});
export type SceneScriptIssue = z.infer<typeof sceneScriptIssueSchema>;

/** Errors stop the compile; warnings are reported and survived. */
export function sceneScriptIssuesHaveError(issues: readonly SceneScriptIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
