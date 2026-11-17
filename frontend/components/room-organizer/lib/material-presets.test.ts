import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MATERIAL_PRESETS,
  isMaterialPresetId,
  materialPreset,
  materialPresetLabel,
  normalizeMaterialPreset,
} from './material-presets';
import { applyMaterialPreset } from '../three/material-preset-apply';

describe('材质预设表', () => {
  it('id 唯一、色值合法、roughness/metalness 在 0–1', () => {
    const ids = MATERIAL_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of MATERIAL_PRESETS) {
      expect(preset.tint).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.roughness).toBeGreaterThanOrEqual(0);
      expect(preset.roughness).toBeLessThanOrEqual(1);
      expect(preset.metalness).toBeGreaterThanOrEqual(0);
      expect(preset.metalness).toBeLessThanOrEqual(1);
    }
  });

  it('脏值归一为原样，不把未知 id 带进 3D', () => {
    expect(normalizeMaterialPreset('wood-9000')).toBe('original');
    expect(normalizeMaterialPreset(undefined)).toBe('original');
    expect(isMaterialPresetId('steel')).toBe(true);
    expect(isMaterialPresetId('wood-9000')).toBe(false);
    expect(materialPresetLabel('glass')).toBe('玻璃');
    expect(materialPreset('nope')).toBeNull();
  });
});

function meshWith(material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  return mesh;
}

describe('材质应用', () => {
  it('换色/粗糙度/金属度，且不动原材质（实例独立）', () => {
    const source = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
    const root = new THREE.Group();
    root.add(meshWith(source));
    const changed = applyMaterialPreset(root, 'steel');
    expect(changed).toBe(1);
    const applied = (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(applied).not.toBe(source);
    expect(applied.metalness).toBeCloseTo(0.95);
    expect(applied.roughness).toBeCloseTo(0.3);
    expect(applied.color.getHexString()).toBe('c8cdd4');
    // 原材质保持不变：GLB 缓存里的其它实例不受影响。
    expect(source.metalness).toBe(0);
  });

  it('玻璃转半透明，其它预设保持不透明', () => {
    const root = new THREE.Group();
    root.add(meshWith(new THREE.MeshStandardMaterial()));
    applyMaterialPreset(root, 'glass');
    const glass = (root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeCloseTo(0.45);

    const solid = new THREE.Group();
    solid.add(meshWith(new THREE.MeshStandardMaterial({ transparent: false })));
    applyMaterialPreset(solid, 'oak');
    expect((solid.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).toMatchObject({ transparent: false });
  });

  it('原样与未知预设不改任何东西；蒙皮网格跳过', () => {
    const root = new THREE.Group();
    const mesh = meshWith(new THREE.MeshStandardMaterial());
    root.add(mesh);
    expect(applyMaterialPreset(root, 'original')).toBe(0);
    expect(applyMaterialPreset(root, undefined)).toBe(0);

    const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    const rig = new THREE.Group();
    rig.add(skinned);
    expect(applyMaterialPreset(rig, 'metal')).toBe(0);
  });
});
