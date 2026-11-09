// @vitest-environment jsdom
import {webcrypto} from 'node:crypto';
import {act,cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BingoAuditCard} from './bingo-audit-card';
import {makeFloor,makeLayout} from '../lib/__testfixtures__/fixtures';
import {rememberReviewLinkMark,REVIEW_MARK_CHANGED_EVENT} from '../lib/review-share';
import {BINGO_MARK_KEY} from '../lib/bingo-status';
const layout=makeLayout({id:'project',name:'真实活动',floors:[makeFloor({id:'floor',items:[]})]});
const hash=`#layout=${Buffer.from(JSON.stringify(layout)).toString('base64url')}`;
const input={projectKey:'project',title:'真实活动',shareId:'project',clientUrl:`http://localhost/review/${hash}`,reviewPlanKey:'unused'};
const lock=(available=true)=>Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_n:string,_o:unknown,fn:(lock:object|null)=>unknown)=>Promise.resolve(fn(available?{}:null))}});
beforeEach(()=>{localStorage.clear();vi.stubGlobal('crypto',webcrypto);lock();});
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('refreshes an already mounted card after same-tab durable save',async()=>{
 const {container}=render(<BingoAuditCard/>);expect(container.innerHTML).toBe('');
 const onChange=vi.fn();window.addEventListener(REVIEW_MARK_CHANGED_EVENT,onChange);
 await act(async()=>rememberReviewLinkMark(input));
 expect(onChange).toHaveBeenCalledOnce();expect(screen.getByText('本机评审记录')).toBeTruthy();expect(screen.getByText('真实活动')).toBeTruthy();
 expect(screen.getByLabelText('复制甲方链接')).toBeTruthy();expect(JSON.parse(localStorage.getItem(BINGO_MARK_KEY)!).length).toBe(1);
 window.removeEventListener(REVIEW_MARK_CHANGED_EVENT,onChange);
});
it('does not broadcast or show a record when storage is corrupt, write fails, or another tab holds the lock',async()=>{
 const onChange=vi.fn();window.addEventListener(REVIEW_MARK_CHANGED_EVENT,onChange);const {container}=render(<BingoAuditCard/>);
 localStorage.setItem(BINGO_MARK_KEY,'{bad');await expect(rememberReviewLinkMark(input)).rejects.toThrow(/损坏/);expect(localStorage.getItem(BINGO_MARK_KEY)).toBe('{bad');
 localStorage.removeItem(BINGO_MARK_KEY);lock(false);await expect(rememberReviewLinkMark(input)).rejects.toThrow(/另一页面/);lock();
 const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});await expect(rememberReviewLinkMark(input)).rejects.toThrow(/未能核实/);set.mockRestore();
 expect(onChange).not.toHaveBeenCalled();expect(container.innerHTML).toBe('');window.removeEventListener(REVIEW_MARK_CHANGED_EVENT,onChange);
});
it('rereads shared storage after a different tab changes it',async()=>{
 const {container}=render(<BingoAuditCard/>);expect(container.innerHTML).toBe('');
 await act(async()=>rememberReviewLinkMark(input));const value=localStorage.getItem(BINGO_MARK_KEY)!;localStorage.removeItem(BINGO_MARK_KEY);
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:BINGO_MARK_KEY,newValue:null,oldValue:value})));
 expect(container.innerHTML).toBe('');localStorage.setItem(BINGO_MARK_KEY,value);
 await act(async()=>window.dispatchEvent(new StorageEvent('storage',{key:BINGO_MARK_KEY,newValue:value,oldValue:null})));
 expect(screen.getByText('真实活动')).toBeTruthy();
});
it('does not retain a success display when storage becomes inaccessible',async()=>{
 render(<BingoAuditCard/>);await act(async()=>rememberReviewLinkMark(input));expect(screen.getByText('真实活动')).toBeTruthy();
 const getter=vi.spyOn(window,'localStorage','get').mockImplementation(()=>{throw new Error('storage denied');});
 await act(async()=>window.dispatchEvent(new Event('storage')));
 expect(screen.queryByText('真实活动')).toBeNull();getter.mockRestore();
});
it('does not broadcast if storage accepts a write without preserving it',async()=>{
 const onChange=vi.fn();window.addEventListener(REVIEW_MARK_CHANGED_EVENT,onChange);const {container}=render(<BingoAuditCard/>);
 const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{});
 await expect(rememberReviewLinkMark(input)).rejects.toThrow(/未能核实/);
 expect(localStorage.getItem(BINGO_MARK_KEY)).toBeNull();expect(onChange).not.toHaveBeenCalled();expect(container.innerHTML).toBe('');
 set.mockRestore();window.removeEventListener(REVIEW_MARK_CHANGED_EVENT,onChange);
});
