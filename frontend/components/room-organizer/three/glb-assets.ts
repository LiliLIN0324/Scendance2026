import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { cloudPeopleUrl } from '../lib/cloud-assets';
import { GLB_MAX_CLOUD_FILE_BYTES, GLB_MAX_FILE_BYTES, LOCAL_WALK_ASSET_IDS, LOCAL_WALK_MAX_FILE_BYTES } from '../lib/glb-limits';
import { normalizeGlbRoot } from '../lib/glb-normalize';
import { isGlbUrl } from '../lib/glb-url';
import { createGlbLoader } from './glb-loader';
import { personIsAnimated, registerPersonAnim } from './people-anim';
import type { CatalogItem, FurnitureItem } from '../lib/types';

// 蒙皮人物 GLB 两档 LOD 压缩后 1.1–3.6 MB（2026-11-16 上线），45s 已是实测耗时的十余倍；
// 余量留给弱网首帧与 GLTFLoader 解析，物件小模型不受影响。
const TIMEOUT_MS = 45_000;

// 压缩资产（EXT_meshopt_compression）必须挂解码器，否则 GLTFLoader 直接抛错。
// 工厂统一放在 ./glb-loader：资产缓存、打包内人物、交付场景共用同一份，避免有一处漏挂。
export type GlbAssetState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  stack?: string | undefined;
  dimensions?: Readonly<{ width: number; depth: number; height: number }>;
}>;
type CachedAsset = {
  url: string;
  state: GlbAssetState;
  source?: THREE.Object3D;
  /** 模板里带的动画片段；只有真带 clip 的资产才会填。 */
  animations?: readonly THREE.AnimationClip[] | undefined;
  promise: Promise<void>;
  controller: AbortController;
};
const cache = new Map<string, CachedAsset>();

/**
 * 正在播放的实例动画。只有 `createCachedGlbModel` 建出的、带 clip 的实例才会进这张表，
 * 程序化家具永远不进来，所以渲染循环的「每帧跑」开关只对有动画的场景生效。
 */
const mixers = new Set<THREE.AnimationMixer>();

/** 场景里是否有实例正在播动画；渲染循环据此决定要不要每帧续跑。 */
export function hasGlbAnimations(): boolean { return mixers.size > 0; }

/** 推进所有实例动画；返回本次实际推进的 mixer 数（0 表示这一帧可以早退）。 */
export function advanceGlbAnimations(deltaSeconds: number): number {
  if (!mixers.size || !(deltaSeconds > 0)) return 0;
  for (const mixer of mixers) mixer.update(deltaSeconds);
  return mixers.size;
}

/** 物件被移除时必须调用，否则已脱离场景的 mixer 会一直往无主骨骼上写。 */
export function disposeGlbMixersIn(root: THREE.Object3D): void {
  root.traverse(node => {
    const holder = node.userData as { glbMixer?: THREE.AnimationMixer | undefined };
    const mixer = holder.glbMixer;
    if (!mixer) return;
    // 先停动作再摘引用：只删表里的项，clip 与骨骼的绑定缓存会继续握着已脱离场景的节点。
    mixer.stopAllAction();
    mixer.uncacheRoot(mixer.getRoot());
    mixers.delete(mixer);
    holder.glbMixer = undefined;
  });
}
const listeners = new Set<() => void>();
const IDLE: GlbAssetState = Object.freeze({ status: 'idle' });
let revision = 0;
function changed(): void { revision += 1; listeners.forEach(fn => fn()); }
export function subscribeGlbAssets(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getGlbAssetRevision(): number { return revision; }
export function getGlbAssetState(key: string): GlbAssetState { return cache.get(key)?.state ?? IDLE; }

export interface GlbCacheProbe {
  key: string;
  url: string;
  status: GlbAssetState['status'];
  error?: string | undefined;
  stack?: string | undefined;
  anims: string[];
  hasSource: boolean;
}

/** 走查/E2E 探针：读缓存里每个条目的状态、错误与动画片段名（生产 UI 不消费）。 */
export function glbCacheProbe(): GlbCacheProbe[] {
  return [...cache.entries()].map(([key, entry]) => ({
    key,
    url: entry.url,
    status: entry.state.status,
    error: entry.state.error,
    stack: entry.state.stack,
    anims: (entry.animations ?? []).map(clip => clip.name),
    hasSource: !!entry.source,
  }));
}

// 浏览器走查探针（仅 dev 构建挂 window；生产构建不暴露任何全局）。
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __glbAssetCache?: typeof glbCacheProbe }).__glbAssetCache = glbCacheProbe;
}
/** Read-only source owned by the cache; callers must clone before mutation. */
export function getGlbAssetSource(key: string): THREE.Object3D | undefined { return cache.get(key)?.source; }
export function glbAssetKey(item: Pick<FurnitureItem, 'assetId' | 'glbUrl'>): string | undefined { return item.assetId ?? item.glbUrl; }

/**
 * 部分批次产物用 NUL(0x00) 而非规范空格对齐 JSON chunk；预检与 GLTFLoader 都会
 * 对整段 JSON 做 parse，NUL 会被判成非空白字符。合法 JSON 文本内部不含裸 NUL，
 * 这里把 JSON chunk 段里的 NUL 刷成空格，原地修补后再喂给校验与加载器。
 */
export function sanitizeGlbJsonPadding(bytes: Uint8Array): void {
  if (bytes.length < 20) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  if (view.getUint32(16, true) !== 0x4e4f534a) return;
  const jsonLen = view.getUint32(12, true);
  const end = Math.min(20 + jsonLen, bytes.length);
  for (let i = 20; i < end; i += 1) if (bytes[i] === 0) bytes[i] = 0x20;
}

/**
 * 部分合并产物漏写了 bufferView 的 `buffer` 字段（glTF 规范缺省为 0）。three 的
 * GLTFLoader 没有对缺省值兜底，`buffers[undefined]` 取 `.type` 直接崩溃。这里在加载前
 * 解析 GLB 的 JSON chunk，给缺省的 bufferView 补 `buffer: 0`，再重建合规的 GLB 容器；
 * BIN chunk 数据原样保留。结构不符的输入原样返回，交由后续校验报错。
 */
export function repairGlbBufferViews(bytes: Uint8Array): ArrayBuffer {
  const original = bytes.buffer as ArrayBuffer;
  if (bytes.length < 20) return original;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) return original;
  const jsonLen = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > bytes.length) return original;
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)).replace(/[\0\s]+$/, '');
  let document: { bufferViews?: Array<{ buffer?: number | undefined }> };
  try {
    document = JSON.parse(jsonText) as typeof document;
  } catch {
    return original;
  }
  let patched = false;
  for (const bv of document.bufferViews ?? []) {
    if (bv.buffer === undefined) { bv.buffer = 0; patched = true; }
  }
  if (!patched) return original;

  const binOff = 20 + jsonLen;
  const binLen = view.getUint32(binOff, true);
  if (view.getUint32(binOff + 4, true) !== 0x4e4942 || binOff + 8 + binLen > bytes.length) return original;
  const binData = bytes.subarray(binOff + 8, binOff + 8 + binLen);

  const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const newJsonLen = jsonBytes.length + jsonPad;
  const total = 12 + 8 + newJsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, total, true);
  outView.setUint32(12, newJsonLen, true);
  outView.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + newJsonLen);
  outView.setUint32(20 + newJsonLen, binLen, true);
  outView.setUint32(20 + newJsonLen + 4, 0x4e4942, true);
  out.set(binData, 20 + newJsonLen + 8);
  return out.buffer;
}

/** Reject external URI dependencies: an archived standalone GLB must reopen by itself. */
export function validateGlbBuffer(buffer: ArrayBuffer, maxBytes = GLB_MAX_FILE_BYTES): void {
  if (buffer.byteLength > maxBytes) throw new Error(`GLB 超过 ${maxBytes / (1024 * 1024)} MB，未载入。`);
  if (buffer.byteLength < 20) throw new Error('GLB 文件不完整。');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('文件不是有效的 GLB 2.0。');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength > buffer.byteLength - 20) throw new Error('GLB 缺少有效模型数据。');
  // glTF 规范要求 JSON chunk 用空格对齐，部分批次产物用 NUL(0x00) 做填充；parse 前剥掉尾部 NUL/空白。
  const jsonText = new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)).replace(/[\0\s]+$/, '');
  const document = JSON.parse(jsonText) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  for (const dependency of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (dependency.uri && !dependency.uri.startsWith('data:')) throw new Error('GLB 引用了外部文件，请先归档为独立模型。');
  }
}

/**
 * 下载档位：试走角色走单独上限，其余（云端模型库里的物件、生成服务商的产物）走 32 MB。
 *
 * 2026-11-17 生产实跑踩到的：Lux3D G1 的 textured.glb 实测 10.06 MiB，比 10 MB 多 59 KB，
 * 服务端已经把它存进资产库，前端却按 10 MB 拒收，用户只看到「GLB 超过 10 MB，未载入」——
 * 额度花了、模型生成了，用户却拿不到。所以下载这一档放宽；本机导入仍守 10 MB。
 */
export function glbDownloadLimit(url: string): number {
  const localTrial = process.env.NODE_ENV === 'development'
    && LOCAL_WALK_ASSET_IDS.some(assetId => url === `http://127.0.0.1:3199/asset/${assetId}.glb`);
  const cloudTrial = LOCAL_WALK_ASSET_IDS.some(assetId => url === cloudPeopleUrl(assetId));
  return localTrial || cloudTrial ? LOCAL_WALK_MAX_FILE_BYTES : GLB_MAX_CLOUD_FILE_BYTES;
}

async function downloadGlb(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!isGlbUrl(url)) throw new Error('模型地址无效。');
  const maxBytes = glbDownloadLimit(url);
  const tooLarge = () => new Error(`GLB 超过 ${maxBytes / (1024 * 1024)} MB，未载入。`);

  const readOnce = async (): Promise<Uint8Array> => {
    const response = await fetch(url, { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}）。`);
    if (Number(response.headers.get('content-length')) > maxBytes) throw tooLarge();
    if (!response.body) return new Uint8Array(await response.arrayBuffer());
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        count += result.value.byteLength;
        if (count > maxBytes) { await reader.cancel(); throw tooLarge(); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  };

  // 大对象偶发流式截断（network error / CONTENT_LENGTH_MISMATCH）只在网络层重试一次；
  // HTTP 错误、超尺寸与主动取消不重试。
  let bytes: Uint8Array;
  try {
    bytes = await readOnce();
  } catch (error) {
    if (signal.aborted || !(error instanceof TypeError)) throw error;
    bytes = await readOnce();
  }
  sanitizeGlbJsonPadding(bytes);
  const repaired = repairGlbBufferViews(bytes);
  validateGlbBuffer(repaired, maxBytes);
  return repaired;
}

/** A GLB with only empty nodes renders as nothing; reject before measuring. */
function assertRenderableGlb(source: THREE.Object3D): void {
  let meshCount = 0;
  source.traverse(node => { if ((node as THREE.Mesh).isMesh) meshCount += 1; });
  if (!meshCount) throw new Error('模型不含可显示网格。');
}

/** Cache is keyed by stable asset ID (or a local sample URL). A new URL supersedes a pending request. */
export function ensureGlbAsset(key: string, url: string): Promise<void> {
  if (!key) return Promise.reject(new Error('缺少模型标识。'));
  const prior = cache.get(key);
  if (prior?.state.status === 'ready') return Promise.resolve();
  if (prior?.state.status === 'loading' && prior.url === url) return prior.promise;
  prior?.controller.abort();
  const controller = new AbortController();
  const entry: CachedAsset = { url, state: { status: 'loading' }, controller, promise: Promise.resolve() };
  cache.set(key, entry);
  entry.promise = (async () => {
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let source: THREE.Object3D | undefined;
    try {
      const buffer = await downloadGlb(url, controller.signal);
      const gltf = await createGlbLoader().parseAsync(buffer, '');
      source = gltf.scene;
      assertRenderableGlb(source);
      // 米制 / Y-up / 底面中心：加载时统一一次，实例只按目录尺寸缩放。
      // 2026-11-12 用户报告「桌椅组合在 3D 里翻倒 90°」：URL 加载的资产一律按 glTF
      // 规范 Y-up，不再用包围盒猜轴向——「沿 Z 躺平的长桌/护栏/车」会被误判成
      // Z-up 而整个立起来，且这里无人复核；猜轴向只保留在 importLocalGlb
      // （导入时有人工预览与登记的 upAxis 元数据兜底）。
      const normalized = normalizeGlbRoot(source, { upAxis: 'y' });
      if (cache.get(key) !== entry || controller.signal.aborted) throw new Error('模型加载请求已过期，请重试。');
      entry.source = normalized.root;
      entry.animations = gltf.animations?.length ? gltf.animations : undefined;
      entry.state = { status: 'ready', dimensions: normalized.size };
      source = undefined; // The cache now owns the template.
      changed();
    } catch (error) {
      if (source) disposeOwnedModel(source);
      const message = controller.signal.aborted ? '模型加载超时或请求已取消，请重试。' : error instanceof Error ? error.message : '模型加载失败，请重试。';
      const stack = error instanceof Error ? error.stack : undefined;
      if (cache.get(key) === entry) { entry.state = { status: 'error', error: message, ...(stack ? { stack } : {}) }; changed(); }
      if (process.env.NODE_ENV !== 'production') console.error('[glb-load]', error);
      throw new Error(message);
    } finally { clearTimeout(timer); }
  })();
  changed();
  return entry.promise;
}

/** Every rendered instance owns its GPU resources; upstream disposeObject is therefore safe. */
export function cloneOwnedGlb(source: THREE.Object3D): THREE.Object3D {
  const object = cloneSkeleton(source);
  const geometryCopies = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  const materialCopies = new Map<THREE.Material, THREE.Material>();
  const textureCopies = new Map<THREE.Texture, THREE.Texture>();
  function materialCopy(original: THREE.Material): THREE.Material {
    let result = materialCopies.get(original);
    if (result) return result;
    result = original.clone();
    for (const [field, value] of Object.entries(original)) {
      if (value instanceof THREE.Texture) {
        let copy = textureCopies.get(value);
        if (!copy) { copy = value.clone(); copy.needsUpdate = true; textureCopies.set(value, copy); }
        (result as unknown as Record<string, unknown>)[field] = copy;
      }
    }
    materialCopies.set(original, result);
    return result;
  }
  object.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    let geometry = geometryCopies.get(mesh.geometry);
    if (!geometry) { geometry = mesh.geometry.clone(); geometryCopies.set(mesh.geometry, geometry); }
    mesh.geometry = geometry;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(materialCopy) : materialCopy(mesh.material);
    mesh.castShadow = true; mesh.receiveShadow = true;
  });
  return object;
}

export function normalizeGlbInstance(
  source: THREE.Object3D,
  dimensions: { width: number; depth: number; height: number },
  uniformScale = false,
): THREE.Group {
  if (![dimensions.width, dimensions.depth, dimensions.height].every(n => Number.isFinite(n) && n > 0)) throw new Error('模型尺寸必须为正数。');
  const object = cloneOwnedGlb(source);
  const bounds = new THREE.Box3().setFromObject(object);
  const size = bounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(n => Number.isFinite(n) && n > 0.000001)) { disposeOwnedModel(object); throw new Error('模型包围盒无效。'); }
  const center = bounds.getCenter(new THREE.Vector3());
  const origin = new THREE.Group();
  origin.position.set(-center.x, -bounds.min.y, -center.z);
  origin.add(object);
  const result = new THREE.Group();
  result.add(origin);
  if (uniformScale) {
    // 骨骼蒙皮不能吃三轴独立缩放：肩宽与身高被拉成不同倍率会把骨架扯歪。
    // 以标称高度为准算一个统一倍率，深度/宽度随原比例走。
    result.scale.setScalar(dimensions.height / size.y);
  } else {
    result.scale.set(dimensions.width / size.x, dimensions.height / size.y, dimensions.depth / size.z);
  }
  return result;
}

export function createCachedGlbModel(item: FurnitureItem, autoplay = true): THREE.Group | null {
  const key = glbAssetKey(item);
  const entry = key ? cache.get(key) : undefined;
  const asset = entry?.source;
  const source = item.glbNode ? asset?.getObjectByName(item.glbNode) : asset;
  if (!source) return null;
  const clips = entry?.animations;
  let rigged = false;
  source.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) rigged = true; });
  /*
   * 只有真绑骨（SkinnedMesh）的实例才自动等比缩放并自动播 clip。
   * 实测 table.glb 也带 open/close 两个片段但 skins=0，它是刚性开合、一直是按轴拉伸摆放的；
   * 若「有 clip 就等比 + 播放」，既有桌椅模板的占地面积会被改掉，抽屉还会自己动。
   */
  const uniformScale = item.uniformScale === true || rigged;
  const group = normalizeGlbInstance(source, item, uniformScale);
  if (item.elevation) {
    // Keep the outer group on the floor for the existing drag handlers.
    // This wrapper's world offset must not scale when the fixture is resized.
    const content = new THREE.Group();
    content.add(...group.children);
    content.scale.copy(group.scale);
    content.position.y = item.elevation;
    group.scale.set(1, 1, 1);
    group.add(content);
  }
  // The default white multiplier preserves every original material/texture.
  // An explicit user colour tints independent instance materials only.
  if (item.color.toLowerCase() !== '#ffffff') {
    const tint = new THREE.Color(item.color);
    const tinted = new Set<THREE.Material>();
    group.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (tinted.has(material)) continue;
        const colored = material as THREE.MeshStandardMaterial;
        if (colored.color) colored.color.multiply(tint);
        tinted.add(material);
      }
    });
  }
  group.userData.glbStatus = 'ready';
  // 只有绑骨实例才挂 mixer；挂上后由渲染循环的 advanceGlbAnimations 每帧推进。
  if (autoplay && rigged && clips?.length) {
    const mixer = new THREE.AnimationMixer(group);
    // 正式步态优先（Walk_Formal_Loop，走路胳膊不外撇）；重定向没出这条前回退 Walk_Loop。
    const walk = clips.find(clip => clip.name === 'Walk_Formal_Loop') ?? clips.find(clip => clip.name === 'Walk_Loop');
    if (item.type === 'person' && walk && personIsAnimated(item.walkRoute, item.personAction, item.personPaused)) {
      registerPersonAnim(group, {
        id: item.id,
        mixer,
        rig: null,
        clips: {
          walk,
          idle: clips.find(clip => clip.name === 'Idle_Loop') ?? null,
          talk: clips.find(clip => clip.name === 'Idle_Talking_Loop') ?? null,
          sit: clips.find(clip => clip.name === 'Sit_Idle_Loop') ?? null,
        },
        action: item.personAction ?? 'idle',
        paused: item.personPaused === true,
        route: item.walkRoute ?? null,
      });
      return group;
    }
    mixer.clipAction(clips[0]).play();
    mixer.timeScale = 1;
    group.userData.glbMixer = mixer;
    group.userData.glbClip = clips[0].name;
    mixers.add(mixer);
  }
  return group;
}

const inPlaceWalkClips = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>();

/** 角色由路线或玩家推进；移除行走循环里髋部的水平累计位移，保留步态和上下起伏。 */
export function inPlaceWalkClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cached = inPlaceWalkClips.get(clip);
  if (cached) return cached;
  const tracks = clip.tracks.map(track => {
    if (!/(hips?|pelvis|root|armature)\.position$/i.test(track.name) || track.getValueSize() !== 3 || track.times.length < 2) {
      return track;
    }
    const last = track.times.length - 1;
    const start = track.times[0]!;
    const duration = track.times[last]! - start;
    if (duration <= 0) return track;
    const xDrift = track.values[last * 3]! - track.values[0]!;
    const zDrift = track.values[last * 3 + 2]! - track.values[2]!;
    if (Math.hypot(xDrift, zDrift) < 0.001) return track;
    const adjusted = track.clone();
    for (let index = 1; index <= last; index += 1) {
      const progress = (track.times[index]! - start) / duration;
      adjusted.values[index * 3] = track.values[index * 3]! - xDrift * progress;
      adjusted.values[index * 3 + 2] = track.values[index * 3 + 2]! - zDrift * progress;
    }
    return adjusted;
  });
  const result = tracks.some((track, index) => track !== clip.tracks[index])
    ? new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode)
    : clip;
  inPlaceWalkClips.set(clip, result);
  return result;
}

export function createWalkAvatar(item: FurnitureItem) {
  const key = glbAssetKey(item);
  const clips = key ? cache.get(key)?.animations : undefined;
  const idle = clips?.find(clip => clip.name === 'Idle_Loop');
  const walk = clips?.find(clip => clip.name === 'Walk_Formal_Loop') ?? clips?.find(clip => clip.name === 'Walk_Loop');
  const sit = clips?.find(clip => clip.name === 'Sit_Idle_Loop') ?? null;
  if (!idle || !walk) return null;
  const group = createCachedGlbModel(item, false);
  if (!group) return null;
  const mixer = new THREE.AnimationMixer(group);
  return {
    group,
    mixer,
    idle: mixer.clipAction(idle),
    // 上游 eb6920b7 前后的根位移修正：走路 clip 先去前进位移，位置只由路线/WASD 决定。
    walk: mixer.clipAction(inPlaceWalkClip(walk)),
    sit: sit ? mixer.clipAction(sit) : null,
  };
}

export interface GlbCatalogInput {
  name: string; url: string; width: number; depth: number; height: number;
  assetId?: string; materialId?: FurnitureItem['materialId']; source?: FurnitureItem['source']; notes?: string;
  /** Event group. Omitted placements stay in 布景. */
  category?: FurnitureItem['category'];
}
export function createGlbCatalogItem(input: GlbCatalogInput): CatalogItem {
  return {
    type: 'glb-asset', name: input.name, width: input.width, depth: input.depth, height: input.height,
    color: '#ffffff', icon: '◇', price: 0, category: input.category ?? 'decor', glbUrl: input.url,
    source: input.source ?? (input.assetId ? 'public_library' : 'local_sample'),
    materialId: input.materialId ?? 'asset', notes: input.notes ?? '',
    ...(input.assetId ? { assetId: input.assetId } : {}),
  };
}

export function disposeOwnedModel(root: THREE.Object3D): void {
  disposeGlbMixersIn(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) skinned.skeleton.dispose();
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}

export function clearGlbAssetCache(): void {
  for (const entry of cache.values()) { entry.controller.abort(); if (entry.source) disposeOwnedModel(entry.source); }
  cache.clear(); changed();
}

/** A model the user picked off their own disk. Session-only: it never joins the shipped library. */
export interface ImportedGlbAsset {
  key: string;
  name: string;
  fileName: string;
  width: number;
  depth: number;
  height: number;
  unit: 'm' | 'cm';
  upAxis: 'y' | 'z';
  importedAt: number;
}

let importedLocalGlbs: readonly ImportedGlbAsset[] = [];
/** Stable snapshot for useSyncExternalStore; the array only changes when an import or rename lands. */
export function listImportedGlbAssets(): readonly ImportedGlbAsset[] { return importedLocalGlbs; }

export function renameImportedGlbAsset(key: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const next = importedLocalGlbs.map(asset => (asset.key === key ? { ...asset, name: trimmed } : asset));
  importedLocalGlbs = next;
  changed();
}

/**
 * Parse a picked .glb with the same loader, validation and normalization the
 * downloader uses, then leave it in the shared cache under a local key so
 * `createCachedGlbModel` and the material panel can reuse it in this session.
 */
export async function importLocalGlb(file: File, key: string): Promise<ImportedGlbAsset> {
  if (!key) throw new Error('缺少模型标识。');
  const prior = cache.get(key);
  prior?.controller.abort();
  const controller = new AbortController();
  const entry: CachedAsset = { url: key, state: { status: 'loading' }, controller, promise: Promise.resolve() };
  cache.set(key, entry);
  changed();
  let source: THREE.Object3D | undefined;
  try {
    const buffer = await file.arrayBuffer();
    validateGlbBuffer(buffer);
    const gltf = await createGlbLoader().parseAsync(buffer, '').catch(() => {
      throw new Error('模型解析失败：文件损坏或不是标准 glTF 2.0。');
    });
    source = gltf.scene;
    assertRenderableGlb(source);
    const normalized = normalizeGlbRoot(source);
    if (cache.get(key) !== entry || controller.signal.aborted) throw new Error('模型导入请求已过期，请重试。');
    entry.source = normalized.root;
    entry.animations = gltf.animations?.length ? gltf.animations : undefined;
    entry.state = { status: 'ready', dimensions: normalized.size };
    source = undefined;
    const asset: ImportedGlbAsset = {
      key,
      name: file.name.replace(/\.glb$/i, ''),
      fileName: file.name,
      width: normalized.size.width,
      depth: normalized.size.depth,
      height: normalized.size.height,
      unit: normalized.plan.unit,
      upAxis: normalized.plan.upAxis,
      importedAt: Date.now(),
    };
    importedLocalGlbs = [...importedLocalGlbs.filter(item => item.key !== key), asset];
    changed();
    return asset;
  } catch (error) {
    if (source) disposeOwnedModel(source);
    const message = error instanceof Error ? error.message : '模型导入失败，请重试。';
    if (cache.get(key) === entry) { entry.state = { status: 'error', error: message }; changed(); }
    throw new Error(message);
  }
}
