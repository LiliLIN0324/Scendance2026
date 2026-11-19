'use client';

import { useSyncExternalStore } from 'react';
import { normalizeSupervision, type SupervisionLevel } from './agent-supervision';

export const AGENT_SUPERVISION_KEY = 'scendance.agent.supervision';
const listeners = new Set<() => void>();
let unavailableStorageLevel: SupervisionLevel = 'key-points';

/** User preference only. Model replies, attachments and venue data never write this store. */
export function getAgentSupervision(): SupervisionLevel {
  if (typeof window === 'undefined') return 'key-points';
  try { return normalizeSupervision(window.localStorage.getItem(AGENT_SUPERVISION_KEY)); }
  catch { return unavailableStorageLevel; }
}

export function setAgentSupervision(level: SupervisionLevel): void {
  const normalized = normalizeSupervision(level);
  unavailableStorageLevel = normalized;
  try { window.localStorage.setItem(AGENT_SUPERVISION_KEY, normalized); }
  catch { /* A blocked preference store does not block this session's selection. */ }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === AGENT_SUPERVISION_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}

export function useAgentSupervision(): SupervisionLevel {
  return useSyncExternalStore(subscribe, getAgentSupervision, () => 'key-points');
}
