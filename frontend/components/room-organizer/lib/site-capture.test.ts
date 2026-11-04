import { describe, expect, it } from 'vitest';
import { metersPerDegreeLng, METERS_PER_DEGREE_LAT, type AmapPoint } from './amap-venue';
import {
  applyLanding,
  calibrateScanScale,
  capturePlan,
  capturePlanAlongFlow,
  capturePlanFileName,
  capturePlanForVenue,
  capturePlanSheetHtml,
  clearSiteCalibration,
  defaultGuestFlow,
  groundFromHeight,
  groundFromThreePoints,
  groundHeightAt,
  inspectScanAgainstSite,
  landingCorrections,
  nearestAnchor,
  readSiteCalibration,
  snapToAnchor,
  writeSiteCalibration,
  VIDEO_SPACING,
  type GroundAnchor,
} from './site-capture';

/** 从 (0,0) 起、宽 w 米深 d 米的矩形，换成高德经纬度（盐官一带纬度）。 */
function rect(w: number, d: number, west = 120.53, south = 30.4): AmapPoint[] {
  const kx = metersPerDegreeLng(south);
  return [
    { lng: west, lat: south },
    { lng: west + w / kx, lat: south },
    { lng: west + w / kx, lat: south + d / METERS_PER_DEGREE_LAT },
    { lng: west, lat: south + d / METERS_PER_DEGREE_LAT },
  ];
}

describe('site capture plan', () => {
  it('splits a 12 × 8 shell into a twelve-stop ring with twenty photos', () => {
    const plan = capturePlan(rect(12, 8));
    expect(plan.perimeter).toBeCloseTo(40, 0);
    expect(plan.stops).toHaveLength(12);
    expect(plan.shots).toBe(24);
    expect(plan.preferVideo).toBe(false);
    expect(plan.mode).toBe('boundary');
    expect(plan.spacing).toBeLessThanOrEqual(VIDEO_SPACING);
  });

  it('puts every stop on the boundary and aims it at the site', () => {
    const polygon = rect(12, 8);
    const plan = capturePlan(polygon);
    expect(plan.stops[0]).toMatchObject({ index: 1, bearing: 56, compass: '东北' });
    expect(plan.stops[0]!.lng).toBeCloseTo(polygon[0]!.lng, 5);
    expect(plan.stops[0]!.lat).toBeCloseTo(polygon[0]!.lat, 5);
    const south = Math.min(...polygon.map(p => p.lat));
    const north = Math.max(...polygon.map(p => p.lat));
    const west = Math.min(...polygon.map(p => p.lng));
    const east = Math.max(...polygon.map(p => p.lng));
    for (const stop of plan.stops) {
      expect(stop.lat).toBeGreaterThanOrEqual(south - 1e-5);
      expect(stop.lat).toBeLessThanOrEqual(north + 1e-5);
      expect(stop.lng).toBeGreaterThanOrEqual(west - 1e-5);
      expect(stop.lng).toBeLessThanOrEqual(east + 1e-5);
      expect(stop.bearing).toBeGreaterThanOrEqual(0);
      expect(stop.bearing).toBeLessThan(360);
    }
  });

  it('switches a block too big to walk into a video orbit', () => {
    const plan = capturePlan(rect(400, 200));
    expect(plan.stops).toHaveLength(24);
    expect(plan.perimeter).toBeCloseTo(1200, -1);
    expect(plan.preferVideo).toBe(true);
    expect(plan.spacing).toBeGreaterThan(VIDEO_SPACING);
  });

  it('refuses a boundary it cannot stand on', () => {
    expect(capturePlan([{ lng: 120.5, lat: 30.4 }]).stops).toEqual([]);
    expect(capturePlan(rect(0.2, 0.2)).stops).toEqual([]);
  });

  it('prints a one-page sheet with the stops and their coordinates', () => {
    const polygon = rect(12, 8);
    const html = capturePlanSheetHtml(capturePlan(polygon), polygon, { name: '盐官潮乐之城', location: '海宁盐官' });
    expect(html).toContain('<title>盐官潮乐之城 · 海宁盐官 · 场地采集单</title>');
    expect(html).toContain('<td>东北 56°</td>');
    expect(html.match(/<tr>/g)).toHaveLength(13);
    expect(html).not.toContain('建议直接录一段绕场视频');
    expect(html).toContain('<svg class="sheet-plan"');
  });

  it('warns on the sheet when the ring should be a video', () => {
    const polygon = rect(400, 200);
    expect(capturePlanSheetHtml(capturePlan(polygon), polygon, { name: '潮乐之城' })).toContain('建议直接录一段绕场视频');
  });

  it('keeps the site name in the download but drops characters Windows rejects', () => {
    expect(capturePlanFileName('盐官/潮乐:之城')).toBe('盐官 潮乐 之城-采集单.html');
    expect(capturePlanFileName('   ')).toBe('场地-采集单.html');
  });
});

describe('D1 flow-line densify', () => {
  it('default guest flow runs the long axis through the center', () => {
    const polygon = rect(12, 8);
    const flow = defaultGuestFlow(polygon);
    expect(flow).toHaveLength(2);
    const latMid = (Math.min(...polygon.map(p => p.lat)) + Math.max(...polygon.map(p => p.lat))) / 2;
    expect(flow[0]!.lat).toBeCloseTo(latMid, 5);
    expect(flow[1]!.lat).toBeCloseTo(latMid, 5);
    expect(flow[0]!.lng).toBeLessThan(flow[1]!.lng);
  });

  it('densifies stops along the flow, not only on the boundary', () => {
    const polygon = rect(12, 8);
    const flow = defaultGuestFlow(polygon);
    const plan = capturePlanAlongFlow(polygon, flow);
    expect(plan.mode).toBe('flow');
    expect(plan.flowLength).toBeGreaterThan(8);
    expect(plan.flowLength).toBeLessThan(12);
    expect(plan.stops.length).toBeGreaterThanOrEqual(8);
    expect(plan.shots).toBe(plan.stops.length * 2);
    expect(plan.spacing).toBeLessThanOrEqual(VIDEO_SPACING);
    // 站位应落在场地 bbox 内，且大致贴着中线（不是四个角那种边界环）。
    const latMid = (Math.min(...polygon.map(p => p.lat)) + Math.max(...polygon.map(p => p.lat))) / 2;
    for (const stop of plan.stops) {
      expect(Math.abs(stop.lat - latMid)).toBeLessThan(1e-4);
    }
    // 镜头朝东（沿长轴前进）。
    expect(plan.stops[0]!.bearing).toBeGreaterThanOrEqual(70);
    expect(plan.stops[0]!.bearing).toBeLessThanOrEqual(110);
  });

  it('capturePlanForVenue prefers a hand-drawn flow over the default', () => {
    const polygon = rect(12, 8);
    const custom: AmapPoint[] = [
      { lng: polygon[0]!.lng, lat: polygon[0]!.lat },
      { lng: polygon[2]!.lng, lat: polygon[2]!.lat },
    ];
    const plan = capturePlanForVenue(polygon, custom);
    expect(plan.mode).toBe('flow');
    expect(plan.flow).toHaveLength(2);
    expect(plan.flow![0]!.lng).toBeCloseTo(custom[0]!.lng, 5);
  });

  it('without a flow argument still emits flow-mode stops via the default axis', () => {
    const polygon = rect(12, 8);
    const plan = capturePlanForVenue(polygon);
    expect(plan.mode).toBe('flow');
    expect(plan.stops.length).toBeGreaterThanOrEqual(8);
    expect(plan.flow?.length).toBeGreaterThanOrEqual(2);
  });

  it('sheet for flow mode draws the polyline and says 沿主客流线', () => {
    const polygon = rect(12, 8);
    const plan = capturePlanForVenue(polygon);
    const html = capturePlanSheetHtml(plan, polygon, { name: '盐官潮乐之城', location: '海宁盐官' });
    expect(html).toContain('沿主客流线');
    expect(html).toContain('polyline class="flow"');
    expect(html).toContain('流线长');
    expect(html).toContain('禁止把高德瓦片、卫星截图当重建素材');
  });
});

describe('scan scale calibration', () => {
  it('turns 「场地宽 12 m」 into a real-metre multiplier and flags the deviation', () => {
    const result = calibrateScanScale({ axis: 'x', knownMeters: 12, scan: { width: 30, depth: 20, height: 6 } });
    expect(result).not.toBeNull();
    expect(result!.scale).toBeCloseTo(0.4, 3);
    expect(result!.deviationPct).toBe(-60);
    expect(result!.confidence).toBe('suspect');
    expect(result!.note).toContain('偏差 −60%');
    expect(result!.reference).toEqual({ axis: 'x', knownMeters: 12, measuredMeters: 30 });
  });

  it('treats a near-1:1 scan as trustworthy and a small mismatch as coarse', () => {
    expect(calibrateScanScale({ axis: 'z', knownMeters: 22, scan: { width: 30, depth: 20, height: 6 } })!.confidence).toBe('ok');
    const coarse = calibrateScanScale({ axis: 'z', knownMeters: 25, scan: { width: 30, depth: 20, height: 6 } });
    expect(coarse!.scale).toBeCloseTo(1.25, 3);
    expect(coarse!.confidence).toBe('coarse');
  });

  it('refuses unusable input instead of silently scaling by garbage', () => {
    expect(calibrateScanScale({ axis: 'x', knownMeters: 0, scan: { width: 30, depth: 20, height: 6 } })).toBeNull();
    expect(calibrateScanScale({ axis: 'y', knownMeters: 3, scan: { width: 30, depth: 20, height: 0 } })).toBeNull();
  });

  it('inspects scan vs shell and only warns when they clearly disagree', () => {
    expect(inspectScanAgainstSite({ width: 12, depth: 8, height: 4 }, { width: 12, depth: 8 }).status).toBe('ok');
    expect(inspectScanAgainstSite({ width: 30, depth: 8, height: 4 }, { width: 12, depth: 8 }).status).toBe('error');
  });
});

describe('ground plane', () => {
  it('restores a flat plane at a given height', () => {
    expect(groundHeightAt(groundFromHeight(0.15), 3, -2)).toBe(0.15);
    expect(groundFromHeight(1.2).definedBy).toBe('height');
  });

  it('builds a tilted plane from three points and evaluates height per position', () => {
    const plane = groundFromThreePoints(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 1, z: 0 },
      { x: 0, y: 0, z: 10 },
    );
    expect(plane).not.toBeNull();
    // 沿 +X 每米抬 0.1 m。
    expect(groundHeightAt(plane, 10, 0)).toBeCloseTo(1, 5);
    expect(groundHeightAt(plane, 5, 5)).toBeCloseTo(0.5, 5);
    expect(plane!.definedBy).toBe('points');
  });

  it('rejects collinear points', () => {
    expect(groundFromThreePoints(
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
    )).toBeNull();
  });
});

describe('anchors and landing', () => {
  const anchors: GroundAnchor[] = [
    { id: 'anchor-1', label: '舞台位', kind: 'stage', x: 2, z: 0 },
    { id: 'anchor-2', label: '入口', kind: 'entrance', x: -4, z: 3 },
  ];

  it('snaps only inside the radius and keeps the nearest anchor', () => {
    expect(nearestAnchor(anchors, 1.2, 0, 1.2)?.anchor.id).toBe('anchor-1');
    expect(nearestAnchor(anchors, 3.5, 0, 1.2)).toBeNull();
    expect(snapToAnchor(anchors, 2.2, 0)?.label).toBe('舞台位');
  });

  it('lands floating / sunk items on the ground plane and respects centre-origin offsets', () => {
    const corrections = landingCorrections([
      { id: 'stage', position: { x: 0, z: 0 }, elevation: 0.8 },
      { id: 'lamp', position: { x: 5, z: 0 }, elevation: 0.4, baseOffsetM: 0.5 },
      { id: 'sunk', position: { x: 0, z: 0 }, elevation: 0 },
    ], groundFromHeight(0.15), { floorY: 0 });
    expect(corrections.map(item => item.id)).toEqual(['stage', 'lamp', 'sunk']);
    expect(corrections[0]!.afterY).toBeCloseTo(0.15, 5);
    expect(corrections[0]!.deltaY).toBeCloseTo(-0.65, 5);
    expect(corrections[1]!.afterY).toBeCloseTo(0.65, 5);
    expect(corrections[2]!.afterY).toBeCloseTo(0.15, 5);
  });

  it('folds the plan back into elevations for onApply', () => {
    const items = [{ id: 'stage', position: { x: 0, z: 0 }, elevation: 0.8 }];
    const corrections = landingCorrections(items, groundFromHeight(0.15));
    const next = applyLanding(items, corrections);
    expect(next[0]!.elevation).toBeCloseTo(0.15, 5);
  });
});

describe('scene calibration persistence', () => {
  it('round-trips scale, yaw, ground and anchors, and clears per asset', () => {
    const values = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    };
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = fakeWindow;
    try {
      writeSiteCalibration({
        version: 1,
        assetId: 'asset-lake',
        scale: 0.4,
        yawDeg: 12.5,
        origin: { x: 1.2, z: -0.8 },
        ground: groundFromHeight(0.15),
        anchors: [{ id: 'anchor-1', label: '舞台位', kind: 'stage', x: 2, z: 0 }],
        reference: { axis: 'x', knownMeters: 12, measuredMeters: 30 },
        updatedAt: 0,
      });
      const restored = readSiteCalibration('asset-lake');
      expect(restored).not.toBeNull();
      expect(restored!.scale).toBeCloseTo(0.4, 5);
      expect(restored!.yawDeg).toBeCloseTo(12.5, 5);
      expect(restored!.origin).toEqual({ x: 1.2, z: -0.8 });
      expect(restored!.ground.y).toBeCloseTo(0.15, 5);
      expect(restored!.anchors).toHaveLength(1);
      expect(restored!.reference).toEqual({ axis: 'x', knownMeters: 12, measuredMeters: 30 });
      expect(readSiteCalibration('asset-other')).toBeNull();
      clearSiteCalibration('asset-lake');
      expect(readSiteCalibration('asset-lake')).toBeNull();
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });
});
