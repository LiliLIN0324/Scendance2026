import { beforeEach, describe, expect, it, vi } from 'vitest';
import libraryAssetIds from '../../assets/library/asset-ids.json';
import { handoffSchema } from '../../supabase/functions/_shared/delivery-contract';
import { sceneV2Schema, type SceneV2 } from '../../supabase/functions/_shared/domain';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { materialCheckinLedgerSchema, materialCheckinSummary, type MaterialCheckinLedger } from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { backendSceneToLayout, layoutToBackendScene } from '../components/room-organizer/lib/backend-adapter';
import { INITIAL_BRIEF } from '../components/room-organizer/lib/creative-brief';
import { createLocalActivityBackup, archiveLocalActivity, listLocalActivities, readLocalActivity } from './local-activities';
import { createLocalProjectBackup, createLocalProjectBackupV3, LOCAL_PROJECT_BACKUP_V1_COVERAGE, parseLocalProjectBackupJson, type LocalProjectBackupV3 } from './local-project-backup';
import { listSourceRecords, readSourceRecord, updateSourceForm } from './source-storage';

vi.mock('./source-storage', () => ({ listSourceRecords: vi.fn(), readSourceRecord: vi.fn(), updateSourceForm: vi.fn() }));
const records = new Map<string, unknown>();
const id = (n: number) => `ae900000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = 'house-independent-activity-rehearsal';
const createdAt = '2026-10-09T01:00:00+08:00';
const rawText = '  独立演练说明\n  保留缩进  ';
const [publicUrl, publicAssetId] = Object.entries(libraryAssetIds).find(([url]) => url.startsWith('https://'))!;
const address = (project = projectId) => JSON.stringify(['local-activity', project]);

function scene(): SceneV2 {
  const points = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 8 }, { x: 0, z: 8 }];
  return sceneV2Schema.parse({ schemaVersion: 2, venue: { shape: 'polygon', width: 10, depth: 8, height: 3, polygon: points, entrances: [], floorplanAssetId: id(30) },
    camera: 'top', lighting: 'warm',
    objects: [
      { id: id(10), materialId: 'table', position: { x: 2, z: 2 }, rotation: 23, size: { width: 1.2, depth: 0.6, height: 0.75 }, color: '#123456', locked: true, notes: '演练旧活动备注' },
      { id: id(11), materialId: 'asset', assetId: publicAssetId, position: { x: 4, z: 4 }, rotation: 0, size: { width: 0.5, depth: 0.5, height: 1 }, color: '#abcdef', locked: false, notes: '演练公共模型备注' },
      { id: id(12), materialId: 'asset', assetId: id(13), position: { x: 6, z: 3 }, rotation: 13, size: { width: 0.6, depth: 0.6, height: 1 }, color: '#fedcba', locked: false, notes: '演练私有模型备注' },
    ],
    structure: { walls: points.map((start, i) => ({ id: id(i + 1), start, end: points[(i + 1) % 4], thickness: 0.16, height: 3, kind: 'exterior', status: 'confirmed',
      ...(i === 0 ? { evidence: [{ sourceAssetId: id(30), start: { x: 0, z: 0 }, end: { x: 1, z: 0 } }] } : {}) })),
      openings: [{ id: id(5), wallId: id(1), kind: 'door', offset: 3, width: 1.2, height: 2.2, sillHeight: 0, status: 'confirmed' }],
      columns: [{ id: id(6), position: { x: 7, z: 6 }, size: { width: 0.5, depth: 0.5, height: 3 }, rotation: 17, status: 'confirmed' }] },
    sources: [{ assetId: id(30), name: '演练平面图', kind: 'floorplan', width: 800, height: 600 }, { assetId: id(31), name: '演练照片', kind: 'photo', width: 800, height: 600 }],
    dimensions: [{ id: id(40), kind: 'width', valueMeters: 10, status: 'confirmed', label: '图上总宽', sourceAssetId: id(30), start: { x: 0, z: 0 }, end: { x: 1, z: 0 } },
      { id: id(41), kind: 'depth', valueMeters: 8, status: 'confirmed', label: '独立实测总深' }],
    design: { concept: '旧演练活动私有说明', palette: ['#123456'], highlights: [{ title: '旧活动亮点', description: rawText, objectIds: [id(10)] }], requirements: [] },
    finishes: { floorColor: '#ccbb99', floorPattern: 'wood', wallColors: { [id(1)]: '#123456' } },
  });
}
function sourceLayout() {
  const layout = backendSceneToLayout(scene(), { projectId, name: '独立活动演练原档', assetUrls: { [publicAssetId]: 'https://storage.example.test/model.glb?token=FAKE_ACTIVITY', [id(13)]: 'https://storage.example.test/private.glb?token=FAKE_ACTIVITY' } });
  layout.floors[0].items.find(item => item.id === id(10))!.handoff = handoffSchema.parse({ ownerName: '演练负责人', evidenceNote: '旧演练物件记录' });
  layout.eventOperations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [{ id: id(80), title: '旧活动任务', phase: 'setup', objectIds: [id(10)], status: 'doing', actualStartedAt: '2026-10-09T00:30:00+08:00', evidenceNote: '旧任务说明' }] });
  layout.productionPlan = productionPlanSchema.parse({ dataKind: 'rehearsal', estimates: [{ id: id(81), title: '旧人工估算', amountMinor: 0, basisNote: rawText }] });
  layout.itemLayers = [{ id: 'internal-layer', name: '旧活动内部层', itemIds: [id(10)] }];
  layout.floorPlanImage = 'data:image/png;base64,iVBORw0KGgo=';
  layout.designBook = { activeId: 'old-design', variants: [{ id: 'old-design', name: '旧历史方案', layout: structuredClone(layout) }] };
  return layout;
}
function ledger(quantity = 18): MaterialCheckinLedger {
  return materialCheckinLedgerSchema.parse({ projectId, dataKind: 'rehearsal', sheets: [{ id: id(90), acquisitionId: id(91), acquisitionSnapshot: { title: '演练租赁椅', supplierName: '演练来源', specificationNote: rawText }, unit: 'piece',
    agreements: [{ id: id(92), recordedAt: createdAt, recordedBy: '演练统筹', agreedQuantity: 20, basisNote: rawText }],
    events: [{ id: id(93), kind: 'receive', recordedAt: '2026-10-09T02:00:00+08:00', recordedBy: '演练记录人', occurredAt: '2026-10-09T01:30:00+08:00', batchRef: '演练第一批', quantity, checkState: 'checked', fromPartyName: '演练交方', toPartyName: '演练收方', evidenceNote: rawText }],
  }] });
}
function backup(checkins: MaterialCheckinLedger | null = ledger(), timestamp = createdAt): LocalProjectBackupV3 {
  return createLocalProjectBackupV3(sourceLayout(), { state: 'ready', scope: projectId, brief: { status: 'present', value: { ...INITIAL_BRIEF, description: rawText, guests: 0 } } },
    { state: 'ready', scope: projectId, materialCheckins: checkins ? { status: 'present', value: checkins } : { status: 'absent' } }, timestamp);
}
function withReturn() {
  const value = ledger();
  const receipt = value.sheets[0].events[0];
  if (receipt.kind !== 'receive') throw new Error('演练收货记录类型不正确');
  value.sheets[0].events.push({ ...receipt, id: id(94), kind: 'return', quantity: 18, occurredAt: '2026-10-09T02:30:00+08:00', recordedAt: '2026-10-09T03:00:00+08:00' });
  return materialCheckinLedgerSchema.parse(value);
}
beforeEach(() => {
  records.clear(); vi.resetAllMocks();
  vi.mocked(readSourceRecord).mockImplementation(async key => structuredClone(records.get(JSON.stringify(key))) as never);
  vi.mocked(updateSourceForm).mockImplementation(async (key, update) => {
    const storageKey = JSON.stringify(key), next = update(structuredClone(records.get(storageKey)));
    records.set(storageKey, structuredClone(next));
    return structuredClone(next) as never;
  });
  vi.mocked(listSourceRecords).mockImplementation(async namespace => [...records].flatMap(([storageKey, value]) => {
    const key: unknown = JSON.parse(storageKey);
    return Array.isArray(key) && key.length === 2 && key[0] === namespace && typeof key[1] === 'string' ? [{ key: [key[0], key[1]], value: structuredClone(value) }] : [];
  }) as never);
});

describe('complete local activity archives', () => {
  it('roundtrips exact V3 business, scene and independent facts through an atomic tuple write and separate read', async () => {
    const original = backup(), text = JSON.stringify(original), returned = await archiveLocalActivity(text, projectId);
    expect(returned).toEqual(original); expect(records.get(address())).toEqual(original);
    expect(updateSourceForm).toHaveBeenCalledWith(['local-activity', projectId], expect.any(Function));
    expect(readSourceRecord).toHaveBeenCalledWith(['local-activity', projectId]);
    const reopened = await readLocalActivity(projectId);
    expect(reopened).toEqual(parseLocalProjectBackupJson(text));
    expect(reopened.layout.productionPlan).toEqual(original.layout.productionPlan); expect(reopened.brief).toEqual(original.brief);
    expect(reopened.materialCheckins).toEqual(original.materialCheckins);
    if (reopened.materialCheckins.status === 'present') expect(materialCheckinSummary(reopened.materialCheckins.value.sheets[0]).notReceivedQuantity).toBe(2);
  });

  it('keeps tuple project identity separate from legacy strings, reserved-looking suffixes and local fallback', async () => {
    const idWithSuffix = 'house-a:brief';
    const original = backup(null); original.layout.id = idWithSuffix;
    records.set(JSON.stringify(idWithSuffix), { legacyPrivateForm: rawText });
    records.set(JSON.stringify('local'), { legacyLocal: rawText });
    await archiveLocalActivity(JSON.stringify(original), idWithSuffix);
    expect(records.get(JSON.stringify(idWithSuffix))).toEqual({ legacyPrivateForm: rawText });
    expect(records.get(JSON.stringify('local'))).toEqual({ legacyLocal: rawText });
    expect((await readLocalActivity(idWithSuffix)).layout.id).toBe(idWithSuffix);
    await expect(readLocalActivity('')).rejects.toThrow();
    await expect(archiveLocalActivity(JSON.stringify(backup()), '')).rejects.toThrow();
    expect(vi.mocked(readSourceRecord).mock.calls.every(([key]) => Array.isArray(key))).toBe(true);
  });

  it('refuses V1, V2, legacy layouts and V3 without an explicit checkin state before writing', async () => {
    const old = createLocalProjectBackup(makeLayout({ id: projectId }), { state: 'ready', scope: projectId, brief: { status: 'absent' } }, createdAt);
    const { materialCheckins: omitted, ...missingState } = backup(); expect(omitted.status).toBe('present');
    for (const candidate of [old, { ...old, version: 1, coverage: LOCAL_PROJECT_BACKUP_V1_COVERAGE }, makeLayout({ id: projectId }), missingState,
      { ...backup(), materialCheckins: { status: 'not-in-file' } }, { ...backup(), materialCheckins: null }]) {
      await expect(archiveLocalActivity(JSON.stringify(candidate), projectId)).rejects.toThrow();
    }
    expect(updateSourceForm).not.toHaveBeenCalled(); expect(records.size).toBe(0);
  });

  it('preserves a corrupt existing archive or key/ID mismatch instead of treating it as an empty slot', async () => {
    const original = backup(); records.set(address(), { ...original, layout: { ...original.layout, id: 'another-house' } });
    const corrupt = structuredClone(records.get(address()));
    await expect(readLocalActivity(projectId)).rejects.toThrow();
    await expect(archiveLocalActivity(JSON.stringify(original), projectId)).rejects.toThrow(); expect(records.get(address())).toEqual(corrupt);
    records.set(address(), { broken: true });
    await expect(archiveLocalActivity(JSON.stringify(original), projectId)).rejects.toThrow(); expect(records.get(address())).toEqual({ broken: true });
    await expect(archiveLocalActivity(JSON.stringify(original), 'wrong-house')).rejects.toThrow('编号不一致');
  });

  it('atomically unions newer facts and never lets an older absent snapshot erase archived receipts or returns', async () => {
    await archiveLocalActivity(JSON.stringify(backup(withReturn())), projectId);
    const older = backup(ledger(), '2026-10-09T00:00:00+08:00');
    const union = await archiveLocalActivity(JSON.stringify(older), projectId);
    expect(union.materialCheckins).toEqual({ status: 'present', value: withReturn() });
    expect(await archiveLocalActivity(JSON.stringify(backup(null)), projectId)).toMatchObject({ materialCheckins: { status: 'present', value: withReturn() } });
    expect(withReturn().sheets[0].events[0].recordedAt).toBe('2026-10-09T02:00:00+08:00');
  });

  it('merges concurrent independently based receipt proposals against the latest transaction value', async () => {
    const first = ledger(); first.sheets[0].events = [];
    const second = withReturn(); second.sheets[0].events = [second.sheets[0].events[1]];
    // The atomic transaction sees a receipt written after the proposal was prepared.
    records.set(address(), backup(ledger()));
    await archiveLocalActivity(JSON.stringify(backup(second)), projectId);
    const saved = await readLocalActivity(projectId);
    expect(saved.materialCheckins).toEqual({ status: 'present', value: withReturn() });
    expect(first.sheets[0].events).toEqual([]); expect(second.sheets[0].events).toHaveLength(1);
  });

  it('rejects immutable-record content conflicts and competing correction branches without replacing the saved archive', async () => {
    const original = backup(); await archiveLocalActivity(JSON.stringify(original), projectId);
    await expect(archiveLocalActivity(JSON.stringify(backup(ledger(16))), projectId)).rejects.toThrow();
    expect(records.get(address())).toEqual(original);
    const corrected = ledger(), competing = ledger();
    const receipt = corrected.sheets[0].events[0];
    if (receipt.kind !== 'receive') throw new Error('演练收货记录类型不正确');
    const { kind: eventKind, id: receiptId, recordedAt: eventTime, recordedBy: recorder, ...replacement } = receipt;
    expect(eventKind).toBe('receive'); expect(receiptId).toBe(id(93)); expect(eventTime).toBeTruthy(); expect(recorder).toBeTruthy();
    corrected.sheets[0].events.push({ id: id(95), kind: 'correction', targetId: id(93), reason: '演练纠错', replacement: { ...replacement, quantity: 16 }, recordedAt: '2026-10-09T03:00:00+08:00', recordedBy: '演练记录人' });
    competing.sheets[0].events.push({ id: id(96), kind: 'correction', targetId: id(93), reason: '另一条演练更正', replacement: { ...replacement, quantity: 17 }, recordedAt: '2026-10-09T03:00:00+08:00', recordedBy: '演练记录人' });
    const committed = await archiveLocalActivity(JSON.stringify(backup(materialCheckinLedgerSchema.parse(corrected))), projectId);
    await expect(archiveLocalActivity(JSON.stringify(backup(materialCheckinLedgerSchema.parse(competing))), projectId)).rejects.toThrow();
    expect(records.get(address())).toEqual(committed);
  });

  it('aborts a stale-scope callback and a write failure without archiving over the original', async () => {
    const original = backup(); records.set(address(), original);
    const guard = vi.fn(() => { throw new Error('活动已切换'); });
    await expect(archiveLocalActivity(JSON.stringify(backup(null)), projectId, guard)).rejects.toThrow('活动已切换');
    expect(guard).toHaveBeenCalledOnce(); expect(records.get(address())).toEqual(original); expect(readSourceRecord).not.toHaveBeenCalled();
    vi.mocked(updateSourceForm).mockRejectedValueOnce(new Error('本机空间不足'));
    await expect(archiveLocalActivity(JSON.stringify(backup(null)), projectId)).rejects.toThrow('空间不足'); expect(records.get(address())).toEqual(original);
  });

  it('does not report success after read failure or a concurrent readback mismatch, and does not roll back committed facts', async () => {
    vi.mocked(readSourceRecord).mockRejectedValueOnce(new Error('回读失败'));
    await expect(archiveLocalActivity(JSON.stringify(backup()), projectId)).rejects.toThrow('回读失败'); expect(records.get(address())).toEqual(backup());
    const later = backup(withReturn());
    vi.mocked(readSourceRecord).mockImplementationOnce(async key => { records.set(JSON.stringify(key), later); return structuredClone(later) as never; });
    await expect(archiveLocalActivity(JSON.stringify(backup()), projectId)).rejects.toThrow('回读与本次保存不一致');
    expect(records.get(address())).toEqual(later);
  });

  it('lists valid archives by date and exposes retained unreadable records without polluting old namespaces', async () => {
    const first = backup(), second = backup(null, '2026-10-09T03:00:00+08:00'); second.layout.id = 'second-house'; second.layout.name = '另一演练活动';
    records.set(address(), first); records.set(address('second-house'), second); records.set(address('broken-house'), { broken: true });
    records.set(JSON.stringify(`${projectId}:brief`), { description: rawText }); records.set(JSON.stringify(['material-checkins', projectId]), ledger());
    const before = structuredClone(records);
    const listed = await listLocalActivities();
    expect(listSourceRecords).toHaveBeenCalledWith('local-activity');
    expect(listed.activities.map(row => row.projectId)).toEqual(['second-house', projectId]);
    expect(listed.unreadableProjectIds).toEqual(['broken-house']); expect(records).toEqual(before);
    expect(listed.activities[1].itemCount).toBe(first.layout.floors.reduce((sum, floor) => sum + floor.items.length, 0));
  });
});

describe('independent local activity creation', () => {
  it('creates independent 10 by 8 empty activities with no goods, brief, facts or inherited private records', () => {
    const source = sourceLayout(), before = structuredClone(source);
    const first = createLocalActivityBackup(source, '  新演练活动  ', 'empty'), second = createLocalActivityBackup(source, '第二演练活动', 'empty');
    expect(first.layout).toMatchObject({ name: '新演练活动', width: 10, height: 8 });
    expect(first.layout.floors.flatMap(floor => floor.items)).toEqual([]);
    expect(first.brief).toEqual({ status: 'absent' }); expect(first.materialCheckins).toEqual({ status: 'absent' });
    expect(new Set([source.id, first.layout.id, second.layout.id]).size).toBe(3);
    expect(first.layout.productionPlan).toBeUndefined(); expect(first.layout.eventOperations).toBeUndefined(); expect(first.layout.designBook).toBeUndefined();
    expect(parseLocalProjectBackupJson(JSON.stringify(first)).backupVersion).toBe(3); expect(source).toEqual(before);
  });

  it('reuses valid measured geometry and asset identity while removing old activity, image and review provenance', () => {
    const source = sourceLayout(), before = structuredClone(source), oldWire = layoutToBackendScene(source) as SceneV2;
    const created = createLocalActivityBackup(source, '沿用布置演练', 'reuse-layout'), layout = created.layout;
    const wire = layoutToBackendScene(layout) as SceneV2;
    expect(layout.id).not.toBe(source.id); expect(layout.width).toBe(source.width); expect(layout.height).toBe(source.height);
    expect(wire.venue).toEqual(Object.fromEntries(Object.entries(oldWire.venue).filter(([key]) => key !== 'floorplanAssetId')));
    expect(wire.structure).toEqual({ ...oldWire.structure, walls: oldWire.structure.walls.map(({ evidence, ...wall }) => { expect(evidence === undefined || evidence.length > 0).toBe(true); return wall; }) });
    expect(wire.objects).toEqual(oldWire.objects.map(object => ({ ...object, notes: '' })));
    expect(wire.finishes).toEqual(oldWire.finishes); expect(wire.camera).toBe(oldWire.camera); expect(wire.lighting).toBe(oldWire.lighting);
    expect(wire.sources).toEqual([]); expect(wire.dimensions).toEqual([oldWire.dimensions[1]]); expect(wire.design).toBeUndefined();
    for (const key of ['productionPlan', 'eventOperations', 'designBook', 'itemLayers', 'floorPlanImage'] as const) expect(layout[key]).toBeUndefined();
    expect(layout.floors[0].items.every(item => item.notes === undefined && item.handoff === undefined)).toBe(true);
    expect(layout.floors[0].items.find(item => item.id === id(11))!.glbUrl).toBe(publicUrl);
    expect(layout.floors[0].items.find(item => item.id === id(12))!.assetId).toBe(id(13));
    expect(layout.floors[0].items.find(item => item.id === id(12))!.glbUrl).toBeUndefined();
    expect(JSON.stringify(created)).not.toContain('FAKE_ACTIVITY'); expect(sceneV2Schema.safeParse(wire).success).toBe(true);
    expect(created.brief).toEqual({ status: 'absent' }); expect(created.materialCheckins).toEqual({ status: 'absent' });
    expect(source).toEqual(before);
    const item = layout.floors[0].items[0]; item.position = { ...item.position!, x: item.position!.x + 1 }; expect(source).toEqual(before);
  });

  it('refuses missing source identity, invalid names or modes without writing an archive', () => {
    const source = sourceLayout(), before = structuredClone(source);
    const noId = structuredClone(source); delete noId.id;
    expect(() => createLocalActivityBackup(noId, '演练', 'reuse-layout')).toThrow();
    for (const name of ['', '   ', 'x'.repeat(501)]) expect(() => createLocalActivityBackup(source, name, 'empty')).toThrow();
    expect(() => createLocalActivityBackup(source, '演练', 'future-mode' as never)).toThrow();
    expect(updateSourceForm).not.toHaveBeenCalled(); expect(source).toEqual(before);
  });
});
