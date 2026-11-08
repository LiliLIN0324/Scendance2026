import {localWriteCapabilityGuard,type LocalWriteCapability} from './local-write-lease';
let required=false,active:LocalWriteCapability|null=null,epoch=0;
/** Module-level fence is opt-in; once enabled it never falls back to legacy in this realm. */
export function bindWorkspaceWriteFence(capability:LocalWriteCapability):()=>void {
 const guard=localWriteCapabilityGuard(capability);guard.assertStillHeld();
 if(active)throw new Error('本机写入会话已存在。');
 required=true;active=capability;const generation=++epoch;
 return ()=>{if(epoch===generation){active=null;epoch++;}};
}
export function isWorkspaceWriteFenceRequired():boolean{return required;}
/** Capture the active generation, so unbind/rebind cannot authorize a queued old write. */
export function captureWorkspaceWriteFence(requested?:LocalWriteCapability):(()=>void)|undefined {
 if(!required){if(!requested)return undefined;const guard=localWriteCapabilityGuard(requested);return ()=>guard.assertStillHeld();}
 const bound=active,generation=epoch;
 return ()=>{if(!bound||active!==bound||epoch!==generation||(requested!==undefined&&requested!==bound))throw new Error('本机写入会话已失效，请保留资料。');
  localWriteCapabilityGuard(bound).assertStillHeld();};
}
/** For APIs with a safe capability path, bind legacy calls to the same live capability. */
export function resolveWorkspaceWriteCapability(requested?:LocalWriteCapability):LocalWriteCapability|undefined {
 if(!required)return requested;
 const check=captureWorkspaceWriteFence(requested);check?.();return active ?? undefined;
}
/** Some legacy whole-map writers cannot preserve unknown data and must be migrated first. */
export function rejectUnprotectedWorkspaceWrite():void {if(required)throw new Error('当前编辑会话暂不支持此保存方式，请保留资料。');}
