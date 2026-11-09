/** Local editor readiness only. This is neither a cross-tab lock nor persisted evidence. */
export type SourceEditorRole = 'brief' | 'drawing' | 'images';
type ReadState = 'loading' | 'ready' | 'failed' | 'stale';
type WriteTicket = object;
type ReadTicket = object;
type Writer = { role:SourceEditorRole; alive:boolean; read:ReadState; revision:number; savedRevision:number;
  writes:Map<WriteTicket,{revision:number;sequence:number}>; nextSequence:number; lastCommitted:number; failure:boolean; readUncertain:boolean; readTicket:ReadTicket|null; readRevision:number; readEpoch:number };
export type EditorReadiness = {status:'unknown';reason:string}|{status:'settled';scope:string};
const activeScopes=new Map<string,()=>void>();
/** An unclosed or lost writer cannot be made clean merely by constructing a new coordinator. */
const taintedScopes=new Set<string>();
const roles:readonly SourceEditorRole[]=['brief','drawing','images'];

/** One owner per scope in this JS realm. Register each writer before treating the scope as settled. */
export function createSourceEditorCoordinator(scope:string) {
  if(typeof scope!=='string'||!scope.trim()||scope.length>128)throw new Error('资料范围无效。');
  const existing=activeScopes.get(scope);if(existing){existing();throw new Error('资料范围已有编辑协调器。');}
  const writers=new Map<SourceEditorRole,Writer>(),listeners=new Set<(snapshot:EditorReadiness)=>void>();
  let destroyed=false,lost=taintedScopes.has(scope), changeEpoch=0;
  const snapshot=():EditorReadiness=>{
    if(destroyed)return {status:'unknown',reason:'destroyed'};
    if(lost)return {status:'unknown',reason:'writer-lost'};
    for(const role of roles){const writer=writers.get(role);
      if(!writer||!writer.alive)return {status:'unknown',reason:`unregistered:${role}`};
      if(writer.read!=='ready')return {status:'unknown',reason:`${writer.read}:${role}`};
      if(writer.failure)return {status:'unknown',reason:`write-failed:${role}`};
      if(writer.writes.size)return {status:'unknown',reason:`writing:${role}`};
      if(writer.revision!==writer.savedRevision)return {status:'unknown',reason:`dirty:${role}`};
    }
    return {status:'settled',scope};
  };
  const emit=()=>{const value=snapshot();for(const listener of listeners)try{listener(value);}catch{/* observers cannot affect ownership */}};
  activeScopes.set(scope,()=>{lost=true;taintedScopes.add(scope);emit();});
  const mayRetire=(writer:Writer)=>writer.writes.size===0 && writer.revision===writer.savedRevision && !writer.failure && !writer.readUncertain;
  const check=(writer:Writer)=>{if(destroyed||!writer.alive||writers.get(writer.role)!==writer)throw new Error('资料编辑器已销毁。');};
  return {
    get scope(){return scope;},
    snapshot,
    /** A reread may start only when every registered editor has no local work or read/write in flight. */
    canRecheck():boolean {
      if(destroyed||lost)return false;
      return roles.every(role=>{const writer=writers.get(role);return !!writer&&writer.alive&&writer.readTicket===null&&
        writer.revision===writer.savedRevision&&writer.writes.size===0&&!writer.failure;});
    },
    subscribe(listener:(snapshot:EditorReadiness)=>void){if(destroyed)throw new Error('资料协调器已销毁。');listeners.add(listener);listener(snapshot());return ()=>{listeners.delete(listener);};},
    register(role:SourceEditorRole){
      if(destroyed||!roles.includes(role))throw new Error('资料编辑器无效或已销毁。');
      if(writers.has(role)){lost=true;taintedScopes.add(scope);emit();throw new Error('资料编辑器重复注册。');}
      const writer:Writer={role,alive:true,read:'loading',revision:0,savedRevision:0,writes:new Map(),nextSequence:0,lastCommitted:0,failure:false,readUncertain:false,readTicket:null,readRevision:0,readEpoch:0};
      writers.set(role,writer);emit();
      return {
        beginRead():ReadTicket {check(writer);if(writer.revision!==writer.savedRevision||writer.writes.size||writer.failure)throw new Error('有未保存资料，不能重新读取。');
          const ticket={};writer.readTicket=ticket;writer.readRevision=writer.revision;writer.readEpoch=changeEpoch;writer.read='loading';emit();return ticket;},
        /** A late read cannot clear a newer read, edit, remote invalidation or unmount. */
        readSucceeded(ticket:ReadTicket):boolean {check(writer);if(writer.readTicket!==ticket)return false;
          writer.readTicket=null;if(writer.readRevision!==writer.revision||writer.readEpoch!==changeEpoch||writer.revision!==writer.savedRevision||writer.writes.size>0||writer.failure){writer.read='stale';writer.readUncertain=true;emit();return false;}writer.read='ready';writer.readUncertain=false;emit();return true;},
        readFailed(ticket:ReadTicket):boolean {check(writer);if(writer.readTicket!==ticket)return false;
          writer.readTicket=null;writer.read='failed';writer.readUncertain=true;emit();return true;},
        markDirty(){check(writer);writer.revision++;changeEpoch++;emit();},
        beginWrite():WriteTicket {check(writer);if(writer.read!=='ready')throw new Error('资料尚未读取，不能保存。');
          const ticket={};writer.writes.set(ticket,{revision:writer.revision,sequence:++writer.nextSequence});changeEpoch++;emit();return ticket;},
        finishWrite(ticket:WriteTicket,success:boolean){check(writer);const pending=writer.writes.get(ticket);
          if(!pending)throw new Error('保存记录无效或已完成。');writer.writes.delete(ticket);changeEpoch++;
          if(!success)writer.failure=true;
          else if(pending.sequence<writer.lastCommitted)writer.failure=true;
          else {writer.lastCommitted=pending.sequence;
            if(pending.revision===writer.revision && writer.writes.size===0){writer.savedRevision=pending.revision;writer.failure=false;}}
          emit();},
        destroy(){if(!writer.alive)return;check(writer);if(!mayRetire(writer)){lost=true;taintedScopes.add(scope);}writer.alive=false;writer.readTicket=null;writers.delete(role);changeEpoch++;emit();},
      };
    },
    /** A remote/source notification invalidates prior reads without discarding editor input. */
    invalidate(){if(destroyed)return;changeEpoch++;for(const writer of writers.values()){writer.read='stale';writer.readTicket=null;writer.readUncertain=true;}emit();},
    destroy(){if(destroyed)return;if(lost||[...writers.values()].some(writer=>!mayRetire(writer)))taintedScopes.add(scope);destroyed=true;for(const writer of writers.values())writer.alive=false;writers.clear();activeScopes.delete(scope);emit();listeners.clear();},
  };
}
