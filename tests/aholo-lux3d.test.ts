import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { database,owner } from './fixtures.ts';
import { generationCapabilities,generationRequestSchema } from '../supabase/functions/_shared/generation-contract.ts';
import { prepareGenerationRequest } from '../supabase/functions/_shared/generation-input.ts';
import { aholoLux3d } from '../supabase/functions/_shared/providers.ts';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';
import { packGltf } from '../supabase/functions/_shared/models.ts';
import { tetrahedron } from './model-fixture.ts';
import type { Env } from '../supabase/functions/_shared/http.ts';
const baseEnv:Record<string,string>={HUNYUAN_API_KEY:'test',HUNYUAN_API_MODE:'tokenhub',HUNYUAN_TERMS_URL:'https://example.test/terms',HUNYUAN_TERMS_REVIEWED_AT:'2026-10-03',LUX3D_API_KEY:'lux-key',LUX3D_TERMS_URL:'https://example.test/aholo-terms',LUX3D_TERMS_REVIEWED_AT:'2026-10-28'};
const env=(extra:Record<string,string>={}):Env=>key=>({HUNYUAN_API_KEY:'test',HUNYUAN_API_MODE:'tokenhub',HUNYUAN_TERMS_URL:'https://example.test/terms',HUNYUAN_TERMS_REVIEWED_AT:'2026-10-03',...extra})[key];
const response=(body:unknown)=>new Response(JSON.stringify(body));
const glb=()=>new Uint8Array(packGltf(tetrahedron().json,tetrahedron().resources));
const shell=(d:unknown,c='0')=>response({c,d,m:c==='0'?'':'err'});

describe('aholo lux3d lane (docs/AHOLO-INTEGRATION-PLAN.md M1)',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f?.db.close();});
  beforeEach(async()=>{await f.db.exec('delete from scene_private.generation_jobs;delete from scene_private.requests;update scene_private.budgets set committed_cents=0;');});

  it('advertises aholo capabilities only when key and terms are configured',()=>{
    expect(generationCapabilities(env(baseEnv))).toMatchObject({aholoTextToModel:true,aholoImageToModel:true});
    expect(generationCapabilities(env()).aholoTextToModel).toBe(false);
    expect(generationCapabilities(env({...baseEnv,LUX3D_API_KEY:''})).aholoImageToModel).toBe(false);
  });
  it('accepts an explicit provider declaration and pins lux3d on the job',async()=>{
    expect(generationRequestSchema.safeParse({requestId:crypto.randomUUID(),prompt:'vase',provider:'aholo'}).success).toBe(true);
    expect(generationRequestSchema.safeParse({requestId:crypto.randomUUID(),prompt:'vase',provider:'hy3d'}).success).toBe(false);
    const input={requestId:crypto.randomUUID(),prompt:'vase',provider:'aholo' as const};
    await expect(prepareGenerationRequest(f.backend,owner,input,env())).rejects.toMatchObject({code:'SERVICE_NOT_CONFIGURED',status:503,details:{setting:'LUX3D_API_KEY',lane:'aholo'}});
    const prepared=await prepareGenerationRequest(f.backend,owner,input,env(baseEnv));
    expect(prepared).toMatchObject({providerMode:'aholo',providerModel:'lux3d',fingerprint:expect.any(String)});
    const job=await f.jobs(owner,'jobs.create',{...prepared,reserveCents:100});
    expect(job).toMatchObject({kind:'text',provider_mode:'aholo',provider_model:'lux3d'});
    // Provider identity is pinned: later config changes must not re-vendor an old job.
    await expect(f.jobs(owner,'jobs.create',{...await prepareGenerationRequest(f.backend,owner,{...input,provider:undefined},env(baseEnv)),reserveCents:100})).resolves.toMatchObject({reused:true});
  });
  it('keeps the default cloud lane on HY-3D even when aholo is configured',async()=>{
    const prepared=await prepareGenerationRequest(f.backend,owner,{requestId:crypto.randomUUID(),prompt:'vase'},env(baseEnv));
    expect(prepared).toMatchObject({providerMode:'tokenhub',providerModel:'hy-3d-3.0'});
  });
  it('submits text/image tasks to the Lux3D endpoints and unwraps the c/d shell',async()=>{
    const network=vi.fn(async(url, init?)=>{
      expect(String(url)).toBe('https://api.aholo.ai/global/lux3d/v1/generate/text-to-3d/task/create');
      expect(init?.headers).toMatchObject({Authorization:'lux-key'});
      expect(JSON.parse(init?.body as string)).toEqual({prompt:'白色圆桌',version:'G1',faceCount:30000,outputFormat:['zip','glb']});
      return shell(1256173);
    });
    await expect(aholoLux3d(env(baseEnv),network).submit('白色圆桌')).resolves.toEqual({JobId:'1256173'});
    expect(network).toHaveBeenCalledOnce();
  });
  it('maps task status and only keeps http(s) result files',async()=>{
    const network=vi.fn(async(url, init?)=>{
      expect(String(url)).toContain('/lux3d/v1/generate/task/get?taskid=42');
      if(!states.length) throw new Error('exhausted');
      return shell(states.shift());
    });
    const states=[
      {status:3,outputs:[{content:'NOT_REQUESTED'},{content:'https://cos.example.com/a/result.zip'},{content:'https://model.kujiale.com/b/textured.glb'}]},
      {status:4,outputs:[]},{status:6},{status:0,outputs:[]},
    ];
    await expect(aholoLux3d(env(baseEnv),network).query('42')).resolves.toMatchObject({Status:'DONE',ResultFile3Ds:[{Type:'zip'},{Type:'glb',Url:'https://model.kujiale.com/b/textured.glb'}]});
    states.length=0;states.push({status:4,outputs:[]});
    await expect(aholoLux3d(env(baseEnv),network).query('42')).resolves.toMatchObject({Status:'FAIL',ErrorCode:'PROVIDER_FAILED'});
    states.length=0;states.push({status:6});
    await expect(aholoLux3d(env(baseEnv),network).query('42')).resolves.toMatchObject({Status:'FAIL',ErrorCode:'PROVIDER_TASK_CANCELLED'});
    states.length=0;states.push({status:0});
    await expect(aholoLux3d(env(baseEnv),network).query('42')).resolves.toMatchObject({Status:'WAIT'});
  });
  it('rejects a non-zero shell as PROVIDER_REJECTED',async()=>{
    const network=vi.fn(async()=>shell(null,'-1'));
    await expect(aholoLux3d(env(baseEnv),network).submit('vase')).rejects.toMatchObject({code:'PROVIDER_REJECTED',status:502});
  });
  it('runs an aholo text job end to end: submit, poll, download from kujiale.com, archive',async()=>{
    const prepared=await prepareGenerationRequest(f.backend,owner,{requestId:crypto.randomUUID(),prompt:'白色圆桌',provider:'aholo' as const},env(baseEnv));
    const job=await f.jobs(owner,'jobs.create',{...prepared,reserveCents:100});
    const upload=vi.fn(async()=>{}),backend={...f.backend,upload};
    const network=vi.fn(async(url, init?)=>{
      if(String(url).endsWith('/task/create'))return shell(4423551);
      if(String(url).includes('/task/get'))return shell({status:3,outputs:[{content:'https://model.kujiale.com/x/textured.glb'}]});
      if(String(url)==='https://model.kujiale.com/x/textured.glb')return new Response(glb());
      throw new Error('unexpected '+String(url));
    });
    await processGeneration(backend,env(baseEnv),network);
    await f.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[job.id]);
    await processGeneration(backend,env(baseEnv),network);
    const result=await f.jobs(owner,'jobs.get',{id:job.id});
    expect(result.state).toBe('ready');
    expect(upload).toHaveBeenCalledTimes(1);
    const asset=await f.rpc(owner,'assets.get',{assetId:result.asset_id});
    expect(asset).toMatchObject({source:'aholo'});
    expect(result.generation).toMatchObject({version:1,lane:'aholo',providerMode:'aholo',providerModel:'lux3d',outputSha256:asset.sha256});
    expect(asset.metadata).toMatchObject({generation:{providerMode:'aholo',providerModel:'lux3d',kind:'text',lane:'aholo',
      recordVersion:1,inputHash:result.generation.inputHash,fingerprint:result.generation.fingerprint}});
  });
});
