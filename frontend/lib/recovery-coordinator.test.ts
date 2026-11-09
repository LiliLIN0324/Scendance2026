import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { materialCheckinLedgerSchema } from '../../supabase/functions/_shared/material-checkin-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { coordinatePendingRecovery } from './recovery-coordinator';
import { prepareRestoreJournal, readPendingRestoreJournal, RESTORE_JOURNAL_MARKER, type RestoreJournal, type RestoreJournalEntry, type RestoreJournalStore } from './restore-journal';

const model=vi.hoisted(()=>({ values:new Map<string,unknown>(), foreign:new Map<string,unknown>(),writes:0,failAt:-1,failAfter:false,readWait:null as Promise<unknown> | null }));
const token=(entry:{domain:string;key:string})=>`${entry.domain}:${entry.key}`;
vi.mock('./recovery-idb-driver',()=>({createRecoveryIdbDriver:()=>({
  read:async(entry:RestoreJournalEntry)=>structuredClone(model.values.get(token(entry))),
  compareAndSwap:async(entry:RestoreJournalEntry,_expected:unknown,next:unknown,check:()=>void)=>{
    check();const index=model.writes++;if(index===model.failAt&&!model.failAfter)throw new Error('interrupted');
    model.values.set(token(entry),structuredClone(next));if(index===model.failAt&&model.failAfter)throw new Error('interrupted');check();
  },
})}));
vi.mock('./recovery-layout-driver',()=>({createRecoveryLayoutDriver:()=>({
  read:async(entry:RestoreJournalEntry)=>structuredClone(model.values.get(token(entry))),
  compareAndSwap:async(entry:RestoreJournalEntry,_expected:unknown,next:unknown,check:()=>void)=>{
    check();const index=model.writes++;if(index===model.failAt&&!model.failAfter)throw new Error('interrupted');
    model.values.set(token(entry),structuredClone(next));if(index===model.failAt&&model.failAfter)throw new Error('interrupted');check();
  },
})}));
vi.mock('./source-storage',async importOriginal=>({...await importOriginal<typeof import('./source-storage')>(),readStoredSourceById:async(id:string)=>model.readWait ? await model.readWait : model.foreign.get(id)}));
function storage():Storage {const map=new Map<string,string>();return {get length(){return map.size;},clear(){map.clear();},key(i){return [...map.keys()][i]??null;},getItem(k){return map.get(k)??null;},setItem(k,v){map.set(k,String(v));},removeItem(k){map.delete(k);}};}
function journalStore():RestoreJournalStore {const map=new Map<string,RestoreJournal>();return {async read(id){return structuredClone(map.get(id));},async create(id,j){map.set(id,structuredClone(j));},
  async setStage(id,expected,stage,digest,nextDigest,guard){guard?.assertStillHeld();const item=map.get(id);if(!item||item.stage!==expected||item.digest!==digest)throw new Error('changed');map.set(id,{...item,stage,digest:nextDigest});},
  async remove(id,digest){if(map.get(id)?.digest!==digest)throw new Error('changed');map.delete(id);}};}
const project='20000000-0000-4000-8000-000000000001';
const ledger=(dataKind:'real'|'rehearsal')=>materialCheckinLedgerSchema.parse({projectId:project,dataKind,sheets:[]});
const image=(id:string)=>({id,scope:project,name:id,kind:'floorplan',width:1,height:1,blob:new Blob([id],{type:'image/png'})});
function entries():RestoreJournalEntry[] {return [
  {domain:'activity-brief',key:project,before:{present:true,value:{event:'讲座',guests:10,description:'旧',mustHave:'',allowIdeas:false}},attempted:{present:true,value:{event:'讲座',guests:10,description:'新',mustHave:'',allowIdeas:false}}},
  {domain:'material-checkins',key:project,before:{present:true,value:ledger('rehearsal')},attempted:{present:true,value:ledger('real')}},
  {domain:'source-scope',key:project,before:{version:2,scope:project,sources:[image('old')],form:{present:true,value:{width:5}}},attempted:{version:2,scope:project,sources:[image('new')],form:{present:true,value:{width:6}}}},
  {domain:'layout',key:'main',before:{present:true,raw:JSON.stringify(makeLayout({id:project,width:8}))},attempted:{present:true,raw:JSON.stringify(makeLayout({id:project,width:10}))}},
];}
async function setup(list=entries(), binding={source:project,target:project}, operation:'restore'|'undo'='restore') {
  vi.stubGlobal('crypto',webcrypto);const local=storage(),records=journalStore();
  let held=false;const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){if(held)return callback(null);held=true;return callback({name:'scendance:local-activity:writer:v1'}).finally(()=>{held=false;});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:local});
  await prepareRestoreJournal(local,records,{id:'recovery-1',operation,createdAt:'2026-11-07T00:00:00Z',entries:list,scopeBinding:binding});
  for(const entry of list)model.values.set(token(entry),structuredClone(entry.before));
  const opts={getStorage:()=>local,getLocks:()=>locks,store:records};return {local,records,opts,list};
}
beforeEach(()=>{model.values.clear();model.foreign.clear();model.writes=0;model.failAt=-1;model.failAfter=false;model.readWait=null;});
afterEach(()=>vi.unstubAllGlobals());
it.each([0,1,2,3])('第 %i 个域写入前中断后重新打开并继续应用',async failAt=>{
  const f=await setup();model.failAt=failAt;
  await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('interrupted');
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();model.failAt=-1;
  expect(await coordinatePendingRecovery({...f.opts,direction:'apply'})).toBe('completed');
  for(const entry of f.list)expect(model.values.get(token(entry))).toEqual(entry.attempted);
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');
  expect(await coordinatePendingRecovery({...f.opts,direction:'apply'})).toBe('completed');
});
it.each([0,1,2,3])('第 %i 个域写入后中断后重新打开并回滚',async failAt=>{
  const f=await setup();model.failAt=failAt;model.failAfter=true;
  await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('interrupted');
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();model.failAt=-1;
  expect(await coordinatePendingRecovery({...f.opts,direction:'rollback'})).toBe('completed');
  for(const entry of f.list)expect(model.values.get(token(entry))).toEqual(entry.before);
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');
});
it('任一域出现第三值时在改写任何域前停止',async()=>{
  const f=await setup();model.values.set(token(f.list[1]!),{present:true,value:{projectId:project,dataKind:'real',sheets:[{foreign:true}]}});
  await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow();
  expect(model.writes).toBe(0);expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});
it('图纸目标编号被其他活动占用时预检直接拒绝所有写入',async()=>{
  const f=await setup();model.foreign.set('new',{id:'new',scope:'another-activity'});
  await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('其他活动');
  expect(model.writes).toBe(0);expect((await readPendingRestoreJournal(f.local,f.records))?.stage).toBe('prepared');
});
it('未知域、主布局不在最后或无效主布局均在写入前拒绝',async()=>{
  const invalid=entries();invalid[0]={...invalid[0]!,domain:'unsupported'};const f=await setup(invalid);
  await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('不支持');expect(model.writes).toBe(0);
});

it('主布局次序错误或原始内容损坏时不触碰任何域',async()=>{
  const badOrder=entries();badOrder.unshift(badOrder.pop()!);const first=await setup(badOrder);
  await expect(coordinatePendingRecovery({...first.opts,direction:'apply'})).rejects.toThrow('唯一主布局结尾');expect(model.writes).toBe(0);
  first.local.removeItem(RESTORE_JOURNAL_MARKER);model.values.clear();
  const badLayout=entries();badLayout[badLayout.length-1]={domain:'layout',key:'main',before:{present:true,raw:'{损坏'},attempted:{present:false}};
  const second=await setup(badLayout);await expect(coordinatePendingRecovery({...second.opts,direction:'apply'})).rejects.toThrow('无法完整读取');expect(model.writes).toBe(0);
});
it('图纸表单与活动需求落在同一 IDB key 时拒绝',async()=>{
  const list=entries(),base=list[0]!;list[2]={...list[2]!,key:`${project}:brief`,before:{version:2,scope:`${project}:brief`,sources:[],form:{present:false}},attempted:{version:2,scope:`${project}:brief`,sources:[],form:{present:false}}};
  list[list.length-1]={...list[list.length-1]!,before:{present:true,raw:JSON.stringify(makeLayout({id:`${project}:brief`,width:8}))}};
  list.splice(1,1);
  const f=await setup(list,{source:`${project}:brief`,target:project},'undo');await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('存储范围冲突');expect(model.writes).toBe(0);expect(base.domain).toBe('activity-brief');
});

it('不同活动目标包含同一图纸编号时预检拒绝全部写入',async()=>{
  const list=entries(),other='30000000-0000-4000-8000-000000000001';
  list.splice(list.length-1,0,{domain:'source-scope',key:other,before:{version:2,scope:other,sources:[],form:{present:false}},attempted:{version:2,scope:other,sources:[{...image('new'),scope:other}],form:{present:false}}});
  list[list.length-1]={...list[list.length-1]!,attempted:{present:true,raw:JSON.stringify(makeLayout({id:other,width:10}))}};
  const f=await setup(list,{source:project,target:other});await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('未授权活动范围');
  expect(model.writes).toBe(0);expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});

it('图纸表单缺少存在性信息时拒绝自动恢复而非把缺失当 undefined',async()=>{
  const list=entries(),source=list[2]!;list[2]={...source,before:{...(source.before as object),form:undefined}};
  const f=await setup(list);await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('缺少存在性信息');
  expect(model.writes).toBe(0);expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});
it('保留但拒绝旧版图纸快照，不推断它的表单存在状态',async()=>{
  const list=entries(),source=list[2]!,old=source.before as {scope:string;sources:unknown[];form:unknown};
  list[2]={...source,before:{scope:old.scope,sources:old.sources,form:{width:5}}};
  const f=await setup(list);await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('V2');
  expect(model.writes).toBe(0);expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  expect((await readPendingRestoreJournal(f.local,f.records))?.entries[2]!.before).toEqual(list[2]!.before);
});

it('图纸身份只读预检挂起时可取消并保留待恢复标记',async()=>{
  const f=await setup();let finish!:(value:unknown)=>void;model.readWait=new Promise(resolve=>{finish=resolve;});const abort=new AbortController();
  const pending=coordinatePendingRecovery({...f.opts,direction:'apply',signal:abort.signal});
  await new Promise(resolve=>setTimeout(resolve,0));abort.abort();await expect(pending).rejects.toThrow('取消');
  finish(undefined);expect(model.writes).toBe(0);expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});

it('主布局属于 A 时不能以 B 的需求作恢复目标',async()=>{
  const list=entries(),other='30000000-0000-4000-8000-000000000001';list[0]={...list[0]!,key:other};
  const f=await setup(list);await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('未授权活动范围');expect(model.writes).toBe(0);
});
it('不同活动恢复只允许目标范围写入，来源范围不可被顺手覆盖',async()=>{
  const list=entries(),target='30000000-0000-4000-8000-000000000001';
  list[list.length-1]={...list[list.length-1]!,attempted:{present:true,raw:JSON.stringify(makeLayout({id:target,width:10}))}};
  const f=await setup(list,{source:project,target});await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('未授权活动范围');expect(model.writes).toBe(0);
});
it('绑定范围必须与布局两端一致',async()=>{
  const f=await setup([entries().at(-1)!],{source:project,target:'another-activity'});
  await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('主布局不一致');expect(model.writes).toBe(0);
});
it.each([123,{description:'缺字段'},null])('目标需求 %j 不符合备份契约时拒绝所有写入',async value=>{
  const list=entries();list[0]={...list[0]!,attempted:{present:true,value}};
  const f=await setup(list);await expect(coordinatePendingRecovery({...f.opts,direction:'apply'})).rejects.toThrow('目标活动需求格式无效');
  expect(model.writes).toBe(0);expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});
it('同一图纸集合源数组顺序不同时仍能安全识别',async()=>{
  const list=entries(),item=list[2]!,snapshot=item.before as {scope:string;sources:unknown[];form:unknown};
  list[2]={...item,before:{...snapshot,sources:[image('z'),image('a')]}};
  const f=await setup(list);const current=list[2]!.before as {scope:string;sources:unknown[];form:unknown};
  model.values.set(token(list[2]!),{...current,sources:[...current.sources].reverse()});
  expect(await coordinatePendingRecovery({...f.opts,direction:'apply'})).toBe('completed');
  expect(f.local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');
});
