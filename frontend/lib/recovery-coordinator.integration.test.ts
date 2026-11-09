import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { materialCheckinLedgerSchema } from '../../supabase/functions/_shared/material-checkin-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { cleanupCompletedRecovery, coordinatePendingRecovery, verifyCompletedRecovery } from './recovery-coordinator';
import { recordVerifiedCompletion, RESTORE_COMPLETION_LEDGER_NAMESPACE } from './restore-startup-audit';
import { acquireRestrictedRecoveryLease, type RestrictedRecoveryLease } from './local-write-lease';
import { prepareRestoreJournal, RESTORE_JOURNAL_MARKER, type RestoreJournal, type RestoreJournalEntry, type RestoreJournalStore } from './restore-journal';
import type { StoredSource } from './source-storage';
const project='20000000-0000-4000-8000-000000000001';
function localStore():Storage {const m=new Map<string,string>();return {get length(){return m.size;},clear(){m.clear();},key(i){return [...m.keys()][i]??null;},getItem(k){return m.get(k)??null;},setItem(k,v){m.set(k,String(v));},removeItem(k){m.delete(k);}};}
function journalStore():RestoreJournalStore {const m=new Map<string,RestoreJournal>();return {async read(id){return structuredClone(m.get(id));},async create(id,j){m.set(id,structuredClone(j));},
  async setStage(id,expected,stage,digest,nextDigest,guard){guard?.assertStillHeld();const j=m.get(id);if(!j||j.stage!==expected||j.digest!==digest)throw new Error('changed');m.set(id,{...j,stage,digest:nextDigest});},
  async remove(id,digest){if(m.get(id)?.digest!==digest)throw new Error('changed');m.delete(id);}};}
/** Transaction facade exercising the actual IDB drivers, including atomic cross-store commits. */
function database(seedForms:Array<[unknown,unknown]>,seedImages:StoredSource[]) {
  let forms=new Map(seedForms.map(([key,value])=>[JSON.stringify(key),structuredClone(value)]));
  let images=new Map(seedImages.map(source=>[source.id,structuredClone(source)]));let writeNumber=0,failWrite=-1;
  function transaction(_names:unknown,mode:string) {
    if(mode==='readwrite'&&++writeNumber===failWrite)throw new Error('interrupted-idb');
    let pending=0,aborted=false;const nextForms=new Map(forms),nextImages=new Map(images);
    const tx={oncomplete:null as (()=>void)|null,onabort:null as (()=>void)|null,onerror:null as (()=>void)|null,error:null,
      abort(){if(aborted)return;aborted=true;queueMicrotask(()=>tx.onabort?.());},
      objectStore(name:string) {return name==='forms'?{
        get(key:unknown){return request(()=>structuredClone(nextForms.get(JSON.stringify(key))));},
        getKey(key:unknown){return request(()=>nextForms.has(JSON.stringify(key))?key:undefined);},
        put(value:unknown,key:unknown){return request(()=>{nextForms.set(JSON.stringify(key),structuredClone(value));return key;});},
        delete(key:unknown){return request(()=>{nextForms.delete(JSON.stringify(key));return undefined;});},
      }:{
        get(id:string){return request(()=>structuredClone(nextImages.get(id)));},
        index(){return {getAll(scope:string){return request(()=>structuredClone([...nextImages.values()].filter(item=>item.scope===scope)));}};},
        put(item:StoredSource){return request(()=>{nextImages.set(item.id,structuredClone(item));return item.id;});},
        delete(id:string){return request(()=>{nextImages.delete(id);return undefined;});},
      };},
    };
    function request(compute:()=>unknown){const req:{result:unknown;error:null;onsuccess:(()=>void)|null}={result:undefined,error:null,onsuccess:null};pending++;
      queueMicrotask(()=>{if(aborted)return;try{req.result=compute();req.onsuccess?.();}catch{tx.abort();return;}if(--pending===0)queueMicrotask(()=>{if(!aborted&&pending===0){if(mode==='readwrite'){forms=nextForms;images=nextImages;}tx.oncomplete?.();}});});return req;}
    return tx;
  }
  const db={transaction,close(){}};const indexedDB={open(){const request:{result:typeof db;onsuccess:(()=>void)|null;onerror:null;onupgradeneeded:null;error:null}={result:db,onsuccess:null,onerror:null,onupgradeneeded:null,error:null};queueMicrotask(()=>request.onsuccess?.());return request;}};
  return {indexedDB,setFailure:(n:number)=>{writeNumber=0;failWrite=n;},getForm:(key:unknown)=>structuredClone(forms.get(JSON.stringify(key))),setForm:(key:unknown,value:unknown)=>forms.set(JSON.stringify(key),structuredClone(value)),hasForm:(key:unknown)=>forms.has(JSON.stringify(key)),getImage:(id:string)=>structuredClone(images.get(id))};
}
const photo=(id:string):StoredSource=>({id,scope:project,name:id,kind:'floorplan',width:1,height:1,blob:new Blob([id],{type:'image/png'})});
async function setup() {
  vi.stubGlobal('crypto',webcrypto);const local=localStore(),records=journalStore();let locked=false;
  const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){if(locked)return callback(null);locked=true;return callback({name:'scendance:local-activity:writer:v1'}).finally(()=>{locked=false;});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:local});
  const oldLayout=JSON.stringify(makeLayout({id:project,width:8})),newLayout=JSON.stringify(makeLayout({id:project,width:10}));local.setItem(STORAGE_KEY,oldLayout);
  const oldBrief={event:'讲座',guests:10,description:'原需求',mustHave:'',allowIdeas:false},newBrief={...oldBrief,description:'新需求'};
  const oldLedger=materialCheckinLedgerSchema.parse({projectId:project,dataKind:'rehearsal',sheets:[]}),newLedger=materialCheckinLedgerSchema.parse({projectId:project,dataKind:'real',sheets:[]});
  const oldSources={version:2 as const,scope:project,sources:[photo('old-photo')],form:{present:true as const,value:{width:8}}},newSources={version:2 as const,scope:project,sources:[photo('new-photo')],form:{present:true as const,value:{width:10}}};
  const fake=database([[`${project}:brief`,oldBrief],[['material-checkins',project],oldLedger],[project,oldSources.form.value]],oldSources.sources);vi.stubGlobal('indexedDB',fake.indexedDB);
  const entries:RestoreJournalEntry[]=[
    {domain:'activity-brief',key:project,before:{present:true,value:oldBrief},attempted:{present:true,value:newBrief}},
    {domain:'material-checkins',key:project,before:{present:true,value:oldLedger},attempted:{present:true,value:newLedger}},
    {domain:'source-scope',key:project,before:oldSources,attempted:newSources},
    {domain:'layout',key:'main',before:{present:true,raw:oldLayout},attempted:{present:true,raw:newLayout}},
  ];
  await prepareRestoreJournal(local,records,{id:'integrated-restore',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries,scopeBinding:{source:project,target:project}});
  return {local,records,fake,oldLayout,newLayout,oldBrief,newBrief,oldLedger,newLedger,opts:{getStorage:()=>local,getLocks:()=>locks,store:records}};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('实际四类 driver 在一次协调中应用并核对全部域',async()=>{
  const f=await setup();expect(await coordinatePendingRecovery({...f.opts,direction:'apply'})).toBe('completed');
  expect(f.fake.getForm(`${project}:brief`)).toEqual(f.newBrief);expect(f.fake.getForm(['material-checkins',project])).toEqual(f.newLedger);
  expect(f.fake.getImage('old-photo')).toBeUndefined();expect(f.fake.getImage('new-photo')?.name).toBe('new-photo');
  expect(f.fake.getForm(project)).toEqual({width:10});expect(f.local.getItem(STORAGE_KEY)).toBe(f.newLayout);expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');
});
it.each([1,2,3])('真实 driver 在第 %i 个 IDB 写入前失败，重开后可回滚全部原值',async failAt=>{
  const f=await setup();f.fake.setFailure(failAt);
  await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow();expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  f.fake.setFailure(-1);expect(await coordinatePendingRecovery({...f.opts,direction:'rollback'})).toBe('completed');
  expect(f.fake.getForm(`${project}:brief`)).toEqual(f.oldBrief);expect(f.fake.getForm(['material-checkins',project])).toEqual(f.oldLedger);
  expect(f.fake.getImage('old-photo')?.name).toBe('old-photo');expect(f.fake.getImage('new-photo')).toBeUndefined();
  expect(f.fake.getForm(project)).toEqual({width:8});expect(f.local.getItem(STORAGE_KEY)).toBe(f.oldLayout);
});
it('真实 driver 在主布局写入失败后保留标记，重开可完成',async()=>{
  const f=await setup();const write=f.local.setItem.bind(f.local);let fail=true;
  vi.spyOn(f.local,'setItem').mockImplementation((key,value)=>{if(key===STORAGE_KEY&&fail){fail=false;throw new Error('layout interrupted');}write(key,value);});
  await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('layout interrupted');expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  expect(await coordinatePendingRecovery({...f.opts,direction:'apply'})).toBe('completed');expect(f.local.getItem(STORAGE_KEY)).toBe(f.newLayout);
});

it('完成记录用真实 driver 只读复核全部域，重复核验不更改标记或日志',async()=>{
  const f=await setup();await coordinatePendingRecovery({...f.opts,direction:'apply'});
  const marker=f.local.getItem(RESTORE_JOURNAL_MARKER),journal=await f.records.read('integrated-restore');
  const write=vi.spyOn(f.local,'setItem'),remove=vi.spyOn(f.local,'removeItem');
  expect(await verifyCompletedRecovery(f.opts)).toMatchObject({id:'integrated-restore',direction:'apply'});
  expect(await verifyCompletedRecovery(f.opts)).toMatchObject({id:'integrated-restore',direction:'apply'});
  expect(write).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toBe(marker);expect(await f.records.read('integrated-restore')).toEqual(journal);
});
it('完成后资料出现第三值时核验失败，标记和日志保留',async()=>{
  const f=await setup();await coordinatePendingRecovery({...f.opts,direction:'apply'});const marker=f.local.getItem(RESTORE_JOURNAL_MARKER);
  f.fake.setForm(`${project}:brief`,{...f.newBrief,description:'外部新需求'});
  await expect(verifyCompletedRecovery(f.opts)).rejects.toThrow('资料已有变化');
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toBe(marker);expect(await f.records.read('integrated-restore')).toBeDefined();
});
it('完成标记存在但日志丢失时仍冻结并拒绝核验',async()=>{
  const f=await setup();await coordinatePendingRecovery({...f.opts,direction:'apply'});const marker=f.local.getItem(RESTORE_JOURNAL_MARKER);
  vi.spyOn(f.records,'read').mockResolvedValue(undefined);
  await expect(verifyCompletedRecovery(f.opts)).rejects.toThrow('日志缺失');
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toBe(marker);
});
it('显式清理在跨存储保障完成前拒绝，保留已完成记录',async()=>{
  const f=await setup();await coordinatePendingRecovery({...f.opts,direction:'apply'});const marker=f.local.getItem(RESTORE_JOURNAL_MARKER);
  expect(()=>cleanupCompletedRecovery()).toThrow('清理暂不可用');
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toBe(marker);expect(await f.records.read('integrated-restore')).toBeDefined();
});

it('反例：先删除标记后读回失败可能失去冻结，故显式清理拒绝执行',async()=>{
  const f=await setup();await coordinatePendingRecovery({...f.opts,direction:'apply'});const marker=f.local.getItem(RESTORE_JOURNAL_MARKER)!;
  // Isolated storage demonstrates why remove-then-read cannot guarantee rollback on read failure.
  const simulated=localStore();simulated.setItem(RESTORE_JOURNAL_MARKER,marker);const read=simulated.getItem.bind(simulated);let removed=false;
  const remove=simulated.removeItem.bind(simulated);vi.spyOn(simulated,'removeItem').mockImplementation(key=>{remove(key);removed=true;});
  vi.spyOn(simulated,'getItem').mockImplementation(key=>{if(removed&&key===RESTORE_JOURNAL_MARKER)throw new Error('readback unavailable');return read(key);});
  expect(()=>{simulated.removeItem(RESTORE_JOURNAL_MARKER);simulated.getItem(RESTORE_JOURNAL_MARKER);}).toThrow('readback unavailable');
  expect(read(RESTORE_JOURNAL_MARKER)).toBeNull();
  expect(()=>cleanupCompletedRecovery()).toThrow('清理暂不可用');
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toBe(marker);expect(await f.records.read('integrated-restore')).toBeDefined();
});

it('完成账本只经真实租约全域核验后持久写入，并允许幂等重试',async()=>{
  const f=await setup();await coordinatePendingRecovery({...f.opts,direction:'apply'});
  const lease=await acquireRestrictedRecoveryLease(f.opts,f.records),marker=f.local.getItem(RESTORE_JOURNAL_MARKER);
  const first=await recordVerifiedCompletion(lease),second=await recordVerifiedCompletion(lease);
  expect(first).toEqual(second);expect(first).toMatchObject({id:'integrated-restore',direction:'apply',version:1});
  expect(f.fake.getForm([RESTORE_COMPLETION_LEDGER_NAMESPACE,'integrated-restore'])).toEqual(first);
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toBe(marker);expect(await f.records.read('integrated-restore')).toBeDefined();await lease.release();
});
it('账本键存在但值 undefined 时拒绝覆盖，原标记日志保留',async()=>{
  const f=await setup();await coordinatePendingRecovery({...f.opts,direction:'apply'});
  const key=[RESTORE_COMPLETION_LEDGER_NAMESPACE,'integrated-restore'];f.fake.setForm(key,undefined);
  const lease=await acquireRestrictedRecoveryLease(f.opts,f.records);
  await expect(recordVerifiedCompletion(lease)).rejects.toThrow('不同的恢复完成账本');
  expect(f.fake.hasForm(key)).toBe(true);expect(f.fake.getForm(key)).toBeUndefined();
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();expect(await f.records.read('integrated-restore')).toBeDefined();await lease.release();
});
it('复制真实凭证并伪造租约对象不能跳过完成态复核写账本',async()=>{
  const f=await setup();await coordinatePendingRecovery({...f.opts,direction:'apply'});
  const lease=await acquireRestrictedRecoveryLease(f.opts,f.records);
  const forged={...lease,verifyCompleted:vi.fn(async()=>({id:'integrated-restore',direction:'apply' as const,digest:'a'.repeat(64)}))} as RestrictedRecoveryLease;
  await expect(recordVerifiedCompletion(forged)).rejects.toThrow('租约无效');
  expect(f.fake.hasForm([RESTORE_COMPLETION_LEDGER_NAMESPACE,'integrated-restore'])).toBe(false);await lease.release();
});
