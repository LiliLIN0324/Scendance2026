/**
 * Plan-export layers and visibility for an event layout.
 *
 * Names, ACI colours and which switch hides which drawing follow openPlan3D
 * `src/lib/utils/cadExport.ts` and `exportVisibility.ts`. This file does not
 * import that pipeline. Layers openPlan3D draws for content this editor does
 * not store (DOORS_HIDDEN, TEXT_{hex}, MEASUREMENTS, MEASUREMENT_LABELS,
 * ENTOURAGE, COLUMNS) are not declared.
 *
 * Before → after, for the same geometry:
 * - WALLS stays WALLS (shell outline).
 * - INTERIOR joins WALLS (one walls switch).
 * - OPENINGS splits into DOORS and WINDOWS.
 * - FURNITURE stays FURNITURE; prop names move here off LABELS.
 * - LABELS (sheet title) and zone name/area become ROOMS.
 * - External width and depth become DIMENSIONS.
 * - Stair symbols and the STAIRWELL void become STAIRS.
 */

import type { FloorLayout } from '../types';

export const DXF_LAYER_NAMES = ['WALLS', 'DOORS', 'WINDOWS', 'FURNITURE', 'DIMENSIONS', 'ROOMS', 'STAIRS'] as const;

export type DxfLayerName = (typeof DXF_LAYER_NAMES)[number];

/** ACI colours from openPlan3D's LAYER_COLORS. STAIRS is ACI 8 there as well. */
export const DXF_LAYER_COLOURS: Record<DxfLayerName, number> = {
  WALLS: 7,
  DOORS: 30,
  WINDOWS: 5,
  FURNITURE: 3,
  DIMENSIONS: 8,
  ROOMS: 4,
  STAIRS: 8,
};

/**
 * What a plan file draws. Defaults match a fully visible plan.
 * `roomDimensions` is the print title block's width × depth; SVG and DXF
 * leave that field to the print sheet (openPlan3D draws it on the print
 * layout only). `wallDimensions` is the external width and depth on DIMENSIONS.
 */
export interface PlanExportVisibility {
  walls: boolean;
  doors: boolean;
  windows: boolean;
  /** Props and other footprints. Stair symbols use `stairs`. */
  furniture: boolean;
  stairs: boolean;
  /** Zone name and area stay together. The sheet title is not part of this switch. */
  roomLabels: boolean;
  wallDimensions: boolean;
  roomDimensions: boolean;
}

export const DEFAULT_PLAN_EXPORT_VISIBILITY: PlanExportVisibility = {
  walls: true,
  doors: true,
  windows: true,
  furniture: true,
  stairs: true,
  roomLabels: true,
  wallDimensions: true,
  roomDimensions: false,
};

/** Print opts into the title-block footprint; every other switch stays on. */
export const PRINT_PLAN_EXPORT_VISIBILITY: PlanExportVisibility = {
  ...DEFAULT_PLAN_EXPORT_VISIBILITY,
  roomDimensions: true,
};

export function planExportVisibility(partial?: Partial<PlanExportVisibility>): PlanExportVisibility {
  return { ...DEFAULT_PLAN_EXPORT_VISIBILITY, ...partial };
}

/** Metre label for plan text. Trims trailing zeros. This is an edge length, not a per-prop size readout. */
export function planLengthLabel(metres: number): string {
  const rounded = Math.round(metres * 100) / 100;
  const text = (Object.is(rounded, -0) ? 0 : rounded).toString();
  return `${text} m`;
}

/**
 * Counts for the print title block. Uses the whole floor, including anything
 * a visibility switch left out of the drawing (openPlan3D's PDF summary does
 * the same).
 */
export function planFloorSummary(floor: FloorLayout): string {
  let doors = 0;
  let windows = 0;
  let stairs = 0;
  let props = 0;
  for (const item of floor.items) {
    if (item.type === 'door') doors += 1;
    else if (item.type === 'window') windows += 1;
    else if (item.type === 'stairs') stairs += 1;
    else props += 1;
  }
  const zones = floor.zones?.length ?? 0;
  const partitions = floor.interiorWalls?.length ?? 0;
  return `${zones} zones · ${partitions} partitions · ${doors} doors · ${windows} windows · ${props} props · ${stairs} stairs`;
}
