import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,outsider} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {briefRequestFingerprint,runGuardedBriefDraft} from '../supabase/functions/_shared/brief-guard-draft.ts';

describe('default-off brief guard draft',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30_000);afterAll(async()=>{await f?.db.close();});
 const prepared={url:'https://fixture.invalid/v1/chat/completions',body:'{"message":"synthetic"}',accountRef:'fixture-account',credentialVersion:'v1',headers:{'content-type':'application/json'}};
 const requestId='c0000000-0000-4000-8000-000000000001';
 const store={call:async(action:string,id:string,fingerprint:string)=>{
   const q=await f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<{value:{state:string;created:boolean;dispatch:boolean}}>('select public.brief_request_guard_rpc($1,$2,$3::jsonb) value',[owner,action,JSON.stringify({requestId:id,fingerprint})]);});return q.rows[0].value;
 }};
 it('preserves old clients with guard off and closes the old endpoint before any provider call when configured on',async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{}'}}]}));
  const request=()=>new Request('https://example.invalid/brief/extract',{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({message:'合成活动'})});
  const off=createApi(f.backend,key=>key==='TOKENDANCE_API_KEY'?'fixture-only':undefined,fetcher);
  expect((await off(request())).status).toBe(200);expect(fetcher).toHaveBeenCalledTimes(1);
  const on=createApi(f.backend,key=>key==='BRIEF_REQUEST_GUARD'?'enforce':key==='TOKENDANCE_API_KEY'?'fixture-only':undefined,fetcher);
  const blocked=await on(request());expect(blocked.status).toBe(503);expect(await blocked.json()).toMatchObject({error:{code:'BRIEF_GUARD_NOT_READY'}});expect(fetcher).toHaveBeenCalledTimes(1);
  const withId=new Request('https://example.invalid/brief/extract',{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify({message:'合成活动',requestId})});
  expect((await on(withId)).status).toBe(503);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('allows only one dispatched call for the same committed request and preserves unknown state',async()=>{
  let calls=0;const input={requestId,prepared,store,send:async()=>{calls++;throw new Error('timeout');}};
  expect(await runGuardedBriefDraft(input)).toEqual({state:'unknown'});
  expect(await runGuardedBriefDraft(input)).toEqual({state:'not_dispatched'});expect(calls).toBe(1);
  await expect(store.call('reserve',requestId,await briefRequestFingerprint({...prepared,body:'different'}))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 });
 it('blocks another request for the same actor while allowing a different actor and denies authenticated direct RPC',async()=>{
  await expect(store.call('reserve','c0000000-0000-4000-8000-000000000002','a'.repeat(64))).rejects.toThrow('BRIEF_BUSY');
  const other=await f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<{value:{created:boolean}}>('select public.brief_request_guard_rpc($1,$2,$3::jsonb) value',[outsider,'reserve',JSON.stringify({requestId,fingerprint:'a'.repeat(64)})]);});
  expect(other.rows[0].value.created).toBe(true);
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role authenticated');return tx.query('select public.brief_request_guard_rpc($1,$2,$3::jsonb)',[owner,'reserve',JSON.stringify({requestId,fingerprint:'a'.repeat(64)})]);})).rejects.toThrow(/permission denied/i);
 });
 it('applies a per-actor rate cap without charging retries as new requests',async()=>{
  const actor='10000000-0000-4000-8000-000000000004';await f.db.query('insert into auth.users(id) values ($1)',[actor]);
  const call=async(action:string,id:string)=>f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query('select public.brief_request_guard_rpc($1,$2,$3::jsonb)',[actor,action,JSON.stringify({requestId:id,fingerprint:'a'.repeat(64)})]);});
  const id=(i:number)=>`d0000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
  for(let i=0;i<5;i++){await call('reserve',id(i));await call('cancel_before_dispatch',id(i));}
  await call('reserve',id(0));await expect(call('reserve',id(5))).rejects.toThrow('BRIEF_RATE_LIMIT');
 });
 it('keeps dispatch fenced when the provider ignores cancellation or the status write fails',async()=>{
  const actor='10000000-0000-4000-8000-000000000005';await f.db.query('insert into auth.users(id) values ($1)',[actor]);
  let offline=false,sent!:()=>void,calls=0;const started=new Promise<void>(resolve=>{sent=resolve;});
  const guardedStore={call:async(action:string,id:string,fingerprint:string)=>{
    if(offline&&(action==='complete'||action==='unknown'))throw new Error('connection lost');
    const q=await f.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<{value:{state:string;created:boolean;dispatch:boolean}}>('select public.brief_request_guard_rpc($1,$2,$3::jsonb) value',[actor,action,JSON.stringify({requestId:id,fingerprint})]);});return q.rows[0].value;
  }};
  const abort=new AbortController(),id='c0000000-0000-4000-8000-000000000005';
  const input={requestId:id,prepared,store:guardedStore,signal:abort.signal,send:async()=>{calls++;sent();return new Promise(()=>{});}};
  const pending=runGuardedBriefDraft(input);await started;offline=true;abort.abort();expect(await pending).toEqual({state:'unknown'});
  offline=false;const state=await guardedStore.call('get',id,await briefRequestFingerprint(prepared));expect(state.state).toBe('dispatched');
  const {signal:_signal,...retry}=input;void _signal;
  expect(await runGuardedBriefDraft(retry)).toEqual({state:'not_dispatched'});expect(calls).toBe(1);
 });
});
