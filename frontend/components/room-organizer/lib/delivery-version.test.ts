import { describe, expect, it } from 'vitest';
import { handoffSchema } from '../../../../supabase/functions/_shared/delivery-contract';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import {
  DELIVERY_VERSION_STORAGE_KEY,
  INITIAL_DELIVERY_VERSION,
  canonicalJson,
  confirmDeliveryVersion,
  contentFingerprintOfLayout,
  deliveryProjectKey,
  deliveryVersionLabel,
  deliveryVersionState,
  nextDeliveryVersion,
  readDeliveryVersionRecords,
  snapshotIdFor,
} from './delivery-version';
import type { RoomLayout } from './types';

function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

function hall(overrides: Partial<RoomLayout> = {}): RoomLayout {
  return makeLayout({
    name: '东厅晚宴',
    floors: [makeFloor({ id: 'g', name: '1F', items: [makeItem({ id: 'a', type: 'dining-table', position: { x: 0, z: 0 } })] })],
    ...overrides,
  });
}

function moved(layout: RoomLayout, x: number): RoomLayout {
  return {
    ...layout,
    floors: layout.floors.map((floor) => ({
      ...floor,
      items: floor.items.map((item) => ({ ...item, position: { x, z: 0 } })),
    })),
  };
}

describe('delivery content identity', () => {
  it('canonicalises key order so the same content gets the same fingerprint', async () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
    const first = await contentFingerprintOfLayout(hall());
    const second = await contentFingerprintOfLayout(hall({ name: '东厅晚宴' }));
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotIdFor(first)).toBe(first.slice(0, 16));
  });

  it('ignores fields that never travel in a public share', async () => {
    const base = hall();
    const withExtras: RoomLayout = {
      ...base,
      floorPlanImage: 'data:image/png;base64,AAAA',
      floors: base.floors.map((floor) => ({
        ...floor,
        items: floor.items.map((item) => ({ ...item, handoff: handoffSchema.parse({ ownerName: '本地负责人', evidenceNote: '本机证据' }) })),
      })),
    };
    expect(await contentFingerprintOfLayout(withExtras)).toBe(await contentFingerprintOfLayout(base));
  });

  it('changes when placement changes', async () => {
    const base = hall();
    expect(await contentFingerprintOfLayout(moved(base, 1))).not.toBe(await contentFingerprintOfLayout(base));
  });

  it('increments the minor version and falls back on malformed numbers', () => {
    expect(nextDeliveryVersion('v1.0')).toBe('v1.1');
    expect(nextDeliveryVersion('v1.9')).toBe('v1.10');
    expect(nextDeliveryVersion('v10.21')).toBe('v10.22');
    expect(nextDeliveryVersion('1.0')).toBe(INITIAL_DELIVERY_VERSION);
    expect(nextDeliveryVersion('v1')).toBe(INITIAL_DELIVERY_VERSION);
  });

  it('keys the local record by project id, with a single local fallback', () => {
    expect(deliveryProjectKey({ id: ' a1b2c3d4-0000-4000-8000-000000000000 ' })).toBe('a1b2c3d4-0000-4000-8000-000000000000');
    expect(deliveryProjectKey({ id: '   ' })).toBe('local-draft');
    expect(deliveryProjectKey({})).toBe('local-draft');
  });
});

describe('delivery version confirmation', () => {
  it('assigns v1.0 on first confirmation and stays idempotent while content is unchanged', async () => {
    const storage = memory();
    const base = hall({ id: 'project-a' });
    const before = await deliveryVersionState({ layout: base, storage });
    expect(before.status).toBe('none');
    expect(before.deliveryVersion).toBe('v1.0');
    expect(deliveryVersionLabel(before)).toBe('还没有确认过这一版');

    const first = await confirmDeliveryVersion({ layout: base, storage, now: '2026-11-08T10:00:00.000Z' });
    expect(first.record.deliveryVersion).toBe('v1.0');
    expect(first.record.snapshotId).toBe(first.state.snapshotId);
    expect(readDeliveryVersionRecords(storage)).toEqual([first.record]);

    const again = await confirmDeliveryVersion({ layout: hall({ id: 'project-a' }), storage, now: '2026-11-08T11:00:00.000Z' });
    expect(again.record).toEqual(first.record);
    expect(readDeliveryVersionRecords(storage)).toHaveLength(1);

    const confirmed = await deliveryVersionState({ layout: base, storage });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.deliveryVersion).toBe('v1.0');
    expect(confirmed.snapshotId).toBe(first.record.snapshotId);
    expect(deliveryVersionLabel(confirmed)).toBe('v1.0 已确认');
  });

  it('turns a changed draft into the next version without rewriting the old one', async () => {
    const storage = memory();
    const base = hall({ id: 'project-b' });
    const first = await confirmDeliveryVersion({ layout: base, storage });
    const draft = await deliveryVersionState({ layout: moved(base, 1.5), storage });
    expect(draft.status).toBe('draft');
    expect(draft.deliveryVersion).toBe('v1.1');
    expect(draft.snapshotId).not.toBe(first.record.snapshotId);
    expect(draft.confirmed).toEqual(first.record);
    expect(deliveryVersionLabel(draft)).toBe('v1.1 草案 · 已确认的是 v1.0');

    const second = await confirmDeliveryVersion({ layout: moved(base, 1.5), storage });
    expect(second.record.deliveryVersion).toBe('v1.1');
    expect(readDeliveryVersionRecords(storage).map((record) => record.deliveryVersion)).toEqual(['v1.1']);
  });

  it('keeps projects apart and tolerates missing or damaged storage', async () => {
    const storage = memory();
    await confirmDeliveryVersion({ layout: hall({ id: 'project-c' }), storage });
    const other = await deliveryVersionState({ layout: hall({ id: 'project-d' }), storage });
    expect(other.status).toBe('none');

    const none = await deliveryVersionState({ layout: hall(), storage: null });
    expect(none.status).toBe('none');
    expect(readDeliveryVersionRecords(null)).toEqual([]);
    await expect(confirmDeliveryVersion({ layout: hall(), storage: null })).rejects.toThrow('没有存下版本身份');

    storage.data.set(DELIVERY_VERSION_STORAGE_KEY, '{not json');
    expect(readDeliveryVersionRecords(storage)).toEqual([]);
    storage.data.set(DELIVERY_VERSION_STORAGE_KEY, JSON.stringify([{ projectKey: 'x', deliveryVersion: 'v1.0', snapshotId: 'ffffffffffffffff', contentFingerprint: '0'.repeat(64), confirmedAt: '2026-11-08' }]));
    expect(readDeliveryVersionRecords(storage)).toEqual([]);
  });

  it('refuses to confirm when the browser rejects the write', async () => {
    const storage = memory();
    storage.setItem = () => { throw new Error('quota'); };
    await expect(confirmDeliveryVersion({ layout: hall({ id: 'project-e' }), storage })).rejects.toThrow('无法确认这一版');
  });
});
