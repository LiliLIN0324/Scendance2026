// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {resetAssistantSessionsStoreForTests} from './hooks/use-assistant-sessions';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const capture=vi.hoisted(()=>({pick:null as null|((value:{name:string;location:string;polygon:{lng:number;lat:number}[]})=>string|null)}));
vi.mock('./panels/agent-panel',async original=>{
 const actual=await original<typeof import('./panels/agent-panel')>(),React=await import('react');
 function Probe(){capture.pick=actual.useAgent().applyMapVenuePick;return null;}
 function Wrapped(props:React.ComponentProps<typeof actual.LayoutAgentProvider>){return React.createElement(actual.LayoutAgentProvider,props,React.createElement(Probe),props.children);}
 return {...actual,LayoutAgentProvider:Wrapped};
});
import {RoomOrganizer} from './room-organizer';
beforeEach(()=>{resetAssistantSessionsStoreForTests();vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);});
afterEach(()=>{cleanup();capture.pick=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('refuses map replacement before changing a two-floor activity, locked upper chair, region or draft',async()=>{
 const layout=makeLayout({id:'map-multifloor',name:'活动',floors:[makeFloor({id:'ground',items:[],zones:[{id:'checkin',name:'签到区',x:0,z:0,w:1,d:1,color:'#fff'}]}),makeFloor({id:'upper',items:[makeItem({id:'locked',name:'锁定椅',locked:true})]})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));render(<RoomOrganizer/>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});fireEvent.change(input,{target:{value:'尚未发送的草稿'}});
 await waitFor(()=>expect(capture.pick).not.toBeNull());const before=structuredClone(layoutStore.getState().layout);let reason:string|null=null;
 act(()=>{reason=capture.pick!({name:'测试',location:'测试',polygon:[{lng:120.53,lat:30.40},{lng:120.531,lat:30.40},{lng:120.531,lat:30.401},{lng:120.53,lat:30.401}]});});
 expect(reason).toContain('多个楼层');expect(layoutStore.getState().layout).toEqual(before);
 expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('尚未发送的草稿');
});

it('keeps the user-drawn zone when a single-floor map selection is applied',async()=>{
 const layout=makeLayout({id:'map-single',name:'活动',floors:[makeFloor({id:'ground',items:[],zones:[{id:'zone',name:'签到区',x:0,z:0,w:1,d:1,color:'#fff'}]})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));render(<RoomOrganizer/>);
 await waitFor(()=>expect(capture.pick).not.toBeNull());let reason:string|null='pending';
 act(()=>{reason=capture.pick!({name:'测试',location:'测试',polygon:[{lng:120.53,lat:30.40},{lng:120.531,lat:30.40},{lng:120.531,lat:30.401},{lng:120.53,lat:30.401}]});});
 expect(reason).toBeNull();const saved=layoutStore.getState().layout;
 expect(saved.floors[0]!.id).toBe('ground');expect(saved.floors[0]!.zones?.[0]?.name).toBe('签到区');
});
