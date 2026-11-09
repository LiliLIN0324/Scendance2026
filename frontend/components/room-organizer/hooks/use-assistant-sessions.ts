'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { hasNoStoredBriefForNewSession, pruneBriefMemories } from '../lib/assistant-brief-memory';
import {
  deleteSessionBubbles,
  ASSISTANT_SESSION_BODIES_STORAGE_KEY,
  emptyAssistantSessionBodies,
  pruneSessionBodies,
  readAssistantSessionBodies,
  writeAssistantSessionBodies,
  type AssistantSessionBodies,
} from '../lib/assistant-session-bodies';
import {
  ASSISTANT_SESSIONS_STORAGE_KEY,
  createAssistantSessionId,
  deleteAssistantSession,
  emptyAssistantSessionIndex,
  filterAssistantSessions,
  openAssistantSession,
  readAssistantSessionIndex,
  renameAssistantSession,
  seedAssistantSessionIndex,
  selectAssistantSession,
  sortAssistantSessions,
  toggleAssistantSessionFavorite,
  touchAssistantSession,
  writeAssistantSessionIndex,
  type AssistantSession,
  type AssistantSessionIndex,
} from '../lib/assistant-sessions';

export interface AssistantSessionsController {
  ready: boolean;
  saveFailed: boolean;
  /** 当前选中的会话；不受搜索过滤影响。 */
  activeSession: AssistantSession | null;
  /** 已按收藏优先、最近更新排序，并套上搜索。 */
  visible: readonly AssistantSession[];
  totalCount: number;
  activeId: string | null;
  query: string;
  setQuery(value: string): void;
  openSession(): {id:string;verifiedFresh:boolean}|null;
  selectSession(id: string): void;
  renameSession(id: string, title: string): void;
  toggleFavorite(id: string): void;
  deleteSession(id: string): void;
  /** 当前场有新气泡时抬一下 updatedAt，列表会往上排。 */
  touchActiveSession(): void;
}

type Snapshot = {
  ready: boolean;
  saveFailed: boolean;
  index: AssistantSessionIndex | null;
  query: string;
};

/**
 * 方案会话索引的本机读写（模块级单例，左栏与历史浮层共享同一份）。
 * 不订阅布局撤销：`use-history` / `use-layout-history` 仍只服务画布 undo。
 * 气泡正文另键存放，删/裁索引时顺带清孤儿袋。
 */
/** Scoped storage keeps legacy data untouched and never imports it as activity facts. */
export function scopedAssistantStorage(scope: string): Storage | undefined {
  if (scope === 'legacy') return undefined;
  const key=(value:string)=>`${value}.scope.${encodeURIComponent(scope)}`;
  return {
    get length(){ return 0; }, clear(){ throw new Error('不支持清空全部会话'); }, key(){ return null; },
    getItem(value){ return window.localStorage.getItem(key(value)); },
    setItem(value,data){ window.localStorage.setItem(key(value),data); },
    removeItem(value){ window.localStorage.removeItem(key(value)); },
  };
}
function createScopedStore(scope: string) {
  const storage=scopedAssistantStorage(scope);
let snapshot: Snapshot = { ready: false, saveFailed: false, index: null, query: '' };
let bodies: AssistantSessionBodies = emptyAssistantSessionBodies();
const listeners = new Set<() => void>();
let bootstrapped = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function replaceSnapshot(next: Snapshot): void {
  snapshot = next;
  emit();
}

function canWrite(assertWrite?: () => void): boolean { try { assertWrite?.(); return true; } catch { return false; } }

function persistIndex(index: AssistantSessionIndex, assertWrite?: () => void): boolean {
  if (!canWrite(assertWrite)) return false;
  const ok = writeAssistantSessionIndex(index, storage);
  if (!ok) return false;
  const keep = new Set(index.sessions.map(item => item.id));
  const memoryOk = pruneBriefMemories(keep, storage, assertWrite);
  if (!memoryOk) return false;
  const pruned = pruneSessionBodies(bodies, keep);
  if (pruned !== bodies) {
    if (!canWrite(assertWrite)) return false;
    bodies = pruned;
    if (!writeAssistantSessionBodies(bodies, storage)) return false;
  }
  return memoryOk;
}

function commitIndex(index: AssistantSessionIndex, query = snapshot.query, assertWrite?: () => void): void {
  replaceSnapshot({
    ready: true,
    saveFailed: !persistIndex(index, assertWrite),
    index,
    query,
  });
}

function ensureBootstrapped(assertWrite?: () => void): void {
  if (bootstrapped || typeof window === 'undefined') return;
  bootstrapped = true;
  bodies = readAssistantSessionBodies(storage);
  const stored = readAssistantSessionIndex(storage);
  if (stored) {
    const pruned = pruneSessionBodies(bodies, stored.sessions.map(item => item.id));
    let failed = false;
    if (pruned !== bodies) {
      if (assertWrite && canWrite(assertWrite) && writeAssistantSessionBodies(pruned, storage)) bodies = pruned;
      else failed = true;
    }
    snapshot = { ready: true, saveFailed: failed, index: stored, query: '' };
    return;
  }
  const seeded = seedAssistantSessionIndex(Date.now(), createAssistantSessionId());
  snapshot = {
    ready: true,
    saveFailed: !assertWrite || !canWrite(assertWrite) || !writeAssistantSessionIndex(seeded, storage),
    index: seeded,
    query: '',
  };
}

function subscribe(listener: () => void): () => void {
  ensureBootstrapped();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): Snapshot {
  ensureBootstrapped();
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return { ready: false, saveFailed: false, index: null, query: '' };
}

/** 测试用：清掉单例，下一次订阅会重新从 storage 引导。 */
function reset(): void {
  snapshot = { ready: false, saveFailed: false, index: null, query: '' };
  bodies = emptyAssistantSessionBodies();
  bootstrapped = false;
  listeners.clear();
}

/** 给 LayoutAgentProvider 读/写当前场气泡正文（与 hook 同份 bodies）。 */
function getBodies(): AssistantSessionBodies {
  ensureBootstrapped();
  return bodies;
}

function replaceBodies(next: AssistantSessionBodies, assertWrite?: () => void): boolean {
  ensureBootstrapped();
  bodies = next;
  return canWrite(assertWrite) && writeAssistantSessionBodies(bodies, storage);
}

/** 切场落盘前确认旧场还在索引里，避免删除后把正文又写回去。 */
function sessionExists(id: string): boolean {
  ensureBootstrapped();
  return !!snapshot.index?.sessions.some(item => item.id === id);
}

function useController(assertWrite?: () => void): AssistantSessionsController {
  ensureBootstrapped(assertWrite ?? (() => {}));
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setQuery = useCallback((value: string) => {
    if (snapshot.query === value) return;
    replaceSnapshot({ ...snapshot, query: value });
  }, []);

  const openSession = useCallback(() => {
    const index = snapshot.index ?? emptyAssistantSessionIndex();
    const id=createAssistantSessionId();
    const strictBodiesMissing=():boolean=>{
      try {
        const target=storage??(typeof window==='undefined'?undefined:window.localStorage);
        if(!target)return false;
        const raw=target.getItem(ASSISTANT_SESSION_BODIES_STORAGE_KEY);
        if(raw===null)return true;
        const parsed:unknown=JSON.parse(raw);
        if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return false;
        const record=parsed as Record<string,unknown>;
        if(record.version!==1||!record.byId||typeof record.byId!=='object'||Array.isArray(record.byId))return false;
        return !Object.hasOwn(record.byId,id);
      } catch {return false;}
    };
    let before=false;
    try {
      const target=storage??(typeof window==='undefined'?undefined:window.localStorage);
      const raw=target?.getItem(ASSISTANT_SESSIONS_STORAGE_KEY);
      const persisted=raw?readAssistantSessionIndex(target):null;
      before=!!persisted&&persisted.activeId===index.activeId&&!index.sessions.some(session=>session.id===id)&&!persisted.sessions.some(session=>session.id===id)&&!Object.hasOwn(bodies.byId,id)&&strictBodiesMissing()&&hasNoStoredBriefForNewSession(id,target);
    } catch {before=false;}
    commitIndex(openAssistantSession(index, { id, now: Date.now() }), '', assertWrite);
    let verifiedFresh=false;
    try {
      const target=storage??(typeof window==='undefined'?undefined:window.localStorage);
      const persisted=target?readAssistantSessionIndex(target):null;
      verifiedFresh=before&&!snapshot.saveFailed&&!!persisted&&persisted.activeId===id&&persisted.sessions.some(session=>session.id===id)&&!Object.hasOwn(bodies.byId,id)&&strictBodiesMissing()&&hasNoStoredBriefForNewSession(id,target)&&canWrite(assertWrite);
    } catch {verifiedFresh=false;}
    return {id,verifiedFresh};
  }, [assertWrite]);

  const selectSession = useCallback((id: string) => {
    const index = snapshot.index;
    if (!index) return;
    const next = selectAssistantSession(index, id, Date.now());
    if (next !== index) commitIndex(next, snapshot.query, assertWrite);
  }, [assertWrite]);

  const renameSession = useCallback((id: string, title: string) => {
    const index = snapshot.index;
    if (!index) return;
    const next = renameAssistantSession(index, id, title, Date.now());
    if (next !== index) commitIndex(next, snapshot.query, assertWrite);
  }, [assertWrite]);

  const toggleFavorite = useCallback((id: string) => {
    const index = snapshot.index;
    if (!index) return;
    const next = toggleAssistantSessionFavorite(index, id);
    if (next !== index) commitIndex(next, snapshot.query, assertWrite);
  }, [assertWrite]);

  const deleteSession = useCallback((id: string) => {
    const index = snapshot.index;
    if (!index) return;
    const next = deleteAssistantSession(index, id);
    if (next === index) return;
    if (!canWrite(assertWrite)) { replaceSnapshot({ ...snapshot, saveFailed: true }); return; }
    const nextBodies = deleteSessionBubbles(bodies, id);
    if (!canWrite(assertWrite) || !writeAssistantSessionBodies(nextBodies, storage)) { replaceSnapshot({ ...snapshot, saveFailed: true }); return; }
    bodies = nextBodies;
    commitIndex(next, snapshot.query, assertWrite);
  }, [assertWrite]);

  const touchActiveSession = useCallback(() => {
    const index = snapshot.index;
    const id = index?.activeId;
    if (!index || !id) return;
    const next = touchAssistantSession(index, id, Date.now());
    if (next !== index) commitIndex(next, snapshot.query, assertWrite);
  }, [assertWrite]);

  const sessions = current.index?.sessions ?? [];
  const visible = filterAssistantSessions(sortAssistantSessions(sessions), current.query);
  const activeSession = current.index?.activeId
    ? sessions.find(item => item.id === current.index?.activeId) ?? null
    : null;

  return {
    ready: current.ready,
    saveFailed: current.saveFailed,
    activeSession,
    visible,
    totalCount: sessions.length,
    activeId: current.index?.activeId ?? null,
    query: current.query,
    setQuery,
    openSession,
    selectSession,
    renameSession,
    toggleFavorite,
    deleteSession,
    touchActiveSession,
  };
}

  function peekHistory() { return bootstrapped ? {index:snapshot.index,bodies} : {index:readAssistantSessionIndex(storage),bodies:readAssistantSessionBodies(storage)}; }
  function subscribePassive(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
  function peekActive(): string | null { return (bootstrapped ? snapshot.index : readAssistantSessionIndex(storage))?.activeId ?? null; }
  return { reset, getBodies, replaceBodies, sessionExists, useController, peekHistory, subscribe, getSnapshot, subscribePassive, peekActive };
}
const scopedStores = new Map<string, ReturnType<typeof createScopedStore>>();
function scopedStore(scope: string) {
  let store=scopedStores.get(scope);
  if(!store){store=createScopedStore(scope);scopedStores.set(scope,store);}
  return store;
}
/** Discover other locally saved scopes for explicit read-only access; never select or import them. */
export function listOtherAssistantHistories(currentScope: string): Array<{scope:string;index:AssistantSessionIndex;bodies:AssistantSessionBodies}> {
  const scopes=new Set(scopedStores.keys());
  try {
    const prefix=`${ASSISTANT_SESSIONS_STORAGE_KEY}.scope.`;
    for(let i=0;i<window.localStorage.length;i++){
      const key=window.localStorage.key(i);
      if(!key?.startsWith(prefix))continue;
      try {scopes.add(decodeURIComponent(key.slice(prefix.length)));} catch { /* malformed legacy key */ }
    }
  } catch { /* History may be unavailable; existing in-memory drafts remain readable. */ }
  return [...scopes].filter(scope=>scope!=='legacy'&&scope!==currentScope).flatMap(scope=>{
    const history=scopedStore(scope).peekHistory();
    return history.index?.sessions.length ? [{scope,index:history.index,bodies:history.bodies}] : [];
  });
}
export function resetAssistantSessionsStoreForTests(): void { for(const store of scopedStores.values())store.reset();scopedStores.clear(); }
export function getAssistantSessionBodies(scope='legacy'): AssistantSessionBodies { return scopedStore(scope).getBodies(); }
export function replaceAssistantSessionBodies(next:AssistantSessionBodies, assertWrite?:()=>void, scope='legacy'):boolean { return scopedStore(scope).replaceBodies(next,assertWrite); }
export function assistantSessionExists(id:string,scope='legacy'):boolean { return scopedStore(scope).sessionExists(id); }
/** Read the selected session synchronously before sending any conversation context. */
export function getActiveAssistantSessionId(scope:string):string|null { return scopedStore(scope).peekActive(); }
/** Synchronous transitions, including a switch away and back before React renders. */
export function subscribeActiveAssistantSession(scope:string,listener:(id:string|null)=>void):()=>void {
  const store=scopedStore(scope);let last=store.peekActive();
  return store.subscribePassive(()=>{const next=store.peekActive();if(next!==last){last=next;listener(next);}});
}
export function useAssistantSessions(assertWrite?:()=>void,scope='legacy'):AssistantSessionsController { return scopedStore(scope).useController(assertWrite); }
