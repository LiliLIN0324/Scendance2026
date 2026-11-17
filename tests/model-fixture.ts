import type { GLTF } from '@gltf-transform/core';
export function tetrahedron():{json:GLTF.IGLTF;resources:Record<string,Uint8Array>} {
  const positions=new Float32Array([0,0,0,1,0,0,0,1,0,0,0,1]);
  const indices=new Uint16Array([0,2,1,0,1,3,0,3,2,1,2,3]);
  const data=new Uint8Array(positions.byteLength+indices.byteLength);data.set(new Uint8Array(positions.buffer));data.set(new Uint8Array(indices.buffer),positions.byteLength);
  return {json:{asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{uri:'model.bin',byteLength:data.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:48,target:34962},{buffer:0,byteOffset:48,byteLength:24,target:34963}],accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3',min:[0,0,0],max:[1,1,1]},{bufferView:1,componentType:5123,count:12,type:'SCALAR'}]},resources:{'model.bin':data}};
}
/**
 * 把一个合法 GLB 的 BIN chunk 撑到指定总体积。
 *
 * 用来复刻生产 C1 实跑的真实情况：Lux3D G1 的 textured.glb 实测 10.06 MiB，
 * 比通用 10 MiB 上限多 59 KB——供应商模型本身没问题，是我们自己的闸门太紧。
 */
export function inflateGlb(bytes: Uint8Array, targetBytes: number): Uint8Array<ArrayBuffer> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as GLTF.IGLTF;
  const bin = bytes.subarray(20 + jsonLength + 8);
  const overhead = 12 + 8 + 8; // 容器头 + JSON chunk 头 + BIN chunk 头
  const binLength = Math.max(bin.length, targetBytes - overhead - 512); // 给 JSON 留够位置
  const paddedBin = binLength + ((4 - (binLength % 4)) % 4);
  json.buffers = [{ byteLength: paddedBin }]; // buffers 的长度必须与 BIN chunk 一致，否则校验器报长度不符
  const raw = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (raw.length % 4)) % 4;
  const jsonBytes = new Uint8Array(raw.length + jsonPad);
  jsonBytes.set(raw);
  if (jsonPad) jsonBytes.fill(0x20, raw.length); // GLB 规范：JSON chunk 用空格补齐
  const total = 12 + 8 + jsonBytes.length + 8 + paddedBin;
  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true); outView.setUint32(4, 2, true); outView.setUint32(8, total, true);
  outView.setUint32(12, jsonBytes.length, true); outView.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  outView.setUint32(20 + jsonBytes.length, paddedBin, true); outView.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(bin.subarray(0, Math.min(bin.length, binLength)), 28 + jsonBytes.length);
  return out;
}
