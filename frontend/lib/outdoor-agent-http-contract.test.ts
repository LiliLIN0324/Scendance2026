/// <reference path="../../supabase/functions/_shared/vendor.d.ts" />
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {afterAll,beforeAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {BackendSession,getBackendConfig} from './backend-session';
import {createSupabaseBrowserClient,clearSupabaseBrowserCookies} from './supabase/client';
import {startLocalServer,testAccounts,testPublicKey} from '../../tests/local-server';
import {understandOutdoorTurn} from '../components/room-organizer/lib/outdoor-agent-understanding';
import {createStarterOutdoorPlan} from '../components/room-organizer/lib/outdoor-project-store';
import {emptyOutdoorFlow,planVersion} from '../components/room-organizer/lib/outdoor-agent-contract';
const config:Record<string,string>={CONVERSATION_API_ENABLED:'1',AGENT_CHAT_PROFILE:'minimax',AGENT_CHAT_BASE_URL:'https://api.minimax.io/v1',AGENT_CHAT_KEY:'fixture-only',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash',BAILIAN_PRODUCT_ENABLED:'1'};
describe('real frontend builder → dedicated handler → outdoor parser',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>,session:BackendSession;
 let artifactHandler:((request:Request)=>Promise<Response>)|undefined;const wire:Array<Record<string,unknown>>=[];
 let bad=false;const requests:Array<Record<string,unknown>>=[];
 const provider=vi.fn<typeof fetch>(async(_url,init)=>{
  const body=JSON.parse(String(init?.body));requests.push(body);
  const structured=body.messages[0].content.includes('OUTDOOR_AGENT_RESPONSE_V1');
  const message=JSON.parse(body.messages[1].content).message;
  const content=structured&&!bad?JSON.stringify(message.includes('IN77')?{action:'search',query:'IN77',reply:'先搜索候选，活动范围待确认。',references:[],facts:{}}:{action:'ask',reply:'我可以协助核对活动场地和分区，确认后才应用。',references:[],facts:{}}):'我可以协助规划户外活动。';
  return Response.json({choices:[{finish_reason:'stop',message:{content,tool_calls:null,function_call:null}}]});
 });
 beforeAll(async()=>{vi.stubEnv('NEXT_PUBLIC_CONVERSATION_API_ENABLED','1');server=await startLocalServer(0,provider,{env:k=>config[k],dedicatedConversation:true,...(process.env.SCENDANCE_CANONICAL_CONVERSATION_ARTIFACT?{conversationHandler:async(request:Request)=>{wire.push(await request.clone().json());if(!artifactHandler)throw new Error('artifact not initialized');return artifactHandler(request);}}:{})});
  if(process.env.SCENDANCE_CANONICAL_CONVERSATION_ARTIFACT){
   const require=createRequire(new URL('../../package.json',import.meta.url));
   const context=vm.createContext({Deno:{env:{get:(k:string)=>k==='SUPABASE_URL'?server.url:k==='SUPABASE_SERVICE_ROLE_KEY'?testPublicKey:config[k]},serve:(fn:typeof artifactHandler)=>{artifactHandler=fn;}},fetch:provider,Request,Response,Headers,URL,URLSearchParams,AbortController,AbortSignal,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Buffer,Blob,FormData,structuredClone,crypto,setTimeout,clearTimeout,setInterval,clearInterval,console,atob,btoa});
   const module=new vm.SourceTextModule(fs.readFileSync(process.env.SCENDANCE_CANONICAL_CONVERSATION_ARTIFACT,'utf8'),{context});const linked=new Map();
   await module.link(async(spec:string)=>{if(!['zod','@supabase/supabase-js','@gltf-transform/core','gltf-validator'].includes(spec))throw Error('unexpected import');if(!linked.has(spec)){const ns=await import(/* @vite-ignore */ pathToFileURL(require.resolve(spec)).href);const external=new vm.SyntheticModule(Object.keys(ns),function(){for(const key of Object.keys(ns))this.setExport(key,ns[key]);},{context});linked.set(spec,external);}return linked.get(spec);});await module.evaluate();
  }
 },30000);
 beforeEach(async()=>{session?.dispose();requests.length=0;wire.length=0;provider.mockClear();clearSupabaseBrowserCookies();const auth=createSupabaseBrowserClient(server.url,testPublicKey);const signed=await auth.auth.signInWithPassword({email:testAccounts[0]!.email,password:testAccounts[0]!.password});if(signed.error)throw signed.error;session=new BackendSession(getBackendConfig({url:server.url,anonKey:testPublicKey}));await session.restoreSession();},30000);
 afterAll(async()=>{session?.dispose();await server?.close();vi.unstubAllEnvs();clearSupabaseBrowserCookies();});
 const turn=(message:string)=>{const plan=createStarterOutdoorPlan();return understandOutdoorTurn({message,state:emptyOutdoorFlow('test-project'),plan,selected:[],map:{version:planVersion(plan),status:'unavailable',text:'没有地图证据',featureIds:[],unknowns:['没有地图证据']},controller:session,signal:new AbortController().signal});};
 it('greeting remains a conversational ask and IN77 advances to search through real HTTP',async()=>{
  expect(await turn('你好，请告诉我怎样规划户外活动。')).toMatchObject({action:'ask',references:[],facts:{}});
  expect(await turn('先搜IN77，不默认整个商场是活动范围。')).toMatchObject({action:'search',query:'IN77'});
  expect(provider).toHaveBeenCalledTimes(2);if(artifactHandler){expect(wire).toHaveLength(2);for(const body of wire){expect(Object.keys(body).sort()).toEqual(['history','message','responseMode']);expect(body.responseMode).toBe('outdoor_v1');expect(body.history).toBeInstanceOf(Array);}}for(const body of requests){expect(body.model).toBe('MiniMax-M3.1-Flash');expect(body.max_completion_tokens).toBe(1024);expect(body.tools).toBeUndefined();expect((body.messages as Array<{content:string}>)[0]!.content).toContain('OUTDOOR_AGENT_RESPONSE_V1');}
 });
 it('legacy preview unversioned transport reproduces the exact prose-as-JSON failure without executing',async()=>{
  const plan=createStarterOutdoorPlan();const controller={assistantChat:(message:string,history:Array<{role:'user'|'assistant';text:string}>,signal?:AbortSignal)=>session.assistantChat(message,history,signal),getSnapshot:()=>session.getSnapshot()};
  await expect(understandOutdoorTurn({message:'你好',state:emptyOutdoorFlow('test-project'),plan,selected:[],map:{version:planVersion(plan),status:'unavailable',text:'未知地图',featureIds:[],unknowns:[]},controller,signal:new AbortController().signal})).rejects.toThrow('Agent没有返回可核对的操作结构');
  expect(provider).toHaveBeenCalledOnce();if(artifactHandler)expect(wire[0]?.responseMode).toBeUndefined();
 });
 it('ordinary chat remains prose and does not require action JSON',async()=>{expect(await session.assistantChat('你好',[])).toEqual({status:'ok',answer:'我可以协助规划户外活动。'});});
 it('typed mode rejects unstructured prose instead of inventing an action',async()=>{bad=true;await expect(turn('先搜IN77')).rejects.toThrow('当前Agent理解不可用（provider_error）');bad=false;});
});
