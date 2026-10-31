/**
 * Scalable-vector floor plan export (#230). Pure string emitter — no DOM, no
 * React, no Three.js — so it runs in tests and could run in a worker.
 *
 * Geometry matches the 2D top-down view (grid anchor, wall edges, footprint
 * rotation). The sheet itself is a layout diagram for an event team — shell,
 * envelopes, and names that fit — in the cold-stone product palette, not a
 * construction drawing.
 */

import { planDrawOrder } from '../plan-order';
import { entrancePlanOutline, planFloorIndex } from '../street';
import { zoneArea } from '../zones';
import { planExportVisibility, type PlanExportVisibility } from './export-visibility';
import {
  gridLinePositions,
  INTERIOR_WALL_THICKNESS_M,
  isWallHidden,
  planBounds,
  splitPlanItems,
  stairArrow,
  stairTreadSegments,
  stairwellOutlines,
  type PlacedItem,
  type PlanPoint,
} from './plan-geometry';
import type { FloorLayout, RoomLayout, WallId } from '../types';

/** Sheet colours. Defaults are the product cold-stone palette. */
export interface SvgPlanTheme {
  /** Page + opening-gap colour. */
  background: string;
  /** 1 m guide lines. */
  grid: string;
  wall: string;
  hiddenWall: string;
  interiorWall: string;
  furnitureStroke: string;
  label: string;
  /** Secondary type: overall size, zone area, scale caption. */
  muted: string;
  opening: string;
  /** One accent, used as a short mark under the title. */
  accent: string;
}

export interface SvgExportOptions {
  /** Pixels per metre; the default 50 keeps a 10 m room at a crisp 500 px. */
  pxPerMetre?: number;
  /** Margin (px) around the plan content for the title, dimensions, and scale bar. */
  margin?: number;
  theme?: Partial<SvgPlanTheme>;
  /**
   * Which layers to draw. This sheet does not draw CAD edge lengths: the
   * overall size is one line under the title. `wallDimensions` and
   * `roomDimensions` add no dimension lines here; the print title block
   * owns the footprint string, and DXF keeps external lengths on DIMENSIONS.
   */
  visibility?: Partial<PlanExportVisibility>;
}

/** The sheet `layoutToSvg` draws on, in SVG px and in world metres. */
export interface SvgSheetSize {
  widthPx: number;
  heightPx: number;
  widthM: number;
  heightM: number;
}

export const DEFAULT_SVG_PX_PER_METRE = 50;
export const DEFAULT_SVG_MARGIN = 60;

const DEFAULT_THEME: SvgPlanTheme = {
  background: '#ffffff',
  grid: '#E4E4E7',
  wall: '#141416',
  hiddenWall: '#A6AAB2',
  interiorWall: '#55585F',
  furnitureStroke: '#141416',
  label: '#141416',
  muted: '#71767E',
  opening: '#55585F',
  accent: '#4A7C59',
};

/** In-footprint name size. Print maps 1 px to 0.25 mm, so this stays ~2.8 mm. */
const LABEL_FONT_PX = 11;

/**
 * Size of the sheet `layoutToSvg` emits for the same layout, floor and
 * options: the plan content (room + every placed item, outdoor ones
 * included) plus the annotation margin on each side. The print route sizes
 * its page from this rather than re-deriving room + margin, which clipped
 * garden items (#287).
 */
export function planSheetSize(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions = {}): SvgSheetSize {
  const scale = options.pxPerMetre ?? DEFAULT_SVG_PX_PER_METRE;
  const margin = options.margin ?? DEFAULT_SVG_MARGIN;
  const bounds = planBounds(layout, floor, margin / scale);
  const widthM = bounds.maxX - bounds.minX;
  const heightM = bounds.maxZ - bounds.minZ;
  return { widthPx: widthM * scale, heightPx: heightM * scale, widthM, heightM };
}

/**
 * Render one floor of a building as a standalone SVG floor plan: room
 * outline, grid, interior walls, door/window marks, furniture as rotated
 * rects with name labels, a scale bar, and the floor name.
 */
export function layoutToSvg(layout: RoomLayout, floor: FloorLayout, options: SvgExportOptions = {}): string {
  const scale = options.pxPerMetre ?? DEFAULT_SVG_PX_PER_METRE;
  const margin = options.margin ?? DEFAULT_SVG_MARGIN;
  const theme: SvgPlanTheme = { ...DEFAULT_THEME, ...options.theme };
  const layers = planExportVisibility(options.visibility);

  const roomW = layout.width * scale;
  const roomD = layout.height * scale;
  // The sheet follows the content, not the room: outdoor items past the walls
  // used to be cut off by a fixed room + margin viewBox and to overprint the
  // scale bar (#287). The renderers below keep drawing in room coordinates
  // (room top-left at (margin, margin)); the root group translates that
  // origin to where the room sits on the content-fitted sheet, which is a
  // no-op when nothing pokes out past the walls.
  const bounds = planBounds(layout, floor, margin / scale);
  const totalW = (bounds.maxX - bounds.minX) * scale;
  const totalH = (bounds.maxZ - bounds.minZ) * scale;
  const rootX = (-layout.width / 2 - bounds.minX) * scale - margin;
  const rootY = (-layout.height / 2 - bounds.minZ) * scale - margin;
  // World (metres, origin at room centre) → room-coordinate px.
  const px = (x: number): string => fmt(margin + (x + layout.width / 2) * scale);
  const py = (z: number): string => fmt(margin + (z + layout.height / 2) * scale);

  // Same bottom-to-top layer order as the on-screen plan (#286).
  const { openings, furniture } = splitPlanItems(planDrawOrder(floor.items));
  const labeled = labeledFurnitureIds(layout, floor, furniture, scale, margin, layers.roomLabels);
  const title = `${layout.name} — ${floor.name}`;
  // Title, the short accent, and the one overall size stack in the top
  // margin. A long event name used to share a baseline with the size and
  // collide with it.
  const titleY = margin - 34;
  const markY = margin - 22;
  const dimsY = margin - 10;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(totalW)} ${fmt(totalH)}" width="${fmt(totalW)}" height="${fmt(totalH)}" font-family="Inter, Arial, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect width="${fmt(totalW)}" height="${fmt(totalH)}" fill="${theme.background}"/>`,
    `<g class="plan" transform="translate(${fmt(rootX)} ${fmt(rootY)})">`,
    `<rect x="${fmt(margin)}" y="${fmt(margin)}" width="${fmt(roomW)}" height="${fmt(roomD)}" fill="${escapeXml(floor.floorColor)}"/>`,
    renderGrid(layout, margin, scale, theme),
    renderZones(floor, px, py, scale, theme, layers.roomLabels),
    renderRoomOutline(layout, floor, margin, scale, theme, layers.walls),
    renderInteriorWalls(floor, px, py, scale, theme, layers.walls),
    renderStairwellHoles(layout, floor, px, py, theme, layers.stairs),
    ...openings
      .filter((item) => (item.type === 'door' ? layers.doors : layers.windows))
      .map((item) => renderOpening(item, px, py, scale, theme)),
    ...furniture.map((item) => renderFurniture(item, px, py, scale, theme, layers, labeled.has(item.id))),
    `</g>`,
    // Annotations sit in the margin band around the content — the content
    // spans (margin, margin) → (totalW − margin, totalH − margin) on the
    // sheet — so no item can overprint them. The handoff injector splices
    // instance numbers in front of this title, so keep the break exactly
    // `</g>\n<text class="plan-title"`. The title stays when room labels
    // are off: it is the sheet title, not a zone name. Overall size is one
    // line under the title; north and west edge lengths are not drawn.
    `<text class="plan-title" x="${fmt(margin)}" y="${fmt(titleY)}" font-size="13" font-weight="600" fill="${theme.label}">${escapeXml(title)}</text>`,
    `<line class="plan-mark" x1="${fmt(margin)}" y1="${fmt(markY)}" x2="${fmt(margin + 22)}" y2="${fmt(markY)}" stroke="${theme.accent}" stroke-width="2" stroke-linecap="round"/>`,
    `<text class="plan-dims" x="${fmt(margin)}" y="${fmt(dimsY)}" font-size="11" fill="${theme.muted}">${fmt(layout.width)} × ${fmt(layout.height)} m</text>`,
    renderScaleBar(layout, margin, scale, totalH, theme),
    `</svg>`,
  ];
  return parts.filter((part) => part !== '').join('\n');
}

/** Whole-metre guides only. The half-metre snap grid reads as graph paper. */
function isMetreLine(position: number): boolean {
  return Math.abs(position - Math.round(position)) < 1e-6;
}

function renderGrid(layout: RoomLayout, margin: number, scale: number, theme: SvgPlanTheme): string {
  const segments: string[] = [];
  const top = margin;
  const bottom = margin + layout.height * scale;
  const left = margin;
  const right = margin + layout.width * scale;
  for (const wx of gridLinePositions(layout.width)) {
    if (!isMetreLine(wx)) continue;
    const sx = fmt(margin + (wx + layout.width / 2) * scale);
    segments.push(`M ${sx} ${fmt(top)} V ${fmt(bottom)}`);
  }
  for (const wz of gridLinePositions(layout.height)) {
    if (!isMetreLine(wz)) continue;
    const sy = fmt(margin + (wz + layout.height / 2) * scale);
    segments.push(`M ${fmt(left)} ${sy} H ${fmt(right)}`);
  }
  if (segments.length === 0) return '';
  return `<path class="grid" d="${segments.join(' ')}" stroke="${theme.grid}" stroke-width="0.8" fill="none"/>`;
}

function renderRoomOutline(
  layout: RoomLayout,
  floor: FloorLayout,
  margin: number,
  scale: number,
  theme: SvgPlanTheme,
  showWalls: boolean
): string {
  if (!showWalls) return '';
  // Per-edge like canvas-2d/render.ts drawRoomOutline: a hidden wall reads as
  // a light dashed boundary instead of a solid wall.
  const x0 = margin;
  const y0 = margin;
  const x1 = margin + layout.width * scale;
  const y1 = margin + layout.height * scale;
  // The recessed entrance (#285), as the 2D view draws it: the north edge
  // breaks across the opening, the two cheeks run back to the recess's rear
  // wall (an interior wall, emitted with the others), and the recess is
  // painted in the page colour over the floor, grid and zones — outside.
  const recess = entrancePlanOutline(layout, planFloorIndex(layout.floors, floor));
  const rx0 = recess ? margin + (recess.x0 + layout.width / 2) * scale : x0;
  const rx1 = recess ? margin + (recess.x1 + layout.width / 2) * scale : x1;
  const ry1 = recess ? margin + (recess.backZ + layout.height / 2) * scale : y0;
  type Edge = { id: WallId; x1: number; y1: number; x2: number; y2: number };
  const north: Edge[] = recess
    ? [
        { id: 'north', x1: x0, y1: y0, x2: rx0, y2: y0 },
        { id: 'north', x1: rx0, y1: y0, x2: rx0, y2: ry1 },
        { id: 'north', x1: rx1, y1: y0, x2: rx1, y2: ry1 },
        { id: 'north', x1: rx1, y1: y0, x2: x1, y2: y0 },
      ]
    : [{ id: 'north', x1: x0, y1: y0, x2: x1, y2: y0 }];
  const edges: Edge[] = [
    ...north,
    { id: 'south', x1: x0, y1: y1, x2: x1, y2: y1 },
    { id: 'west', x1: x0, y1: y0, x2: x0, y2: y1 },
    { id: 'east', x1: x1, y1: y0, x2: x1, y2: y1 },
  ];
  const lines = edges.map((edge) => {
    const hidden = isWallHidden(floor, edge.id);
    const style = hidden
      ? `stroke="${theme.hiddenWall}" stroke-width="1.25" stroke-dasharray="6 4" stroke-linecap="butt"`
      : `stroke="${theme.wall}" stroke-width="2.25" stroke-linecap="butt"`;
    return `<line class="wall" data-layer="WALLS" x1="${fmt(edge.x1)}" y1="${fmt(edge.y1)}" x2="${fmt(edge.x2)}" y2="${fmt(edge.y2)}" ${style}/>`;
  });
  if (recess) {
    lines.unshift(
      `<rect class="entrance" x="${fmt(rx0)}" y="${fmt(y0)}" width="${fmt(rx1 - rx0)}" height="${fmt(ry1 - y0)}" fill="${theme.background}"/>`
    );
  }
  return lines.join('\n');
}

/**
 * Room zones (#155) as tinted rects with the name and area along the top
 * edge (the centre is where the furniture sits) — between the grid and the
 * walls, like canvas-2d/render.ts paints them.
 */
function renderZones(
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme,
  showLabels: boolean
): string {
  const zones = floor.zones ?? [];
  if (zones.length === 0) return '';
  return zones
    .map((zone) => {
      const color = escapeXml(zone.color);
      const cx = fmt(Number(px(zone.x)) + (zone.w * scale) / 2);
      const top = fmt(Number(py(zone.z)) + 15);
      return [
        `<g class="zone">`,
        `<rect x="${px(zone.x)}" y="${py(zone.z)}" width="${fmt(zone.w * scale)}" height="${fmt(zone.d * scale)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-opacity="0.45" stroke-width="1"/>`,
        showLabels
          ? `<text class="zone-label" data-layer="ROOMS" x="${cx}" y="${top}" font-size="12" font-weight="600" text-anchor="middle" fill="${theme.label}">${escapeXml(zone.name)}</text>`
          : '',
        showLabels
          ? `<text class="zone-area" data-layer="ROOMS" x="${cx}" y="${top}" dy="1.15em" font-size="10" text-anchor="middle" fill="${theme.muted}">${zoneArea(zone).toFixed(1)} m²</text>`
          : '',
        `</g>`,
      ].join('');
    })
    .join('\n');
}

function renderInteriorWalls(
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme,
  showWalls: boolean
): string {
  const walls = floor.interiorWalls ?? [];
  if (!showWalls || walls.length === 0) return '';
  const width = fmt(Math.max(2, INTERIOR_WALL_THICKNESS_M * scale));
  const lines = walls.map(
    (wall) =>
      `<line class="interior-wall" data-layer="WALLS" x1="${px(wall.x1)}" y1="${py(wall.z1)}" x2="${px(wall.x2)}" y2="${py(wall.z2)}" stroke="${theme.interiorWall}" stroke-width="${width}" stroke-linecap="butt"/>`
  );
  return lines.join('\n');
}

/**
 * Door: a gap punched through the wall line plus the conventional quarter-arc
 * swing (leaf hinged at one jamb, opening into the room — for wall-snapped
 * rotations the local +Y of the rotated group points into the room).
 * Window: a gap with a frame rect and a centre line (double-line symbol).
 */
function renderOpening(
  item: PlacedItem,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme
): string {
  const w = item.width * scale;
  const hw = w / 2;
  const gap = 0.2 * scale;
  const transform = `translate(${px(item.position.x)} ${py(item.position.z)}) rotate(${fmt(-((item.rotation ?? 0) * 180) / Math.PI)})`;
  const layer = item.type === 'door' ? 'DOORS' : 'WINDOWS';
  const parts: string[] = [`<g class="opening" data-type="${escapeXml(item.type)}" data-layer="${layer}" transform="${transform}">`];
  parts.push(
    `<rect x="${fmt(-hw)}" y="${fmt(-gap / 2)}" width="${fmt(w)}" height="${fmt(gap)}" fill="${theme.background}"/>`
  );
  if (item.type === 'door') {
    parts.push(
      `<path d="M ${fmt(-hw)} 0 L ${fmt(-hw)} ${fmt(w)} A ${fmt(w)} ${fmt(w)} 0 0 0 ${fmt(hw)} 0 Z" fill="${theme.opening}" fill-opacity="0.07" stroke="none"/>`,
      `<line x1="${fmt(-hw)}" y1="0" x2="${fmt(-hw)}" y2="${fmt(w)}" stroke="${theme.opening}" stroke-width="1.25" stroke-linecap="round"/>`,
      `<path d="M ${fmt(hw)} 0 A ${fmt(w)} ${fmt(w)} 0 0 1 ${fmt(-hw)} ${fmt(w)}" stroke="${theme.opening}" stroke-width="1" fill="none"/>`
    );
  } else {
    parts.push(
      `<rect x="${fmt(-hw)}" y="${fmt(-gap / 2)}" width="${fmt(w)}" height="${fmt(gap)}" fill="none" stroke="${theme.opening}" stroke-width="1"/>`,
      `<line x1="${fmt(-hw)}" y1="0" x2="${fmt(hw)}" y2="0" stroke="${theme.opening}" stroke-width="1"/>`
    );
  }
  parts.push(`</g>`);
  return parts.join('');
}

function renderFurniture(
  item: PlacedItem,
  px: (x: number) => string,
  py: (z: number) => string,
  scale: number,
  theme: SvgPlanTheme,
  layers: PlanExportVisibility,
  showLabel: boolean
): string {
  const w = item.width * scale;
  const d = item.depth * scale;
  // Negated like canvas rotate(): canvas/SVG angles are clockwise while
  // Three's rotateY is CCW, so the plan matches the 3D orientation.
  const groupAngle = -((item.rotation ?? 0) * 180) / Math.PI;
  const transform = `translate(${px(item.position.x)} ${py(item.position.z)}) rotate(${fmt(groupAngle)})`;
  const radius = fmt(Math.min(3, w / 8, d / 8));
  const rect = `<rect class="furniture" x="${fmt(-w / 2)}" y="${fmt(-d / 2)}" width="${fmt(w)}" height="${fmt(d)}" rx="${radius}" fill="${escapeXml(item.color)}" stroke="${theme.furnitureStroke}" stroke-opacity="0.4" stroke-width="1" stroke-linejoin="round"/>`;
  // Stairs carry treads and a climb arrow instead of a name (#290).
  if (item.type === 'stairs') {
    if (!layers.stairs) return '';
    return `<g data-layer="STAIRS" transform="${transform}">${rect}</g>${renderStairsSymbol(item, px, py, theme)}`;
  }
  if (!layers.furniture) return '';
  // Counter-rotate so a south-facing chair does not print its name upside down.
  const upright = Math.abs(groupAngle) < 0.05 ? '' : ` transform="rotate(${fmt(-groupAngle)})"`;
  const label = showLabel
    ? `<text class="label" x="0" y="0" dy="0.35em" font-size="${LABEL_FONT_PX}" text-anchor="middle" fill="${theme.label}" stroke="${theme.background}" stroke-width="2" paint-order="stroke" stroke-linejoin="round"${upright}>${escapeXml(item.name.trim())}</text>`
    : '';
  return `<g data-layer="FURNITURE" transform="${transform}">${rect}${label}</g>`;
}

/**
 * Tread lines and the up-arrow of a stair (#290), in plan space (already
 * rotated and mirrored, so outside the footprint's transform group): the
 * foot is dotted and the arrow follows the walk line up to the last tread.
 */
function renderStairsSymbol(
  item: PlacedItem,
  px: (x: number) => string,
  py: (z: number) => string,
  theme: SvgPlanTheme
): string {
  const at = (p: PlanPoint): string => `${px(p.x)} ${py(p.z)}`;
  const treads = stairTreadSegments(item)
    .map(({ from, to }) => `M ${at(from)} L ${at(to)}`)
    .join(' ');
  const { shaft, head } = stairArrow(item);
  if (shaft.length < 2) return `<path class="stairs" data-layer="STAIRS" d="${treads}" stroke="${theme.furnitureStroke}" stroke-width="0.75" fill="none"/>`;
  const arrow = [
    `M ${shaft.map(at).join(' L ')}`,
    ...head.map(({ from, to }) => `M ${at(from)} L ${at(to)}`),
  ].join(' ');
  return [
    `<g class="stairs" data-layer="STAIRS" stroke="${theme.furnitureStroke}" fill="none" stroke-linecap="round" stroke-linejoin="round">`,
    `<path class="treads" d="${treads}" stroke-width="0.75" stroke-linecap="butt"/>`,
    `<path class="arrow" d="${arrow}" stroke-width="1.5"/>`,
    `<circle cx="${px(shaft[0]!.x)}" cy="${py(shaft[0]!.z)}" r="2" fill="${theme.furnitureStroke}" stroke="none"/>`,
    `</g>`,
  ].join('');
}

/**
 * The stairwell the floor below cuts through this floor's slab (#290): a
 * dashed void outline over the floor, under the furniture — so the export
 * of an upper floor shows the drop, not a solid slab.
 */
function renderStairwellHoles(
  layout: RoomLayout,
  floor: FloorLayout,
  px: (x: number) => string,
  py: (z: number) => string,
  theme: SvgPlanTheme,
  showStairs: boolean
): string {
  if (!showStairs) return '';
  const floorIndex = layout.floors.findIndex((candidate) => candidate === floor || candidate.id === floor.id);
  return stairwellOutlines(layout, floorIndex)
    .map(
      (outline) =>
        `<polygon class="stairwell" data-layer="STAIRS" points="${outline.map((p) => `${px(p.x)},${py(p.z)}`).join(' ')}" fill="${theme.label}" fill-opacity="0.05" stroke="${theme.muted}" stroke-width="1.25" stroke-dasharray="6 4"/>`
    )
    .join('\n');
}

function renderScaleBar(
  layout: RoomLayout,
  margin: number,
  scale: number,
  totalH: number,
  theme: SvgPlanTheme
): string {
  const metres = layout.width >= 4 ? 2 : 1;
  const x0 = margin;
  const barW = metres * scale;
  const y = totalH - 34;
  const h = 6;
  const mid = x0 + barW / 2;
  return [
    `<g class="scale-bar">`,
    `<rect x="${fmt(x0)}" y="${fmt(y)}" width="${fmt(barW)}" height="${h}" fill="none" stroke="${theme.label}" stroke-width="1"/>`,
    `<rect x="${fmt(x0)}" y="${fmt(y)}" width="${fmt(barW / 2)}" height="${h}" fill="${theme.label}"/>`,
    `<text x="${fmt(mid)}" y="${fmt(y + 16)}" font-size="11" text-anchor="middle" fill="${theme.muted}">${metres} m</text>`,
    `</g>`,
  ].join('');
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** CJK and other non-Latin glyphs are about a full em; Latin is narrower. */
function estimateLabelWidth(text: string, fontPx: number): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    width += code > 0xff ? fontPx : fontPx * 0.56;
  }
  return width;
}

function boxesOverlap(a: LabelBox, b: LabelBox, pad: number): boolean {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

/**
 * Screen box of an upright name centred on the item, or null when the name
 * would spill out of the footprint. The box is in the plan group's px,
 * before the sheet translation.
 */
function furnitureLabelBox(item: PlacedItem, layout: RoomLayout, scale: number, margin: number): LabelBox | null {
  const name = item.name.trim();
  if (!name || item.type === 'stairs') return null;
  const w = item.width * scale;
  const d = item.depth * scale;
  const theta = item.rotation ?? 0;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const screenW = w * cos + d * sin;
  const screenH = w * sin + d * cos;
  const textW = estimateLabelWidth(name, LABEL_FONT_PX);
  if (textW > screenW * 0.92 || screenH < LABEL_FONT_PX + 8) return null;
  const cx = margin + (item.position.x + layout.width / 2) * scale;
  const cy = margin + (item.position.z + layout.height / 2) * scale;
  return { x: cx - textW / 2, y: cy - LABEL_FONT_PX / 2, w: textW, h: LABEL_FONT_PX };
}

function zoneLabelBox(zone: NonNullable<FloorLayout['zones']>[number], layout: RoomLayout, scale: number, margin: number): LabelBox {
  const nameW = estimateLabelWidth(zone.name, 12);
  const areaW = estimateLabelWidth(`${zoneArea(zone).toFixed(1)} m²`, 10);
  const textW = Math.max(nameW, areaW);
  const cx = margin + (zone.x + layout.width / 2) * scale + (zone.w * scale) / 2;
  const baseline = margin + (zone.z + layout.height / 2) * scale + 15;
  return { x: cx - textW / 2, y: baseline - 12, w: textW, h: 28 };
}

/**
 * Names worth drawing: they fit inside the footprint, stay clear of each
 * other, and yield to a zone title. Larger pieces win a shared spot, so a
 * table keeps its name and the chairs crowded against it stay quiet.
 */
function labeledFurnitureIds(
  layout: RoomLayout,
  floor: FloorLayout,
  furniture: readonly PlacedItem[],
  scale: number,
  margin: number,
  reserveZoneLabels: boolean
): Set<string> {
  const taken = reserveZoneLabels ? (floor.zones ?? []).map((zone) => zoneLabelBox(zone, layout, scale, margin)) : [];
  const ids = new Set<string>();
  const candidates = furniture
    .filter((item) => item.type !== 'stairs' && item.name.trim().length > 0)
    .slice()
    .sort((a, b) => b.width * b.depth - a.width * a.depth);
  for (const item of candidates) {
    const box = furnitureLabelBox(item, layout, scale, margin);
    if (!box || taken.some((other) => boxesOverlap(other, box, 6))) continue;
    taken.push(box);
    ids.add(item.id);
  }
  return ids;
}

/** Fixed 2-dp px precision, trailing zeros trimmed, never "-0" or NaN-ish. */
function fmt(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}

function escapeXml(input: string): string {
  return input.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
