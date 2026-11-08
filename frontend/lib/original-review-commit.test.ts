import {describe,expect,it,vi} from 'vitest';
import {commitOriginalReview,originalReviewReceiptKey,readOriginalReviewPending,type OriginalReviewReceipt} from './original-review-commit';

const account='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
const receipt:OriginalReviewReceipt={version:1,projectId:project,reviewId:'33333333-3333-4333-8333-333333333333',baseHash:'a'.repeat(64),candidateHash:'b'.repeat(64),baseRevision:3};
const key=originalReviewReceiptKey(account,project);
function memory(){const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};}
function locks(){let taken=false;return {request:async (_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>)=>{if(taken)return callback(null);taken=true;try{return await callback({name:_name});}finally{taken=false;}}} as unknown as LockManager;}
describe('original scene review commit receipt',()=>{
  it('saves a receipt before dispatch and retains it after a confirmed response',async()=>{
    const storage=memory(),submit=vi.fn(async()=>{expect(readOriginalReviewPending(storage,key)).toEqual({state:'pending',receipt});return 4;});
    expect(await commitOriginalReview({storage,locks:locks(),accountId:account,receipt,isCurrent:()=>true,submit})).toEqual({state:'committed',value:4});
    expect(readOriginalReviewPending(storage,key)).toEqual({state:'pending',receipt});
  });
  it('blocks without writable storage or a lock',async()=>{
    const submit=vi.fn(),storage=memory();
    expect((await commitOriginalReview({storage,locks:null,accountId:account,receipt,isCurrent:()=>true,submit})).state).toBe('blocked');
    expect((await commitOriginalReview({storage:{...storage,setItem:()=>{throw Error('quota');}},locks:locks(),accountId:account,receipt,isCurrent:()=>true,submit})).state).toBe('blocked');
    expect(submit).not.toHaveBeenCalled();
  });
  it('retains a queryable receipt after a lost response and prevents a repeat, including after reopening',async()=>{
    const storage=memory(),lock=locks(),submit=vi.fn(async()=>{throw Error('connection lost');});
    expect((await commitOriginalReview({storage,locks:lock,accountId:account,receipt,isCurrent:()=>true,submit})).state).toBe('unknown');
    expect(readOriginalReviewPending(storage,key)).toEqual({state:'pending',receipt});
    expect((await commitOriginalReview({storage,locks:lock,accountId:account,receipt,isCurrent:()=>true,submit})).state).toBe('blocked');
    expect(submit).toHaveBeenCalledTimes(1);
  });
  it('holds the cross-tab lock until the first request finishes',async()=>{
    const storage=memory(),lock=locks();let finish!:()=>void;
    const submit=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const first=commitOriginalReview({storage,locks:lock,accountId:account,receipt,isCurrent:()=>true,submit});
    expect((await commitOriginalReview({storage,locks:lock,accountId:account,receipt,isCurrent:()=>true,submit})).state).toBe('blocked');
    finish();expect((await first).state).toBe('committed');expect(submit).toHaveBeenCalledTimes(1);
  });
  it('keeps the receipt when the session changes after dispatch',async()=>{
    const storage=memory();let current=true;
    expect((await commitOriginalReview({storage,locks:locks(),accountId:account,receipt,isCurrent:()=>current,submit:async()=>{current=false;return 4;}})).state).toBe('unknown');
    expect(readOriginalReviewPending(storage,key).state).toBe('pending');
  });
  it('treats corrupt or unreadable receipts as unavailable',()=>{
    const storage=memory();storage.setItem(key,'broken');expect(readOriginalReviewPending(storage,key).state).toBe('unavailable');
    expect(readOriginalReviewPending({getItem:()=>{throw Error();}},key).state).toBe('unavailable');
  });
});
