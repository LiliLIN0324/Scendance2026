import {
  SCENE_SCRIPT_ISSUE_CODES,
  sceneScriptSchema,
  type SceneScript,
  type SceneScriptIssue,
  type SceneScriptZone,
  type SceneScriptZoneRole,
} from '../../../../supabase/functions/_shared/scene-script-contract';
import { clampZoneRect, MIN_ZONE_SIZE, zoneArea, type ZoneRect } from './zones';

/**
 * The script layer between "what the event needs" and "which chair goes where".
 *
 * A plan written as a script can be read, argued with and recompiled without touching
 * the canvas. Nothing here places anything: `parseSceneScript` refuses shapes that cannot
 * be read, `normalizeSceneScript` fits zones to the venue, `validateSceneScript` says what
 * will not work, and `sceneScriptFromBrief` derives a first script from what the person
 * already told us. Compiling lives in `scene-script-compiler.ts`.
 *
 * Units are metres, room-centred (x = 0 at the west wall, z = 0 at the north wall of the
 * venue's middle). z grows south — the same convention `RoomZone` and the 2D plan use.
 */

export interface SceneScriptVenue {
  /** RoomLayout.width — the x extent, in metres. */
  width: number;
  /** RoomLayout.height — the z extent, in metres. */
  depth: number;
}

export interface ParsedSceneScript {
  ok: boolean;
  script?: SceneScript;
  issues: SceneScriptIssue[];
}

function issue(
  code: (typeof SCENE_SCRIPT_ISSUE_CODES)[number],
  severity: 'error' | 'warning',
  path: string,
  message: string,
  hint?: string
): SceneScriptIssue {
  return hint ? { code, severity, path, message, hint } : { code, severity, path, message };
}

/**
 * Read a script from untrusted input (a model's JSON, a saved draft, a paste). A refusal
 * is a list of issues, never a throw: whoever wrote the script has to be able to fix it.
 */
export function parseSceneScript(raw: unknown): ParsedSceneScript {
  const parsed = sceneScriptSchema.safeParse(raw);
  if (parsed.success) return { ok: true, script: parsed.data, issues: [] };
  const issues = parsed.error.issues.map((problem) =>
    issue(
      'E_SCRIPT_SHAPE',
      'error',
      problem.path.join('.'),
      problem.message,
      '只认 { version: 1, seed, layoutMode?, guests?, zones: [{ role, rect: {x,z,w,d} }], constraints? } 这个形状，字段名不要自创。'
    )
  );
  return { ok: false, issues };
}

export function zoneRectOf(zone: SceneScriptZone): ZoneRect {
  return { x: zone.rect.x, z: zone.rect.z, w: zone.rect.w, d: zone.rect.d };
}

/** The zones that place nothing and exist only to keep furniture out of a piece of floor. */
export function keepOutZones(script: SceneScript): SceneScriptZone[] {
  return script.zones.filter((zone) => zone.role === 'aisle' || zone.role === 'reserved');
}

export function zonesWithRole(script: SceneScript, role: SceneScriptZoneRole): SceneScriptZone[] {
  return script.zones.filter((zone) => zone.role === role);
}

/**
 * Fit every zone to the venue and drop the ones that cannot be a zone at all. Clamping is
 * reported as a warning rather than refused: a script that says "stage, the whole north
 * wall" is a reasonable thing to write, and the venue is what actually decides.
 */
export function normalizeSceneScript(
  script: SceneScript,
  venue: SceneScriptVenue
): { script: SceneScript; issues: SceneScriptIssue[] } {
  const issues: SceneScriptIssue[] = [];
  const zones: SceneScriptZone[] = [];
  script.zones.forEach((zone, index) => {
    const clamped = clampZoneRect(zoneRectOf(zone), venue.width, venue.depth);
    if (!clamped) {
      issues.push(
        issue(
          'E_ZONE_TOO_SMALL',
          'error',
          `zones[${index}].rect`,
          `${zone.role} 区落在场地外面，或者窄过 ${MIN_ZONE_SIZE} m，立不起来。`,
          '把 rect 挪回场地内，至少留 0.3 m。'
        )
      );
      return;
    }
    const moved = clamped.x !== zone.rect.x || clamped.z !== zone.rect.z || clamped.w !== zone.rect.w || clamped.d !== zone.rect.d;
    // `clampZoneRect` also snaps corners to the 0.1 m editing grid, which changes numbers
    // without anything leaving the venue. Only a rect that really crosses an edge is worth a
    // warning — otherwise every generated plan carries five false alarms.
    const halfW = venue.width / 2;
    const halfD = venue.depth / 2;
    const outside =
      zone.rect.x < -halfW - 1e-6 ||
      zone.rect.z < -halfD - 1e-6 ||
      zone.rect.x + zone.rect.w > halfW + 1e-6 ||
      zone.rect.z + zone.rect.d > halfD + 1e-6;
    if (moved && outside) {
      issues.push(
        issue(
          'E_ZONE_OUTSIDE',
          'warning',
          `zones[${index}].rect`,
          `${zone.role} 区有一部分在场地外，已收进 ${venue.width} × ${venue.depth} m 里。`,
          '按场地实际尺寸改 rect，就不用每次被收一次。'
        )
      );
    }
    zones.push({ ...zone, rect: clamped });
  });
  return { script: { ...script, zones }, issues };
}

/** Two rectangles share ground (touching edges is not sharing). */
export function rectsOverlap(a: ZoneRect, b: ZoneRect, tolerance = 1e-6): boolean {
  return a.x + tolerance < b.x + b.w && b.x + tolerance < a.x + a.w && a.z + tolerance < b.z + b.d && b.z + tolerance < a.z + a.d;
}

const BUILT_ROLES: readonly SceneScriptZoneRole[] = ['stage', 'checkin', 'seating', 'booth', 'plant'];

/**
 * What will not work, said before anything is compiled. Errors stop the compile; warnings
 * are things the compiler can survive and report on the result.
 */
export function validateSceneScript(script: SceneScript, venue: SceneScriptVenue): SceneScriptIssue[] {
  const issues: SceneScriptIssue[] = [];
  const seen = new Set<SceneScriptZoneRole>();

  script.zones.forEach((zone, index) => {
    if (zone.role === 'stage' || zone.role === 'checkin') {
      if (seen.has(zone.role)) {
        issues.push(
          issue('W_DUPLICATE_ROLE', 'warning', `zones[${index}].role`, `${zone.role} 区不止一块，每块都会建：这是两个${zone.role === 'stage' ? '舞台' : '签到台'}，不是一个。`, '只想留一个就删掉多余的，或者把其中一块改成 reserved。')
        );
      }
      seen.add(zone.role);
    }
    if ((zone.role === 'aisle' || zone.role === 'reserved') && Math.min(zone.rect.w, zone.rect.d) < script.constraints.aisleMinM) {
      issues.push(
        issue(
          'W_AISLE_NARROW',
          'warning',
          `zones[${index}].rect`,
          `${zone.role} 区最窄处 ${Math.min(zone.rect.w, zone.rect.d).toFixed(1)} m，比 ${script.constraints.aisleMinM} m 的通道下限窄。`,
          '通道是消防尺度，不是风格：加宽到下限以上。'
        )
      );
    }
  });

  // Buildable zones must not claim the same ground. Aisle/reserved are allowed to sit on
  // top of them — that is what a cut-out is — but a table field under a booth field is a
  // script that will silently lose one of the two.
  for (let i = 0; i < script.zones.length; i++) {
    const a = script.zones[i]!;
    if (!BUILT_ROLES.includes(a.role)) continue;
    for (let j = i + 1; j < script.zones.length; j++) {
      const b = script.zones[j]!;
      if (!BUILT_ROLES.includes(b.role)) continue;
      if (rectsOverlap(zoneRectOf(a), zoneRectOf(b))) {
        issues.push(
          issue(
            'E_ZONE_OVERLAP',
            'error',
            `zones[${j}].rect`,
            `${a.role} 区和 ${b.role} 区压在同一块地上，只能建一个。`,
            '把其中一块挪开，或者改成 aisle / reserved 让它只占路。'
          )
        );
      }
    }
  }

  const seatingArea = zonesWithRole(script, 'seating').reduce((sum, zone) => sum + zoneArea(zoneRectOf(zone)), 0);
  if (script.guests && seatingArea === 0) {
    issues.push(
      issue('E_ROLE_UNFIT', 'error', 'guests', `${script.guests} 个人，但脚本里没有 seating 区。`, '加一块 seating 区，或者去掉 guests。')
    );
  }
  if (seatingArea > venue.width * venue.depth + 1e-6) {
    issues.push(issue('E_ZONE_OUTSIDE', 'warning', 'zones', 'seating 区加起来比场地还大，多半是 rect 写反了。'));
  }
  return issues;
}

/** 区角色对人说的那两个字：读白和诊断都用它，不许再各起一套叫法。 */
export const SCENE_SCRIPT_ROLE_LABEL: Record<SceneScriptZoneRole, string> = {
  stage: '舞台', checkin: '签到', seating: '座位', booth: '展位', plant: '绿植', aisle: '通道', reserved: '预留',
};

/**
 * What a script says, in the same words a person handed it over in. Read back before building.
 *
 * `seatingCeilings` carries what the ground the seating stands on can actually give, keyed by the
 * zone object the caller is describing. Without it the read-back repeats the ask — "座位 …，80 座"
 * — which is a promise the compiler already knows it cannot keep. With it the line says what this
 * arrangement reaches（「按这版排法最多 N 座」）, and the ask survives only in the parenthetical and
 * in the capacity warning. The probe counts the slots our own grid can use, which is not proof that
 * the room holds no more under a different packing — so we quote our reach, never the room.
 */
export function describeSceneScript(
  script: SceneScript,
  seatingCeilings?: ReadonlyMap<SceneScriptZone, number>,
): string[] {
  return script.zones.map((zone) => {
    const { w, d } = zone.rect;
    const asked = zone.count ?? (zone.role === 'seating' ? script.guests ?? 0 : 0);
    if (!asked) return `${zone.label ?? SCENE_SCRIPT_ROLE_LABEL[zone.role]} ${w.toFixed(1)} × ${d.toFixed(1)} m`;
    if (zone.role !== 'seating') {
      return `${zone.label ?? SCENE_SCRIPT_ROLE_LABEL[zone.role]} ${w.toFixed(1)} × ${d.toFixed(1)} m，${asked} 件`;
    }
    const label = zone.label ?? SCENE_SCRIPT_ROLE_LABEL.seating;
    const ceiling = seatingCeilings?.get(zone);
    if (ceiling === undefined || ceiling >= asked) return `${label} ${w.toFixed(1)} × ${d.toFixed(1)} m，${asked} 座`;
    if (ceiling <= 0) return `${label} ${w.toFixed(1)} × ${d.toFixed(1)} m，这一版连一组桌椅都排不进（要 ${asked}）`;
    return `${label} ${w.toFixed(1)} × ${d.toFixed(1)} m，按这版排法最多 ${ceiling} 座（要 ${asked}）`;
  });
}

export interface BriefSceneScriptInput {
  widthM: number;
  depthM: number;
  guests?: number | null;
  layoutMode?: 'dining' | 'desk-chair';
  /** 发布会这类先占舞台和签到；课室两者都不要（与 `layoutAnchors` 同一套语义）。 */
  stage: boolean;
  checkin: boolean;
  /** 换一版：同一份需求换一个 seed，槽位顺序变，可行域不变。 */
  seed: number;
  /** 没有舞台和签到时，前侧预留带会把大圆桌的椅子挡在场地外。缺座时可以不留。 */
  aisle?: boolean;
  /** Usable interior in layout coordinates. Zones stay inside it instead of the activity frame. */
  floor?: { x: number; z: number; w: number; d: number };
}

/**
 * A first script from what the person already said. This is the deterministic "plan on the
 * map" step: mass at the north (stage), a cross aisle in front of it, the seating field
 * below, with an optional check-in band. It writes nothing; the compiler does.
 */
export function sceneScriptFromBrief(input: BriefSceneScriptInput): SceneScript {
  const { guests, layoutMode = 'dining', stage, checkin } = input;
  const frame = input.floor && input.floor.w > 1 && input.floor.d > 1
    ? input.floor
    : { x: -input.widthM / 2, z: -input.depthM / 2, w: input.widthM, d: input.depthM };
  const gap = 0.35;
  const aisleMinM = 1.2;
  const zones: SceneScriptZone[] = [];

  let north = frame.z + gap;
  if (stage) {
    const stageDepth = clamp(frame.d * 0.16, 1.2, 3.2);
    zones.push({ role: 'stage', rect: { x: frame.x + gap, z: north, w: frame.w - 2 * gap, d: stageDepth }, label: '主舞台' });
    north += stageDepth;
  }
  if (input.aisle !== false) {
    zones.push({ role: 'aisle', rect: { x: frame.x + gap, z: north, w: frame.w - 2 * gap, d: aisleMinM }, label: '前侧预留带' });
    north += aisleMinM;
  }

  // Keep the optional check-in band clear of seating. 课桌式的签到台 1.8×0.6 竖着贴南墙，
  // 1.0m 带宽就够；1.6m 是宴会/舞台场景的经验值，会把 7.1m 深的小会议室座位区吃掉一截。
  const southBandD = checkin || stage ? (layoutMode === 'desk-chair' ? 1.0 : 1.6) : 0;
  const south = frame.z + frame.d - gap - southBandD;
  const seatingD = south - north;
  if (seatingD >= 0.5) {
    zones.push({
      role: 'seating',
      rect: { x: frame.x + gap, z: north, w: frame.w - 2 * gap, d: seatingD },
      ...(guests ? { count: guests } : {}),
    });
  }
  if (southBandD > 0) {
    if (checkin) {
      zones.push({
        role: 'checkin',
        rect: { x: frame.x + gap, z: south + gap, w: Math.min(2.4, frame.w * 0.3), d: southBandD - gap },
        label: '签到台',
      });
    }

  }

  return {
    version: 1,
    seed: input.seed >>> 0,
    layoutMode,
    ...(guests ? { guests } : {}),
    zones,
    constraints: { aisleMinM, wallGapM: gap },
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
