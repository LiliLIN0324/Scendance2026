/// <reference path="../../supabase/functions/_shared/vendor.d.ts" />
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {BackendSession,getBackendConfig} from './backend-session';
import {startLocalServer,testAccounts,testPublicKey} from '../../tests/local-server';

describe('unified conversation over isolated HTTP',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>;const sessions:BackendSession[]=[];
 const payload={extraction:{headcount:30},reply:'先按30人记录，签到可以稍后决定。',unhandled:[],factEvidence:[{key:'headcount',evidence:'30人'}]};
 const provider=vi.fn<typeof fetch>(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(payload)}}]}));
 const config:Record<string,string>={BRIEF_CONVERSATION_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://model.example/v1',AGENT_CHAT_KEY:'fixture-secret',AGENT_CHAT_MODEL:'fixture'};
 beforeAll(async()=>{server=await startLocalServer(0,provider,{env:key=>config[key]});},30000);
 afterEach(()=>{for(const session of sessions.splice(0))session.dispose();provider.mockClear();});
 afterAll(async()=>{await server?.close();});
 function make(){const session=new BackendSession(getBackendConfig({url:server.url,anonKey:testPublicKey}));sessions.push(session);return session;}
 it('authenticates and returns validated facts and reply from exactly one provider request',async()=>{
  await expect(make().briefConversation('本场30人',[])).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(provider).not.toHaveBeenCalled();
  const session=make();await session.signIn(testAccounts[0]!.email,testAccounts[0]!.password);
  const result=await session.briefConversation('本场30人',[{role:'user',text:'想办一场讲座'}]);
  expect(result).toMatchObject({enabled:true,reply:payload.reply,extraction:{headcount:30},factEvidence:payload.factEvidence});expect(provider).toHaveBeenCalledOnce();
 });
});
