// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalWriteLeaseManager, type LocalWriteCapability } from '@/lib/local-write-lease';
import { RESTORE_JOURNAL_MARKER } from '@/lib/restore-journal';
import { readEnvironmentsStrict, type EnvironmentScope } from './environment-preference';
import { createPendingEnvironmentWrite, reconcilePendingEnvironmentWrite } from './environment-write-reconciliation';

const key='scendance:environment:v1',scope:EnvironmentScope={kind:'project',id:'A'},other:EnvironmentScope={kind:'project',id:'B'};
const old=[{assetId:'old',name:'原场地'}],target=[{assetId:'new',name:'新场地'}];
let lease:Awaited<ReturnType<ReturnType<typeof createLocalWriteLeaseManager>['acquire']>>;
beforeEach(async()=>{localStorage.clear();const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'writer'});}} as unknown as LockManager;
  vi.stubGlobal('navigator',{locks});lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();});
afterEach(async()=>{await lease.release();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
function read(s:EnvironmentScope=scope){return readEnvironmentsStrict(s,lease.capability);}
function pending(){localStorage.setItem(key,JSON.stringify({A:old,B:[{assetId:'b',name:'B项目'}]}));const result=read();if(!result.ok)throw new Error(result.reason);return createPendingEnvironmentWrite(scope,7,result.snapshot,target);}
describe('strict environment read and unknown outcome reconciliation',()=>{
  it('区分未设置、显式清空及旧单项记录，不丢来源原文',()=>{
    const missing=read();expect(missing).toMatchObject({ok:true,snapshot:{present:false,raw:null}});
    const raw=JSON.stringify({A:null,B:{assetId:'legacy',name:'旧'}});localStorage.setItem(key,raw);
    expect(read()).toMatchObject({ok:true,snapshot:{present:true,value:null,raw}});
    expect(read(other)).toMatchObject({ok:true,snapshot:{present:true,value:{assetId:'legacy',name:'旧'},raw}});
  });
  it('损坏和其他项目的无效记录不能被过滤成空',()=>{
    localStorage.setItem(key,'{invalid');expect(read()).toEqual({ok:false,reason:'invalid-data'});
    localStorage.setItem(key,JSON.stringify({A:old,B:{assetId:'broken'}}));expect(read()).toEqual({ok:false,reason:'invalid-data'});
  });
  it('伪造或失效凭证、项目 ID draft 冲突都拒绝读取',async()=>{
    expect(readEnvironmentsStrict(scope,{} as LocalWriteCapability)).toEqual({ok:false,reason:'lease-invalid'});
    expect(readEnvironmentsStrict({kind:'project',id:'draft'},lease.capability)).toEqual({ok:false,reason:'invalid-scope'});
    await lease.release();expect(read()).toEqual({ok:false,reason:'lease-invalid'});
  });
  it('结果未知时只有读回与目标完全一致才确认',()=>{
    const p=pending();localStorage.setItem(key,JSON.stringify({A:target,B:[{assetId:'b',name:'B项目'}]}));
    expect(reconcilePendingEnvironmentWrite(p,scope,7,read())).toEqual({status:'confirmed'});
  });
  it('读回仍为原始字节才可建议重试，其他项目变化时保守显示冲突',()=>{
    const p=pending();expect(reconcilePendingEnvironmentWrite(p,scope,7,read())).toEqual({status:'retryable'});
    localStorage.setItem(key,JSON.stringify({A:old,B:[{assetId:'b2',name:'另一页面'}]}));
    expect(reconcilePendingEnvironmentWrite(p,scope,7,read())).toEqual({status:'conflict'});
  });
  it('第三值或未知读取保持冲突/待核验，不宣称原值',()=>{
    const p=pending();localStorage.setItem(key,JSON.stringify({A:[{assetId:'third',name:'第三值'}]}));
    expect(reconcilePendingEnvironmentWrite(p,scope,7,read())).toEqual({status:'conflict'});
    localStorage.setItem(key,'{broken');expect(reconcilePendingEnvironmentWrite(p,scope,7,read())).toEqual({status:'unresolved',reason:'invalid-data'});
  });
  it('项目切换及 A→B→A 新代次不采用旧结果',()=>{
    const p=pending();expect(reconcilePendingEnvironmentWrite(p,other,7,read(other))).toEqual({status:'stale'});
    expect(reconcilePendingEnvironmentWrite(p,scope,8,read())).toEqual({status:'stale'});
  });
  it('意图快照不受调用方后续修改影响，显式 tombstone 与未设置不同',()=>{
    const p=pending();const mutable=[{assetId:'draft',name:'用户输入'}];const copy=createPendingEnvironmentWrite(scope,7,p.before,mutable);
    mutable[0]!.name='后改';expect(copy.intended![0]!.name).toBe('用户输入');
    const clear=createPendingEnvironmentWrite(scope,7,p.before,null);localStorage.setItem(key,JSON.stringify({A:null}));
    expect(reconcilePendingEnvironmentWrite(clear,scope,7,read())).toEqual({status:'confirmed'});
    localStorage.removeItem(key);expect(reconcilePendingEnvironmentWrite(clear,scope,7,read())).toEqual({status:'conflict'});
  });
  it('已出现恢复标记的租约拒绝核对，不泄漏成空记录',()=>{
    localStorage.setItem(RESTORE_JOURNAL_MARKER,JSON.stringify({version:1,id:'pending'}));
    expect(read()).toEqual({ok:false,reason:'lease-invalid'});
  });
});
