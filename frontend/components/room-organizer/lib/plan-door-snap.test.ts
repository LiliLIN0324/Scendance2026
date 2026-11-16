import { describe, expect, it } from 'vitest';
import type { PlanViewport } from './outdoor-plan-canvas';
import { planMetersPerPixel } from './outdoor-plan-canvas';
import { DOOR_SNAP_TOLERANCE_PX, snapDoorToIndoorEdge } from './plan-door-snap';

const viewport: PlanViewport = { lng: 120.15, lat: 30.25, zoom: 19, canvasW: 1200, canvasH: 800 };

/** 20×14 的室内分区，形心在 (10,7)。 */
const indoor = {
  id: 'zone-indoor',
  environment: 'indoor' as const,
  polygon: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 14 },
    { x: 0, y: 14 },
  ],
};

/** 把「离边多少像素」换成米（吸附阈值是像素，落点是米，这里要换算）。 */
const pxToMeters = (px: number) => px * planMetersPerPixel(viewport);

describe('snapDoorToIndoorEdge', () => {
  it('离边 5px 时吸到边上，坐标正好落在边线', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(5) },
      zones: [indoor],
      viewport,
    });
    expect(snap).not.toBeNull();
    expect(snap!.point.y).toBeCloseTo(0, 6);
    expect(snap!.point.x).toBeCloseTo(10, 6);
    expect(snap!.zoneId).toBe('zone-indoor');
  });

  it('角度等于那条边的法线（下边朝外 = -90°）', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(5) },
      zones: [indoor],
      viewport,
    })!;
    expect(snap.rotationDeg).toBeCloseTo(-90, 5);
  });

  it('换到右边时法线跟着转（朝外 = 0°）', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 20 - pxToMeters(4), y: 7 },
      zones: [indoor],
      viewport,
    })!;
    expect(snap.point.x).toBeCloseTo(20, 6);
    expect(snap.rotationDeg).toBeCloseTo(0, 5);
  });

  it('离边刚好 10px 仍吸；11px 就不吸了', () => {
    const at10 = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(DOOR_SNAP_TOLERANCE_PX) },
      zones: [indoor],
      viewport,
    });
    const at11 = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(11) },
      zones: [indoor],
      viewport,
    });
    expect(at10).not.toBeNull();
    expect(at11).toBeNull();
  });

  it('室外分区不吸（只有室内才有墙）', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(3) },
      zones: [{ ...indoor, id: 'zone-outdoor', environment: 'outdoor' }],
      viewport,
    });
    expect(snap).toBeNull();
  });

  it('室内外未知的分区也不吸（不猜）', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 10, y: pxToMeters(3) },
      zones: [{ ...indoor, environment: 'unknown' }],
      viewport,
    });
    expect(snap).toBeNull();
  });

  it('多条边都在阈值内时取最近那条', () => {
    // 角落附近：(0.4, 0.3) 米，离下边 0.3 m、离左边 0.4 m。
    const snap = snapDoorToIndoorEdge({
      pt: { x: 0.4, y: 0.3 },
      zones: [indoor],
      viewport,
    })!;
    expect(snap.point.y).toBeCloseTo(0, 6);
    expect(snap.point.x).toBeCloseTo(0.4, 6);
  });

  it('退化分区（不足三点）不参与吸附', () => {
    const snap = snapDoorToIndoorEdge({
      pt: { x: 0, y: 0 },
      zones: [{ id: 'z', environment: 'indoor', polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
      viewport,
    });
    expect(snap).toBeNull();
  });
});
