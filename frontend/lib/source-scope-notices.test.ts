import {webcrypto} from 'node:crypto';
import {afterEach,expect,it,vi} from 'vitest';
class FakeChannel {
 static instances:FakeChannel[]=[];static messages:unknown[]=[];static fail=false;
 onmessage:((event:MessageEvent<unknown>)=>void)|null=null;onmessageerror:(()=>void)|null=null;closed=false;
 constructor(_name:string){FakeChannel.instances.push(this);}
 postMessage(value:unknown){if(FakeChannel.fail)throw new Error('unavailable');FakeChannel.messages.push(structuredClone(value));}
 close(){this.closed=true;}
 deliver(value:unknown){this.onmessage?.({data:value} as MessageEvent<unknown>);}
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();FakeChannel.instances=[];FakeChannel.messages=[];FakeChannel.fail=false;});
async function setup(){vi.resetModules();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('BroadcastChannel',FakeChannel);return import('./source-scope-notices');}
it('synchronously invalidates the local scope and broadcasts opaque start and completion',async()=>{
 const m=await setup(),one:unknown[]=[],other:unknown[]=[];
 const un1=await m.subscribeSourceScopeNotices('private-event',event=>one.push(event));
 const un2=await m.subscribeSourceScopeNotices('other',event=>other.push(event));
 let resolve!:()=>void;const gate=new Promise<void>(done=>{resolve=done;});
 const writing=m.withSourceScopeNotice('private-event',()=>gate,true);
 expect(one.at(-1)).toMatchObject({phase:'started',state:'unknown'});
 expect(other).toHaveLength(1);await vi.waitFor(()=>expect(FakeChannel.messages).toHaveLength(1));
 expect(JSON.stringify(FakeChannel.messages)).not.toContain('private-event');
 resolve();await writing;expect(one.at(-1)).toMatchObject({phase:'committed',state:'unknown'});
 expect(FakeChannel.messages).toHaveLength(2);un1();un2();expect(FakeChannel.instances[0]!.closed).toBe(true);
});
it('treats remote late completion, reordering and crashed starts as unknown without affecting other scopes',async()=>{
 const m=await setup(),one:Array<{phase:string;state:string}>=[],two:unknown[]=[];
 const un1=await m.subscribeSourceScopeNotices('a',e=>one.push(e)),un2=await m.subscribeSourceScopeNotices('b',e=>two.push(e));
 await m.withSourceScopeNotice('a',async()=>{},true);const first=FakeChannel.messages[0] as Record<string,unknown>,ch=FakeChannel.instances[0]!;
 const count=two.length;ch.deliver({...first,phase:'committed'});ch.deliver(first);
 expect(one.at(-2)).toMatchObject({phase:'committed',state:'unknown'});expect(one.at(-1)).toMatchObject({phase:'started',state:'unknown'});
 expect(two).toHaveLength(count);un1();un2();
});
it('rejects a protected write before it starts when broadcasting is unavailable or fails',async()=>{
 const m=await setup(),events:unknown[]=[],un=await m.subscribeSourceScopeNotices('a',event=>events.push(event));
 FakeChannel.fail=true;const write=vi.fn(async()=>{});
 await expect(m.withSourceScopeNotice('a',write,true)).rejects.toThrow('无法通知');expect(write).not.toHaveBeenCalled();
 expect(events.at(-1)).toMatchObject({phase:'unknown',state:'unknown'});un();
});
it('preserves unknown state when a channel is absent and still permits explicitly legacy writes',async()=>{
 vi.resetModules();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('BroadcastChannel',undefined);const m=await import('./source-scope-notices');
 const events:unknown[]=[],un=await m.subscribeSourceScopeNotices('a',event=>events.push(event));
 expect(events[0]).toMatchObject({state:'unknown',crossTabAvailable:false});
 const write=vi.fn(async()=>{});await expect(m.withSourceScopeNotice('a',write,true)).rejects.toThrow('无法通知');expect(write).not.toHaveBeenCalled();
 await m.withSourceScopeNotice('a',write,false);expect(write).toHaveBeenCalledOnce();un();
});

it('reports a failed operation and leaves every observer in unknown state',async()=>{
 const m=await setup(),events:unknown[]=[],un=await m.subscribeSourceScopeNotices('a',event=>events.push(event));
 await expect(m.withSourceScopeNotice('a',async()=>{throw new Error('write failed');},true)).rejects.toThrow('write failed');
 expect(events.at(-1)).toMatchObject({phase:'failed',state:'unknown'});
 expect(FakeChannel.messages.at(-1)).toMatchObject({phase:'failed'});un();
});
it('fails closed if completion cannot be broadcast after storage has completed',async()=>{
 const m=await setup(),events:unknown[]=[],un=await m.subscribeSourceScopeNotices('a',event=>events.push(event));
 let changed=false;await expect(m.withSourceScopeNotice('a',async()=>{changed=true;FakeChannel.fail=true;},true)).rejects.toThrow('结果待核对');
 expect(changed).toBe(true);expect(events.at(-1)).toMatchObject({phase:'unknown',state:'unknown'});un();
});
it('blocks actual protected source storage before opening IndexedDB without notification transport',async()=>{
 vi.resetModules();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('BroadcastChannel',undefined);
 const open=vi.fn();vi.stubGlobal('indexedDB',{open});const {storeSourceForm}=await import('./source-storage');
 const controller=new AbortController();
 await expect(storeSourceForm('a',{x:1},{kind:'ordinary',signal:controller.signal,assertStillHeld(){}})).rejects.toThrow('无法通知');
 expect(open).not.toHaveBeenCalled();
});
