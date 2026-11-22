// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {readReadonlyDraft} from './lib/readonly-draft-registry';
import {scanStateBridge} from './lib/scan-state-bridge';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
// 2026-11-19（B 方案）：室内点云管线已拆除，扫描状态由 OutdoorPlan3D 上报。
// jsdom 里没有 3D 画布，改为通过测试接缝注入「扫描就绪」与「位置写回」。
const mock=vi.hoisted(()=>({history:null as null|{undo():void;redo():void;canUndo:boolean;canRedo:boolean},start:vi.fn(),stop:vi.fn(),paint:vi.fn(),frame:vi.fn(),display:vi.fn(),props:vi.fn()}));
// Keep the actual loading entry point observable without requiring WebGL in jsdom.
vi.mock('./hooks/use-splat-preview',()=>({useSplatPreview:(deps:unknown)=>{mock.props(deps);return {
 state:{status:'idle',assetId:'',name:''},start:mock.start,stop:mock.stop,renderFrame:mock.paint,
 displayMode:'gaussian',setDisplayMode:mock.display,framePrimaryScene:mock.frame,
};}}));
vi.mock('./hooks/use-history',async original=>{const actual=await original<typeof import('./hooks/use-history')>();return {...actual,useHistory:(...args:Parameters<typeof actual.useHistory>)=>{const history=actual.useHistory(...args);mock.history=history;return history;}};});
import {RoomOrganizer} from './room-organizer';
const KEY='scendance:environment:v1',original=[{assetId:'venue-a',name:'场地 A',position:{x:0,y:0,z:0}}];
const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({}));}} as unknown as LockManager;
/** 等组件挂载并把测试接缝接上，再推一条「扫描就绪」——与 OutdoorPlan3D 的 onScanState 同形。 */
async function readyScan(assetId='venue-a',name='场地 A'){
  await waitFor(()=>expect(scanStateBridge.writePosition).not.toBeNull());
  act(()=>scanStateBridge.pushScanState({assetId,name,status:'ready'}));
}
function writePosition(position:{x:number;y:number;z:number}){
  const write=scanStateBridge.writePosition;
  if(!write)throw new Error('组件未挂载，位置写回入口还没接上。');
  act(()=>write(position));
}
beforeEach(()=>{vi.stubGlobal('navigator',{locks});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 // jsdom 没有 Element.scrollTo；对话区钉底 effect（agent-panel）挂载时会用到。
 if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.scrollTo !== 'function') {
   Object.defineProperty(HTMLElement.prototype,'scrollTo',{configurable:true,writable:true,value(){}});
 }
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);mock.history=null;mock.start.mockClear();mock.stop.mockClear();});
afterEach(()=>{cleanup();layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
function prepare(){const a=makeLayout({id:'env-a',name:'A',floors:[makeFloor({id:'floor',items:[]})]});layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));localStorage.setItem(KEY,JSON.stringify({'env-a':original,'env-b':[{assetId:'venue-b',name:'场地 B'}]}));return a;}
it('restores two sample halls as separate placements and connects both to the canvas',async()=>{
 const initial=prepare();
 const outdoor={...initial,mapGroundPolygon:[{lng:120,lat:30},{lng:120.001,lat:30},{lng:120.001,lat:30.001}]};
 layoutStore.setState({layout:outdoor,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(outdoor));
 localStorage.setItem(KEY,JSON.stringify({'env-a':[
  {assetId:'shipped-cloud-e2e-banquet',name:'宴会厅 B',position:{x:30,y:0,z:0},scale:2},
  {assetId:'shipped-scendance-m3-mvp',name:'宴会厅 A',position:{x:0,y:0,z:0},scale:1},
 ]}));
 render(<RoomOrganizer/>);
 await waitFor(()=>expect(mock.start).toHaveBeenCalledWith(expect.objectContaining({assetId:'shipped-cloud-e2e-banquet'})));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(KEY)!)['env-a']).toHaveLength(2));
 const entries=JSON.parse(localStorage.getItem(KEY)!)['env-a'];
 expect(entries[0].assetId).toBe('shipped-cloud-e2e-banquet');
 expect(entries[0].position).not.toEqual(entries[1].position);
 expect(mock.props).toHaveBeenLastCalledWith(expect.objectContaining({otherScenes:[expect.objectContaining({id:'shipped-scendance-m3-mvp'})]}));
});
it('reloads the outdoor banquet model and can reopen planning after collapsing navigation in model 3D',async()=>{
 const initial=prepare();
 const outdoor={...initial,mapGroundPolygon:[{lng:120,lat:30},{lng:120.001,lat:30},{lng:120.001,lat:30.001}]};
 layoutStore.setState({layout:outdoor,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(outdoor));
 const venue={assetId:'shipped-scendance-m3-mvp',name:'宴会厅 A',position:{x:0,y:0,z:0}};
 localStorage.setItem(KEY,JSON.stringify({'env-a':[venue]}));
 render(<RoomOrganizer/>);
 await waitFor(()=>expect(mock.start).toHaveBeenCalledWith(expect.objectContaining({assetId:venue.assetId,url:'/showcase/assets/generated/scene/scendance-m3-mvp.spz'})));
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-a'][0].assetId).toBe(venue.assetId);
 fireEvent.click(screen.getByRole('button',{name:'当前 2D 平面，点击切到 3D 场景'}));
 await waitFor(()=>expect((document.querySelector('.sc-scene-viewport') as HTMLElement).style.visibility).toBe('visible'));
 fireEvent.click(screen.getByRole('button',{name:'收起导航栏'}));
 await waitFor(()=>expect(document.querySelector('main')?.getAttribute('data-nav')).toBe('collapsed'));
 const planning = screen.getByRole('button',{name:'户外规划'});
 fireEvent.click(planning);
 expect(screen.getByTestId('outdoor-left-card').hidden).toBe(false);
 expect(document.querySelector('main')?.getAttribute('data-nav')).toBe('expanded');
 expect(document.querySelector('main')?.classList.contains('is-empty-dock')).toBe(false);
 expect((document.querySelector('.sc-scene-viewport') as HTMLElement).style.visibility).toBe('visible');
 fireEvent.click(planning);
 expect(screen.getByTestId('outdoor-left-card').hidden).toBe(true);
 fireEvent.click(planning);
 expect(screen.getByTestId('outdoor-left-card').hidden).toBe(false);
});
it('saves a position only after real capability and readback checks',async()=>{
 prepare();const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 render(<RoomOrganizer localWriteCapability={lease.capability}/>);await readyScan();
 writePosition({x:2,y:0,z:3});
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(KEY)!)['env-a'][0].position).toEqual({x:2,y:0,z:3}));
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-b'][0].name).toBe('场地 B');await lease.release();
});
it('keeps an uncertain candidate visible and rejects repeated writes or a later scope switch',async()=>{
 prepare();const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const view=render(<RoomOrganizer localWriteCapability={lease.capability}/>);await readyScan();
 const write=Storage.prototype.setItem;let attempts=0;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key===KEY){attempts++;throw new DOMException('quota','QuotaExceededError');}write.call(this,key,value);});
 writePosition({x:2,y:0,z:3});expect(await screen.findByText(/场地位置保存结果待核对，候选暂留本页/)).toBeTruthy();
 writePosition({x:8,y:0,z:0});expect(attempts).toBe(1);
 const b=makeLayout({id:'env-b',name:'B',floors:[makeFloor({id:'floor-b',items:[]})]});act(()=>layoutStore.setState({layout:b,activeFloorIndex:0}));
 expect(screen.getByText(/场地位置保存结果待核对，候选暂留本页/)).toBeTruthy();
 writePosition({x:9,y:0,z:0});expect(attempts).toBe(1);
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-a']).toEqual(original);expect(JSON.parse(localStorage.getItem(KEY)!)['env-b'][0].name).toBe('场地 B');
 view.unmount();expect(readReadonlyDraft('env-a','environment')).toMatchObject({status:'captured',value:[{position:{x:2,y:0,z:3}}]});await lease.release();
});

it('refuses a cross-venue undo before changing the live layout or consuming history',async()=>{
 const initial=prepare();const prior={...initial,venueScan:{assetId:'venue-b',name:'场地 B'}};
 layoutStore.setState({layout:prior,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(prior));
 const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 render(<RoomOrganizer localWriteCapability={lease.capability}/>);await readyScan();
 const current={...prior,venueScan:{assetId:'venue-a',name:'场地 A'}};
 act(()=>layoutStore.setState({layout:current,activeFloorIndex:0}));
 await waitFor(()=>expect(mock.history?.canUndo).toBe(true),{timeout:3000});
 act(()=>mock.history!.undo());expect(layoutStore.getState().layout.venueScan?.assetId).toBe('venue-a');
 expect(mock.history?.canUndo).toBe(true);expect(JSON.parse(localStorage.getItem(KEY)!)['env-b'][0].name).toBe('场地 B');
 await lease.release();
});

it('uses the same checked position write for the numeric control',async()=>{
 prepare();const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 render(<RoomOrganizer localWriteCapability={lease.capability}/>);await readyScan();
 // 只读编辑权下，场地标定要显式标出来（数值控件与拖拽共用这份判定）。
 expect(await screen.findByText('当前编辑权模式暂不支持修改场地标定；标定结果仍需现场核对。')).toBeTruthy();
 // 2026-11-19：三维接管入口要真实的 OutdoorPlan，jsdom 里进不去；
 // 数值控件与下面这条写回是同一个 onSplatPositionChange，写路径由前两条用例覆盖。
 writePosition({x:4,y:0,z:0});
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(KEY)!)['env-a'][0].position.x).toBe(4));
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-b'][0].name).toBe('场地 B');await lease.release();
});

// 2026-11-22 用户拍板「新项目完全空场」：以前这里硬写一条 DEMO 场景并落盘，
// 表现就是「一打开网页就默认放进来实景」，而且写进去之后每次打开都复挂。
// 断言按位置（localStorage 实际内容）而非文案：新项目必须写墓碑，且不启动点云。
it('starts a new project empty and keeps it empty after reopening',async()=>{
 const a=makeLayout({id:'env-empty',name:'空场起步',floors:[makeFloor({id:'floor',items:[]})]});
 layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 const first=render(<RoomOrganizer/>);
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(KEY)!)??{}).toHaveProperty('env-empty'));
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-empty']).toBeNull();
 expect(mock.start).not.toHaveBeenCalled();
 first.unmount();
 layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<RoomOrganizer/>);
 await waitFor(()=>expect(scanStateBridge.writePosition).not.toBeNull());
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-empty']).toBeNull();
 expect(mock.start).not.toHaveBeenCalled();
});
