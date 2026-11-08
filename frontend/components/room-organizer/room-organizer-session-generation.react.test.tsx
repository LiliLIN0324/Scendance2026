// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import type {ComponentProps} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {resetAssistantSessionsStoreForTests} from './hooks/use-assistant-sessions';
import {resetVolatileAssistantMemoriesForTests} from './panels/agent-panel';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import type {UsePlanAnnotationsResult} from './hooks/use-plan-annotations';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const capture=vi.hoisted(()=>({annotation:null as UsePlanAnnotationsResult|null,resolve:null as null|(()=>void),calls:0,forcedResolution:null as null|'model'|'failed',dialogue:null as null|(()=>{isCurrent():boolean;release():void;project():{availability:'available'|'unavailable';fields:{headcount:{value:number|null}}}}|null)}));
vi.mock('./hooks/use-plan-annotations',async original=>{const actual=await original<typeof import('./hooks/use-plan-annotations')>();return {...actual,usePlanAnnotations(){const value=actual.usePlanAnnotations();capture.annotation=value;return value;}};});
vi.mock('@/lib/agent-resolver',async original=>{const actual=await original<typeof import('@/lib/agent-resolver')>();return {...actual,resolveBriefTurn:(...args:Parameters<typeof actual.resolveBriefTurn>)=>new Promise(resolve=>{capture.calls++;capture.resolve=()=>{void actual.resolveBriefTurn(...args).then(value=>resolve({...value,...(capture.forcedResolution?{resolution:capture.forcedResolution}:{}),text:'旧活动迟到回复，不应展示'}));};})};});
vi.mock('./panels/creative-studio',async original=>{const actual=await original<typeof import('./panels/creative-studio')>();function Provider(props:ComponentProps<typeof actual.CreativeStudioProvider>){capture.dialogue=props.captureDialogue??null;return <actual.CreativeStudioProvider {...props}/>;}return {...actual,CreativeStudioProvider:Provider};});
import {RoomOrganizer} from './room-organizer';
beforeEach(()=>{resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();capture.calls=0;capture.resolve=null;capture.forcedResolution=null;capture.dialogue=null;
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
});
afterEach(()=>{cleanup();capture.annotation=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
function activity(id:string){return makeLayout({id,name:id,width:20,height:16,roof:{style:'none'},floors:[makeFloor({id:`floor-${id}`,items:[]})]});}
it.each([false,true])('real workspace initial readiness has no false unsaved warning (strict=%s)',async strict=>{
 const a=activity('initial-A');layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(strict?<StrictMode><RoomOrganizer/></StrictMode>:<RoomOrganizer/>);
 expect(await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000})).toBeTruthy();
 expect(screen.queryByText(/会话未能保存在本机/)).toBeNull();
});
it('real workspace discards an old reply across same-batch A→B→A and preserves the unsent draft',async()=>{
 const a=activity('generation-A'),b=activity('generation-B');layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<StrictMode><RoomOrganizer/></StrictMode>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 fireEvent.change(input,{target:{value:'80 人的活动'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await waitFor(()=>expect(capture.calls).toBe(1));
 fireEvent.change(input,{target:{value:'本活动未发送草稿'}});
 act(()=>{layoutStore.setState({layout:b,activeFloorIndex:0});layoutStore.setState({layout:a,activeFloorIndex:0});});
 await act(async()=>{capture.resolve!();await Promise.resolve();});
 await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('本活动未发送草稿'));
 expect(screen.queryByText('旧活动迟到回复，不应展示')).toBeNull();expect(layoutStore.getState().layout.id).toBe('generation-A');
});
it('invalidates an existing dialogue capture at submit and blocks new captures until interpretation finishes',async()=>{
 const a=activity('dialogue-in-flight');layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<StrictMode><RoomOrganizer/></StrictMode>);const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 let before:{isCurrent():boolean;release():void;project():{availability:'available'|'unavailable';fields:{headcount:{value:number|null}}}}|null=null;
 await waitFor(()=>{before=capture.dialogue?.()??null;expect(before).not.toBeNull();});
 fireEvent.change(input,{target:{value:'30人的活动'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 expect(before!.isCurrent()).toBe(false);expect(capture.dialogue!()).toBeNull();await waitFor(()=>expect(capture.calls).toBe(1));
 await act(async()=>{capture.resolve!();await Promise.resolve();});
 await waitFor(()=>{const current=capture.dialogue!();expect(current).not.toBeNull();current?.release();});expect(before!.isCurrent()).toBe(false);before!.release();
});
it('exports partial dialogue after a failed correction until the same words are successfully understood',async()=>{
 const a=activity('dialogue-incomplete');layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<StrictMode><RoomOrganizer/></StrictMode>);const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 async function submit(text:string,resolution:'model'|'failed',call:number){capture.forcedResolution=resolution;fireEvent.change(input,{target:{value:text}});fireEvent.click(screen.getByRole('button',{name:'发送'}));await waitFor(()=>expect(capture.calls).toBe(call));await act(async()=>{capture.resolve!();await Promise.resolve();});}
 await submit('30人','model',1);await waitFor(()=>{const current=capture.dialogue?.();expect(current?.project().fields.headcount.value).toBe(30);current?.release();});
 await submit('40人','failed',2);await waitFor(()=>{const current=capture.dialogue?.();expect(current?.project().availability).toBe('unavailable');current?.release();});
 await submit('40人','model',3);await waitFor(()=>{const current=capture.dialogue?.();expect(current?.project().availability).toBe('available');expect(current?.project().fields.headcount.value).toBe(40);current?.release();});
});
it('real workspace rejects an old zone preview after same-batch A→B→A without changing the draft or canvas',async()=>{
 const a=activity('preview-A'),b=activity('preview-B');layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<StrictMode><RoomOrganizer/></StrictMode>);await waitFor(()=>expect(capture.annotation).not.toBeNull());
 act(()=>capture.annotation!.addZoneRects([{zoneType:'desk',label:'保留的座席区',rect:{x:0,z:0,width:8,depth:6}}]));
 const button=await screen.findByRole('button',{name:'应用布置'}),before=structuredClone(layoutStore.getState().layout);
 act(()=>{layoutStore.setState({layout:b,activeFloorIndex:0});layoutStore.setState({layout:a,activeFloorIndex:0});fireEvent.click(button);});
 expect(layoutStore.getState().layout).toEqual(before);
 expect(capture.annotation!.getSnapshot().draft?.annotations.map(item=>item.label)).toContain('保留的座席区');
});
