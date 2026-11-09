'use client';

import {useEffect,useRef,useSyncExternalStore} from 'react';
import type {BackendSession} from '@/lib/backend-session';
import {getActiveAssistantSessionId} from '../hooks/use-assistant-sessions';
import {useAgent} from './agent-panel';
import {AgentChat, type AgentChatProps} from './agent-chat';

/** Space and materials are views of the same activity conversation. */
export function AgentChatBridge({onOpenActivity,controller,...props}:Omit<AgentChatProps,'onForwardToActivity'|'draftScope'>&{onOpenActivity:()=>void;controller:BackendSession}):JSX.Element|null {
  const activity=useAgent();
  const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  const mounted=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const sessionId=getActiveAssistantSessionId(activity.sessionScope);
  const draftScope=JSON.stringify([activity.sessionScope,sessionId,snapshot.user?.id??null,props.agent]);
  return <AgentChat key={draftScope} {...props} draftScope={draftScope} onForwardToActivity={async text=>{
    if(!sessionId||!activity.isSessionCurrent()||activity.isUnderstanding(text)||!activity.canForward(text)||activity.callbacks.workbenchMode!=='layout')return false;
    const identity=()=>JSON.stringify([controller.config.apiUrl,controller.getSnapshot().user?.id??null,controller.getSnapshot().sessionId]);
    const initial=identity();let invalidated=false;
    const unsubscribe=controller.subscribe(()=>{if(identity()!==initial)invalidated=true;});
    try{
      await activity.send(text);
      if(!mounted.current||invalidated||identity()!==initial||!activity.isSessionCurrent()||getActiveAssistantSessionId(activity.sessionScope)!==sessionId)return false;
    }catch{return false;}finally{unsubscribe();}
    // A failed navigation must not cause a second send: the activity already received it.
    try{onOpenActivity();}catch{/* The accepted message remains in the activity conversation. */}
    return true;
  }}/>;
}
