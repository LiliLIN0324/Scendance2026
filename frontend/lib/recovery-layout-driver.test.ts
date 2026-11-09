import { webcrypto } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { acquireRestrictedRecoveryLease, createLocalWriteLeaseManager, restoreLayoutWithRecoveryCapability, type RecoveryCapability } from './local-write-lease';
import { createRecoveryLayoutDriver } from './recovery-layout-driver';
import * as layoutDriverModule from './recovery-layout-driver';
import { prepareRestoreJournal, RESTORE_JOURNAL_MARKER, type RestoreJournal, type RestoreJournalStore } from './restore-journal';
function fakeStorage():Storage {const map=new Map<string,string>();return {get length(){return map.size;},clear(){map.clear();},key(i){return [...map.keys()][i]??null;},getItem(k){return map.get(k)??null;},setItem(k,v){map.set(k,String(v));},removeItem(k){map.delete(k);}};}
function journalStore():RestoreJournalStore {const map=new Map<string,RestoreJournal>();return {async read(id){return structuredClone(map.get(id));},async create(id,j){map.set(id,structuredClone(j));},
  async setStage(id,expected,stage,digest,nextDigest,guard){guard?.assertStillHeld();const j=map.get(id);if(!j||j.stage!==expected||j.digest!==digest)throw new Error('changed');map.set(id,{...j,stage,digest:nextDigest});},async remove(id,digest){if(map.get(id)?.digest!==digest)throw new Error('changed');map.delete(id);}};}
async function setup(before:unknown,attempted:unknown,seed:string|null) {
  vi.stubGlobal('crypto',webcrypto);const local=fakeStorage(),records=journalStore();if(seed!==null)local.setItem(STORAGE_KEY,seed);
  const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'scendance:local-activity:writer:v1'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:local});
  await prepareRestoreJournal(local,records,{id:'layout-restore',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries:[{domain:'layout',key:'main',before,attempted}]});
  return {local,records,lease:await acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>local},records)};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('精确保存原始字符，成功读回后才清标记',async()=>{
  const old='旧布局\r\n\\u0000',next='新布局\n  {}';const {local,lease}=await setup({present:true,raw:old},{present:true,raw:next},old);
  await lease.apply();expect(local.getItem(STORAGE_KEY)).toBe(next);
  expect(local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');await lease.release();
});
it('空字符串与缺失不同，回滚精确恢复缺失状态',async()=>{
  const {local,lease}=await setup({present:false},{present:true,raw:''},'');
  await lease.rollback();expect(local.getItem(STORAGE_KEY)).toBeNull();await lease.release();
});
it('不同第三方主档不被覆盖，标记保留',async()=>{
  const {local,lease}=await setup({present:true,raw:'before'},{present:true,raw:'after'},'outside');
  await expect(lease.apply()).rejects.toThrow('已有新变化');
  expect(local.getItem(STORAGE_KEY)).toBe('outside');expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
});
it('CAS 写之前发生第三方更新，拒绝覆盖',async()=>{
  const {local,lease}=await setup({present:true,raw:'before'},{present:true,raw:'after'},'before');const driver=createRecoveryLayoutDriver(lease.capability);
  vi.spyOn(layoutDriverModule,'createRecoveryLayoutDriver').mockReturnValue({read:driver.read,compareAndSwap:async(...args)=>{local.setItem(STORAGE_KEY,'outside');await driver.compareAndSwap(...args);}});
  await expect(lease.apply()).rejects.toThrow('已有新变化');
  expect(local.getItem(STORAGE_KEY)).toBe('outside');expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
});
it('读取或写入抛错均保留恢复标记与主档',async()=>{
  const {local,lease}=await setup({present:true,raw:'before'},{present:true,raw:'after'},'before');const read=local.getItem.bind(local);
  vi.spyOn(local,'getItem').mockImplementation(key=>{if(key===STORAGE_KEY)throw new Error('read failed');return read(key);});
  await expect(lease.apply()).rejects.toThrow('read failed');vi.mocked(local.getItem).mockRestore();
  const write=local.setItem.bind(local);vi.spyOn(local,'setItem').mockImplementation((key,value)=>{if(key===STORAGE_KEY)throw new Error('write failed');write(key,value);});
  await expect(lease.apply()).rejects.toThrow('write failed');
  expect(local.getItem(STORAGE_KEY)).toBe('before');expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
});
it('写后回读异常不清标记，再次执行核对完成',async()=>{
  const {local,lease}=await setup({present:true,raw:'before'},{present:true,raw:'after'},'before');const read=local.getItem.bind(local),write=local.setItem.bind(local);let fail=false;
  vi.spyOn(local,'getItem').mockImplementation(key=>{if(key===STORAGE_KEY&&fail){fail=false;throw new Error('readback failed');}return read(key);});
  vi.spyOn(local,'setItem').mockImplementation((key,value)=>{write(key,value);if(key===STORAGE_KEY)fail=true;});
  await expect(lease.apply()).rejects.toThrow('readback failed');
  expect(local.getItem(STORAGE_KEY)).toBe('after');expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  await lease.apply();expect(local.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');await lease.release();
});
it('写入期间租约失效不伪报成功，保留核对标记',async()=>{
  const {local,lease}=await setup({present:true,raw:'before'},{present:true,raw:'after'},'before');const write=local.setItem.bind(local);
  vi.spyOn(local,'setItem').mockImplementation((key,value)=>{write(key,value);if(key===STORAGE_KEY)void lease.release();});
  await expect(lease.apply()).rejects.toThrow('失效');
  expect(local.getItem(STORAGE_KEY)).toBe('after');expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
});
it('普通能力或伪造能力不能构造恢复 driver',async()=>{
  expect(()=>createRecoveryLayoutDriver({kind:'recovery'} as unknown as RecoveryCapability)).toThrow('凭证无效');
  const local=fakeStorage(),locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'scendance:local-activity:writer:v1'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:local});
  const normal=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>local}).acquire();
  expect(()=>createRecoveryLayoutDriver(normal.capability as unknown as RecoveryCapability)).toThrow('凭证无效');await normal.release();
});

it('只能在已授权操作阶段按日志方向写入，外部调用和错误目标拒绝',async()=>{
  const before={present:true as const,raw:'before'},after={present:true as const,raw:'after'};
  const {local,lease}=await setup(before,after,'before');
  await expect(restoreLayoutWithRecoveryCapability(lease.capability,before,after)).rejects.toThrow('只能在受保护');
  const driver=createRecoveryLayoutDriver(lease.capability);
  vi.spyOn(layoutDriverModule,'createRecoveryLayoutDriver').mockReturnValue({read:driver.read,compareAndSwap:async()=>restoreLayoutWithRecoveryCapability(lease.capability,before,{present:true,raw:'wrong'})});
  await expect(lease.apply()).rejects.toThrow('与恢复日志不一致');
  expect(local.getItem(STORAGE_KEY)).toBe('before');expect(local.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
});

// These tests isolate lease/driver mechanics; plan authorization is exercised without this mock in coordinator and recovery-plan-authorization tests.
vi.mock('./recovery-plan',()=>({validateRecoveryPlan:()=>{},preflightRecoverySourceIds:async()=>{}}));
