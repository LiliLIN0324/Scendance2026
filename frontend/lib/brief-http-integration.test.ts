/// <reference path="../../supabase/functions/_shared/vendor.d.ts" />
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {startLocalServer,testAccounts,testPublicKey} from '../../tests/local-server';
import {createLocalAgentModel} from '../../scripts/local-agent-model';
import {BackendSession,getBackendConfig} from './backend-session';
import {resolveBriefTurn} from './agent-resolver';
import {initialBriefMemory} from '../components/room-organizer/lib/brief-agent';
import {localPlan} from '../components/room-organizer/lib/local-plan';
import {makeFloor,makeLayout} from '../components/room-organizer/lib/__testfixtures__/fixtures';

describe('brief → real local HTTP API → confirmation → local candidate',()=>{
 let valid:Awaited<ReturnType<typeof startLocalServer>>,invalid:Awaited<ReturnType<typeof startLocalServer>>;
 const controllers:BackendSession[]=[];
 beforeAll(async()=>{valid=await startLocalServer(0,createLocalAgentModel());invalid=await startLocalServer(0,createLocalAgentModel({briefMode:'invalid'}));},60_000);
 afterAll(async()=>{for(const c of controllers)c.dispose();await valid?.close();await invalid?.close();});
 afterEach(()=>vi.unstubAllEnvs());
 async function login(server:typeof valid){const c=new BackendSession(getBackendConfig({url:server.url,anonKey:testPublicKey}));controllers.push(c);await c.signIn(testAccounts[0]!.email,testAccounts[0]!.password);return c;}
 it('propagates exact user evidence, asks for confirmation, and creates a candidate without mutating the original',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const controller=await login(valid);
  const text='8人，室内12×9米，圆桌，宾客先在入口登记，台上要有供演讲者使用的高台';
  const context={venueUp:true,scaleTyped:true,hasBase:false,command:'first' as const};
  const turn=await resolveBriefTurn(text,initialBriefMemory(),context,controller);
  expect(turn.resolution).toBe('model');expect(turn.memory.pendingActivityNeeds.map(x=>x.evidence)).toEqual(['宾客先在入口登记','台上要有供演讲者使用的高台']);
  expect(turn.memory.zoneNeeds.checkin).toBeNull();expect(turn.memory.zoneNeeds.stage).toBeNull();
  const confirm=await resolveBriefTurn('确认',turn.memory,{...context,command:null},controller);
  expect(confirm.memory.zoneNeeds).toMatchObject({checkin:true,stage:true});
  const layout=makeLayout({width:12,height:9,floors:[makeFloor({items:[]})]}),before=structuredClone(layout);
  const plan=localPlan({base:layout,floorIndex:0,widthM:12,depthM:9,variant:0,guests:confirm.memory.headcount,layoutMode:confirm.memory.layoutMode,stage:true,checkin:true,functionalNeeds:{checkin:true,stage:true}});
  expect(layout).toEqual(before);expect(plan.layouts.at(-1)?.floors[0]?.items.length).toBeGreaterThan(0);
  expect(plan.layouts.at(-1)?.floors[0]?.items.some(item=>item.materialId==='reception')).toBe(true);
  expect(plan.layouts.at(-1)?.floors[0]?.items.some(item=>item.name==='舞台平台（示意）')).toBe(true);
 },30_000);
 it('preserves confirmed requirements on malformed provider output',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const controller=await login(invalid);
  const previous={...initialBriefMemory(),headcount:8,zoneNeeds:{checkin:false,stage:true,rest:null}};
  const turn=await resolveBriefTurn('继续',previous,{venueUp:true,scaleTyped:true,hasBase:true,command:null},controller);
  expect(turn.resolution).toBe('unavailable');expect(turn.memory.headcount).toBe(8);expect(turn.memory.zoneNeeds).toEqual(previous.zoneNeeds);
 },30_000);
 it('propagates a cancelled HTTP request to the local slow provider',async()=>{
  let started!:()=>void,aborted!:()=>void;
  const reached=new Promise<void>(resolve=>{started=resolve;}),cancelled=new Promise<void>(resolve=>{aborted=resolve;});
  const slow=createLocalAgentModel({briefMode:'slow',delayMs:30_000});
  const fetcher:typeof fetch=(input,init)=>{started();init?.signal?.addEventListener('abort',()=>aborted(),{once:true});return slow(input,init);};
  const server=await startLocalServer(0,fetcher);
  try {
    vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');const controller=await login(server),abort=new AbortController(),previous=initialBriefMemory();
    const task=resolveBriefTurn('8人，室内12×9米，圆桌',previous,{venueUp:true,scaleTyped:true,hasBase:false,command:null},controller,abort.signal);await reached;abort.abort();
    await expect(task).rejects.toMatchObject({name:'AbortError'});
    expect(previous.headcount).toBeNull();
    await Promise.race([cancelled,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('本地供应商未收到取消信号')),3000))]);
  } finally {await server.close();}
 },30_000);
});
