import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,editor,owner,outsider} from './fixtures.ts';
import {prototypeBriefFingerprint} from './fixtures/brief-request-fingerprint.prototype.ts';
import {runPrototypeBrief} from './fixtures/brief-orchestrator.prototype.ts';

describe('isolated brief request guard prototype (not wired to any endpoint)',()=>{
 let fixture:Awaited<ReturnType<typeof database>>;
 const fingerprint='a'.repeat(64), id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 beforeAll(async()=>{fixture=await database();await fixture.db.exec(readFileSync(new URL('./fixtures/brief-request-guard.prototype.sql',import.meta.url),'utf8'));},30_000);
 afterAll(async()=>{await fixture?.db.close();});
 async function call(actor:string,action:string,request:string,hash=fingerprint){
  const result=await fixture.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<{result:{state:string;created:boolean;dispatch:boolean}}>('select public.brief_guard_prototype($1,$2,$3,$4) as result',[actor,action,request,hash]);});
  return result.rows[0].result;
 }
 it('binds the exact serialized payload, endpoint, account and credential version without storing them',async()=>{
  const input={url:'https://provider.example/v1/chat/completions',body:'{"messages":["private"]}',accountRef:'test-account',credentialVersion:'v1',headers:{'content-type':'application/json'}};
  const original=await prototypeBriefFingerprint(input);
  for(const changed of [{...input,body:input.body+' '},{...input,url:'https://other.example/v1'}, {...input,accountRef:'other'}, {...input,credentialVersion:'v2'}])expect(await prototypeBriefFingerprint(changed)).not.toBe(original);
  await expect(prototypeBriefFingerprint({...input,headers:{authorization:'do-not-store'}})).rejects.toThrow('INVALID_PROVIDER_CONFIG');
 });
 it('enforces exact request identity, single dispatch and keeps unknown fenced',async()=>{
  const request=id(1);expect(await call(owner,'reserve',request)).toMatchObject({state:'reserved',created:true});
  expect(await call(owner,'reserve',request)).toMatchObject({state:'reserved',created:false});
  await expect(call(owner,'reserve',request,'b'.repeat(64))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  await expect(call(owner,'reserve',id(2))).rejects.toThrow('BRIEF_BUSY');
  expect(await call(owner,'dispatch',request)).toMatchObject({state:'dispatched',dispatch:true});
  expect(await call(owner,'dispatch',request)).toMatchObject({state:'dispatched',dispatch:false});
  expect(await call(owner,'unknown',request)).toMatchObject({state:'unknown'});
  expect(await call(owner,'dispatch',request)).toMatchObject({state:'unknown',dispatch:false});
  await expect(call(owner,'reserve',id(3))).rejects.toThrow('BRIEF_BUSY');
  expect(await call(editor,'reserve',id(1))).toMatchObject({created:true});
 });
 it('limits fresh request starts per actor without counting duplicate re-reads as new',async()=>{
  for(let n=10;n<15;n++){const request=id(n);await call(outsider,'reserve',request);await call(outsider,'cancel_before_dispatch',request);}
  expect(await call(outsider,'reserve',id(10))).toMatchObject({state:'cancelled',created:false});
  await expect(call(outsider,'reserve',id(15))).rejects.toThrow('BRIEF_RATE_LIMIT');
 });
 it('rejects direct anonymous use of the prototype function',async()=>{
  await expect(fixture.db.transaction(async tx=>{await tx.exec('set local role authenticated');return tx.query('select public.brief_guard_prototype($1,$2,$3,$4)',[owner,'reserve',id(22),fingerprint]);})).rejects.toThrow(/permission denied/i);
 });
 it('records an unknown provider outcome and never resends the same request',async()=>{
  const actor='10000000-0000-4000-8000-000000000004';await fixture.db.query('insert into auth.users(id) values ($1)',[actor]);
  let sends=0;const store={call:(action:'reserve'|'dispatch'|'complete'|'unknown'|'cancel_before_dispatch',request:string,hash:string)=>call(actor,action,request,hash)};
  const prepared={url:'https://provider.example/v1',body:'{}',accountRef:'fixture',credentialVersion:'v1',headers:{'content-type':'application/json'}};
  const input={requestId:id(33),prepared,store,send:async()=>{sends++;throw new Error('network uncertain');}};
  expect(await runPrototypeBrief(input)).toEqual({state:'unknown'});expect(await runPrototypeBrief(input)).toEqual({state:'not_dispatched'});expect(sends).toBe(1);
 });
 it('marks unknown when a cancelled provider ignores abort and never returns',async()=>{
  const actor='10000000-0000-4000-8000-000000000005';await fixture.db.query('insert into auth.users(id) values ($1)',[actor]);
  const store={call:(action:'reserve'|'dispatch'|'complete'|'unknown'|'cancel_before_dispatch',request:string,hash:string)=>call(actor,action,request,hash)};
  const prepared={url:'https://provider.example/v1',body:'{}',accountRef:'fixture',credentialVersion:'v1',headers:{'content-type':'application/json'}};
  const abort=new AbortController();let reached!:()=>void;const sent=new Promise<void>(resolve=>{reached=resolve;});
  const pending=runPrototypeBrief({requestId:id(34),prepared,store,signal:abort.signal,send:async()=>{reached();return new Promise(()=>{});}});
  await sent;abort.abort();expect(await pending).toEqual({state:'unknown'});
  expect(await call(actor,'get',id(34),await prototypeBriefFingerprint(prepared))).toMatchObject({state:'unknown'});
 });
 it('keeps dispatched fenced if the database disconnects after provider execution',async()=>{
  const actor='10000000-0000-4000-8000-000000000006';await fixture.db.query('insert into auth.users(id) values ($1)',[actor]);
  let failFinish=true,sends=0;const store={call:(action:'reserve'|'dispatch'|'complete'|'unknown'|'cancel_before_dispatch',request:string,hash:string)=>{
    if(failFinish&&(action==='complete'||action==='unknown'))return Promise.reject(new Error('connection lost'));return call(actor,action,request,hash);
  }};
  const prepared={url:'https://provider.example/v1',body:'{}',accountRef:'fixture',credentialVersion:'v1',headers:{'content-type':'application/json'}};
  const input={requestId:id(35),prepared,store,send:async()=>{sends++;return {ok:true};}};
  expect(await runPrototypeBrief(input)).toEqual({state:'unknown'});failFinish=false;
  expect(await call(actor,'get',id(35),await prototypeBriefFingerprint(prepared))).toMatchObject({state:'dispatched'});
  expect(await runPrototypeBrief(input)).toEqual({state:'not_dispatched'});expect(sends).toBe(1);
 });
});
