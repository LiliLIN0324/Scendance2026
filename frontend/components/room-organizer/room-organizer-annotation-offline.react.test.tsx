// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import type {UsePlanAnnotationsResult} from './hooks/use-plan-annotations';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const noFloorCapture=vi.hoisted(()=>()=>null);
vi.mock('./lib/floor-session-epoch',async original=>{const actual=await original<typeof import('./lib/floor-session-epoch')>();return {...actual,useFloorSessionTracker:(...args:Parameters<typeof actual.useFloorSessionTracker>)=>({...actual.useFloorSessionTracker(...args),capture:noFloorCapture})};});
const captured=vi.hoisted(()=>({annotation:null as UsePlanAnnotationsResult|null}));
vi.mock('./hooks/use-plan-annotations',async original=>{const actual=await original<typeof import('./hooks/use-plan-annotations')>();return {...actual,usePlanAnnotations(){const result=actual.usePlanAnnotations();captured.annotation=result;return result;}};});
const worldPoint=vi.hoisted(()=>(x:number,y:number)=>({x:x/100,z:y/100}));
vi.mock('./hooks/use-canvas-2d-interaction',()=>({useCanvas2DInteraction:()=>({clientToWorld2D:worldPoint})}));
import {RoomOrganizer} from './room-organizer';
beforeEach(()=>{Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});vi.stubEnv('NEXT_PUBLIC_AGENT_ANNOTATION_OBSERVATION','0');vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));vi.stubGlobal('PointerEvent',MouseEvent);vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);});
afterEach(()=>{cleanup();captured.annotation=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();localStorage.clear();});
it.each([['画区域','zone'],['量距离','measure'],['标出入口','door']] as const)('关闭实验时，无楼层快照的离线工作台仍能%s',async(label,kind)=>{
 const layout=makeLayout({id:'offline-drawing',width:20,height:20,roof:{style:'none'},floors:[makeFloor({id:'floor-one'})]});layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 // 2026-11-13 左轨「标注」钮已按用户指令移除：测试改走 hook 直入（与原按钮同序 startDraft→zone）。
 const view=render(<RoomOrganizer/>);await screen.findByLabelText('告诉 Agent 要改的');act(()=>{captured.annotation!.startDraft();captured.annotation!.setDrawMode('zone');});fireEvent.click(await screen.findByRole('button',{name:label}));
 const canvas=[...view.container.querySelectorAll('canvas')].find(item=>item.style.display==='block');expect(canvas).toBeTruthy();
 if(kind==='zone'){fireEvent.pointerDown(canvas!,{button:0,clientX:100,clientY:100});fireEvent.pointerUp(canvas!,{button:0,clientX:200,clientY:200});}
 else if(kind==='measure'){fireEvent.pointerDown(canvas!,{button:0,clientX:100,clientY:100});fireEvent.pointerDown(canvas!,{button:0,clientX:200,clientY:200});}
 else fireEvent.pointerDown(canvas!,{button:0,clientX:1000,clientY:100});
 await waitFor(()=>expect(captured.annotation?.getSnapshot().draft?.annotations.filter(a=>a.kind===kind)).toHaveLength(1));
},35000);
