import { beforeAll,afterAll,beforeEach,describe,it,expect } from 'vitest';
import { database,owner,editor,outsider,studio,scene,chair } from './fixtures.ts';
import { processGeneration } from '../supabase/functions/_shared/worker.ts';

describe('generation queue, idempotency, fencing and budget',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);
  afterAll(async()=>{await f?.db.close();});
  beforeEach(async()=>{await f.db.exec('delete from scene_private.generation_jobs;delete from scene_private.requests;update scene_private.budgets set committed_cents=0;');});
  const input=()=>({requestId:crypto.randomUUID(),fingerprint:'same-prompt',prompt:'Low-poly prop',reserveCents:100});
  it('returns same internal task and reserves only once',async()=>{
    const i=input(),a=await f.jobs(owner,'jobs.create',i),b=await f.jobs(owner,'jobs.create',i);expect(b.id).toBe(a.id);expect(b.reused).toBe(true);
    expect((await f.db.query<{committed_cents:number}>("select committed_cents from scene_private.budgets where kind='generation'")).rows[0].committed_cents).toBe('100');
    await expect(f.jobs(owner,'jobs.create',{...i,fingerprint:'changed'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('scopes task reads to owner and denies outsiders',async()=>{
    const j=await f.jobs(owner,'jobs.create',input());
    await expect(f.jobs(editor,'jobs.get',{id:j.id})).rejects.toThrow('JOB_NOT_FOUND');
    await expect(f.jobs(outsider,'jobs.create',input())).rejects.toThrow('FORBIDDEN');
  });
  it('allows only one active generation across all members',async()=>{
    const results=await Promise.allSettled([f.jobs(owner,'jobs.create',input()),f.jobs(editor,'jobs.create',input())]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await f.db.query('select * from scene_private.requests')).rows).toHaveLength(1);
  });
  it('allows spending beyond former category ceilings while requiring accounting',async()=>{
    await f.db.exec("update scene_private.budgets set committed_cents=2147483647");
    await expect(f.jobs(owner,'jobs.create',{...input(),reserveCents:15001})).resolves.toMatchObject({state:'queued'});
    await expect(f.jobs(owner,'reserve',{...input(),reserveCents:3001})).resolves.toMatchObject({state:'reserved'});
    await expect(f.jobs(owner,'jobs.create',{...input(),reserveCents:0})).rejects.toThrow('BILLING_NOT_CONFIGURED');
  });
  it('never requeues an ambiguous submission after crash',async()=>{
    const j=await f.jobs(owner,'jobs.create',input()),claim=await f.jobs(null,'jobs.claim');expect(claim.state).toBe('submitting');
    expect(await f.jobs(null,'jobs.claim')).toBeNull();
    await f.db.query("update scene_private.generation_jobs set worker_until=now()-interval '1 second' where id=$1",[j.id]);
    expect(await f.jobs(null,'jobs.claim')).toBeNull();
    expect((await f.jobs(owner,'jobs.get',{id:j.id})).state).toBe('submit_unknown');
    await expect(f.jobs(owner,'jobs.create',input())).rejects.toThrow('GENERATION_BUSY');
  });
  it('releases an ambiguous submission after the grace window instead of locking the queue',async()=>{
    const j=await f.jobs(owner,'jobs.create',input());
    await f.jobs(null,'jobs.claim');
    await f.db.query("update scene_private.generation_jobs set worker_until=now()-interval '1 second' where id=$1",[j.id]);
    expect(await f.jobs(null,'jobs.claim')).toBeNull();
    // Inside the window the ambiguity is still shown to the user and the fence stays taken.
    await f.db.query("update scene_private.generation_jobs set updated_at=now()-interval '9 minutes' where id=$1",[j.id]);
    expect(await f.jobs(null,'jobs.claim')).toBeNull();
    expect((await f.jobs(owner,'jobs.get',{id:j.id})).state).toBe('submit_unknown');
    await expect(f.jobs(owner,'jobs.create',input())).rejects.toThrow('GENERATION_BUSY');
    // Past the window the claim sweep fails it terminally: never a resubmit, but the fence frees up.
    await f.db.query("update scene_private.generation_jobs set updated_at=now()-interval '11 minutes' where id=$1",[j.id]);
    expect(await f.jobs(null,'jobs.claim')).toBeNull();
    const expired=await f.jobs(owner,'jobs.get',{id:j.id});
    expect(expired.state).toBe('failed');expect(expired.error_code).toBe('SUBMIT_RESULT_UNKNOWN_EXPIRED');
    expect((await f.db.query<{state:string}>('select state from scene_private.requests where id=$1',[j.id])).rows[0].state).toBe('failed');
    await expect(f.jobs(owner,'jobs.create',input())).resolves.toMatchObject({state:'queued'});
  });
  it('resolves one ambiguous submission on demand for its owner only',async()=>{
    const j=await f.jobs(owner,'jobs.create',input());
    await f.jobs(null,'jobs.claim');
    await f.db.query("update scene_private.generation_jobs set worker_until=now()-interval '1 second' where id=$1",[j.id]);
    await f.jobs(null,'jobs.claim');
    expect((await f.jobs(owner,'jobs.get',{id:j.id})).state).toBe('submit_unknown');
    await expect(f.jobs(editor,'jobs.resolve_unknown',{id:j.id})).rejects.toThrow('FORBIDDEN');
    const resolved=await f.jobs(owner,'jobs.resolve_unknown',{id:j.id});
    expect(resolved.state).toBe('failed');expect(resolved.error_code).toBe('SUBMIT_RESULT_UNKNOWN_CONFIRMED');
    await expect(f.jobs(owner,'jobs.resolve_unknown',{id:j.id})).rejects.toThrow('INVALID_JOB_TRANSITION');
    await expect(f.jobs(owner,'jobs.create',input())).resolves.toMatchObject({state:'queued'});
  });
  it('expires an old queued task before making a paid submission',async()=>{
    const j=await f.jobs(owner,'jobs.create',input());
    await f.db.query("update scene_private.generation_jobs set created_at=now()-interval '24 hours' where id=$1",[j.id]);
    let submissions=0;
    const fetcher:typeof fetch=async()=>{submissions++;return new Response(JSON.stringify({JobId:'unexpected-paid-task'}));};
    await processGeneration(f.backend,key=>key==='HUNYUAN_API_KEY'?'test-key':undefined,fetcher);
    expect(submissions).toBe(0);
    const expired=await f.jobs(owner,'jobs.get',{id:j.id});
    expect(expired.state).toBe('failed');expect(expired.error_code).toBe('PROVIDER_TASK_EXPIRED');
  });
  it('requires the current worker token and valid transitions',async()=>{
    const j=await f.jobs(owner,'jobs.create',input()),c=await f.jobs(null,'jobs.claim');
    await expect(f.jobs(null,'jobs.update',{id:j.id,workerToken:crypto.randomUUID(),state:'submitted',providerJobId:'x'})).rejects.toThrow('WORKER_CLAIM_LOST');
    await expect(f.jobs(null,'jobs.update',{id:j.id,workerToken:c.worker_token,state:'ready'})).rejects.toThrow('INVALID_JOB_TRANSITION');
    await f.jobs(null,'jobs.update',{id:j.id,workerToken:c.worker_token,state:'submitted',providerJobId:'provider-123'});
    await expect(f.jobs(null,'jobs.update',{id:j.id,workerToken:c.worker_token,state:'failed'})).rejects.toThrow('WORKER_CLAIM_LOST');
    expect((await f.jobs(owner,'jobs.get',{id:j.id})).provider_job_id).toBe('provider-123');
  });
  it('does not allow ready state before validated asset registration',async()=>{
    const j=await f.jobs(owner,'jobs.create',input()),c=await f.jobs(null,'jobs.claim');
    await f.jobs(null,'jobs.update',{id:j.id,workerToken:c.worker_token,state:'submitted',providerJobId:'provider-ready'});
    await f.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[j.id]);
    const q=await f.jobs(null,'jobs.claim');
    await f.jobs(null,'jobs.archive_start',{id:j.id,workerToken:q.worker_token});
    const asset={id:j.id,name:'Prop',source:'hunyuan',sourceId:'provider-ready',license:{},format:'glb',storagePath:`${j.id}.glb`,byteSize:100,sha256:'a'.repeat(64),metadata:{}};
    const done=await f.jobs(null,'jobs.complete',{id:j.id,workerToken:q.worker_token,asset,usage:{credits:20}});
    expect(done.state).toBe('ready');expect((await f.rpc(owner,'assets.get',{assetId:j.id})).owner_id).toBe(owner);
    await expect(f.jobs(owner,'jobs.added',{id:j.id,projectId:crypto.randomUUID()})).rejects.toThrow('ASSET_NOT_IN_SAVED_SCENE');
  });
  it('marks a saved asset only for its job owner in a project they belong to',async()=>{
    const job=await f.jobs(owner,'jobs.create',input()),assetId=crypto.randomUUID();
    await f.rpc(owner,'assets.register',{id:assetId,name:'Fixture asset',source:'hunyuan',license:{},format:'glb',storagePath:`${assetId}.glb`,byteSize:100,sha256:'a'.repeat(64),metadata:{}});
    await f.db.query("update scene_private.generation_jobs set state='ready',asset_id=$2 where id=$1",[job.id,assetId]);
    const withAsset=scene();withAsset.objects.push({...chair(),materialId:'asset',assetId});
    const target=await f.rpc(owner,'projects.create',{studioId:studio,name:'Saved asset target',scene:withAsset});
    const without=await f.rpc(owner,'projects.create',{studioId:studio,name:'No saved asset',scene:scene()});
    const otherStudio=crypto.randomUUID();
    await f.db.query('insert into scene_private.studios(id,name) values($1,$2)',[otherStudio,'Other fixture']);
    await f.db.query("insert into scene_private.members values($1,$2,'owner','Owner')",[otherStudio,owner]);
    const formerMemberProject=await f.rpc(owner,'projects.create',{studioId:otherStudio,name:'Former member',scene:withAsset});
    await f.db.query('delete from scene_private.members where studio_id=$1 and user_id=$2',[otherStudio,owner]);
    await expect(f.jobs(outsider,'jobs.added',{id:job.id,projectId:target.id})).rejects.toThrow('ASSET_NOT_IN_SAVED_SCENE');
    await expect(f.jobs(editor,'jobs.added',{id:job.id,projectId:target.id})).rejects.toThrow('ASSET_NOT_IN_SAVED_SCENE');
    await expect(f.jobs(owner,'jobs.added',{id:job.id,projectId:without.id})).rejects.toThrow('ASSET_NOT_IN_SAVED_SCENE');
    await expect(f.jobs(owner,'jobs.added',{id:job.id,projectId:formerMemberProject.id})).rejects.toThrow('ASSET_NOT_IN_SAVED_SCENE');
    expect((await f.jobs(owner,'jobs.get',{id:job.id})).state).toBe('ready');
    expect((await f.jobs(owner,'jobs.added',{id:job.id,projectId:target.id})).state).toBe('added');
  });
  it('persists text usage and replay result without another reservation',async()=>{
    const i=input(),r=await f.jobs(owner,'reserve',i);
    await f.jobs(owner,'requests.finish',{id:r.id,state:'complete',result:{proposal:'x'},usage:{tokens:42}});
    const replay=await f.jobs(owner,'reserve',i);expect(replay.result).toEqual({proposal:'x'});expect(replay.provider_usage).toEqual({tokens:42});
  });
});
