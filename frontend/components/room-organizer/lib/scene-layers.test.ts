import { describe, expect, it } from 'vitest';
import { serializeLocalProjectBackupV3, parseLocalProjectBackupJson } from '../../../lib/local-project-backup';
import { preserveCurrentActivity } from '../../../lib/production-plan';
import { createLayoutStore } from '../hooks/use-layout-store';
import { INITIAL_LAYOUT } from './initial-layout';
import { blankHandoff, handoffBasis, effectiveHandoffStatus } from './scene-handoff';
import { addDesign, switchDesign, materialLayers, batchLayerEdit } from './scene-layers';
import { parseStoredLayout } from './schema';

describe('scene layers', () => {
  it('retains an absent object’s work order across design switching and reload', () => {
    const base = structuredClone(INITIAL_LAYOUT);
    const item = base.floors[0]!.items[0]!;
    item.handoff = { ...blankHandoff(), ownerName: '演练搭建甲', evidenceNote: '演练工作单' };
    const other = addDesign(base, { ...base, floors: [{ ...base.floors[0]!, items: [] }] });
    const restored = parseStoredLayout(JSON.parse(JSON.stringify(other)))!;
    const original = switchDesign(restored, 'original');
    expect(original.floors[0]!.items[0]!.handoff).toEqual(item.handoff);
  });

  it.each([false, true])('keeps latest edits or explicit removal after deletion, clear=%s', clear => {
    const base = structuredClone(INITIAL_LAYOUT), item = base.floors[0]!.items[0]!;
    item.handoff = { ...blankHandoff(), ownerName: '演练旧负责人' };
    const store = createLayoutStore({ layout: addDesign(base, base), activeFloorIndex: 0 });
    const handoff = clear ? undefined : { ...blankHandoff(), ownerName: '演练新负责人', evidenceNote: '最新说明' };
    store.getState().actions.updateItem(item.id, { handoff });
    store.getState().actions.removeItem(item.id);
    const restored = parseStoredLayout(JSON.parse(JSON.stringify(store.getState().layout)))!;
    expect(switchDesign(restored, 'original').floors[0]!.items[0]!.handoff).toEqual(handoff);
    // Existing snapshots must not be mutated by later edits.
    expect(base.floors[0]!.items[0]!.handoff?.ownerName).toBe('演练旧负责人');
  });

  it.each(['removeItem', 'clearItems', 'replaceItems', 'preset'] as const)('checkpoints imported current records before %s removes objects', action => {
    const base = structuredClone(INITIAL_LAYOUT), item = base.floors[0]!.items[0]!;
    item.handoff = { ...blankHandoff(), ownerName: '演练旧负责人' };
    const imported = structuredClone(addDesign(base, base));
    imported.floors[0]!.items[0]!.handoff = { ...blankHandoff(), ownerName: '演练当前负责人' };
    const store = createLayoutStore({ layout: imported, activeFloorIndex: 0 });
    if (action === 'preset') store.getState().actions.applyLayout(preserveCurrentActivity(imported, { ...base, floors: [{ ...base.floors[0]!, items: [] }] }));
    else if (action === 'removeItem') store.getState().actions.removeItem(item.id);
    else if (action === 'replaceItems') store.getState().actions.replaceItems([]);
    else store.getState().actions.clearItems();
    expect(switchDesign(store.getState().layout, 'original').floors[0]!.items[0]!.handoff?.ownerName).toBe('演练当前负责人');
    expect(imported.designBook!.variants[0]!.layout.floors[0]!.items[0]!.handoff?.ownerName).toBe('演练旧负责人');
  });

  it('adopts undo and restore snapshots without borrowing current work orders', () => {
    const base = structuredClone(INITIAL_LAYOUT), item = base.floors[0]!.items[0]!;
    item.handoff = { ...blankHandoff(), ownerName: '演练原负责人' };
    const original = addDesign(base, base);
    const store = createLayoutStore({ layout: original, activeFloorIndex: 0 });
    store.getState().actions.updateItem(item.id, { handoff: { ...item.handoff, ownerName: '演练后来负责人' } });
    const edited = store.getState().layout;
    store.getState().actions.applyLayout(original);
    expect(switchDesign(store.getState().layout, 'original').floors[0]!.items[0]!.handoff?.ownerName).toBe('演练原负责人');
    store.getState().actions.applyLayout(edited);
    store.getState().actions.removeItem(item.id);
    expect(switchDesign(store.getState().layout, 'original').floors[0]!.items[0]!.handoff?.ownerName).toBe('演练后来负责人');
  });

  it('does not import work orders or saved books from external candidates', () => {
    const foreign = structuredClone(INITIAL_LAYOUT);
    foreign.floors[0]!.items[0]!.id = 'foreign-object';
    foreign.floors[0]!.items[0]!.handoff = { ...blankHandoff(), ownerName: '不应导入的负责人' };
    const candidate = addDesign(foreign, foreign);
    const result = preserveCurrentActivity(INITIAL_LAYOUT, candidate);
    expect(result.designBook).toBeUndefined();
    expect(result.floors[0]!.items.every(item => !item.handoff)).toBe(true);
  });

  it('roundtrips latest work orders through V3 backup and requires review against different geometry', async () => {
    const base = structuredClone(INITIAL_LAYOUT);
    base.id = 'design-work-order-rehearsal';
    const item = base.floors[0]!.items[0]!;
    const candidate = structuredClone(base);
    candidate.floors[0]!.items[0]!.position = { x: 0, z: 0 };
    const added = addDesign(base, candidate);
    const handoff = { ...blankHandoff(), ownerName: '演练搭建乙', dueDate: '2026-10-10', acceptance: '核对位置', status: 'accepted' as const,
      evidenceNote: '演练位置核对', reviewedBasis: await handoffBasis(added, item.id, '核对位置') };
    const store = createLayoutStore({ layout: added, activeFloorIndex: 0 });
    store.getState().actions.updateItem(item.id, { handoff });
    expect(await effectiveHandoffStatus(store.getState().layout, item.id)).toBe('accepted');
    store.getState().actions.removeItem(item.id);
    const saved = serializeLocalProjectBackupV3(store.getState().layout,
      { state: 'ready', scope: base.id, brief: { status: 'absent' } },
      { state: 'ready', scope: base.id, materialCheckins: { status: 'absent' } });
    const restored = switchDesign(parseLocalProjectBackupJson(saved).layout, 'original');
    expect(restored.floors[0]!.items[0]!.handoff).toEqual(handoff);
    expect(await effectiveHandoffStatus(restored, item.id)).toBe('needs_review');
  });

  it('keeps independent AI proposals and the latest edits when switching, including after reload', () => {
    const a = addDesign(INITIAL_LAYOUT, { ...INITIAL_LAYOUT, name: 'A', floors: [{ ...INITIAL_LAYOUT.floors[0]!, items: [] }] });
    const edited = { ...a, name: 'edited A' };
    const b = addDesign(edited, { ...INITIAL_LAYOUT, name: 'B' });
    const restored = parseStoredLayout(JSON.parse(JSON.stringify(b)))!;
    expect(restored.designBook?.variants.map(v => v.name)).toEqual(['原始方案', 'AI 方案 A', 'AI 方案 B']);
    const switched = switchDesign(restored, restored.designBook!.variants[1]!.id);
    expect(switched.name).toBe('edited A');
    expect(switched.floors[0]!.items).toHaveLength(0);
    expect(switchDesign(switched, restored.designBook!.activeId).name).toBe('B');
    expect(switched.designBook!.variants.every(v => !('designBook' in v.layout))).toBe(true);
  });

  it('selects all chairs and tables and atomically skips locked objects in batch edits', () => {
    const items = INITIAL_LAYOUT.floors[0]!.items;
    expect(materialLayers(items).find(l => l.name === '全部桌子')?.itemIds).toHaveLength(2);
    expect(materialLayers(items).find(l => l.name === '全部椅子')?.itemIds).toHaveLength(2);
    const locked = { ...items[0]!, locked: true };
    const model = { ...items[1]!, glbUrl: '/assets/example.glb' };
    const result = batchLayerEdit([locked, model, items[2]!], new Set(items.map(i => i.id)), { x: 0.2, y: -0.3, z: 0.5, color: '#123456' });
    expect(result[0]).toBe(locked);
    expect(result[1]!.color).toBe(model.color);
    expect(result[1]!.position!.x).toBeCloseTo(model.position!.x + 0.2);
    expect(result[1]!.position!.z).toBeCloseTo(model.position!.z - 0.3);
    expect(result[2]).toMatchObject({ elevation: 0.5, color: '#123456' });
    const painted = batchLayerEdit([items[2]!], new Set([items[2]!.id]), { x: 0, y: 0, z: 0, color: '#654321' });
    expect(painted[0]!.elevation).toBeUndefined();
    expect(() => batchLayerEdit(items, new Set(items.map(i => i.id)), { x: 0, y: 0, z: -1 })).toThrow('整组保持原位');
  });

  it('preserves custom layers and rejects nested snapshots or invalid member IDs', () => {
    const layout = { ...INITIAL_LAYOUT, itemLayers: [{ id: 'layer-a', name: '舞台区', itemIds: [INITIAL_LAYOUT.floors[0]!.items[0]!.id] }] };
    expect(parseStoredLayout(layout)?.itemLayers).toEqual(layout.itemLayers);
    expect(parseStoredLayout({ ...layout, itemLayers: [{ id: 'bad', name: 'bad', itemIds: [123] }] })).toBeNull();
    const saved = addDesign(layout, INITIAL_LAYOUT);
    saved.designBook!.variants[0]!.layout = saved;
    expect(parseStoredLayout(saved)).toBeNull();
  });
});
