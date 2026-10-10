'use client';

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { layoutStore } from '../hooks/use-layout-store';
import { CommercialDossierPanel } from './commercial-dossier-panel';
import { useLocalProjectBackup } from './creative-studio';
import type { RoomLayout } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

interface CommercialWorkspaceProps {
  controller: BackendSession;
  layout: RoomLayout;
  isActive: boolean;
  ensurePersistentIdentity(): void;
}

type Identity = {
  controller: BackendSession; apiUrl: string; userId: string | null;
  mode: 'local' | 'cloud'; projectId: string | null; active: boolean; epoch: number;
};

function sameIdentity(left: Identity, right: Omit<Identity, 'epoch'>): boolean {
  return left.controller === right.controller && left.apiUrl === right.apiUrl && left.userId === right.userId &&
    left.mode === right.mode && left.projectId === right.projectId && left.active === right.active;
}

/** Local documents follow activity identity; geometry edits and scene-service leases do not move them. */
export function CommercialWorkspace({ controller, layout, isActive, ensurePersistentIdentity }: CommercialWorkspaceProps): JSX.Element {
  const latest = useRef({ controller, isActive, ensurePersistentIdentity });
  latest.current = { controller, isActive, ensurePersistentIdentity };
  const [, refresh] = useReducer(value => value + 1, 0);
  const mounted = useRef(false);
  const verified = useRef<number | null>(null);
  const readIdentity = (): Omit<Identity, 'epoch'> => {
    const owner = latest.current.controller;
    return { controller: owner, apiUrl: owner.config.apiUrl, userId: owner.getSnapshot().user?.id ?? null,
      mode: isLocalActivityWorkspace(owner) ? 'local' : 'cloud',
      projectId: layoutStore.getState().layout.id ?? null, active: latest.current.isActive };
  };
  const identityRef = useRef<Identity>({ ...readIdentity(), epoch: 0 });
  const sample = (): Identity => {
    const next = readIdentity();
    if (!sameIdentity(identityRef.current, next)) {
      identityRef.current = { ...next, epoch: identityRef.current.epoch + 1 };
      verified.current = null;
    }
    return identityRef.current;
  };
  const identity = sample();
  const sampleRef = useRef(sample); sampleRef.current = sample;
  const [readyEpoch, setReadyEpoch] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const backup = useLocalProjectBackup();

  useLayoutEffect(() => {
    mounted.current = true;
    const observe = () => {
      const before = identityRef.current.epoch;
      if (sampleRef.current().epoch !== before) refresh();
    };
    const stopLayout = layoutStore.subscribe(observe), stopSession = controller.subscribe(observe);
    observe();
    return () => { mounted.current = false; stopLayout(); stopSession(); };
  }, [controller]);

  useEffect(() => {
    const captured = identity.epoch;
    if (!identity.active || identity.mode !== 'local' || !identity.projectId) return;
    setError('');
    try {
      latest.current.ensurePersistentIdentity();
      if (!mounted.current || sampleRef.current().epoch !== captured) return;
      verified.current = captured; setReadyEpoch(captured);
    } catch (caught) {
      if (mounted.current && sampleRef.current().epoch === captured) {
        setError(caught instanceof Error ? caught.message : '本机活动尚未保存，请完成保存后重新读取约定。');
      }
    }
  }, [identity.epoch, identity.active, identity.mode, identity.projectId, retry]);

  const ready = identity.mode === 'cloud' || readyEpoch === identity.epoch && verified.current === identity.epoch;
  const capturedEpoch = identity.epoch;
  const guard = () => {
    const before = identityRef.current.epoch;
    const current = sampleRef.current();
    if (current.epoch !== before) refresh();
    if (!mounted.current || !current.active || current.mode !== 'local' || current.epoch !== capturedEpoch ||
      !current.projectId || verified.current !== capturedEpoch) throw new Error('本机活动或登录状态已变化，请重新读取约定。');
  };
  return <>
    {identity.mode === 'local' && !ready && <div role={error ? 'alert' : 'status'} className="sc-note">
      <p>{error || '正在核对本机活动保存状态…'}</p>
      <button type="button" className="sc-button" onClick={() => setRetry(value => value + 1)}>重新读取约定</button>
    </div>}
    <div hidden={!ready}>
      <CommercialDossierPanel identity={{ mode: identity.mode, projectId: ready ? identity.projectId : null, epoch: identity.epoch }}
        flushScope={identity.projectId ?? ''} layout={layout} guard={guard} disabled={!isActive || !!backup?.backupPending}/>
    </div>
  </>;
}
