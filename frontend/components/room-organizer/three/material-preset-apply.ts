/**
 * 把材质预设落到已加载的 GLB 实例上（2026-11-17）。
 *
 * 只动 MeshStandardMaterial 的 color / roughness / metalness / opacity：
 * - color 与贴图相乘，所以木纹、拉丝纹理都还在，只是换色调；
 * - 每个 mesh 复制一份材质，改的是实例，不污染 GLB 缓存与其它设施；
 * - 蒙皮网格（人物）跳过，避免把人物的关节材质一起改掉。
 */

import * as THREE from 'three';
import { materialPreset } from '../lib/material-presets';

export function applyMaterialPreset(root: THREE.Object3D, presetId: string | undefined | null): number {
  const spec = materialPreset(presetId);
  if (!spec || spec.id === 'original') return 0;
  let changed = 0;
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return;
    const source = mesh.material;
    const list = Array.isArray(source) ? source : [source];
    const next = list.map(material => {
      if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material;
      const clone = (material as THREE.MeshStandardMaterial).clone();
      clone.color.set(spec.tint);
      clone.roughness = spec.roughness;
      clone.metalness = spec.metalness;
      if (spec.opacity !== undefined) {
        clone.transparent = true;
        clone.opacity = spec.opacity;
        clone.depthWrite = false;
      }
      changed += 1;
      return clone;
    });
    mesh.material = Array.isArray(source) ? next : next[0]!;
  });
  return changed;
}
