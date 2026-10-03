import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { BackendSession,getBackendConfig } from './backend-session';
import type { Scene } from '../../supabase/functions/_shared/domain';

const firstProject='10000000-0000-4000-8000-000000000001',secondProject='10000000-0000-4000-8000-000000000002';
const firstUser='20000000-0000-4000-8000-000000000001',secondUser='20000000-0000-4000-8000-000000000002';
const scene:Scene={schemaVersion:1,venue:{width:12,depth:10,height:3,shape:'rectangle',entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
const fetchMock=vi.fn<typeof fetch>();
let controller:BackendSession;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const queue=(body:unknown,status=200)=>fetchMock.mockResolvedValueOnce(json(body,status));
const file=()=>new File([new Uint8Array([1,2,3])],'reference.png',{type:'image/png'});
async function signIn(userId=firstUser){queue({access_token:`access-${userId}`,refresh_token:`refresh-${userId}`,expires_in:3600,user:{id:userId}});await controller.signIn('test@example.com','fixture-only');}
async function edit(projectId=firstProject,generation=1){
  queue({id:projectId,name:'Project',studio_id:firstUser,revision:0,scene});await controller.getProject(projectId);
  queue({sessionId:controller.getSnapshot().sessionId,generation,expiresAt:new Date(Date.now()+90_000).toISOString(),revision:0,scene});await controller.acquireLease(projectId);
}
function pendingUpload(){
  let resolve!:(response:Response)=>void;fetchMock.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
  return {ready:()=>vi.waitFor(()=>expect(resolve).toBeTypeOf('function')),rejectAuth:()=>resolve(json({error:{code:'UNAUTHENTICATED'}},401))};
}
async function expectLeaseRenews(projectId:string,generation:number){
  queue({sessionId:controller.getSnapshot().sessionId,generation,expiresAt:new Date(Date.now()+120_000).toISOString(),revision:0});
  await vi.advanceTimersByTimeAsync(30_000);
  expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(`/projects/${projectId}/lease/renew`);
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);controller=new BackendSession(getBackendConfig({url:'https://example.supabase.co',anonKey:'sb_publishable_test'}));});
afterEach(()=>{controller.dispose();vi.useRealTimers();vi.unstubAllGlobals();});

describe('generation reference upload respects auth and request scope',()=>{
  it('blocks current editing and clears authentication on an upload 401 while preserving the draft',async()=>{
    await signIn();await edit();const draft={...scene,lighting:'warm' as const};controller.setDraft(draft);
    queue({error:{code:'UNAUTHENTICATED'}},401);
    await expect(controller.uploadGenerationReference(file())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
    expect(controller.getSnapshot()).toMatchObject({user:null,writeBlocked:true,draft,dirty:true});
    const calls=fetchMock.mock.calls.length;await vi.advanceTimersByTimeAsync(60_000);expect(fetchMock).toHaveBeenCalledTimes(calls);
  });
  it('does not clear the user or lock a new project after a late 401 from an old project',async()=>{
    await signIn();await edit();const pending=pendingUpload(),upload=controller.uploadGenerationReference(file());await pending.ready();
    queue({});await controller.releaseLease();await edit(secondProject,2);
    pending.rejectAuth();await expect(upload).rejects.toMatchObject({code:'SESSION_CHANGED'});
    expect(controller.getSnapshot()).toMatchObject({user:{id:firstUser},project:{id:secondProject},lease:{generation:2},writeBlocked:false,error:null});
    await expectLeaseRenews(secondProject,2);
  });
  it('does not clear a replacement account after a late 401',async()=>{
    await signIn();await edit();const pending=pendingUpload(),upload=controller.uploadGenerationReference(file());await pending.ready();
    await signIn(secondUser);await edit(secondProject,3);
    pending.rejectAuth();await expect(upload).rejects.toMatchObject({code:'SESSION_CHANGED'});
    expect(controller.getSnapshot()).toMatchObject({user:{id:secondUser},project:{id:secondProject},lease:{generation:3},writeBlocked:false,error:null});
    await expectLeaseRenews(secondProject,3);
  });
  it('reports an uncertain upload network failure without freezing an unrelated scene write',async()=>{
    await signIn();await edit();fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(controller.uploadGenerationReference(file())).rejects.toThrow('offline');
    expect(controller.getSnapshot()).toMatchObject({user:{id:firstUser},writeBlocked:false,draft:scene,error:{code:'NETWORK_ERROR'}});
    await expectLeaseRenews(firstProject,1);
  });
});
