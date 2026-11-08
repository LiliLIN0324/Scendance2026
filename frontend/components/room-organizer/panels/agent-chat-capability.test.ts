// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const locks={request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return Promise.resolve().then(()=>callback({}));}} as unknown as LockManager;
beforeEach(()=>{vi.resetModules();vi.stubGlobal('navigator',{locks});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();vi.resetModules();});
async function setup(){const leases=await import('@/lib/local-write-lease');const chat=await import('./agent-chat-store');
  const manager=leases.createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage});return {manager,chat};}
it('does not revert to legacy or delete stored messages after session closes',async()=>{
 const {manager,chat}=await setup(),lease=await manager.acquire(),end=chat.bindAgentChatWriteSession(lease.capability);
 chat.appendAgentChatMessage('space','you','原消息');expect(chat.agentChatWriteStatus()).toBe('ready');
 expect(()=>chat.clearAgentChatThread('space')).toThrow('不支持删除');
 const saved=localStorage.getItem('scendance.agent-chat.v1');end();
 expect(chat.agentChatWriteStatus()).toBe('blocked');expect(()=>chat.appendAgentChatMessage('space','you','不能写')).toThrow();
 expect(localStorage.getItem('scendance.agent-chat.v1')).toBe(saved);await lease.release();
});
it('keeps the in-memory draft and locks writes when the lease is lost during storage',async()=>{
 const {manager,chat}=await setup(),lease=await manager.acquire();chat.bindAgentChatWriteSession(lease.capability);
 const original=Storage.prototype.setItem;
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){original.call(this,key,value);if(key==='scendance.agent-chat.v1')void lease.release();});
 chat.appendAgentChatMessage('space','you','待核对消息');
 expect(chat.getAgentChatThreads().space[0]!.text).toBe('待核对消息');expect(chat.agentChatWriteStatus()).toBe('needs_review');
 const fresh=await manager.acquire();expect(()=>chat.bindAgentChatWriteSession(fresh.capability)).toThrow('待核对');await fresh.release();
});
it('never replaces a changed external conversation and refuses destructive truncation',async()=>{
 const {manager,chat}=await setup(),lease=await manager.acquire();chat.bindAgentChatWriteSession(lease.capability);
 for(let i=0;i<40;i++)chat.appendAgentChatMessage('space','you',String(i));
 expect(()=>chat.appendAgentChatMessage('space','you','41')).toThrow('备份');
 const changed='{"other":"external"}';localStorage.setItem('scendance.agent-chat.v1',changed);
 chat.appendAgentChatMessage('material','you','保留内存草稿');
 expect(localStorage.getItem('scendance.agent-chat.v1')).toBe(changed);
 expect(chat.getAgentChatThreads().material[0]!.text).toBe('保留内存草稿');
 expect(chat.agentChatWriteStatus()).toBe('needs_review');await lease.release();
});
