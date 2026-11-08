// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {OriginalSceneReviewPanel,type OriginalMoveConfirmation} from './original-scene-review-panel';
import {canonical,sha256} from '../../../../supabase/functions/_shared/domain';
import type {Scene} from '../../../../supabase/functions/_shared/domain';
import {backendSceneToLayout} from '../lib/backend-adapter';
import {createActivitySessionTracker} from '../lib/activity-session-epoch';
import {createLayoutStore} from '../hooks/use-layout-store';

const hash='a'.repeat(64),candidateHash='b'.repeat(64);
const original=()=>({scene:{objects:[{id:'object-1',notes:'私密原文：消防已经合格'}]},revision:3,originalSceneHash:hash});
const candidate={objects:[{id:'object-1',position:{x:2}}]};
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('original scene review',()=>{
 it('lets the user preview an unlocked object move without changing the original or submitting',async()=>{
  const id='22222222-2222-4222-8222-222222222222',lockedId='33333333-3333-4333-8333-333333333333';
  const object={id,materialId:'chair',position:{x:2,z:3},rotation:0,size:{width:.5,depth:.5,height:.85},color:'#ffffff',locked:false,notes:'只属于原文的备注'};
  const scene={schemaVersion:1,venue:{width:12,depth:10,height:3,shape:'rectangle',entrances:[]},objects:[object,{...object,id:lockedId,locked:true,notes:''}],camera:'overview',lighting:'neutral'};
  const before=structuredClone(scene),originalSceneHash=await sha256(canonical(scene));
  render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>true} loadOriginal={async()=>({scene,revision:3,originalSceneHash})} enableLocalPreview/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  expect(screen.queryByRole('option',{name:new RegExp(lockedId)})).toBeNull();
  fireEvent.change(screen.getByLabelText('选择物件'),{target:{value:id}});
  fireEvent.change(screen.getByLabelText('横向位置（米）'),{target:{value:'4'}});
  fireEvent.click(screen.getByRole('button',{name:'预览位置差异'}));
  const diff=await screen.findByRole('list',{name:'位置差异列表'});
  expect(diff.textContent).toContain('横向：2 → 4');expect(diff.textContent).not.toContain('只属于原文的备注');
  expect(scene).toEqual(before);expect((screen.getByRole('button',{name:'确认提交修改'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('横向位置（米）'),{target:{value:'5'}});expect(screen.queryByRole('list',{name:'位置差异列表'})).toBeNull();
 });
 it('freezes the reviewed candidate, ignores duplicate clicks, and invalidates it after editing',async()=>{
  const id='22222222-2222-4222-8222-222222222222';
  const scene={schemaVersion:1,venue:{width:12,depth:10,height:3,shape:'rectangle',entrances:[]},objects:[{id,materialId:'chair',position:{x:2,z:3},rotation:0,size:{width:.5,depth:.5,height:.85},color:'#ffffff',locked:false,notes:'原文'}],camera:'overview',lighting:'neutral'};
  let finish!:(value:'blocked')=>void;const submit=vi.fn((_snapshot:OriginalMoveConfirmation,_current:()=>boolean)=>new Promise<'blocked'>(resolve=>{finish=resolve;}));
  const originalSceneHash=await sha256(canonical(scene));
  render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>true} loadOriginal={async()=>({scene,revision:3,originalSceneHash})} enableLocalPreview allowLocalConfirm onConfirmLocal={submit}/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  fireEvent.change(screen.getByLabelText('选择物件'),{target:{value:id}});fireEvent.change(screen.getByLabelText('横向位置（米）'),{target:{value:'4'}});
  fireEvent.click(screen.getByRole('button',{name:'预览位置差异'}));await screen.findByRole('list',{name:'位置差异列表'});
  const button=screen.getByRole('button',{name:'确认提交修改'});fireEvent.click(button);fireEvent.click(button);
  await waitFor(()=>expect(submit).toHaveBeenCalledTimes(1));const frozen=submit.mock.calls[0]![0];
  expect(JSON.parse(frozen.candidateText).objects[0].position.x).toBe(4);expect(frozen.baseHash).toBe(originalSceneHash);expect(frozen.revision).toBe(3);
  fireEvent.change(screen.getByLabelText('横向位置（米）'),{target:{value:'5'}});expect(submit.mock.calls[0]![1]()).toBe(false);
  await act(async()=>{finish('blocked');});expect(screen.queryByRole('list',{name:'位置差异列表'})).toBeNull();expect(JSON.parse(frozen.candidateText).objects[0].position.x).toBe(4);
 });
 it('rejects an old preview after a same-batch A → B → A generation change',async()=>{
  const id='22222222-2222-4222-8222-222222222222';
  const scene:Scene={schemaVersion:1,venue:{width:12,depth:10,height:3,shape:'rectangle',entrances:[]},objects:[{id,materialId:'chair',position:{x:2,z:3},rotation:0,size:{width:.5,depth:.5,height:.85},color:'#ffffff',locked:false,notes:''}],camera:'overview',lighting:'neutral'};
  const layout=backendSceneToLayout(scene,{projectId:'11111111-1111-4111-8111-111111111111'}),store=createLayoutStore({layout,activeFloorIndex:0}),tracker=createActivitySessionTracker(store);tracker.start();const captured=tracker.capture();
  const submit=vi.fn(async()=> 'blocked' as const),originalSceneHash=await sha256(canonical(scene));
  render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>tracker.isCurrent(captured)} loadOriginal={async()=>({scene,revision:3,originalSceneHash})} enableLocalPreview allowLocalConfirm onConfirmLocal={submit}/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  fireEvent.change(screen.getByLabelText('选择物件'),{target:{value:id}});fireEvent.change(screen.getByLabelText('横向位置（米）'),{target:{value:'4'}});
  fireEvent.click(screen.getByRole('button',{name:'预览位置差异'}));await screen.findByRole('list',{name:'位置差异列表'});
  act(()=>{store.setState({layout:{...layout,id:'another-activity'}});store.setState({layout});fireEvent.click(screen.getByRole('button',{name:'确认提交修改'}));});expect(submit).not.toHaveBeenCalled();tracker.stop();
 });
 it('does not fetch or expose raw text until the user explicitly requests it',async()=>{
  const read=vi.fn(async()=>original());render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>true} loadOriginal={read}/>);
  expect(read).not.toHaveBeenCalled();expect(screen.queryByText(/私密原文/)).toBeNull();
  expect((screen.getByRole('button',{name:'确认提交修改'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));
  expect((await screen.findByLabelText('授权查看的原始记录')).textContent).toContain('私密原文：消防已经合格');
  expect(screen.getByText(/模型文字不代表安全或规范验收/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'收起原文'}));expect(screen.queryByText(/私密原文/)).toBeNull();
 });
 it('downloads the raw record only on an explicit click',async()=>{
  const create=vi.fn().mockReturnValue('blob:test'),revoke=vi.fn();
  Object.defineProperty(URL,'createObjectURL',{configurable:true,writable:true,value:create});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,writable:true,value:revoke});
  const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>true} loadOriginal={async()=>original()}/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  expect(create).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'下载原始记录'}));
  expect(create).toHaveBeenCalledOnce();expect(click).toHaveBeenCalledOnce();expect(revoke).toHaveBeenCalledWith('blob:test');
 });
 it('shows neutral per-field differences without presenting free text as safety conclusions',async()=>{
  const prepare=vi.fn(async()=>({baseHash:hash,candidateHash,changes:[
    {path:'/objects/0/position/x',before:{present:true,value:1},after:{present:true,value:2}},
    {path:'/objects/0/notes',before:{present:true,value:'消防已经合格'},after:{present:true,value:'无障碍全部通过'}},
  ]}));
  render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>true} loadOriginal={async()=>({scene:{objects:[]},revision:3,originalSceneHash:hash})} candidate={candidate} prepareReview={prepare}/>);
  expect(prepare).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  fireEvent.click(screen.getByRole('button',{name:'生成差异预览'}));const list=await screen.findByRole('list',{name:'候选差异列表'});
  expect(list.textContent).toContain('物件 · 第 1 项 · 位置 · 横向：1 → 2');
  expect(list.textContent).not.toMatch(/消防已经合格|无障碍全部通过/);expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(screen.getByRole('alert').textContent).toContain('不能确认提交');
  expect((screen.getByRole('button',{name:'确认提交修改'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/不能提交修改/)).toBeTruthy();expect(prepare).toHaveBeenCalledWith({originalSceneHash:hash,revision:3,candidate});
 });
 it('blocks confirmation when a name or nested value is not understandable',async()=>{
  const prepare=async()=>({baseHash:hash,candidateHash,changes:[
   {path:'/objects/0/name',before:{present:true,value:'原名称'},after:{present:true,value:'新名称'}},
   {path:'/objects/0/custom/length',before:{present:true,value:1},after:{present:true,value:2}},
  ]});
  render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>true} loadOriginal={async()=>original()} candidate={candidate} prepareReview={prepare}/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  fireEvent.click(screen.getByRole('button',{name:'生成差异预览'}));await screen.findByRole('list',{name:'候选差异列表'});
  expect(screen.getByRole('alert').textContent).toContain('不能确认提交');expect((screen.getByRole('button',{name:'确认提交修改'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('shows added object identity, material and count without displaying free text',async()=>{
  const id='22222222-2222-4222-8222-222222222222';
  const prepare=async()=>({baseHash:hash,candidateHash,changes:[
   {path:`/objects/by-id/${id}/id`,before:{present:false},after:{present:true,value:id}},
   {path:`/objects/by-id/${id}/materialId`,before:{present:false},after:{present:true,value:'chair'}},
  ]});
  render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>true} loadOriginal={async()=>original()} candidate={candidate} prepareReview={prepare}/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  fireEvent.click(screen.getByRole('button',{name:'生成差异预览'}));const list=await screen.findByRole('list',{name:'候选差异列表'});
  expect(list.textContent).toContain(id);expect(list.textContent).toContain('椅子');expect(screen.getByText(/新增物件 1 件；移除物件 0 件/)).toBeTruthy();
 });
 it('ignores an old read result after the activity changes or its token is revoked',async()=>{
  let finish!:(value:ReturnType<typeof original>)=>void,current=true;
  const read=vi.fn(()=>new Promise<ReturnType<typeof original>>(resolve=>{finish=resolve;}));
  const view=render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>current} loadOriginal={read}/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));
  current=false;view.rerender(<OriginalSceneReviewPanel scopeKey="B" isCurrent={()=>true} loadOriginal={async()=>original()}/>);
  await act(async()=>{finish(original());await Promise.resolve();});expect(screen.queryByText(/私密原文/)).toBeNull();
 });
 it('does not accept a stale candidate or mismatched server hash',async()=>{
  let finish!:(value:{baseHash:string;candidateHash:string;changes:[]})=>void;
  const prepare=vi.fn(()=>new Promise<{baseHash:string;candidateHash:string;changes:[]}>(resolve=>{finish=resolve;}));
  const read=async()=>original();const check=()=>true;
  const view=render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={check} loadOriginal={read} candidate={candidate} prepareReview={prepare}/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  fireEvent.click(screen.getByRole('button',{name:'生成差异预览'}));
  view.rerender(<OriginalSceneReviewPanel scopeKey="A" isCurrent={check} loadOriginal={read} candidate={{...candidate,other:true}} prepareReview={prepare}/>);
  await act(async()=>{finish({baseHash:hash,candidateHash,changes:[]});await Promise.resolve();});
  expect(screen.queryByRole('list',{name:'候选差异列表'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'生成差异预览'}));
  await act(async()=>{finish({baseHash:'c'.repeat(64),candidateHash,changes:[]});await Promise.resolve();});
  expect(await screen.findByText('差异预览未能完成，请核对当前记录后重试。')).toBeTruthy();
  expect((screen.getByRole('button',{name:'确认提交修改'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('hides previously loaded raw data and previews when the session token or candidate changes',async()=>{
  const check=()=>true,read=async()=>original();
  const prepare=async()=>({baseHash:hash,candidateHash,changes:[{path:'/objects/0/position/x',before:{present:true,value:1},after:{present:true,value:2}}]});
  const view=render(<OriginalSceneReviewPanel scopeKey="A" isCurrent={check} loadOriginal={read} candidate={candidate} prepareReview={prepare}/>);
  fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
  fireEvent.click(screen.getByRole('button',{name:'生成差异预览'}));await screen.findByRole('list',{name:'候选差异列表'});
  view.rerender(<OriginalSceneReviewPanel scopeKey="A" isCurrent={check} loadOriginal={read} candidate={{...candidate,other:true}} prepareReview={prepare}/>);
  expect(screen.queryByRole('list',{name:'候选差异列表'})).toBeNull();expect(screen.getByLabelText('授权查看的原始记录')).toBeTruthy();
  view.rerender(<OriginalSceneReviewPanel scopeKey="A" isCurrent={()=>true} loadOriginal={read} candidate={candidate} prepareReview={prepare}/>);
  expect(screen.queryByLabelText('授权查看的原始记录')).toBeNull();expect(screen.queryByRole('list',{name:'候选差异列表'})).toBeNull();
 });

});
