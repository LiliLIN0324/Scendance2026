// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import { BackendSession,getBackendConfig,type ReconstructionJob } from '@/lib/backend-session';
import { backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene } from '../lib/backend-adapter';
import { INITIAL_BRIEF } from '../lib/creative-brief';
import { flushSourceScope,readSourceForm,storeSourceForm } from '@/lib/source-storage';
import { referenceSceneBasis,resolveReferenceImage } from '@/lib/reference-image';
import type { RoomLayout } from '../lib/types';
import { ReconstructionPanel } from './reconstruction-panel';
vi.mock('@/lib/source-storage',async importOriginal=>({...await importOriginal<object>(),readSourceForm:vi.fn().mockResolvedValue(undefined),storeSourceForm:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../contexts',()=>({useSelection:()=>({allSelectedIds:new Set<string>(),selectOnly:vi.fn()})}));
const projectId='10000000-0000-4000-8000-000000000001',assetId='20000000-0000-4000-8000-000000000001',jobId='30000000-0000-4000-8000-000000000001';
const scene={schemaVersion:1 as const,venue:{width:12,depth:8,height:3,shape:'rectangle' as const,entrances:[]},objects:[],camera:'overview' as const,lighting:'neutral' as const};
const layout=backendSceneToLayout(scene,{projectId});
const image={id:assetId,assetId,name:'现场.png',kind:'photo' as const,width:1000,height:600,url:'blob:photo'};
let controller:BackendSession;
beforeEach(()=>{
 vi.mocked(readSourceForm).mockReset().mockResolvedValue(undefined);vi.mocked(storeSourceForm).mockReset().mockResolvedValue(undefined);
 controller=new BackendSession(getBackendConfig({url:'http://localhost:54321',anonKey:'public'}));
 const snapshot={...controller.getSnapshot(),user:{id:'user'},project:{id:projectId,studio_id:'studio',name:'测试',revision:1,scene},lease:{projectId,sessionId:'40000000-0000-4000-8000-000000000001',generation:1,revision:1,expiresAt:new Date(Date.now()+100000).toISOString()},revision:1,writeBlocked:false};
 vi.spyOn(controller,'getSnapshot').mockReturnValue(snapshot);
});
describe('local applied reference mapping',()=>{
 const measured=createMeasuredRoomLayout(layout,{width:12,depth:8,height:3});
 const sourceA={id:'local-reference-a',name:'A-原图.png',kind:'floorplan' as const,width:1000,height:600,url:'blob:reference-a',blob:new Blob(['A'])};
 const sourceB={...sourceA,id:'local-reference-b',name:'B-原图.png',url:'blob:reference-b',blob:new Blob(['B'])};
 function memory(initial:unknown=undefined){const forms=new Map<string,unknown>([[projectId,initial]]);vi.mocked(readSourceForm).mockImplementation(async scope=>forms.get(scope) as never);vi.mocked(storeSourceForm).mockImplementation(async(scope,value)=>{forms.set(scope,value);});return(scope=projectId)=>(forms.get(scope)??{}) as {registration?:import('@/lib/reference-image').ReferenceRegistration};}
 function open(current:RoomLayout=measured,images=[sourceA],extra:Partial<React.ComponentProps<typeof ReconstructionPanel>>={}){
  return render(<ReconstructionPanel controller={controller} layout={current} onApply={vi.fn()} images={images} updateImage={vi.fn()} brief={INITIAL_BRIEF} openReferenceRequest={1} {...extra}/>);
 }
 function point(x:number,z:number){const map=screen.getByRole('button',{name:'标记图纸与场地的三个对应点'});vi.spyOn(map,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:1000,height:600,right:1000,bottom:600,x:0,y:0,toJSON:()=>({})});fireEvent.click(map,{clientX:x,clientY:z});}
 function mark(){fireEvent.click(screen.getByRole('button',{name:'重新标记三个对应点'}));point(10,20);point(610,20);point(10,420);}
 it('reads the original persisted form, keeps legacy points unadopted, and confirms a local v2 image without AI or cloud registration',async()=>{
  const saved=memory({registration:{sourceId:sourceA.id,points:[{x:10,z:20},{x:610,z:20},{x:10,z:420}]}});
  const create=vi.spyOn(controller,'createReconstruction'),upload=vi.spyOn(controller,'uploadSource');open();
  await screen.findByText('原对应未绑定当前场地尺寸，已停用，请重新标记。');
  expect(resolveReferenceImage(measured,[{...sourceA,scope:projectId}],saved()).status).toBe('needs-review');
  mark();expect(saved().registration?.appliedBasis).toBeUndefined();
  fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));
  await screen.findByText('本机原图对应已核对，仅在此浏览器使用。',{selector:'p[role="status"]'});
  expect(saved().registration).toMatchObject({sourceId:sourceA.id,worldWidth:12,worldDepth:8,imageWidth:1000,imageHeight:600,appliedBasis:referenceSceneBasis(measured),confirmationId:expect.any(String)});
  expect(saved().registration!.sourceAssetId).toBeUndefined();expect(measured.backendSceneV2!.sources).toEqual([]);
  expect(resolveReferenceImage(measured,[{...sourceA,scope:projectId}],saved()).status).toBe('ready');expect(readSourceForm).toHaveBeenCalledWith(projectId);
  expect(create).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();
 });
 it('cancels A sampling after two points when switching to B, so B third click cannot relabel A points',async()=>{
  const saved=memory();open(measured,[sourceA,sourceB]);await waitFor(()=>expect(readSourceForm).toHaveBeenCalledWith(projectId));
  fireEvent.click(screen.getByRole('button',{name:'重新标记三个对应点'}));point(10,20);point(610,20);
  await waitFor(()=>expect(saved().registration?.points).toHaveLength(2));
  fireEvent.change(screen.getByLabelText('核对平面图'),{target:{value:sourceB.id}});point(10,420);
  expect(screen.getByText(/已标记 0\/3 个点/)).toBeDefined();
  expect((screen.getByRole('button',{name:'在当前设计中使用此对应'}) as HTMLButtonElement).disabled).toBe(true);
  expect(saved().registration?.sourceId).toBe(sourceA.id);expect(saved().registration?.points).toHaveLength(2);
  mark();fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));
  await screen.findByText('本机原图对应已核对，仅在此浏览器使用。',{selector:'p[role="status"]'});
  expect(saved().registration?.sourceId).toBe(sourceB.id);expect(saved().registration?.points).toHaveLength(3);
 });
 it('uses the existing upload action and explicitly selected photo record as a floorplan, with no recognition call',async()=>{
  memory();const add=vi.fn().mockResolvedValue(undefined),update=vi.fn();const create=vi.spyOn(controller,'createReconstruction');
  const view=open(measured,[],{onAddReferenceImages:add,updateImage:update});await waitFor(()=>expect(readSourceForm).toHaveBeenCalledWith(projectId));
  const file=new File(['local'],'plan.png',{type:'image/png'});fireEvent.change(screen.getByLabelText('上传核对平面图'),{target:{files:[file]}});
  expect(add).toHaveBeenCalledWith([file]);
  view.rerender(<ReconstructionPanel controller={controller} layout={measured} onApply={vi.fn()} images={[{...sourceA,kind:'photo'}]} updateImage={update} brief={INITIAL_BRIEF} openReferenceRequest={1} onAddReferenceImages={add}/>);
  fireEvent.change(screen.getByLabelText('核对平面图'),{target:{value:sourceA.id}});expect(update).toHaveBeenCalledWith(sourceA.id,{kind:'floorplan'});expect(create).not.toHaveBeenCalled();
 });
 it('keeps the applied mapping while walls are edited against the same fixed coordinate frame',async()=>{
  const saved=memory({registration:{sourceId:sourceA.id,points:[{x:10,z:20},{x:610,z:20},{x:10,z:420}],worldWidth:12,worldDepth:8,imageWidth:1000,imageHeight:600,appliedBasis:referenceSceneBasis(measured),confirmationId:'before'}});
  const view=open();await waitFor(()=>expect(screen.getByText('本机原图对应已核对，仅在此浏览器使用。')).toBeDefined());
  const changed={...measured,floors:[{...measured.floors[0]!,interiorWalls:measured.floors[0]!.interiorWalls!.map((wall,index)=>index===0?{...wall,thickness:wall.thickness!+.02}:wall)}]};
  view.rerender(<ReconstructionPanel controller={controller} layout={changed} onApply={vi.fn()} images={[sourceA]} updateImage={vi.fn()} brief={INITIAL_BRIEF} openReferenceRequest={1}/>);
  expect(screen.queryByText('项目或场地坐标范围已变化，原图对应已停用，请重新核对。')).toBeNull();
  expect(resolveReferenceImage(changed,[{...sourceA,scope:projectId}],saved()).status).toBe('ready');
 });
 it('cancels a partial sampling session when the world frame changes and never reinterprets its old points',async()=>{
  const saved=memory();const view=open();await waitFor(()=>expect(readSourceForm).toHaveBeenCalledWith(projectId));
  fireEvent.click(screen.getByRole('button',{name:'重新标记三个对应点'}));point(10,20);point(610,20);
  const resized=createMeasuredRoomLayout(layout,{width:16,depth:8,height:3});
  view.rerender(<ReconstructionPanel controller={controller} layout={resized} onApply={vi.fn()} images={[sourceA]} updateImage={vi.fn()} brief={INITIAL_BRIEF} openReferenceRequest={1}/>);
  point(10,420);expect(screen.getByText('原对应未绑定当前场地尺寸，已停用，请重新标记。')).toBeDefined();
  expect((screen.getByRole('button',{name:'在当前设计中使用此对应'}) as HTMLButtonElement).disabled).toBe(true);
  mark();fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));
  await screen.findByText('本机原图对应已核对，仅在此浏览器使用。',{selector:'p[role="status"]'});
  expect(saved().registration?.worldWidth).toBe(16);const result=resolveReferenceImage(resized,[{...sourceA,scope:projectId}],saved());
  expect(result.status).toBe('ready');const [a,,c,,e]=result.imageToWorld!;expect(a*610+c*20+e).toBeCloseTo(16);
 });
 it('keeps the mapping unadopted when the confirmation save fails',async()=>{
  const saved=memory();open();await waitFor(()=>expect(readSourceForm).toHaveBeenCalledWith(projectId));mark();
  vi.mocked(storeSourceForm).mockRejectedValueOnce(new Error('本机对应保存失败'));
  fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));await screen.findByText('本机对应保存失败');
  expect(saved().registration?.appliedBasis).toBeUndefined();
  expect(screen.queryByText('本机原图对应已核对，仅在此浏览器使用。',{selector:'p[role="status"]'})).toBeNull();
 });
 it('serializes an already-started old form write before manual confirmation and scope flush, preserving newer body input',async()=>{
  const saved=memory();open();await waitFor(()=>expect(readSourceForm).toHaveBeenCalledWith(projectId));await act(async()=>{await Promise.resolve();});vi.useFakeTimers();mark();
  const baseWrite=vi.mocked(storeSourceForm).getMockImplementation()!;let release!:()=>void;const old=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(storeSourceForm).mockImplementationOnce(async(scope,value)=>{await old;await baseWrite(scope,value);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
  expect(storeSourceForm).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));
  fireEvent.change(screen.getByLabelText('补充尺寸'),{target:{value:'确认期间的新文字'}});
  const flush=flushSourceScope(projectId);await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  expect(storeSourceForm).toHaveBeenCalledOnce();expect(saved().registration?.appliedBasis).toBeUndefined();
  await act(async()=>{release();await flush;});
  expect(saved()).toMatchObject({text:'确认期间的新文字',registration:{appliedBasis:referenceSceneBasis(measured),confirmationId:expect.any(String)}});
  expect(resolveReferenceImage(measured,[{...sourceA,scope:projectId}],saved()).status).toBe('ready');
  await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
  expect(resolveReferenceImage(measured,[{...sourceA,scope:projectId}],saved()).status).toBe('ready');
 });
 it('rolls back a confirmation whose write completes after A→B→A instead of adopting its canceled stamp',async()=>{
  const saved=memory({text:'A-原正文'});const view=open();await waitFor(()=>expect(readSourceForm).toHaveBeenCalledWith(projectId));mark();
  const baseWrite=vi.mocked(storeSourceForm).getMockImplementation()!;let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(storeSourceForm).mockImplementationOnce(async(scope,value)=>{await held;await baseWrite(scope,value);});
  fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));await waitFor(()=>expect(storeSourceForm).toHaveBeenCalledOnce());
  view.rerender(<ReconstructionPanel controller={controller} layout={{...measured,id:'other-local-project'}} onApply={vi.fn()} images={[]} updateImage={vi.fn()} brief={INITIAL_BRIEF} openReferenceRequest={1}/>);
  view.rerender(<ReconstructionPanel controller={controller} layout={measured} onApply={vi.fn()} images={[sourceA]} updateImage={vi.fn()} brief={INITIAL_BRIEF} openReferenceRequest={1}/>);
  await act(async()=>{release();});await waitFor(()=>expect(storeSourceForm).toHaveBeenCalledTimes(2));
  expect(saved().registration?.appliedBasis).toBeUndefined();expect(saved()).toMatchObject({text:'A-原正文'});
  expect(resolveReferenceImage(measured,[{...sourceA,scope:projectId}],saved()).status).toBe('needs-review');
  expect(screen.queryByText('本机原图对应已核对，仅在此浏览器使用。',{selector:'p[role="status"]'})).toBeNull();
 });
});
afterEach(()=>{cleanup();controller.dispose();vi.restoreAllMocks();vi.useRealTimers();});
function openInputs(){fireEvent.click(screen.getByText('图纸与照片重建'));}
function ui(){const view=render(<ReconstructionPanel controller={controller} layout={layout} onApply={vi.fn()} images={[image]} updateImage={vi.fn()} brief={{...INITIAL_BRIEF,description:'保留结构，活动布置'}}/>);openInputs();return view;}
function measures(){fireEvent.change(screen.getByLabelText('总宽（米）'),{target:{value:'12'}});fireEvent.change(screen.getByLabelText('总深（米）'),{target:{value:'8'}});fireEvent.change(screen.getByLabelText('层高（米）'),{target:{value:'3'}});}
describe('reconstruction entry',()=>{
 it.each(['request','job'] as const)('explains an unconfigured recognition service from the %s and preserves the canvas',async origin=>{
  const create=vi.spyOn(controller,'createReconstruction');
  if(origin==='request')create.mockRejectedValue(Object.assign(new Error('SERVICE_NOT_CONFIGURED'),{code:'SERVICE_NOT_CONFIGURED'}));
  else create.mockResolvedValue({id:jobId,state:'failed',issues:[],error_code:'SERVICE_NOT_CONFIGURED'});
  const onApply=vi.fn();
  render(<ReconstructionPanel controller={controller} layout={layout} onApply={onApply} images={[image]} updateImage={vi.fn()} brief={INITIAL_BRIEF}/>);
  openInputs();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Generate 重建并设计方案'}).hasAttribute('disabled')).toBe(false));measures();
  fireEvent.click(screen.getByRole('radio',{name:/重新布置/}));fireEvent.click(screen.getByRole('button',{name:'Generate 重建并设计方案'}));
  openInputs();
  const error=await screen.findByText('识别服务尚未配置，资料和当前场景已保留。');
  expect(error.closest('details')).toBeNull();
  expect((screen.getByRole('button',{name:'Generate 重建并设计方案'}).closest('details') as HTMLDetailsElement).open).toBe(false);
  expect(screen.queryByText(/SERVICE_NOT_CONFIGURED/)).toBeNull();expect(onApply).not.toHaveBeenCalled();
  expect((screen.getByLabelText('总宽（米）') as HTMLInputElement).value).toBe('12');
 });

 it('plans an existing confirmed v2 without requiring fresh images or dimensions',async()=>{
   const measured=createMeasuredRoomLayout(layout,{width:12,depth:8,height:3});
   const create=vi.spyOn(controller,'createReconstruction').mockResolvedValue({id:jobId,state:'failed',issues:[],error_code:'TEST_PROVIDER'});
   render(<ReconstructionPanel controller={controller} layout={measured} onApply={vi.fn()} images={[]} updateImage={vi.fn()} brief={{...INITIAL_BRIEF,description:'只改成森林主题'}}/>);
   openInputs();
   await waitFor(()=>expect(screen.getByRole('button',{name:'Generate 重建并设计方案'}).hasAttribute('disabled')).toBe(false));
   fireEvent.click(screen.getByRole('button',{name:'Generate 重建并设计方案'}));await waitFor(()=>expect(create).toHaveBeenCalledOnce());
   expect(create.mock.calls[0]![0]).toMatchObject({sources:[],mode:'redesign',reviewedScene:{schemaVersion:2}});expect(create.mock.calls[0]![0].reviewedScene).toEqual(create.mock.calls[0]![0].scene);
 });

 it('requires an explicit photo mode before submitting and resets it for the next run',async()=>{
  const create=vi.spyOn(controller,'createReconstruction').mockResolvedValue({id:jobId,state:'failed',issues:[],error_code:'MODEL_UNAVAILABLE'});
  ui();await waitFor(()=>expect(screen.getByRole('button',{name:'Generate 重建并设计方案'}).hasAttribute('disabled')).toBe(false));measures();
  fireEvent.click(screen.getByRole('button',{name:'Generate 重建并设计方案'}));
  expect(await screen.findByText(/本次包含现场照片，请先选择/)).toBeTruthy();expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio',{name:/重新布置/}));fireEvent.click(screen.getByRole('button',{name:'Generate 重建并设计方案'}));
  await waitFor(()=>expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0]![0]).toMatchObject({mode:'redesign',sources:[{assetId,kind:'photo'}],dimensions:[{kind:'width',valueMeters:12},{kind:'depth',valueMeters:8},{kind:'height',valueMeters:3}]});
  await waitFor(()=>expect((screen.getByRole('radio',{name:/重新布置/}) as HTMLInputElement).checked).toBe(false));
 });
 it('retries uncertain failure with the same paid request and dimension identities',async()=>{
  const create=vi.spyOn(controller,'createReconstruction').mockRejectedValue(new Error('network interrupted'));
  ui();await waitFor(()=>expect(screen.getByRole('button',{name:'Generate 重建并设计方案'}).hasAttribute('disabled')).toBe(false));measures();
  fireEvent.click(screen.getByRole('radio',{name:/还原现场/}));fireEvent.click(screen.getByRole('button',{name:'Generate 重建并设计方案'}));await screen.findByText('network interrupted');
  fireEvent.click(screen.getByRole('button',{name:'Generate 重建并设计方案'}));await waitFor(()=>expect(create).toHaveBeenCalledTimes(2));expect(create.mock.calls[1]![0]).toEqual(create.mock.calls[0]![0]);
 });
 it('allows correcting review dimensions then continuing without requiring a fresh recognition',async()=>{
  const measured=layoutToBackendScene(createMeasuredRoomLayout(layout,{width:12,depth:8,height:3}));
  if(measured.schemaVersion!==2)throw new Error('expected v2');
  const job:ReconstructionJob={id:jobId,state:'needs_review',candidate:measured,issues:[{code:'UNSEEN',message:'核对不可见结构'}]};
  const create=vi.spyOn(controller,'createReconstruction').mockResolvedValue(job);
  ui();await waitFor(()=>expect(screen.getByRole('button',{name:'Generate 重建并设计方案'}).hasAttribute('disabled')).toBe(false));measures();fireEvent.click(screen.getByRole('radio',{name:/还原现场/}));fireEvent.click(screen.getByRole('button',{name:'Generate 重建并设计方案'}));
  await screen.findByText('核对不可见结构');fireEvent.change(screen.getByLabelText('层高（米）'),{target:{value:'3.2'}});
  fireEvent.click(screen.getByRole('checkbox',{name:/我已核对所有墙段/}));fireEvent.click(screen.getByRole('radio',{name:/还原现场/}));
  expect(screen.getByRole('button',{name:'确认结构并继续设计'}).hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'确认结构并继续设计'}));await waitFor(()=>expect(create).toHaveBeenCalledTimes(2));expect(create.mock.calls[1]![0].reviewedScene?.structure.walls.every(w=>w.status==='confirmed')).toBe(true);
 });
});
