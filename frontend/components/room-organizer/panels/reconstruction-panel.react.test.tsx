// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import { BackendSession,getBackendConfig,type ReconstructionJob } from '@/lib/backend-session';
import { backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene } from '../lib/backend-adapter';
import { INITIAL_BRIEF } from '../lib/creative-brief';
import { ReconstructionPanel } from './reconstruction-panel';
vi.mock('@/lib/source-storage',async importOriginal=>({...await importOriginal<object>(),readSourceForm:async()=>undefined,storeSourceForm:async()=>{}}));
vi.mock('../contexts',()=>({useSelection:()=>({allSelectedIds:new Set<string>(),selectOnly:vi.fn()})}));
const projectId='10000000-0000-4000-8000-000000000001',assetId='20000000-0000-4000-8000-000000000001',jobId='30000000-0000-4000-8000-000000000001';
const scene={schemaVersion:1 as const,venue:{width:12,depth:8,height:3,shape:'rectangle' as const,entrances:[]},objects:[],camera:'overview' as const,lighting:'neutral' as const};
const layout=backendSceneToLayout(scene,{projectId});
const image={id:assetId,assetId,name:'现场.png',kind:'photo' as const,width:1000,height:600,url:'blob:photo'};
let controller:BackendSession;
beforeEach(()=>{
 controller=new BackendSession(getBackendConfig({url:'http://localhost:54321',anonKey:'public'}));
 const snapshot={...controller.getSnapshot(),user:{id:'user'},project:{id:projectId,studio_id:'studio',name:'测试',revision:1,scene},lease:{projectId,sessionId:'40000000-0000-4000-8000-000000000001',generation:1,revision:1,expiresAt:new Date(Date.now()+100000).toISOString()},revision:1,writeBlocked:false};
 vi.spyOn(controller,'getSnapshot').mockReturnValue(snapshot);
});
afterEach(()=>{cleanup();controller.dispose();vi.restoreAllMocks();});
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
