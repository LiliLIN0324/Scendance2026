/// <reference path="../../supabase/functions/_shared/vendor.d.ts" />
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {BackendSession,getBackendConfig} from './backend-session';
import {startLocalServer,testAccounts,testPublicKey} from '../../tests/local-server';
import {resolveBriefTurn} from './agent-resolver';
import {initialBriefMemory} from '@/components/room-organizer/lib/brief-agent';

describe('unified conversation over isolated HTTP',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>;const sessions:BackendSession[]=[];
 const payload={extraction:{headcount:30},reply:'先按30人记录，签到可以稍后决定。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]};
 const provider=vi.fn<typeof fetch>(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]}));
 const config:Record<string,string>={BRIEF_CONVERSATION_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://model.example/v1',AGENT_CHAT_KEY:'fixture-secret',AGENT_CHAT_MODEL:'fixture'};
 beforeAll(async()=>{vi.stubEnv('NEXT_PUBLIC_CONVERSATION_API_ENABLED','1');server=await startLocalServer(0,provider,{env:key=>config[key]});},30000);
 afterEach(()=>{for(const session of sessions.splice(0))session.dispose();provider.mockClear();});
 afterAll(async()=>{vi.unstubAllEnvs();await server?.close();});
 function make(){const session=new BackendSession(getBackendConfig({url:server.url,anonKey:testPublicKey}));sessions.push(session);return session;}
 it('authenticates and returns validated facts and reply from exactly one provider request',async()=>{
  await expect(make().briefConversation('本场30人',[])).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(provider).not.toHaveBeenCalled();
  const session=make();await session.signIn(testAccounts[0]!.email,testAccounts[0]!.password);
  const result=await session.briefConversation('本场30人',[{role:'user',text:'想办一场讲座'}]);
  expect(result).toMatchObject({enabled:true,reply:payload.reply,extraction:{headcount:30},factEvidence:payload.factEvidence});expect(provider).toHaveBeenCalledOnce();
 });
 it('returns the model reply for a logged-in brief when qwen leaves tool fields null',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  const raw='80人发布会，室内12×9，安排签到和主舞台';
  const reply='已记下80人室内发布会，场地12×9，并安排签到和主舞台。布置方式可以再选。';
  const conversation={extraction:{event:'发布会',headcount:80,venueIO:'indoor',lengthM:12,widthM:9,activityNeeds:[{kind:'checkin',decision:'needed',evidence:'安排签到'},{kind:'stage',decision:'needed',evidence:'主舞台'}]},reply,unhandled:[],factEvidence:[{key:'event',evidence:'发布会'},{key:'headcount',evidence:'80人'},{key:'venueIO',evidence:'室内'},{key:'lengthM',evidence:'12×9'},{key:'widthM',evidence:'12×9'}]};
  provider.mockResolvedValueOnce(Response.json({id:'chatcmpl-qwen',object:'chat.completion',model:'qwen3.8-max',choices:[{index:0,finish_reason:'stop',logprobs:null,message:{role:'assistant',content:JSON.stringify(conversation),tool_calls:null,function_call:null,refusal:null}}],usage:{prompt_tokens:20,completion_tokens:40,total_tokens:60}}));
  const session=make();await session.signIn(testAccounts[0]!.email,testAccounts[0]!.password);
  const turn=await resolveBriefTurn(raw,initialBriefMemory(),{venueUp:true,scaleTyped:true,hasBase:false,command:null},session,undefined,{history:[]});
  expect(provider).toHaveBeenCalledOnce();
  expect(turn.resolution).toBe('model');
  expect(turn.modelReply).toContain(reply);
  expect(turn.modelNotice).toBeUndefined();
  expect(turn.modelDiagnostic).toBeUndefined();
  expect(turn.text).not.toContain('圆桌');
  expect(turn.text).not.toContain('课桌');
 });
 it('exposes a provider failure category instead of the unclassified catch',async()=>{
  vi.stubEnv('NEXT_PUBLIC_AGENT_ENABLED','1');
  provider.mockResolvedValueOnce(new Response('<html>secret gateway</html>',{status:200,headers:{'content-type':'text/html'}}));
  const session=make();await session.signIn(testAccounts[0]!.email,testAccounts[0]!.password);
  const turn=await resolveBriefTurn('80人发布会，室内12×9，安排签到和主舞台',initialBriefMemory(),{venueUp:true,scaleTyped:true,hasBase:false,command:null},session,undefined,{history:[]});
  expect(turn.resolution).toBe('unavailable');
  expect(turn.modelDiagnostic).toEqual({category:'provider',code:'PROVIDER_INVALID_JSON'});
  expect(turn.modelNotice).toContain('未通过校验');
  expect(turn.modelNotice).not.toContain('暂不可用');
  expect(turn.modelNotice).not.toContain('secret gateway');
 });
});
