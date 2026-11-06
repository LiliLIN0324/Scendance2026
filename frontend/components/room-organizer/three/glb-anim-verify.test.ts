import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { advanceGlbAnimations, clearGlbAssetCache, createCachedGlbModel, createGlbCatalogItem, disposeOwnedModel,
  ensureGlbAsset, getGlbAssetState, hasGlbAnimations, normalizeGlbInstance } from './glb-assets';

const RIGGED = 'C:/Users/13266/.dsh/bot/workspace/Scendance2026/docs/evidence/aholo/sculpture-rig-local/sculpture-local-rig.glb';
const TABLE = new URL('../../../../assets/models/table.glb', import.meta.url);

const out: Record<string, unknown> = {};

function glbResponse(path: string | URL): Response {
  return new Response(new Uint8Array(readFileSync(path)).buffer);
}

/**
 * Node 里没有 `self`/`Image`，GLTFLoader 走到内嵌贴图就会 `ReferenceError: self is not defined`。
 * 这里只在解析前把 images/textures 摘掉，几何、蒙皮权重、骨骼与 clip 的字节原样保留。
 */
function texturelessGlb(path: string): ArrayBuffer {
  const bytes = new Uint8Array(readFileSync(path));
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const jsonLength = view.getUint32(12, true);
  type Doc = {
    images?: unknown; textures?: unknown; samplers?: unknown;
    materials?: { normalTexture?: unknown; occlusionTexture?: unknown; emissiveTexture?: unknown; pbrMetallicRoughness?: Record<string, unknown> }[];
  };
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Doc;
  delete doc.images; delete doc.textures; delete doc.samplers;
  for (const material of doc.materials ?? []) {
    delete material.normalTexture; delete material.occlusionTexture; delete material.emissiveTexture;
    const pbr = material.pbrMetallicRoughness;
    if (pbr) { delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture; }
  }
  let json = new TextEncoder().encode(JSON.stringify(doc));
  if (json.length % 4) { const padded = new Uint8Array(json.length + (4 - (json.length % 4))); padded.fill(0x20); padded.set(json); json = padded; }
  const bin = bytes.subarray(20 + jsonLength); // BIN chunk 头 + 数据，整段照抄
  const total = 12 + 8 + json.length + bin.length;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true); outView.setUint32(4, 2, true); outView.setUint32(8, total, true);
  outView.setUint32(12, json.length, true); outView.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20); out.set(bin, 20 + json.length);
  return out.buffer as ArrayBuffer;
}

function skinnedOf(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse(o => { const m = o as THREE.SkinnedMesh; if (m.isSkinnedMesh) found = m; });
  return found;
}

function worldPositions(mesh: THREE.SkinnedMesh, root: THREE.Object3D): THREE.Vector3[] {
  root.updateMatrixWorld(true);
  mesh.skeleton.update();
  const positions = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const list: THREE.Vector3[] = [];
  for (let i = 0; i < positions.count; i += 1) {
    // applyBoneTransform 以传入的向量为「静止顶点」，必须先填原始坐标，否则算的是原点的蒙皮结果。
    v.fromBufferAttribute(positions, i);
    mesh.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    list.push(v.clone());
  }
  return list;
}

afterEach(() => { clearGlbAssetCache(); vi.restoreAllMocks(); });

describe('rigged sculpture animation wiring', () => {
  it('plays the baked clip, grounds the model and keeps the scale uniform', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(texturelessGlb(RIGGED)));
    await ensureGlbAsset('rigged', 'http://localhost:54321/rigged.glb');
    const state = getGlbAssetState('rigged');
    const dims = state.dimensions!;
    out.asset = { width: dims.width, depth: dims.depth, height: dims.height };

    const item = { ...createGlbCatalogItem({
      name: '雕塑', url: 'http://localhost:54321/rigged.glb', assetId: 'rigged',
      width: dims.width, depth: dims.depth, height: dims.height,
    }), id: 'sculpture' };
    const model = createCachedGlbModel(item)!;
    expect(model).not.toBeNull();

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    out.instance = {
      minY: box.min.y, centerX: box.getCenter(new THREE.Vector3()).x,
      width: size.x, height: size.y, depth: size.z,
      scale: [model.scale.x, model.scale.y, model.scale.z],
    };
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(size.y).toBeCloseTo(1.8, 4);
    expect(model.scale.x).toBeCloseTo(model.scale.y, 9);
    expect(model.scale.y).toBeCloseTo(model.scale.z, 9);

    const mixer = model.userData.glbMixer as THREE.AnimationMixer;
    expect(mixer).toBeInstanceOf(THREE.AnimationMixer);
    const clip = model.userData.glbClip as string;
    const actions = (mixer as unknown as { _actions: THREE.AnimationAction[] })._actions;
    out.mixer = { clip, duration: actions[0]?.getClip().duration ?? 0, time0: mixer.time };
    expect(hasGlbAnimations()).toBe(true);

    const mesh = skinnedOf(model)!;
    const rest = worldPositions(mesh, model);
    const t0 = mixer.time;

    const steps: Record<string, unknown>[] = [];
    for (let step = 0; step < 3; step += 1) {
      advanceGlbAnimations(0.5);
      const now = worldPositions(mesh, model);
      let max = 0; let moved = 0;
      for (let i = 0; i < now.length; i += 1) {
        const d = now[i].distanceTo(rest[i]);
        if (d > max) max = d;
        if (d > 0.01) moved += 1;
      }
      steps.push({ mixerTime: mixer.time, maxDelta: max, movedOver1cm: moved });
    }
    out.frames = { t0, steps };
    // 1.0 s 时（=第 25 帧 @24fps）必须有明显位移
    expect(steps[1].maxDelta as number).toBeGreaterThan(0.10);
    expect(steps[1].movedOver1cm as number).toBeGreaterThan(5000);

    out.mixerAfter = { time: mixer.time, playing: mixer.time > 0 };
    disposeOwnedModel(model);
    expect(hasGlbAnimations()).toBe(false);
  });

  it('leaves a clip-less procedural asset on the old per-axis scaling path', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(glbResponse(TABLE));
    await ensureGlbAsset('table', 'http://localhost:54321/table.glb');
    const dims = getGlbAssetState('table').dimensions!;
    const item = { ...createGlbCatalogItem({
      name: '桌子', url: 'http://localhost:54321/table.glb', assetId: 'table',
      width: 1.6, depth: 0.9, height: 0.75,
    }), id: 'table' };
    const model = createCachedGlbModel(item)!;
    expect(model.userData.glbMixer).toBeUndefined();
    expect(hasGlbAnimations()).toBe(false);
    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    out.table = { source: dims, scaled: [size.x, size.y, size.z], scale: [model.scale.x, model.scale.y, model.scale.z] };
    expect(size.x).toBeCloseTo(1.6); expect(size.y).toBeCloseTo(0.75); expect(size.z).toBeCloseTo(0.9);
    disposeOwnedModel(model);
  });

  it('keeps the legacy three-axis scale when uniformScale is left off', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4));
    const group = new THREE.Group(); group.add(mesh);
    const legacy = normalizeGlbInstance(group, { width: 1.6, depth: 0.9, height: 0.75 });
    const uniform = normalizeGlbInstance(group, { width: 1.6, depth: 0.9, height: 0.75 }, true);
    out.scaleCompare = { legacy: [legacy.scale.x, legacy.scale.y, legacy.scale.z], uniform: [uniform.scale.x, uniform.scale.y, uniform.scale.z] };
    expect(legacy.scale.x).not.toBeCloseTo(legacy.scale.y, 3);
    expect(uniform.scale.x).toBeCloseTo(uniform.scale.z, 9);
    disposeOwnedModel(legacy); disposeOwnedModel(group);
  });

  it('writes the measured numbers to evidence', () => {
    writeFileSync('C:/Users/13266/.dsh/bot/workspace/Scendance2026/docs/evidence/aholo/sculpture-rig-local/anim-verify.json',
      JSON.stringify(out, null, 2));
    console.log('MEASURED', JSON.stringify(out, null, 2));
  });
});
