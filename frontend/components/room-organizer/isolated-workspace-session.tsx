'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {localWriteCapabilityGuard,type LocalWriteCapability} from '@/lib/local-write-lease';
import {createWorkspaceWriteSession,type WorkspaceWriteSession} from '@/lib/workspace-write-session';
import {ReadonlyDraftExport} from './readonly-draft-export';
import type {ReadonlyDraftInputs} from './lib/readonly-draft-bundle';

/** Explicit integration seam only; never mounted by the production entry. */
export function IsolatedWorkspaceSession({capability,children,captureDrafts}:{
  capability:LocalWriteCapability;
  children:(session:WorkspaceWriteSession)=>ReactNode;
  /** Read-only, explicitly scoped capture. Unavailable parts must be reported rather than guessed. */
  captureDrafts:()=>ReadonlyDraftInputs;
}) {
 const initial=useRef(capability);
 const [state,setState]=useState<{session:WorkspaceWriteSession|null;message:string;revoked:boolean}>({session:null,message:'',revoked:false});
 useEffect(()=>{
  let alive=true,session:WorkspaceWriteSession|null=null,abort:(()=>void)|undefined;
  try {
   session=createWorkspaceWriteSession(initial.current);
   const guard=localWriteCapabilityGuard(initial.current);
   abort=()=>{if(alive)setState(previous=>({...previous,revoked:true,message:'本机编辑权已失效，保存已暂停。请先导出当前草稿。'}));};
   guard.signal.addEventListener('abort',abort,{once:true});
   setState({session,message:'',revoked:false});
  }catch{setState({session:null,message:'本机编辑会话无法安全建立，原资料已保留。',revoked:true});}
  return ()=>{alive=false;if(abort)try{localWriteCapabilityGuard(initial.current).signal.removeEventListener('abort',abort);}catch{/* already revoked */}session?.close();};
 },[]);
 const readonly=state.revoked||capability!==initial.current;
 return <>
  {state.session ? <div aria-disabled={readonly} ref={node=>{if(node)node.toggleAttribute('inert',readonly);}}>{children(state.session)}</div>
    : <p role="status">{state.message||'正在核对本机编辑权，请稍候。'}</p>}
  {readonly&&<section role="alert"><p>{state.message||'本机编辑权已变化，保存已暂停。请先导出当前草稿。'}</p>
   <ReadonlyDraftExport capture={captureDrafts}/></section>}
 </>;
}
