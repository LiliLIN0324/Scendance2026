import { afterEach, describe, expect, it } from 'vitest';
import { handoffSchema, type Handoff } from '../../../../supabase/functions/_shared/delivery-contract';
import { layoutReducer, type LayoutState } from '../hooks/layout-reducer';
import { makeFloor, makeItem, makeLayout } from './__testfixtures__/fixtures';
import { buildPasteItems, clearClipboard, copyToClipboard } from './clipboard';
import { STORAGE_KEY } from './constants';
import { customSetToFurnitureSet, listCustomSets, saveCustomSet } from './custom-sets';
import { buildFurnitureSet } from './furniture-sets';
import { parseLayoutJson, saveLayout } from './persistence';
import { MAX_ID_LENGTH, parseStoredLayout } from './schema';
import { decodeShareUrl, encodeShareUrl } from './share';
import { getSnapshot, listSnapshots, recordSnapshot, type VersionHistoryStore } from './version-history';
import type { FurnitureItem } from './types';

const accepted = (): Handoff => handoffSchema.parse({
  ownerName: '陈师傅',
  dueDate: '2026-10-08',
  acceptance: '宽度和摆放点核对通过',
  status: 'accepted',
  evidenceUrls: ['https://example.com/evidence/1'],
  evidenceNote: '现场照片与尺寸已核对',
  reviewedBasis: 'test-basis',
});

function assigned(overrides: Partial<FurnitureItem> = {}): FurnitureItem {
  return makeItem({ id: 'table-1', handoff: accepted(), ...overrides });
}

function stateWith(items = [assigned()]): LayoutState {
  return { layout: makeLayout({ floors: [makeFloor({ items })] }), activeFloorIndex: 0 };
}

function memoryStore(): VersionHistoryStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

afterEach(clearClipboard);

describe('local handoff lifecycle', () => {
  it('round-trips all shared execution fields through save, reload and restore points', () => {
    const { layout } = stateWith();
    const storage = memoryStore();
    expect(saveLayout(layout, storage).ok).toBe(true);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)).toEqual(layout);
    expect(recordSnapshot(layout, { storage, now: () => 1000, force: true })).toBe(true);
    const [snapshot] = listSnapshots({ storage, now: () => 1000 });
    expect(getSnapshot(snapshot!.id, { storage, now: () => 1000 })).toEqual(layout);
  });

  it('normalises optional draft inputs with the shared schema instead of dropping them', () => {
    const handoff = { ownerName: '  张三  ', acceptance: '  到场核对  ' } as Handoff;
    const parsed = parseStoredLayout(stateWith([assigned({ handoff })]).layout)!;
    expect(parsed.floors[0]!.items[0]!.handoff).toEqual(handoffSchema.parse(handoff));
    expect(parseStoredLayout(parsed)).toBe(parsed);
  });

  it.each([
    { status: 'review' },
    { ...accepted(), ownerName: '' },
    { ...accepted(), dueDate: '2026-02-30' },
    { ...accepted(), evidenceUrls: [], evidenceNote: '' },
    { ...accepted(), reviewedBasis: ' ' },
    { ...accepted(), evidenceUrls: ['javascript:alert(1)'] },
    { ...accepted(), hidden: true },
  ])('refuses invalid execution records on reload and update without writing accepted state: %j', (invalid) => {
    const handoff = invalid as Handoff;
    expect(parseStoredLayout(stateWith([assigned({ handoff })]).layout)).toBeNull();
    const before = stateWith([makeItem({ id: 'table-1' })]);
    const after = layoutReducer(before, { type: 'updateItem', id: 'table-1', patch: { handoff } });
    expect(after).toBe(before);
    const storage = memoryStore();
    saveLayout(after.layout, storage);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).floors[0].items[0]).not.toHaveProperty('handoff');
  });

  it('keeps unchanged patches out of history and permits clearing execution fields', () => {
    const before = stateWith();
    expect(layoutReducer(before, { type: 'updateItem', id: 'table-1', patch: { handoff: accepted() } })).toBe(before);
    const cleared = layoutReducer(before, { type: 'updateItem', id: 'table-1', patch: { handoff: undefined } });
    expect(cleared.layout.floors[0]!.items[0]!.handoff).toBeUndefined();
    expect(parseLayoutJson(JSON.stringify(cleared.layout))!.floors[0]!.items[0]).not.toHaveProperty('handoff');
    expect(before.layout.floors[0]!.items[0]!.handoff).toEqual(accepted());
  });

  it('retains old review evidence through edits and restores the entire record on undo/redo snapshots', () => {
    const before = stateWith();
    const moved = layoutReducer(before, { type: 'moveItem', id: 'table-1', x: 2, z: 1 });
    expect(moved.layout.floors[0]!.items[0]!.handoff).toEqual(accepted());
    const deleted = layoutReducer(moved, { type: 'removeItem', id: 'table-1' });
    expect(deleted.layout.floors[0]!.items).toEqual([]);
    // The history hook replays RoomLayout snapshots through this same action.
    const undoDelete = layoutReducer(deleted, { type: 'applyLayout', layout: moved.layout });
    expect(undoDelete.layout).toEqual(moved.layout);
    const undoMove = layoutReducer(undoDelete, { type: 'applyLayout', layout: before.layout });
    expect(undoMove.layout).toEqual(before.layout);
    const redoDelete = layoutReducer(undoMove, { type: 'applyLayout', layout: deleted.layout });
    expect(redoDelete.layout.floors[0]!.items).toEqual([]);
  });

  it('refuses ambiguous execution ids across floors and after id shortening', () => {
    const sameFloor = stateWith([assigned(), assigned()]).layout;
    expect(parseStoredLayout(sameFloor)).toBeNull();
    const crossFloor = makeLayout({ floors: [
      makeFloor({ items: [assigned()] }),
      makeFloor({ id: 'upper', items: [makeItem({ id: 'table-1' })] }),
    ] });
    expect(parseStoredLayout(crossFloor)).toBeNull();
    const prefix = 'x'.repeat(MAX_ID_LENGTH);
    expect(parseStoredLayout(stateWith([
      assigned({ id: `${prefix}first` }), makeItem({ id: `${prefix}second` }),
    ]).layout)).toBeNull();
    // Existing geometry-only repair stays available to old saves.
    expect(parseStoredLayout(stateWith([makeItem({ id: 'a' }), makeItem({ id: 'a' })]).layout)!
      .floors[0]!.items.map((item) => item.id)).toEqual(['a', 'a-2']);
  });

  it('rejects ambiguous records in saved design variants too', () => {
    const layout = makeLayout({ designBook: { activeId: 'v1', variants: [{
      id: 'v1', name: 'Variant', layout: stateWith([assigned(), makeItem({ id: 'table-1' })]).layout,
    }] } });
    expect(parseStoredLayout(layout)).toBeNull();
  });

  it('clears execution data on item, floor and clipboard copies while preserving the source', () => {
    const before = stateWith();
    const duplicate = layoutReducer(before, { type: 'duplicateItem', sourceId: 'table-1', newId: 'copy-1' });
    expect(duplicate.layout.floors[0]!.items[1]).not.toHaveProperty('handoff');
    const copiedFloor = layoutReducer(before, { type: 'duplicateFloor', sourceIndex: 0, newId: 'upper', idSuffix: 'fresh' });
    expect(copiedFloor.layout.floors[1]!.items[0]).not.toHaveProperty('handoff');
    copyToClipboard(before.layout.floors[0]!.items);
    const pasted = buildPasteItems({ roomWidth: 8, roomDepth: 8, idTag: 'fresh' });
    expect(pasted[0]).not.toHaveProperty('handoff');
    expect(pasted[0]!.id).not.toBe('table-1');
    expect(before.layout.floors[0]!.items[0]!.handoff).toEqual(accepted());
  });

  it('keeps reusable custom sets free of assignments and sanitises old set snapshots at placement', () => {
    const storage = memoryStore();
    const set = saveCustomSet([assigned()], '工作台', { storage, now: () => 1000 })!;
    expect(set.items[0]).not.toHaveProperty('handoff');
    expect(listCustomSets({ storage })[0]!.items[0]).not.toHaveProperty('handoff');
    const oldSet = { ...set, items: [assigned()] };
    const specification = customSetToFurnitureSet(oldSet);
    expect(specification.items[0]!.snapshot).not.toHaveProperty('handoff');
    expect(buildFurnitureSet(specification, { roomWidth: 8, roomDepth: 8, idPrefix: 'fresh' })[0])
      .not.toHaveProperty('handoff');
  });

  it('strips handoffs from public links and variants without changing geometry or the local original', async () => {
    const local = assigned({ position: { x: 2, z: -1 }, rotation: 0.5, color: '#123456' });
    const variant = stateWith([assigned({ id: 'variant-1' })]).layout;
    const layout = makeLayout({
      floors: [makeFloor({ items: [local] })],
      designBook: { activeId: 'v1', variants: [{ id: 'v1', name: 'Variant', layout: variant }] },
    });
    const { url } = await encodeShareUrl(layout, 'https://example.com');
    const reopened = await decodeShareUrl(url.slice(url.indexOf('#')));
    const { handoff: _handoff, ...geometry } = local;
    expect(reopened!.floors[0]!.items[0]).toEqual(geometry);
    expect(reopened!.designBook!.variants[0]!.layout.floors[0]!.items[0]).not.toHaveProperty('handoff');
    expect(layout.floors[0]!.items[0]!.handoff).toEqual(accepted());
    // Older public links carrying assignments must also load as geometry-only copies.
    const legacy = `#layout=${Buffer.from(JSON.stringify(layout)).toString('base64url')}`;
    expect((await decodeShareUrl(legacy))!.floors[0]!.items[0]).not.toHaveProperty('handoff');
  });
});
