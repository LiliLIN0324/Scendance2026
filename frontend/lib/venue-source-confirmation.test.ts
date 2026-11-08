import {afterEach,expect,it,vi} from 'vitest';
import {createLocalWriteLeaseManager} from './local-write-lease';
import {createObservedVenueSourceConfirmation,createVenueSourceConfirmation} from './venue-source-confirmation';
import * as source from './venue-source-revision';
import * as notices from './source-scope-notices';

function storage():Storage{const values=new Map<string,string>();return {get length(){return values.size;},clear:()=>values.clear(),getItem:key=>values.get(key)??null,key:index=>[...values.keys()][index]??null,removeItem:key=>{values.delete(key);},setItem:(key,value)=>{values.set(key,String(value));}};}
function locks():LockManager{return {request(_name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>){return callback({name:'test',mode:'exclusive'});}} as unknown as LockManager;}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('binds an observed source to the active activity and invalidates pending confirmation on source change',async()=>{
 const store=storage(),lock=locks();vi.stubGlobal('navigator',{locks:lock});vi.stubGlobal('window',{localStorage:store});const lease=await createLocalWriteLeaseManager({getLocks:()=>lock,getStorage:()=>store}).acquire();
 let changed!:()=>void,settled=true,active=true;const context={isSettled:()=>settled,isCurrent:(scope:string)=>active&&scope==='A',subscribeInvalidation:(f:()=>void)=>{changed=f;return()=>{};}};
 const service=createVenueSourceConfirmation(lease.capability,context);
 const observed={status:'observed' as const,scope:'A',digest:'a'.repeat(64)};
 vi.spyOn(source,'readVenueSourceRevision').mockResolvedValueOnce(observed);
 expect(await service.confirm('A')).toEqual(observed);
 let release!:(value:typeof observed)=>void;vi.spyOn(source,'readVenueSourceRevision').mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const pending=service.confirm('A');changed();release(observed);expect(await pending).toEqual({status:'unknown'});
 settled=false;expect(await service.confirm('A')).toEqual({status:'unknown'});settled=true;active=false;expect(await service.confirm('A')).toEqual({status:'unknown'});
 service.dispose();await lease.release();
});
it('rejects forged capabilities and a capability lost during the read',async()=>{
 const context={isSettled:()=>true,isCurrent:()=>true,subscribeInvalidation:()=>()=>{}};
 expect(()=>createVenueSourceConfirmation({} as never,context)).toThrow();
 const store=storage(),lock=locks();vi.stubGlobal('navigator',{locks:lock});vi.stubGlobal('window',{localStorage:store});const lease=await createLocalWriteLeaseManager({getLocks:()=>lock,getStorage:()=>store}).acquire();
 const service=createVenueSourceConfirmation(lease.capability,context);let release!:(value:source.VenueSourceRevision)=>void;
 vi.spyOn(source,'readVenueSourceRevision').mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const pending=service.confirm('A');await lease.release();release({status:'observed',scope:'A',digest:'a'.repeat(64)});
 expect(await pending).toEqual({status:'unknown'});service.dispose();
});
it('treats cross-tab notices as invalidation, never as proof that source edits are settled',async()=>{
 const store=storage(),lock=locks();vi.stubGlobal('navigator',{locks:lock});vi.stubGlobal('window',{localStorage:store});
 const lease=await createLocalWriteLeaseManager({getLocks:()=>lock,getStorage:()=>store}).acquire();
 let notify!:(notice:notices.SourceScopeNotice)=>void,settled=false;
 vi.spyOn(notices,'subscribeSourceScopeNotices').mockImplementation(async(_scope,listener)=>{notify=listener;notify({phase:'unknown',crossTabAvailable:false,state:'unknown'});return()=>{};});
 let localChange!:()=>void;
 const service=await createObservedVenueSourceConfirmation(lease.capability,'A',{isCurrent:s=>s==='A',isSettled:()=>settled,subscribeInvalidation:listener=>{localChange=listener;return()=>{};}});
 vi.spyOn(source,'readVenueSourceRevision').mockResolvedValue({status:'observed',scope:'A',digest:'a'.repeat(64)});
 expect(await service.confirm('A')).toEqual({status:'unknown'});
 notify({phase:'committed',crossTabAvailable:true,state:'unknown'});expect(await service.confirm('A')).toEqual({status:'unknown'});
 settled=true;expect((await service.confirm('A')).status).toBe('observed');
 const guard=service.guard(()=>({status:'unknown'}));const invalidated=vi.fn();guard.subscribeInvalidation(invalidated);
 localChange();expect(invalidated).toHaveBeenCalledOnce();invalidated.mockClear();
 notify({phase:'started',crossTabAvailable:true,state:'unknown'});expect(invalidated).toHaveBeenCalledOnce();
 notify({phase:'unknown',crossTabAvailable:false,state:'unknown'});expect(await service.confirm('A')).toEqual({status:'unknown'});
 service.dispose();await lease.release();
});
