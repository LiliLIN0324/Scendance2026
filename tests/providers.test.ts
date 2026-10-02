import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { database,owner,scene,session } from './fixtures.ts';
import { generateProposal,hunyuan } from '../supabase/functions/_shared/providers.ts';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';
import { packGltf } from '../supabase/functions/_shared/models.ts';
import { tetrahedron } from './model-fixture.ts';
import type { Env,Fetcher } from '../supabase/functions/_shared/http.ts';
const env:Env=key=>({HUNYUAN_API_KEY:'test-key',DEEPSEEK_API_KEY:'test-key',HUNYUAN_TERMS_URL:'https://example.test/terms',HUNYUAN_TERMS_REVIEWED_AT:'2026-10-02'}[key]);
const response=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});

describe('real provider request formats with controlled responses',()=>{
  it('uses documented Hunyuan header, 3.0 LowPoly and async JobId',async()=>{
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{expect(init?.headers).toMatchObject({Authorization:'test-key'});expect(JSON.parse(init?.body as string)).toMatchObject({Model:'3.0',GenerateType:'LowPoly'});return response({Response:{JobId:'job-1'}});}) as unknown as Fetcher;
    expect((await hunyuan(env,fetcher).submit('Prop')).JobId).toBe('job-1');
  });
  it('makes at most one AI repair request and validates repaired operations',async()=>{
    const bodies:Record<string,unknown>[]=[];
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      bodies.push(JSON.parse(init?.body as string));
      return response({choices:[{finish_reason:'stop',message:{content:bodies.length===1?'invalid JSON':JSON.stringify({explanation:'No changes',commands:[]})}}],usage:{total_tokens:10}});
    }) as unknown as Fetcher;
    const input={projectId:crypto.randomUUID(),requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),instruction:'Move',mode:'modify' as const,selectedIds:[]};
    const proposal=await generateProposal(input,env,fetcher);expect(proposal.usage).toHaveLength(2);expect(bodies[0]).toMatchObject({model:'deepseek-flash',response_format:{type:'json_object'}});
    const bad=vi.fn(async()=>response({choices:[{finish_reason:'stop',message:{content:'{}'}}]}));
    await expect(generateProposal(input,env,bad)).rejects.toThrow('AI_INVALID_PROPOSAL');expect(bad).toHaveBeenCalledTimes(2);
  });
});
describe('worker recovery against PostgreSQL queue',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f?.db.close();});
  beforeEach(async()=>{await f.db.exec('delete from scene_private.generation_jobs;delete from scene_private.requests;update scene_private.budgets set committed_cents=0;');});
  async function create(){return f.jobs(owner,'jobs.create',{requestId:crypto.randomUUID(),fingerprint:'prop',prompt:'Prop',reserveCents:100});}
  it('submission timeout becomes unknown and never causes an automatic second submit',async()=>{
    const j=await create(),network=vi.fn(async()=>{throw new Error('timeout');});
    await processGeneration(f.backend,env,network);expect((await f.jobs(owner,'jobs.get',{id:j.id})).state).toBe('submit_unknown');
    await processGeneration(f.backend,env,network);expect(network).toHaveBeenCalledTimes(1);
  });
  it('archives an actual valid GLB and only then marks ready',async()=>{
    const j=await create(),fixture=tetrahedron(),bytes=packGltf(fixture.json,fixture.resources);
    const network=vi.fn(async(url:unknown)=>{
      if(String(url).endsWith('/submit')) return response({JobId:'generated-1'});
      if(String(url).endsWith('/query')) return response({Status:'DONE',ResultFile3Ds:[{Type:'GLB',Url:'https://assets.myqcloud.com/prop.glb'}],ResultCreditConsumed:20});
      return new Response(new Uint8Array(bytes));
    });
    const upload=vi.fn(f.backend.upload);f.backend.upload=upload;
    await processGeneration(f.backend,env,network);
    await f.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[j.id]);
    await processGeneration(f.backend,env,network);
    const task=await f.jobs(owner,'jobs.get',{id:j.id});expect(task.state).toBe('ready');expect(task.asset_id).toBe(j.id);expect(upload).toHaveBeenCalledTimes(1);
    expect((await f.rpc(owner,'assets.get',{assetId:j.id})).metadata.triangles).toBe(4);
  });
  it('rejects malformed provider output without registering a substitute asset',async()=>{
    const j=await create();const network=async(url:unknown)=>String(url).endsWith('/submit')?response({JobId:'bad-model'}):String(url).endsWith('/query')?response({Status:'DONE',ResultFile3Ds:[{Type:'GLB',Url:'https://a.myqcloud.com/bad.glb'}]}):new Response(new Uint8Array(100));
    await processGeneration(f.backend,env,network);await f.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[j.id]);await processGeneration(f.backend,env,network);
    const result=await f.jobs(owner,'jobs.get',{id:j.id});expect(result.state).toBe('rejected');expect(result.asset_id).toBeNull();
  });
});
