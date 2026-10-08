import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventOperationTaskSchema, eventOperationsSchema, type EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { layoutStore } from '../hooks/use-layout-store';
import { layoutForExport } from '../../../lib/layout-export';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { STORAGE_KEY } from './constants';
import { readLayoutFromFile } from './file-io';
import { parseLayoutJson, saveLayout } from './persistence';
import { MAX_ID_LENGTH, parseStoredLayout } from './schema';
import { decodeShareUrl, encodeShareUrl } from './share';
import { getSnapshot, listSnapshots, recordSnapshot, type VersionHistoryStore } from './version-history';

const taskId = 'a1000000-0000-4000-8000-000000000001';
const originalStore = layoutStore.getState();
const task = () => eventOperationTaskSchema.parse({
  id: taskId, title: '舞台布场', phase: 'setup', ownerName: '陈师傅', contractorName: '搭建团队',
  acceptance: '布场位置和宽度核对', status: 'accepted', objectIds: ['table-1', 'chair-1'],
  plannedStartAt: '2026-10-08T23:30:00+08:00', plannedEndAt: '2026-10-09T00:30:00+08:00',
  actualStartedAt: '2026-10-08T15:35:00Z', actualFinishedAt: '2026-10-09T00:40:00+08:00',
  evidenceNote: '位置和尺寸已人工核对', evidenceUrls: ['https://example.com/operations/evidence'],
  reviewedBasis: `sha256:${'a'.repeat(64)}`,
});
const operations = (): EventOperations => eventOperationsSchema.parse({
  schemaVersion: 1, dataKind: 'rehearsal', tasks: [task(), {
    id: 'a1000000-0000-4000-8000-000000000002', title: '主持与签到', phase: 'event',
  }],
});
function stateWith(eventOperations = operations()): LayoutState {
  return { layout: makeLayout({ id: 'rehearsal-30', eventOperations, floors: [makeFloor({
    items: [makeItem({ id: 'table-1' }), makeItem({ id: 'chair-1' })],
  })] }), activeFloorIndex: 0 };
}
function memoryStore(): VersionHistoryStore {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}
afterEach(() => { layoutStore.setState(originalStore); vi.restoreAllMocks(); });

describe('local activity operations lifecycle', () => {
  it('opens old layouts without inventing operations, then saves an explicit task with no material', () => {
    const old = makeLayout();
    expect(parseStoredLayout(old)).toBe(old);
    expect(parseStoredLayout(old)).not.toHaveProperty('eventOperations');
    const draft = { tasks: [{ id: taskId, title: '  主持与签到  ', phase: 'event' }] } as EventOperations;
    const next = layoutReducer({ layout: old, activeFloorIndex: 0 }, { type: 'setEventOperations', value: draft });
    expect(next.layout.eventOperations).toEqual(eventOperationsSchema.parse(draft));
    expect(next.layout.eventOperations!.tasks[0]).toMatchObject({ objectIds: [], ownerName: '',
      plannedStartAt: null, plannedEndAt: null, actualStartedAt: null, actualFinishedAt: null, status: 'todo' });
    expect(parseLayoutJson(JSON.stringify(next.layout))).toEqual(next.layout);
  });

  it('keeps all fields in local saves, restore points and nested design snapshots', () => {
    const before = stateWith().layout;
    const layout = { ...before, designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '第一方案', layout: before }] } };
    const storage = memoryStore();
    expect(saveLayout(layout, storage).ok).toBe(true);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)).toEqual(layout);
    expect(recordSnapshot(layout, { storage, now: () => 1000, force: true })).toBe(true);
    const [snapshot] = listSnapshots({ storage, now: () => 1000 });
    expect(getSnapshot(snapshot!.id, { storage, now: () => 1000 })).toEqual(layout);
    expect(parseStoredLayout(layout)).toEqual(layout);
  });

  it('normalises defaults in root, legacy and saved variant metadata without shortening task or reference IDs', () => {
    const id = 'x'.repeat(MAX_ID_LENGTH);
    const draft = { tasks: [{ id: taskId.toUpperCase(), title: '  签到  ', phase: 'event', objectIds: [id] }] } as EventOperations;
    const snapshot = makeLayout({ eventOperations: draft });
    const layout = makeLayout({ eventOperations: draft,
      designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '方案', layout: snapshot }] } });
    const expected = eventOperationsSchema.parse(draft);
    const parsed = parseStoredLayout(layout)!;
    expect(parsed.eventOperations).toEqual(expected);
    expect(parsed.designBook!.variants[0]!.layout.eventOperations).toEqual(expected);
    expect(parsed.eventOperations!.tasks[0]!.id).toBe(taskId.toUpperCase());
    expect(parsed.eventOperations!.tasks[0]!.objectIds).toEqual([id]);
    const legacy = { name: '旧单层', width: 8, height: 6, items: [], floorColor: '#ffffff', eventOperations: draft };
    expect(parseStoredLayout(legacy)!.eventOperations).toEqual(expected);
    expect(parseStoredLayout(parsed)).toEqual(parsed);
  });

  it('keeps original references through deletion, same-name replacements and item/floor copies', () => {
    const before = stateWith();
    const deleted = layoutReducer(before, { type: 'removeItem', id: 'table-1' });
    const added = layoutReducer(deleted, { type: 'addItems', items: [makeItem({ id: 'replacement-1', name: 'Chair' })] });
    expect(added.layout.eventOperations).toBe(before.layout.eventOperations);
    const refs = added.layout.eventOperations!.tasks[0]!.objectIds;
    const present = new Set(added.layout.floors.flatMap((floor) => floor.items.map((item) => item.id)));
    expect(refs.filter((id) => !present.has(id))).toEqual(['table-1']);
    const restored = layoutReducer(added, { type: 'applyLayout', layout: before.layout });
    expect(restored.layout).toEqual(before.layout);
    const duplicate = layoutReducer(before, { type: 'duplicateItem', sourceId: 'table-1', newId: 'copy-1' });
    expect(duplicate.layout.eventOperations).toBe(before.layout.eventOperations);
    expect(duplicate.layout.eventOperations!.tasks[0]!.objectIds).not.toContain('copy-1');
    const floorCopy = layoutReducer(before, { type: 'duplicateFloor', sourceIndex: 0, newId: 'upper', idSuffix: 'fresh' });
    expect(floorCopy.layout.eventOperations).toBe(before.layout.eventOperations);
    expect(floorCopy.layout.eventOperations!.tasks).toHaveLength(2);
    expect(floorCopy.layout.floors[1]!.items.map((item) => item.id)).not.toContain('table-1');
  });

  it('allows already-missing references but rejects ambiguous and repair-created links', () => {
    const missing = operations();
    missing.tasks[0]!.objectIds = ['missing', 'x'.repeat(128)];
    expect(parseStoredLayout(stateWith(missing).layout)!.eventOperations).toEqual(missing);
    const base = stateWith().layout;
    expect(parseStoredLayout({ ...base, floors: [makeFloor({ items: [makeItem({ id: 'table-1' }), makeItem({ id: 'table-1' })] })] })).toBeNull();
    expect(parseStoredLayout({ ...base, floors: [base.floors[0]!, makeFloor({ id: 'upper', items: [makeItem({ id: 'table-1' })] })] })).toBeNull();
    const shortened = operations();
    shortened.tasks[0]!.objectIds = ['x'.repeat(128)];
    expect(parseStoredLayout({ ...base, eventOperations: shortened, floors: [makeFloor({ items: [makeItem({ id: 'x'.repeat(129) })] })] })).toBeNull();
    const repaired = operations();
    repaired.tasks[0]!.objectIds = ['a-2'];
    expect(parseStoredLayout({ ...base, eventOperations: repaired, floors: [makeFloor({ items: [makeItem({ id: 'a' }), makeItem({ id: 'a' })] })] })).toBeNull();
    // Geometry-only legacy repairs still work when no task would become associated.
    expect(parseStoredLayout(makeLayout({ floors: [makeFloor({ items: [makeItem({ id: 'a' }), makeItem({ id: 'a' })] })] }))!
      .floors[0]!.items.map((item) => item.id)).toEqual(['a', 'a-2']);
  });

  it('rejects a new association to duplicate cross-floor IDs before store saving and retains the old layout', () => {
    const old = makeLayout({ floors: [
      makeFloor({ items: [makeItem({ id: 'table-1' })] }),
      makeFloor({ id: 'upper', items: [makeItem({ id: 'table-1' })] }),
    ] });
    expect(parseStoredLayout(old)).toEqual(old);
    const before = { layout: old, activeFloorIndex: 1 };
    const value = operations();
    expect(layoutReducer(before, { type: 'setEventOperations', value })).toBe(before);
    layoutStore.setState(before);
    const state = layoutStore.getState();
    expect(() => state.actions.setEventOperations(value)).toThrow('活动安排未保存');
    expect(layoutStore.getState()).toBe(state);
    expect(layoutStore.getState().layout).toBe(old);
    expect(layoutStore.getState().activeFloorIndex).toBe(1);
  });

  it('keeps missing references valid on update without repairing geometry or attaching them to generated IDs', () => {
    const old = makeLayout({ floors: [makeFloor({ items: [
      makeItem({ id: 'a' }), makeItem({ id: 'a' }), makeItem({ id: 'x'.repeat(129) }),
    ] })] });
    layoutStore.setState({ layout: old, activeFloorIndex: 0 });
    const value = operations();
    value.tasks[0]!.objectIds = ['missing'];
    expect(() => layoutStore.getState().actions.setEventOperations(value)).not.toThrow();
    const saved = layoutStore.getState();
    expect(saved.layout.floors).toBe(old.floors);
    expect(saved.layout.floors[0]!.items.map((item) => item.id)).toEqual(['a', 'a', 'x'.repeat(129)]);
    expect(saved.layout.eventOperations!.tasks[0]!.objectIds).toEqual(['missing']);
    expect(parseStoredLayout(saved.layout)!.eventOperations).toEqual(value);
    const wouldAttach = { ...value, tasks: [{ ...value.tasks[0]!, objectIds: ['a-2'] }] };
    expect(layoutReducer(saved, { type: 'setEventOperations', value: wouldAttach })).toBe(saved);
    expect(() => saved.actions.setEventOperations(wouldAttach)).toThrow('活动安排未保存');
    expect(layoutStore.getState()).toBe(saved);
    const wouldShorten = { ...value, tasks: [{ ...value.tasks[0]!, objectIds: ['x'.repeat(128)] }] };
    expect(() => saved.actions.setEventOperations(wouldShorten)).toThrow('活动安排未保存');
    expect(layoutStore.getState()).toBe(saved);
  });

  it('updates through the existing store, preserves actual records on plan edits, and clears explicitly', () => {
    const before = stateWith();
    layoutStore.setState(before);
    const { actions } = layoutStore.getState();
    actions.setEventOperations(operations());
    expect(layoutStore.getState().layout).toBe(before.layout);
    const changed = operations();
    changed.tasks[0]!.plannedEndAt = '2026-10-09T00:50:00+08:00';
    actions.setEventOperations(changed);
    expect(layoutStore.getState().layout.eventOperations!.tasks[0]).toMatchObject({
      actualStartedAt: task().actualStartedAt, actualFinishedAt: task().actualFinishedAt,
      evidenceNote: task().evidenceNote, reviewedBasis: task().reviewedBasis,
    });
    actions.setEventOperations(undefined);
    expect(parseLayoutJson(JSON.stringify(layoutStore.getState().layout))).not.toHaveProperty('eventOperations');
    expect(before.layout.eventOperations).toEqual(operations());
  });

  it.each([
    { ...operations(), hidden: true },
    { ...operations(), tasks: [{ ...task(), hidden: true }] },
    { ...operations(), tasks: [task(), { ...task(), id: taskId.toUpperCase() }] },
    { ...operations(), tasks: [{ ...task(), objectIds: ['x'.repeat(129)] }] },
    { ...operations(), tasks: [{ ...task(), plannedEndAt: '2026-10-08T23:00:00+08:00' }] },
    { ...operations(), tasks: [{ ...task(), plannedStartAt: '2026-02-30T23:30:00+08:00' }] },
    { ...operations(), tasks: [{ ...task(), actualFinishedAt: '2026-10-08T23:00:00+08:00' }] },
    { ...operations(), tasks: [{ ...task(), evidenceNote: '' }] },
    { ...operations(), tasks: [{ ...task(), reviewedBasis: undefined }] },
  ])('rejects illegal metadata on import and both mutation paths while retaining the original: %j', async (invalid) => {
    const before = stateWith();
    const value = invalid as EventOperations;
    expect(parseStoredLayout({ ...before.layout, eventOperations: value })).toBeNull();
    const nested = makeLayout({ designBook: { activeId: 'v1', variants: [{
      id: 'v1', name: '坏快照', layout: { ...before.layout, eventOperations: value },
    }] } });
    expect(parseStoredLayout(nested)).toBeNull();
    expect(layoutReducer(before, { type: 'setEventOperations', value })).toBe(before);
    layoutStore.setState(before);
    const storeState = layoutStore.getState();
    expect(() => storeState.actions.setEventOperations(value)).toThrow('活动安排未保存');
    expect(layoutStore.getState()).toBe(storeState);
    expect(layoutReducer(before, { type: 'applyLayout', layout: { ...before.layout, eventOperations: value } })).toBe(before);
    expect(layoutReducer(before, { type: 'applyLayout', layout: nested })).toBe(before);
    await expect(readLayoutFromFile(new File([JSON.stringify({ ...before.layout, eventOperations: value })], 'invalid.json'))).rejects.toThrow(/does not match/);
    expect(before.layout.eventOperations).toEqual(operations());
  });

  it('keeps editing backups complete and strips operations recursively from public links, including old links', async () => {
    const before = stateWith().layout;
    const layout = { ...before, designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '方案', layout: before }] } };
    const original = JSON.stringify(layout);
    expect(layoutForExport(layout).eventOperations).toEqual(operations());
    expect(layoutForExport(layout).designBook!.variants[0]!.layout.eventOperations).toEqual(operations());
    const { url } = await encodeShareUrl(layout, 'https://example.com');
    const shared = await decodeShareUrl(url.slice(url.indexOf('#')));
    expect(shared).not.toHaveProperty('eventOperations');
    expect(shared!.designBook!.variants[0]!.layout).not.toHaveProperty('eventOperations');
    const legacy = `#layout=${Buffer.from(original).toString('base64url')}`;
    expect((await decodeShareUrl(legacy))!.designBook!.variants[0]!.layout).not.toHaveProperty('eventOperations');
    expect(JSON.stringify(layout)).toBe(original);
  });

  it('preserves the saved version and current draft when browser storage refuses a write', () => {
    const before = stateWith().layout;
    const storage = memoryStore();
    expect(saveLayout(before, storage).ok).toBe(true);
    const saved = storage.getItem(STORAGE_KEY);
    const changed = operations();
    changed.tasks[0]!.ownerName = '待重新核对的责任人';
    const draft = layoutReducer({ layout: before, activeFloorIndex: 0 }, { type: 'setEventOperations', value: changed }).layout;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(storage, 'setItem').mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError'); });
    expect(saveLayout(draft, storage)).toEqual({ ok: false, reason: 'blocked' });
    expect(storage.getItem(STORAGE_KEY)).toBe(saved);
    expect(draft.eventOperations).toEqual(changed);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)!.eventOperations).toEqual(operations());
  });
});
