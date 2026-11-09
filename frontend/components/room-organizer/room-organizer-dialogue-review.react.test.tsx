// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {layoutStore} from './hooks/use-layout-store';
import {useAssistantSessions} from './hooks/use-assistant-sessions';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {STORAGE_KEY} from './lib/constants';

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const captures=vi.hoisted(()=>({dialogue:null as null|(()=>{isCurrent():boolean;release():void}|null)}));
vi.mock('./hooks/use-three-scene',()=>({useThreeScene:()=>({isReady:false,error:null,invalidate:()=>{},requestShadowUpdate:()=>{},threeModuleRef:{current:null},sceneRef:{current:null},rendererRef:{current:null},cameraRef:{current:null},controlsRef:{current:null},worldPositionFromClient:()=>null})}));
vi.mock('./hooks/use-canvas-2d-interaction',()=>({useCanvas2DInteraction:()=>({clientToWorld2D:()=>null})}));
vi.mock('./panels/creative-studio',async original=>{
 const actual=await original<typeof import('./panels/creative-studio')>();
 return {...actual,CreativeStudioProvider:(props:Parameters<typeof actual.CreativeStudioProvider>[0])=>{
  captures.dialogue=props.captureDialogue??null;
  return <actual.CreativeStudioProvider {...props}/>;
 }};
});
import {RoomOrganizer} from './room-organizer';

afterEach(()=>{cleanup();captures.dialogue=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
it('keeps Studio dialogue capture unavailable until this activity session is explicitly reviewed',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 const layout=makeLayout({id:'dialogue-review-real',name:'活动',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'floor',items:[]})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 render(<RoomOrganizer/>);
 await screen.findByLabelText('告诉 Agent 要改的',{},{timeout:15000});
 const restart=screen.queryByRole('button',{name:'按当前记录重新开始'});
 if(restart)fireEvent.click(restart);
 expect(captures.dialogue).toBeTruthy();
 expect(screen.queryByText('当前活动或会话正在变化，请稍后重新核对。')).toBeNull();
 let captured:ReturnType<NonNullable<typeof captures.dialogue>>=null;
 await waitFor(()=>{captured=captures.dialogue!();expect(captured).not.toBeNull();});
 expect(captured!.isCurrent()).toBe(true);
 act(()=>layoutStore.setState({layout:makeLayout({id:'other-activity',width:12,height:9}),activeFloorIndex:0}));
 expect(captured!.isCurrent()).toBe(false);captured!.release();
},35000);

it('invalidates the reviewed capture across an immediate session away-and-back',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 const layout=makeLayout({id:'dialogue-review-switch',name:'活动',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'floor',items:[]})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 function Switch(){const sessions=useAssistantSessions(()=>{},'activity:dialogue-review-switch');return <button onClick={()=>{const original=sessions.activeId;if(original){sessions.openSession();sessions.selectSession(original);}}}>切换后返回</button>;}
 render(<><RoomOrganizer/><Switch/></>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{},{timeout:15000});
 const restart=screen.queryByRole('button',{name:'按当前记录重新开始'});if(restart)fireEvent.click(restart);
 fireEvent.change(input,{target:{value:'先记一句对话'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 let captured:ReturnType<NonNullable<typeof captures.dialogue>>=null;
 await waitFor(()=>{captured=captures.dialogue!();expect(captured).not.toBeNull();});
 fireEvent.click(screen.getByRole('button',{name:'切换后返回'}));
 expect(captured!.isCurrent()).toBe(false);expect(captures.dialogue!()).toBeNull();captured!.release();
 expect(await screen.findByRole('region',{name:'历史需求待核对'})).toBeTruthy();
},35000);

it('does not reuse an activity review after switching away and back',async()=>{
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
 vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 const a=makeLayout({id:'dialogue-review-activity-a',name:'活动A',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'floor',items:[]})]});
 const b=makeLayout({id:'dialogue-review-activity-b',name:'活动B',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'floor',items:[]})]});
 layoutStore.setState({layout:a,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<RoomOrganizer/>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{},{timeout:15000});
 const restart=screen.queryByRole('button',{name:'按当前记录重新开始'});if(restart)fireEvent.click(restart);
 fireEvent.change(input,{target:{value:'先记一句对话'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 let before:ReturnType<NonNullable<typeof captures.dialogue>>=null;
 await waitFor(()=>{before=captures.dialogue!();expect(before).not.toBeNull();});
 act(()=>{layoutStore.setState({layout:b,activeFloorIndex:0});layoutStore.setState({layout:a,activeFloorIndex:0});});
 expect(before!.isCurrent()).toBe(false);before!.release();
 await screen.findByRole('region',{name:'历史需求待核对'});
 expect(captures.dialogue!()).toBeNull();
},35000);
