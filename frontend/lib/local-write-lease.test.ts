import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireRestrictedRecoveryLease, assertLocalWriteCapability, assertRecoveryCapability, createLocalWriteLeaseManager, LOCAL_ACTIVITY_WRITE_LOCK } from './local-write-lease';
import { prepareRestoreJournal, RESTORE_JOURNAL_MARKER, type RestoreJournal, type RestoreJournalStore } from './restore-journal';
import { webcrypto } from 'node:crypto';
import { sourceCapabilityStorage } from './source-capability-storage';
import * as layoutDriverModule from './recovery-layout-driver';
import type { RestrictedRecoveryLease, RecoveryDomainDriver } from './local-write-lease';
function applyWith(lease: RestrictedRecoveryLease, driver: RecoveryDomainDriver): Promise<void> {
  const spy=vi.spyOn(layoutDriverModule,'createRecoveryLayoutDriver').mockReturnValue(driver);
  return lease.apply().finally(()=>spy.mockRestore());
}
import type { LocalWriteCapability } from './local-write-lease';

function storage(): Storage {
  const values=new Map<string,string>();
  return {get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(key)??null,key:index=>[...values.keys()][index]??null,
    removeItem:key=>{values.delete(key);},setItem:(key,value)=>{values.set(key,String(value));}};
}
/** One underlying lock server simulates different browsing contexts. */
function lockServer() {
  const held=new Set<string>();let calls=0;
  const locks={request(name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>) {
    calls++;
    if(held.has(name))return Promise.resolve().then(()=>callback(null));
    held.add(name);
    return Promise.resolve().then(()=>callback({name,mode:'exclusive'})).finally(()=>held.delete(name));
  }} as unknown as LockManager;
  return {locks,held,calls:()=>calls};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function journalStore(): RestoreJournalStore {
  const records=new Map<string,RestoreJournal>();
  return {async read(id){return structuredClone(records.get(id));},async create(id,journal){records.set(id,structuredClone(journal));},
    async setStage(id,expected,stage,digest,nextDigest){const item=records.get(id);if(!item||item.stage!==expected||item.digest!==digest)throw new Error('changed');records.set(id,{...item,stage,digest:nextDigest});},
    async remove(id,digest){if(records.get(id)?.digest!==digest)throw new Error('changed');records.delete(id);}};
}
async function setupPending(store:Storage, records:RestoreJournalStore) {
  vi.stubGlobal('crypto',webcrypto);
  return prepareRestoreJournal(store,records,{id:'restore-1',operation:'restore',createdAt:'2026-11-07T00:00:00Z',entries:[{domain:'layout',key:'main',before:'old',attempted:'new'}]});
}
describe('cross-tab write lease core',()=>{
  it('同页并发调用共享同一个租约，最后释放后其他页才可获得',async()=>{
    const server=lockServer(),store=storage();
    const first=createLocalWriteLeaseManager({getLocks:()=>server.locks,getStorage:()=>store});
    const second=createLocalWriteLeaseManager({getLocks:()=>server.locks,getStorage:()=>store});
    const [a,b]=await Promise.all([first.acquire(),first.acquire()]);
    expect(server.calls()).toBe(1);expect(server.held.has(LOCAL_ACTIVITY_WRITE_LOCK)).toBe(true);
    a.assertWritable();b.assertWritable();await a.release();
    expect(()=>a.assertWritable()).toThrow('失效');b.assertWritable();
    await expect(second.acquire()).rejects.toThrow('另一窗口');
    await b.release();const c=await second.acquire();c.assertWritable();await c.release();
  });
  it('无 Web Locks 或无法读取存储时 fail closed',async()=>{
    const store=storage();
    await expect(createLocalWriteLeaseManager({getLocks:()=>null,getStorage:()=>store}).acquire()).rejects.toThrow('无法协调');
    await expect(createLocalWriteLeaseManager({getLocks:()=>{throw new Error('denied');},getStorage:()=>store}).acquire()).rejects.toThrow('无法协调');
    await expect(createLocalWriteLeaseManager({getLocks:()=>lockServer().locks,getStorage:()=>{throw new Error('denied');}}).acquire()).rejects.toThrow('无法读取');
  });
  it('获取前已存在或损坏标记时不会请求锁',async()=>{
    const server=lockServer(),store=storage(),manager=createLocalWriteLeaseManager({getLocks:()=>server.locks,getStorage:()=>store});
    store.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'journal-1'}));
    await expect(manager.acquire()).rejects.toThrow('恢复尚待核对');expect(server.calls()).toBe(0);
    store.setItem(RESTORE_JOURNAL_MARKER,'broken');await expect(manager.acquire()).rejects.toThrow('无法读取');expect(server.calls()).toBe(0);
  });
  it('持有期间新增标记时写前同步拒绝并失效所有同页租约',async()=>{
    const server=lockServer(),store=storage(),manager=createLocalWriteLeaseManager({getLocks:()=>server.locks,getStorage:()=>store});
    const a=await manager.acquire(),b=await manager.acquire();
    store.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'journal-1'}));
    expect(()=>a.assertWritable()).toThrow('恢复尚待核对');expect(()=>b.assertWritable()).toThrow('失效');
    await a.release();await b.release();expect(server.held.has(LOCAL_ACTIVITY_WRITE_LOCK)).toBe(false);
  });
  it('检查后取得锁前出现标记，绝不发出租约',async()=>{
    const store=storage();let callback!: (lock:unknown)=>Promise<unknown>, resolve!:()=>void;
    const locks={request(_name:string,_opts:unknown,cb:typeof callback){callback=cb;return new Promise<void>(done=>{resolve=done;});}} as unknown as LockManager;
    const manager=createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>store});
    const result=manager.acquire();store.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'journal-1'}));
    await callback({name:LOCAL_ACTIVITY_WRITE_LOCK});resolve();await expect(result).rejects.toThrow('恢复尚待核对');
  });
  it('重复 release 必须等待首次释放底层锁完成',async()=>{
    const store=storage();let finish!:()=>void;
    const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){
      return callback({name:LOCAL_ACTIVITY_WRITE_LOCK}).then(()=>new Promise<void>(resolve=>{finish=resolve;}));
    }} as unknown as LockManager;
    const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>store}).acquire();
    let doneA=false,doneB=false;const a=lease.release().then(()=>{doneA=true;}),b=lease.release().then(()=>{doneB=true;});
    await Promise.resolve();await Promise.resolve();expect(doneA).toBe(false);expect(doneB).toBe(false);
    finish();await Promise.all([a,b]);expect(doneA).toBe(true);expect(doneB).toBe(true);
  });
  it('释放幂等且持锁期间存储不可读会拒绝写入',async()=>{
    const server=lockServer(),store=storage();let available=true;
    const manager=createLocalWriteLeaseManager({getLocks:()=>server.locks,getStorage:()=>available?store:null});
    const lease=await manager.acquire();available=false;expect(()=>lease.assertWritable()).toThrow('无法读取');
    await lease.release();await lease.release();expect(server.held.size).toBe(0);
  });
  it('底层锁请求异常结束后所有已有租约拒绝写入',async()=>{
    const store=storage();let rejectRequest!:(error:Error)=>void;
    const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){
      void callback({name:LOCAL_ACTIVITY_WRITE_LOCK});
      return new Promise<void>((_resolve,reject)=>{rejectRequest=reject;});
    }} as unknown as LockManager;
    const manager=createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>store});
    const lease=await manager.acquire();lease.assertWritable();rejectRequest(new Error('lost'));
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(()=>lease.assertWritable()).toThrow('失效');await lease.release();
  });

});


describe('restricted recovery lease',()=>{
  it('仅待核对且日志有效时授权恢复能力，同一原生锁排他',async()=>{
    const server=lockServer(),storageValue=storage(),records=journalStore();
    const deps={getLocks:()=>server.locks,getStorage:()=>storageValue};
    await expect(acquireRestrictedRecoveryLease(deps,records)).rejects.toThrow('没有待核对');
    await setupPending(storageValue,records);
    vi.stubGlobal('navigator',{locks:server.locks});vi.stubGlobal('window',{localStorage:storageValue});
    const lease=await acquireRestrictedRecoveryLease(deps,records);
    expect(await lease.inspect()).toMatchObject({id:'restore-1'});
    expect('assertWritable' in lease).toBe(false);
    await expect(acquireRestrictedRecoveryLease(deps,records)).rejects.toThrow('另一窗口');
    let value='old';await applyWith(lease,{read:async()=>value,compareAndSwap:async(_entry,expected,next,check)=>{
      check();expect(value).toBe(expected);value=String(next);
    }});
    expect(value).toBe('new');expect(storageValue.getItem(RESTORE_JOURNAL_MARKER)).toContain('"state":"completed"');
    await lease.release();expect(server.held.size).toBe(0);
  });
  it('损坏日志或普通写者占锁时不能获取恢复能力',async()=>{
    const server=lockServer(),store=storage(),records=journalStore();const deps={getLocks:()=>server.locks,getStorage:()=>store};
    const writer=await createLocalWriteLeaseManager(deps).acquire();await setupPending(store,records);
    await expect(acquireRestrictedRecoveryLease(deps,records)).rejects.toThrow('另一窗口');await writer.release();
    vi.spyOn(records,'read').mockResolvedValue(undefined);
    await expect(acquireRestrictedRecoveryLease(deps,records)).rejects.toThrow('日志缺失');
    expect(store.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();expect(server.held.size).toBe(0);
  });
  it('取得前取消或验证过程中取消不放行，标记不清除',async()=>{
    const server=lockServer(),store=storage(),records=journalStore();const deps={getLocks:()=>server.locks,getStorage:()=>store};
    await setupPending(store,records);
    const cancelled=new AbortController();cancelled.abort();await expect(acquireRestrictedRecoveryLease(deps,records,cancelled.signal)).rejects.toThrow('取消');
    let unblock!:(value:unknown)=>void;
    vi.spyOn(records,'read').mockImplementationOnce(()=>new Promise(resolve=>{unblock=resolve;}));
    const abort=new AbortController(),waiting=acquireRestrictedRecoveryLease(deps,records,abort.signal);
    await Promise.resolve();await Promise.resolve();abort.abort();await expect(waiting).rejects.toThrow('取消');
    unblock(undefined);expect(store.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();expect(server.held.size).toBe(0);
  });
  it('恢复锁丢失后不能读取或发起操作，标记仍保留',async()=>{
    const store=storage(),records=journalStore();await setupPending(store,records);let rejectRequest!:(error:Error)=>void;
    const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){
      void callback({name:LOCAL_ACTIVITY_WRITE_LOCK});return new Promise<void>((_resolve,reject)=>{rejectRequest=reject;});
    }} as unknown as LockManager;
    const lease=await acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>store},records);
    rejectRequest(new Error('lost'));await new Promise(resolve=>setTimeout(resolve,0));
    await expect(lease.inspect()).rejects.toThrow('失效或取消');
    await expect(lease.apply()).rejects.toThrow('失效或取消');
    expect(store.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await lease.release();
  });
  it('锁请求一直不回调时取消立即结束，迟到回调不得激活',async()=>{
    const store=storage(),records=journalStore();await setupPending(store,records);
    let late!:(lock:unknown)=>Promise<unknown>;
    const locks={request(_name:string,_opts:unknown,callback:typeof late){late=callback;return new Promise<void>(()=>{});}} as unknown as LockManager;
    const abort=new AbortController();const pending=acquireRestrictedRecoveryLease({getLocks:()=>locks,getStorage:()=>store},records,abort.signal);
    abort.abort();await expect(pending).rejects.toThrow('取消');
    await late({name:LOCAL_ACTIVITY_WRITE_LOCK});
    expect(store.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });
  it('旧阶段事务失锁后被中止，另一页取得锁后旧事务不可提交',async()=>{
    const store=storage(),records=journalStore();await setupPending(store,records);
    let rejectFirst!:(reason:Error)=>void,busy=false,calls=0;
    const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){
      if(busy)return Promise.resolve(callback(null));busy=true;calls++;
      if(calls===1){void callback({name:LOCAL_ACTIVITY_WRITE_LOCK});return new Promise<void>((_resolve,reject)=>{rejectFirst=error=>{busy=false;reject(error);};});}
      return Promise.resolve(callback({name:LOCAL_ACTIVITY_WRITE_LOCK})).finally(()=>{busy=false;});
    }} as unknown as LockManager;
    const deps={getLocks:()=>locks,getStorage:()=>store};vi.stubGlobal('navigator',{locks});vi.stubGlobal('window',{localStorage:store});const old=await acquireRestrictedRecoveryLease(deps,records);
    const originalSet=records.setStage.bind(records);let unblock!:()=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});
    records.setStage=async(id,expected,stage,digest,nextDigest,guard)=>{
      started();await new Promise<void>(resolve=>{unblock=resolve;});
      guard?.assertStillHeld();if(guard?.signal.aborted)throw new Error('事务已中止');
      await originalSet(id,expected,stage,digest,nextDigest,guard);
    };
    const applying=applyWith(old,{read:async()=> 'old',compareAndSwap:async()=>{throw new Error('不得写业务数据');}});
    await began;rejectFirst(new Error('lost'));await new Promise(resolve=>setTimeout(resolve,0));
    const next=await acquireRestrictedRecoveryLease(deps,records);
    unblock();await expect(applying).rejects.toThrow('失效');
    expect((await next.inspect()).stage).toBe('prepared');
    await old.release();await next.release();expect(store.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });
  it('只读驱动挂起时取消可释放锁，迟到读取不能继续写入',async()=>{
    const server=lockServer(),store=storage(),records=journalStore();const deps={getLocks:()=>server.locks,getStorage:()=>store};
    await setupPending(store,records);vi.stubGlobal('navigator',{locks:server.locks});vi.stubGlobal('window',{localStorage:store});const abort=new AbortController(),lease=await acquireRestrictedRecoveryLease(deps,records,abort.signal);
    let finishRead!:(value:unknown)=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});const cas=vi.fn();
    const applying=applyWith(lease,{read:()=>{started();return new Promise(resolve=>{finishRead=resolve;});},compareAndSwap:cas});
    await began;abort.abort();await expect(applying).rejects.toThrow('失效或取消');await lease.release();
    expect(server.held.size).toBe(0);const next=await acquireRestrictedRecoveryLease(deps,records);
    finishRead('old');await Promise.resolve();await Promise.resolve();expect(cas).not.toHaveBeenCalled();
    expect(store.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();await next.release();
  });
  it('操作中取消时写事务内检查会拒绝修改，等待进行中工作后释放锁',async()=>{
    const server=lockServer(),store=storage(),records=journalStore();const deps={getLocks:()=>server.locks,getStorage:()=>store};
    await setupPending(store,records);vi.stubGlobal('navigator',{locks:server.locks});vi.stubGlobal('window',{localStorage:store});const abort=new AbortController();const lease=await acquireRestrictedRecoveryLease(deps,records,abort.signal);
    let unblock!:()=>void,started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve;});let value='old';
    const applying=applyWith(lease,{read:async()=>value,compareAndSwap:async(_entry,_expected,next,check)=>{
      started();await new Promise<void>(resolve=>{unblock=resolve;});check();value=String(next);
    }});
    await began;abort.abort();expect(server.held.size).toBe(1);unblock();await expect(applying).rejects.toThrow('失效或取消');
    await lease.release();expect(value).toBe('old');expect(store.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();expect(server.held.size).toBe(0);
  });
});


describe('runtime write capabilities',()=>{
  it('只有本浏览器真实活跃普通租约的原始身份有效，释放和待恢复状态均使其失效',async()=>{
    const server=lockServer(),store=storage();vi.stubGlobal('navigator',{locks:server.locks});vi.stubGlobal('window',{localStorage:store});
    const manager=createLocalWriteLeaseManager({getLocks:()=>server.locks,getStorage:()=>store});
    const a=await manager.acquire(),b=await manager.acquire();assertLocalWriteCapability(a.capability);assertLocalWriteCapability(b.capability);
    expect(Object.isFrozen(a.capability)).toBe(true);
    expect(()=>assertLocalWriteCapability({kind:'ordinary'})).toThrow('凭证无效');
    expect(()=>assertLocalWriteCapability({...a.capability})).toThrow('凭证无效');
    expect(()=>assertRecoveryCapability(a.capability)).toThrow('凭证无效');
    await a.release();expect(()=>assertLocalWriteCapability(a.capability)).toThrow('失效');assertLocalWriteCapability(b.capability);
    store.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'pending'}));
    expect(()=>assertLocalWriteCapability(b.capability)).toThrow('恢复尚待核对');await b.release();
  });
  it('恢复凭证只允许相应恢复检查，普通凭证和恢复凭证不能互换',async()=>{
    const server=lockServer(),store=storage(),records=journalStore();vi.stubGlobal('navigator',{locks:server.locks});vi.stubGlobal('window',{localStorage:store});
    const deps={getLocks:()=>server.locks,getStorage:()=>store};await setupPending(store,records);
    const recovery=await acquireRestrictedRecoveryLease(deps,records);assertRecoveryCapability(recovery.capability);
    expect(()=>assertLocalWriteCapability(recovery.capability)).toThrow('凭证无效');
    expect(()=>sourceCapabilityStorage.storeSourceForm(recovery.capability as unknown as LocalWriteCapability,'项目','不应写入')).toThrow('凭证无效');
    expect(()=>assertRecoveryCapability({kind:'recovery'})).toThrow('凭证无效');
    store.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'other'}));
    expect(()=>assertRecoveryCapability(recovery.capability)).toThrow('标记已变化');await recovery.release();
    expect(()=>assertRecoveryCapability(recovery.capability)).toThrow('失效或取消');
  });
  it('绑定取得时的锁与存储，环境改变后凭证永久失效',async()=>{
    const server=lockServer(),other=lockServer(),store=storage();
    vi.stubGlobal('navigator',{locks:server.locks});vi.stubGlobal('window',{localStorage:store});
    let currentLocks=server.locks;
    const lease=await createLocalWriteLeaseManager({getLocks:()=>currentLocks,getStorage:()=>store}).acquire();
    assertLocalWriteCapability(lease.capability);currentLocks=other.locks;
    expect(()=>assertLocalWriteCapability(lease.capability)).toThrow('不属于当前浏览器');
    currentLocks=server.locks;expect(()=>assertLocalWriteCapability(lease.capability)).toThrow('失效');
    await lease.release();
  });
  it('模拟或替换的锁服务和存储不能签发有效业务写凭证',async()=>{
    const server=lockServer(),store=storage(),different=storage();
    vi.stubGlobal('navigator',{locks:server.locks});vi.stubGlobal('window',{localStorage:different});
    const lease=await createLocalWriteLeaseManager({getLocks:()=>server.locks,getStorage:()=>store}).acquire();
    expect(()=>assertLocalWriteCapability(lease.capability)).toThrow('不属于当前浏览器');await lease.release();
  });
});

// These tests isolate lease/driver mechanics; plan authorization is exercised without this mock in coordinator and recovery-plan-authorization tests.
vi.mock('./recovery-plan',()=>({validateRecoveryPlan:()=>{},preflightRecoverySourceIds:async()=>{}}));
