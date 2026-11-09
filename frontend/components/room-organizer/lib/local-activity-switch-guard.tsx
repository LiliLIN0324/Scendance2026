'use client';
import {createContext,useContext,type ReactNode} from 'react';
import type {LayoutPlanDraft} from '@/lib/plan-annotation';

type Snapshot={draft:LayoutPlanDraft|null;revision:number};
type Identity={scope:string;layoutRevision:number};
export interface ActivitySwitchGuard {capture():()=>void}
/** Fail closed until every supplied live source can be read and remains unchanged. */
export function createLocalActivitySwitchGuard(input:{identity():Identity;snapshot():Snapshot;blocker(scope:string):string|null}):ActivitySwitchGuard{
 const verify=(initial?:{identity:Identity;revision:number})=>{
  const identity=input.identity(),snapshot=input.snapshot();
  if(!identity.scope.trim()||!Number.isSafeInteger(identity.layoutRevision)||!Number.isSafeInteger(snapshot.revision))throw new Error('当前活动或草稿状态无法核对，未切换。');
  if(snapshot.draft)throw new Error('当前有未应用的规划草稿，请先完成或保留草稿，再切换活动。');
  const blocker=input.blocker(identity.scope);if(blocker)throw new Error(blocker);
  if(initial&&(initial.identity.scope!==identity.scope||initial.identity.layoutRevision!==identity.layoutRevision||initial.revision!==snapshot.revision))throw new Error('活动或草稿在准备期间发生变化，未切换。');
  return {identity,revision:snapshot.revision};
 };
 return {capture(){const initial=verify();return ()=>{verify(initial);};}};
}
const Context=createContext<ActivitySwitchGuard|null>(null);
export function LocalActivitySwitchGuardProvider({guard,children}:{guard:ActivitySwitchGuard;children:ReactNode}){return <Context.Provider value={guard}>{children}</Context.Provider>;}
export function useLocalActivitySwitchGuard(){return useContext(Context);}
