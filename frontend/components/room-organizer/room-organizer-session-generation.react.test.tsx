// @vitest-environment jsdom
// 路线 1（#47）：保留 Agent/Studio 真实挂载，桩掉 three 场景、2D 交互、next 路由/动态导入与未配置后端会话。
// readiness 例走真实壳体路径；对话链用例（发送/迟到回复/人数导出/zone 守卫）逐例补桩恢复，未成立者暂 skip。
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StrictMode} from 'react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {resetAssistantSessionsStoreForTests} from './hooks/use-assistant-sessions';
import {makeFloor,makeLayout} from './lib/__testfixtures__/fixtures';
import {layoutStore} from './hooks/use-layout-store';
import {STORAGE_KEY} from './lib/constants';
import {INITIAL_LAYOUT} from './lib/initial-layout';
import {MemoryStorage} from '@/lib/test-support-memory-storage';
import {AGENT_SUPERVISION_KEY} from './lib/agent-supervision-store';
import {BackendSession,getBackendConfig} from '@/lib/backend-session';
import {createStarterOutdoorPlan} from './lib/outdoor-project-store';
import type {UsePlanAnnotationsResult} from './hooks/use-plan-annotations';

const capture=vi.hoisted(()=>({annotation:null as UsePlanAnnotationsResult|null,resolve:null as null|(()=>void),calls:0,chatCalls:0,applyPlan:0,applyZone:0,responses:[] as Array<{action:'scope'|'zones'|'ask';facts?:Record<string,unknown>;status?:'ok'|'failed'|'disabled'|'offline'|'rate-limited'}>,agent:null as unknown,forcedResolution:null as null|'model'|'failed',dialogue:null as null|(()=>{isCurrent():boolean;release():void;project():{availability:'available'|'unavailable';fields:{headcount:{value:number|null}}}}|null)}));
let probeController:BackendSession;
let mem:MemoryStorage;
let stubPlan:ReturnType<typeof createStarterOutdoorPlan>;

vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=> '/',useSearchParams:()=>new URLSearchParams()}));
vi.mock('./hooks/use-plan-annotations',async original=>{const actual=await original<typeof import('./hooks/use-plan-annotations')>();return {...actual,usePlanAnnotations(){const value=actual.usePlanAnnotations();capture.annotation=value;return value;}};});
vi.mock('@/lib/agent-resolver',async original=>{const actual=await original<typeof import('@/lib/agent-resolver')>();return {...actual,resolveBriefTurn:(...args:Parameters<typeof actual.resolveBriefTurn>)=>new Promise(resolve=>{capture.calls++;capture.resolve=()=>{void actual.resolveBriefTurn(...args).then(value=>resolve({...value,...(capture.forcedResolution?{resolution:capture.forcedResolution}:{}),text:'旧活动迟到回复，不应展示'}));};})};});
vi.mock('@/lib/backend-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/backend-session')>();
  return { ...actual, createBackendSession: () => probeController };
});
vi.mock('./hooks/use-three-scene',()=>({useThreeScene:()=>({isReady:false,error:null,invalidate:()=>{},requestShadowUpdate:()=>{},threeModuleRef:{current:null},sceneRef:{current:null},rendererRef:{current:null},cameraRef:{current:null},controlsRef:{current:null},worldPositionFromClient:()=>null})}));
vi.mock('./hooks/use-canvas-2d-interaction',()=>({useCanvas2DInteraction:()=>({clientToWorld2D:()=>null})}));
vi.mock('./hooks/use-assistant-sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/use-assistant-sessions')>();
  const activeId = 'probe-active-session';
  return {
    ...actual,
    resetAssistantSessionsStoreForTests: () => {},
    useAssistantSessions: () => ({
      ready: true, saveFailed: false, activeId,
      activeSession: { id: activeId, title: '新会话' }, visible: [], totalCount: 1, query: '',
      setQuery: () => {}, openSession: () => ({ id: activeId, verifiedFresh: false }),
      selectSession: () => {}, renameSession: () => {}, toggleFavorite: () => {}, deleteSession: () => {}, touchActiveSession: () => {},
    }),
    assistantSessionExists: () => true,
    getActiveAssistantSessionId: () => activeId,
    subscribeActiveAssistantSession: () => () => {},
    scopedAssistantStorage: () => undefined,
  };
});
vi.mock('./components/outdoor-plan-overlay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/outdoor-plan-overlay')>();
  const { useEffect } = await import('react');
  const { useAgent } = await import('./panels/agent-panel');
  function StubOverlay() {
    const agent = useAgent();
    capture.agent = agent;
    useEffect(() => {
      agent?.registerRouteBridge?.({
        getPlan: () => stubPlan,
        projectId: () => 'probe-project',
        selectedIds: () => [],
        applyPlan: (next) => { capture.applyPlan++; stubPlan = next; return true; },
        applyVenue: () => true,
        beginVenueBoundary: () => true,
        applyRoutes: () => true,
        applyZoneProposal: () => { capture.applyZone++; return true; },
      });
      return () => agent?.registerRouteBridge?.(null);
    }, []);
    return null;
  }
  return { ...actual, default: StubOverlay };
});
vi.mock('./panels/creative-studio',async original=>{const actual=await original<typeof import('./panels/creative-studio')>();return {...actual,CreativeStudioProvider:(props:Parameters<typeof actual.CreativeStudioProvider>[0])=>{capture.dialogue=(props.captureDialogue??null) as typeof capture.dialogue;return <actual.CreativeStudioProvider {...props}/>;}};});
import {RoomOrganizer} from './room-organizer';

beforeEach(()=>{
  resetAssistantSessionsStoreForTests();capture.calls=0;capture.chatCalls=0;capture.applyPlan=0;capture.applyZone=0;capture.resolve=null;capture.forcedResolution=null;capture.dialogue=null;capture.responses=[];
  stubPlan={...createStarterOutdoorPlan(),boundary:[{x:0,y:0},{x:80,y:0},{x:80,y:70},{x:0,y:70}]};
  mem=new MemoryStorage();vi.stubGlobal('Storage',MemoryStorage);vi.stubGlobal('localStorage',mem);window.localStorage=mem;mem.setItem(AGENT_SUPERVISION_KEY,'strict');
  probeController=new BackendSession(getBackendConfig({url:'',anonKey:''}));
  (probeController as unknown as {snapshot:{user:unknown}}).snapshot.user={id:'probe-owner',email:'owner@scendance.test',is_anonymous:false};
  const chatResult=()=>{const next=capture.responses.shift()??{action:'ask' as const,facts:{}};return {status:(next.status??'ok') as 'ok'|'failed'|'disabled'|'offline'|'rate-limited',answer:JSON.stringify({action:next.action,reply:'',references:[],facts:next.facts??{}})};};
  (probeController as unknown as {assistantChat:unknown}).assistantChat=vi.fn(async()=>{capture.chatCalls++;return chatResult();});
  (probeController as unknown as {assistantChatStream:unknown}).assistantChatStream=vi.fn(async()=>{capture.chatCalls++;return chatResult();});
  vi.stubGlobal('crypto',webcrypto);
  vi.stubGlobal('fetch',()=>Promise.reject(new Error('No live requests in probe')));
  const held=new Set<string>();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{
    async request(name:string,_opts:unknown,callback:(lock:unknown)=>Promise<unknown>){
      if(held.has(name))return callback(null);held.add(name);try{return await callback({name,mode:'exclusive'} as never);}finally{held.delete(name);}
    },
  }});
  vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener:()=>{},removeEventListener:()=>{}}));
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);
});
afterEach(()=>{cleanup();capture.annotation=null;layoutStore.setState({layout:INITIAL_LAYOUT,activeFloorIndex:0});mem?.clear();probeController?.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();});
function activity(id:string){return makeLayout({id,name:id,width:20,height:16,roof:{style:'none'},floors:[makeFloor({id:`floor-${id}`,items:[]})]});}
it.each([false,true])('real workspace initial readiness has no false unsaved warning (strict=%s)',async strict=>{
 const a=activity('initial-A');layoutStore.setState({layout:a,activeFloorIndex:0});mem.setItem(STORAGE_KEY,JSON.stringify(a));
 render(strict?<StrictMode><RoomOrganizer/></StrictMode>:<RoomOrganizer/>);
 expect(await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000})).toBeTruthy();
 expect(screen.queryByText(/会话未能保存在本机/)).toBeNull();
});
it('real workspace discards an old reply across same-batch A→B→A and preserves the unsent draft',async()=>{
 const a=activity('generation-A'),b=activity('generation-B');layoutStore.setState({layout:a,activeFloorIndex:0});mem.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<StrictMode><RoomOrganizer/></StrictMode>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 fireEvent.change(input,{target:{value:'80 人的活动'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await act(async()=>{await Promise.resolve();});
 await waitFor(()=>expect(capture.chatCalls).toBe(1));
 fireEvent.change(input,{target:{value:'本活动未发送草稿'}});
 act(()=>{layoutStore.setState({layout:b,activeFloorIndex:0});layoutStore.setState({layout:a,activeFloorIndex:0});});
 await act(async()=>{await Promise.resolve();});
 await waitFor(()=>expect((screen.getByLabelText('告诉 Agent 要改的') as HTMLTextAreaElement).value).toBe('本活动未发送草稿'));
 expect(screen.queryByText('旧活动迟到回复，不应展示')).toBeNull();expect(layoutStore.getState().layout.id).toBe('generation-A');
});
it('invalidates an existing dialogue capture at submit and blocks new captures until interpretation finishes',async()=>{
 const a=activity('dialogue-in-flight');layoutStore.setState({layout:a,activeFloorIndex:0});mem.setItem(STORAGE_KEY,JSON.stringify(a));
 render(<StrictMode><RoomOrganizer/></StrictMode>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{}, {timeout:15000});
 await waitFor(()=>expect(capture.dialogue).not.toBeNull(),{timeout:8000});
 const getter=capture.dialogue!;
 const before=getter(); expect(before).not.toBeNull();expect(before!.isCurrent()).toBe(true);
 fireEvent.change(input,{target:{value:'30人的活动'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 expect(before!.isCurrent()).toBe(false);expect(getter()).toBeNull();
 await waitFor(()=>{const current=getter();expect(current).not.toBeNull();expect(current!.isCurrent()).toBe(true);},{timeout:8000});
 before!.release();
});
it('keeps the last recorded headcount when understanding fails, and only adopts a new number after a successful turn',async()=>{
 const a=activity('dialogue-incomplete');layoutStore.setState({layout:a,activeFloorIndex:0});mem.setItem(STORAGE_KEY,JSON.stringify(a));
 capture.responses.push(
  {action:'ask',facts:{guests:{value:30,evidence:'30人'}}},
  {action:'ask',status:'failed',facts:{}},
  {action:'ask',facts:{guests:{value:40,evidence:'40人'}}},
 );
 render(<StrictMode><RoomOrganizer outdoorProjectId="dialogue-incomplete"/></StrictMode>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{},{timeout:15000});
 const restart=screen.queryByRole('button',{name:'按当前记录重新开始'});if(restart)fireEvent.click(restart);
 // 人数落在工作流持久桶（不是 legacy 简报 capture）：键随项目 scope 派生。
 const flowBrief=()=>{const raw=mem.getItem('scendance:outdoor-flow:project:dialogue-incomplete');return raw?JSON.parse(raw) as {brief:{guests?:number}}:null;};
 async function submit(text:string,call:number){fireEvent.change(input,{target:{value:text}});fireEvent.click(screen.getByRole('button',{name:'发送'}));await waitFor(()=>expect(capture.chatCalls).toBe(call),{timeout:8000});await act(async()=>{await new Promise(r=>setTimeout(r,80));});}
 await submit('30人',1);
 await waitFor(()=>expect(flowBrief()?.brief.guests).toBe(30));
 // 理解失败轮：用户看到失败卡，但已录人数不被清空、也不被本句猜出的数字覆盖。
 await submit('40人',2);
 expect(await screen.findByText(/这一步没做成/)).toBeTruthy();
 expect(flowBrief()?.brief.guests).toBe(30);
 expect(capture.applyPlan).toBe(0);
 // 重试成功后新人数才生效。
 await submit('40人',3);
 await waitFor(()=>expect(flowBrief()?.brief.guests).toBe(40));
 expect(capture.applyPlan).toBe(0);
});
it('rejects an old zone workflow preview after same-batch A→B→A without writing the plan',async()=>{
 const a=activity('preview-A');layoutStore.setState({layout:a,activeFloorIndex:0});mem.setItem(STORAGE_KEY,JSON.stringify(a));
 capture.responses.push(
  {action:'scope',facts:{}},
  {action:'zones',facts:{event:{value:'户外市集',evidence:'户外市集'},guests:{value:45,evidence:'45人'},zones:[{name:'展览区',purpose:'exhibition',environment:'outdoor',evidence:'室外展览区'}]}},
 );
 const view=render(<StrictMode><RoomOrganizer outdoorProjectId="probe-project-a"/></StrictMode>);
 const input=await screen.findByLabelText('告诉 Agent 要改的',{},{timeout:15000});
 const wf=()=>capture.agent as unknown as {outdoorWorkflow:{proposal:{kind:string}|null;scopeConfirmed:()=>boolean}};
 fireEvent.change(input,{target:{value:'帮我核对这次的实际活动场地'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await waitFor(()=>expect(wf().outdoorWorkflow.proposal?.kind).toBe('scope'),{timeout:8000});
 fireEvent.click(screen.getByRole('button',{name:'确认并应用这一版'}));
 await waitFor(()=>expect(wf().outdoorWorkflow.scopeConfirmed()).toBe(true),{timeout:8000});
 fireEvent.change(input,{target:{value:'户外市集45人，划室外展览区'}});fireEvent.click(screen.getByRole('button',{name:'发送'}));
 await waitFor(()=>expect(wf().outdoorWorkflow.proposal?.kind).toBe('zones'),{timeout:8000});
 const zonesBefore=stubPlan.zones.length;const applyBefore=capture.applyPlan;
 await act(async()=>{view.rerender(<StrictMode><RoomOrganizer outdoorProjectId="probe-project-b"/></StrictMode>);});
 await act(async()=>{view.rerender(<StrictMode><RoomOrganizer outdoorProjectId="probe-project-a"/></StrictMode>);});
 expect(wf().outdoorWorkflow.proposal).toBeNull();
 expect(stubPlan.zones.length).toBe(zonesBefore);
 expect(capture.applyPlan).toBe(applyBefore);
 expect(capture.applyZone).toBe(0);
});
