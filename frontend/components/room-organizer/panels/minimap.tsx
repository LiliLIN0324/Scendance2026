'use client';

import { PlanThumb } from './plan-thumb';
import type { FloorLayout, RoomLayout } from '../lib/types';
import type { ResolvedGround } from '../lib/plan-ground';

const MINIMAP_WIDTH = 180;
const MINIMAP_HEIGHT = 130;

export interface MinimapProps {
  layout: RoomLayout;
  floor: FloorLayout;
  selectedItemId: string | null;
  /** 贴地正源（S2 批 4）：小地图画的底图优先读正源，缺字段回退 layout 旧缓存。 */
  ground?: ResolvedGround | null | undefined;
}

export function Minimap({ layout, floor, selectedItemId, ground }: MinimapProps): JSX.Element {
  return (
    // Offset below the top-right pill stack (FloorPill + WallDisplayPill, at
    // top:16) so the minimap no longer overlaps them or the measurement /
    // wall-draw chips that share the same corner.
    <div
      className="absolute right-4 rounded-lg border bg-background/90 backdrop-blur-sm p-2 shadow"
      style={{ top: 128, zIndex: 20 }}
    >
      <p className="text-[10px] text-muted-foreground mb-1">{floor.name}</p>
      {/* Eager: always on screen. The tracing image is painted here and
          repainted when its async decode lands (#118) — the live house is the
          one the renderer's image cache belongs to. */}
      <PlanThumb
        layout={layout}
        floor={floor}
        selectedItemId={selectedItemId}
        ground={ground}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        showFloorPlan
        eager
        className="rounded"
      />
    </div>
  );
}
