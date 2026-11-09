/** Invalidation notifications only: not a lock, transaction log or evidence of quiescence. */
type Phase = 'started' | 'committed' | 'failed';
type WireNotice = { version:1; scopeHash:string|'*'; operationId:string; phase:Phase };
export interface SourceScopeNotice {
  phase: Phase | 'unknown';
  /** False means cross-tab messages cannot be used, never that the data is safe. */
  crossTabAvailable: boolean;
  /** No notification channel can prove that a pre-existing/crashed writer is absent. */
  state:'unknown';
}
type Listener=(notice:SourceScopeNotice)=>void;
const listeners=new Map<string,{hash:string; group:Set<Listener>}>();
let channel:BroadcastChannel|null=null, unavailable=false, inFlight=0;
const CHANNEL='scendance:source-scope-invalidation:v1';
function emit(scope:string|undefined,phase:SourceScopeNotice['phase'],remote=false):void {
  const notice:SourceScopeNotice={phase,crossTabAvailable:!!channel&&!unavailable,state:'unknown'};
  for(const [key,entry] of listeners)if(scope===undefined||(remote?scope===entry.hash:scope===key))for(const listener of entry.group)try{listener(notice);}catch{/* observers cannot affect a write */}
}
function closeIfUnused():void {if(listeners.size===0&&inFlight===0&&channel){channel.close();channel=null;}}
function open():BroadcastChannel|null {
  if(channel||unavailable)return channel;
  try {
    if(typeof BroadcastChannel==='undefined')throw new Error('unavailable');
    const current=new BroadcastChannel(CHANNEL);
    current.onmessage=(event:MessageEvent<unknown>)=>{
      const raw=event.data;
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
      const notice=raw as Partial<WireNotice>;
      if(notice.version!==1 || !(notice.scopeHash==='*'||typeof notice.scopeHash==='string'&&/^[a-f0-9]{64}$/.test(notice.scopeHash)) ||
        typeof notice.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(notice.operationId)||!['started','committed','failed'].includes(notice.phase??''))return;
      // A completion arriving before its start still invalidates. Never infer ready from either message.
      emit(notice.scopeHash==='*'?undefined:notice.scopeHash,notice.phase!,true);
    };
    current.onmessageerror=()=>{unavailable=true;emit(undefined,'unknown');current.close();if(channel===current)channel=null;};
    channel=current;return current;
  } catch {unavailable=true;emit(undefined,'unknown');return null;}
}
async function hashScope(scope:string):Promise<string> {
  if(!globalThis.crypto?.subtle)throw new Error('missing digest');
  const result=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope));
  return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** Subscribe using an opaque hash; initial status is always unknown. */
export async function subscribeSourceScopeNotices(scope:string,listener:Listener):Promise<()=>void> {
  if(!scope.trim()||scope.length>128)throw new Error('资料范围无效。');
  let key:string;
  try {key=await hashScope(scope);} catch {listener({phase:'unknown',crossTabAvailable:false,state:'unknown'});return ()=>{};}
  const entry=listeners.get(scope)??{hash:key,group:new Set<Listener>()};const group=entry.group;group.add(listener);listeners.set(scope,entry);
  open();try{listener({phase:'unknown',crossTabAvailable:!!channel&&!unavailable,state:'unknown'});}catch{/* ignore */}
  return ()=>{group.delete(listener);if(!group.size)listeners.delete(scope);closeIfUnused();};
}
/** Controlled writes require a sent start notice before the transaction can begin. */
export async function withSourceScopeNotice<T>(scope:string|undefined,operation:()=>Promise<T>,requireTransport:boolean|(()=>boolean)=false):Promise<T> {
  const required=()=>typeof requireTransport==='function'?requireTransport():requireTransport;
  inFlight++;let key:string|undefined,wire:BroadcastChannel|null=null,id:string|undefined,started=false,committed=false;
  try {
    wire=open();emit(scope,'started');
    try {key=scope===undefined?undefined:await hashScope(scope);id=crypto.randomUUID();}
    catch {unavailable=true;emit(undefined,'unknown');}
    if(required()&&(!wire||unavailable||!id))throw new Error('无法通知其他页面，资料写入已暂停。');
    if(wire&&id)try{wire.postMessage({version:1,scopeHash:key??'*',operationId:id,phase:'started'} satisfies WireNotice);started=true;}
      catch{unavailable=true;emit(undefined,'unknown');if(required())throw new Error('无法通知其他页面，资料写入已暂停。');}
    try {
      const result=await operation();committed=true;emit(scope,'committed');
      if(wire&&id&&started)try{wire.postMessage({version:1,scopeHash:key??'*',operationId:id,phase:'committed'} satisfies WireNotice);}
        catch{unavailable=true;emit(undefined,'unknown');if(required())throw new Error('资料写入结果待核对，其他页面通知失败。');}
      return result;
    } catch(error) {
      emit(scope,committed?'unknown':'failed');if(!committed&&wire&&id&&started&&!unavailable)try{wire.postMessage({version:1,scopeHash:key??'*',operationId:id,phase:'failed'} satisfies WireNotice);}catch{unavailable=true;emit(undefined,'unknown');}
      throw error;
    }
  } finally {inFlight--;closeIfUnused();}
}
