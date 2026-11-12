import type { TableShape } from './types';

/** A tabletop that should read as a circle in mesh, plan, and preview outline. */
export function isRoundTable(item: {
  tableShape?: TableShape | string | undefined;
  name?: string | undefined;
  width?: number | undefined;
  depth?: number | undefined;
}): boolean {
  if (item.tableShape === 'rect') return false;
  if (item.tableShape === 'round') return true;
  // Older 圆桌 placements stored a square box and no shape flag. A square
  // footprint with that name is the banquet table, not a rectangular slab.
  if (item.name !== '圆桌') return false;
  if (typeof item.width !== 'number' || typeof item.depth !== 'number') return false;
  return Math.abs(item.width - item.depth) <= 0.02;
}

/** Diameter of the circular top. The stored width/depth remain its bounding square. */
export function roundTableDiameter(item: { width: number; depth: number }): number {
  return Math.min(item.width, item.depth);
}
