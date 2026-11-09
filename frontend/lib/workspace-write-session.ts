import {bindWorkspaceWriteFence} from './workspace-write-fence';
import { localWriteCapabilityGuard, type LocalWriteCapability } from './local-write-lease';
import { bindSourceWriteSession, type SourceFormKey, type StoredSource } from './source-storage';
import { sourceCapabilityStorage } from './source-capability-storage';
import { mergeStoredMaterialCheckins } from './material-checkin-storage';
import type { MaterialCheckinLedger } from '../../supabase/functions/_shared/material-checkin-contract';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { bindAgentChatWriteSession } from '../components/room-organizer/panels/agent-chat-store';
import { createLayoutPersistenceCapability } from '../components/room-organizer/lib/layout-capability-persistence';
import { saveNamedLayout, deleteNamedLayout } from '../components/room-organizer/lib/library';
import { readEnvironmentsStrict, writeEnvironmentsStrict, clearEnvironmentStrict,
  type EnvironmentScope, type StoredEnvironment } from '../components/room-organizer/lib/environment-preference';

let activeSession: object | null = null;

/** Isolated integration seam; not mounted in production and does not prove all writers participate. */
export function createWorkspaceWriteSession(capability: LocalWriteCapability) {
  const capabilityGuard = localWriteCapabilityGuard(capability);
  capabilityGuard.assertStillHeld();
  if (capabilityGuard.signal.aborted || activeSession) throw new Error('本机编辑会话不可用，请先核对。');
  const layout = createLayoutPersistenceCapability(capability);
  const token = {};
  const unbindFence=bindWorkspaceWriteFence(capability);
  let unbind:()=>void;
  try { unbind=bindSourceWriteSession(capability); }
  catch(error){unbindFence();throw error;}
  let unbindChat: () => void;
  try { unbindChat = bindAgentChatWriteSession(capability); }
  catch (error) { unbind();unbindFence();throw error; }
  activeSession = token;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    capabilityGuard.signal.removeEventListener('abort', close);
    unbind();
    unbindChat();
    unbindFence();
    if (activeSession === token) activeSession = null;
  };
  const assertWrite = () => {
    if (closed || activeSession !== token) throw new Error('本机编辑会话已关闭，请保留资料并重新核对。');
    try { capabilityGuard.assertStillHeld(); if (capabilityGuard.signal.aborted) throw new Error(); }
    catch { close(); throw new Error('本机编辑权已失效，请保留资料并重新核对。'); }
  };
  capabilityGuard.signal.addEventListener('abort',close,{once:true});
  if (capabilityGuard.signal.aborted) close();
  return {
    close, assertWrite,
    assertCapability(value:LocalWriteCapability | undefined) { assertWrite(); if(value!==capability)throw new Error('编辑权与本机会话不一致。'); },
    layout: {
      save(value:RoomLayout) { assertWrite(); return layout.saveLayout(value); },
      snapshot(value:RoomLayout) { assertWrite(); return layout.recordSnapshot(value,{force:true}); },
      clearSnapshots() { assertWrite(); return layout.clearSnapshots(); },
      evictOldestSnapshot() { assertWrite(); return layout.evictOldestSnapshot(); },
    },
    library: {
      save(value:RoomLayout,name:string) { assertWrite(); return saveNamedLayout(value,name,capability); },
      delete(id:string) { assertWrite(); return deleteNamedLayout(id,capability); },
    },
    environment: {
      read(scope:EnvironmentScope) { assertWrite(); return readEnvironmentsStrict(scope,capability); },
      write(id:string|undefined,values:readonly StoredEnvironment[],expectedRaw:string|null) {
        assertWrite(); return writeEnvironmentsStrict(id,values,capability,{expectedRaw});
      },
      clear(id:string|undefined,expectedRaw:string|null) { assertWrite(); return clearEnvironmentStrict(id,capability,{expectedRaw}); },
    },
    /** The assistant index, bodies and memories are multiple keys without atomic recovery. */
    assertSessionWrite() { assertWrite(); throw new Error('会话资料暂不支持安全写入，请保留现有草稿。'); },
    sources: {
      store(source:StoredSource) { assertWrite(); return sourceCapabilityStorage.storeSource(capability,source); },
      delete(id:string) { assertWrite(); return sourceCapabilityStorage.deleteSource(capability,id); },
      update<T>(scope:SourceFormKey,update:(current:unknown)=>T) { assertWrite(); return sourceCapabilityStorage.updateSourceForm(capability,scope,update); },
      flush(scope:string) { assertWrite(); return sourceCapabilityStorage.flushSourceScope(capability,scope); },
      storeForm(scope:string,value:unknown) { assertWrite(); return sourceCapabilityStorage.storeSourceForm(capability,scope,value); },
      deleteForm(scope:string) { assertWrite(); return sourceCapabilityStorage.deleteSourceForm(capability,scope); },
      copy(from:string,to:string) { assertWrite(); return sourceCapabilityStorage.copySourceScope(capability,from,to); },
    },
    checkins: {
      merge(projectId:string,ledger:MaterialCheckinLedger) { assertWrite(); return mergeStoredMaterialCheckins(projectId,ledger,assertWrite,capability); },
    },
  };
}

export type WorkspaceWriteSession = ReturnType<typeof createWorkspaceWriteSession>;
