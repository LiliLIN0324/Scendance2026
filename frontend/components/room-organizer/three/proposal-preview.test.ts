import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendSceneToLayout } from '../lib/backend-adapter';
import { createFurnitureModel } from './furniture-builders';
import { clearGlbAssetCache, disposeOwnedModel, ensureGlbAsset } from './glb-assets';
import { createProposalPreview, proposalDifferences, PROPOSAL_PREVIEW_TAG } from './proposal-preview';
import type { FurnitureItem, RoomLayout } from '../lib/types';

const item: FurnitureItem = { id: 'chair-a', name: '椅子', type: 'chair', width: 0.5, depth: 0.5, height: 0.9, color: '#ab9876', icon: '', position: { x: 1, z: 2 }, rotation: 0 };
function layout(items: FurnitureItem[]): RoomLayout {
  const result = backendSceneToLayout({ schemaVersion: 1, venue: { shape: 'rectangle', width: 12, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview', lighting: 'warm' });
  result.floors[0].items = items;
  return result;
}

describe('proposal render overlay', () => {
  afterEach(() => { clearGlbAssetCache(); vi.restoreAllMocks(); });

  it.each(['chair', 'glb-asset'])('renders %s and its preview at the requested elevation exactly once', async type => {
    if (type === 'glb-asset') {
      const buffer = new Uint8Array(readFileSync(new URL('../../../../assets/models/table.glb', import.meta.url))).buffer;
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(buffer));
      await ensureGlbAsset('preview-height', '/assets/models/table.glb');
    }
    const placed = { ...item, type, elevation: 0.5, ...(type === 'glb-asset' ? { assetId: 'preview-height', glbUrl: '/assets/models/table.glb' } : {}) };
    const model = createFurnitureModel(THREE, placed, false);
    expect(new THREE.Box3().setFromObject(model).min.y).toBeCloseTo(0.5);
    const scene = new THREE.Scene();
    const preview = createProposalPreview(THREE, scene, layout([placed]), layout([{ ...placed, elevation: 1 }]));
    const root = scene.getObjectByName(PROPOSAL_PREVIEW_TAG)!;
    const candidate = root.children.find(o => o.userData.previewRole === 'candidate')!;
    const outline = root.children.find(o => o.userData.previewRole === 'new-position')!;
    expect(new THREE.Box3().setFromObject(candidate).min.y).toBeCloseTo(1);
    expect(new THREE.Box3().setFromObject(outline).min.y).toBeCloseTo(1);
    preview.dispose(); disposeOwnedModel(model);
  });
  it.each([
    { position: { x: 2, z: 2 } }, { rotation: Math.PI / 6 }, { width: 1 }, { depth: 1 }, { height: 1.5 }, { color: '#ffffff' },
  ])('recognizes the material edit %j without mutating either document', change => {
    const before = layout([item]);
    const next = layout([{ ...item, ...change }]);
    const saved = JSON.stringify([before, next]);
    expect(proposalDifferences(before, next)).toMatchObject([{ id: item.id, kind: 'changed' }]);
    expect(JSON.stringify([before, next])).toBe(saved);
  });

  it('identifies additions/removals and ignores unchanged or newly authorized URLs for the same asset', () => {
    const oldAsset = { ...item, assetId: 'same-asset', glbUrl: 'https://example.test/asset?token=old' };
    const newAsset = { ...oldAsset, glbUrl: 'https://example.test/asset?token=new' };
    expect(proposalDifferences(layout([oldAsset]), layout([newAsset]))).toEqual([]);
    expect(proposalDifferences(layout([item]), layout([{ ...item, id: 'new-item' }])).map(change => [change.id, change.kind]))
      .toEqual([[item.id, 'removed'], ['new-item', 'added']]);
  });

  it('renders a real translucent candidate, old position, and movement line while leaving selection and document untouched', () => {
    const scene = new THREE.Scene();
    const original = new THREE.Group();
    original.userData = { type: 'furniture', id: item.id };
    const originalMaterial = new THREE.MeshStandardMaterial({ color: item.color });
    const originalMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), originalMaterial);
    const selection = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
    selection.userData.type = 'selection-outline';
    original.add(originalMesh, selection);
    scene.add(original);
    const before = layout([item]);
    const after = layout([{ ...item, width: 1.2, color: '#3388ff', rotation: Math.PI / 6, position: { x: 3, z: 1 } }]);
    const originalData = JSON.stringify([before, after]);
    const preview = createProposalPreview(THREE, scene, before, after);
    const root = scene.getObjectByName(PROPOSAL_PREVIEW_TAG)!;
    const candidate = root.children.find(object => object.userData.previewRole === 'candidate')!;
    expect(candidate.position.toArray()).toEqual([3, 0, 1]);
    expect(candidate.rotation.y).toBeCloseTo(Math.PI / 6);
    expect(root.children.map(object => object.userData.previewRole)).toContain('movement');
    expect(root.children.map(object => object.userData.previewRole)).toContain('original-position');
    const ghostSeat = candidate.children[0] as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
    expect(ghostSeat.geometry.parameters.width).toBe(1.2);
    expect(ghostSeat.material.color.getHexString()).toBe('3388ff');
    expect(ghostSeat.material.transparent).toBe(true);
    expect(ghostSeat.material.opacity).toBe(0.72);
    expect(originalMesh.visible).toBe(false);
    expect(selection.visible).toBe(true);
    expect(originalMesh.material).toBe(originalMaterial);
    expect(originalMaterial.opacity).toBe(1);
    expect(JSON.stringify([before, after])).toBe(originalData);
    preview.dispose();
    expect(originalMesh.visible).toBe(true);
    expect(selection.visible).toBe(true);
    expect(scene.children).toEqual([original]);
  });

  it('owns and disposes every preview geometry/material without disposing original resources or enabling picking', () => {
    const scene = new THREE.Scene();
    const original = new THREE.Group();
    original.userData = { type: 'furniture', id: item.id };
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const disposeOriginal = vi.spyOn(mesh.geometry, 'dispose');
    original.add(mesh); scene.add(original);
    const preview = createProposalPreview(THREE, scene, layout([item]), layout([{ ...item, position: { x: 3, z: 1 } }]));
    const root = scene.getObjectByName(PROPOSAL_PREVIEW_TAG)!;
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    const intersections: THREE.Intersection[] = [];
    root.traverse(node => {
      node.raycast(new THREE.Raycaster(), intersections);
      expect(node.userData.type).not.toBe('furniture');
      const drawable = node as THREE.Mesh;
      if (drawable.geometry) resources.add(drawable.geometry);
      if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) resources.add(material);
    });
    const disposals = [...resources].map(resource => vi.spyOn(resource, 'dispose'));
    expect(intersections).toEqual([]);
    preview.dispose();
    for (const dispose of disposals) expect(dispose).toHaveBeenCalled();
    const counts = disposals.map(dispose => dispose.mock.calls.length);
    preview.dispose();
    expect(disposals.map(dispose => dispose.mock.calls.length)).toEqual(counts);
    expect(disposeOriginal).not.toHaveBeenCalled();
  });

  it('refreshes after the editor rebuilds an affected mesh, and restores its original visibility on cancel', () => {
    const scene = new THREE.Scene();
    const preview = createProposalPreview(THREE, scene, layout([item]), layout([]));
    const group = new THREE.Group();
    group.userData = { type: 'furniture', id: item.id };
    const visible = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const alreadyHidden = visible.clone(); alreadyHidden.visible = false;
    group.add(visible, alreadyHidden); scene.add(group);
    expect(preview.refreshOriginals()).toBe(true);
    expect(visible.visible).toBe(false);
    expect(preview.refreshOriginals()).toBe(false);
    preview.dispose();
    expect(visible.visible).toBe(true);
    expect(alreadyHidden.visible).toBe(false);
  });
});
