import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { alignedTileCenter } from '../room-organizer/lib/basemap-alignment';
import { planPointToPixel } from '../room-organizer/lib/outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../room-organizer/lib/outdoor-project-store';
import { basemapSourceAttribution } from '../room-organizer/lib/tdt-probe';
import {
  fitReviewCamera,
  reviewPointAt,
  reviewTileSource,
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
    expect(reviewTileSource('map', camera.lng, camera.lat)).toBe('amap-streets');
    expect(reviewTileSource('light', camera.lng, camera.lat)).toBe('carto-light');
    expect(reviewTileSource('paper', camera.lng, camera.lat)).toBeNull();
    expect(reviewTiles({ style: 'paper', camera, width: 960, height: 640 })).toEqual([]);
  });

  it('uses Esri World Imagery for satellite, including a China anchor, without moving that anchor', () => {
    const anchor = { lng: 120.1460368, lat: 30.2521924, crs: 'gcj-02' as const, source: 'preset' as const };
    const plan = createStarterOutdoorPlan(anchor);
    const camera = fitReviewCamera(plan, 960, 640);
    expect(camera).not.toBeNull();
    if (!camera) return;
    expect(plan.anchor).toEqual(anchor);
    expect(camera.lng).toBeCloseTo(anchor.lng, 4);
    expect(camera.lat).toBeCloseTo(anchor.lat, 4);
    expect(reviewTileSource('satellite', camera.lng, camera.lat)).toBe('esri-satellite');
    const credit = basemapSourceAttribution('esri-satellite');
    expect(credit).toContain('Esri');
    expect(credit).toContain('World Imagery');
    expect(credit).not.toContain('高德');
    const tiles = reviewTiles({ style: 'satellite', camera, width: 960, height: 640 });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every(tile => tile.url.includes('/World_Imagery/MapServer/tile/'))).toBe(true);
    expect(tiles.some(tile => tile.url.includes('autonavi.com') || tile.url.includes('style=6'))).toBe(false);
    const center = tiles.reduce((best, tile) => {
      const dx = tile.left + tile.size / 2 - 480;
      const dy = tile.top + tile.size / 2 - 320;
      const dist = dx * dx + dy * dy;
      return dist < best.dist ? { tile, dist } : best;
    }, { tile: tiles[0]!, dist: Number.POSITIVE_INFINITY }).tile;
    const parts = center.url.split('/');
    const x = Number(parts.at(-1));
    const y = Number(parts.at(-2));
    const z = Number(parts.at(-3));
    const tileLng = ((x + 0.5) / 2 ** z) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
    const tileLat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    const wgs = alignedTileCenter(camera.lng, camera.lat, 'esri-satellite');
    const toWgs = Math.hypot(tileLng - wgs.lng, tileLat - wgs.lat);
    const toGcj = Math.hypot(tileLng - camera.lng, tileLat - camera.lat);
    expect(toWgs).toBeLessThan(toGcj);
  });

  it('still swaps an overseas street style onto OSM, and keeps overseas satellite on Esri', () => {
    expect(reviewTileSource('map', 2.3522, 48.8566)).toBe('osm');
    expect(reviewTileSource('satellite', 2.3522, 48.8566)).toBe('esri-satellite');
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

  it('styles 完成评审 as ink and 导出备份 as a text control', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../app/review/review-share-page.css'), 'utf8');
    expect(css).toContain('--ink: #141416');
    expect(css).toContain('--green: #4a7c59');
    expect(css).toContain('--r-lg: 18px');
    expect(css).toContain('--r-md: 14px');
    expect(css).toContain('--r-sm: 10px');
    expect(css).toContain('--e1: 0 6px 18px rgba(20, 20, 22, .10)');
    const primary = css.slice(css.indexOf('.rsp-primary {'), css.indexOf('.rsp-backup'));
    expect(primary).toContain('background: var(--ink)');
    expect(primary).not.toMatch(/#35624a|#4a7c59|var\(--brand\)|var\(--green\)/i);
    const backup = css.slice(css.indexOf('.rsp-backup {'), css.indexOf('.rsp-backup:hover'));
    expect(backup).toContain('background: transparent');
    expect(backup).toContain('border: 0');
    expect(css).toContain('height: 100dvh');
  });

  it('does not invent a map camera when the plan has no anchor', () => {
    const { anchor: _anchor, ...rest } = hangzhou;
    expect(fitReviewCamera({ ...rest }, 800, 600)).toBeNull();
  });
});
