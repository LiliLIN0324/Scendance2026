import { beforeAll,afterAll,beforeEach,describe,it,expect } from 'vitest';
import { database,owner,editor,outsider } from './fixtures.ts';

describe('generation queue, idempotency, fencing and budget',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);
  afterAll(async()=>{await f?.db.close();});
  beforeEach(async()=>{await f.db.exec('delete from scene_private.generation_jobs;delete from scene_private.requests;update scene_private.budgets set committed_cents=0;');});
  const input=()=>({requestId:crypto.randomUUID(),fingerprint:'same-prompt',prompt:'Low-poly prop',reserveCents:100});
  it('returns same internal task and reserves only once',async()=>{
    const i=input(),a=await f.jobs(owner,'jobs.create',i),b=await f.jobs(owner,'jobs.create',i);expect(b.id).toBe(a.id);expect(b.reused).toBe(true);
    expect((await f.db.query<{committed_cents:number}>("select committed_cents from scene_private.budgets where kind='generation'")).rows[0].committed_cents).toBe(100);
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
  it('enforces hard category ceilings before dispatch',async()=>{
    await expect(f.jobs(owner,'jobs.create',{...input(),reserveCents:15001})).rejects.toThrow('BUDGET_EXCEEDED');
    await expect(f.jobs(owner,'reserve',{...input(),reserveCents:3001})).rejects.toThrow('BUDGET_EXCEEDED');
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
  it('persists text usage and replay result without another reservation',async()=>{
    const i=input(),r=await f.jobs(owner,'reserve',i);
    await f.jobs(owner,'requests.finish',{id:r.id,state:'complete',result:{proposal:'x'},usage:{tokens:42}});
    const replay=await f.jobs(owner,'reserve',i);expect(replay.result).toEqual({proposal:'x'});expect(replay.provider_usage).toEqual({tokens:42});
  });
});
