// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {resetAssistantSessionsStoreForTests} from './hooks/use-assistant-sessions';
import {resetVolatileAssistantMemoriesForTests} from './panels/agent-panel';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import type {UsePlanAnnotationsResult} from './hooks/use-plan-annotations';

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const captured=vi.hoisted(()=>({annotation:null as UsePlanAnnotationsResult|null}));
vi.mock('./hooks/use-plan-annotations',async original=>{
 const actual=await original<typeof import('./hooks/use-plan-annotations')>();
 return {...actual,usePlanAnnotations(){const result=actual.usePlanAnnotations();captured.annotation=result;return result;}};
});
const worldPoint=vi.hoisted(()=>(x:number,y:number)=>({x:x/100,z:y/100}));
vi.mock('./hooks/use-canvas-2d-interaction',()=>({useCanvas2DInteraction:()=>({clientToWorld2D:worldPoint})}));
import {RoomOrganizer} from './room-organizer';

beforeEach(()=>{
 resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 vi.stubGlobal('PointerEvent',MouseEvent);
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
});
afterEach(()=>{cleanup();captured.annotation=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

async function start(){
 const layout=makeLayout({id:'route-activity',width:20,height:20,roof:{style:'none'},floors:[makeFloor({id:'floor-one'}),makeFloor({id:'floor-two'})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 const view=render(<StrictMode><RoomOrganizer/></StrictMode>);
 await screen.findByLabelText('告诉 Agent 要改的');
 // 2026-11-13 左轨「标注」钮已按用户指令移除：测试改走 hook 直入（与原按钮同序 startDraft→zone）。
 act(()=>{captured.annotation!.startDraft();captured.annotation!.setDrawMode('zone');});
 fireEvent.click(await screen.findByRole('button',{name:'画路线'}));
 await waitFor(()=>expect(captured.annotation?.drawMode).toBe('route'));
 const canvas=[...view.container.querySelectorAll('canvas')].find(item=>item.style.display==='block');
 expect(canvas).toBeTruthy();return {canvas:canvas!,layout};
}

it('真实工作台只在用户完成路线时绑定来源和楼层，重复结束不会重复写入',async()=>{
 const {canvas}=await start();
 fireEvent.pointerDown(canvas,{button:0,clientX:100,clientY:100});fireEvent.pointerDown(canvas,{button:0,clientX:200,clientY:100});
 fireEvent.keyDown(window,{key:'Enter'});fireEvent.keyDown(window,{key:'Enter'});
 await waitFor(()=>expect(captured.annotation?.getSnapshot().draft?.annotations.filter(item=>item.kind==='route')).toHaveLength(1));
 const id=captured.annotation!.getSnapshot().draft!.annotations.find(item=>item.kind==='route')!.id;
 expect(captured.annotation!.getUserRouteProvenance(id)).toEqual({source:'user',floorId:'floor-one',sourceBasis:'unknown'});
});

it('真实工作台同批楼层往返时取消未完成路线，不写入新楼层',async()=>{
 const {canvas}=await start();
 fireEvent.pointerDown(canvas,{button:0,clientX:100,clientY:100});
 act(()=>{layoutStore.setState({activeFloorIndex:1});layoutStore.setState({activeFloorIndex:0});});
 fireEvent.pointerDown(canvas,{button:0,clientX:200,clientY:100});fireEvent.keyDown(window,{key:'Enter'});
 await waitFor(()=>expect(captured.annotation?.drawMode).toBe('off'));
 expect(captured.annotation!.getSnapshot().draft?.annotations.filter(item=>item.kind==='route')??[]).toHaveLength(0);
});

it.each(['activity','venue'] as const)('真实工作台同批%s往返时不保存跨版本路线',async kind=>{
 const {canvas,layout}=await start();fireEvent.pointerDown(canvas,{button:0,clientX:100,clientY:100});
 const changed=kind==='activity'?{...layout,id:'different-activity'}:{...layout,width:22};
 act(()=>{layoutStore.setState({layout:changed});layoutStore.setState({layout});});
 fireEvent.pointerDown(canvas,{button:0,clientX:200,clientY:100});fireEvent.keyDown(window,{key:'Enter'});
 await waitFor(()=>expect(captured.annotation?.drawMode).toBe('off'));
 expect(captured.annotation!.getSnapshot().draft?.annotations.filter(item=>item.kind==='route')??[]).toHaveLength(0);
});
