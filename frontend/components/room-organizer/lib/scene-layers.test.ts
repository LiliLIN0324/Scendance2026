import { describe, expect, it } from 'vitest';
import { INITIAL_LAYOUT } from './initial-layout';
import { addDesign, switchDesign, materialLayers, batchLayerEdit } from './scene-layers';
import { parseStoredLayout } from './schema';

describe('scene layers', () => {
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
