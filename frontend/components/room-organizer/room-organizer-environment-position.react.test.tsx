// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from '@/lib/local-write-lease';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {readReadonlyDraft} from './lib/readonly-draft-registry';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const mock=vi.hoisted(()=>({ready:false,calibrationReadOnly:false,history:null as null|{undo():void;redo():void;canUndo:boolean;canRedo:boolean},change:null as null|((value:{x:number;y:number;z:number})=>void),position:null as null|{x:number;y:number;z:number},setPosition:vi.fn()}));
vi.mock('./hooks/use-history',async original=>{const actual=await original<typeof import('./hooks/use-history')>();return {...actual,useHistory:(...args:Parameters<typeof actual.useHistory>)=>{const history=actual.useHistory(...args);mock.history=history;return history;}};});
vi.mock('./hooks/use-splat-preview',()=>({useSplatPreview:(deps:{onPositionChange:typeof mock.change;position:typeof mock.position;calibrationReadOnly:boolean})=>{
 mock.change=deps.onPositionChange;mock.position=deps.position;mock.calibrationReadOnly=deps.calibrationReadOnly;
 return {state:mock.ready?{status:'ready',assetId:'venue-a',name:'场地 A',meters:null}:{status:'idle'},renderFrame:()=>{},start:async()=>{},stop:()=>{},setPosition:mock.setPosition,displayMode:'gaussian',setDisplayMode:()=>{},setTransformMode:()=>{},pickScene:()=>null};
}}));
import {RoomOrganizer} from './room-organizer';
const KEY='scendance:environment:v1',original=[{assetId:'venue-a',name:'场地 A',position:{x:0,y:0,z:0}}];
const locks={request(_name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({}));}} as unknown as LockManager;
beforeEach(()=>{vi.stubGlobal('navigator',{locks});vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);mock.ready=false;mock.calibrationReadOnly=false;mock.change=null;mock.position=null;mock.history=null;mock.setPosition.mockClear();});
afterEach(()=>{cleanup();layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
function prepare(){const a=makeLayout({id:'env-a',name:'A',floors:[makeFloor({id:'floor',items:[]})]});layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));localStorage.setItem(KEY,JSON.stringify({'env-a':original,'env-b':[{assetId:'venue-b',name:'场地 B'}]}));return a;}
it('saves a position only after real capability and readback checks',async()=>{
 prepare();const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 render(<RoomOrganizer localWriteCapability={lease.capability}/>);await waitFor(()=>expect(mock.position).toEqual({x:0,y:0,z:0}));
 act(()=>mock.change!({x:2,y:0,z:3}));
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(KEY)!)['env-a'][0].position).toEqual({x:2,y:0,z:3}));
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-b'][0].name).toBe('场地 B');await lease.release();
});
it('keeps an uncertain candidate visible and rejects repeated writes or a later scope switch',async()=>{
 prepare();const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 const view=render(<RoomOrganizer localWriteCapability={lease.capability}/>);await waitFor(()=>expect(mock.position).toEqual({x:0,y:0,z:0}));
 const write=Storage.prototype.setItem;let attempts=0;vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){if(key===KEY){attempts++;throw new DOMException('quota','QuotaExceededError');}write.call(this,key,value);});
 act(()=>mock.change!({x:2,y:0,z:3}));expect(await screen.findByText(/场地位置保存结果待核对，候选暂留本页/)).toBeTruthy();
 await waitFor(()=>expect(mock.position).toEqual({x:2,y:0,z:3}));
 act(()=>mock.change!({x:8,y:0,z:0}));expect(attempts).toBe(1);
 const b=makeLayout({id:'env-b',name:'B',floors:[makeFloor({id:'floor-b',items:[]})]});act(()=>layoutStore.setState({layout:b,activeFloorIndex:0}));
 expect(screen.getByText(/场地位置保存结果待核对，候选暂留本页/)).toBeTruthy();
 act(()=>mock.change!({x:9,y:0,z:0}));expect(attempts).toBe(1);
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-a']).toEqual(original);expect(JSON.parse(localStorage.getItem(KEY)!)['env-b'][0].name).toBe('场地 B');
 view.unmount();expect(readReadonlyDraft('env-a','environment')).toMatchObject({status:'captured',value:[{position:{x:2,y:0,z:3}}]});await lease.release();
});

it('refuses a cross-venue undo before changing the live layout or consuming history',async()=>{
 const initial=prepare();const prior={...initial,venueScan:{assetId:'venue-b',name:'场地 B'}};
 layoutStore.setState({layout:prior,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(prior));
 const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 render(<RoomOrganizer localWriteCapability={lease.capability}/>);await waitFor(()=>expect(mock.position).toEqual({x:0,y:0,z:0}));
 const current={...prior,venueScan:{assetId:'venue-a',name:'场地 A'}};
 act(()=>layoutStore.setState({layout:current,activeFloorIndex:0}));
 await waitFor(()=>expect(mock.history?.canUndo).toBe(true),{timeout:3000});
 act(()=>mock.history!.undo());expect(layoutStore.getState().layout.venueScan?.assetId).toBe('venue-a');
 expect(mock.history?.canUndo).toBe(true);expect(JSON.parse(localStorage.getItem(KEY)!)['env-b'][0].name).toBe('场地 B');
 await lease.release();
});

it('uses the same checked position write for the numeric control',async()=>{
 prepare();mock.ready=true;const lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
 render(<RoomOrganizer localWriteCapability={lease.capability}/>);await waitFor(()=>expect(mock.position).toEqual({x:0,y:0,z:0}));
 expect(await screen.findByText('当前编辑权模式暂不支持修改场地标定；标定结果仍需现场核对。')).toBeTruthy();
 expect(mock.calibrationReadOnly).toBe(true);
 // 工作台默认 2D（2026-11-11 地理优先主线），高斯场景标定是 3D 侧控件，先切到 3D。
 fireEvent.click(await screen.findByRole('button',{name:'2D / 3D'}));
 fireEvent.click(await screen.findByRole('button',{name:'移动整体场景'}));
 const field=await screen.findByLabelText('高斯场景 X 坐标，米');fireEvent.change(field,{target:{value:'4'}});
 await waitFor(()=>expect(JSON.parse(localStorage.getItem(KEY)!)['env-a'][0].position.x).toBe(4));
 expect(JSON.parse(localStorage.getItem(KEY)!)['env-b'][0].name).toBe('场地 B');await lease.release();
});
