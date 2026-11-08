// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyVenueFacts, updateVenueFact } from './venue-facts';
import { initializeUnknownVenueFacts, readVenueFacts, writeVenueFacts } from './venue-facts-storage';

const scope='activity:sample';
const change=(value:number)=>({value,source:'user_statement' as const,status:'pending' as const,uncertainty:null,sourceRef:null,updatedBy:'小林',updatedAt:'2026-11-07T00:00:00.000Z'});
let tail:Promise<unknown>;
const locks={request(_name:string,_options:unknown,callback:()=>Promise<unknown>){const result=tail.then(callback);tail=result.catch(()=>{});return result;}} as unknown as LockManager;
beforeEach(()=>{localStorage.clear();tail=Promise.resolve();});
it('writes and reloads only the matching activity, rejecting old or concurrent updates',async()=>{
  const initial=emptyVenueFacts(scope),first=updateVenueFact(initial,'venue_width',change(12),0),other=updateVenueFact(initial,'venue_width',change(14),0);
  const outcomes=await Promise.allSettled([writeVenueFacts(scope,first,0,localStorage,locks),writeVenueFacts(scope,other,0,localStorage,locks)]);
  expect(outcomes.map(item=>item.status)).toEqual(['fulfilled','rejected']);
  const loaded=readVenueFacts(scope,localStorage);expect(loaded.status).toBe('ready');
  if(loaded.status==='ready')expect(loaded.value.facts.venue_width.value).toBe(12);
  expect(readVenueFacts('activity:other',localStorage).status).toBe('missing');
});
it('does not overwrite damaged data',async()=>{
  const key=`scendance:venue-facts:v1:${encodeURIComponent(scope)}`;
  localStorage.setItem(key,'{broken');
  expect(readVenueFacts(scope,localStorage).status).toBe('corrupt');
  const next=updateVenueFact(emptyVenueFacts(scope),'venue_width',change(12),0);
  await expect(writeVenueFacts(scope,next,0,localStorage,locks)).rejects.toThrow('未覆盖');
  expect(localStorage.getItem(key)).toBe('{broken');
});
it('does not accept an update that silently rewrites another earlier fact',async()=>{
  const first=updateVenueFact(emptyVenueFacts(scope),'venue_width',change(12),0);
  await writeVenueFacts(scope,first,0,localStorage,locks);
  const next=updateVenueFact(first,'venue_depth',change(9),1);
  const tampered=structuredClone(next);tampered.facts.venue_width.value=99;
  await expect(writeVenueFacts(scope,tampered,1,localStorage,locks)).rejects.toThrow('未保存');
  const loaded=readVenueFacts(scope,localStorage);expect(loaded.status).toBe('ready');if(loaded.status==='ready')expect(loaded.value.facts.venue_width.value).toBe(12);
});
it('notifies the current page only after a verified write, without carrying fact data',async()=>{
  const listener=vi.fn();window.addEventListener('scendance:venue-facts-changed',listener);
  try{
    const initial=emptyVenueFacts(scope),first=updateVenueFact(initial,'venue_width',change(12),0);
    await writeVenueFacts(scope,first,0,localStorage,locks);
    expect(listener).toHaveBeenCalledOnce();expect((listener.mock.calls[0]![0] as Event).type).toBe('scendance:venue-facts-changed');
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toBeUndefined();
    await expect(writeVenueFacts(scope,first,0,localStorage,locks)).rejects.toThrow();
    expect(listener).toHaveBeenCalledOnce();
  }finally{window.removeEventListener('scendance:venue-facts-changed',listener);}
});
it('explicitly initializes a missing activity as unknown and preserves existing facts',async()=>{
  const [first,second]=await Promise.all([initializeUnknownVenueFacts(scope,localStorage,locks),initializeUnknownVenueFacts(scope,localStorage,locks)]);
  expect([first.status,second.status]).toEqual(['created','existing']);
  expect(Object.values(first.value.facts).every(fact=>fact.status==='unknown'&&fact.value===null)).toBe(true);
  const edited=updateVenueFact(first.value,'venue_width',change(12),0);
  await writeVenueFacts(scope,edited,0,localStorage,locks);
  const existing=await initializeUnknownVenueFacts(scope,localStorage,locks);
  expect(existing.status).toBe('existing');expect(existing.value.facts.venue_width.value).toBe(12);
});
it('does not replace damaged records or write after the activity changes',async()=>{
  const key=`scendance:venue-facts:v1:${encodeURIComponent(scope)}`;
  localStorage.setItem(key,'{broken');
  await expect(initializeUnknownVenueFacts(scope,localStorage,locks)).rejects.toThrow('未覆盖');
  expect(localStorage.getItem(key)).toBe('{broken');
  localStorage.removeItem(key);
  let calls=0;
  await expect(initializeUnknownVenueFacts(scope,localStorage,locks,()=>++calls<3)).rejects.toThrow('活动已变化');
  expect(localStorage.getItem(key)).toBeNull();
});
it('reports an already-saved unknown record if activity changes after the write',async()=>{
  let calls=0;
  await expect(initializeUnknownVenueFacts(scope,localStorage,locks,()=>++calls<4)).rejects.toThrow('已保存，但活动已变化');
  const result=readVenueFacts(scope,localStorage);expect(result.status).toBe('ready');
  if(result.status==='ready')expect(Object.values(result.value.facts).every(fact=>fact.status==='unknown')).toBe(true);
});
it('does not write a queued edit after the caller changes activity',async()=>{
  let release!:()=>void;
  tail=new Promise<void>(resolve=>{release=resolve;});
  let current=true;
  const next=updateVenueFact(emptyVenueFacts(scope),'venue_width',change(12),0);
  const pending=writeVenueFacts(scope,next,0,localStorage,locks,()=>current);
  current=false;release();
  await expect(pending).rejects.toThrow('活动已变化');
  expect(readVenueFacts(scope,localStorage).status).toBe('missing');
});
it('distinguishes an activity change after a successful write from no write',async()=>{
  let calls=0;
  const next=updateVenueFact(emptyVenueFacts(scope),'venue_width',change(12),0);
  await expect(writeVenueFacts(scope,next,0,localStorage,locks,()=>++calls<4)).rejects.toThrow('已保存，但活动已变化');
  const result=readVenueFacts(scope,localStorage);
  expect(result.status).toBe('ready');
  if(result.status==='ready')expect(result.value.facts.venue_width.value).toBe(12);
});
