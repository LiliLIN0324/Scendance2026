'use client';
import {useEffect,useRef} from 'react';
import {localWriteCapabilityGuard,type LocalWriteCapability} from '@/lib/local-write-lease';
import {RoomOrganizer} from './room-organizer';
import {layoutStore} from './hooks/use-layout-store';
import {localDraftDeliveryJson} from './lib/local-draft-delivery';
import {readReadonlyDraft,retainReadonlyDraft} from './lib/readonly-draft-registry';
import type {DraftPart,ReadonlyDraftInputs,DraftImage} from './lib/readonly-draft-bundle';
import type {RoomLayout} from './lib/types';
import {readonlyComposerDrafts} from './panels/agent-panel';
import {unsavedSourceDrafts} from './panels/unsaved-source-drafts';
import {IsolatedWorkspaceSession} from './isolated-workspace-session';

const stoppedDrafts=new Map<string,ReadonlyDraftInputs>();
/** Can also be mounted after editor unmount to read the last frozen in-memory snapshot. */
export function captureIsolatedPageDrafts(scope:string):ReadonlyDraftInputs {
 return stoppedDrafts.get(scope)??assembleIsolatedPageDrafts(scope);
}
function assembleIsolatedPageDrafts(scope:string):ReadonlyDraftInputs {
 const retained=readReadonlyDraft(scope,'layout'),omissions:string[]=[];
 let layoutPart:DraftPart<unknown>=retained;
 const layout=retained.status==='captured'?retained.value as RoomLayout:null;
 if(layout)try{layoutPart={status:'captured',value:JSON.parse(localDraftDeliveryJson(layout))};omissions.push('布局草稿经过隐私过滤，不含原模型、设计版本和私密链接。');}
 catch{layoutPart={status:'unavailable',reason:'当前布局无法无损整理'};}
 const ambiguous=scope==='local';
 const activityScope=layout?.id?`activity:${layout.id}`:'draft:unidentified';
 const composer=layout?readonlyComposerDrafts(activityScope):[];
 if(!layout)omissions.push('活动对话未包含：无法核对活动身份。');
 const creative=ambiguous?{status:'unavailable' as const,reason:'匿名草稿与同名活动范围无法区分'}:readReadonlyDraft(scope,'creative-conversation');
 if(creative.status==='unavailable')omissions.push(`Bingo 未发送对话未包含：${creative.reason}`);
 omissions.push('对话中的临时附件不包含在文字草稿中。');
 const photos=ambiguous?[]:unsavedSourceDrafts(scope).map(draft=>({id:draft.image.id,name:draft.image.name,blob:draft.image.blob}));
 return {scope,additionalOmissions:omissions,layout:layoutPart,
  conversations:{status:'captured',value:{activity:composer,creative:creative.status==='captured'?creative.value:null}},
  brief:ambiguous?{status:'unavailable',reason:'匿名草稿与同名活动范围无法区分'}:readReadonlyDraft(scope,'brief'),
  images:ambiguous?{status:'unavailable',reason:'匿名草稿与同名活动范围无法区分'}:photos.length?{status:'captured',value:photos as DraftImage[]}:{status:'none'},
  environment:ambiguous?{status:'unavailable',reason:'匿名草稿与同名活动范围无法区分'}:readReadonlyDraft(scope,'environment'),
  calibration:{status:'unavailable',reason:'标定候选尚未接入此导出；请保留原有标定资料'},
 };
}

/** Opt-in prototype only; this partial export does not constitute a recoverable project backup. */
export function IsolatedRoomOrganizer({capability}:{capability:LocalWriteCapability}) {
 const initialCapability=useRef(capability),scopeRef=useRef(layoutStore.getState().layout.id??'local'),lastLayoutRef=useRef(layoutStore.getState().layout),layoutCopyFailed=useRef(false),alive=useRef(true),frozen=useRef(false);
 if(capability!==initialCapability.current)alive.current=false;
 useEffect(()=>{if(capability!==initialCapability.current)return;frozen.current=false;alive.current=true;const retain=()=>retainReadonlyDraft(scopeRef.current,'layout',layoutCopyFailed.current?{status:'unavailable',reason:'失权时无法保留布局快照'}:{status:'captured',value:lastLayoutRef.current});
  const stop=()=>{if(frozen.current)return;frozen.current=true;alive.current=false;try{lastLayoutRef.current=structuredClone(lastLayoutRef.current);}catch{layoutCopyFailed.current=true;}retain();stoppedDrafts.set(scopeRef.current,assembleIsolatedPageDrafts(scopeRef.current));};
  let guard:ReturnType<typeof localWriteCapabilityGuard>;try{guard=localWriteCapabilityGuard(capability);}catch{stop();return;}
  guard.signal.addEventListener('abort',stop,{once:true});if(guard.signal.aborted)stop();
  const unsubscribe=layoutStore.subscribe(state=>{if(alive.current){const next=state.layout.id??'local';if(next!==scopeRef.current)retain();scopeRef.current=next;lastLayoutRef.current=state.layout;}});
  return()=>{stop();guard.signal.removeEventListener('abort',stop);unsubscribe();};},[capability]);
 const capture=():ReadonlyDraftInputs=>{if(alive.current){retainReadonlyDraft(scopeRef.current,'layout',{status:'captured',value:lastLayoutRef.current});return assembleIsolatedPageDrafts(scopeRef.current);}return captureIsolatedPageDrafts(scopeRef.current);};
 return <IsolatedWorkspaceSession capability={capability} captureDrafts={capture}>{session=><RoomOrganizer localWriteCapability={capability} isolatedWriteSession={session}/>}</IsolatedWorkspaceSession>;
}
