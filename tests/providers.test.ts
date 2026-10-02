import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { database,owner,scene,session } from './fixtures.ts';
import { generateProposal,hunyuan } from '../supabase/functions/_shared/providers.ts';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';
import { packGltf } from '../supabase/functions/_shared/models.ts';
import { tetrahedron } from './model-fixture.ts';
import type { Env,Fetcher } from '../supabase/functions/_shared/http.ts';
const env:Env=key=>({HUNYUAN_API_MODE:'legacy',HUNYUAN_API_KEY:'test-key',DEEPSEEK_API_KEY:'test-key',HUNYUAN_TERMS_URL:'https://example.test/terms',HUNYUAN_TERMS_REVIEWED_AT:'2026-10-02'}[key]);
const response=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});

describe('real provider request formats with controlled responses',()=>{
  it('uses documented Hunyuan header, 3.0 LowPoly and async JobId',async()=>{
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{expect(init?.headers).toMatchObject({Authorization:'test-key'});expect(JSON.parse(init?.body as string)).toMatchObject({Model:'3.0',GenerateType:'LowPoly'});return response({Response:{JobId:'job-1'}});}) as unknown as Fetcher;
    expect((await hunyuan(env,fetcher).submit('Prop')).JobId).toBe('job-1');
  });
  it('defaults to TokenHub with Bearer auth and the documented LowPoly fields',async()=>{
    const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{
      expect(url).toBe('https://tokenhub.tencentmaas.com/v1/api/3d/submit');
      expect(init?.headers).toMatchObject({Authorization:'Bearer test-key'});
      expect(JSON.parse(init?.body as string)).toEqual({model:'hy-3d-3.0',prompt:'Prop',generate_type:'LowPoly',polygon_type:'triangle'});
      return response({id:'tokenhub-1',request_id:'request-1',object:'3d_job',status:'queued'});
    });
    expect(await hunyuan(key=>key==='HUNYUAN_API_MODE'?undefined:env(key),fetcher).submit('Prop')).toEqual({JobId:'tokenhub-1',RequestId:'request-1'});
  });
  it.each([['queued','WAIT'],['in_progress','RUN'],['failed','FAIL'],['completed','DONE']])('maps TokenHub %s without inventing credit usage',async(status,normalized)=>{
    const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{
      expect(url).toBe('https://tokenhub.tencentmaas.com/v1/api/3d/query');
      expect(JSON.parse(init?.body as string)).toEqual({model:'hy-3d-3.0',id:'tokenhub-1'});
      return response({status,request_id:'query-1',data:status==='completed'?[{type:'glb',url:'https://a.myqcloud.com/prop.glb',preview_image_url:'https://a.myqcloud.com/prop.png'}]:[]});
    });
    const result=await hunyuan(key=>key==='HUNYUAN_API_MODE'?'tokenhub':env(key),fetcher).query('tokenhub-1');
    expect(result.Status).toBe(normalized);expect(result.RequestId).toBe('query-1');expect(result.ResultCreditConsumed).toBeUndefined();
    if(status==='completed') expect(result.ResultFile3Ds?.[0]).toMatchObject({Type:'glb',Url:'https://a.myqcloud.com/prop.glb'});
  });
  it('never falls back to a second paid endpoint after an incompatible TokenHub response',async()=>{
    const fetcher=vi.fn(async()=>response({JobId:'legacy-shape'}));
    await expect(hunyuan(key=>key==='HUNYUAN_API_MODE'?'tokenhub':env(key),fetcher).submit('Prop')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects an unknown provider mode before making a request',()=>{
    const fetcher=vi.fn();
    expect(()=>hunyuan(key=>key==='HUNYUAN_API_MODE'?'typo':env(key),fetcher)).toThrow('SERVICE_NOT_CONFIGURED');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('never dispatches a provider call when the daily reservation fails',async()=>{
    const input={projectId:crypto.randomUUID(),requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),instruction:'Move',mode:'modify' as const,selectedIds:[]};
    const fetcher=vi.fn(async()=>response({}));
    const deny=async()=>{throw new Error('DAILY_BUDGET_EXCEEDED');};
    await expect(generateProposal(input,env,deny,fetcher)).rejects.toThrow('DAILY_BUDGET_EXCEEDED');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reserves again before repair and bounds input before reserving',async()=>{
    const input={projectId:crypto.randomUUID(),requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),instruction:'Move',mode:'modify' as const,selectedIds:[]};
    const fetcher=vi.fn(async()=>response({choices:[{finish_reason:'stop',message:{content:'invalid'}}]}));
    const reserve=vi.fn(async(attempt:number)=>{if(attempt===1)throw new Error('DAILY_BUDGET_EXCEEDED');});
    await expect(generateProposal(input,env,reserve,fetcher)).rejects.toThrow('DAILY_BUDGET_EXCEEDED');
    expect(fetcher).toHaveBeenCalledTimes(1);expect(reserve.mock.calls).toEqual([[0],[1]]);
    const noReserve=vi.fn(async()=>{});
    await expect(generateProposal({...input,instruction:'中'.repeat(30_000)},env,noReserve,fetcher)).rejects.toThrow('AI_INPUT_TOO_LARGE');
    expect(noReserve).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('makes at most one AI repair request and validates repaired operations',async()=>{
    const bodies:Record<string,unknown>[]=[];
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      bodies.push(JSON.parse(init?.body as string));
      return response({choices:[{finish_reason:'stop',message:{content:bodies.length===1?'invalid JSON':JSON.stringify({explanation:'No changes',commands:[]})}}],usage:{total_tokens:10}});
    }) as unknown as Fetcher;
    const input={projectId:crypto.randomUUID(),requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),instruction:'Move',mode:'modify' as const,selectedIds:[]};
    const proposal=await generateProposal(input,env,async()=>{},fetcher);expect(proposal.usage).toHaveLength(2);expect(bodies[0]).toMatchObject({model:'deepseek-flash',response_format:{type:'json_object'}});
    const bad=vi.fn(async()=>response({choices:[{finish_reason:'stop',message:{content:'{}'}}]}));
    await expect(generateProposal(input,env,async()=>{},bad)).rejects.toThrow('AI_INVALID_PROPOSAL');expect(bad).toHaveBeenCalledTimes(2);
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
  it.each(['legacy','tokenhub'])('archives an actual valid %s GLB and only then marks ready',async mode=>{
    const j=await create(),fixture=tetrahedron(),bytes=packGltf(fixture.json,fixture.resources);
    const network=vi.fn(async(url:unknown)=>{
      if(String(url).endsWith('/submit')) return response(mode==='legacy'?{JobId:'generated-1'}:{id:'generated-1'});
      if(String(url).endsWith('/query')) return response(mode==='legacy'?{Status:'DONE',ResultFile3Ds:[{Type:'GLB',Url:'https://assets.myqcloud.com/prop.glb'}],ResultCreditConsumed:20}:{status:'completed',data:[{type:'glb',url:'https://assets.myqcloud.com/prop.glb'}]});
      return new Response(new Uint8Array(bytes));
    });
    const upload=vi.fn(f.backend.upload);f.backend.upload=upload;
    const providerEnv:Env=key=>key==='HUNYUAN_API_MODE'?mode:env(key);
    await processGeneration(f.backend,providerEnv,network);
    await f.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[j.id]);
    await processGeneration(f.backend,providerEnv,network);
    const task=await f.jobs(owner,'jobs.get',{id:j.id});expect(task.state).toBe('ready');expect(task.asset_id).toBe(j.id);expect(upload).toHaveBeenCalledTimes(1);
    expect((await f.rpc(owner,'assets.get',{assetId:j.id})).metadata.triangles).toBe(4);
  });
  it('rejects malformed provider output without registering a substitute asset',async()=>{
    const j=await create();const network=async(url:unknown)=>String(url).endsWith('/submit')?response({JobId:'bad-model'}):String(url).endsWith('/query')?response({Status:'DONE',ResultFile3Ds:[{Type:'GLB',Url:'https://a.myqcloud.com/bad.glb'}]}):new Response(new Uint8Array(100));
    await processGeneration(f.backend,env,network);await f.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[j.id]);await processGeneration(f.backend,env,network);
    const result=await f.jobs(owner,'jobs.get',{id:j.id});expect(result.state).toBe('rejected');expect(result.asset_id).toBeNull();
  });
});
