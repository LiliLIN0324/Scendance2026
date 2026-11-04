import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { normalizedAssetDimensions } from '../supabase/functions/_shared/assets.ts';
import { packGltf } from '../supabase/functions/_shared/models.ts';
import { database,editor,owner,outsider } from './fixtures.ts';
import { tetrahedron } from './model-fixture.ts';

const env=(key:string)=>key==='SENTRY_DSN'?undefined:undefined;
let f:Awaited<ReturnType<typeof database>>;

beforeAll(async()=>{f=await database();});
afterAll(async()=>{await f.db.close();});

function upload(bytes:Uint8Array, query:Record<string,string>={}, actor:string=owner) {
  const search=new URLSearchParams({name:'Smoke 本地模型',source:'upload',...query});
  return createApi(f.backend,env,async()=>new Response(undefined,{status:200}))(new Request(`https://api.test/assets/glb?${search.toString()}`,{
    method:'POST',
    headers:{authorization:`Bearer ${actor}`,'content-type':'model/gltf-binary'},
    body:new Blob([bytes as unknown as BlobPart],{type:'model/gltf-binary'}),
  }));
}

describe('local GLB upload and asset registration',()=>{
  it('registers an uploaded GLB with bytes, dedupe hash, normalized dimensions, source and owner',async()=>{
    const fixture=tetrahedron(),bytes=packGltf(fixture.json,fixture.resources),uploadSpy=vi.fn(f.backend.upload);
    f.backend.upload=uploadSpy;
    const response=await upload(bytes,{source:'aholo',sourceId:'4641361'});
    expect(response.status).toBe(201);
    const asset=await response.json() as Record<string,any>;
    expect(asset).toMatchObject({
      id:expect.stringMatching(/^[0-9a-f-]{36}$/),
      name:'Smoke 本地模型',
      source:'aholo',
      sourceId:'4641361',
      ownerId:owner,
      byteSize:bytes.length,
      sha256:expect.stringMatching(/^[a-f0-9]{64}$/),
      metadata:expect.objectContaining({triangles:4,dimensions:{width:1,depth:1,height:1}}),
    });
    expect(asset.storage_path).toBeUndefined();
    expect(asset.storagePath).toBeUndefined();
    expect(asset.metadata.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.metadata.sourceByteSize).toBe(bytes.length);
    expect(asset.metadata.normalization).toMatchObject({unit:'m',upAxis:'y'});
    expect(uploadSpy).toHaveBeenCalledTimes(1);
  });

  it('returns the same asset instead of a second row when the identical file is uploaded again',async()=>{
    const fixture=tetrahedron(),bytes=packGltf(fixture.json,fixture.resources),uploadSpy=vi.fn(f.backend.upload);
    f.backend.upload=uploadSpy;
    const first=await (await upload(bytes,{name:'去重模型'})).json() as Record<string,any>;
    const uploadsAfterFirst=uploadSpy.mock.calls.length;
    const second=await (await upload(bytes,{name:'去重模型'})).json() as Record<string,any>;
    expect(second.id).toBe(first.id);
    expect(second.reused).toBe(true);
    expect(uploadSpy.mock.calls.length).toBe(uploadsAfterFirst);
    const list=await f.rpc(owner,'assets.list',{});
    expect(list.filter((asset:{id:string})=>asset.id===first.id)).toHaveLength(1);
  });

  it('keeps different files as separate assets',async()=>{
    const first=await (await upload(packGltf(tetrahedron().json,tetrahedron().resources),{name:'A'})).json() as {id:string};
    const moved=tetrahedron();
    moved.json.nodes=[{mesh:0,translation:[10,0,0]}];
    const second=await (await upload(packGltf(moved.json,moved.resources),{name:'B'})).json() as {id:string,metadata:{dimensions:{width:number}}};
    expect(second.id).not.toBe(first.id);
    expect(second.metadata.dimensions.width).toBe(1);
  });

  it('rejects a body that is not a GLB and a source id that violates the Lux3D task format',async()=>{
    expect((await upload(new Uint8Array(40))).status).toBe(422);
    expect((await upload(packGltf(tetrahedron().json,tetrahedron().resources),{source:'aholo',sourceId:'not a task'})).status).toBe(400);
  });

  it('requires studio membership before accepting a local upload',async()=>{
    expect((await upload(packGltf(tetrahedron().json,tetrahedron().resources),{},outsider)).status).toBe(403);
    expect((await upload(packGltf(tetrahedron().json,tetrahedron().resources),{},editor)).status).toBe(201);
  });

  it('normalizes centimetre and Z-up models to metre dimensions',()=>{
    expect(normalizedAssetDimensions({width:100,height:50,depth:200})).toMatchObject({
      unit:'cm',upAxis:'z',dimensions:{width:1,depth:0.5,height:2},
    });
    expect(normalizedAssetDimensions({width:1,height:0.5,depth:1})).toMatchObject({
      unit:'m',upAxis:'y',dimensions:{width:1,depth:1,height:0.5},
    });
  });
});
