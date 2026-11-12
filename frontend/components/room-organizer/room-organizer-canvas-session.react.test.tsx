// @vitest-environment jsdom
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {layoutStore} from './hooks/use-layout-store';
import {makeFloor,makeItem,makeLayout} from './lib/__testfixtures__/fixtures';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {STORAGE_KEY} from './lib/constants';

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const capture=vi.hoisted(()=>({two:null as any,three:null as any}));
vi.mock('./hooks/use-three-scene',()=>({useThreeScene:(options:unknown)=>{
  capture.three=options;
  return {isReady:false,error:null,invalidate:()=>{},requestShadowUpdate:()=>{},threeModuleRef:{current:null},sceneRef:{current:null},rendererRef:{current:null},cameraRef:{current:null},controlsRef:{current:null},worldPositionFromClient:()=>null};
}}));
vi.mock('./hooks/use-canvas-2d-interaction',()=>({useCanvas2DInteraction:(options:unknown)=>{capture.two=options;return {clientToWorld2D:()=>null};}}));
import {RoomOrganizer} from './room-organizer';

const observed:Array<{targets:Element[];disconnected:boolean}>=[];
function activity(id:string){return makeLayout({id,name:id,width:20,height:16,roof:{style:'none'},floors:[makeFloor({id:'same-floor',items:[makeItem({id:'same-chair',type:'chair',name:'椅子',position:{x:0,z:0}})]})]});}
beforeEach(()=>{
  capture.two=null;capture.three=null;observed.length=0;
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
  vi.stubGlobal('ResizeObserver',class {record={targets:[] as Element[],disconnected:false};constructor(){observed.push(this.record);}observe(target:Element){this.record.targets.push(target);}disconnect(){this.record.disconnected=true;}});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
});
afterEach(()=>{cleanup();layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

it.each(['two','three'] as const)('allows a current %s gesture to update the active activity',async source=>{
 const a=activity(`current-${source}`);layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<RoomOrganizer/>);await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 const handlers=capture[source];expect(handlers).toBeTruthy();
 act(()=>{handlers.onItemDragStart('same-chair');handlers.onItemDrag('same-chair',3,3);handlers.onItemDragEnd('same-chair');});
 expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({x:3,z:3});
});

it.each(['two','three'] as const)('rejects an old %s drag ending after an activity switch before React cleanup',async source=>{
 const a=activity(`drag-${source}-A`),b=activity(`drag-${source}-B`);layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<RoomOrganizer/>);await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 const handlers=capture[source];expect(handlers).toBeTruthy();
 act(()=>{handlers.onItemDragStart('same-chair');handlers.onItemDrag('same-chair',3,3);layoutStore.setState({layout:b,activeFloorIndex:0});handlers.onItemDragEnd('same-chair');});
 expect(layoutStore.getState().layout.id).toBe(b.id);
 expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({x:0,z:0});
});

it.each(['two','three'] as const)('rejects a stale %s gesture after same-batch A→B→A',async source=>{
 const a=activity(`aba-${source}-A`),b=activity(`aba-${source}-B`);layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<RoomOrganizer/>);await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 const handlers=capture[source];
 act(()=>{handlers.onItemDragStart('same-chair');handlers.onItemDrag('same-chair',3,3);layoutStore.setState({layout:b,activeFloorIndex:0});layoutStore.setState({layout:a,activeFloorIndex:0});handlers.onItemDragEnd('same-chair');});
 expect(layoutStore.getState().layout.id).toBe(a.id);
 expect(layoutStore.getState().layout.floors[0]!.items[0]!.position).toEqual({x:0,z:0});
});

it('disconnects the old 2D canvas observer and observes the replacement after an activity switch',async()=>{
 const a=activity('observer-A'),b=activity('observer-B');layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<RoomOrganizer/>);await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 // 2026-11-11 起工作台默认就是 2D 平面（地理优先主线），不必再点「2D / 3D」切进来。
 const oldCanvas=document.querySelector('#sc-viewport-3d')?.previousElementSibling;expect(oldCanvas?.tagName).toBe('CANVAS');
 await waitFor(()=>expect(observed.some(entry=>entry.targets.includes(oldCanvas!))).toBe(true));
 act(()=>layoutStore.setState({layout:b,activeFloorIndex:0}));
 await waitFor(()=>{const next=document.querySelector('#sc-viewport-3d')?.previousElementSibling;expect(next).toBeTruthy();expect(next).not.toBe(oldCanvas);expect(observed.some(entry=>entry.targets.includes(next!))).toBe(true);});
 expect(observed.some(entry=>entry.targets.includes(oldCanvas!)&&entry.disconnected)).toBe(true);
});
