/**
 * DXF floor-plan export (#230). Hand-rolled plain-text DXF with an
 * R12-style minimal header structure — no dependencies, no DOM. Group codes
 * and values each on their own line, `0/SECTION … 0/ENDSEC`, `0/EOF`.
 *
 * Choices:
 * - Units are metres 1:1 ($INSUNITS = 6); world origin moves to the room's
 *   corner and the CAD Y axis points up, so Y = depth/2 − z and the plan
 *   reads like the 2D top-down view.
 * - Walls and furniture footprints are closed LWPOLYLINEs (flag 70 = 1).
 *   LWPOLYLINE does not exist in true R12, so the header declares AC1015
 *   (DXF 2000, the version that introduced it) and each polyline carries its
 *   100/AcDbEntity + 100/AcDbPolyline subclass markers — without either, a
 *   strict parser mis-reads the layer/closed flag or refuses the entity
 *   (verified against ezdxf: parses with zero audit errors as emitted).
 * - Doors are LINE jamb ticks + the leaf, plus the swing ARC, on DOORS.
 *   Windows are jamb ticks plus two lines ±3 cm off the centreline, on WINDOWS
 *   (openPlan3D's parallel-line window; the old single centre line is gone).
 * - Prop names are TEXT on FURNITURE. The sheet title and zone name/area are
 *   TEXT on ROOMS. External width and depth are TEXT on DIMENSIONS.
 * - Stair treads, the climb arrow and the stairwell void are on STAIRS.
 *   Item names stay horizontal; only the depth label is rotated.
 */

import { planDrawOrder } from '../plan-order';
import { entrancePlanOutline, planFloorIndex } from '../street';
import { zoneArea } from '../zones';
import {
  DXF_LAYER_COLOURS,
  DXF_LAYER_NAMES,
  planExportVisibility,
  planLengthLabel,
  type PlanExportVisibility,
} from './export-visibility';
import {
  itemWorldCorners,
  openingAxes,
  splitPlanItems,
  stairArrow,
  stairTreadSegments,
  stairwellOutlines,
  type PlacedItem,
} from './plan-geometry';
import type { FloorLayout, RoomLayout } from '../types';

export const DXF_LAYERS = DXF_LAYER_NAMES;

/** ACI colour per layer. See export-visibility.ts. */
const LAYER_COLOURS = DXF_LAYER_COLOURS;

/** Window lines sit this far either side of the centreline, in metres (openPlan3D uses 3 cm). */
const WINDOW_PAIR_OFFSET_M = 0.03;
/** External dimension text sits this far outside the shell, in metres. */
const DIMENSION_OFFSET_M = 0.35;

/** The entity emitters `layoutToDxf` closes over, as the stair helpers take them (#290). */
type DxfPolyline = (layer: string, points: ReadonlyArray<readonly [string, string]>, closed: boolean) => void;
type DxfLine = (layer: string, x1: string, y1: string, x2: string, y2: string) => void;

/** Perpendicular jamb-tick length at each end of an opening, in metres. */
const OPENING_TICK_M = 0.25;
/** TEXT heights in metres. */
const LABEL_TEXT_HEIGHT = 0.18;
const TITLE_TEXT_HEIGHT = 0.35;

/** Render one floor of a building as a DXF R12 document (metres, 1:1). */
export function layoutToDxf(
  layout: RoomLayout,
  floor: FloorLayout,
  visibility: Partial<PlanExportVisibility> = {}
): string {
  const layers = planExportVisibility(visibility);
  const lines: string[] = [];
  const put = (code: number, value: string | number): void => {
    lines.push(String(code), String(value));
  };
  // World (metres, origin at room centre, z down) → CAD (origin at the room's
  // SW corner in CAD terms, Y up).
  const cx = (x: number): string => fmt(x + layout.width / 2);
  const cy = (z: number): string => fmt(layout.height / 2 - z);

  // ---- HEADER ------------------------------------------------------------
  put(0, 'SECTION');
  put(2, 'HEADER');
  put(9, '$ACADVER');
  put(1, 'AC1015');
  put(9, '$INSUNITS');
  put(70, 6); // metres
  put(0, 'ENDSEC');

  // ---- TABLES ------------------------------------------------------------
  put(0, 'SECTION');
  put(2, 'TABLES');
  // CONTINUOUS linetype so the layer table has something to reference.
  put(0, 'TABLE');
  put(2, 'LTYPE');
  put(70, 1);
  put(0, 'LTYPE');
  put(2, 'CONTINUOUS');
  put(70, 0);
  put(3, 'Solid line');
  put(72, 65);
  put(73, 0);
  put(40, '0.000');
  put(0, 'ENDTAB');
  put(0, 'TABLE');
  put(2, 'LAYER');
  put(70, DXF_LAYERS.length);
  for (const layer of DXF_LAYERS) {
    put(0, 'LAYER');
    put(2, layer);
    put(70, 0);
    put(62, LAYER_COLOURS[layer]);
    put(6, 'CONTINUOUS');
  }
  put(0, 'ENDTAB');
  put(0, 'ENDSEC');

  // ---- ENTITIES ----------------------------------------------------------
  put(0, 'SECTION');
  put(2, 'ENTITIES');

  const polyline = (layer: string, points: ReadonlyArray<readonly [string, string]>, closed: boolean): void => {
    put(0, 'LWPOLYLINE');
    put(100, 'AcDbEntity');
    put(8, layer);
    put(100, 'AcDbPolyline');
    put(90, points.length);
    put(70, closed ? 1 : 0);
    for (const [x, y] of points) {
      put(10, x);
      put(20, y);
    }
  };
  const line = (layer: string, x1: string, y1: string, x2: string, y2: string): void => {
    put(0, 'LINE');
    put(8, layer);
    put(10, x1);
    put(20, y1);
    put(11, x2);
    put(21, y2);
  };
  const text = (
    layer: string,
    x: string,
    y: string,
    height: number,
    value: string,
    centred: boolean,
    rotationDeg = 0
  ): void => {
    put(0, 'TEXT');
    put(8, layer);
    put(10, x);
    put(20, y);
    put(40, fmt(height));
    if (rotationDeg) put(50, fmt(rotationDeg));
    put(1, sanitizeText(value));
    if (centred) {
      put(72, 1);
      put(11, x);
      put(21, y);
    }
  };

  // Room outline: one closed polyline around the footprint. Hidden walls stay
  // in the export — the footprint is real even when the 2D view fades a wall.
  // A recessed entrance (#285) notches the north edge: the polyline goes in
  // along the east cheek, across the recess's back and out along the west
  // cheek — eight vertices. (The recess back wall's centreline is on WALLS
  // with the other partitions, like the 2D view draws it; its door is an
  // ordinary opening.)
  // `walls` hides the shell and the partitions. Openings still trace the wall
  // they sit on, matching openPlan3D's visiblePlanFloor.
  if (layers.walls) {
    const recess = entrancePlanOutline(layout, planFloorIndex(layout.floors, floor));
    const northEdge: ReadonlyArray<readonly [string, string]> = recess
      ? [
          [cx(recess.x1), cy(recess.frontZ)],
          [cx(recess.x1), cy(recess.backZ)],
          [cx(recess.x0), cy(recess.backZ)],
          [cx(recess.x0), cy(recess.frontZ)],
        ]
      : [];
    polyline(
      'WALLS',
      [
        [fmt(0), fmt(0)],
        [fmt(layout.width), fmt(0)],
        [fmt(layout.width), fmt(layout.height)],
        ...northEdge,
        [fmt(0), fmt(layout.height)],
      ],
      true
    );

    // Interior partitions share WALLS. Thickness stays a render style.
    for (const wall of floor.interiorWalls ?? []) {
      line('WALLS', cx(wall.x1), cy(wall.z1), cx(wall.x2), cy(wall.z2));
    }
  }

  if (layers.stairs) emitStairwellHoles(layout, floor, cx, cy, polyline);

  // Same bottom-to-top layer order as the on-screen plan (#286).
  const { openings, furniture } = splitPlanItems(planDrawOrder(floor.items));

  for (const item of openings) {
    if (item.type === 'door' ? layers.doors : layers.windows) emitOpening(item, cx, cy, line, put);
  }

  for (const item of furniture) {
    if (item.type === 'stairs') {
      if (!layers.stairs) continue;
      const corners = itemWorldCorners(item);
      polyline(
        'STAIRS',
        corners.map((corner) => [cx(corner.x), cy(corner.z)] as const),
        true
      );
      emitStairs(item, cx, cy, line, polyline);
      continue;
    }
    if (!layers.furniture) continue;
    const corners = itemWorldCorners(item);
    polyline(
      'FURNITURE',
      corners.map((corner) => [cx(corner.x), cy(corner.z)] as const),
      true
    );
    text('FURNITURE', cx(item.position.x), cy(item.position.z), LABEL_TEXT_HEIGHT, item.name, true);
  }

  if (layers.roomLabels) {
    for (const zone of floor.zones ?? []) {
      const nameX = cx(zone.x + zone.w / 2);
      const nameY = cy(zone.z + 0.3);
      text('ROOMS', nameX, nameY, LABEL_TEXT_HEIGHT, zone.name, true);
      text('ROOMS', nameX, cy(zone.z + 0.55), 0.12, `${zoneArea(zone).toFixed(1)} m²`, true);
    }
  }

  if (layers.wallDimensions) {
    text('DIMENSIONS', fmt(layout.width / 2), fmt(layout.height + DIMENSION_OFFSET_M), LABEL_TEXT_HEIGHT, planLengthLabel(layout.width), true);
    text('DIMENSIONS', fmt(-DIMENSION_OFFSET_M), fmt(layout.height / 2), LABEL_TEXT_HEIGHT, planLengthLabel(layout.height), true, 90);
  }

  // Sheet title. The print title block owns this on paper; DXF has no title
  // block, so the same string is TEXT on ROOMS and is not gated by roomLabels.
  text('ROOMS', fmt(0), fmt(layout.height + 0.5), TITLE_TEXT_HEIGHT, `${layout.name} - ${floor.name}`, false);

  put(0, 'ENDSEC');
  put(0, 'EOF');
  return lines.join('\n');
}

/**
 * A stair's plan symbol (#290) beside its footprint: tread nosings as LINEs
 * and the up-arrow as an open LWPOLYLINE along the walk line plus two barb
 * LINEs at the head — all on STAIRS, with the footprint.
 */
function emitStairs(
  item: PlacedItem,
  cx: (x: number) => string,
  cy: (z: number) => string,
  line: DxfLine,
  polyline: DxfPolyline
): void {
  for (const { from, to } of stairTreadSegments(item)) {
    line('STAIRS', cx(from.x), cy(from.z), cx(to.x), cy(to.z));
  }
  const { shaft, head } = stairArrow(item);
  if (shaft.length < 2) return;
  polyline(
    'STAIRS',
    shaft.map((p) => [cx(p.x), cy(p.z)] as const),
    false
  );
  for (const { from, to } of head) {
    line('STAIRS', cx(from.x), cy(from.z), cx(to.x), cy(to.z));
  }
}

/**
 * The stairwell the floor below cuts through this floor's slab (#290): one
 * closed LWPOLYLINE per hole on STAIRS, with the stair symbol, so one switch
 * hides the void and the flight.
 */
function emitStairwellHoles(
  layout: RoomLayout,
  floor: FloorLayout,
  cx: (x: number) => string,
  cy: (z: number) => string,
  polyline: DxfPolyline
): void {
  const floorIndex = layout.floors.findIndex((candidate) => candidate === floor || candidate.id === floor.id);
  for (const outline of stairwellOutlines(layout, floorIndex)) {
    polyline(
      'STAIRS',
      outline.map((p) => [cx(p.x), cy(p.z)] as const),
      true
    );
  }
}

function emitOpening(
  item: PlacedItem,
  cx: (x: number) => string,
  cy: (z: number) => string,
  line: (layer: string, x1: string, y1: string, x2: string, y2: string) => void,
  put: (code: number, value: string | number) => void
): void {
  const { along, into } = openingAxes(item);
  const half = item.width / 2;
  const tick = OPENING_TICK_M / 2;
  const pos = item.position;
  const endA = { x: pos.x - along.x * half, z: pos.z - along.z * half };
  const endB = { x: pos.x + along.x * half, z: pos.z + along.z * half };
  const layer = item.type === 'door' ? 'DOORS' : 'WINDOWS';

  // Jamb ticks across the wall at both ends of the opening.
  for (const end of [endA, endB]) {
    line(
      layer,
      cx(end.x - into.x * tick),
      cy(end.z - into.z * tick),
      cx(end.x + into.x * tick),
      cy(end.z + into.z * tick)
    );
  }

  if (item.type === 'door') {
    // Swing: leaf hinged at endA, opened perpendicular into the room, plus the
    // quarter arc from the closed to the open position. In CAD coords `along`
    // sits at angle θ and `into` at θ − 90°, so the CCW arc runs θ−90 → θ.
    const leafTip = { x: endA.x + into.x * item.width, z: endA.z + into.z * item.width };
    line('DOORS', cx(endA.x), cy(endA.z), cx(leafTip.x), cy(leafTip.z));
    const thetaDeg = ((item.rotation ?? 0) * 180) / Math.PI;
    put(0, 'ARC');
    put(8, 'DOORS');
    put(10, cx(endA.x));
    put(20, cy(endA.z));
    put(40, fmt(item.width));
    put(50, fmt(normalizeDeg(thetaDeg - 90)));
    put(51, fmt(normalizeDeg(thetaDeg)));
  } else {
    // Two lines ±3 cm off the centreline. No centre line.
    for (const sign of [-1, 1]) {
      const ox = into.x * WINDOW_PAIR_OFFSET_M * sign;
      const oz = into.z * WINDOW_PAIR_OFFSET_M * sign;
      line(layer, cx(endA.x + ox), cy(endA.z + oz), cx(endB.x + ox), cy(endB.z + oz));
    }
  }
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Fixed 3-dp precision, never "-0.000". */
function fmt(value: number): string {
  const fixed = value.toFixed(3);
  return fixed === '-0.000' ? '0.000' : fixed;
}

/**
 * Make a string safe as a DXF TEXT value:
 * - control characters (incl. newlines) would corrupt the group pairs → space;
 * - AC1015 is read with the ANSI code page, so raw UTF-8 above ASCII garbles
 *   ("Maison d'été" → "Maison d'Ã©tÃ©"): every code point above 0x7E goes
 *   out as the `\U+XXXX` escape CAD readers expand; astral characters have
 *   no BMP escape and become `?` (#288);
 * - `%%` introduces a TEXT control code (`%%u` underline, `%%d` degree), so
 *   every `%` is written as the `%%%` escape for a literal percent sign —
 *   "%%u" becomes "%%%%%%u", which readers render as "%%u".
 */
function sanitizeText(value: string): string {
  let out = '';
  // eslint-disable-next-line no-control-regex
  for (const char of value.replace(/[\r\n\u0000-\u001f]/g, ' ')) {
    const code = char.codePointAt(0) ?? 0x3f;
    if (char === '%') out += '%%%';
    else if (code <= 0x7e) out += char;
    else if (code <= 0xffff) out += `\\U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
    else out += '?';
  }
  return out;
}
