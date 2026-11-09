// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {emptyVenueFacts,updateVenueFact} from './venue-facts';
import {venueFactsStorageKey} from './venue-facts-storage';
import {unlinkedVenueNotes,withUnlinkedVenueNotes} from './unlinked-venue-export';

const scope='activity:fixture';
const locks={request:vi.fn(async(_name:string,options:{mode:string},callback:()=>Promise<unknown>)=>{expect(options.mode).toBe('shared');return callback();})} as unknown as LockManager;
function recorded(){return updateVenueFact(emptyVenueFacts(scope),'door_width',{value:1.2,source:'site_measurement',status:'confirmed',uncertainty:.02,sourceRef:'private-source',updatedBy:'private-person',updatedAt:'2026-11-08T00:00:00Z'},0);}
function save(value:unknown){localStorage.setItem(venueFactsStorageKey(scope)!,JSON.stringify(value));}
afterEach(()=>{localStorage.clear();vi.clearAllMocks();});

describe('unlinked venue records in local export',()=>{
 it('includes only selected facts, retaining provenance while excluding identity and source text',()=>{
  const notes=unlinkedVenueNotes(recorded());
  expect(notes.notice).toMatch(/尚未与当前画布或图纸版本关联/);
  expect(notes.notice).toMatch(/仅记录一扇门/);expect(notes.notice).toMatch(/不等于场地方确认/);
  expect(notes.facts.find(f=>f.key==='door_width')).toMatchObject({value:1.2,unit:'m',source:'site_measurement',recordedStatus:'confirmed',uncertainty:.02,updatedAt:'2026-11-08T00:00:00.000Z',revision:1});
  expect(JSON.stringify(notes)).not.toMatch(/private-source|private-person|updatedBy|sourceRef/);
 });
 it.each(['activity:sk-TEST-PRIVATE-KEY-123456','activity:person@example.test','activity:C:\\private\\venue'])('never exports an activity identifier embedded in scope',async privateScope=>{
  const data=emptyVenueFacts(privateScope),key=venueFactsStorageKey(privateScope)!;localStorage.setItem(key,JSON.stringify(data));
  try{
    const note=await withUnlinkedVenueNotes(privateScope,()=>true,async value=>value,{locks,storage:localStorage,events:window});
    expect(note.scope).toBe('当前活动');expect(JSON.stringify(note)).not.toContain(privateScope.slice('activity:'.length));
    expect(locks.request).toHaveBeenCalledWith(`scendance:venue-facts:${encodeURIComponent(privateScope)}`,expect.objectContaining({mode:'shared'}),expect.any(Function));
  }finally{localStorage.removeItem(key);}
 });
 it('exports only coordinates from a legacy door point with extra properties',async()=>{
  const data=updateVenueFact(emptyVenueFacts(scope),'door_position',{value:{x:1,z:2,secret:'PRIVATE_POINT'} as {x:number;z:number},source:'user_statement',status:'confirmed',uncertainty:null,sourceRef:null,updatedBy:'用户',updatedAt:'2026-11-08T00:00:00Z'},0);
  save(data);
  const note=await withUnlinkedVenueNotes(scope,()=>true,async value=>value,{locks,storage:localStorage,events:window});
  expect(note.facts.find(item=>item.key==='door_position')?.value).toEqual({x:1,z:2});expect(JSON.stringify(note)).not.toContain('PRIVATE_POINT');
  expect(JSON.parse(localStorage.getItem(venueFactsStorageKey(scope)!)!).facts.door_position.value.secret).toBe('PRIVATE_POINT');
 });
 it('holds the writer lock through asynchronous work and verifies the exact activity scope',async()=>{
  save(recorded());let check!:()=>void;
  const result=await withUnlinkedVenueNotes(scope,()=>true,async(notes,assertCurrent)=>{check=assertCurrent;await Promise.resolve();assertCurrent();return notes;},{locks,storage:localStorage,events:window});
  expect(result.revision).toBe(1);expect(locks.request).toHaveBeenCalledWith(`scendance:venue-facts:${encodeURIComponent(scope)}`,expect.objectContaining({mode:'shared',signal:expect.any(AbortSignal)}),expect.any(Function));
  expect(()=>check()).not.toThrow();
 });
 it('rejects missing, corrupted, unavailable and unscoped facts without writing',async()=>{
  const work=vi.fn(async()=>true);
  await expect(withUnlinkedVenueNotes(scope,()=>true,work,{locks,storage:localStorage,events:window})).rejects.toThrow(/尚无/);
  localStorage.setItem(venueFactsStorageKey(scope)!,'not json');
  await expect(withUnlinkedVenueNotes(scope,()=>true,work,{locks,storage:localStorage,events:window})).rejects.toThrow(/无法读取/);
  await expect(withUnlinkedVenueNotes('unscoped',()=>true,work,{locks,storage:localStorage,events:window})).rejects.toThrow(/范围/);
  await expect(withUnlinkedVenueNotes(scope,()=>false,work,{locks,storage:localStorage,events:window})).rejects.toThrow(/范围/);
  await expect(withUnlinkedVenueNotes(scope,()=>true,work,{locks:{} as LockManager,storage:localStorage,events:window})).rejects.toThrow(/记录锁不可用/);
  expect(localStorage.getItem(venueFactsStorageKey(scope)!)).toBe('not json');expect(work).not.toHaveBeenCalled();
 });
 it('does not export stale records when another tab changes them while the shared lock is pending',async()=>{
  save(recorded());let grant!:()=>void;const pending=new Promise<void>(resolve=>{grant=resolve;});
  const delayed={request:async(_name:string,_options:unknown,callback:()=>Promise<unknown>)=>{await pending;return callback();}} as unknown as LockManager;
  const download=vi.fn(),running=withUnlinkedVenueNotes(scope,()=>true,async()=>{download();},{locks:delayed,storage:localStorage,events:window});
  window.dispatchEvent(new StorageEvent('storage',{key:venueFactsStorageKey(scope)}));grant();
  await expect(running).rejects.toThrow(/变化/);expect(download).not.toHaveBeenCalled();
 });
 it('stops waiting for an unavailable lock without running the export',async()=>{
  vi.useFakeTimers();const work=vi.fn();
  const busy={request:(_name:string,options:{signal:AbortSignal})=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))} as unknown as LockManager;
  try{const promise=withUnlinkedVenueNotes(scope,()=>true,work,{locks:busy,storage:localStorage,events:window});
    const result=expect(promise).rejects.toThrow(/等待场地记录核对超时/);await vi.advanceTimersByTimeAsync(10_000);await result;expect(work).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it('does not execute a late callback when a broken lock manager ignores abort',async()=>{
  vi.useFakeTimers();save(recorded());let grant!:()=>void;const gate=new Promise<void>(resolve=>{grant=resolve;});
  const broken={request:async(_name:string,_options:unknown,callback:()=>Promise<unknown>)=>{await gate;return callback();}} as unknown as LockManager;
  const work=vi.fn();
  try{
    const running=withUnlinkedVenueNotes(scope,()=>true,work,{locks:broken,storage:localStorage,events:window});
    const failed=expect(running).rejects.toThrow(/等待场地记录核对超时/);
    await vi.advanceTimersByTimeAsync(10_000);await failed;grant();await Promise.resolve();await Promise.resolve();
    expect(work).not.toHaveBeenCalled();
  }finally{vi.useRealTimers();}
 });
 it('rejects an ABA update or a scope change while digesting before any download',async()=>{
  save(recorded());const download=vi.fn();let current=true;
  await expect(withUnlinkedVenueNotes(scope,()=>current,async(_notes,check)=>{
    const original=localStorage.getItem(venueFactsStorageKey(scope)!)!;localStorage.setItem(venueFactsStorageKey(scope)!,'changed');
    window.dispatchEvent(new StorageEvent('storage',{key:venueFactsStorageKey(scope)}));localStorage.setItem(venueFactsStorageKey(scope)!,original);
    await Promise.resolve();check();download();
  },{locks,storage:localStorage,events:window})).rejects.toThrow(/变化/);
  expect(download).not.toHaveBeenCalled();
  await expect(withUnlinkedVenueNotes(scope,()=>current,async(_notes,check)=>{current=false;await Promise.resolve();check();download();},{locks,storage:localStorage,events:window})).rejects.toThrow(/变化/);
  expect(download).not.toHaveBeenCalled();
 });
});
