import type {DraftPart} from './readonly-draft-bundle';
type Kind='layout'|'brief'|'environment'|'calibration'|'creative-conversation';
type Reader=()=>DraftPart<unknown>;
const active=new Map<string,Set<Reader>>(),retained=new Map<string,DraftPart<unknown>>();
const key=(scope:string,kind:Kind)=>JSON.stringify([scope,kind]);
function capture(reader:Reader):DraftPart<unknown>{try{return structuredClone(reader());}catch{return {status:'unavailable',reason:'页面草稿无法读取或复制'};}}
/** Memory-only. Unmount captures the last readable value, without writing to browser storage. */
export function registerReadonlyDraftReader(scope:string,kind:Kind,reader:Reader):()=>void {
 const id=key(scope,kind),readers=active.get(id)??new Set<Reader>();readers.add(reader);active.set(id,readers);
 return ()=>{if(!readers.has(reader))return;retained.set(id,readers.size===1?capture(reader):{status:'unavailable',reason:'多个编辑器同时持有此草稿'});readers.delete(reader);if(!readers.size)active.delete(id);};
}
export function readReadonlyDraft(scope:string,kind:Kind):DraftPart<unknown> {
 const id=key(scope,kind),readers=active.get(id);
 if(readers?.size===1)return capture([...readers][0]!);
 if(readers?.size)return {status:'unavailable',reason:'多个编辑器同时持有此草稿'};
 return retained.get(id)??{status:'unavailable',reason:'此页面未提供该项草稿'};
}
/** Switch safety must not mistake a retained snapshot for a live editor. */
export function readLiveReadonlyDraft(scope:string,kind:Kind):DraftPart<unknown>{
 const readers=active.get(key(scope,kind));
 if(readers?.size===1)return capture([...readers][0]!);
 return {status:'unavailable',reason:readers?.size?'多个编辑器同时持有此草稿':'当前页面未就绪'};
}

/** Preserve a closed editor's last snapshot in memory; never writes or uploads it. */
export function retainReadonlyDraft(scope:string,kind:Kind,value:DraftPart<unknown>):void {
  try { retained.set(key(scope,kind),structuredClone(value)); }
  catch { retained.set(key(scope,kind),{status:'unavailable',reason:'页面草稿无法读取或复制'}); }
}
