// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalWriteLeaseManager } from '@/lib/local-write-lease';
import { readEnvironmentsStrict, type EnvironmentScope, type StoredEnvironment } from './environment-preference';
import { persistEnvironmentPosition } from './environment-position-transaction';
import { reconcilePendingEnvironmentWrite } from './environment-write-reconciliation';
const key='scendance:environment:v1',scope:EnvironmentScope={kind:'project',id:'activity-a'};
const original:StoredEnvironment[]=[{assetId:'venue',name:'原场地',position:{x:0,y:0,z:0}}];
let lease:Awaited<ReturnType<ReturnType<typeof createLocalWriteLeaseManager>['acquire']>>;
beforeEach(async()=>{localStorage.clear();const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'writer'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
  localStorage.setItem(key,JSON.stringify({'activity-a':original,'activity-b':[{assetId:'b',name:'另一活动'}]}));});
afterEach(async()=>{await lease.release();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
function run(overrides:Partial<Parameters<typeof persistEnvironmentPosition>[0]>={}) {return persistEnvironmentPosition({scope,generation:1,environments:original,assetId:'venue',position:{x:2,y:0,z:3},capability:lease.capability,assertCurrent:()=>{},...overrides});}
describe('one-domain environment position transaction',()=>{
  it('写入并核对成功后才返回可应用的副本，不修改调用方内存',()=>{
    const result=run();expect(result.status).toBe('saved');if(result.status!=='saved')return;
    expect(result.next[0]!.position).toEqual({x:2,y:0,z:3});expect(original[0]!.position).toEqual({x:0,y:0,z:0});
    expect(localStorage.getItem(key)).toBe(result.raw);expect(JSON.parse(result.raw)['activity-b'][0].name).toBe('另一活动');
  });
  it('配额不足返回不确定并保留意图及原内存，不能伪称已保存',()=>{
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('quota','QuotaExceededError');});
    const result=run();expect(result.status).toBe('uncertain');if(result.status==='saved')return;
    expect(result.reason).toBe('quota');expect(result.pending?.intended?.[0]?.position).toEqual({x:2,y:0,z:3});
    expect(original[0]!.position).toEqual({x:0,y:0,z:0});expect(JSON.parse(localStorage.getItem(key)!)['activity-a']).toEqual(original);
  });
  it('写入后读回失败保留 unknown，之后核对目标一致可确认',()=>{
    const get=Storage.prototype.getItem;let reads=0;
    const spy=vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,k){if(k===key&&++reads===4)throw new DOMException('blocked','SecurityError');return get.call(this,k);});
    const result=run();expect(result.status).toBe('uncertain');if(result.status==='saved')return;
    spy.mockRestore();expect(result.pending).toBeTruthy();
    expect(reconcilePendingEnvironmentWrite(result.pending!,scope,1,readEnvironmentsStrict(scope,lease.capability))).toEqual({status:'confirmed'});
    expect(original[0]!.position).toEqual({x:0,y:0,z:0});
  });
  it('读取之后其他页面更改同一存档，不覆盖第三值',()=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem;let reads=0;
    const third=JSON.stringify({'activity-a':[{assetId:'venue',name:'他人版本'}],'activity-b':[{assetId:'b',name:'另一活动'}]});
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,k){if(k===key&&++reads===2)set.call(this,key,third);return get.call(this,k);});
    const result=run();expect(result.status).toBe('blocked');if(result.status==='saved')return;
    expect(result.reason).toBe('conflict');expect(localStorage.getItem(key)).toBe(third);expect(original[0]!.name).toBe('原场地');
  });
  it('项目或代次在保存前变化时不写入，保留候选',()=>{
    let calls=0;const raw=localStorage.getItem(key);
    const result=run({assertCurrent:()=>{if(++calls===3)throw new Error('switched');}});
    expect(result.status).toBe('blocked');if(result.status==='saved')return;
    expect(result.pending?.scope).toEqual(scope);expect(localStorage.getItem(key)).toBe(raw);
  });
  it('写后项目切换不伪报成功，保留待核对意图',()=>{
    let calls=0;const result=run({assertCurrent:()=>{if(++calls===4)throw new Error('switched');}});
    expect(result.status).toBe('uncertain');if(result.status==='saved')return;
    expect(result.pending?.generation).toBe(1);expect(original[0]!.position).toEqual({x:0,y:0,z:0});
  });
  it('失效凭证、无位置、重复 ID 和内存与存档不一致时拒绝',async()=>{
    expect(run({position:{x:NaN,y:0,z:0}})).toMatchObject({status:'blocked'});
    expect(run({environments:[...original,...original]})).toMatchObject({status:'blocked'});
    expect(run({environments:[{...original[0]!,name:'本机新稿'}]})).toMatchObject({status:'blocked'});
    await lease.release();expect(run()).toMatchObject({status:'blocked'});
  });
});
