import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Isolate the transition algorithm; production authorization is tested separately.
vi.mock('./local-write-lease',()=>({assertRecoveryExecution:()=>{},assertRecoveryCapability:()=>{throw new Error('恢复写入未获授权。');},recoveryCapabilitySignal:()=>{throw new Error('恢复写入未获授权。');},assertRecoveryStorageGrant:()=>{throw new Error('恢复写入未获授权。');}}));
import { inspectRestoreMarker, applyRestoreJournal, indexedDbRestoreJournalStore, prepareRestoreJournal, readPendingRestoreJournal, rollbackRestoreJournal, RESTORE_JOURNAL_MARKER, setRestoreJournalStage, type RestoreJournal, type RestoreJournalStore, type RestoreRollbackDriver } from './restore-journal';

function storage(): Storage {
  const records=new Map<string,string>();
  return {get length(){return records.size;},clear:()=>records.clear(),getItem:key=>records.get(key)??null,key:index=>[...records.keys()][index]??null,
    removeItem:key=>{records.delete(key);},setItem:(key,value)=>{records.set(key,String(value));}};
}
function store(): RestoreJournalStore {
  const records=new Map<string,RestoreJournal>();
  return {
    async read(id){return structuredClone(records.get(id));},
    async create(id,journal){if(records.has(id))throw new Error('duplicate');records.set(id,structuredClone(journal));},
    async setStage(id,expected,stage,digest,nextDigest){const item=records.get(id);if(!item||item.stage!==expected||item.digest!==digest)throw new Error('changed');records.set(id,{...item,stage,digest:nextDigest});},
    async remove(id,digest){if(records.get(id)?.digest!==digest)throw new Error('changed');records.delete(id);},
  };
}
const input=()=>({id:'journal-1',operation:'restore' as const,createdAt:'2026-11-07T00:00:00Z',entries:[
  {domain:'layout',key:'main',before:{name:'原方案'},attempted:{name:'恢复方案'}},
  {domain:'sources',key:'a',before:{image:new Blob(['original'],{type:'image/png'})},attempted:{image:new Blob(['next'],{type:'image/png'})}},
]});
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);});

describe('restore journal core',()=>{
  it('keeps real journal creation closed before storage or marker writes while writer integration is incomplete',async()=>{
    const marker=storage(),open=vi.fn();vi.stubGlobal('indexedDB',{open});
    await expect(prepareRestoreJournal(marker,indexedDbRestoreJournalStore,input())).rejects.toThrow('恢复日志创建尚未取得受限授权');
    expect(open).not.toHaveBeenCalled();expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toBeNull();
  });
  it('saves and verifies snapshots including Blob before publishing a marker',async()=>{
    const marker=storage(),records=store();await prepareRestoreJournal(marker,records,input());
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toContain('journal-1');
    const saved=await readPendingRestoreJournal(marker,records);
    expect(saved?.stage).toBe('prepared');
    expect(await ((saved!.entries[1]!.before as {image:Blob}).image).text()).toBe('original');
    expect((await setRestoreJournalStage(marker,records,'applying')).stage).toBe('applying');
  });
  it('never publishes a marker when journal write or readback fails',async()=>{
    const marker=storage(),records=store();vi.spyOn(records,'read').mockResolvedValue(undefined);
    await expect(prepareRestoreJournal(marker,records,input())).rejects.toThrow('日志缺失');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toBeNull();
  });
  it('retains orphan journal when marker storage fails, without changing business data',async()=>{
    const marker=storage(),records=store();vi.spyOn(marker,'setItem').mockImplementation(()=>{throw new Error('quota');});
    await expect(prepareRestoreJournal(marker,records,input())).rejects.toThrow('quota');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toBeNull();expect(await records.read('journal-1')).toBeDefined();
  });
  it('拒绝损坏标记或日志缺失并保留证据',async()=>{
    const marker=storage(),records=store();
    marker.setItem(RESTORE_JOURNAL_MARKER,'not-json');
    await expect(readPendingRestoreJournal(marker,records)).rejects.toThrow('标记损坏');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toBe('not-json');
    marker.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'lost'}));
    await expect(readPendingRestoreJournal(marker,records)).rejects.toThrow('日志缺失');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });
  it('拒绝回滚时 CAS 并发失败并保留日志',async()=>{
    const marker=storage(),records=store();await prepareRestoreJournal(marker,records,input());
    const driver:RestoreRollbackDriver={read:async entry=>entry.attempted,compareAndSwap:async()=>{throw new Error('第三方更新');}};
    await expect(rollbackRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('第三方更新');
    expect((await readPendingRestoreJournal(marker,records))?.stage).toBe('rolling_back');
  });
  it('refuses corrupted, missing or altered journals and keeps the marker',async()=>{
    const marker=storage(),records=store();await prepareRestoreJournal(marker,records,input());
    const original=await records.read('journal-1') as RestoreJournal;
    vi.spyOn(records,'read').mockResolvedValue({...original,entries:[{...original.entries[0],before:'tampered'}]});
    await expect(readPendingRestoreJournal(marker,records)).rejects.toThrow('校验失败');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });
  it('preflights all domains and never overwrites a third-party value',async()=>{
    const marker=storage(),records=store();const journal=await prepareRestoreJournal(marker,records,input());
    const cas=vi.fn();const driver:RestoreRollbackDriver={read:async entry=>entry.domain==='layout'?entry.attempted:{changed:true},compareAndSwap:cas};
    await expect(rollbackRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('未覆盖任何资料');
    expect(cas).not.toHaveBeenCalled();expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();expect(journal.stage).toBe('prepared');
  });
  it('survives an interrupted partial rollback and resumes idempotently',async()=>{
    const marker=storage(),records=store();const journal=await prepareRestoreJournal(marker,records,input());
    const values=new Map(journal.entries.map(entry=>[entry.key,structuredClone(entry.attempted)]));let fail=true;
    const driver:RestoreRollbackDriver={read:async entry=>structuredClone(values.get(entry.key)),compareAndSwap:async(entry,_expected,next)=>{
      if(entry.domain==='sources'&&fail){fail=false;throw new Error('interrupted');}values.set(entry.key,structuredClone(next));}};
    await expect(rollbackRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('interrupted');
    expect((await readPendingRestoreJournal(marker,records))?.stage).toBe('rolling_back');
    expect(values.get('main')).toEqual({name:'原方案'});
    await rollbackRestoreJournal(marker,records,driver,undefined);
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toContain('\"state\":\"completed\"');expect(await records.read('journal-1')).toBeDefined();
    expect(await ((values.get('a') as {image:Blob}).image).text()).toBe('original');
  });
  it('leaves marker in place when completion-marker write is refused',async()=>{
    const marker=storage(),records=store();const journal=await prepareRestoreJournal(marker,records,input());
    const driver:RestoreRollbackDriver={read:async entry=>entry.before,compareAndSwap:vi.fn()};
    vi.spyOn(marker,'setItem').mockImplementation(()=>{});
    await expect(rollbackRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('完成记录未能核对');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();expect(await records.read(journal.id)).toBeDefined();
  });
  it.each([0,1])('应用在第 %i 个域写前中断后可恢复',async failedIndex=>{
    const marker=storage(),records=store();const journal=await prepareRestoreJournal(marker,records,input());
    const values=new Map(journal.entries.map(entry=>[entry.key,structuredClone(entry.before)]));
    let index=0,shouldFail=true;
    const driver:RestoreRollbackDriver={read:async entry=>structuredClone(values.get(entry.key)),compareAndSwap:async(entry,_expected,next)=>{
      if(shouldFail&&index++===failedIndex){shouldFail=false;throw new Error('interrupted-before');}
      values.set(entry.key,structuredClone(next));}};
    await expect(applyRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('interrupted-before');
    expect((await readPendingRestoreJournal(marker,records))?.stage).toBe('applying');
    await applyRestoreJournal(marker,records,driver,undefined);
    expect(values.get('main')).toEqual({name:'恢复方案'});
    expect(await ((values.get('a') as {image:Blob}).image).text()).toBe('next');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toContain('\"state\":\"completed\"');
    await expect(applyRestoreJournal(marker,records,driver,undefined)).resolves.toBeUndefined();
  });
  it.each([0,1])('应用在第 %i 个域写后中断后可恢复',async failedIndex=>{
    const marker=storage(),records=store();const journal=await prepareRestoreJournal(marker,records,input());
    const values=new Map(journal.entries.map(entry=>[entry.key,structuredClone(entry.before)]));
    let index=0,shouldFail=true;
    const driver:RestoreRollbackDriver={read:async entry=>structuredClone(values.get(entry.key)),compareAndSwap:async(entry,_expected,next)=>{
      values.set(entry.key,structuredClone(next));
      if(shouldFail&&index++===failedIndex){shouldFail=false;throw new Error('interrupted-after');}}};
    await expect(applyRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('interrupted-after');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
    await applyRestoreJournal(marker,records,driver,undefined);
    expect(values.get('main')).toEqual({name:'恢复方案'});
    expect(await ((values.get('a') as {image:Blob}).image).text()).toBe('next');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toContain('\"state\":\"completed\"');
  });
  it('应用前若任何域有第三值则整体拒绝，标记保留',async()=>{
    const marker=storage(),records=store();await prepareRestoreJournal(marker,records,input());
    const cas=vi.fn();const driver:RestoreRollbackDriver={read:async entry=>entry.domain==='layout'?entry.before:'外部新内容',compareAndSwap:cas};
    await expect(applyRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('未覆盖任何资料');
    expect(cas).not.toHaveBeenCalled();expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });
  it('应用后最终读回失败保留标记，再次核对可完成',async()=>{
    const marker=storage(),records=store();const journal=await prepareRestoreJournal(marker,records,input());
    const values=new Map(journal.entries.map(entry=>[entry.key,structuredClone(entry.before)]));let reads=0,fail=true;
    const driver:RestoreRollbackDriver={read:async entry=>{if(++reads>journal.entries.length&&fail){fail=false;throw new Error('read failed');}return structuredClone(values.get(entry.key));},
      compareAndSwap:async(entry,_expected,next)=>{values.set(entry.key,structuredClone(next));}};
    await expect(applyRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('read failed');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
    await applyRestoreJournal(marker,records,driver,undefined);
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).toContain('\"state\":\"completed\"');
  });
  it('开始回滚后拒绝反向应用，不能清除待恢复标记',async()=>{
    const marker=storage(),records=store();await prepareRestoreJournal(marker,records,input());
    await setRestoreJournalStage(marker,records,'rolling_back');
    const cas=vi.fn();const driver:RestoreRollbackDriver={read:async entry=>entry.before,compareAndSwap:cas};
    await expect(applyRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('回滚已经开始');
    expect(cas).not.toHaveBeenCalled();expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });

  it('distinguishes array holes from undefined and refuses third-party changes', async()=>{
    const marker=storage(),records=store();
    await prepareRestoreJournal(marker,records,{...input(),entries:[{domain:'layout',key:'main',before:Array(1),attempted:[undefined]}]});
    const values={ current: Array(1) as unknown[] }, cas=vi.fn(async(_entry,_expected,next)=>{values.current=next;});
    const driver:RestoreRollbackDriver={read:async()=>structuredClone(values.current),compareAndSwap:cas};
    await applyRestoreJournal(marker,records,driver,undefined);
    expect(cas).toHaveBeenCalledOnce();expect(0 in values.current).toBe(true);

    const marker2=storage(),records2=store();
    await prepareRestoreJournal(marker2,records2,{...input(),id:'journal-2',entries:[{domain:'layout',key:'main',before:[undefined],attempted:['next']}]});
    values.current=Array(1);cas.mockClear();
    await expect(applyRestoreJournal(marker2,records2,driver,undefined)).rejects.toThrow('未覆盖任何资料');
    expect(cas).not.toHaveBeenCalled();expect(marker2.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });

  it('compares custom array properties rather than treating distinct snapshots as equal',async()=>{
    const marker=storage(),records=store();
    const before=Object.assign([1],{tag:'old'}),attempted=Object.assign([1],{tag:'new'});
    await prepareRestoreJournal(marker,records,{...input(),entries:[{domain:'layout',key:'main',before,attempted}]});
    const cas=vi.fn();const driver:RestoreRollbackDriver={read:async()=>Object.assign([1],{tag:'third'}),compareAndSwap:cas};
    await expect(applyRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('未覆盖任何资料');
    expect(cas).not.toHaveBeenCalled();
  });

  it('includes File name and lastModified in comparison even when bytes and MIME match',async()=>{
    const marker=storage(),records=store();
    const file=(name:string,lastModified:number)=>new File(['same'],name,{type:'image/png',lastModified});
    await prepareRestoreJournal(marker,records,{...input(),entries:[{domain:'sources',key:'a',before:file('a.png',1),attempted:file('b.png',1)}]});
    const cas=vi.fn();const driver:RestoreRollbackDriver={read:async()=>file('a.png',2),compareAndSwap:cas};
    await expect(applyRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('未覆盖任何资料');
    expect(cas).not.toHaveBeenCalled();expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });

  it('detects a changed legal stage and retains the recovery marker',async()=>{
    const marker=storage(),records=store();await prepareRestoreJournal(marker,records,input());
    const original=await records.read('journal-1') as RestoreJournal;
    vi.spyOn(records,'read').mockResolvedValue({...original,stage:'rolling_back'});
    await expect(readPendingRestoreJournal(marker,records)).rejects.toThrow('校验失败');
    expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
  });

  it('uses digest CAS for stage transitions and refuses a stale transition',async()=>{
    const marker=storage(),records=store();const initial=await prepareRestoreJournal(marker,records,input());
    const applying=await setRestoreJournalStage(marker,records,'applying');
    expect(applying.digest).not.toBe(initial.digest);
    await expect(records.setStage(initial.id,'prepared','rolling_back',initial.digest,'0'.repeat(64))).rejects.toThrow('changed');
    expect((await readPendingRestoreJournal(marker,records))?.stage).toBe('applying');
    await setRestoreJournalStage(marker,records,'rolling_back');
    await expect(setRestoreJournalStage(marker,records,'applying')).rejects.toThrow('不能回退');
  });

  it('the IndexedDB stage store rejects unauthorised direct calls before writing',async()=>{
    const prior={...input(),version:1 as const,stage:'rolling_back' as const,digest:'a'.repeat(64)};
    const put=vi.fn();
    const tx={ error:null, oncomplete:undefined as undefined|(()=>void), onerror:undefined as undefined|(()=>void),
      onabort:undefined as undefined|(()=>void), abort(){queueMicrotask(()=>tx.onabort?.());}, objectStore(){return {
        get(){const req={result:structuredClone(prior),error:null,onsuccess:undefined as undefined|(()=>void)};queueMicrotask(()=>req.onsuccess?.());return req;},
        put, delete:vi.fn(),
      };} };
    vi.stubGlobal('indexedDB',{open(){const req={result:{transaction:()=>tx,close:vi.fn()},onsuccess:undefined as undefined|(()=>void)};queueMicrotask(()=>req.onsuccess?.());return req;}});
    try {
      await expect(indexedDbRestoreJournalStore.setStage(prior.id,'rolling_back','applying',prior.digest,'b'.repeat(64))).rejects.toThrow('未获授权');
      expect(put).not.toHaveBeenCalled();
      await expect(indexedDbRestoreJournalStore.setStage(prior.id,'applying','rolling_back',prior.digest,'b'.repeat(64))).rejects.toThrow('未获授权');
      expect(put).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

});

it('完成标记写成功但回读失败时仍冻结，重试可核验且不能反向操作',async()=>{
  const marker=storage(),records=store();vi.stubGlobal('crypto',webcrypto);const journal=await prepareRestoreJournal(marker,records,input());
  const values=new Map(journal.entries.map(entry=>[entry.key,structuredClone(entry.before)]));
  const driver:RestoreRollbackDriver={read:async entry=>structuredClone(values.get(entry.key)),compareAndSwap:async(entry,_expected,next)=>{values.set(entry.key,structuredClone(next));}};
  const originalSet=marker.setItem.bind(marker),originalGet=marker.getItem.bind(marker);let fail=false,injected=false;
  vi.spyOn(marker,'setItem').mockImplementation((key,value)=>{originalSet(key,value);if(key===RESTORE_JOURNAL_MARKER&&value.includes('"state":"completed"')&&!injected){fail=true;injected=true;}});
  vi.spyOn(marker,'getItem').mockImplementation(key=>{if(key===RESTORE_JOURNAL_MARKER&&fail){fail=false;throw new Error('readback unavailable');}return originalGet(key);});
  await expect(applyRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('readback unavailable');
  expect(inspectRestoreMarker(marker)).toMatchObject({state:'completed',direction:'apply'});
  expect(await readPendingRestoreJournal(marker,records)).toMatchObject({id:'journal-1',stage:'applying'});
  await expect(rollbackRestoreJournal(marker,records,driver,undefined)).rejects.toThrow('不能反向');
  await expect(applyRestoreJournal(marker,records,driver,undefined)).resolves.toBeUndefined();
});
it('完成标记摘要损坏时保留冻结并拒绝读取为有效日志',async()=>{
  const marker=storage(),records=store();vi.stubGlobal('crypto',webcrypto);const journal=await prepareRestoreJournal(marker,records,input());
  marker.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:journal.id,state:'completed',direction:'apply',digest:'f'.repeat(64)}));
  await expect(readPendingRestoreJournal(marker,records)).rejects.toThrow('不一致');
  expect(marker.getItem(RESTORE_JOURNAL_MARKER)).not.toBeNull();
});
