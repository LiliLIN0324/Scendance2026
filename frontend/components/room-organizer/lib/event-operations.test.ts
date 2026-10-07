import { describe, expect, it } from 'vitest';
import { sceneSchema } from '../../../../supabase/functions/_shared/domain';
import { eventOperationsSchema, eventOperationTaskSchema, type EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { createMeasuredRoomLayout } from './backend-adapter';
import { copyRehearsalOperations, createOperation, fromShanghaiDateTimeInput, operationBasis, operationReview, toShanghaiDateTimeInput } from './event-operations';
import { parseLayoutJson } from './persistence';
import { deliveryOperations, eventOperationsCsv, sceneDeliveryJson } from './scene-delivery';
import type { RoomLayout } from './types';

const objectId = '30000000-0000-4000-8000-000000000001';
function venue(): RoomLayout {
  return makeLayout({ id: 'local-rehearsal', roof: { style: 'none' }, floors: [makeFloor({ height: 3,
    items: [makeItem({ id: objectId, materialId: 'chair', position: { x: 0, z: 0 } })] })] });
}
async function accepted(layout: RoomLayout, refs: string[] = []): Promise<EventOperationTask> {
  const draft = { ...createOperation('演练签到', 'event'), ownerName: '演练负责人', contractorName: '演练协作组',
    acceptance: '演练：检查入场流程', plannedStartAt: '2026-10-08T23:00:00+08:00', plannedEndAt: '2026-10-09T01:00:00+08:00',
    actualStartedAt: '2026-10-08T15:05:00Z', actualFinishedAt: null, evidenceNote: '本机演练结果，不代表真实现场', objectIds: refs };
  return eventOperationTaskSchema.parse({ ...draft, status: 'accepted', reviewedBasis: await operationBasis(layout, draft) });
}

describe('activity operations references and review', () => {
  it('confirms a task without inventing material or actual completion times', async () => {
    const layout = { ...venue(), floors: [makeFloor()] }; const task = await accepted(layout);
    expect(await operationReview(layout, task)).toEqual({ status: 'accepted', missingObjectIds: [] });
    expect(task.objectIds).toEqual([]); expect(task.actualFinishedAt).toBeNull();
  });
  it.each(['phase', 'ownerName', 'contractorName', 'plannedEndAt', 'acceptance'] as const)('requires review after %s changes while preserving actual records', async field => {
    const layout = venue(), task = await accepted(layout);
    const changed = { ...task, [field]: field === 'phase' ? 'setup' : field === 'plannedEndAt' ? '2026-10-09T01:30:00+08:00' : '新演练条件' } as EventOperationTask;
    expect((await operationReview(layout, changed)).status).toBe('needs_review');
    expect(changed.actualStartedAt).toBe(task.actualStartedAt); expect(changed.actualFinishedAt).toBeNull(); expect(changed.evidenceNote).toBe(task.evidenceNote);
  });
  it('keeps missing references, does not match replacements by name, and restores the connection on undo', async () => {
    const layout = venue(), task = await accepted(layout, [objectId]);
    const removed = { ...layout, floors: [makeFloor({ items: [{ ...layout.floors[0].items[0], id: '30000000-0000-4000-8000-000000000002' }] })] };
    expect(await operationReview(removed, task)).toEqual({ status: 'needs_review', missingObjectIds: [objectId] });
    expect(task.objectIds).toEqual([objectId]); expect((await operationReview(layout, task)).status).toBe('accepted');
  });
  it.each([
    { stairsShape: 'winder' as const }, { stairsLeadIn: 2 }, { sofaShape: 'L-shape' as const },
    { cameraBracket: true }, { wallRotation: Math.PI / 2 },
  ])('requires review after a same-instance physical shape change: %j', async patch => {
    const layout = venue();
    layout.floors[0].items[0].type = 'sofaShape' in patch ? 'sofa' : 'stairsShape' in patch || 'stairsLeadIn' in patch ? 'stairs' : 'security-camera';
    delete layout.floors[0].items[0].materialId;
    const task = await accepted(layout, [objectId]);
    const changed = { ...layout, floors: [{ ...layout.floors[0], items: [{ ...layout.floors[0].items[0], ...patch }] }] };
    expect((await operationReview(changed, task)).status).toBe('needs_review');
  });
  it('tracks current venue structure while camera, lighting and expiring asset URLs remain display details', async () => {
    const layout = createMeasuredRoomLayout(venue(), { width: 8, depth: 8, height: 3 });
    const task = await accepted(layout, [objectId]);
    const changed = { ...layout, floors: [{ ...layout.floors[0], interiorWalls: layout.floors[0].interiorWalls!.map((wall, index) => index ? wall : { ...wall, thickness: .3 }) }] };
    expect((await operationReview(changed, task)).status).toBe('needs_review');
    expect((await operationReview({ ...layout, backendCamera: 'customer', backendLighting: 'cool' }, task)).status).toBe('accepted');
    const asset = { ...layout, floors: [{ ...layout.floors[0], items: [{ ...layout.floors[0].items[0], assetId: '40000000-0000-4000-8000-000000000001', glbUrl: 'https://example.test/model?token=old' }] }] };
    const assetTask = await accepted(asset, [objectId]);
    const renewed = { ...asset, floors: [{ ...asset.floors[0], items: [{ ...asset.floors[0].items[0], glbUrl: 'https://example.test/model?token=new' }] }] };
    expect((await operationReview(renewed, assetTask)).status).toBe('accepted');
  });
  it.each(['https://example.test/replacement.glb', 'https://example.test/chair.glb?version=2'])(
    'requires review when an unarchived model reference changes to %s without losing prior evidence', async glbUrl => {
      const layout = venue();
      const item = layout.floors[0].items[0];
      Object.assign(item, { type: 'glb-asset', materialId: 'asset', glbUrl: 'https://example.test/chair.glb?version=1' });
      const task = await accepted(layout, [objectId]);
      layout.eventOperations = eventOperationsSchema.parse({ tasks: [task] });
      const changed = { ...layout, floors: [{ ...layout.floors[0], items: [{ ...item, glbUrl }] }] };
      expect((await operationReview(changed, task)).status).toBe('needs_review');
      expect((await deliveryOperations(changed))!.tasks[0]).toMatchObject({
        effectiveStatus: 'needs_review', actualStartedAt: task.actualStartedAt, evidenceNote: task.evidenceNote,
      });
      expect(await eventOperationsCsv(changed)).toContain('需复核');
      expect((await operationReview(layout, task)).status).toBe('accepted');
      expect(task.reviewedBasis).toMatch(/^sha256:[0-9a-f]{64}$/);
    },
  );
  it('copies a selected rehearsal template as new drafts and discards old assignments and results', async () => {
    const layout = venue(), task = await accepted(layout, [objectId]);
    const source = eventOperationsSchema.parse({ dataKind: 'real', tasks: [task] });
    const copied = copyRehearsalOperations(source);
    expect(copied.dataKind).toBe('rehearsal'); expect(copied.tasks[0].id).not.toBe(task.id);
    expect(copied.tasks[0]).toMatchObject({ title: task.title, phase: task.phase, acceptance: task.acceptance, status: 'todo', ownerName: '', contractorName: '',
      plannedStartAt: null, plannedEndAt: null, actualStartedAt: null, actualFinishedAt: null, objectIds: [], evidenceNote: '', evidenceUrls: [] });
    expect(copied.tasks[0]).not.toHaveProperty('reviewedBasis'); expect(source.tasks[0]).toEqual(task);
  });
  it('requires rehearsal results to be rechecked after the source kind changes to real', async () => {
    const layout = venue(); layout.eventOperations = eventOperationsSchema.parse({ dataKind: 'rehearsal' });
    const task = await accepted(layout);
    const changed = { ...layout, eventOperations: { ...layout.eventOperations, dataKind: 'real' as const } };
    expect((await operationReview(changed, task)).status).toBe('needs_review');
  });
  it.each([
    ['legacy', 'floorPattern'], ['legacy', 'floorColor'], ['measured', 'floorPattern'], ['measured', 'floorColor'],
  ] as const)('rechecks %s floor %s changes carried by a restored project', async (kind, field) => {
    const layout = kind === 'measured' ? createMeasuredRoomLayout(venue(), { width: 8, depth: 8, height: 3 }) : venue();
    layout.floors[0].floorPattern = 'wood';
    const task = await accepted(layout);
    layout.eventOperations = eventOperationsSchema.parse({ tasks: [task] });
    const changed = { ...layout, floors: [{ ...layout.floors[0], [field]: field === 'floorPattern' ? 'carpet' : '#102030' }] } as RoomLayout;
    expect((await operationReview(changed, task)).status).toBe('needs_review');
    const reopened = parseLayoutJson(JSON.stringify(changed));
    expect(reopened).not.toBeNull();
    expect((await deliveryOperations(reopened!))!.tasks[0]).toMatchObject({
      effectiveStatus: 'needs_review', evidenceNote: task.evidenceNote, actualStartedAt: task.actualStartedAt,
    });
    expect(await eventOperationsCsv(reopened!)).toContain('需复核');
    expect((await operationReview(layout, task)).status).toBe('accepted');
  });
  it('treats omitted and explicit solid floor patterns as the same physical finish', async () => {
    const layout = venue(), task = await accepted(layout);
    const explicit = { ...layout, floors: [{ ...layout.floors[0], floorPattern: 'solid' as const }] };
    expect((await operationReview(explicit, task)).status).toBe('accepted');
  });
});

describe('explicit Shanghai time inputs', () => {
  it('displays a supplied timestamp in Shanghai without changing its original source string', () => {
    const source = '2026-10-07T21:30:15.123Z';
    expect(toShanghaiDateTimeInput(source)).toBe('2026-10-08T05:30:15.123');
    const result = fromShanghaiDateTimeInput('2026-10-08T05:30:15.123');
    expect(result).toBe('2026-10-08T05:30:15.123+08:00'); expect(Date.parse(result!)).toBe(Date.parse(source));
    expect(fromShanghaiDateTimeInput('2026-10-08T09:00')).toBe('2026-10-08T09:00:00+08:00');
    expect(toShanghaiDateTimeInput(null)).toBe(''); expect(fromShanghaiDateTimeInput('')).toBeNull();
  });
  it('lets the shared schema reject invalid non-empty dates instead of silently turning them into unknown times', () => {
    const invalid = fromShanghaiDateTimeInput('2026-02-30T09:00');
    expect(invalid).not.toBeNull(); expect(eventOperationTaskSchema.safeParse({ ...createOperation('演练', 'preparation'), plannedStartAt: invalid }).success).toBe(false);
  });
});

describe('operations delivery snapshot', () => {
  it('keeps operations outside strict Scene and shares export identity without loading URLs', async () => {
    const layout = venue(); layout.eventOperations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [createOperation('=演练签到', 'event')] });
    layout.eventOperations.tasks[0].ownerName = '=演练人员';
    const snapshot = { id: 'rehearsal-delivery', generatedAt: '2026-10-07T08:00:00Z' };
    const bundle = JSON.parse(await sceneDeliveryJson(layout, snapshot));
    expect(sceneSchema.safeParse(bundle.scene).success).toBe(true); expect(bundle.scene).not.toHaveProperty('eventOperations');
    expect(bundle).toMatchObject({ snapshot, operationsTimeZone: 'Asia/Shanghai', source: { kind: 'editor-snapshot', layoutId: layout.id }, operations: { dataKind: 'rehearsal' } });
    const csv = await eventOperationsCsv(layout, snapshot);
    expect(csv).toContain('"\'=演练签到"'); expect(csv).toContain('"\'=演练人员"'); expect(csv).toContain(snapshot.id); expect(csv).toContain('Asia/Shanghai');
    expect(csv.startsWith('\uFEFF')).toBe(true);
  });
  it('exports text operations for a complete venue without silently exporting partial model materials', async () => {
    const layout = { ...venue(), scenePreset: 'gym' as const };
    layout.eventOperations = eventOperationsSchema.parse({ dataKind: 'rehearsal', tasks: [createOperation('演练主持', 'event')] });
    expect(await eventOperationsCsv(layout)).toContain('演练主持');
    await expect(sceneDeliveryJson(layout)).rejects.toThrow('完整场景预设');
  });
  it('exports missing-instance status with preserved timestamps and evidence and omits local review digests', async () => {
    const layout = venue(); const task = await accepted(layout, [objectId]);
    layout.eventOperations = eventOperationsSchema.parse({ tasks: [task] });
    const deleted = { ...layout, floors: [makeFloor()] };
    const operations = await deliveryOperations(deleted);
    expect(operations!.tasks[0]).toMatchObject({ effectiveStatus: 'needs_review', missingObjectIds: [objectId], actualStartedAt: task.actualStartedAt, evidenceNote: task.evidenceNote });
    expect(operations!.tasks[0]).not.toHaveProperty('reviewedBasis'); expect(await eventOperationsCsv(deleted)).toContain('需复核');
  });
});
