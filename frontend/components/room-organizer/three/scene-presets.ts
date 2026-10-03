import * as THREE from 'three';
import { presetModelUrl, SCENE_PRESETS, type ScenePresetKey } from '../lib/scene-presets';
import { parseStoredLayout } from '../lib/schema';
import { cloneOwnedGlb, ensureGlbAsset, getGlbAssetSource } from './glb-assets';
import type { FurnitureItem, RoomLayout } from '../lib/types';

export function layoutFromPreset(key: ScenePresetKey, source: THREE.Object3D): RoomLayout {
  const preset = SCENE_PRESETS[key];
  source.updateMatrixWorld(true);
  const fixtures = source.getObjectByName('Preset_Objects');
  if (!fixtures?.children.length || !source.getObjectByName('Preset_Structure')) throw new Error('预设缺少场馆或可编辑物件。');
  const items: FurnitureItem[] = fixtures.children.map(node => {
    const bounds = new THREE.Box3().setFromObject(node);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    return {
      id: crypto.randomUUID(), type: 'glb-asset', materialId: 'asset', source: 'local_sample',
      name: String(node.userData.displayName ?? node.name), icon: '◇', color: '#ffffff',
      width: size.x, depth: size.z, height: size.y, elevation: bounds.min.y,
      position: { x: center.x, z: center.z }, rotation: 0,
      glbUrl: presetModelUrl(key), glbNode: node.name,
    };
  });
  const layout: RoomLayout = {
    name: preset.name, scenePreset: key, width: preset.width, height: preset.depth,
    floors: [{ id: 'event-floor', name: '活动场地', height: preset.height, floorColor: '#e9e5db', items }],
    roof: { style: 'none' }, backendLighting: 'warm',
  };
  if (!parseStoredLayout(layout)) throw new Error('场景尺寸或物件格式无法完整载入，当前草稿未替换。');
  return layout;
}

export async function loadScenePreset(key: ScenePresetKey): Promise<RoomLayout> {
  const url = presetModelUrl(key);
  await ensureGlbAsset(url, url);
  const source = getGlbAssetSource(url);
  if (!source) throw new Error('场景模型尚未载入，请重试。');
  return layoutFromPreset(key, source);
}

export function createPresetStructure(key: ScenePresetKey): THREE.Object3D | null {
  const source = getGlbAssetSource(presetModelUrl(key))?.getObjectByName('Preset_Structure');
  return source ? cloneOwnedGlb(source) : null;
}
