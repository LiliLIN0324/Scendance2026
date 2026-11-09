// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {createBackendSession} from '@/lib/backend-session';
import {layoutStore} from './hooks/use-layout-store';
import {getActiveAssistantSessionId,resetAssistantSessionsStoreForTests} from './hooks/use-assistant-sessions';
import {initialBriefMemory} from './lib/brief-agent';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {STORAGE_KEY} from './lib/constants';
import {resetVolatileAssistantMemoriesForTests} from './panels/agent-panel';
import type {SeatingAllocationCapture} from './panels/creative-studio';

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
const captures=vi.hoisted(()=>({seating:null as null|(()=>SeatingAllocationCapture),begin:null as null|(()=>()=>void),brief:null as null|((memory:ReturnType<typeof initialBriefMemory>,id:string|null)=>void),captureOnRelease:false,last:null as SeatingAllocationCapture|null,validAfterRelease:false}));
vi.mock('./panels/creative-studio',async original=>{
 const actual=await original<typeof import('./panels/creative-studio')>();
 return {...actual,CreativeStudioProvider:(props:Parameters<typeof actual.CreativeStudioProvider>[0])=>{
  captures.seating=props.captureSeatingAllocation??null;return <actual.CreativeStudioProvider {...props}/>;
 }};
});
vi.mock('./panels/agent-panel',async original=>{
 const actual=await original<typeof import('./panels/agent-panel')>();
 return {...actual,LayoutAgentProvider:(props:Parameters<typeof actual.LayoutAgentProvider>[0])=>{
  captures.begin=props.onDialogueTurnStart??null;captures.brief=props.onBriefMemoryChange??null;
  const onDialogueTurnStart=props.onDialogueTurnStart?()=>{const release=props.onDialogueTurnStart!();return()=>{
    if(captures.captureOnRelease)captures.last=captures.seating?.()??null;
    release();
    if(captures.captureOnRelease&&captures.last?.status==='ready')captures.validAfterRelease=captures.last.isCurrent();
  };}:undefined;
  return <actual.LayoutAgentProvider {...props} onDialogueTurnStart={onDialogueTurnStart}/>;
 }};
});
import {RoomOrganizer} from './room-organizer';

afterEach(()=>{cleanup();captures.seating=null;captures.begin=null;captures.brief=null;captures.captureOnRelease=false;captures.last=null;captures.validAfterRelease=false;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();localStorage.clear();});
it('keeps an annotation capture valid when its originating turn finishes, but invalidates it on a later input',async()=>{
 vi.stubEnv('NEXT_PUBLIC_AGENT_ANNOTATION_OBSERVATION','1');
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();
 const layout=makeLayout({id:'annotation-capture',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'floor-a',items:[]})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 const controller=createBackendSession();const snapshot={...controller.getSnapshot(),user:{id:'synthetic-owner'}};
 vi.spyOn(controller,'getSnapshot').mockReturnValue(snapshot);
 render(<RoomOrganizer controller={controller}/>);await screen.findByLabelText('告诉 Agent 要改的');
 const scope='activity:annotation-capture';let sessionId:string|null=null;
 await waitFor(()=>{sessionId=getActiveAssistantSessionId(scope);expect(sessionId).toBeTruthy();expect(captures.begin).toBeTruthy();expect(captures.brief).toBeTruthy();expect(captures.seating).toBeTruthy();});
 let finish!:()=>void;act(()=>{finish=captures.begin!();captures.brief!(initialBriefMemory(),sessionId);});
 let captured!:SeatingAllocationCapture;
 await waitFor(()=>{captured=captures.seating!();expect(captured.status).toBe('ready');});
 if(captured.status!=='ready')throw Error('capture unavailable');
 expect(captured.annotationObservation?.status).toBe('ready');expect(captured.isCurrent()).toBe(true);
 act(()=>finish());expect(captured.isCurrent()).toBe(true);
 let next!:()=>void;act(()=>{next=captures.begin!();});expect(captured.isCurrent()).toBe(false);act(()=>next());
},35000);

it('retains the real sent turn through release and rejects a repeated later message',async()=>{
 vi.stubEnv('NEXT_PUBLIC_AGENT_ANNOTATION_OBSERVATION','1');vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','0');
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();
 const layout=makeLayout({id:'annotation-real-send',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'floor-a',items:[]})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 const controller=createBackendSession();const snapshot={...controller.getSnapshot(),user:{id:'synthetic-owner'}};vi.spyOn(controller,'getSnapshot').mockReturnValue(snapshot);
 render(<RoomOrganizer controller={controller}/>);const input=await screen.findByLabelText('告诉 Agent 要改的');
 await waitFor(()=>expect(getActiveAssistantSessionId('activity:annotation-real-send')).toBeTruthy());
 captures.captureOnRelease=true;
 fireEvent.change(input,{target:{value:'30人'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await waitFor(()=>{expect(captures.last?.status).toBe('ready');expect(captures.validAfterRelease).toBe(true);});
 const first=captures.last;if(!first||first.status!=='ready')throw Error('capture unavailable');
 captures.captureOnRelease=false;
 fireEvent.change(input,{target:{value:'30人'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 expect(first.isCurrent()).toBe(false);
},35000);

it('invalidates the RoomOrganizer annotation capture when the account changes A to B and back to A',async()=>{
 vi.stubEnv('NEXT_PUBLIC_AGENT_ANNOTATION_OBSERVATION','1');
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));vi.stubGlobal('ResizeObserver',class{observe(){} disconnect(){}});
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
 Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
 Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
 resetAssistantSessionsStoreForTests();resetVolatileAssistantMemoriesForTests();
 const layout=makeLayout({id:'annotation-actor-aba',width:12,height:9,roof:{style:'none'},floors:[makeFloor({id:'floor-a',items:[]})]});
 layoutStore.setState({layout,activeFloorIndex:0});localStorage.setItem(STORAGE_KEY,JSON.stringify(layout));
 const controller=createBackendSession();
 const auth=controller as unknown as {authRequest:(grant:string,body:{email:string})=>Promise<{access_token:string;refresh_token:string;expires_in:number;user:{id:string}}>};
 vi.spyOn(auth,'authRequest').mockImplementation(async(_grant,body)=>({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,user:{id:body.email}}));
 await controller.signIn('account-a@example.test','synthetic');
 render(<RoomOrganizer controller={controller}/>);await screen.findByLabelText('告诉 Agent 要改的');
 const scope='activity:annotation-actor-aba';let sessionId:string|null=null;
 await waitFor(()=>{sessionId=getActiveAssistantSessionId(scope);expect(sessionId).toBeTruthy();expect(captures.brief).toBeTruthy();expect(captures.seating).toBeTruthy();});
 act(()=>captures.brief!(initialBriefMemory(),sessionId));
 let captured!:SeatingAllocationCapture;
 await waitFor(()=>{captured=captures.seating!();expect(captured.status).toBe('ready');});
 if(captured.status!=='ready')throw Error('capture unavailable');
 expect(captured.annotationObservation?.status).toBe('ready');expect(captured.isCurrent()).toBe(true);
 await act(async()=>{await controller.signIn('account-b@example.test','synthetic');await controller.signIn('account-a@example.test','synthetic');});
 expect(controller.getSnapshot().user?.id).toBe('account-a@example.test');
 expect(captured.isCurrent()).toBe(false);
 controller.dispose();
},35000);
