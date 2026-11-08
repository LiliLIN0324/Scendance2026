/// <reference path="../../supabase/functions/_shared/vendor.d.ts" />
import {afterAll,afterEach,beforeAll,describe,expect,it,vi} from 'vitest';
import {BackendSession,getBackendConfig} from './backend-session';
import {startLocalServer,testAccounts,testPublicKey} from '../../tests/local-server';

describe('assistant chat over isolated local HTTP',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>;
 const sessions:BackendSession[]=[];
 const provider=vi.fn<typeof fetch>(async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'可以先明确入场方式，再安排签到位置。'}}]}));
 const config:Record<string,string>={ASSISTANT_CHAT_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://model.example/v1',AGENT_CHAT_KEY:'fixture-secret',AGENT_CHAT_MODEL:'fixture'};
 beforeAll(async()=>{server=await startLocalServer(0,provider,{env:key=>config[key]});},30000);
 afterEach(()=>{for(const session of sessions.splice(0))session.dispose();provider.mockClear();});
 afterAll(async()=>{await server?.close();});
 function make(){const session=new BackendSession(getBackendConfig({url:server.url,anonKey:testPublicKey}));sessions.push(session);return session;}
 it('requires login and returns a real HTTP response without writing a scene',async()=>{
  await expect(make().assistantChat('签到怎么安排？',[])).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(provider).not.toHaveBeenCalled();
  const session=make();await session.signIn(testAccounts[0]!.email,testAccounts[0]!.password);
  expect(await session.assistantChat('签到怎么安排？',[{role:'user',text:'这是室内活动'}])).toEqual({status:'ok',answer:'可以先明确入场方式，再安排签到位置。'});
  expect(provider).toHaveBeenCalledOnce();
 });
});
