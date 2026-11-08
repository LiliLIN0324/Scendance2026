import {afterEach,describe,expect,it,vi} from 'vitest';
import {makeFloor,makeItem,makeLayout} from '../room-organizer/lib/__testfixtures__/fixtures';
import {createReviewFeedbackReceipt,reviewVersionForHash,type ReceiptPin} from './review-feedback-receipt';
import {importReviewFeedback,readImportedReviewFeedback} from './review-feedback-storage';
import {REVIEW_SHARE_PIN_STORAGE_KEY_V2} from './share-pins';
const layout=makeLayout({width:12,height:9,floors:[makeFloor({id:'f',items:[makeItem({id:'chair',position:{x:0,z:0}})]})]});
const hash=`#layout=${Buffer.from(JSON.stringify(layout)).toString('base64url')}`;
const pin:ReceiptPin={id:'p',floorId:'f',text:'请移动',itemId:'chair',x:0,y:0,z:0,offset:[0,0,0],camera:{position:[2,3,2],target:[0,0,0]},status:'open'};
const memory=()=>{const data=new Map<string,string>();return {getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};};
afterEach(()=>vi.unstubAllGlobals());
describe('feedback import storage',()=>{
 it('imports once, reports duplicates and keeps a file-reported completion without certifying identity',async()=>{
  vi.stubGlobal('navigator',{locks:{request:(_n:string,_o:unknown,fn:(lock:object)=>unknown)=>Promise.resolve(fn({}))}});
  const storage=memory(),json=createReviewFeedbackReceipt(await reviewVersionForHash(hash),[pin],true);
  expect(await importReviewFeedback(storage,json,hash)).toMatchObject({state:'applied',added:1,duplicates:0,reportedCompleted:true});
  expect(await importReviewFeedback(storage,json,hash)).toMatchObject({state:'applied',added:0,duplicates:1});
  expect(await readImportedReviewFeedback(storage,hash)).toEqual({pins:[pin],reportedCompleted:true});
 });
 it('never overwrites corrupted or conflicting records and requires a lock',async()=>{
  const storage=memory(),json=createReviewFeedbackReceipt(await reviewVersionForHash(hash),[pin],true);
  vi.stubGlobal('navigator',{});await expect(importReviewFeedback(storage,json,hash)).rejects.toThrow('协调');
  vi.stubGlobal('navigator',{locks:{request:(_n:string,_o:unknown,fn:(lock:object)=>unknown)=>Promise.resolve(fn({}))}});
  storage.setItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2,'broken');await expect(importReviewFeedback(storage,json,hash)).rejects.toThrow('无法完整读取');expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBe('broken');
 });
 it('keeps third-value conflicts and reports an uncertain write rather than a false success',async()=>{
  vi.stubGlobal('navigator',{locks:{request:(_n:string,_o:unknown,fn:(lock:object)=>unknown)=>Promise.resolve(fn({}))}});
  const storage=memory(),v=await reviewVersionForHash(hash),json=createReviewFeedbackReceipt(v,[pin],false);
  await importReviewFeedback(storage,json,hash);const old=storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2);
  const conflict=createReviewFeedbackReceipt(v,[{...pin,text:'另一条意见'}],false);
  await expect(importReviewFeedback(storage,conflict,hash)).rejects.toThrow('编号与已有内容冲突');expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBe(old);
  const broken={getItem:storage.getItem,setItem:()=>{throw new Error('write denied');}};
  expect(await importReviewFeedback(broken,json,hash)).toEqual({state:'unknown'});
 });
 it('rejects 70+20 without losing existing data but does not count duplicates toward the limit',async()=>{
  vi.stubGlobal('navigator',{locks:{request:(_n:string,_o:unknown,fn:(lock:object)=>unknown)=>Promise.resolve(fn({}))}});
  const storage=memory(),v=await reviewVersionForHash(hash);
  const old=Array.from({length:70},(_,i)=>({...pin,id:`old-${i}`}));
  await importReviewFeedback(storage,createReviewFeedbackReceipt(v,old,false),hash);
  const before=storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2);
  const next=Array.from({length:20},(_,i)=>({...pin,id:`new-${i}`}));
  await expect(importReviewFeedback(storage,createReviewFeedbackReceipt(v,next,false),hash)).rejects.toThrow('80 条');
  expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBe(before);
  const withDuplicates=[...old.slice(0,10),...next.slice(0,10)];
  expect(await importReviewFeedback(storage,createReviewFeedbackReceipt(v,withDuplicates,false),hash)).toMatchObject({state:'applied',added:10,duplicates:10});
 });
 it('refuses to display or merge an existing pin whose position no longer matches the shared snapshot',async()=>{
  vi.stubGlobal('navigator',{locks:{request:(_n:string,_o:unknown,fn:(lock:object)=>unknown)=>Promise.resolve(fn({}))}});
  const storage=memory(),v=await reviewVersionForHash(hash),key=`review-v2:${v.slice(7)}`;
  const before=JSON.stringify({version:1,byPlan:{[key]:[{...pin,offset:[10000,0,10000]}]}});storage.setItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2,before);
  await expect(readImportedReviewFeedback(storage,hash)).rejects.toThrow('偏移不一致');
  await expect(importReviewFeedback(storage,createReviewFeedbackReceipt(v,[pin],false),hash)).rejects.toThrow('偏移不一致');
  expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBe(before);
 });
 it('rejects activity changes during asynchronous validation without writing',async()=>{
  vi.stubGlobal('navigator',{locks:{request:(_n:string,_o:unknown,fn:(lock:object)=>unknown)=>Promise.resolve(fn({}))}});
  const storage=memory(),json=createReviewFeedbackReceipt(await reviewVersionForHash(hash),[pin],true);let checks=0;
  await expect(importReviewFeedback(storage,json,hash,undefined,()=>++checks<3)).rejects.toThrow('活动或分享版本已变化');
  expect(storage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBeNull();
 });
 it('does not return a stale read when another page updates feedback during validation',async()=>{
  let calls=0;const storage={getItem:()=>++calls===1?null:JSON.stringify({version:1,byPlan:{}})};
  await expect(readImportedReviewFeedback(storage,hash)).rejects.toThrow('核对期间已变化');
 });
});
