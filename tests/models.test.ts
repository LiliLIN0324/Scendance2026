import { describe,it,expect,vi } from 'vitest';
import { packGltf,repairGlb,validateModel } from '../supabase/functions/_shared/models.ts';
import { allowedDownload,readBounded,type Env } from '../supabase/functions/_shared/http.ts';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';
import { ApiError } from '../supabase/functions/_shared/domain.ts';
import type { Backend } from '../supabase/functions/_shared/backend.ts';
import type { GLTF } from '@gltf-transform/core';
import { tetrahedron } from './model-fixture.ts';

describe('model archive validation',()=>{
  it('validates a real GLB and computes normalization without rewriting textures',async()=>{
    const {json,resources}=tetrahedron(),bytes=packGltf(json,resources),report=await validateModel(bytes);
    expect(report.triangles).toBe(4);expect(report.sourceSize).toEqual({width:1,height:1,depth:1});expect(report.groundOffset).toEqual([-0.5,-0,-0.5]);
  });
  it('rejects broken files and external resources',async()=>{
    await expect(validateModel(new Uint8Array(50))).rejects.toThrow('INVALID_GLB');
    const {json,resources}=tetrahedron();json.images=[{uri:'https://evil.example/texture.png'}];
    expect(()=>packGltf(json,resources)).toThrow('MISSING_MODEL_RESOURCE');
  });
  it('rejects unsupported required compression instead of declaring success',async()=>{
    const {json,resources}=tetrahedron();json.extensionsRequired=['KHR_draco_mesh_compression'];
    await expect(validateModel(packGltf(json,resources))).rejects.toThrow('UNSUPPORTED_MODEL_FEATURE');
  });
  it('caps streamed bytes, even without Content-Length',async()=>{
    await expect(readBounded(new Response(new Uint8Array(11)),10)).rejects.toThrow('FILE_TOO_LARGE');
  });
  it.each(['http://a.myqcloud.com/x','https://myqcloud.com.evil.test/x','https://127.0.0.1/x','https://user:pass@a.myqcloud.com/x','https://a.myqcloud.com:8443/x'])('rejects untrusted download %s',url=>{
    expect(()=>allowedDownload(url,['.myqcloud.com'])).toThrow('UNTRUSTED_ASSET_URL');
  });
});

/** 一块带 NORMAL 的合法 GLB 素材（两个 VEC3 float bufferView，无交错）。 */
function normalFixture():{json:GLTF.IGLTF;resources:Record<string,Uint8Array>} {
  const positions=new Float32Array([0,0,0,1,0,0,0,1,0,0,0,1]);
  const normals=new Float32Array([0,1,0,1,0,0,0,0,-1,0,1,0]);
  const data=new Uint8Array(96);
  data.set(new Uint8Array(positions.buffer));data.set(new Uint8Array(normals.buffer),48);
  return {json:{asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1}}]}],
    buffers:[{uri:'model.bin',byteLength:96}],
    bufferViews:[{buffer:0,byteOffset:0,byteLength:48,target:34962},{buffer:0,byteOffset:48,byteLength:48,target:34962}],
    accessors:[{bufferView:0,componentType:5126,count:4,type:'VEC3',min:[0,0,0],max:[1,1,1]},{bufferView:1,componentType:5126,count:4,type:'VEC3'}]},
  resources:{'model.bin':data}};
}
const normalGlb=()=>{const {json,resources}=normalFixture();return packGltf(json,resources);};
/** 坏 GLB 必须以 ApiError('INVALID_GLB',422) 失败：worker 只把 422 记为 rejected，裸 TypeError 会变成重试。 */
function expectInvalidGlb(run:()=>unknown) {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({code:'INVALID_GLB',status:422});
    return;
  }
  throw new Error('expected INVALID_GLB');
}

describe('repairGlb hardens untrusted aholo GLBs',()=>{
  it('keeps a healthy GLB byte-identical',()=>{
    const bytes=normalGlb();
    expect(repairGlb(bytes)).toEqual(bytes);
  });
  it('still normalizes Lux3D zero-length normals without touching other vertices',()=>{
    const {json,resources}=normalFixture();
    const data=new Uint8Array(resources['model.bin']);
    const source=new DataView(data.buffer);
    source.setFloat32(84,0,true);source.setFloat32(88,0,true);source.setFloat32(92,0,true); // 第四个法线清零
    const repaired=repairGlb(packGltf(json,{'model.bin':data}));
    const view=new DataView(repaired.buffer,repaired.byteOffset,repaired.byteLength);
    const binOffset=20+view.getUint32(12,true)+8;
    const normalAt=(i:number)=>[view.getFloat32(binOffset+48+i*12,true),view.getFloat32(binOffset+48+i*12+4,true),view.getFloat32(binOffset+48+i*12+8,true)];
    expect(normalAt(3)).toEqual([0,1,0]);
    expect(normalAt(0)).toEqual([0,1,0]);
    expect(normalAt(1)).toEqual([1,0,0]);
    expect(normalAt(2)).toEqual([0,0,-1]);
  });
  it('rejects a NORMAL accessor whose bufferView does not exist',()=>{
    const {json,resources}=normalFixture();
    json.meshes![0].primitives[0].attributes.NORMAL=2;
    json.accessors!.push({bufferView:9,componentType:5126,count:4,type:'VEC3'});
    expectInvalidGlb(()=>repairGlb(packGltf(json,resources)));
  });
  it('rejects a BIN chunk truncated below the NORMAL accessor range',()=>{
    const bytes=normalGlb();
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const binOffset=20+view.getUint32(12,true)+8;
    // 只保留 normal bufferView 的前 12 字节，同时把 GLB/BIN 两个长度改成自洽的 60 字节。
    const truncated=bytes.slice(0,binOffset+60);
    const truncatedView=new DataView(truncated.buffer,truncated.byteOffset,truncated.byteLength);
    truncatedView.setUint32(8,truncated.byteLength,true);
    truncatedView.setUint32(binOffset-4,truncated.byteLength-binOffset,true);
    expectInvalidGlb(()=>repairGlb(truncated));
  });
  it('rejects a GLB truncated below its declared length',()=>{
    const bytes=normalGlb();
    expectInvalidGlb(()=>repairGlb(bytes.slice(0,bytes.byteLength-8)));
  });
  it('rejects a corrupt aholo GLB instead of parking the job in processing',async()=>{
    const {json,resources}=normalFixture();
    json.meshes![0].primitives[0].attributes.NORMAL=2;
    json.accessors!.push({bufferView:9,componentType:5126,count:4,type:'VEC3'});
    const bad=new Uint8Array(packGltf(json,resources));
    const updates:{action:string;state:string|undefined;data:Record<string,unknown>}[]=[];
    const uploaded:string[]=[];
    const job={id:'job-1',worker_token:'token',owner_id:'owner',provider_mode:'aholo',provider_model:'lux3d',provider_job_id:'4423551',state:'submitted',kind:'text',prompt:'vase',created_at:new Date().toISOString()};
    const backend:Backend={
      user:async()=>'owner',scene:async()=>null,
      jobs:async(_actor,action,data)=>{if(action==='jobs.claim')return job;updates.push({action,state:typeof data?.state==='string'?data.state:undefined,data:data??{}});return null;},
      reconstruction:async()=>null,sign:async()=>'https://example.test/signed',
      upload:async(path)=>{uploaded.push(path);},
    };
    const network=vi.fn(async(url:RequestInfo|URL)=>{
      if(String(url).includes('/lux3d/v1/generate/task/get'))return new Response(JSON.stringify({c:'0',d:{status:3,outputs:[{content:'https://model.kujiale.com/x/textured.glb'}]},m:''}));
      if(String(url)==='https://model.kujiale.com/x/textured.glb')return new Response(bad);
      throw new Error('unexpected '+String(url));
    });
    const env:Env=key=>({LUX3D_API_KEY:'lux-key',LUX3D_TERMS_URL:'https://example.test/terms',LUX3D_TERMS_REVIEWED_AT:'2026-10-28'})[key];
    await expect(processGeneration(backend,env,network)).resolves.toEqual({processed:1});
    expect(updates.map(update=>update.action)).toEqual(['jobs.archive_start','jobs.update']);
    expect(updates.some(update=>update.state==='processing')).toBe(false);
    expect(updates.at(-1)).toMatchObject({state:'rejected',data:{errorCode:'INVALID_GLB'}});
    expect(uploaded).toEqual([]);
  });
});
