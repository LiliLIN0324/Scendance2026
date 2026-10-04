import { mountBand } from '../lib/mount-band';
import { floorElevation, itemForStorey } from '../lib/storeys';
import { disposeObject } from './builder-utils';
import { createFurnitureModel } from './furniture-builders';
import { buildStructureShell } from './structure-builder';
import type { FurnitureItem, RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export const PROPOSAL_PREVIEW_TAG = 'proposal-preview';
type LocatedItem = { item: FurnitureItem; floorIndex: number };
export type ProposalDifference = { id: string; kind: 'added' | 'removed' | 'changed'; before?: LocatedItem; after?: LocatedItem };

function itemsById(layout: RoomLayout): Map<string, LocatedItem> {
  return new Map(layout.floors.flatMap((floor, floorIndex) => floor.items.map(item => [item.id, { item, floorIndex }] as const)));
}

function visibleValues({ item, floorIndex }: LocatedItem) {
  return [floorIndex, item.type, item.assetId, item.assetId ? null : item.glbUrl, item.glbNode, item.materialId, item.width, item.depth, item.height,
    item.position?.x, item.position?.z, item.elevation ?? 0, item.sillHeight, item.rotation ?? 0, item.mirrored ?? false, item.color, item.locked ?? false, item.notes ?? ''];
}

function sameVisibleValues(before: LocatedItem, after: LocatedItem): boolean {
  const next = visibleValues(after);
  // Origin/angle conversion can add machine noise without changing visible geometry.
  return visibleValues(before).every((value, index) => {
    const other = next[index];
    return typeof value === 'number' && typeof other === 'number' ? Math.abs(value - other) <= 1e-12 : value === other;
  });
}

export function proposalDifferences(before: RoomLayout, after: RoomLayout): ProposalDifference[] {
  const old = itemsById(before), next = itemsById(after);
  const differences: ProposalDifference[] = [];
  for (const [id, item] of old) {
    const replacement = next.get(id);
    if (!replacement) differences.push({ id, kind: 'removed', before: item });
    else if (!sameVisibleValues(item, replacement)) differences.push({ id, kind: 'changed', before: item, after: replacement });
  }
  for (const [id, item] of next) if (!old.has(id)) differences.push({ id, kind: 'added', after: item });
  return differences;
}

export interface ProposalPreview {
  /** A legacy mesh rebuild must remain ghosted until this preview closes. */
  refreshOriginals(): boolean;
  dispose(): void;
}

/**
 * An owned render layer, never a RoomLayout mutation. Original materials,
 * geometries, transforms and selection outlines stay untouched. The preview
 * owns every generated mesh, edge and line; disposal restores visibility.
 */
export function createProposalPreview(
  THREE: typeof import('three'), scene: ThreeNS.Scene, before: RoomLayout, candidate: RoomLayout,
  visibleFloorIndex = 0,
): ProposalPreview {
  const differences = proposalDifferences(before, candidate);
  const root = new THREE.Group();
  root.name = PROPOSAL_PREVIEW_TAG;
  root.userData.type = PROPOSAL_PREVIEW_TAG;
  const hidden = new Map<ThreeNS.Object3D, boolean>();
  const affected = new Set(differences.filter(change => change.before).map(change => change.id));
  let disposed = false;
  const structureChanged = !!candidate.backendSceneV2 && JSON.stringify([before.backendVenue, before.floors.map(f=>[f.interiorWalls,f.floorColor,f.floorPattern,f.items.filter(i=>i.structuralOpeningId)])]) !== JSON.stringify([candidate.backendVenue, candidate.floors.map(f=>[f.interiorWalls,f.floorColor,f.floorPattern,f.items.filter(i=>i.structuralOpeningId)])]);

  function position(group: ThreeNS.Object3D, located: LocatedItem, layout: RoomLayout): void {
    group.position.set(located.item.position?.x ?? 0, floorElevation(layout.floors, located.floorIndex), located.item.position?.z ?? 0);
    group.rotation.y = located.item.rotation ?? 0;
    if (located.item.mirrored) group.scale.x = -1;
    group.userData.proposalItemId = located.item.id;
  }

  function outline(located: LocatedItem, layout: RoomLayout, color: number, role: string): void {
    const floor = layout.floors[located.floorIndex];
    const band = mountBand(located.item.structuralOpeningId || located.item.structuralColumnId ? located.item : itemForStorey(located.item, floor));
    const box = new THREE.BoxGeometry(located.item.width + 0.02, band.top - band.bottom + 0.02, located.item.depth + 0.02);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    const material = new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.9, dashSize: 0.1, gapSize: 0.06, depthTest: false });
    const line = new THREE.LineSegments(edges, material);
    line.computeLineDistances();
    line.position.y = (band.top + band.bottom) / 2 + 0.01;
    line.renderOrder = 910;
    const group = new THREE.Group();
    group.name = role;
    group.userData.previewRole = role;
    group.add(line);
    position(group, located, layout);
    root.add(group);
  }

  try {
    if (structureChanged) {
      const shell = new THREE.Scene();
      buildStructureShell(THREE, shell, candidate);
      for (const child of [...shell.children]) {
        child.userData.previewRole = 'candidate-structure';
        if (child.userData.type === 'wall') {
          const material = (child as ThreeNS.Mesh).material as ThreeNS.MeshStandardMaterial;
          material.transparent = true; material.opacity = 0.5;
        }
        root.add(child);
      }
    }
    for (const difference of differences) {
      const old = difference.before, next = difference.after;
      if (old?.floorIndex === visibleFloorIndex) outline(old, before, difference.kind === 'removed' ? 0xea6868 : 0xe6ac50, difference.kind === 'removed' ? 'removed' : 'original-position');
      if (next?.floorIndex === visibleFloorIndex && next.item.position) {
        const model = createFurnitureModel(THREE, next.item.structuralOpeningId || next.item.structuralColumnId ? next.item : itemForStorey(next.item, candidate.floors[next.floorIndex]), false);
        model.userData.previewRole = 'candidate';
        position(model, next, candidate);
        model.traverse(node => {
          const mesh = node as ThreeNS.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const material of materials) {
              material.transparent = true;
              material.opacity = Math.min(material.opacity, 0.72);
              material.depthWrite = false;
            }
            mesh.renderOrder = 900;
          }
        });
        root.add(model);
        outline(next, candidate, difference.kind === 'added' ? 0x3bcfa5 : 0x62b5fb, difference.kind === 'added' ? 'added' : 'new-position');
      }
      if (old?.floorIndex === visibleFloorIndex && next?.floorIndex === visibleFloorIndex && old.item.position && next.item.position &&
          (old.item.position.x !== next.item.position.x || old.item.position.z !== next.item.position.z)) {
        const height = floorElevation(before.floors, old.floorIndex) + 0.06;
        const points = [new THREE.Vector3(old.item.position.x, height, old.item.position.z), new THREE.Vector3(next.item.position.x, height, next.item.position.z)];
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0x62b5fb, transparent: true, opacity: 0.9, depthTest: false, dashSize: 0.14, gapSize: 0.08 }));
        line.computeLineDistances();
        line.userData.previewRole = 'movement';
        line.userData.proposalItemId = difference.id;
        line.renderOrder = 911;
        root.add(line);
      }
    }
    root.traverse(node => { node.raycast = () => {}; });
    scene.add(root);
  } catch (error) {
    disposeObject(root);
    throw error;
  }

  function refreshOriginals(): boolean {
    if (disposed) return false;
    let changed = false;
    for (const object of scene.children) {
      const originalShell = structureChanged && ['floor','wall','interior-wall'].includes(object.userData.type as string);
      if (!originalShell && (object.userData.type !== 'furniture' || !affected.has(object.userData.id as string))) continue;
      object.traverse(node => {
        // Keep LineSegments selection outlines visible; only the original
        // render meshes hide while their translucent candidate is shown.
        if (!(node as ThreeNS.Mesh).isMesh) return;
        if (!hidden.has(node)) hidden.set(node, node.visible);
        if (node.visible) changed = true;
        node.visible = false;
      });
    }
    for (const object of hidden.keys()) {
      let ancestor: ThreeNS.Object3D = object;
      while (ancestor.parent) ancestor = ancestor.parent;
      if (ancestor !== scene) hidden.delete(object);
    }
    return changed;
  }

  refreshOriginals();
  return {
    refreshOriginals,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [object, visible] of hidden) object.visible = visible;
      hidden.clear();
      scene.remove(root);
      disposeObject(root);
    },
  };
}
