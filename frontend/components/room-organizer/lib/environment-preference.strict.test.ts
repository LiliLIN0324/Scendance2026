// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalWriteLeaseManager, type LocalWriteCapability } from '@/lib/local-write-lease';
import { RESTORE_JOURNAL_MARKER } from '@/lib/restore-journal';
import { clearEnvironmentStrict, readEnvironments, writeEnvironmentsStrict } from './environment-preference';
const key='scendance:environment:v1';
let lease:Awaited<ReturnType<ReturnType<typeof createLocalWriteLeaseManager>['acquire']>>;
beforeEach(async()=>{
  localStorage.clear();
  const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'writer'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
});
afterEach(async()=>{await lease.release();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('strict environment persistence',()=>{
  it('writes and reads exact bytes and retains other projects; clear persists tombstone',()=>{
    const existing=JSON.stringify({'other':{assetId:'b',name:'其他'}});localStorage.setItem(key,existing);
    const result=writeEnvironmentsStrict('a',[{assetId:'a',name:'现场'}],lease.capability);
    expect(result.ok).toBe(true);if(result.ok)expect(localStorage.getItem(key)).toBe(result.json);
    expect(readEnvironments('other')).toEqual([{assetId:'b',name:'其他'}]);
    expect(clearEnvironmentStrict('a',lease.capability).ok).toBe(true);expect(JSON.parse(localStorage.getItem(key)!).a).toBeNull();
  });
  it('forged or released capability cannot write',async()=>{
    expect(writeEnvironmentsStrict('a',[],{kind:'ordinary'} as unknown as LocalWriteCapability)).toMatchObject({ok:false,reason:'lease-invalid',writeStatus:'not-attempted'});
    await lease.release();expect(writeEnvironmentsStrict('a',[],lease.capability)).toMatchObject({ok:false,reason:'lease-invalid',writeStatus:'not-attempted'});
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('项目 ID draft 不能覆盖匿名草稿',()=>{
    expect(writeEnvironmentsStrict('draft',[],lease.capability)).toMatchObject({ok:false,reason:'invalid-scope',writeStatus:'not-attempted'});
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('malformed existing map and too many entries are refused without overwriting',()=>{
    const raw='{damaged';localStorage.setItem(key,raw);
    expect(writeEnvironmentsStrict('a',[],lease.capability)).toMatchObject({ok:false,reason:'invalid-data',writeStatus:'not-attempted'});
    expect(localStorage.getItem(key)).toBe(raw);localStorage.removeItem(key);
    expect(writeEnvironmentsStrict('a',Array.from({length:25},(_,i)=>({assetId:String(i),name:'场地'})),lease.capability)).toMatchObject({ok:false,reason:'invalid-data'});
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('rejects silent JSON loss, including explicit undefined and nonfinite nested data',()=>{
    const invalid={assetId:'a',name:'场地',extra:undefined};
    expect(writeEnvironmentsStrict('a',[invalid],lease.capability)).toMatchObject({ok:false,reason:'invalid-data',writeStatus:'not-attempted'});
    expect(localStorage.getItem(key)).toBeNull();
    expect(writeEnvironmentsStrict('a',[{assetId:'a',name:'场地',extra:Number.NaN} as never],lease.capability)).toMatchObject({ok:false,reason:'invalid-data',writeStatus:'not-attempted'});
  });
  it('quota error is explicit and does not claim that a write definitely did not happen',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
    expect(writeEnvironmentsStrict('a',[{assetId:'a',name:'A'}],lease.capability)).toMatchObject({ok:false,reason:'quota',writeStatus:'unknown'});
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('readback error after a committed write reports unknown rather than success',()=>{
    const original=Storage.prototype.getItem;let reads=0;
    const spy=vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,k){if(k===key&&++reads===3)throw new DOMException('blocked','SecurityError');return original.call(this,k);});
    expect(writeEnvironmentsStrict('a',[{assetId:'a',name:'A'}],lease.capability)).toMatchObject({ok:false,reason:'blocked',writeStatus:'unknown'});
    spy.mockRestore();expect(localStorage.getItem(key)).toContain('"assetId":"a"');
  });
  it('writing then losing the lease is reported as unknown instead of success',()=>{
    const original=Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,k,value){original.call(this,k,value);if(k===key)void lease.release();});
    expect(writeEnvironmentsStrict('a',[{assetId:'a',name:'A'}],lease.capability)).toMatchObject({ok:false,reason:'lease-invalid',writeStatus:'unknown'});
    expect(localStorage.getItem(key)).toContain('"assetId":"a"');
  });
  it('never evicts an old project to make room for a new one',()=>{
    const all=Object.fromEntries(Array.from({length:200},(_,i)=>[`project-${i}`,{assetId:`a-${i}`,name:'场地'}]));
    const raw=JSON.stringify(all);localStorage.setItem(key,raw);
    expect(writeEnvironmentsStrict('new',[{assetId:'new',name:'新场地'}],lease.capability)).toMatchObject({ok:false,reason:'invalid-data',writeStatus:'not-attempted'});
    expect(localStorage.getItem(key)).toBe(raw);
  });
  it('silent no-op write fails byte readback',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});
    expect(writeEnvironmentsStrict('a',[{assetId:'a',name:'A'}],lease.capability)).toMatchObject({ok:false,reason:'readback-mismatch',writeStatus:'unknown'});
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('marker appearing after initial read prevents the write',()=>{
    const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem;let injected=false;
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,k){const value=originalGet.call(this,k);if(k===key&&!injected){injected=true;originalSet.call(this,RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'pending'}));}return value;});
    expect(writeEnvironmentsStrict('a',[{assetId:'a',name:'A'}],lease.capability)).toMatchObject({ok:false,reason:'lease-invalid',writeStatus:'not-attempted'});
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('a third-party change after the first read is never overwritten',()=>{
    const originalGet=Storage.prototype.getItem,originalSet=Storage.prototype.setItem;let count=0;const other=JSON.stringify({other:{assetId:'other',name:'别的页面'}});
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,k){if(k===key&&++count===2)originalSet.call(this,key,other);return originalGet.call(this,k);});
    expect(writeEnvironmentsStrict('a',[{assetId:'a',name:'A'}],lease.capability)).toMatchObject({ok:false,reason:'conflict',writeStatus:'not-attempted'});
    expect(localStorage.getItem(key)).toBe(other);
  });
});
