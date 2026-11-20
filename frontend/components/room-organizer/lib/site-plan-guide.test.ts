import { describe, expect, it } from 'vitest';
import {
  DELIVERY_AUDIENCES,
  DELIVERY_EXPORT_ITEMS,
  DELIVERY_SEGMENTS,
  enabledDeliveryExports,
  futureDeliveryExports,
  segmentVisible,
} from './site-plan-guide';

describe('unified delivery panel (outdoor)', () => {
  it('exposes three lightweight audiences with labels and notes', () => {
    expect(DELIVERY_AUDIENCES.map(aud => aud.id)).toEqual(['client', 'review', 'internal']);
    for (const aud of DELIVERY_AUDIENCES) {
      expect(aud.label.length).toBeGreaterThan(0);
      expect(aud.note.length).toBeGreaterThan(4);
    }
  });

  it('hides segments according to the selected audience', () => {
    const online = DELIVERY_SEGMENTS.find(seg => seg.id === 'online')!;
    const review = DELIVERY_SEGMENTS.find(seg => seg.id === 'review')!;
    const exportSeg = DELIVERY_SEGMENTS.find(seg => seg.id === 'export')!;
    expect(DELIVERY_AUDIENCES.map(aud => aud.id)).toContain('client');
    for (const aud of ['client', 'review', 'internal'] as const) {
      expect(segmentVisible(online, aud)).toBe(true);
    }
    expect(segmentVisible(review, 'client')).toBe(false);
    expect(segmentVisible(review, 'review')).toBe(true);
    expect(segmentVisible(review, 'internal')).toBe(true);
    expect(segmentVisible(exportSeg, 'client')).toBe(true);
    expect(segmentVisible(exportSeg, 'review')).toBe(false);
    expect(segmentVisible(exportSeg, 'internal')).toBe(true);
  });

  it('marks export availability by the real outdoor backend', () => {
    expect(enabledDeliveryExports.map(item => item.id)).toEqual(['png', 'csv', 'geojson', 'pdf']);
    expect(futureDeliveryExports.map(item => item.id)).toEqual(['album', 'handoff']);
    for (const item of futureDeliveryExports) {
      expect(item.enabled).toBe(false);
      expect(item.disabledHint?.length).toBeGreaterThan(0);
    }
    for (const item of enabledDeliveryExports) {
      expect(item.enabled).toBe(true);
      expect(item.label.length).toBeGreaterThan(1);
      expect(item.desc.length).toBeGreaterThan(3);
    }
  });

  it('keeps PNG view and scale parameter options', () => {
    const png = DELIVERY_EXPORT_ITEMS.find(item => item.id === 'png')!;
    const view = png.params?.find(group => group.optionsKey === 'view');
    const scale = png.params?.find(group => group.optionsKey === 'scale');
    expect(view?.options).toEqual(['跟随当前', '整体', '俯视', '正面', '对角']);
    expect(scale?.options).toEqual(['1080p', '4K', '6K']);
  });
});