import type { GLTF } from '@gltf-transform/core';
export function tetrahedron():{json:GLTF.IGLTF;resources:Record<string,Uint8Array>} {
  const positions=new Float32Array([0,0,0,1,0,0,0,1,0,0,0,1]);
  const indices=new Uint16Array([0,2,1,0,1,3,0,3,2,1,2,3]);
  const data=new Uint8Array(positions.byteLength+indices.byteLength);data.set(new Uint8Array(positions.buffer));data.set(new Uint8Array(indices.buffer),positions.byteLength);
  return {json:{asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{uri:'model.bin',byteLength:data.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:48,target:34962},{buffer:0,byteOffset:48,byteLength:24,target:34963}],accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3',min:[0,0,0],max:[1,1,1]},{bufferView:1,componentType:5123,count:12,type:'SCALAR'}]},resources:{'model.bin':data}};
}
