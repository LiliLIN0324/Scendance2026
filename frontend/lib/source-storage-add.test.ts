import {afterEach,expect,it,vi} from 'vitest';
import {addSourceRecord,listExactSourceNamespace} from './source-storage';

afterEach(()=>vi.unstubAllGlobals());
it('uses an atomic add and never replaces a present undefined record',async()=>{
 const data=new Map<string,unknown>(),key:[string,string]=['local-activity-v4-immutable','id'];data.set(JSON.stringify(key),undefined);
 const db={close(){},transaction(){
  let aborted=false,staged:unknown;
  const tx={error:null as Error|null,oncomplete:null as null|(()=>void),onabort:null as null|(()=>void),onerror:null as null|(()=>void),abort(){aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore(){return {add(value:unknown,address:unknown){
   const request={result:address,error:null as Error|null,onsuccess:null as null|(()=>void)};
   queueMicrotask(()=>{if(aborted)return;if(data.has(JSON.stringify(address))){request.error=new Error('ConstraintError');tx.error=request.error;tx.onerror?.();return;}
    staged=structuredClone(value);request.onsuccess?.();if(!aborted){data.set(JSON.stringify(address),staged);tx.oncomplete?.();}});return request;
  }};}};return tx;
 }};
 vi.stubGlobal('indexedDB',{open(){const req={result:db,onsuccess:null as null|(()=>void)};queueMicrotask(()=>req.onsuccess?.());return req;}});
 vi.stubGlobal('BroadcastChannel',class {onmessage=null;onmessageerror=null;postMessage(){}close(){}});
 const signal=new AbortController().signal,guard={kind:'ordinary' as const,signal,assertStillHeld(){}};
 await expect(addSourceRecord(key,{safe:true},guard)).rejects.toThrow();expect(data.has(JSON.stringify(key))).toBe(true);expect(data.get(JSON.stringify(key))).toBeUndefined();
 const other:[string,string]=['local-activity-v4-immutable','new'];await addSourceRecord(other,{safe:true},guard);expect(data.get(JSON.stringify(other))).toEqual({safe:true});
});
it('detects malformed keys in the target namespace and never returns a partial listing',async()=>{
 const entries=[{key:['archive','ok'],value:{backupJson:'x'}},{key:['archive','bad','extra'],value:'kept'}];let index=0;
 const tx={error:null as Error|null,oncomplete:null as null|(()=>void),onabort:null as null|(()=>void),onerror:null as null|(()=>void),abort(){queueMicrotask(()=>tx.onabort?.());},objectStore(){return {openCursor(){
   const request:{result:null|{key:unknown;value:unknown;continue():void};onsuccess:null|(()=>void)}={result:null,onsuccess:null};
   const next=()=>{const row=entries[index++];request.result=row?{...row,continue(){queueMicrotask(next);}}:null;request.onsuccess?.();if(!row)queueMicrotask(()=>tx.oncomplete?.());};
   queueMicrotask(next);return request;
 }};}};
 vi.stubGlobal('indexedDB',{open(){const req={result:{close(){},transaction(){return tx;}},onsuccess:null as null|(()=>void)};queueMicrotask(()=>req.onsuccess?.());return req;}});
 await expect(listExactSourceNamespace('archive')).rejects.toThrow('损坏');expect(entries).toHaveLength(2);
});
