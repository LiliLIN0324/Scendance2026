import { describe, expect, it } from 'vitest';
import { layoutForExport } from './layout-export';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const summary = { taskCount: 1, acquisitionCount: 0, staffingCount: 0, estimateCount: 0,
  itemCount: 1, chairCount: 0, tableCount: 0, otherItemCount: 1, zoneCount: 0, headcount: 8 };

function withVariantSlots(): RoomLayout {
  const variant = {
    id: 'variant-1',
    name: '提案一',
    layout: makeLayout(),
    operationsRef: '22222222-2222-4222-8222-222222222221',
    planRef: '22222222-2222-4222-9222-222222222222',
    scan: { assetId: 'scan-asset-1', name: '场地扫描' },
    summary,
  };
  return makeLayout({ designBook: { activeId: 'variant-1', variants: [variant] } });
}

describe('export payload sidecar pointer stripping (D6-4-3)', () => {
  it('strips variant refs and scan identity on outbound shares, keeps the frozen summary labels', () => {
    const source = withVariantSlots();
    const exported = layoutForExport(source, true);
    const variant = exported.designBook!.variants[0]!;
    expect(variant).not.toHaveProperty('operationsRef');
    expect(variant).not.toHaveProperty('planRef');
    expect(variant).not.toHaveProperty('scan');
    expect(variant.summary).toEqual(summary);
  });

  it('keeps variant refs, scan and summary for internal exports', () => {
    const source = withVariantSlots();
    const exported = layoutForExport(source);
    const variant = exported.designBook!.variants[0]!;
    expect(variant.operationsRef).toBe('22222222-2222-4222-8222-222222222221');
    expect(variant.planRef).toBe('22222222-2222-4222-9222-222222222222');
    expect(variant.scan).toEqual({ assetId: 'scan-asset-1', name: '场地扫描' });
    expect(variant.summary).toEqual(summary);
  });

  it('does not mutate the source layout', () => {
    const source = withVariantSlots();
    const before = structuredClone(source);
    layoutForExport(source, true);
    expect(source).toEqual(before);
  });
});
