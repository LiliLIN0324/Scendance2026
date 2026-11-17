import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearGlbAssetCache, cloneOwnedGlb, createCachedGlbModel, createGlbCatalogItem, degradeOversizedGlb, disposeOwnedModel,
  ensureGlbAsset, getGlbAssetSource, getGlbAssetState, GLB_HIDDEN_RELEASE_MS, glbCacheKeyForUrl, holdVisibleGlbAssets, inPlaceWalkClip, normalizeGlbInstance, releaseHiddenGlbAssetLater, repairGlbBufferViews, sanitizeGlbJsonPadding, validateGlbBuffer } from './glb-assets';
import { advancePeopleAnimations, personOdometer } from './people-anim';

function realGlb(): ArrayBuffer {
  return new Uint8Array(readFileSync(new URL('../../../../assets/models/table.glb', import.meta.url))).buffer;
}
function response(buffer = realGlb()): Response { return new Response(buffer, { status: 200 }); }
function template(): THREE.Group {
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ color: '#ac8855', map: texture, roughness: 0.23 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 4), material);
  mesh.position.set(5, 7, -3);
  const group = new THREE.Group(); group.add(mesh); return group;
}

afterEach(() => { clearGlbAssetCache(); vi.restoreAllMocks(); });

describe('owned GLB model instances', () => {
  it('removes the cumulative horizontal displacement from a looping walk while preserving vertical motion', () => {
    const track = new THREE.VectorKeyframeTrack('mixamorigHips.position', [0, 0.5, 1], [
      0, 0.1, 0,
      0.05, 0.2, 0.68,
      0, 0.1, 1.29,
    ]);
    const clip = new THREE.AnimationClip('Walk_Loop', 1, [track]);
    const adjusted = inPlaceWalkClip(clip);
    const values = adjusted.tracks[0]!.values;
    expect(values[8]).toBeCloseTo(0);
    expect(values[5]).toBeCloseTo(0.035);
    expect(values[4]).toBeCloseTo(0.2);
    expect(track.values[8]).toBeCloseTo(1.29);
    expect(inPlaceWalkClip(clip)).toBe(adjusted);
  });

  it('moves an imported rigged person on an editor route', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../assets/people.glb', import.meta.url))).buffer;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(bytes));
    await ensureGlbAsset('walking-rig', '/people.glb');
    const item = {
      ...createGlbCatalogItem({ name: '人物', url: '/people.glb', assetId: 'walking-rig', width: 0.55, depth: 0.45, height: 1.65 }),
      id: 'walking-person', type: 'person' as const, walkRoute: { points: [{ x: -1, z: 0 }, { x: 1, z: 0 }], loop: false },
    };
    const group = createCachedGlbModel(item)!;
    const scene = new THREE.Scene();
    scene.add(group);
    for (let i = 0; i < 60; i++) advancePeopleAnimations(1 / 60);
    expect(personOdometer(item.id)?.travelled).toBeGreaterThan(0.5);
    expect(group.position.x).toBeGreaterThan(-0.5);
    scene.remove(group);
    advancePeopleAnimations(1 / 60);
    disposeOwnedModel(group);
  });

  it('grounds, centers and sizes a model without losing its original material', () => {
    const source = template();
    const instance = normalizeGlbInstance(source, { width: 1.6, depth: 0.9, height: 0.75 });
    const bounds = new THREE.Box3().setFromObject(instance);
    const size = bounds.getSize(new THREE.Vector3());
    expect([size.x, size.y, size.z]).toEqual([1.6, 0.75, 0.9]);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
    expect(bounds.getCenter(new THREE.Vector3()).z).toBeCloseTo(0);
    const meshes: THREE.Mesh[] = []; instance.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect((meshes[0].material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ac8855');
    expect((meshes[0].material as THREE.MeshStandardMaterial).roughness).toBe(0.23);
    disposeOwnedModel(instance); disposeOwnedModel(source);
  });

  it('deleting one copy does not dispose another copy or the cached source', () => {
    const source = template();
    const first = cloneOwnedGlb(source); const second = cloneOwnedGlb(source);
    const originals = source.children[0] as THREE.Mesh;
    const other = second.children[0] as THREE.Mesh;
    const spyGeometry = vi.spyOn(originals.geometry, 'dispose');
    const spyOtherGeometry = vi.spyOn(other.geometry, 'dispose');
    const spyOtherMaterial = vi.spyOn(other.material as THREE.Material, 'dispose');
    const spyOriginalTexture = vi.spyOn((originals.material as THREE.MeshStandardMaterial).map!, 'dispose');
    const spyOtherTexture = vi.spyOn((other.material as THREE.MeshStandardMaterial).map!, 'dispose');
    disposeOwnedModel(first);
    expect(spyGeometry).not.toHaveBeenCalled(); expect(spyOtherGeometry).not.toHaveBeenCalled();
    expect(spyOtherMaterial).not.toHaveBeenCalled(); expect(spyOriginalTexture).not.toHaveBeenCalled();
    expect(spyOtherTexture).not.toHaveBeenCalled();
    expect(other.geometry.attributes.position.count).toBeGreaterThan(0);
    disposeOwnedModel(second); disposeOwnedModel(source);
  });

  it('loads a real repository GLB and reuses the same request for concurrent callers', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    await Promise.all([ensureGlbAsset('test-table', '/assets/models/table.glb'), ensureGlbAsset('test-table', '/assets/models/table.glb')]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getGlbAssetState('test-table').status).toBe('ready');
    const item = { ...createGlbCatalogItem({ name: '桌子', url: '/assets/models/table.glb', assetId: 'test-table', width: 1.6, depth: 0.9, height: 0.75 }), id: 'instance' };
    const instance = createCachedGlbModel(item);
    expect(instance).not.toBeNull();
    const size = new THREE.Box3().setFromObject(instance!).getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(1.6); expect(size.y).toBeCloseTo(0.75); expect(size.z).toBeCloseTo(0.9);
    disposeOwnedModel(instance!);
    expect(createCachedGlbModel(item)).not.toBeNull();
  });

  it('maps Aholo stable URLs to asset UUID cache keys', () => {
    const id = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
    expect(glbCacheKeyForUrl(`http://127.0.0.1:3199/asset/${id}.glb`)).toBe(id);
    expect(glbCacheKeyForUrl('/showcase/assets/library/model/table.glb')).toBe('/showcase/assets/library/model/table.glb');
  });

  it('reuses an asset-id cache entry when createCachedGlbModel only has the Aholo URL', async () => {
    const id = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
    const url = `http://127.0.0.1:3199/asset/${id}.glb`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    await ensureGlbAsset(id, url);
    const item = {
      ...createGlbCatalogItem({ name: '生成件', url, width: 1, depth: 1, height: 1 }),
      id: 'scene-item',
      glbUrl: url,
    };
    expect(createCachedGlbModel(item)).not.toBeNull();
    expect(getGlbAssetState(id).status).toBe('ready');
  });

  it('keeps a newer successful result when an obsolete request fails later', async () => {
    let rejectFirst: (reason?: unknown) => void = () => {};
    const firstFetch = new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
    vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(firstFetch).mockResolvedValueOnce(response());
    const first = ensureGlbAsset('same', 'https://example.test/old.glb').catch(e => e);
    await ensureGlbAsset('same', 'https://example.test/new.glb');
    rejectFirst(new Error('old network failure')); await first;
    expect(getGlbAssetState('same').status).toBe('ready');
  });

  it('reports invalid data as failure without manufacturing a successful model', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not a glb'));
    await expect(ensureGlbAsset('broken', '/assets/broken.glb')).rejects.toThrow();
    expect(getGlbAssetState('broken').status).toBe('error');
    expect(createCachedGlbModel({ ...createGlbCatalogItem({ name: '坏模型', url: '/assets/broken.glb', width: 1, depth: 1, height: 1 }), id: 'broken' })).toBeNull();
  });

  it.each(['http://localhost:54321/model.glb', 'http://127.0.0.1:54321/model.glb', 'http://[::1]:54321/model.glb'])('loads a local Supabase model at %s', async url => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    await ensureGlbAsset('local-supabase', url);
    expect(getGlbAssetState('local-supabase').status).toBe('ready');
  });

  it.each(['http://outside.example/model.glb', 'http://localhost.evil.test/model.glb', 'https://user:pass@example.test/model.glb', '//outside.example/model.glb', '/\\outside.example/model.glb', 'javascript:alert(1)', 'https://example.test/model.glb#secret'])('rejects an unsafe model URL before fetching: %s', async url => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(ensureGlbAsset('unsafe', url)).rejects.toThrow('模型地址无效');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects oversized GLB and external file dependencies', () => {
    expect(() => validateGlbBuffer(new ArrayBuffer(10 * 1024 * 1024 + 1))).toThrow('10 MB');
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'https://example.test/data.bin' }] }));
    const buffer = new ArrayBuffer(20 + json.length); const view = new DataView(buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
    view.setUint32(12, json.length, true); view.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(buffer, 20).set(json);
    expect(() => validateGlbBuffer(buffer)).toThrow('外部文件');
  });

  it('accepts a JSON chunk padded with NUL instead of spaces', () => {
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }));
    const jsonLen = Math.ceil(json.length / 4) * 4;
    const buffer = new ArrayBuffer(20 + jsonLen); const view = new DataView(buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, buffer.byteLength, true);
    view.setUint32(12, jsonLen, true); view.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(buffer, 20).set(json); // ArrayBuffer 零初始化，尾部即 NUL 填充
    expect(() => validateGlbBuffer(buffer)).not.toThrow();
  });

  it('rewrites NUL JSON-chunk padding to spaces before handing the buffer to the loader', () => {
    const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' } }));
    const jsonLen = Math.ceil(json.length / 4) * 4;
    const bytes = new Uint8Array(20 + jsonLen);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
    view.setUint32(12, jsonLen, true); view.setUint32(16, 0x4e4f534a, true);
    bytes.set(json, 20); // 尾部保持 0x00
    sanitizeGlbJsonPadding(bytes);
    for (let i = 20 + json.length; i < 20 + jsonLen; i += 1) expect(bytes[i]).toBe(0x20);
  });

  function buildGlb(doc: unknown, bin: Uint8Array): Uint8Array {
    const json = new TextEncoder().encode(JSON.stringify(doc));
    const jsonLen = Math.ceil(json.length / 4) * 4;
    const total = 12 + 8 + jsonLen + 8 + bin.length;
    const out = new Uint8Array(total);
    const view = new DataView(out.buffer);
    view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
    view.setUint32(12, jsonLen, true); view.setUint32(16, 0x4e4f534a, true);
    out.set(json, 20);
    view.setUint32(20 + jsonLen, bin.length, true);
    view.setUint32(20 + jsonLen + 4, 0x4e4942, true);
    out.set(bin, 20 + jsonLen + 8);
    return out;
  }

  function parseGlbJson(buffer: ArrayBuffer): { doc: { bufferViews?: Array<{ buffer?: number }> }; binStart: number; binLen: number } {
    const view = new DataView(buffer);
    const jsonLen = view.getUint32(12, true);
    const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)).trim()) as { bufferViews?: Array<{ buffer?: number }> };
    const binOff = 20 + jsonLen;
    return { doc, binStart: binOff + 8, binLen: view.getUint32(binOff, true) };
  }

  it('patches missing bufferView.buffer to 0 and keeps the BIN chunk intact', () => {
    const bin = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const doc = { asset: { version: '2.0' }, buffers: [{ byteLength: 8 }], bufferViews: [{ byteLength: 4 }, { byteOffset: 4, byteLength: 4 }] };
    const repaired = repairGlbBufferViews(buildGlb(doc, bin));
    const { doc: outDoc, binStart, binLen } = parseGlbJson(repaired);
    expect(outDoc.bufferViews!.every(bv => bv.buffer === 0)).toBe(true);
    expect(binLen).toBe(bin.length);
    expect([...new Uint8Array(repaired, binStart, binLen)]).toEqual([...bin]);
    expect(new DataView(repaired).getUint32(8, true)).toBe(repaired.byteLength);
  });

  it('returns the original buffer when every bufferView already has a buffer index', () => {
    const bin = new Uint8Array([9, 9]);
    const doc = { asset: { version: '2.0' }, buffers: [{ byteLength: 2 }], bufferViews: [{ buffer: 0, byteLength: 2 }] };
    const input = buildGlb(doc, bin);
    expect(repairGlbBufferViews(input)).toBe(input.buffer);
  });
});

describe('generated model load budget', () => {
  it('downloads one GLB when a library key and the Aholo URL share a UUID', async () => {
    const id = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
    const url = `http://127.0.0.1:3199/asset/${id}.glb`;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    await Promise.all([
      ensureGlbAsset(`outdoor-library:${id}`, url),
      ensureGlbAsset(id, url),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getGlbAssetState(`outdoor-library:${id}`).status).toBe('ready');
    expect(getGlbAssetState(id).status).toBe('ready');
    expect(getGlbAssetSource(`outdoor-library:${id}`)).toBe(getGlbAssetSource(id));
  });

  it('keeps at most two GLB downloads in flight', async () => {
    let started = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      started += 1;
      if (started <= 2) await gate;
      return response();
    });
    const pending = Promise.all([
      ensureGlbAsset('slot-a', '/assets/models/a.glb'),
      ensureGlbAsset('slot-b', '/assets/models/b.glb'),
      ensureGlbAsset('slot-c', '/assets/models/c.glb'),
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(started).toBe(2);
    release();
    await pending;
    expect(started).toBe(3);
    expect(getGlbAssetState('slot-c').status).toBe('ready');
  });

  it('shrinks an oversized data texture and turns shadows off for a heavy mesh', () => {
    const width = 3000;
    const height = 4;
    const data = new Uint8Array(width * height * 4);
    data[0] = 12;
    const texture = new THREE.DataTexture(data, width, height);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(80_001 * 3), 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture }));
    const group = new THREE.Group();
    group.add(mesh);
    degradeOversizedGlb(group);
    const image = texture.image as { width: number; height: number; data: Uint8Array };
    expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(2048);
    expect(image.data[0]).toBe(12);
    const copy = cloneOwnedGlb(group);
    const copied = copy.children[0] as THREE.Mesh;
    expect(copied.castShadow).toBe(false);
    expect(copied.receiveShadow).toBe(false);
    disposeOwnedModel(copy);
    disposeOwnedModel(group);
  });

  it('drops an unheld template after the release delay and keeps a held one', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response());
    await ensureGlbAsset('held-model', '/assets/models/table.glb');
    await ensureGlbAsset('loose-model', '/assets/models/chair.glb');
    vi.useFakeTimers();
    try {
      const stop = holdVisibleGlbAssets(['held-model']);
      releaseHiddenGlbAssetLater('held-model');
      releaseHiddenGlbAssetLater('loose-model');
      await vi.advanceTimersByTimeAsync(GLB_HIDDEN_RELEASE_MS);
      expect(getGlbAssetState('held-model').status).toBe('ready');
      expect(getGlbAssetState('loose-model').status).toBe('idle');
      stop();
      await vi.advanceTimersByTimeAsync(GLB_HIDDEN_RELEASE_MS);
      expect(getGlbAssetState('held-model').status).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });
});
