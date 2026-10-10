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
