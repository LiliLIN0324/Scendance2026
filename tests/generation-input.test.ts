import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { WebIO } from '@gltf-transform/core';
import { database,owner,editor } from './fixtures.ts';
import { generationCapabilities,generationRequestSchema } from '../supabase/functions/_shared/generation-contract.ts';
import { prepareGenerationRequest } from '../supabase/functions/_shared/generation-input.ts';
import { compareTextureGeometry } from '../supabase/functions/_shared/generation-quality.ts';
import { hunyuan } from '../supabase/functions/_shared/providers.ts';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';
import { packGltf } from '../supabase/functions/_shared/models.ts';
import { tetrahedron } from './model-fixture.ts';
import { sha256 } from '../supabase/functions/_shared/domain.ts';
import type { Env } from '../supabase/functions/_shared/http.ts';
const env=(extra:Record<string,string>={}):Env=>key=>({HUNYUAN_API_KEY:'test',HUNYUAN_API_MODE:'tokenhub',HUNYUAN_TERMS_URL:'https://example.test/terms',HUNYUAN_TERMS_REVIEWED_AT:'2026-10-03',...extra})[key];
const response=(body:unknown)=>new Response(JSON.stringify(body));
async function uvModel(){const fixture=tetrahedron(),doc=await new WebIO().readBinary(packGltf(fixture.json,fixture.resources));doc.getRoot().listMeshes()[0].listPrimitives()[0].setAttribute('TEXCOORD_0',doc.createAccessor().setType('VEC2').setArray(new Float32Array([0,0,1,0,0,1,1,1])).setBuffer(doc.getRoot().listBuffers()[0]));return new WebIO().writeBinary(doc);}

describe('generation inputs and provider isolation',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f?.db.close();});
  beforeEach(async()=>{await f.db.exec('delete from scene_private.generation_jobs;delete from scene_private.requests;update scene_private.budgets set committed_cents=0;');});
  async function image(actor=owner){return f.rpc(actor,'assets.register',{id:crypto.randomUUID(),name:'Reference',source:'upload',format:'png',storagePath:`${actor}/${crypto.randomUUID()}/reference.png`,byteSize:100,sha256:'a'.repeat(64),metadata:{width:512,height:512},license:{}});}
  async function source(bytes:Uint8Array){const a=await f.rpc(owner,'assets.register',{id:crypto.randomUUID(),name:'Source',source:'upload',format:'glb',storagePath:`${owner}/${crypto.randomUUID()}/source.glb`,byteSize:bytes.length,sha256:await sha256(bytes),metadata:{},license:{}});f.backend.readSourceBytes=async()=>bytes;return a;}
  it('keeps text requests backward compatible and advertises only configured capabilities',async()=>{
    const input={requestId:crypto.randomUUID(),prompt:'vase'};
    expect(generationRequestSchema.parse(input).kind).toBe('text');
    expect(generationCapabilities(env())).toEqual({model:'hy-3d-3.0',textToModel:true,imageToModel:true,texture:false,textureRequiresImage:true});
    expect(generationCapabilities(()=>undefined).textToModel).toBe(false);
    expect((await prepareGenerationRequest(f.backend,owner,input,env())).fingerprint).toBe(await sha256('vase'));
    await expect(prepareGenerationRequest(f.backend,owner,{...input,kind:'texture',sourceAssetId:crypto.randomUUID(),referenceImageAssetId:crypto.randomUUID()},env())).rejects.toThrow('SERVICE_NOT_CONFIGURED');
  });
  it('validates owned reference images before reserving and never trusts a model URL',async()=>{
    const ref=await image(),other=await image(editor),input={requestId:crypto.randomUUID(),prompt:'参考图物体',kind:'image',referenceImageAssetId:ref.id};
    expect(await prepareGenerationRequest(f.backend,owner,input,env())).toMatchObject({providerMode:'tokenhub',providerModel:'hy-3d-3.0'});
    await expect(prepareGenerationRequest(f.backend,owner,{...input,referenceImageAssetId:other.id},env())).rejects.toThrow();
    expect(generationRequestSchema.safeParse({...input,imageUrl:'https://attacker.test/x.png'}).success).toBe(false);
    expect((await f.db.query('select * from scene_private.requests')).rows).toHaveLength(0);
  });
  it('pins provider identity and ignores later configuration on idempotent replay',async()=>{
    const ref=await image(),input={requestId:crypto.randomUUID(),prompt:'参考图物体',kind:'image',referenceImageAssetId:ref.id};
    const prepared=await prepareGenerationRequest(f.backend,owner,input,env());
    const job=await f.jobs(owner,'jobs.create',{...prepared,reserveCents:100});
    expect(job).toMatchObject({kind:'image',provider_mode:'tokenhub',provider_model:'hy-3d-3.0',reference_image_asset_id:ref.id});
    const replay=await f.jobs(owner,'jobs.create',{...await prepareGenerationRequest(f.backend,owner,input,env({HUNYUAN_MODEL:'hy-3d-3.1'})),reserveCents:100});
    expect(replay).toMatchObject({id:job.id,reused:true,provider_model:'hy-3d-3.0'});
    const calls:Record<string,unknown>[]=[];
    await processGeneration(f.backend,env({HUNYUAN_MODEL:'hy-3d-3.1',HUNYUAN_API_MODE:'legacy'}),async(url,init)=>{expect(String(url)).toContain('tokenhub.tencentmaas.com');calls.push(JSON.parse(init!.body as string));return response({id:'image-job'});});
    expect(calls[0]).toMatchObject({model:'hy-3d-3.0',image_url:expect.stringContaining('reference.png'),generate_type:'LowPoly'});expect(calls[0]).not.toHaveProperty('prompt');
  });
  it('uses a bounded Normal request for explicit 3.1 without LowPoly or format override',async()=>{
    const network=vi.fn(async(_url,init)=>{expect(JSON.parse(init.body)).toEqual({model:'hy-3d-3.1',prompt:'vase',generate_type:'Normal',face_count:20000,enable_pbr:true});return response({id:'3.1'});});
    await hunyuan(env(),network,{providerMode:'tokenhub',providerModel:'hy-3d-3.1'}).submit('vase');expect(network).toHaveBeenCalledTimes(1);
  });
  it('rejects required source extensions before UV inspection and before reserving a paid request',async()=>{
    const fixture=tetrahedron();fixture.json.extensionsRequired=['KHR_mesh_quantization'];
    const a=await source(packGltf(fixture.json,fixture.resources)),ref=await image();
    await expect(prepareGenerationRequest(f.backend,owner,{requestId:crypto.randomUUID(),prompt:'浅橡木',kind:'texture',sourceAssetId:a.id,referenceImageAssetId:ref.id},env({HUNYUAN_TEXTURE_ENABLED:'true'}))).rejects.toMatchObject({code:'UNSUPPORTED_MODEL_FEATURE',status:422});
    expect((await f.db.query('select * from scene_private.requests')).rows).toHaveLength(0);
  });
  it('requires source UV before a texture task can be reserved',async()=>{
    const fixture=tetrahedron(),a=await source(packGltf(fixture.json,fixture.resources)),ref=await image();
    await expect(prepareGenerationRequest(f.backend,owner,{requestId:crypto.randomUUID(),prompt:'浅橡木',kind:'texture',sourceAssetId:a.id,referenceImageAssetId:ref.id},env({HUNYUAN_TEXTURE_ENABLED:'true'}))).rejects.toThrow('SOURCE_UV_REQUIRED');
    expect((await f.db.query('select * from scene_private.requests')).rows).toHaveLength(0);
  });
  it.each([false,true])('archives only a geometry/UV-preserving texture result: changed=%s',async changed=>{
    const bytes=await uvModel(),a=await source(bytes),ref=await image();
    let resultBytes=bytes;
    if(changed){const doc=await new WebIO().readBinary(bytes);doc.getRoot().listNodes()[0].setTranslation([0.1,0,0]);resultBytes=await new WebIO().writeBinary(doc);}
    const prepared=await prepareGenerationRequest(f.backend,owner,{requestId:crypto.randomUUID(),prompt:'浅橡木',kind:'texture',sourceAssetId:a.id,referenceImageAssetId:ref.id},env({HUNYUAN_TEXTURE_ENABLED:'true'}));
    const job=await f.jobs(owner,'jobs.create',{...prepared,reserveCents:100});
    const upload=vi.fn(async()=>{}),backend={...f.backend,upload};
    const network=vi.fn(async(url,init)=>{
      const body=init?.body?JSON.parse(init.body as string):undefined;
      if(String(url).endsWith('/submit')){expect(body).toEqual({model:'hy-3d-texture',file_3d:{url:expect.stringContaining('source.glb')},image:{url:expect.stringContaining('reference.png')},enable_pbr:true,enable_keep_uv:true,texture_size:1024});return response({id:'texture-job'});}
      if(String(url).endsWith('/query')){expect(body).toEqual({model:'hy-3d-texture',id:'texture-job'});return response({status:'completed',data:[{type:'glb',url:'https://result.myqcloud.com/texture.glb'}]});}
      return new Response(new Uint8Array(resultBytes));
    });
    await processGeneration(backend,env(),network);await f.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[job.id]);await processGeneration(backend,env(),network);
    const result=await f.jobs(owner,'jobs.get',{id:job.id});
    expect(result.state).toBe(changed?'rejected':'ready');expect(upload).toHaveBeenCalledTimes(changed?0:1);
    if(changed){expect(result.error_code).toBe('TEXTURE_GEOMETRY_CHANGED');expect(result.asset_id).toBeNull();expect(result.provider_usage.quality).toBeTruthy();}
    else expect((await f.rpc(owner,'assets.get',{assetId:result.asset_id})).metadata).toMatchObject({parentAssetId:a.id,changeMode:'texture',textureVariant:{validation:{geometryPreserved:true,uvPreserved:true}}});
  });
  it('compares UV values and topology, not only bounds or vertex counts',async()=>{
    const bytes=await uvModel(),doc=await new WebIO().readBinary(bytes),uv=doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('TEXCOORD_0')!;
    uv.setElement(0,[0.5,0.5]);
    expect(await compareTextureGeometry(bytes,await new WebIO().writeBinary(doc))).toMatchObject({geometryPreserved:true,uvPreserved:false});
  });
});
