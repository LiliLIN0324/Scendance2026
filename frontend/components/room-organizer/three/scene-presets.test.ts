import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertPreset } from '../../../../scripts/package-scene-presets.mjs';
import { layoutStore } from '../hooks/use-layout-store';
import { layoutToBackendScene } from '../lib/backend-adapter';
import { batchLayerEdit, materialLayers } from '../lib/scene-layers';
import { editorItemLimit, presetModelUrl } from '../lib/scene-presets';
import { parseStoredLayout } from '../lib/schema';
import { clearGlbAssetCache, createCachedGlbModel, disposeOwnedModel, getGlbAssetSource } from './glb-assets';
import { createPresetStructure, loadScenePreset } from './scene-presets';

afterEach(() => { clearGlbAssetCache(); vi.restoreAllMocks(); });

// Exercise real archive geometry in Node. Only image-backed materials are
// replaced here; the actual textured GLBs are checked in the browser.
function geometryBuffer(buffer: Buffer): ArrayBuffer {
  const oldLength = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.subarray(20, 20 + oldLength).toString());
  document.materials = document.materials.map(() => ({}));
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
  const result = Buffer.concat([buffer.subarray(0, 20), padded, buffer.subarray(20 + oldLength)]);
  result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded.length, 12);
  return new Uint8Array(result).buffer;
}

describe('editable scene archives', () => {
  // gym and popup are hand-grouped archives; the other eight are driven by the
  // layer plan in scripts/package-scene-presets.mjs. The counts are asserted
  // here so a plan change that silently drops fixtures fails loudly.
  it.each([
    ['gym', 307], ['popup', 42], ['bar', 38], ['cafe', 46], ['conference', 212],
    ['lawn', 135], ['market', 57], ['museum', 23], ['office', 76], ['studio', 24],
  ] as const)('opens every %s fixture at its archived position and persists edits', async (key, count) => {
    const original = readFileSync(new URL(`../../../../scene/templates/${key}/${key}.glb`, import.meta.url));
    const converted = convertPreset(original, key);
    const document = JSON.parse(converted.subarray(20, 20 + converted.readUInt32LE(12)).toString()) as { nodes: { children?: number[] }[] };
    const parents = new Set<number>();
    for (const node of document.nodes) {
      if (node.children) expect(node.children.length).toBeGreaterThan(0);
      for (const child of node.children ?? []) {
        expect(parents.has(child)).toBe(false);
        parents.add(child);
      }
    }
    // Reparenting preserves the entire binary payload (including textures).
    expect(converted.subarray(20 + converted.readUInt32LE(12)).equals(original.subarray(20 + original.readUInt32LE(12)))).toBe(true);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(geometryBuffer(converted)));
    const layout = await loadScenePreset(key);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(layout.floors[0].items).toHaveLength(count);
    expect(editorItemLimit(layout)).toBeGreaterThan(count);
    expect(parseStoredLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
    expect(parseStoredLayout({ ...layout, scenePreset: 'unknown' })).toBeNull();
    expect(() => layoutToBackendScene(layout)).toThrow('暂不支持云保存');
    const source = getGlbAssetSource(presetModelUrl(key))!;
    for (const item of layout.floors[0].items) {
      const originalBounds = new THREE.Box3().setFromObject(source.getObjectByName(item.glbNode!)!);
      const model = createCachedGlbModel(item)!;
      model.position.set(item.position!.x, 0, item.position!.z);
      const bounds = new THREE.Box3().setFromObject(model);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(bounds.min[axis]).toBeCloseTo(originalBounds.min[axis], 5);
        expect(bounds.max[axis]).toBeCloseTo(originalBounds.max[axis], 5);
      }
      disposeOwnedModel(model);
    }
    const structure = createPresetStructure(key)!;
    expect(structure).not.toBeNull(); disposeOwnedModel(structure);
    const actions = layoutStore.getState().actions;
    actions.applyLayout(layout);
    if (key === 'gym' || key === 'popup') {
      const chairs = new Set(materialLayers(layout.floors[0].items).find(layer => layer.name === '全部椅子')!.itemIds);
      expect(chairs.size).toBeGreaterThan(1);
      const moved = batchLayerEdit(layout.floors[0].items, chairs, { x: 0.2, y: 0.2, z: 0.3 });
      actions.replaceItems(moved);
      expect(layoutStore.getState().layout.floors[0].items).toEqual(moved);
      actions.applyLayout(layout);
    }
    // Edit the smallest fixture rather than the first one: a preset's first item
    // can be a wall-length fixture (bar opens with a 7 m back-bar), and once it
    // sits at (1, 2) a 90° rotation leaves the 12 × 9 m venue — which the
    // reducer refuses, correctly. The assertion is about persistence, so any
    // real fixture proves it.
    const item = [...layout.floors[0].items].sort((a, b) => a.width * a.depth - b.width * b.depth)[0]!;
    actions.moveItem(item.id, 1, 2);
    actions.setRotation(item.id, Math.PI / 2);
    actions.resizeItem(item.id, 'height', item.height * 1.2);
    const duplicate = actions.duplicateItem(item.id);
    const edited = layoutStore.getState().layout;
    expect(edited.floors[0].items.find(i => i.id === item.id)).toMatchObject({ position: { x: 1, z: 2 }, rotation: Math.PI / 2, glbNode: item.glbNode, elevation: item.elevation });
    expect(edited.floors[0].items.find(i => i.id === duplicate)?.glbNode).toBe(item.glbNode);
    expect(parseStoredLayout(JSON.parse(JSON.stringify(edited)))).toEqual(edited);
    actions.removeItem(item.id);
    expect(layoutStore.getState().layout.floors[0].items.some(i => i.id === item.id)).toBe(false);
  });
});
