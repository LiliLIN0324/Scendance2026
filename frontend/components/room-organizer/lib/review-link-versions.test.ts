// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {rememberReviewLinkMark} from './review-share';
import {BINGO_MARK_KEY,readBingoSnapshot} from './bingo-status';
import {createActivitySessionTracker} from './activity-session-epoch';
import {createFloorSessionTracker} from './floor-session-epoch';
import {createLayoutStore} from '../hooks/use-layout-store';

function link(name:string){
 const items=Array.from({length:12},(_,index)=>makeItem({id:`chair-${index}`,name:`第 ${index} 把椅子`,position:{x:index/10,z:1}}));
 const layout=makeLayout({name,floors:[makeFloor({id:'floor-a',items})]});
 return `https://example.test/review/#layout=${Buffer.from(JSON.stringify(layout)).toString('base64url')}`;
}
const input=(clientUrl:string)=>({projectKey:'local-project',title:'活动',shareId:'local-project',clientUrl,reviewPlanKey:'legacy'});
beforeEach(()=>{localStorage.clear();vi.stubGlobal('navigator',{locks:{request:async (_name:string,_options:unknown,callback:(lock:unknown)=>unknown)=>callback({})}});});
afterEach(()=>{localStorage.clear();vi.unstubAllGlobals();});
describe('review link version preservation',()=>{
 it('keeps a complete long link and two snapshots of the same activity',async()=>{
  const first=link('第一版'),second=link('第二版');expect(first.length).toBeGreaterThan(512);
  await rememberReviewLinkMark(input(first));await rememberReviewLinkMark(input(second));await rememberReviewLinkMark(input(first));
  const plans=readBingoSnapshot(localStorage).plans;expect(plans).toHaveLength(2);
  expect(plans.map(plan=>plan.clientHref)).toEqual([second,first]);
  expect(plans.every(plan=>/^review-v2:[0-9a-f]{64}$/.test(plan.reviewPlanKey))).toBe(true);
  expect(plans[0]?.reviewPlanKey).not.toBe(plans[1]?.reviewPlanKey);
 });
 it('preserves corrupt bytes and refuses a full collection',async()=>{
  localStorage.setItem(BINGO_MARK_KEY,'{bad');await expect(rememberReviewLinkMark(input(link('新方案')))).rejects.toThrow('损坏');expect(localStorage.getItem(BINGO_MARK_KEY)).toBe('{bad');
  const old=JSON.stringify(Array.from({length:40},(_,i)=>({opaque:i})));localStorage.setItem(BINGO_MARK_KEY,old);
  await expect(rememberReviewLinkMark(input(link('新方案')))).rejects.toThrow('已满');expect(localStorage.getItem(BINGO_MARK_KEY)).toBe(old);
 });
 it('refuses credentials and query strings, and marks old clipped links as unavailable',async()=>{
  const good=link('原版');await expect(rememberReviewLinkMark(input(good.replace('https://','https://user:pass@')))).rejects.toThrow('无效');
  await expect(rememberReviewLinkMark(input(good.replace('/review/#','/review/?token=secret#')))).rejects.toThrow('无效');
  localStorage.setItem(BINGO_MARK_KEY,JSON.stringify([{saved:true,status:'needs-review',projectKey:'p',shareId:'p',title:'旧记录',markedAt:new Date().toISOString(),clientUrl:good.slice(0,512),reviewPlanKey:'link:old'}]));
  expect(readBingoSnapshot(localStorage).plans[0]).toMatchObject({linkStatus:'unavailable',clientHref:'/review/'});
 });
 it('refuses when another page owns the lock or a lock is unavailable',async()=>{
  const request=vi.fn(async (_name:string,_options:unknown,callback:(lock:unknown)=>unknown)=>callback(null));
  vi.stubGlobal('navigator',{locks:{request}});
  await expect(rememberReviewLinkMark(input(link('锁住')))).rejects.toThrow('另一页面');expect(localStorage.getItem(BINGO_MARK_KEY)).toBeNull();
  vi.stubGlobal('navigator',{});
  await expect(rememberReviewLinkMark(input(link('无锁')))).rejects.toThrow('无法安全协调');expect(localStorage.getItem(BINGO_MARK_KEY)).toBeNull();
 });
 it('does not write a stale version while the lock request is pending',async()=>{
  let release!:(lock:object)=>void,current=true;
  vi.stubGlobal('navigator',{locks:{request:(_name:string,_options:unknown,callback:(lock:object)=>unknown)=>new Promise((resolve,reject)=>{release=lock=>{try{resolve(callback(lock));}catch(error){reject(error);}};})}});
  const pending=rememberReviewLinkMark(input(link('等待锁')),{isCurrent:()=>current});
  await vi.waitFor(()=>expect(release).toBeTypeOf('function'));current=false;release({});
  await expect(pending).rejects.toThrow('活动、楼层或方案已变化');expect(localStorage.getItem(BINGO_MARK_KEY)).toBeNull();
 });
 it('rejects same-batch A → B → A using the real activity and floor trackers',async()=>{
  let release!:(lock:object)=>void;
  vi.stubGlobal('navigator',{locks:{request:(_name:string,_options:unknown,callback:(lock:object)=>unknown)=>new Promise((resolve,reject)=>{release=lock=>{try{resolve(callback(lock));}catch(error){reject(error);}};})}});
  const layout=makeLayout({id:'activity-a'}),store=createLayoutStore({layout,activeFloorIndex:0}),activity=createActivitySessionTracker(store),floor=createFloorSessionTracker(store);
  activity.start();floor.start();const token=activity.capture(),floorToken=floor.capture();
  try{
   const pending=rememberReviewLinkMark(input(link('原活动')),{isCurrent:()=>activity.isCurrent(token)&&floor.isCurrent(floorToken)});
   await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
   store.setState({layout:{...layout,id:'activity-b'}});store.setState({layout});release({});
   await expect(pending).rejects.toThrow('活动、楼层或方案已变化');expect(localStorage.getItem(BINGO_MARK_KEY)).toBeNull();
  }finally{activity.stop();floor.stop();}
 });
});
