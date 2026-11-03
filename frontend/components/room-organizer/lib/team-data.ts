'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BackendSession } from '@/lib/backend-session';
import { useBackendSession } from '@/lib/backend-session';
import { listMembers, preferredStudio, type StudioMember } from '@/lib/workspace-api';

export interface TeamSnapshot {
  /** 没登录时是空串：左轨要把原因写出来，不能假装有一个空团队。 */
  userId: string;
  studioId: string;
  teamName: string;
  members: StudioMember[];
  loading: boolean;
  error: string;
}

const EMPTY: TeamSnapshot = { userId: '', studioId: '', teamName: '', members: [], loading: false, error: '' };

const listeners = new Set<() => void>();

/** 成员改完（加人、移除、改名）喊一声，左轨和面板读的是同一份，必须一起换。 */
export function notifyTeamChanged(): void {
  for (const listener of [...listeners]) listener();
}

function subscribeTeam(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function roleLabel(role: StudioMember['role']): string {
  return role === 'owner' ? '负责人' : '编辑成员';
}

/** 当前工作室的团队：登录者自己的账号优先取项目所属工作室，其次取本机记住的那一个。 */
export function useTeam(controller: BackendSession): TeamSnapshot & { refresh(): void } {
  const session = useBackendSession(controller);
  const userId = session.user?.id ?? '';
  const projectStudioId = session.project?.studio_id ?? '';
  const [team, setTeam] = useState<TeamSnapshot>(EMPTY);
  const [revision, setRevision] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => subscribeTeam(() => setRevision(current => current + 1)), []);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!userId) { setTeam(EMPTY); return; }
    setTeam(current => ({ ...current, userId, loading: true, error: '' }));
    void (async () => {
      try {
        const studios = await controller.listStudios();
        if (request !== requestRef.current) return;
        const studioId = preferredStudio(userId, studios, projectStudioId);
        const studio = studios.find(item => item.id === studioId) ?? null;
        const members = studio ? await listMembers(controller, studio.id) : [];
        if (request !== requestRef.current) return;
        setTeam({ userId, studioId, teamName: studio?.name ?? '', members, loading: false, error: '' });
      } catch (error) {
        if (request !== requestRef.current) return;
        setTeam({ ...EMPTY, userId, error: error instanceof Error ? error.message : '团队加载失败，点击重试。' });
      }
    })();
  }, [controller, userId, projectStudioId, revision]);

  const refresh = useCallback(() => setRevision(current => current + 1), []);
  return { ...team, refresh };
}
