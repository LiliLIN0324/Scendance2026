import { beforeAll,afterAll,beforeEach,describe,it,expect } from 'vitest';
import { database,owner } from './fixtures.ts';
import { createWorker } from '../supabase/functions/_shared/worker-handler.ts';
import type { Env,Fetcher } from '../supabase/functions/_shared/http.ts';

const settings={GENERATION_WORKER_SECRET:'worker-test-secret',HUNYUAN_API_KEY:'provider-test-key',HUNYUAN_TERMS_URL:'https://example.test/terms',HUNYUAN_TERMS_REVIEWED_AT:'2026-10-02'};
const env=(overrides:Record<string,string|undefined>={}):Env=>key=>({...settings,...overrides})[key];
const request=(authorization='Bearer worker-test-secret',method='POST')=>new Request('https://worker.example/functions/v1/generation-worker',{method,headers:{authorization}});
const noNetwork:Fetcher=async()=>{throw new Error('Unexpected network access');};

describe('generation worker HTTP boundary',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f?.db.close();});
  beforeEach(async()=>{await f.db.exec('delete from scene_private.generation_jobs;delete from scene_private.requests;update scene_private.budgets set committed_cents=0;');});
  it('returns a non-cacheable JSON 503 when the worker secret is missing',async()=>{
    const response=await createWorker(f.backend,env({GENERATION_WORKER_SECRET:undefined}),noNetwork)(request());
    expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({error:'SERVICE_NOT_CONFIGURED'});
  });
  it.each(['','Bearer wrong-secret','worker-test-secret','Basic worker-test-secret','Bearer worker-test-secret extra'])('rejects invalid authentication without claiming work: %s',async authorization=>{
    const job=await f.jobs(owner,'jobs.create',{requestId:crypto.randomUUID(),fingerprint:'prop',prompt:'Prop',reserveCents:100});
    const response=await createWorker(f.backend,env(),noNetwork)(request(authorization));
    expect(response.status).toBe(401);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({error:'UNAUTHENTICATED'});
    expect((await f.jobs(owner,'jobs.get',{id:job.id})).state).toBe('queued');
  });
  it('returns a non-cacheable JSON 405 for unsupported methods before examining credentials',async()=>{
    const response=await createWorker(f.backend,env({GENERATION_WORKER_SECRET:undefined}),noNetwork)(request('','GET'));
    expect(response.status).toBe(405);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({error:'METHOD_NOT_ALLOWED'});
  });
  it.each([{HUNYUAN_API_KEY:undefined}])('returns 503 without claiming a job when provider credentials are missing: %j',async overrides=>{
    const job=await f.jobs(owner,'jobs.create',{requestId:crypto.randomUUID(),fingerprint:'prop',prompt:'Prop',reserveCents:100});
    const response=await createWorker(f.backend,env(overrides),noNetwork)(request());
    expect(response.status).toBe(503);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({error:'SERVICE_NOT_CONFIGURED'});
    expect((await f.jobs(owner,'jobs.get',{id:job.id})).state).toBe('queued');
  });
  it('processes a queued job with valid Bearer authentication and returns JSON for an idle queue',async()=>{
    const job=await f.jobs(owner,'jobs.create',{requestId:crypto.randomUUID(),fingerprint:'prop',prompt:'Prop',reserveCents:100});
    const fetcher:Fetcher=async()=>new Response(JSON.stringify({id:'provider-job-1'}));
    const handler=createWorker(f.backend,env(),fetcher);
    const response=await handler(request('bEaReR worker-test-secret'));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({processed:1});
    expect(await f.jobs(owner,'jobs.get',{id:job.id})).toMatchObject({state:'submitted',provider_job_id:'provider-job-1'});
    const idle=await handler(request());expect(idle.status).toBe(200);expect(await idle.json()).toEqual({processed:0});
  });
  it('returns a sanitized non-cacheable JSON 500 for unexpected backend errors',async()=>{
    const backend={...f.backend,jobs:async()=>{throw new Error('private-credential-must-not-leak');}};
    const response=await createWorker(backend,env(),noNetwork)(request());
    expect(response.status).toBe(500);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({error:'WORKER_FAILED'});
  });
});
