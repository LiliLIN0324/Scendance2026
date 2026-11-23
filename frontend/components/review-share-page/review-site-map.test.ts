import { describe, expect, it } from 'vitest';
import { createStarterOutdoorPlan } from '../room-organizer/lib/outdoor-project-store';
import { planPointToPixel } from '../room-organizer/lib/outdoor-plan-canvas';
import {
  fitReviewCamera,
  reviewPointAt,
  reviewTiles,
  reviewViewport,
} from './review-site-map';

const hangzhou = createStarterOutdoorPlan({
  lng: 120.138,
  lat: 30.254,
  crs: 'gcj-02',
  source: 'picker',
});
hangzhou.boundary = [
  { x: -40, y: -30 },
  { x: 80, y: -30 },
  { x: 80, y: 50 },
  { x: -40, y: 50 },
];

describe('review site map', () => {
  it('frames a Hangzhou anchor on the street basemap, not a blank schematic', () => {
    const camera = fitReviewCamera(hangzhou, 960, 640);
    expect(camera).not.toBeNull();
    if (!camera) return;
    expect(camera.lng).toBeGreaterThan(120.13);
    expect(camera.lng).toBeLessThan(120.15);
    expect(camera.lat).toBeGreaterThan(30.24);
    expect(camera.lat).toBeLessThan(30.27);
    const tiles = reviewTiles({ style: 'map', camera, width: 960, height: 640 });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.some(tile => tile.url.includes('webrd') && tile.url.includes('autonavi.com'))).toBe(true);
    const satellite = reviewTiles({ style: 'satellite', camera, width: 960, height: 640 });
    expect(satellite.some(tile => tile.url.includes('style=6'))).toBe(true);
    expect(new Set(satellite.map(tile => new URL(tile.url).host)).size).toBe(1);
    expect(satellite.every(tile => !tile.url.includes('arcgisonline') && !tile.url.includes('tianditu'))).toBe(true);
    expect(reviewTiles({ style: 'paper', camera, width: 960, height: 640 })).toEqual([]);
  });

  it('maps a click at the anchor back to the ENU origin', () => {
    const viewport = reviewViewport({
      anchorLng: 120.138,
      anchorLat: 30.254,
      camera: { lng: 120.138, lat: 30.254, zoom: 17 },
      width: 800,
      height: 600,
    });
    const origin = planPointToPixel({ x: 0, y: 0 }, viewport);
    expect(origin.x).toBeCloseTo(400, 0);
    expect(origin.y).toBeCloseTo(300, 0);
    const point = reviewPointAt({
      clientX: origin.x,
      clientY: origin.y,
      rect: { left: 0, top: 0, width: 800, height: 600 },
      viewport,
    });
    expect(point.x).toBeCloseTo(0, 1);
    expect(point.y).toBeCloseTo(0, 1);
  });

  it('does not invent a map camera when the plan has no anchor', () => {
    const { anchor: _anchor, ...rest } = hangzhou;
    expect(fitReviewCamera({ ...rest }, 800, 600)).toBeNull();
  });
});
