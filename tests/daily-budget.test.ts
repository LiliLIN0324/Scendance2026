import { beforeAll,afterAll,beforeEach,describe,it,expect } from 'vitest';
import { database,owner,editor,outsider } from './fixtures.ts';

describe('DeepSeek global daily budget',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{f=await database();},30000);
  afterAll(async()=>{await f?.db.close();});
  beforeEach(async()=>{
    await f.db.exec("delete from scene_private.requests;update scene_private.budgets set committed_cents=0;do $$ begin if to_regclass('scene_private.text_daily_budgets') is not null then delete from scene_private.text_daily_budgets; end if; end $$;");
  });
  const request=(actor=owner)=>f.jobs(actor,'reserve',{requestId:crypto.randomUUID(),fingerprint:'daily-test',reserveCents:40});
  const reserve=(id:string,attempt=0,actor=owner)=>f.jobs(actor,'text.reserve_call',{id,attempt});
  it('charges initial and repair calls once, and refuses repeat dispatch',async()=>{
    const r=await request();
    expect(await reserve(r.id)).toMatchObject({reservedCents:20,limitCents:1000,committedCents:20});
    await expect(reserve(r.id)).rejects.toThrow('AI_CALL_ALREADY_RESERVED');
    expect(await reserve(r.id,1)).toMatchObject({committedCents:40});
    await expect(reserve(r.id,2)).rejects.toThrow('INVALID_AI_ATTEMPT');
  });
  it('atomically caps all members together, before dispatch',async()=>{
    await f.db.exec("insert into scene_private.text_daily_budgets(usage_day,committed_cents) values((clock_timestamp() at time zone 'Asia/Shanghai')::date,980)");
    const a=await request(),b=await request(editor);
    const results=await Promise.allSettled([reserve(a.id),reserve(b.id,0,editor)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected').map(r=>(r as PromiseRejectedResult).reason.message)).toEqual(['DAILY_BUDGET_EXCEEDED']);
    expect((await f.db.query<{committed_cents:number}>('select committed_cents from scene_private.text_daily_budgets')).rows[0].committed_cents).toBe(1000);
    expect((await f.db.query('select * from scene_private.text_provider_calls')).rows).toHaveLength(1);
  });
  it('keeps failed or unknown call reservations and prevents calling finished requests',async()=>{
    const r=await request();await reserve(r.id);
    await f.jobs(owner,'requests.finish',{id:r.id,state:'failed'});
    await expect(reserve(r.id,1)).rejects.toThrow('REQUEST_NOT_FOUND');
    expect((await f.db.query<{committed_cents:number}>('select committed_cents from scene_private.text_daily_budgets')).rows[0].committed_cents).toBe(20);
  });
  it('uses a new Beijing day independently of a full previous day',async()=>{
    await f.db.exec("set timezone='America/Los_Angeles';insert into scene_private.text_daily_budgets(usage_day,committed_cents) values((clock_timestamp() at time zone 'Asia/Shanghai')::date-1,1000)");
    const r=await request(),day=await f.db.query<{day:string}>("select to_char(clock_timestamp() at time zone 'Asia/Shanghai','YYYY-MM-DD') as day");
    expect(await reserve(r.id)).toMatchObject({usageDay:day.rows[0].day,committedCents:20});
  });
  it('rejects another actor and does not expose budget tables to browser roles',async()=>{
    const r=await request();await expect(reserve(r.id,0,outsider)).rejects.toThrow('REQUEST_NOT_FOUND');
    for(const role of ['anon','authenticated']) {
      await expect(f.db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query('select * from scene_private.text_daily_budgets');})).rejects.toThrow();
    }
  });
});
