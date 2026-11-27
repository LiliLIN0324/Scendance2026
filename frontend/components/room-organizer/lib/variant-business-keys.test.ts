import { describe, expect, it } from 'vitest';
import { handoffSchema } from '../../../../supabase/functions/_shared/delivery-contract';
import { makeFloor, makeItem, makeLayout, makeZone } from './__testfixtures__/fixtures';
import type { RoomLayout } from './types';
import { stripVariantBusinessKeys } from './variant-business-keys';

const acceptedHandoff = () => handoffSchema.parse({
  ownerName: '陈师傅',
  dueDate: '2026-10-08',
  acceptance: '宽度和摆放点核对通过',
  status: 'accepted',
  evidenceUrls: ['https://example.com/evidence/1'],
  evidenceNote: '现场照片与尺寸已核对',
  reviewedBasis: 'test-basis',
});

function layoutWithBusinessKeys(): RoomLayout {
  return makeLayout({
    floors: [makeFloor({
      zones: [makeZone()],
      items: [makeItem({ id: 'table-1', handoff: acceptedHandoff() })],
    })],
    terrain: { frontY: 0, backY: 0.3 },
    entrance: { width: 1.2, depth: 0.6 },
    eventOperations: { tasks: [] } as unknown as RoomLayout['eventOperations'],
    productionPlan: {} as unknown as RoomLayout['productionPlan'],
    venueScan: { assetId: 'scan-0001', name: '旧场地' },
  });
}

describe('stripVariantBusinessKeys (T1 纯层)', () => {
  it('removes eventOperations, productionPlan and venueScan from the snapshot', () => {
    const stripped = stripVariantBusinessKeys(layoutWithBusinessKeys());
    expect(stripped).not.toHaveProperty('eventOperations');
    expect(stripped).not.toHaveProperty('productionPlan');
    expect(stripped).not.toHaveProperty('venueScan');
  });

  it('keeps item handoff and floor geometry intact', () => {
    const stripped = stripVariantBusinessKeys(layoutWithBusinessKeys());
    const item = stripped.floors[0]!.items[0]!;
    expect(item.handoff).toEqual(acceptedHandoff());
    expect(item.id).toBe('table-1');
    expect(stripped.floors[0]!.zones).toHaveLength(1);
  });

  it('keeps floors, zones, entrance, terrain and roof state', () => {
    const source = layoutWithBusinessKeys();
    const stripped = stripVariantBusinessKeys(source);
    expect(stripped.floors).toEqual(source.floors);
    expect(stripped.entrance).toEqual(source.entrance);
    expect(stripped.terrain).toEqual(source.terrain);
    expect(stripped.roof).toEqual(source.roof);
  });

  it('preserves unknown extra fields without whitelist slimming', () => {
    const source = { ...layoutWithBusinessKeys(), customFlag: 'keep-me', draftNote: 42 } as RoomLayout & { customFlag: string; draftNote: number };
    const stripped = stripVariantBusinessKeys(source);
    expect((stripped as { customFlag: string }).customFlag).toBe('keep-me');
    expect((stripped as { draftNote: number }).draftNote).toBe(42);
  });

  it('tolerates missing or undefined business keys without throwing', () => {
    const bare = makeLayout();
    expect(() => stripVariantBusinessKeys(bare)).not.toThrow();
    const stripped = stripVariantBusinessKeys(bare);
    expect(stripped.floors).toEqual(bare.floors);
    expect(stripped).not.toHaveProperty('eventOperations');
    expect(stripped).not.toHaveProperty('productionPlan');
    expect(stripped).not.toHaveProperty('venueScan');
  });
});
