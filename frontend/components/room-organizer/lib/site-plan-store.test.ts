import { describe, expect, it } from 'vitest';
import {
  assertSameSnapshot,
  createInMemorySitePlanStore,
  sceneAheadOfLastPlanSave,
} from './site-plan-store';
import { sitePlanHash, type SitePlanSnapshot, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

function sampleData(): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: { lng: 120.1443, lat: 30.2459, crs: 'gcj-02', source: 'picker' },
    boundary: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ],
    zones: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        semantic: 'audience',
        name: '观众区',
        polygon: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 60 },
          { x: 10, y: 60 },
        ],
        notes: '',
      },
    ],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
  };
}

function snapshot(revision: number, data: SitePlanData = sampleData(), planId = '99999999-9999-4999-8999-999999999999'): SitePlanSnapshot {
  return {
    planId,
    projectId: '88888888-8888-4888-8888-888888888888',
    revision,
    updatedAt: '2026-11-10T05:00:00.000Z',
    data,
  };
}

describe('site plan versioned store (H1-b)', () => {
  it('saves a snapshot and emits a clean, confirmed revision on reload', async () => {
    const store = createInMemorySitePlanStore();
    const saved = await store.save('proj-1', snapshot(1), 0);
    expect(saved.revision).toBe(1);

    const loaded = await store.load('proj-1');
    expect(loaded.revision).toBe(1);
    expect(loaded.snapshot?.revision).toBe(1);
    expect(loaded.dirty).toBe(false);
  });

  it('throws REVISION_CONFLICT when a peer advanced the base first', async () => {
    const store = createInMemorySitePlanStore();
    await store.save('proj-1', snapshot(1), 0);
    // 另一个标签页以旧基线 0 保存 → 冲突。
    await expect(store.save('proj-1', snapshot(1), 0)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('rejects an invalid snapshot before any write', async () => {
    const store = createInMemorySitePlanStore();
    const bad = snapshot(0);
    bad.data.boundary = [{ x: 0, y: 0 }]; // 少于 3 个顶点
    await expect(store.save('proj-1', bad, 0)).rejects.toMatchObject({ code: 'INVALID_SNAPSHOT' });
  });

  it('keeps plan and scene coexisting without overwriting each other', async () => {
    const store = createInMemorySitePlanStore();
    // 先存 scene 对应 3，再存规划（基线 0）→ 规划不裁剪 scene。
    const saved = await store.save('proj-1', snapshot(1), 0, 3);
    const loaded = await store.load('proj-1');
    expect(saved.revision).toBe(1);
    expect(loaded.sceneRevision).toBe(3);
    // scene 前进到 5，但规划快照原样保留（并存 = 互不覆盖）。
    expect(sceneAheadOfLastPlanSave(loaded, 5)).toBe(true);
    expect(loaded.snapshot?.data.zones[0].semantic).toBe('audience');
  });

  it('asserts snapshot fingerprint for delivery consistency', async () => {
    const snap = snapshot(2);
    const hash = await sitePlanHash(snap);
    await expect(assertSameSnapshot(snap, hash)).resolves.toBeUndefined();
    const moved = { ...snap, data: { ...snap.data, zones: [{ ...snap.data.zones[0], name: '改名的观众区' }] } };
    await expect(assertSameSnapshot(moved, hash)).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });
});