// @vitest-environment jsdom
import {webcrypto} from 'node:crypto';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BingoAuditCard} from './bingo-audit-card';
import {BINGO_MARK_KEY} from '../lib/bingo-status';
import {makeFloor,makeItem,makeLayout} from '../lib/__testfixtures__/fixtures';
import {createReviewFeedbackReceipt,reviewVersionForHash,type ReceiptPin} from '@/components/review-share-page/review-feedback-receipt';
import {REVIEW_SHARE_PIN_STORAGE_KEY_V2} from '@/components/review-share-page/share-pins';
import * as storageApi from '@/components/review-share-page/review-feedback-storage';
const project='project-1';
const layout=makeLayout({id:project,width:12,height:9,floors:[makeFloor({id:'f',name:'一层',items:[makeItem({id:'chair',position:{x:0,z:0}})]})]});
const hash=`#layout=${Buffer.from(JSON.stringify(layout)).toString('base64url')}`;
const pin:ReceiptPin={id:'p',floorId:'f',text:'舞台向左',itemId:'chair',x:0,y:0,z:0,offset:[0,0,0],camera:{position:[2,3,2],target:[0,0,0]},status:'open'};
const mark=()=>localStorage.setItem(BINGO_MARK_KEY,JSON.stringify([{saved:true,status:'needs-review',projectKey:project,title:'活动',shareId:'one',markedAt:'2026-11-07T00:00:00Z',clientUrl:`http://localhost/review/${hash}`,versionBinding:'sha256-v1'} ]));
const upload=(content:string,size=content.length)=>fireEvent.change(screen.getByLabelText('导入反馈文件'),{target:{files:[{size,text:async()=>content}]}});
beforeEach(()=>{localStorage.clear();mark();vi.stubGlobal('crypto',webcrypto);Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_n:string,_o:unknown,fn:(lock:object)=>unknown)=>Promise.resolve(fn({}))}});});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('previews exact shared version then imports only on explicit confirmation and reloads it',async()=>{
 const json=createReviewFeedbackReceipt(await reviewVersionForHash(hash),[pin],true),check=()=>true;
 const view=render(<BingoAuditCard scopeKey={`activity:${project}`} isCurrent={check}/>);
 upload(json);const preview=await screen.findByRole('region',{name:'待导入反馈预览'});
 expect(within(preview).getByText('舞台向左')).toBeTruthy();expect(within(preview).getByText(/一层 · 位置 0.00，0.00 米/)).toBeTruthy();
 expect(within(preview).getByText(/反馈文件声明：已完成/)).toBeTruthy();expect(localStorage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBeNull();
 fireEvent.click(within(preview).getByRole('button',{name:'确认导入反馈'}));
 expect(await screen.findByRole('region',{name:'已导入反馈'})).toBeTruthy();expect(localStorage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBeTruthy();
 view.unmount();render(<BingoAuditCard scopeKey={`activity:${project}`} isCurrent={check}/>);
 expect((await screen.findByRole('region',{name:'已导入反馈'})).textContent).toContain('舞台向左');
});
it('rejects large files without reading and other project without exposing import',async()=>{
 const read=vi.fn(async()=>'{ }');const view=render(<BingoAuditCard scopeKey={`activity:${project}`} isCurrent={()=>true}/>);
 fireEvent.change(screen.getByLabelText('导入反馈文件'),{target:{files:[{size:256001,text:read}]}});
 expect(screen.getByText(/反馈文件超过 256 KB/)).toBeTruthy();expect(read).not.toHaveBeenCalled();
 view.rerender(<BingoAuditCard scopeKey="activity:other" isCurrent={()=>true}/>);
 expect(screen.queryByLabelText('导入反馈文件')).toBeNull();expect(localStorage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBeNull();
});
it('keeps an uncertain write unresolved and prevents a blind retry',async()=>{
 const json=createReviewFeedbackReceipt(await reviewVersionForHash(hash),[pin],false);
 const write=vi.spyOn(storageApi,'importReviewFeedback').mockResolvedValue({state:'unknown'});
 render(<BingoAuditCard scopeKey={`activity:${project}`} isCurrent={()=>true}/>);upload(json);
 const preview=await screen.findByRole('region',{name:'待导入反馈预览'});fireEvent.click(within(preview).getByRole('button',{name:'确认导入反馈'}));
 expect(await screen.findByText(/导入结果暂时无法确认/)).toBeTruthy();expect((screen.getByLabelText('导入反馈文件') as HTMLInputElement).disabled).toBe(true);expect(write).toHaveBeenCalledOnce();
});
it('does not write when the session is invalidated while the file is read',async()=>{
 let finish!:(s:string)=>void,current=true;const json=createReviewFeedbackReceipt(await reviewVersionForHash(hash),[pin],false);
 render(<BingoAuditCard scopeKey={`activity:${project}`} isCurrent={()=>current}/>);
 fireEvent.change(screen.getByLabelText('导入反馈文件'),{target:{files:[{size:100,text:()=>new Promise<string>(resolve=>{finish=resolve;})}]}});
 current=false;finish(json);await waitFor(()=>expect(screen.queryByRole('region',{name:'待导入反馈预览'})).toBeNull());
 expect(localStorage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBeNull();
});

it('rejects a feedback file bound to a different snapshot',async()=>{
 const different=`#layout=${Buffer.from(JSON.stringify({...layout,name:'另一版本'})).toString('base64url')}`;
 const json=createReviewFeedbackReceipt(await reviewVersionForHash(different),[pin],true);
 render(<BingoAuditCard scopeKey={`activity:${project}`} isCurrent={()=>true}/>);upload(json);
 expect(await screen.findByText(/反馈属于其他分享版本/)).toBeTruthy();
 expect(screen.queryByRole('button',{name:'确认导入反馈'})).toBeNull();expect(localStorage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBeNull();
});
it('does not write after an activity token is revoked while waiting for the import lock',async()=>{
 let release!:()=>void,current=true;
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_n:string,_o:unknown,fn:(lock:object)=>unknown)=>new Promise(resolve=>{release=()=>resolve(fn({}));})}});
 const json=createReviewFeedbackReceipt(await reviewVersionForHash(hash),[pin],false);
 render(<BingoAuditCard scopeKey={`activity:${project}`} isCurrent={()=>current}/>);upload(json);
 const preview=await screen.findByRole('region',{name:'待导入反馈预览'});fireEvent.click(within(preview).getByRole('button',{name:'确认导入反馈'}));
 await waitFor(()=>expect(release).toBeTypeOf('function'));current=false;release();
 await waitFor(()=>expect(localStorage.getItem(REVIEW_SHARE_PIN_STORAGE_KEY_V2)).toBeNull());
});
