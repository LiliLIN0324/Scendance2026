import { describe, expect, it } from 'vitest';
import { collectArchiveInventory, enqueuePendingInventoryItems, inventoryActionHint, inventoryTone, isReplicaCaseItem, readOutdoorInventoryRecords, type InventoryItem } from './local-inventory';
import type { ArchiveJob, ArchiveScope } from './archive-queue';
import type { AholoAsset } from './aholo-assets';

const SCOPE: ArchiveScope = { userId: 'u', studioId: 's' };

function job(partial: Partial<ArchiveJob> & { localId: string }): ArchiveJob {
  return {
    ...partial,
    key: `k-${partial.localId}`, scope: SCOPE, requestId: `r-${partial.localId}`,
    name: partial.name ?? partial.localId, kind: partial.kind ?? 'model', bytes: partial.bytes ?? 10,
    state: partial.state ?? 'pending', progress: 0, attempts: 0,
  } as ArchiveJob;
}

function asset(partial: Partial<AholoAsset> & { assetId: string }): AholoAsset {
  return {
    ...partial,
    kind: partial.kind ?? 'glb', name: partial.name ?? partial.assetId, bytes: partial.bytes ?? 10, savedAt: 1,
  } as AholoAsset;
}

describe('local inventory (C14)', () => {
  it('labels archived, pending, needs-file and failed items without deleting anything', () => {
    const report = collectArchiveInventory({
      assets: [
        asset({ assetId: '11111111-1111-4111-8111-111111111111', kind: 'glb' }),
        asset({ assetId: '22222222-2222-4222-8222-222222222222', kind: 'spz' }),
        asset({ assetId: '33333333-3333-4333-8333-333333333333', kind: 'ply' }),
      ],
      archiveJobs: [
        job({ localId: '11111111-1111-4111-8111-111111111111', state: 'uploaded', assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
        job({ localId: '22222222-2222-4222-8222-222222222222', state: 'needs-file', error: '原文件不可读' }),
        job({ localId: '33333333-3333-4333-8333-333333333333', state: 'failed', error: 'HTTP 503' }),
      ],
    });
    expect(report.summary).toEqual({ total: 3, archived: 1, pending: 0, needsFile: 1, failed: 1 });
    expect(report.items[0]).toMatchObject({ state: 'archived', cloudAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', detail: '已归档到私有云端' });
    expect(report.items[1]).toMatchObject({ type: 'scan', state: 'needs-file', detail: '原文件不可读' });
    expect(report.items[2]).toMatchObject({ type: 'scan', state: 'failed', detail: 'HTTP 503' });
  });

  it('counts asset-cloud uploads (legacy GLB path) and public cloud scan copies separately', () => {
    const report = collectArchiveInventory({
      assets: [
        asset({ assetId: '11111111-1111-4111-8111-111111111111' }),
        asset({ assetId: '22222222-2222-4222-8222-222222222222', kind: 'spz', origin: 'cloud' }),
        asset({ assetId: '33333333-3333-4333-8333-333333333333' }),
      ],
      cloudRecords: {
        '11111111-1111-4111-8111-111111111111': { state: 'uploaded', cloudAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      },
    });
    expect(report.items[0]).toMatchObject({ state: 'archived', detail: '已上传云端资产' });
    expect(report.items[1]).toMatchObject({ state: 'archived', detail: '公共云资产库有副本（非私有归档）' });
    expect(report.items[2]).toMatchObject({ state: 'pending' });
  });

  it('includes local-only sources and outdoor plan records', () => {
    const report = collectArchiveInventory({
      sources: [
        { id: 's1', scope: 'p', name: '平面图', kind: 'floorplan', width: 1, height: 1, assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        { id: 's2', scope: 'p', name: '参考图', kind: 'photo', width: 1, height: 1 },
      ],
      outdoorRecords: [
        { projectId: 'p1', name: '周年庆', remoteActivityId: 'act-1', remoteRevision: 4 },
        { projectId: 'p2', name: '市集' },
      ],
    });
    expect(report.summary.total).toBe(4);
    expect(report.items.find(item => item.localId === 's1')).toMatchObject({ state: 'archived' });
    expect(report.items.find(item => item.localId === 's2')).toMatchObject({ state: 'pending', detail: '资料图只在本机，云端没有副本' });
    expect(report.items.find(item => item.localId === 'p1')).toMatchObject({ state: 'archived', detail: '云端有活动副本（版本 4）' });
    expect(report.items.find(item => item.localId === 'p2')).toMatchObject({ state: 'pending', detail: '云端没有这个规划的副本' });
  });

  it('reads outdoor records from storage keys without touching other entries', () => {
    const storage = {
      length: 3,
      key(index: number): string | null { return ['scendance-outdoor-plan-v1:p1', 'unrelated', 'scendance-outdoor-plan-v1:p2'][index] ?? null; },
      getItem(key: string): string | null {
        if (key.endsWith('p1')) return JSON.stringify({ v: 1, projectId: 'p1', name: '周年庆', remoteActivityId: 'act-1', remoteRevision: 2, createdAt: '', updatedAt: '' });
        if (key.endsWith('p2')) return 'not-json';
        return null;
      },
      removeItem(): void {},
      setItem(): void {},
      clear(): void {},
    };
    const records = readOutdoorInventoryRecords(storage as unknown as Storage);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ projectId: 'p1', name: '周年庆', remoteActivityId: 'act-1', remoteRevision: 2 });
  });

  it('enqueues only pending model/scan items that have a readable URL', async () => {
    const report = collectArchiveInventory({
      assets: [
        asset({ assetId: '11111111-1111-4111-8111-111111111111', name: '模型A' }),
        asset({ assetId: '22222222-2222-4222-8222-222222222222', kind: 'spz', name: '扫描B' }),
      ],
      archiveJobs: [job({ localId: '11111111-1111-4111-8111-111111111111', state: 'uploaded', assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })],
    });
    const enqueued: string[] = [];
    const registry = [
      asset({ assetId: '11111111-1111-4111-8111-111111111111', name: '模型A' }),
      asset({ assetId: '22222222-2222-4222-8222-222222222222', kind: 'spz', name: '扫描B' }),
    ];
    const queued = await enqueuePendingInventoryItems(report, SCOPE, async input => { enqueued.push(`${input.localId}:${input.kind}`); }, registry);
    expect(queued).toBe(1);
    expect(enqueued).toEqual(['22222222-2222-4222-8222-222222222222:scan']);
  });

  function item(partial: Partial<InventoryItem> & { localId: string; state: InventoryItem['state'] }): InventoryItem {
    return { type: 'model', name: partial.localId, ...partial };
  }

  it('splits archived copies into private, public-library and activity tones; pending and failures stay local/error', () => {
    expect(inventoryTone(item({ localId: 'm1', state: 'archived' }))).toBe('private');
    expect(inventoryTone(item({ localId: 's1', type: 'scan', state: 'archived', detail: '公共云资产库有副本（非私有归档）' }))).toBe('public');
    expect(inventoryTone(item({ localId: 'o1', type: 'outdoor-plan', state: 'archived' }))).toBe('activity');
    expect(inventoryTone(item({ localId: 'm2', state: 'pending' }))).toBe('local');
    expect(inventoryTone(item({ localId: 'm3', state: 'needs-file' }))).toBe('error');
    expect(inventoryTone(item({ localId: 'm4', state: 'failed' }))).toBe('error');
  });

  it('marks replica- classic cases as built-in examples, not personal inventory', () => {
    expect(isReplicaCaseItem(item({ localId: 'replica-banbury', state: 'pending' }))).toBe(true);
    expect(isReplicaCaseItem(item({ localId: 'real-draft', state: 'pending' }))).toBe(false);
  });

  it('routes the next action by object ownership: model/scan to upload queue, plan to project save', () => {
    expect(inventoryActionHint(item({ localId: 'replica-x', state: 'pending' }))).toBe('示例，不参与同步');
    expect(inventoryActionHint(item({ localId: 'm1', state: 'pending' }))).toBe('加入补传队列后上传');
    expect(inventoryActionHint(item({ localId: 's1', type: 'scan', state: 'pending' }))).toBe('加入补传队列后上传');
    expect(inventoryActionHint(item({ localId: 'o1', type: 'outdoor-plan', state: 'pending' }))).toBe('打开项目保存后同步到云端');
    expect(inventoryActionHint(item({ localId: 'o2', type: 'outdoor-plan', state: 'archived' }))).toBe('版本已随活动保存');
    expect(inventoryActionHint(item({ localId: 'm2', state: 'archived' }))).toBe('');
  });
});
