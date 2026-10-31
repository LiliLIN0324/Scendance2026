import { describe, expect, it } from 'vitest';
import { makeFloor, makeItem } from '../__testfixtures__/fixtures';
import {
  DEFAULT_PLAN_EXPORT_VISIBILITY,
  DXF_LAYER_COLOURS,
  DXF_LAYER_NAMES,
  planExportVisibility,
  planFloorSummary,
  planLengthLabel,
  PRINT_PLAN_EXPORT_VISIBILITY,
} from './export-visibility';

describe('plan export layers', () => {
  it('uses the openPlan3D layer names and ACI colours this editor can fill', () => {
    expect(DXF_LAYER_NAMES).toEqual(['WALLS', 'DOORS', 'WINDOWS', 'FURNITURE', 'DIMENSIONS', 'ROOMS', 'STAIRS']);
    expect(DXF_LAYER_COLOURS).toEqual({
      WALLS: 7,
      DOORS: 30,
      WINDOWS: 5,
      FURNITURE: 3,
      DIMENSIONS: 8,
      ROOMS: 4,
      STAIRS: 8,
    });
  });

  it('keeps room width × depth off the default drawing and on for print', () => {
    expect(DEFAULT_PLAN_EXPORT_VISIBILITY.roomDimensions).toBe(false);
    expect(PRINT_PLAN_EXPORT_VISIBILITY.roomDimensions).toBe(true);
    expect(planExportVisibility({ doors: false }).doors).toBe(false);
    expect(planExportVisibility({ doors: false }).walls).toBe(true);
    expect(planLengthLabel(8)).toBe('8 m');
    expect(planLengthLabel(8.5)).toBe('8.5 m');
  });

  it('counts the whole floor, including props a drawing switch might hide', () => {
    const floor = makeFloor({
      items: [
        makeItem({ type: 'door' }),
        makeItem({ type: 'window' }),
        makeItem({ type: 'stairs' }),
        makeItem({ type: 'sofa' }),
      ],
      interiorWalls: [{ id: 'iw', x1: 0, z1: 0, x2: 1, z2: 0 }],
      zones: [{ id: 'z', name: 'Stage', color: '#4A7C59', x: 0, z: 0, w: 2, d: 2 }],
    });
    expect(planFloorSummary(floor)).toBe('1 zones · 1 partitions · 1 doors · 1 windows · 1 props · 1 stairs');
  });
});
