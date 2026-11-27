import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildShareSnapshot,
  encodeShareSnapshot,
  readShareSnapshotHash,
  SHARE_SNAPSHOT_HASH_PREFIX,
} from './share-snapshot';
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

function hashFromUrl(url: string): string {
  const at = url.indexOf(SHARE_SNAPSHOT_HASH_PREFIX);
  return at >= 0 ? url.slice(at) : url;
}

/** Hand-build a legacy-style link so an older payload carrying refs can be exercised at the decoder. */
function legacyHash(snapshot: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const compressed = deflateRawSync(bytes);
  const b64 = Buffer.from(compressed).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${SHARE_SNAPSHOT_HASH_PREFIX}1.${b64}`;
}

describe('share snapshot strips sidecar pointers (D6-4-3)', () => {
  it('build payload carries no variant ref or scan identity, keeps summary labels', () => {
    const { snapshot } = buildShareSnapshot(withVariantSlots());
    const variant = snapshot.layout.designBook!.variants[0]!;
    expect(variant).not.toHaveProperty('operationsRef');
    expect(variant).not.toHaveProperty('planRef');
    expect(variant).not.toHaveProperty('scan');
    expect(variant.summary).toEqual(summary);
    expect(snapshot.layout).not.toHaveProperty('eventOperations');
    expect(snapshot.layout).not.toHaveProperty('productionPlan');
  });

  it('encode → decode round-trip keeps geometry and summary, never re-attaches a dangling ref', async () => {
    const { url } = await encodeShareSnapshot(withVariantSlots(), 'https://example.com/share');
    const result = await readShareSnapshotHash(hashFromUrl(url));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const variant = result.snapshot.layout.designBook!.variants[0]!;
    expect(variant).not.toHaveProperty('operationsRef');
    expect(variant).not.toHaveProperty('planRef');
    expect(variant).not.toHaveProperty('scan');
    expect(variant.summary).toEqual(summary);
    expect(result.snapshot.layout.floors).toHaveLength(withVariantSlots().floors.length);
  });

  it('decoder strips refs smuggled inside an older link instead of restoring them', async () => {
    const { snapshot } = buildShareSnapshot(withVariantSlots());
    const smuggling = structuredClone(snapshot);
    const variant = smuggling.layout.designBook!.variants[0]!;
    variant.operationsRef = '22222222-2222-4222-8222-222222222221';
    variant.planRef = '22222222-2222-4222-9222-222222222222';
    variant.scan = { assetId: 'scan-asset-1', name: '场地扫描' };
    const result = await readShareSnapshotHash(legacyHash(smuggling));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const restored = result.snapshot.layout.designBook!.variants[0]!;
    expect(restored).not.toHaveProperty('operationsRef');
    expect(restored).not.toHaveProperty('planRef');
    expect(restored).not.toHaveProperty('scan');
    expect(restored.summary).toEqual(summary);
  });
});
