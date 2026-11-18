'use client';

import { useState } from 'react';
import type { PlanLegendEntry, PlanLegendGroup } from '../lib/site-plan-legend';

/**
 * 地图图例只列已经画出来的条目。空红线（边界还没点够）不算一条，避免空方案也挂着入口。
 */
export function legendEntriesForMap(groups: readonly PlanLegendGroup[], boundaryPointCount: number): PlanLegendEntry[] {
  return groups.flatMap(group => group.entries).filter(entry => {
    if (entry.count <= 0) return false;
    if (entry.label === '用地红线' && boundaryPointCount < 3) return false;
    return true;
  });
}

export function MapLegendCapsule({ entries }: { entries: readonly PlanLegendEntry[] }): JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <div
      className="sc-map-legend"
      data-testid="map-legend"
      onMouseDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="sc-map-legend-panel"
        onClick={() => setOpen(value => !value)}
      >
        图例
      </button>
      {open && (
        <ul id="sc-map-legend-panel">
          {entries.map((entry, index) => (
            <li key={`${entry.label}-${entry.swatch}-${index}`} data-testid="legend-entry">
              <span className="sc-map-legend-swatch" style={{ background: entry.swatch }} aria-hidden="true" />
              <span>{entry.label}</span>
              <span className="sc-map-legend-count">{entry.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
