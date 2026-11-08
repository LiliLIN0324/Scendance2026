import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { acquireRestrictedRecoveryLease, type RecoveryDomainDriver } from './local-write-lease';
import { applyRestoreJournal, rollbackRestoreJournal, prepareRestoreJournal, RESTORE_JOURNAL_MARKER, type RestoreJournal, type RestoreJournalEntry, type RestoreJournalStore } from './restore-journal';
const foreign=vi.hoisted(()=>({value:undefined as {scope:string}|undefined}));
vi.mock('./source-storage',async original=>({...await original<typeof import('./source-storage')>(),readStoredSourceById:async()=>foreign.value}));
const project='20000000-0000-4000-8000-000000000001',other='30000000-0000-4000-8000-000000000001';
function storage():Storage {const m=new Map<string,string>();return {get length(){return m.size;},clear(){m.clear();},key(i){return [...m.keys()][i]??null;},getItem(k){return m.get(k)??null;},setItem(k,v){m.set(k,String(v));},removeItem(k){m.delete(k);}};}
function journalStore():RestoreJournalStore {const m=new Map<string,RestoreJournal>();return {async read(id){return structuredClone(m.get(id));},async create(id,j){m.set(id,structuredClone(j));},async setStage(id,expected,stage,digest,nextDigest,guard){guard?.assertStillHeld();const j=m.get(id);if(!j||j.stage!==expected||j.digest!==digest)throw new Error('changed');m.set(id,{...j,stage,digest:nextDigest});},async remove(){throw new Error('not expected');}};}
const brief={event:'讲座',guests:10,description:'需求',mustHave:'',allowIdeas:false};
const layout={domain:'layout',key:'main',before:{present:true,raw:JSON.stringify(makeLayout({id:project,width:8}))},attempted:{present:true,raw:JSON.stringify(makeLayout({id:project,width:10}))}};
async function setup(entries:RestoreJournalEntry[],binding?:{source:string;target:string}) {
  vi.stubGlobal('crypto',webcrypto);const local=storage(),store=journalStore();
  const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'scendance:local-activity:writer:v1'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:local});
  await prepareRestoreJournal(local,store,{id:'proof-test',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries,...(binding?{scopeBinding:binding}:{})});
  const lease=await acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>local},store);
  const driver:RecoveryDomainDriver={read:vi.fn(async()=>{throw new Error('不得读取域');}),compareAndSwap:vi.fn(async()=>{throw new Error('不得写域');})};
  return {local,store,lease,driver};
}
afterEach(()=>{foreign.value=undefined;vi.unstubAllGlobals();});
it('直接调用低级 apply 也拒绝缺少 scopeBinding 的旧日志',async()=>{
  const f=await setup([layout]);await expect(f.lease.apply()).rejects.toThrow('缺少明确的原活动');
  expect(f.driver.read).not.toHaveBeenCalled();expect(f.driver.compareAndSwap).not.toHaveBeenCalled();expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await f.lease.release();
});
it('直接调用 apply 不得借 A 的布局覆盖 B 的需求',async()=>{
  const f=await setup([{domain:'activity-brief',key:other,before:{present:true,value:brief},attempted:{present:true,value:brief}},layout],{source:project,target:project});
  await expect(f.lease.apply()).rejects.toThrow('未授权活动范围');expect(f.driver.read).not.toHaveBeenCalled();expect(f.driver.compareAndSwap).not.toHaveBeenCalled();await f.lease.release();
});
it('直接调用 rollback 也会校验目标需求格式',async()=>{
  const f=await setup([{domain:'activity-brief',key:project,before:{present:true,value:42},attempted:{present:true,value:brief}},layout],{source:project,target:project});
  await expect(f.lease.rollback()).rejects.toThrow('目标活动需求格式无效');expect(f.driver.read).not.toHaveBeenCalled();await f.lease.release();
});
it('直接调用 apply 前仍须检查图纸 ID 被其他活动占用',async()=>{
  foreign.value={scope:other};const source={version:2,scope:project,sources:[{id:'image',scope:project,name:'图',kind:'floorplan',width:1,height:1}],form:{present:false}};
  const f=await setup([{domain:'source-scope',key:project,before:source,attempted:source},layout],{source:project,target:project});
  await expect(f.lease.apply()).rejects.toThrow('其他活动');expect(f.driver.read).not.toHaveBeenCalled();expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await f.lease.release();
});

it.each(['clamped-coordinate','truncated-notes','unknown-field','duplicate-id','non-finite'])('低级入口拒绝会被修复或丢失字段的 %s 布局',async kind=>{
  const bad=makeLayout({id:project,width:10,floors:[makeFloor({items:[makeItem({id:'chair',position:{x:0,z:0}})]})]});
  if(kind==='clamped-coordinate')bad.floors[0]!.items[0]!.position={x:1e300,z:0};
  if(kind==='truncated-notes')bad.floors[0]!.items[0]!.notes='界'.repeat(501);
  if(kind==='unknown-field')Object.assign(bad.floors[0]!.items[0]!,{unrecognizedCriticalData:'保留我'});
  if(kind==='duplicate-id')bad.floors[0]!.items.push({...bad.floors[0]!.items[0]!});
  let raw=JSON.stringify(bad);if(kind==='non-finite')raw=raw.replace('"x":0','"x":1e400');
  const f=await setup([{...layout,attempted:{present:true,raw}}],{source:project,target:project});
  await expect(f.lease.apply()).rejects.toThrow('无法完整读取');expect(f.driver.read).not.toHaveBeenCalled();
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await f.lease.release();
});
it.each(['missing','local'])('恢复布局身份 %s 不会被默认为共享 local 范围',async kind=>{
  const candidate=makeLayout({id:kind==='local'?'local':project});if(kind==='missing')delete candidate.id;
  const entry={...layout,attempted:{present:true,raw:JSON.stringify(candidate)}};
  const f=await setup([entry],{source:project,target:'local'});
  await expect(f.lease.apply()).rejects.toThrow('无法完整读取');expect(f.driver.read).not.toHaveBeenCalled();await f.lease.release();
});
it('即使计划有效，运行时也拒绝向低级租约注入伪造 driver',async()=>{
  const f=await setup([layout],{source:project,target:project});const fake:RecoveryDomainDriver={read:vi.fn(async()=>layout.before),compareAndSwap:vi.fn()};
  const unsafe=f.lease as unknown as {apply(value:RecoveryDomainDriver):Promise<void>;rollback(value:RecoveryDomainDriver):Promise<void>};
  await expect(unsafe.apply(fake)).rejects.toThrow('不接受外部写入驱动');await expect(unsafe.rollback(fake)).rejects.toThrow('不接受外部写入驱动');
  expect(fake.read).not.toHaveBeenCalled();expect(fake.compareAndSwap).not.toHaveBeenCalled();expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await f.lease.release();
});

it('底层 journal 导出函数也拒绝用真实租约和伪 driver 伪造完成',async()=>{
  const f=await setup([layout],{source:project,target:project});
  const fake={read:vi.fn(async()=>layout.before),compareAndSwap:vi.fn(async()=>{})};
  await expect(applyRestoreJournal(f.local,f.store,fake,f.lease.capability)).rejects.toThrow('恢复执行凭证无效');
  await expect(rollbackRestoreJournal(f.local,f.store,fake,f.lease.capability)).rejects.toThrow('恢复执行凭证无效');
  expect(fake.read).not.toHaveBeenCalled();expect(fake.compareAndSwap).not.toHaveBeenCalled();
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toContain('completed');await f.lease.release();
});

it('完成核验入口不接受外部伪 driver',async()=>{
  const f=await setup([layout],{source:project,target:project});const fake={read:vi.fn(),compareAndSwap:vi.fn()};
  const unsafe=f.lease as unknown as {verifyCompleted(value:unknown):Promise<unknown>};
  await expect(unsafe.verifyCompleted(fake)).rejects.toThrow('不接受外部驱动');expect(fake.read).not.toHaveBeenCalled();
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await f.lease.release();
});
