// @vitest-environment jsdom
// 路线 1（#47）：保留 Agent/Studio 真实挂载，仅桩掉 three 场景与 2D 交互（手势回调捕获用）、
// next/navigation、next/dynamic 与未配置后端会话。断言壳体手势归属守卫与 observer 重连真实路径。
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {layoutStore} from './hooks/use-layout-store';
import {makeFloor,makeItem,makeLayout} from './lib/__testfixtures__/fixtures';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {STORAGE_KEY} from './lib/constants';
import {MemoryStorage} from '@/lib/test-support-memory-storage';
import {BackendSession,getBackendConfig} from '@/lib/backend-session';

const capture=vi.hoisted(()=>({two:null as any,three:null as any}));
let probeController:BackendSession;

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
vi.mock('next/dynamic', async () => {
  const { lazy, Suspense } = await import('react');
  return {
    default: (load: () => Promise<unknown>) => {
      const Comp = lazy(async () => ({ default: (await load()) as React.ComponentType<Record<string, unknown>> }));
      return (props: Record<string, unknown>) => <Suspense fallback={null}><Comp {...props} /></Suspense>;
    },
  };
});
vi.mock('@/lib/backend-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/backend-session')>();
  return { ...actual, createBackendSession: () => probeController };
});
vi.mock('./hooks/use-dormant-three-shell',()=>({useDormantThreeShell:()=>{
  return {isReady:false,error:null,invalidate:()=>{},requestShadowUpdate:()=>{},threeModuleRef:{current:null},sceneRef:{current:null},rendererRef:{current:null},cameraRef:{current:null},controlsRef:{current:null},worldPositionFromClient:()=>null};
}}));
import {RoomOrganizer} from './room-organizer';

const observed:Array<{targets:Element[];disconnected:boolean}>=[];
let mem:MemoryStorage;
function activity(id:string){return makeLayout({id,name:id,width:20,height:16,roof:{style:'none'},floors:[makeFloor({id:'same-floor',items:[makeItem({id:'same-chair',type:'chair',name:'椅子',position:{x:0,z:0}})]})]});}
beforeEach(()=>{
  capture.two=null;capture.three=null;observed.length=0;
  mem=new MemoryStorage();vi.stubGlobal('Storage',MemoryStorage);vi.stubGlobal('localStorage',mem);window.localStorage=mem;
  probeController=new BackendSession(getBackendConfig({url:'',anonKey:''}));
  vi.stubGlobal('crypto',webcrypto);
  vi.stubGlobal('fetch',()=>Promise.reject(new Error('No live requests in probe')));
  const held=new Set<string>();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{
    async request(name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){
      if(held.has(name))return callback(null);held.add(name);try{return await callback({name,mode:'exclusive'} as never);}finally{held.delete(name);}
    },
  }});
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
  vi.stubGlobal('ResizeObserver',class {record={targets:[] as Element[],disconnected:false};constructor(){observed.push(this.record);}observe(target:Element){this.record.targets.push(target);}disconnect(){this.record.disconnected=true;}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
});
afterEach(()=>{cleanup();layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});mem?.clear();probeController?.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();});

// 2026-11-25 S1-c：室内 2D 手势壳（use-canvas-2d-interaction）已整体退役，
// 三条「两个视图手势」用例失去被测对象（capture.two 恒为 null），
// 会话作用域校验的等值覆盖由壳体与 plan 侧套件承担，这里不再复制。

// 2026-11-25 E2：室内 Viewport 已退役（面板与 #sc-viewport-3d 一并删除），
// 这条断言针对的是室内画布的 2D 观察者；观察者随壳体关闭，保留记录不再执行。
it.skip('disconnects the old 2D canvas observer and observes the replacement after an activity switch',async()=>{
 const a=activity('observer-A');layoutStore.setState({layout:a,activeFloorIndex:0});mem.setItem(STORAGE_KEY,JSON.stringify(a));
 // M3a：会话身份绑 projectId（prop），切换项目经 rerender 换 outdoorProjectId 驱动失效。
 const view=render(<RoomOrganizer outdoorProjectId="observer-A"/>);await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 // 2026-11-11 起工作台默认就是 2D 平面（地理优先主线），不必再点「2D / 3D」切进来。
 const oldCanvas=document.querySelector('#sc-viewport-3d')?.previousElementSibling;expect(oldCanvas?.tagName).toBe('CANVAS');
 await waitFor(()=>expect(observed.some(entry=>entry.targets.includes(oldCanvas!))).toBe(true));
 act(()=>view.rerender(<RoomOrganizer outdoorProjectId="observer-B"/>));
 await waitFor(()=>{const next=document.querySelector('#sc-viewport-3d')?.previousElementSibling;expect(next).toBeTruthy();expect(next).not.toBe(oldCanvas);expect(observed.some(entry=>entry.targets.includes(next!))).toBe(true);});
 expect(observed.some(entry=>entry.targets.includes(oldCanvas!)&&entry.disconnected)).toBe(true);
});
