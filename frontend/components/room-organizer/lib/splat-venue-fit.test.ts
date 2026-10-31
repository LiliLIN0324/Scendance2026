import { describe, expect, it } from 'vitest';
import { makeLayout } from './__testfixtures__/fixtures';
import { placeSplatPreview } from './splat-venue-fit';
import type { RoomLayout } from './types';

const HALL = { width: 18.2, depth: 12.4, height: 4 };

describe('placeSplatPreview', () => {
  it('resizes a plain indoor shell to the measured gaussian', () => {
    const placed = placeSplatPreview(makeLayout({ name: '室内宴会厅', width: 8, height: 6 }), '宴会厅', HALL);
    expect(placed.resize).toEqual({ width: 18.2, height: 12.4 });
    expect(placed.note).toContain('已按高斯实测 18.2 × 12.4 m 校准场地');
  });

  it('leaves the shell alone once it already matches', () => {
    const placed = placeSplatPreview(makeLayout({ width: 18.2, height: 12.4 }), '宴会厅', HALL);
    expect(placed.resize).toBeNull();
    expect(placed.note).toContain('校准场地');
  });

  it('does not resize a 盐官-style map venue, and says walk still works at eye height', () => {
    const layout = makeLayout({
      name: '盐官潮乐之城 · 规划区 84.6×100m（真实范围 846×1000m）',
      width: 84.6,
      height: 100,
      mapLngLat: { lng: 120.54, lat: 30.4 },
    });
    const placed = placeSplatPreview(layout, 'Scendance-M3-MVP', HALL);
    expect(placed.resize).toBeNull();
    expect(placed.note).toContain('没有改这块户外场地');
    expect(placed.note).toContain('第一人称走进场');
    expect(placed.note).not.toContain('校准场地');
  });

  it('keeps the shell when the measured box is unusable, and does not throw', () => {
    expect(placeSplatPreview(makeLayout(), '坏场景', { width: Number.NaN, depth: 4 }).resize).toBeNull();
    expect(placeSplatPreview(makeLayout(), '坏场景', { width: 0, depth: 4 }).note).toContain('尺寸保持不动');
    const huge = placeSplatPreview(makeLayout({ width: 12, height: 8 }), '巨厅', { width: 400, depth: 20 });
    expect(huge.resize).toBeNull();
    expect(huge.note).not.toContain('校准场地');
    expect(placeSplatPreview(makeLayout(), '预览', null).note).toContain('场地壳体已让位');
  });

  it('refuses a resize that would fail the geometry gate instead of throwing', () => {
    const layout = makeLayout({
      name: '已确认开间',
      width: 20,
      height: 12,
      backendSceneV2: {
        schemaVersion: 2,
        venue: { width: 20, depth: 12, height: 3, shape: 'rectangle', entrances: [] },
        objects: [],
        camera: 'overview',
        lighting: 'neutral',
        structure: { walls: [], openings: [], columns: [] },
        sources: [],
        dimensions: [{
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'width',
          valueMeters: 20,
          status: 'confirmed',
          label: '开间',
        }],
      } as NonNullable<RoomLayout['backendSceneV2']>,
    });
    const placed = placeSplatPreview(layout, '样例厅', HALL);
    expect(placed.resize).toBeNull();
    expect(placed.note).toContain('尺寸保持不动');
    expect(placed.note).toContain('第一人称走进场');
  });
});
