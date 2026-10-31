import { WebIO, getBounds, type GLTF } from '@gltf-transform/core';
// @ts-types="./gltf-validator.d.ts"
import { validateBytes } from 'gltf-validator';
import { ApiError } from './domain.ts';

export const MAX_GLB_BYTES = 10 * 1024 * 1024;
function glbJson(bytes: Uint8Array) {
  if (bytes.byteLength < 28 || bytes.byteLength > MAX_GLB_BYTES) throw new ApiError('INVALID_GLB_SIZE', 422);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0,true)!==0x46546c67 || view.getUint32(4,true)!==2 || view.getUint32(8,true)!==bytes.byteLength || view.getUint32(16,true)!==0x4e4f534a || 20+view.getUint32(12,true)>bytes.byteLength) throw new ApiError('INVALID_GLB', 422);
  try { return JSON.parse(new TextDecoder().decode(bytes.slice(20,20+view.getUint32(12,true)))) as GLTF.IGLTF; }
  catch { throw new ApiError('INVALID_GLB',422); }
}
/** 修复 Aholo Lux3D 产物的两类瑕疵：bufferView 缺 target、法线含零向量（Khronos 校验按 Error 计）。
 *  字节层操作：法线归一化等长写回 BIN chunk，target 写进 JSON chunk 后重打包容器；几何与 UV 不动。
 *  输入是不可信的厂商产物：任何结构异常（缺 accessor/bufferView、越界、截断）都必须变成
 *  ApiError('INVALID_GLB', 422)——裸 TypeError/RangeError 会被 worker 当成临时故障反复重试。 */
export function repairGlb(bytes: Uint8Array): Uint8Array {
  try { return repairGlbBytes(bytes); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('INVALID_GLB', 422);
  }
}

function repairGlbBytes(bytes: Uint8Array): Uint8Array {
  const json = glbJson(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  // BIN chunk 头必须存在，且声明的长度不能超出容器；否则下面的偏移计算会落到 GLB 之外。
  if (20 + jsonLength + 8 > bytes.byteLength) throw new ApiError('INVALID_GLB', 422);
  const binOffset = 20 + jsonLength + 8;
  const binChunkLength = view.getUint32(20 + jsonLength, true);
  if (binChunkLength > bytes.byteLength - binOffset) throw new ApiError('INVALID_GLB', 422);
  const accessorView = (index: number) => json.accessors?.[index]?.bufferView;
  const seen = new Set<number>();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const accessorIndex of Object.values(primitive.attributes ?? {})) {
        const bufferView = accessorView(accessorIndex as number);
        if (bufferView !== undefined) seen.add(bufferView);
      }
      if (primitive.indices !== undefined) {
        const bufferView = accessorView(primitive.indices);
        if (bufferView !== undefined) seen.add(bufferView);
      }
    }
  }
  json.bufferViews = (json.bufferViews ?? []).map((bufferView, index) => seen.has(index) ? { ...bufferView, target: 34962 } : bufferView);
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.indices === undefined) continue;
      const bufferView = accessorView(primitive.indices);
      if (bufferView !== undefined) {
        const target = json.bufferViews?.[bufferView];
        if (!target) throw new ApiError('INVALID_GLB', 422);
        target.target = 34963;
      }
    }
  }
  // 法线归一化：等长写回，零向量置 (0,1,0)。只碰语义为 NORMAL 的 accessor（POSITION 也是 VEC3，绝不能动）。
  const accessorList = json.accessors ?? [];
  const normalAccessors = new Set<number>();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      for (const [semantic, accessorIndex] of Object.entries(primitive.attributes ?? {})) {
        if (semantic === 'NORMAL') normalAccessors.add(accessorIndex as number);
      }
    }
  }
  for (const accessorIndex of normalAccessors) {
    // 读 BIN 之前把结构全部固定下来：缺 accessor / 缺 bufferView / 类型不符 / 越界都是坏 GLB。
    const accessor = accessorList[accessorIndex];
    if (!accessor) throw new ApiError('INVALID_GLB', 422);
    if (accessor.type !== 'VEC3' || accessor.componentType !== 5126) throw new ApiError('INVALID_GLB', 422);
    const bufferView = accessor.bufferView === undefined ? undefined : json.bufferViews?.[accessor.bufferView];
    if (!bufferView) throw new ApiError('INVALID_GLB', 422);
    // GLB 的 BIN 只能对应 buffer 0；多 buffer 的偏移换算没有意义，直接拒绝而不是读错数据。
    if (bufferView.buffer !== undefined && bufferView.buffer !== 0) throw new ApiError('INVALID_GLB', 422);
    const count = accessor.count;
    const viewOffset = bufferView.byteOffset ?? 0;
    const byteOffset = accessor.byteOffset ?? 0;
    const stride = bufferView.byteStride ?? 12;
    const viewLength = bufferView.byteLength;
    if (![count, viewOffset, byteOffset, stride, viewLength].every(n => Number.isSafeInteger(n)) || count < 1 || viewOffset < 0 || byteOffset < 0 || viewLength < 0 || stride < 12) throw new ApiError('INVALID_GLB', 422);
    const start = binOffset + viewOffset + byteOffset;
    // 整个 VEC3 元素必须同时落在该 bufferView 的 byteLength 内和 GLB BIN 区之内。
    const end = start + (count - 1) * stride + 12;
    if (end > binOffset + viewOffset + viewLength || end > binOffset + binChunkLength || end > bytes.byteLength) throw new ApiError('INVALID_GLB', 422);
    for (let i = 0; i < count; i++) {
      const base = start + i * stride;
      const x = view.getFloat32(base, true), y = view.getFloat32(base + 4, true), z = view.getFloat32(base + 8, true);
      const length = Math.hypot(x, y, z);
      if (length >= 0.999 && length <= 1.001) continue;
      const nx = length < 1e-6 ? 0 : x / length, ny = length < 1e-6 ? 1 : y / length, nz = length < 1e-6 ? 0 : z / length;
      view.setFloat32(base, nx, true); view.setFloat32(base + 4, ny, true); view.setFloat32(base + 8, nz, true);
    }
  }
  // 重打包：JSON chunk 变了，BIN 原样搬。
  const jsonRaw = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  // GLB 规范：JSON chunk 用空格 (0x20) 补齐，NUL 会让部分解析器拒绝。
  const jsonBytes = new Uint8Array(jsonRaw.length + jsonPad);
  jsonBytes.set(jsonRaw);
  if (jsonPad) jsonBytes.fill(0x20, jsonRaw.length);
  const binLength = bytes.byteLength - binOffset;
  const binPad = (4 - (binLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + 8 + binLength + binPad;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true); outView.setUint32(4, 2, true); outView.setUint32(8, total, true);
  outView.setUint32(12, jsonBytes.length, true); outView.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  outView.setUint32(20 + jsonBytes.length, binLength, true); outView.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(bytes.subarray(binOffset, bytes.byteLength), 28 + jsonBytes.length);
  return out;
}

export async function validateModel(bytes: Uint8Array) {
  const json = glbJson(bytes);
  if (json.buffers?.some(b => b.uri) || json.images?.some(i => i.uri)) throw new ApiError('EXTERNAL_MODEL_RESOURCES',422);
  if (json.extensionsRequired?.length || json.skins?.length || json.animations?.length) throw new ApiError('UNSUPPORTED_MODEL_FEATURE',422);
  if ((json.nodes?.length ?? 0)>500 || (json.materials?.length ?? 0)>64 || (json.images?.length ?? 0)>32) throw new ApiError('MODEL_TOO_COMPLEX',422);
  const report = await validateBytes(bytes, { maxIssues: 20 });
  if (report.issues.numErrors) throw new ApiError('GLTF_VALIDATION_FAILED',422,{ errors: report.issues.numErrors });
  const document = await new WebIO().readBinary(bytes);
  const root = document.getRoot();
  if (root.listScenes().length !== 1) throw new ApiError('MODEL_REQUIRES_ONE_SCENE',422);
  let triangles = 0, primitives = 0;
  // Count instances, not just unique meshes, because every node has rendering cost.
  root.listScenes()[0].traverse(node => {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (primitive.getMode()!==4) throw new ApiError('MODEL_REQUIRES_TRIANGLES',422);
      const positions = primitive.getAttribute('POSITION');
      if (!positions) throw new ApiError('MODEL_MISSING_POSITIONS',422);
      triangles += (primitive.getIndices()?.getCount() ?? positions.getCount()) / 3;
      primitives++;
    }
  });
  if (triangles < 1 || triangles>100_000 || primitives>200) throw new ApiError('MODEL_TOO_COMPLEX',422);
  for (const texture of root.listTextures()) {
    const size = texture.getSize();
    if (!size || size.some(n=>n>2048) || !['image/jpeg','image/png'].includes(texture.getMimeType())) throw new ApiError('UNSUPPORTED_TEXTURE',422);
  }
  const bounds = getBounds(root.listScenes()[0]);
  const dimensions = bounds.max.map((n,i)=>n-bounds.min[i]);
  if (dimensions.some(n=>!Number.isFinite(n)||n<=0)) throw new ApiError('INVALID_MODEL_BOUNDS',422);
  return {
    triangles, primitives, textures: root.listTextures().length,
    bounds, sourceSize: { width: dimensions[0], height: dimensions[1], depth: dimensions[2] },
    // Apply translation in model-local coordinates, then per-axis scale to target size.
    groundOffset: [-(bounds.min[0]+bounds.max[0])/2,-bounds.min[1],-(bounds.min[2]+bounds.max[2])/2],
    validationWarnings: report.issues.numWarnings,
  };
}

// Packs supplied resources without dropping optional material extensions or textures.
export function packGltf(json: GLTF.IGLTF, resources: Record<string,Uint8Array>): Uint8Array {
  const doc = structuredClone(json), parts: Uint8Array[] = []; let length=0;
  const append=(bytes: Uint8Array)=>{ const offset=length; parts.push(bytes); const padding=(4-bytes.length%4)%4; parts.push(new Uint8Array(padding)); length+=bytes.length+padding; return offset; };
  const offsets=(doc.buffers??[]).map(b=>{ if (!b.uri || !resources[b.uri]) throw new ApiError('MISSING_MODEL_RESOURCE',422); return append(resources[b.uri]); });
  for (const view of doc.bufferViews??[]) { view.byteOffset=(view.byteOffset??0)+offsets[view.buffer]; view.buffer=0; }
  for (const img of doc.images??[]) {
    if (!img.uri) continue;
    const data=resources[img.uri]; if (!data) throw new ApiError('MISSING_MODEL_RESOURCE',422);
    const offset=append(data); doc.bufferViews??=[]; img.bufferView=doc.bufferViews.length;
    doc.bufferViews.push({ buffer:0,byteOffset:offset,byteLength:data.length });
    img.mimeType=img.uri.toLowerCase().endsWith('.png')?'image/png':'image/jpeg'; delete img.uri;
  }
  doc.buffers=[{byteLength:length}];
  const raw=new TextEncoder().encode(JSON.stringify(doc)), jsonSize=Math.ceil(raw.length/4)*4;
  const result=new Uint8Array(12+8+jsonSize+8+length);
  if (result.length>MAX_GLB_BYTES) throw new ApiError('FILE_TOO_LARGE',413);
  const view=new DataView(result.buffer);
  view.setUint32(0,0x46546c67,true); view.setUint32(4,2,true); view.setUint32(8,result.length,true);
  view.setUint32(12,jsonSize,true); view.setUint32(16,0x4e4f534a,true); result.fill(32,20,20+jsonSize); result.set(raw,20);
  view.setUint32(20+jsonSize,length,true); view.setUint32(24+jsonSize,0x004e4942,true);
  let cursor=28+jsonSize; for (const part of parts) { result.set(part,cursor); cursor+=part.length; }
  return result;
}
