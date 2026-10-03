import { readFile } from 'node:fs/promises';
import { describe,it,expect } from 'vitest';
import { customizeGlbMaterials, inspectGlbMaterials, customizationSchema } from '../supabase/functions/_shared/material-variants.ts';
import { packGltf } from '../supabase/functions/_shared/models.ts';
import { tetrahedron } from './model-fixture.ts';

const chairPath=new URL('../assets/library/model/bedroom-and-living-room-furniture-dining-chair-timber-b8b614f7.glb',import.meta.url);
const decode=(bytes:Uint8Array)=>{const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=view.getUint32(12,true);return {json:JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+length))),tail:bytes.subarray(20+length)};};
const input=(patch:Record<string,unknown>={})=>({requestId:crypto.randomUUID(),sourceSha256:'a'.repeat(64),materialIndices:[0],baseColor:'#ffffff',...patch});

describe('deterministic immutable GLB material changes',()=>{
  it('inspects actual quantized library chair material slots without requiring UVs',async()=>{
    const bytes=await readFile(chairPath),inspection=await inspectGlbMaterials(bytes);
    expect(inspection.slots.map(slot=>({index:slot.index,name:slot.name}))).toEqual([{index:0,name:'oak'},{index:1,name:'walnut'}]);
    expect(inspection.validation.hasUV).toBe(false);
    expect(inspection.slots.every(slot=>!slot.hasBaseColorTexture)).toBe(true);
    expect(inspection.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    'bar-pub-and-brewery-taproom-bar-counter-module-4f0062bc.glb',
    'almanac-gardens-terracotta-planter-1472f447.glb',
    'live-music-venue-and-festival-stage-truss-straight-bay-3e0706d1.glb',
    'abandoned-cinema-and-projection-booth-abandoned-cinema-765a1a5b.glb',
  ])('preserves actual catalogue model binary and non-material JSON: %s',async filename=>{
    const bytes=new Uint8Array(await readFile(new URL(`../assets/library/model/${filename}`,import.meta.url))),before=decode(bytes);
    const result=await customizeGlbMaterials(bytes,{materialIndices:[0],baseColor:'#808080'}),after=decode(result.bytes);
    expect(after.tail).toEqual(before.tail);
    const {materials:beforeMaterials,...beforeRest}=before.json,{materials:afterMaterials,...afterRest}=after.json;
    expect(afterRest).toEqual(beforeRest);expect(afterMaterials.slice(1)).toEqual(beforeMaterials.slice(1));
    expect(result.validation.geometryUVPreserved).toBe(true);
  });
  it('changes only selected material fields and preserves all binary, nodes, accessors and UV data',async()=>{
    const bytes=await readFile(chairPath),before=decode(bytes),original=bytes.slice();
    const result=await customizeGlbMaterials(bytes,{materialIndices:[0],baseColor:'#808080',metallic:0.1,roughness:0.8});
    const after=decode(result.bytes);
    expect(after.tail).toEqual(new Uint8Array(before.tail));expect(bytes).toEqual(original);
    expect(after.json.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([expect.closeTo(0.2158605,6),expect.closeTo(0.2158605,6),expect.closeTo(0.2158605,6),1]);
    expect(after.json.materials[0].pbrMetallicRoughness).toMatchObject({metallicFactor:0.1,roughnessFactor:0.8});
    expect(after.json.materials[1]).toEqual(before.json.materials[1]);
    const {materials:beforeMaterials,...beforeRest}=before.json,{materials:afterMaterials,...afterRest}=after.json;
    expect(afterRest).toEqual(beforeRest);expect(beforeMaterials).not.toEqual(afterMaterials);
    expect(result.validation).toMatchObject({geometryUVPreserved:true});
    expect(result.validation.geometryUVSignature).toBe((await inspectGlbMaterials(bytes)).validation.geometryUVSignature);
  });
  it('requires explicit texture removal and preserves alpha',async()=>{
    const fixture=tetrahedron(),geometry=fixture.resources['model.bin'];
    const uv=new Float32Array([0,0,1,0,0,1,1,1]),combined=new Uint8Array(geometry.length+uv.byteLength);
    combined.set(geometry);combined.set(new Uint8Array(uv.buffer),geometry.length);fixture.resources['model.bin']=combined;
    fixture.json.buffers![0].byteLength=combined.length;
    fixture.json.bufferViews!.push({buffer:0,byteOffset:geometry.length,byteLength:uv.byteLength,target:34962});
    fixture.json.accessors!.push({bufferView:2,componentType:5126,count:4,type:'VEC2'});
    fixture.json.meshes![0].primitives[0].attributes.TEXCOORD_0=2;
    fixture.json.images=[{uri:'white.png'}];fixture.json.textures=[{source:0}];
    fixture.resources['white.png']=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=','base64'));
    fixture.json.materials=[{name:'textured',pbrMetallicRoughness:{baseColorFactor:[0.3,0.2,0.1,0.6],baseColorTexture:{index:0}},alphaMode:'BLEND'}];
    fixture.json.meshes![0].primitives[0].material=0;
    const bytes=packGltf(fixture.json,fixture.resources);
    const result=await customizeGlbMaterials(bytes,{materialIndices:[0],baseColor:'#ffffff'});
    expect(decode(result.bytes).json.materials[0].pbrMetallicRoughness.baseColorFactor).toEqual([1,1,1,0.6]);
    expect(decode(result.bytes).json.materials[0].pbrMetallicRoughness.baseColorTexture).toEqual({index:0});
    const removed=await customizeGlbMaterials(bytes,{materialIndices:[0],removeBaseColorTexture:true});
    expect(decode(removed.bytes).json.materials[0].pbrMetallicRoughness.baseColorTexture).toBeUndefined();
    expect(decode(removed.bytes).tail).toEqual(decode(bytes).tail);
    expect((await inspectGlbMaterials(removed.bytes)).validation.hasUV).toBe(true);
    expect(customizationSchema.safeParse(input({removeBaseColorTexture:false})).success).toBe(false);
  });
  it('rejects duplicate, nonexistent and empty slot selections and no-op bodies',async()=>{
    for(const patch of [{materialIndices:[]},{materialIndices:[0,0]},{materialIndices:[-1]},{baseColor:undefined}])expect(customizationSchema.safeParse(input(patch)).success).toBe(false);
    await expect(customizeGlbMaterials(await readFile(chairPath),{materialIndices:[63],roughness:0.3})).rejects.toThrow('MATERIAL_SLOT_NOT_FOUND');
  });
  it('rejects malformed and external-resource GLBs before modifying anything',async()=>{
    await expect(inspectGlbMaterials(new Uint8Array(40))).rejects.toThrow('INVALID_GLB');
    const fixture=tetrahedron();fixture.json.materials=[{}];fixture.json.meshes![0].primitives[0].material=0;
    const bytes=packGltf(fixture.json,fixture.resources);
    await expect(customizeGlbMaterials(bytes,{materialIndices:[0],removeBaseColorTexture:true})).rejects.toThrow('MATERIAL_NO_CHANGE');
    const data=decode(bytes);data.json.buffers[0].uri='https://untrusted.example/buffer';
    const raw=new TextEncoder().encode(JSON.stringify(data.json)),size=Math.ceil(raw.length/4)*4,out=new Uint8Array(20+size+data.tail.length),view=new DataView(out.buffer);
    out.set(bytes.subarray(0,20));view.setUint32(8,out.length,true);view.setUint32(12,size,true);out.fill(32,20,20+size);out.set(raw,20);out.set(data.tail,20+size);
    await expect(inspectGlbMaterials(out)).rejects.toThrow();
  });
});
