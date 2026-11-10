import { FURNITURE_CATALOG } from './constants';
import { DEFAULT_RECT_TABLE_M, DEFAULT_ROUND_DIAMETER_M } from './table-seat-plan';
import type { SetItemSnapshot } from './furniture-sets';

/**
 * Selection tool. It decides what the tables look like.
 * Placement, seat counts, and collisions stay in the layout tools.
 */
export const SELECT_FURNISHING_TOOL = 'select_furnishing' as const;

export type FurnishingShape = 'round' | 'rect' | 'long';

export interface FurnishingChoice {
  source: typeof SELECT_FURNISHING_TOOL;
  shape: FurnishingShape;
  width: number;
  depth: number;
  material: { rim: 'wood'; top: 'linen' | 'bare' };
  /** Existing catalog name. This tool does not invent a GLB library. */
  assetName: string;
  chairName: string;
  color: string;
  reason: string;
}

export interface MaterializedFurnishing {
  table: SetItemSnapshot;
  chair: SetItemSnapshot;
}

export interface FurnishingRequest {
  occasion: string | null;
  notes: string;
  statedShape?: FurnishingShape;
  statedWidth?: number;
  statedDepth?: number;
}

const LONG_TABLE = { width: 2.4, depth: 0.9 };
const SQUARE_TABLE = { width: 1.4, depth: 1.4 };

function festive(text: string): boolean {
  return /生日|宴|婚|派对|聚会|答谢|年会|晚宴|酒会/.test(text);
}

/** Reason about the occasion, then name one existing table asset. */
export function selectFurnishing(input: FurnishingRequest): FurnishingChoice {
  const blob = `${input.occasion ?? ''}${input.notes}`;
  const party = festive(blob);
  let shape: FurnishingShape;
  if (input.statedShape) shape = input.statedShape;
  else if (/长桌|长条/.test(blob)) shape = 'long';
  else if (/方桌/.test(blob)) shape = 'rect';
  else if (/圆桌|围着坐|围坐|围成/.test(blob) || party) shape = 'round';
  else shape = 'round';

  let width: number;
  let depth: number;
  if (shape === 'round') {
    const diameter = input.statedWidth ?? input.statedDepth ?? DEFAULT_ROUND_DIAMETER_M;
    width = diameter;
    depth = diameter;
  } else if (shape === 'long') {
    width = input.statedWidth ?? LONG_TABLE.width;
    depth = input.statedDepth ?? (input.statedWidth ? DEFAULT_RECT_TABLE_M.depth : LONG_TABLE.depth);
  } else {
    width = input.statedWidth ?? SQUARE_TABLE.width;
    depth = input.statedDepth ?? SQUARE_TABLE.depth;
  }
  const top: 'linen' | 'bare' = party || shape === 'round' ? 'linen' : 'bare';
  const assetName = shape === 'round' ? '圆桌' : 'Dining Table';
  const finish = top === 'linen' ? '木边、亚麻面' : '木面';
  const label = shape === 'round'
    ? `圆桌，直径 ${width.toFixed(2)} 米，${finish}`
    : `${shape === 'long' ? '长桌' : '方桌'} ${width.toFixed(2)}×${depth.toFixed(2)} 米，${finish}`;
  const reason = `${input.occasion ? `${input.occasion}，` : ''}选用${label}。`.slice(0, 200);
  return {
    source: SELECT_FURNISHING_TOOL,
    shape,
    width,
    depth,
    material: { rim: 'wood', top },
    assetName,
    chairName: 'Dining Chair',
    color: top === 'linen' ? '#A0522D' : '#8D6E63',
    reason,
  };
}

/** Drop a saved selection when a later sentence names a different size or shape. */
export function layoutFurnishing(
  choice: FurnishingChoice | undefined,
  table?: { shape?: 'round' | 'rect' | undefined; width?: number | undefined; depth?: number | undefined },
): FurnishingChoice | undefined {
  if (!choice) return undefined;
  if (table?.width !== undefined && Math.abs(table.width - choice.width) > 0.02) return undefined;
  if (table?.depth !== undefined && Math.abs(table.depth - choice.depth) > 0.02) return undefined;
  if (table?.shape === 'round' && choice.shape !== 'round') return undefined;
  if (table?.shape === 'rect' && choice.shape === 'round') return undefined;
  return choice;
}

/** Turn a selection into catalog snapshots. Unknown names are refused, not replaced. */
export function materializeFurnishing(choice: FurnishingChoice): MaterializedFurnishing | null {
  const tableEntry = FURNITURE_CATALOG.find(entry => entry.name === choice.assetName);
  const chairEntry = FURNITURE_CATALOG.find(entry => entry.name === choice.chairName);
  if (!tableEntry || !chairEntry) return null;
  const tableShape = choice.shape === 'round' ? 'round' as const : 'rect' as const;
  const name = choice.shape === 'round' ? '圆桌' : choice.shape === 'long' ? '长桌' : '方桌';
  return {
    table: { ...tableEntry, name, width: choice.width, depth: choice.depth, color: choice.color, tableShape, tableFinish: choice.material.top },
    chair: { ...chairEntry, name: '餐椅' },
  };
}
