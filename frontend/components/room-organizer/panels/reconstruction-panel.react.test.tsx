// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import { BackendSession,getBackendConfig,type ReconstructionJob,type SceneProposal } from '@/lib/backend-session';
import { readMaterialCheckins } from '@/lib/material-checkin-storage';
import { referenceSceneBasis,resolveReferenceImage } from '@/lib/reference-image';
import { flushSourceScope,readSourceForm,storeSourceForm } from '@/lib/source-storage';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene } from '../lib/backend-adapter';
import { INITIAL_BRIEF } from '../lib/creative-brief';
import { ReconstructionPanel } from './reconstruction-panel';
import type { RoomLayout } from '../lib/types';
vi.mock('@/lib/source-storage',async importOriginal=>({...await importOriginal<object>(),readSourceForm:vi.fn().mockResolvedValue(undefined),storeSourceForm:vi.fn().mockResolvedValue(undefined)}));
vi.mock('@/lib/material-checkin-storage',()=>({readMaterialCheckins:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../contexts',()=>({useSelection:()=>({allSelectedIds:new Set<string>(),selectOnly:vi.fn()})}));
const projectId='10000000-0000-4000-8000-000000000001',assetId='20000000-0000-4000-8000-000000000001',jobId='30000000-0000-4000-8000-000000000001';
const scene={schemaVersion:1 as const,venue:{width:12,depth:8,height:3,shape:'rectangle' as const,entrances:[]},objects:[],camera:'overview' as const,lighting:'neutral' as const};
const layout=backendSceneToLayout(scene,{projectId});
const image={id:assetId,assetId,name:'现场.png',kind:'photo' as const,width:1000,height:600,url:'blob:photo'};
let controller:BackendSession;
beforeEach(()=>{
 vi.mocked(readMaterialCheckins).mockReset().mockResolvedValue(undefined);
 vi.mocked(readSourceForm).mockReset().mockResolvedValue(undefined);vi.mocked(storeSourceForm).mockReset().mockResolvedValue(undefined);
 controller=new BackendSession(getBackendConfig({url:'http://localhost:54321',anonKey:'public'}));
 const snapshot={...controller.getSnapshot(),user:{id:'user'},project:{id:projectId,studio_id:'studio',name:'测试',revision:1,scene},lease:{projectId,sessionId:'40000000-0000-4000-8000-000000000001',generation:1,revision:1,expiresAt:new Date(Date.now()+100000).toISOString()},revision:1,writeBlocked:false};
 vi.spyOn(controller,'getSnapshot').mockReturnValue(snapshot);
});
describe('reconstruction form read protection',()=>{
 it('never overwrites saved registration after a failed read, including an explicit flush, and retries the original data',async()=>{
  const measured=createMeasuredRoomLayout(layout,{width:12,depth:8,height:3});
  const original={width:'12',depth:'8',height:'3',text:'原图纸说明',constraints:[],registration:{sourceId:'original-reference',
   points:[{x:10,z:20},{x:610,z:20},{x:10,z:420}],worldWidth:12,worldDepth:8,imageWidth:1000,imageHeight:600,
   appliedBasis:referenceSceneBasis(measured),confirmationId:'original-confirmation'}};
  let stored:unknown=structuredClone(original);
  vi.mocked(readSourceForm).mockRejectedValueOnce(new Error('Transient read failure')).mockImplementation(async()=>stored as never);
  vi.mocked(storeSourceForm).mockImplementation(async(_scope,value)=>{stored=structuredClone(value);});
  render(<ReconstructionPanel controller={controller} layout={measured} onApply={vi.fn()} images={[]} updateImage={vi.fn()} brief={INITIAL_BRIEF}/>);
  await waitFor(()=>expect(readSourceForm).toHaveBeenCalledOnce());
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300));});
  expect(storeSourceForm).not.toHaveBeenCalled();expect(stored).toEqual(original);
  expect(screen.getByRole('alert').textContent).toContain('读取失败');
  expect(screen.getByLabelText('总宽（米）').matches(':disabled')).toBe(true);
  await expect(flushSourceScope(projectId)).rejects.toThrow('读取');
  expect(storeSourceForm).not.toHaveBeenCalled();expect(stored).toEqual(original);
  fireEvent.click(screen.getByRole('button',{name:'重试读取图纸资料'}));
  await waitFor(()=>expect((screen.getByLabelText('总宽（米）') as HTMLInputElement).value).toBe('12'));
  await act(async()=>{await flushSourceScope(projectId);});
  expect(stored).toMatchObject(original);
 });
 it('blocks a flush already waiting for a read that later fails',async()=>{
  let fail!:(error:Error)=>void;
  vi.mocked(readSourceForm).mockImplementation(()=>new Promise((_resolve,reject)=>{fail=reject;}));
  render(<ReconstructionPanel controller={controller} layout={layout} onApply={vi.fn()} images={[]} updateImage={vi.fn()} brief={INITIAL_BRIEF}/>);
  await waitFor(()=>expect(readSourceForm).toHaveBeenCalledOnce());
  const flushed=flushSourceScope(projectId).catch(error=>error as Error);
  await act(async()=>fail(new Error('Read interrupted')));
  expect(await flushed).toMatchObject({message:expect.stringContaining('读取')});
  expect(storeSourceForm).not.toHaveBeenCalled();
 });
 it.each([null,[],{width:12},{constraints:{}}])('does not replace an unreadable saved form %j with defaults',async invalid=>{
  vi.mocked(readSourceForm).mockResolvedValue(invalid as never);
  render(<ReconstructionPanel controller={controller} layout={layout} onApply={vi.fn()} images={[]} updateImage={vi.fn()} brief={INITIAL_BRIEF}/>);
  await screen.findByRole('alert');
  await expect(flushSourceScope(projectId)).rejects.toThrow('读取');
  expect(storeSourceForm).not.toHaveBeenCalled();
 });
 it('permits a genuinely absent record to be edited and saved',async()=>{
  render(<ReconstructionPanel controller={controller} layout={layout} onApply={vi.fn()} images={[]} updateImage={vi.fn()} brief={INITIAL_BRIEF}/>);
  await waitFor(()=>expect(screen.getByLabelText('总宽（米）').matches(':disabled')).toBe(false));
  fireEvent.change(screen.getByLabelText('总宽（米）'),{target:{value:'15'}});
  await act(async()=>{await flushSourceScope(projectId);});
  expect(storeSourceForm).toHaveBeenLastCalledWith(projectId,expect.objectContaining({width:'15'}));
 });
});
describe('manual editing of an applied venue',()=>{
 function measured(){
  const base=createMeasuredRoomLayout(layout,{width:12,depth:8,height:3});
  const current=layoutToBackendScene(base);if(current.schemaVersion!==2)throw new Error('v2');
  current.structure.openings=[{id:'50000000-0000-4000-8000-000000000001',wallId:current.structure.walls[1]!.id,kind:'door',offset:2,width:1.2,height:2.1,sillHeight:0,status:'confirmed'}];
  return backendSceneToLayout(current,{projectId});
 }
 function mount(base=measured(),extra:Partial<React.ComponentProps<typeof ReconstructionPanel>>={}){
  const apply=vi.fn(),preview=vi.fn(),create=vi.spyOn(controller,'createReconstruction'),upload=vi.spyOn(controller,'uploadSource');
  const props={controller,layout:base,onApply:apply,onPreview:preview,images:[],updateImage:vi.fn(),brief:INITIAL_BRIEF,...extra};
  return {view:render(<ReconstructionPanel {...props}/>),apply,preview,create,upload,props,base};
 }
 async function start(){await waitFor(()=>expect((screen.getByRole('button',{name:'编辑当前场地'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'编辑当前场地'}));}
 function width(value='14'){fireEvent.change(screen.getByLabelText('编辑总宽（米）'),{target:{value}});}
 function confirm(){fireEvent.click(screen.getByLabelText('我已核对修改后的尺寸、门窗位置和现场条件'));fireEvent.click(screen.getByRole('button',{name:'确认应用场地修改'}));}
 it('previews and cancels without changing the scene or making recognition calls',async()=>{
  const {apply,preview,create,upload,base}=mount();const before=JSON.stringify(base);await start();width();
  await waitFor(()=>expect(preview.mock.calls.at(-1)?.[0]?.width).toBe(14));
  expect(screen.getByText('门洞 1 的位置或尺寸有变化，请核对图中橙色标记。')).toBeDefined();
  expect(apply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'取消场地编辑'}));
  await waitFor(()=>expect(preview.mock.calls.at(-1)?.[0]).toBeNull());expect(JSON.stringify(base)).toBe(before);
  expect(apply).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();
 });
 it('requires a fresh human check after each edit and applies once through the original callback',async()=>{
  const trial=mount(),{apply,create,upload}=trial;await start();width();
  expect((screen.getByRole('button',{name:'确认应用场地修改'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText('我已核对修改后的尺寸、门窗位置和现场条件'));width('15');
  expect((screen.getByLabelText('我已核对修改后的尺寸、门窗位置和现场条件') as HTMLInputElement).checked).toBe(false);
  fireEvent.change(screen.getByLabelText('门洞 1 · 宽度（米）'),{target:{value:'1.4'}});confirm();
  expect(apply).toHaveBeenCalledOnce();const next=apply.mock.calls[0]![0] as RoomLayout;
  expect(screen.queryByText(/场地修改已应用，可撤销/)).toBeNull();
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={next}/>);
  const saved=layoutToBackendScene(next);
  expect(saved.venue.width).toBe(15);if(saved.schemaVersion!==2)throw new Error('v2');expect(saved.structure.openings[0]!.width).toBe(1.4);
  expect(screen.getByText(/场地修改已应用，可撤销/)).toBeDefined();expect(create).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();
  expect((screen.getByLabelText('总宽（米）') as HTMLInputElement).value).toBe('15');
 });
 it('clears an applied-scene success on Undo and never revives it on Redo',async()=>{
  const trial=mount();await start();width('14');confirm();
  const applied=trial.apply.mock.calls[0]![0] as RoomLayout;
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={applied}/>);
  expect(await screen.findByText(/场地修改已应用，可撤销/)).toBeDefined();
  expect(screen.getByText('当前场地 · 14 × 8 米')).toBeDefined();
  expect(screen.queryByText(/待提交生成尺寸与当前场地不同/)).toBeNull();
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={trial.base}/>);
  await waitFor(()=>expect(screen.queryByText(/场地修改已应用，可撤销/)).toBeNull());
  expect((screen.getByLabelText('总宽（米）') as HTMLInputElement).value).toBe('14');
  expect(screen.getByText(/待提交生成尺寸与当前场地不同/).textContent).toContain('总宽输入 14 米，当前 12 米');
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={applied}/>);
  expect(screen.queryByText(/场地修改已应用，可撤销/)).toBeNull();
  expect(screen.queryByText(/待提交生成尺寸与当前场地不同/)).toBeNull();
  expect(trial.apply).toHaveBeenCalledOnce();expect(trial.create).not.toHaveBeenCalled();expect(trial.upload).not.toHaveBeenCalled();
 });
 it('keeps later generation inputs through Undo and same-scope layout changes while showing the current difference',async()=>{
  const trial=mount();await start();width('14');confirm();
  const applied=trial.apply.mock.calls[0]![0] as RoomLayout;
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={applied}/>);
  expect(await screen.findByText(/场地修改已应用，可撤销/)).toBeDefined();
  const submittedWidth=screen.getByLabelText('总宽（米）') as HTMLInputElement;
  const submittedDepth=screen.getByLabelText('总深（米）') as HTMLInputElement;
  fireEvent.change(submittedWidth,{target:{value:'17.5'}});fireEvent.change(submittedDepth,{target:{value:'9.25'}});
  expect(screen.getByText(/待提交生成尺寸与当前场地不同/).textContent).toContain('总宽输入 17.5 米，当前 14 米');
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={trial.base}/>);
  expect(submittedWidth.value).toBe('17.5');expect(submittedDepth.value).toBe('9.25');
  expect(screen.queryByText(/场地修改已应用，可撤销/)).toBeNull();
  expect(screen.getByText(/待提交生成尺寸与当前场地不同/).textContent).toContain('总深输入 9.25 米，当前 8 米');
  const later=createMeasuredRoomLayout(layout,{width:16,depth:10,height:3});
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={later}/>);
  expect(screen.getByLabelText('总宽（米）')).toBe(submittedWidth);expect(screen.getByLabelText('总深（米）')).toBe(submittedDepth);
  expect(submittedWidth.value).toBe('17.5');expect(submittedDepth.value).toBe('9.25');
  expect(screen.queryByText(/场地修改已应用，可撤销/)).toBeNull();
  expect(screen.getByText(/待提交生成尺寸与当前场地不同/).textContent).toContain('总宽输入 17.5 米，当前 16 米');
  expect(screen.getByText(/待提交生成尺寸与当前场地不同/).textContent).toContain('总深输入 9.25 米，当前 10 米');
  fireEvent.change(submittedWidth,{target:{value:'16'}});fireEvent.change(submittedDepth,{target:{value:'10'}});
  fireEvent.change(screen.getByLabelText('层高（米）'),{target:{value:'3'}});
  expect(screen.queryByText(/待提交生成尺寸与当前场地不同/)).toBeNull();
  expect(screen.getByText(/下方是待提交的生成尺寸，填写不会修改当前场地/).textContent).toContain('当前场地为 16 × 10 米');
  expect(trial.apply).toHaveBeenCalledOnce();expect(trial.create).not.toHaveBeenCalled();expect(trial.upload).not.toHaveBeenCalled();
 });
 it('keeps invalid door edits unapplied and clears their scene preview',async()=>{
  const {apply,preview}=mount();await start();fireEvent.change(screen.getByLabelText('门洞 1 · 距墙起点（米）'),{target:{value:'7.5'}});
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toMatch(/门窗|门洞/));
  expect(preview.mock.calls.at(-1)?.[0]).toBeNull();expect((screen.getByRole('button',{name:'确认应用场地修改'}) as HTMLButtonElement).disabled).toBe(true);expect(apply).not.toHaveBeenCalled();
 });
 it('invalidates the draft on a same-project scene change without overwriting the newer scene',async()=>{
  const trial=mount();await start();width();const changed={...trial.base,backendLighting:'cool' as const};
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={changed}/>);
  expect(screen.getByRole('alert').textContent).toContain('场景、项目或图纸资料已变化');
  await waitFor(()=>expect(trial.preview.mock.calls.at(-1)?.[0]).toBeNull());expect(trial.apply).not.toHaveBeenCalled();
 });
 it('cancels the draft on A→B→A project navigation',async()=>{
  const trial=mount();await start();width();
  trial.view.rerender(<ReconstructionPanel {...trial.props} layout={{...trial.base,id:'other-local-project'}}/>);
  trial.view.rerender(<ReconstructionPanel {...trial.props}/>);
  expect(screen.queryByLabelText('编辑总宽（米）')).toBeNull();expect(trial.apply).not.toHaveBeenCalled();
 });
 it('invalidates a changed source identity even when the scene stays the same',async()=>{
  const photo={id:'local-plan',kind:'floorplan' as const,name:'演练图.png',width:100,height:100,url:'blob:plan',blob:new Blob(['a'])};
  const trial=mount(measured(),{images:[photo]});await start();width();
  trial.view.rerender(<ReconstructionPanel {...trial.props} images={[{...photo,blob:new Blob(['b'])}]}/>);
  expect(screen.getByRole('alert').textContent).toContain('图纸资料已变化');expect(trial.apply).not.toHaveBeenCalled();
 });
 it('rechecks the live lease at confirmation even before a snapshot rerender',async()=>{
  const trial=mount();await start();width();fireEvent.click(screen.getByLabelText('我已核对修改后的尺寸、门窗位置和现场条件'));
  const old=controller.getSnapshot();vi.mocked(controller.getSnapshot).mockReturnValue({...old,lease:{...old.lease!,generation:2}});
  fireEvent.click(screen.getByRole('button',{name:'确认应用场地修改'}));
  expect(trial.apply).not.toHaveBeenCalled();expect(screen.getByRole('status').textContent).toContain('草稿未应用');
 });
 it('allows local-only editing without a cloud project and preserves an onApply rejection',async()=>{
  const old=controller.getSnapshot();vi.mocked(controller.getSnapshot).mockReturnValue({...old,project:null,user:null,lease:null,revision:null,writeBlocked:true});
  const trial=mount(measured(),{onApply:()=>{throw new Error('场地保存被原校验拒绝');}});await start();width();confirm();
  expect(screen.getByRole('status').textContent).toContain('场地保存被原校验拒绝');expect(screen.getByLabelText('编辑总宽（米）')).toBeDefined();
  expect(trial.create).not.toHaveBeenCalled();
 });
 it('stops preview and confirmation when the captured edit lease expires',async()=>{
  const trial=mount();await start();width();fireEvent.click(screen.getByLabelText('我已核对修改后的尺寸、门窗位置和现场条件'));
  const old=controller.getSnapshot();vi.mocked(controller.getSnapshot).mockReturnValue({...old,lease:{...old.lease!,expiresAt:new Date(Date.now()+40).toISOString()}});
  trial.view.rerender(<ReconstructionPanel {...trial.props}/>);
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('编辑权已过期'));
  expect((screen.getByRole('button',{name:'确认应用场地修改'}) as HTMLButtonElement).disabled).toBe(true);
  expect(trial.preview.mock.calls.at(-1)?.[0]).toBeNull();expect(trial.apply).not.toHaveBeenCalled();
 });
 it('keeps a pending structure review separate from manual editing',async()=>{
  const current=measured();vi.mocked(readSourceForm).mockResolvedValue({jobId,jobBase:JSON.stringify(layoutToBackendScene(current))});
  vi.spyOn(controller,'getReconstruction').mockResolvedValue({id:jobId,state:'needs_review',candidate:layoutToBackendScene(current) as never,issues:[]});
  const trial=mount(current);await screen.findByText('核对识别结构');
  expect((screen.getByRole('button',{name:'编辑当前场地'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByLabelText('编辑总宽（米）')).toBeNull();expect(trial.apply).not.toHaveBeenCalled();
 });
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
 function typePoint(x:string,z:string){fireEvent.change(screen.getByLabelText('对应点横向像素'),{target:{value:x}});fireEvent.change(screen.getByLabelText('对应点纵向像素'),{target:{value:z}});fireEvent.keyDown(screen.getByLabelText('对应点纵向像素'),{key:'Enter'});}
 it.each(['Enter',' '])('does not forward the handled map key %s to scene placement shortcuts',async key=>{
  memory();open();await screen.findByRole('button',{name:'重新标记三个对应点'});
  fireEvent.click(screen.getByRole('button',{name:'重新标记三个对应点'}));
  const shortcut=vi.fn();window.addEventListener('keydown',shortcut);
  try{fireEvent.keyDown(screen.getByRole('button',{name:'标记图纸与场地的三个对应点'}),{key});
   expect(document.activeElement).toBe(screen.getByLabelText('对应点横向像素'));expect(shortcut).not.toHaveBeenCalled();
  }finally{window.removeEventListener('keydown',shortcut);}
 });
 it('accepts three keyboard points once each and still requires explicit confirmation',async()=>{
  const saved=memory(),create=vi.spyOn(controller,'createReconstruction'),upload=vi.spyOn(controller,'uploadSource');open();
  await screen.findByRole('button',{name:'重新标记三个对应点'});
  fireEvent.click(screen.getByRole('button',{name:'重新标记三个对应点'}));
  fireEvent.keyDown(screen.getByRole('button',{name:'标记图纸与场地的三个对应点'}),{key:' '});
  expect(document.activeElement).toBe(screen.getByLabelText('对应点横向像素'));
  typePoint('10.5','20');typePoint('610.5','20');typePoint('10.5','420');
  await act(async()=>{await flushSourceScope(projectId);});
  expect(saved().registration?.points).toEqual([{x:10.5,z:20},{x:610.5,z:20},{x:10.5,z:420}]);
  expect(saved().registration?.appliedBasis).toBeUndefined();
  expect((screen.getByLabelText('对应点纵向像素') as HTMLInputElement).readOnly).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));
  await screen.findByText('本机原图对应已核对，尚未同步到云端。',{selector:'p[role="status"]'});
  expect(resolveReferenceImage(measured,[{...sourceA,scope:projectId}],saved()).status).toBe('ready');
  expect(create).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();
 });
 it.each([['','20'],['10',''],['-1','20'],['1001','20'],['10','601'],['Infinity','20']])('rejects invalid keyboard coordinates %s / %s',async(x,z)=>{
  const saved=memory();open();await screen.findByRole('button',{name:'重新标记三个对应点'});
  fireEvent.click(screen.getByRole('button',{name:'重新标记三个对应点'}));typePoint(x,z);
  expect(screen.getByRole('alert').textContent).toContain('请输入图内坐标');
  await act(async()=>{await flushSourceScope(projectId);});expect(saved().registration?.points).toEqual([]);
 });
 it('clears keyboard drafts when changing sources and requires a new marking session',async()=>{
  const saved=memory();open(measured,[sourceA,sourceB]);await screen.findByRole('button',{name:'重新标记三个对应点'});
  fireEvent.click(screen.getByRole('button',{name:'重新标记三个对应点'}));typePoint('10','20');
  fireEvent.change(screen.getByLabelText('对应点横向像素'),{target:{value:'610'}});
  fireEvent.change(screen.getByLabelText('核对平面图'),{target:{value:sourceB.id}});
  expect((screen.getByLabelText('对应点横向像素') as HTMLInputElement).value).toBe('');
  fireEvent.keyDown(screen.getByLabelText('对应点纵向像素'),{key:'Enter'});
  await act(async()=>{await flushSourceScope(projectId);});
  expect(saved().registration).toMatchObject({sourceId:sourceA.id,points:[{x:10,z:20}]});
  expect((screen.getByRole('button',{name:'添加当前对应点'}) as HTMLButtonElement).disabled).toBe(true);
 });
 it('reads the original persisted form, keeps legacy points unadopted, and confirms a local v2 image without AI or cloud registration',async()=>{
  const saved=memory({registration:{sourceId:sourceA.id,points:[{x:10,z:20},{x:610,z:20},{x:10,z:420}]}});
  const create=vi.spyOn(controller,'createReconstruction'),upload=vi.spyOn(controller,'uploadSource');open();
  await screen.findByText('原对应未绑定当前场地尺寸，已停用，请重新标记。');
  expect(resolveReferenceImage(measured,[{...sourceA,scope:projectId}],saved()).status).toBe('needs-review');
  mark();expect(saved().registration?.appliedBasis).toBeUndefined();
  fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));
  await screen.findByText('本机原图对应已核对，尚未同步到云端。',{selector:'p[role="status"]'});
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
  await screen.findByText('本机原图对应已核对，尚未同步到云端。',{selector:'p[role="status"]'});
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
  const view=open();await waitFor(()=>expect(screen.getByText('本机原图对应已核对，尚未同步到云端。')).toBeDefined());
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
  await screen.findByText('本机原图对应已核对，尚未同步到云端。',{selector:'p[role="status"]'});
  expect(saved().registration?.worldWidth).toBe(16);const result=resolveReferenceImage(resized,[{...sourceA,scope:projectId}],saved());
  expect(result.status).toBe('ready');const [a,,c,,e]=result.imageToWorld!;expect(a*610+c*20+e).toBeCloseTo(16);
 });
 it('keeps the mapping unadopted when the confirmation save fails',async()=>{
  const saved=memory();open();await waitFor(()=>expect(readSourceForm).toHaveBeenCalledWith(projectId));mark();
  vi.mocked(storeSourceForm).mockRejectedValueOnce(new Error('本机对应保存失败'));
  fireEvent.click(screen.getByRole('button',{name:'在当前设计中使用此对应'}));await screen.findByText('本机对应保存失败');
  expect(saved().registration?.appliedBasis).toBeUndefined();
  expect(screen.queryByText('本机原图对应已核对，尚未同步到云端。',{selector:'p[role="status"]'})).toBeNull();
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
  expect(screen.queryByText('本机原图对应已核对，尚未同步到云端。',{selector:'p[role="status"]'})).toBeNull();
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


describe('local activity with an independent scene connection',()=>{
 const localId='local-activity-diagram';
 const local={...createMeasuredRoomLayout({...layout,id:localId},{width:12,depth:8,height:3}),eventOperations:{schemaVersion:1 as const,dataKind:'rehearsal' as const,tasks:[]}};
 function bind(){
  const old=controller.getSnapshot();
  const geometryBinding={version:1 as const,localActivityId:localId,cloudProjectId:projectId,userId:old.user!.id,apiUrl:controller.config.apiUrl};
  vi.mocked(controller.getSnapshot).mockReturnValue({...old,geometryBinding});
  vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>{const state=controller.getSnapshot();return state.geometryBinding?.localActivityId===id&&state.geometryBinding.userId===state.user?.id&&state.geometryBinding.apiUrl===controller.config.apiUrl&&state.geometryBinding.cloudProjectId===state.project?.id;});
  return geometryBinding;
 }
 function identity(){const state=controller.getSnapshot();return canonical({scope:localId,project:projectId,user:state.user!.id,api:controller.config.apiUrl,binding:state.geometryBinding});}
 function session(){const state=controller.getSnapshot();return canonical({identity:identity(),session:state.sessionId,lease:{session:state.lease!.sessionId,generation:state.lease!.generation},revision:state.revision});}
 function proposal(remote=projectId):SceneProposal {return {id:'60000000-0000-4000-8000-000000000001',project_id:remote,session_id:controller.getSnapshot().lease!.sessionId,generation:1,base_revision:1,local_revision:0,base_hash:'test',base_scene:layoutToBackendScene(local),candidate:layoutToBackendScene(local),expires_at:new Date(Date.now()+100000).toISOString(),applied_at:null,explanation:'场景候选'} as SceneProposal;}
 function mount(extra:Partial<React.ComponentProps<typeof ReconstructionPanel>>={}){const apply=vi.fn(),preview=vi.fn();const props={controller,layout:local,onApply:apply,onPreview:preview,images:[],updateImage:vi.fn(),brief:INITIAL_BRIEF,...extra};const view=render(<ReconstructionPanel {...props}/>);openInputs();return {view,apply,preview,props};}
 async function generate(){await waitFor(()=>expect((screen.getByRole('button',{name:'Generate 重建并设计方案'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'Generate 重建并设计方案'}));}
 it('uses local source forms, preserves records on apply, and sends scene-only input to the remote connection',async()=>{
  bind();vi.mocked(readSourceForm).mockResolvedValue({width:'12',depth:'8',height:'3',text:'原尺寸资料'});
  vi.mocked(readMaterialCheckins).mockResolvedValue({schemaVersion:1,projectId:localId,dataKind:'rehearsal',sheets:[]});
  const result=proposal();const create=vi.spyOn(controller,'createReconstruction').mockResolvedValue({id:jobId,state:'ready',issues:[],proposal:result});
  vi.spyOn(controller,'authorizeAssets').mockResolvedValue({assetUrls:{},assetNames:{}});
  const apply=vi.spyOn(controller,'applySceneProposal').mockResolvedValue({scene:result.candidate,acceptedLocally:true} as never);
  const trial=mount();await generate();await screen.findByText('三维候选方案');
  expect(create.mock.calls[0]![0].scene).toEqual(layoutToBackendScene(local));
  expect(JSON.stringify(create.mock.calls[0]![0])).not.toMatch(/eventOperations|material-checkins|rehearsal/);
  expect(readSourceForm).toHaveBeenCalledWith(localId);expect(readMaterialCheckins).toHaveBeenCalledWith(localId);
  expect(vi.mocked(storeSourceForm).mock.calls.every(([scope])=>scope===localId)).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'确认应用并保存'}));await waitFor(()=>expect(trial.apply).toHaveBeenCalledOnce());
  expect(apply.mock.calls[0]![0].project_id).toBe(projectId);expect(trial.apply.mock.calls[0]![0]).toMatchObject({id:localId,eventOperations:local.eventOperations});
  expect((screen.getByLabelText('补充尺寸') as HTMLTextAreaElement).value).toBe('原尺寸资料');
 });
 it('prepares only the scene connection explicitly without generating or changing the local activity',async()=>{
  const old=controller.getSnapshot();vi.mocked(controller.getSnapshot).mockReturnValue({...old,project:null,lease:null,revision:null,writeBlocked:true});
  const ensure=vi.spyOn(controller,'ensureGeometryWorkbenchReady').mockResolvedValue(old.project!);
  const create=vi.spyOn(controller,'createReconstruction');const trial=mount();
  await waitFor(()=>expect((screen.getByRole('button',{name:'准备场景连接'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'准备场景连接'}));await waitFor(()=>expect(ensure).toHaveBeenCalledOnce());
  expect(ensure.mock.calls[0]).toEqual([layoutToBackendScene(local),local.name,localId]);expect(create).not.toHaveBeenCalled();expect(trial.apply).not.toHaveBeenCalled();
 });
 it('refuses unreadable facts before generation or uploads',async()=>{
  bind();vi.mocked(readMaterialCheckins).mockRejectedValue(new Error('本机点验记录无法完整读取'));
  const create=vi.spyOn(controller,'createReconstruction'),upload=vi.spyOn(controller,'uploadSource');mount();await generate();
  await screen.findByText('本机点验记录无法完整读取');expect(create).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();
 });
 it('queries only the persisted remote job and rejects a proposal for a different remote project',async()=>{
  bind();vi.mocked(readSourceForm).mockResolvedValue({jobId,jobIdentity:identity(),jobSession:session(),jobBase:canonical(layoutToBackendScene(local))});
  const get=vi.spyOn(controller,'getReconstruction').mockResolvedValue({id:jobId,state:'ready',issues:[],proposal:proposal('other-project')});
  const create=vi.spyOn(controller,'createReconstruction'),authorize=vi.spyOn(controller,'authorizeAssets');mount();
  await screen.findByText(/候选属于其他场景连接/);expect(get).toHaveBeenCalledWith(jobId);expect(create).not.toHaveBeenCalled();expect(authorize).not.toHaveBeenCalled();expect(screen.queryByText('三维候选方案')).toBeNull();
 });
 it('restores an existing binding for the original job without creating a project or a new request',async()=>{
  bind();const state=controller.getSnapshot();vi.mocked(readSourceForm).mockResolvedValue({jobId,jobIdentity:identity(),jobSession:session()});
  vi.mocked(controller.getSnapshot).mockReturnValue({...state,project:null,lease:null,geometryBinding:null,writeBlocked:true});
  const resume=vi.spyOn(controller,'resumeGeometryWorkbench').mockResolvedValue(null),ensure=vi.spyOn(controller,'ensureGeometryWorkbenchReady'),create=vi.spyOn(controller,'createReconstruction');mount();
  await screen.findByText('原任务的场景连接未能恢复，任务编号与本机资料已保留。');
  expect(resume).toHaveBeenCalledWith(layoutToBackendScene(local),local.name,localId);expect(ensure).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
 });
 it('does not restore an old local job for another account',async()=>{
  bind();const state=controller.getSnapshot();vi.mocked(readSourceForm).mockResolvedValue({jobId,jobIdentity:identity()});
  vi.mocked(controller.getSnapshot).mockReturnValue({...state,user:{id:'another-user'},project:null,lease:null,geometryBinding:null});
  const resume=vi.spyOn(controller,'resumeGeometryWorkbench'),get=vi.spyOn(controller,'getReconstruction');mount();
  await waitFor(()=>expect(readSourceForm).toHaveBeenCalledWith(localId));await act(async()=>{await Promise.resolve();});expect(resume).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
 });
 it('drops a pending candidate when the account changes before asset authorization finishes',async()=>{
  bind();const result=proposal();vi.spyOn(controller,'createReconstruction').mockResolvedValue({id:jobId,state:'ready',issues:[],proposal:result});
  let finish!:(value:{assetUrls:Record<string,string>;assetNames:Record<string,string>})=>void;
  const authorize=vi.spyOn(controller,'authorizeAssets').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const trial=mount();await generate();await waitFor(()=>expect(authorize).toHaveBeenCalledOnce());
  vi.mocked(controller.getSnapshot).mockReturnValue({...controller.getSnapshot(),user:{id:'another-user'}});
  trial.view.rerender(<ReconstructionPanel {...trial.props}/>);await act(async()=>{finish({assetUrls:{},assetNames:{}});});
  expect(screen.queryByText('三维候选方案')).toBeNull();expect(trial.apply).not.toHaveBeenCalled();
 });
 it('keeps original-image registration and dimensions under the local ID with a remote binding',async()=>{
  bind();const source={id:'local-plan',name:'原图.png',kind:'floorplan' as const,width:1000,height:600,url:'blob:local-plan',blob:new Blob(['plan'])};
  const registration={sourceId:source.id,points:[{x:10,z:20},{x:610,z:20},{x:10,z:420}],worldWidth:12,worldDepth:8,imageWidth:1000,imageHeight:600,appliedBasis:referenceSceneBasis(local),confirmationId:'original'};
  vi.mocked(readSourceForm).mockResolvedValue({width:'12',depth:'8',height:'3',registration});mount({images:[source]});
  await screen.findByText('本机原图对应已核对，尚未同步到云端。');
  expect((screen.getByLabelText('总宽（米）') as HTMLInputElement).value).toBe('12');
  expect(resolveReferenceImage(local,[{...source,scope:localId}],{registration}).status).toBe('ready');
  await act(async()=>{await flushSourceScope(localId);});
  expect(storeSourceForm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('补充尺寸'),{target:{value:'原图核对后的补充'}});
  await act(async()=>{await flushSourceScope(localId);});
  expect(storeSourceForm).toHaveBeenCalledWith(localId,expect.objectContaining({registration,width:'12'}));expect(vi.mocked(storeSourceForm).mock.calls.every(([scope])=>scope===localId)).toBe(true);
 });
 it('rechecks the independent facts before applying a ready candidate',async()=>{
  bind();const result=proposal();vi.spyOn(controller,'createReconstruction').mockResolvedValue({id:jobId,state:'ready',issues:[],proposal:result});
  vi.spyOn(controller,'authorizeAssets').mockResolvedValue({assetUrls:{},assetNames:{}});const apply=vi.spyOn(controller,'applySceneProposal');const trial=mount();
  await generate();await screen.findByText('三维候选方案');vi.mocked(readMaterialCheckins).mockRejectedValue(new Error('本机点验记录无法完整读取'));
  fireEvent.click(screen.getByRole('button',{name:'确认应用并保存'}));await screen.findByText('本机点验记录无法完整读取');expect(apply).not.toHaveBeenCalled();expect(trial.apply).not.toHaveBeenCalled();
 });
 it('invalidates a ready candidate when the same source record gets a different original image',async()=>{
  bind();const source={...image,kind:'floorplan' as const,blob:new Blob(['first'])};const withSource=structuredClone(local);withSource.backendSceneV2!.sources=[{assetId,kind:'floorplan',name:image.name,width:1000,height:600}];
  const result=proposal();vi.spyOn(controller,'createReconstruction').mockResolvedValue({id:jobId,state:'ready',issues:[],proposal:result});vi.spyOn(controller,'authorizeAssets').mockResolvedValue({assetUrls:{},assetNames:{}});
  const trial=mount({layout:withSource,images:[source]});await generate();await screen.findByText('三维候选方案');
  trial.view.rerender(<ReconstructionPanel {...trial.props} images={[{...source,blob:new Blob(['replacement'])}]}/>);
  expect((screen.getByRole('button',{name:'确认应用并保存'}) as HTMLButtonElement).disabled).toBe(true);expect(trial.preview.mock.calls.at(-1)?.[0]).toBeNull();
 });
 it('allows manual venue edits with an expired scene lease and keeps local activity records',async()=>{
  bind();vi.mocked(controller.getSnapshot).mockReturnValue({...controller.getSnapshot(),lease:null,writeBlocked:true});const trial=mount();
  await waitFor(()=>expect((screen.getByRole('button',{name:'编辑当前场地'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'编辑当前场地'}));fireEvent.change(screen.getByLabelText('编辑总宽（米）'),{target:{value:'14'}});
  fireEvent.click(screen.getByLabelText('我已核对修改后的尺寸、门窗位置和现场条件'));fireEvent.click(screen.getByRole('button',{name:'确认应用场地修改'}));
  expect(trial.apply).toHaveBeenCalledOnce();expect(trial.apply.mock.calls[0]![0]).toMatchObject({id:localId,width:14,eventOperations:local.eventOperations});
 });
});
