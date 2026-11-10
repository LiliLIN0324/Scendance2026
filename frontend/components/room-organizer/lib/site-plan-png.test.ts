import { describe, expect, it } from 'vitest';
import {
  PNG_DPI_CHOICES,
  computeSnapshotLayout,
  legendEntryCount,
  northArrowGeometry,
  planBoundsM,
  scaleBarMeters,
  snapshotCaption,
} from './site-plan-png';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

function samplePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: { lng: 120.1443, lat: 30.2459, crs: 'gcj-02', source: 'picker' },
    boundary: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ],
    zones: [],
    facilities: [
      {
        id: 'b2000000-0000-4000-8000-000000000001',
        templateId: 'booth-2x2',
        name: '摊位',
        position: { x: 195, y: 115 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        notes: '',
      },
    ],
    routes: [
      {
        id: 'c3000000-0000-4000-8000-000000000001',
        kind: 'pedestrian',
        name: '动线',
        points: [
          { x: 0, y: 60 },
          { x: 55, y: 60 },
        ],
        oneWay: true,
        notes: '',
      },
    ],
    nodes: [],
    workers: [],
    measurements: [],
  } as unknown as SitePlanData;
}

describe('png snapshot layout (H5-a)', () => {
  it('computes bounds over every entity kind', () => {
    const bounds = planBoundsM(samplePlan());
    expect(bounds.minX).toBe(0);
    expect(bounds.maxX).toBe(200);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxY).toBe(120); // 设施 (195,115) 在边界内，不超 120。
  });

  it('lays out the canvas with padding and legend band', () => {
    const layout = computeSnapshotLayout(samplePlan(), { targetWidthPx: 1600 });
    expect(layout.canvasW).toBe(1600);
    // 内容宽 200+40*2=280 m → metersToPx=1600/280；内容高 120+80=200 m。
    expect(layout.metersToPx).toBeCloseTo(1600 / 280, 6);
    expect(layout.canvasH).toBe(Math.round(200 * 1600 / 280) + layout.legendHeight);
    expect(layout.legendHeight).toBeGreaterThanOrEqual(180);
  });

  it('counts legend entries for the legend band height', () => {
    expect(legendEntryCount(samplePlan())).toBeGreaterThan(0);
  });

  it('picks a clean 1/2/5×10^n scale bar', () => {
    const bar = scaleBarMeters(1600 / 280, 1600 / 6);
    const magnitude = 10 ** Math.floor(Math.log10(bar.meters));
    const normalized = bar.meters / magnitude;
    expect([1, 2, 5, 10]).toContain(normalized);
    expect(bar.px).toBeCloseTo(bar.meters * (1600 / 280), 6);
    expect(bar.label).toBeTruthy();
  });

  it('builds a north arrow pointing up', () => {
    const g = northArrowGeometry(100, 100, 20);
    expect(g.tip.y).toBeLessThan(g.left.y);
    expect(g.tip.y).toBeLessThan(g.right.y);
    expect(Math.abs(g.left.x - g.right.x)).toBeGreaterThan(0);
  });

  it('writes the caption with revision, dpi and OSM attribution', () => {
    const caption = snapshotCaption(7, 300, new Date('2026-11-10T14:00:00'));
    expect(caption).toContain('r7');
    expect(caption).toContain('300 DPI');
    expect(caption).toContain('OpenStreetMap');
  });

  it('offers 72 and 300 DPI', () => {
    expect(PNG_DPI_CHOICES).toEqual([72, 300]);
  });
});