'use client';

/**
 * 无感挂云（设计规范 v2.5.2 §二.4「默认在云上」）：登录态下，本机画布第一次摆上物料且未连接项目时，
 * 静默在「个人工作室」建好云项目并接上现有保存链——建项目 → 取编辑权 → 绑定 layout.id → 同步 ?project=。
 * 只立壳（空白场地、门柱出入口等结构标记）不触发；访客（含匿名）不触发；建过就绝不重复建。
 * 失败不打扰：留在本机，等下一件物料进场再试。URL 同步前先打标记，CloudPanel 不会因此重开项目。
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { BackendSession, Studio } from '@/lib/backend-session';
import { copySourceScope, flushSourceScope } from '@/lib/source-storage';
import { markSelfAttachedProject, preferredStudio, rememberStudio } from '@/lib/workspace-api';
import { layoutToBackendScene } from '../lib/backend-adapter';
import { materialCount } from '../lib/structural-layout';
import type { RoomLayout } from '../lib/types';

interface Options {
  controller: BackendSession;
  layout: RoomLayout;
  onBindProject(projectId: string): void;
}

/** 「未命名方案 · MM-DD」：画布没起名字时的默认项目名。 */
export function defaultAttachName(now = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `未命名方案 · ${mm}-${dd}`;
}

/** 只订阅与挂云判定有关的位：编辑带来的 draft/dirty 翻动不重渲染整棵工作台。 */
function selectAttachBits(controller: BackendSession): string {
  const s = controller.getSnapshot();
  return [s.configured ? 1 : 0, s.user?.id ?? '', s.user?.is_anonymous ? 1 : 0, s.project?.id ?? '', s.writeBlocked ? 1 : 0, s.geometryBinding ? 1 : 0].join('|');
}

export function useSilentCloudAttach({ controller, layout, onBindProject }: Options): void {
  const bits = useSyncExternalStore(controller.subscribe, () => selectAttachBits(controller));
  const stateRef = useRef({ inFlight: false, done: false, lastCount: 0 });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const bindRef = useRef(onBindProject);
  bindRef.current = onBindProject;
  const count = layout.floors.reduce((sum, floor) => sum + materialCount(floor.items), 0);

  useEffect(() => {
    const state = stateRef.current;
    if (state.done || state.inFlight) return;
    const snapshot = controller.getSnapshot();
    if (!snapshot.configured || !snapshot.user || snapshot.user.is_anonymous) return;
    if (snapshot.geometryBinding) return;
    if (snapshot.project && layoutRef.current.id === snapshot.project.id) return;
    if (snapshot.lease && !snapshot.writeBlocked) return;
    if (!count || count <= state.lastCount) return;
    state.lastCount = count;
    state.inFlight = true;
    const userId = snapshot.user.id;
    void (async () => {
      const previousScope = layoutRef.current.id ?? 'local';
      let projectId: string;
      try {
        await flushSourceScope(previousScope);
        let studios = await controller.listStudios();
        if (!studios.length) {
          const created = await controller.businessRequest<Studio>('/studios', 'POST', { requestId: crypto.randomUUID(), name: '个人工作室', displayName: '负责人' });
          studios = [created];
        }
        const studioId = preferredStudio(userId, studios);
        rememberStudio(userId, studioId);
        const current = layoutRef.current;
        const project = await controller.createProject(studioId, current.name?.trim() || defaultAttachName(), layoutToBackendScene(current));
        projectId = project.id;
        // 项目已在云端存在：此后任何失败都不再重建，只补续接。
        state.done = true;
      } catch {
        state.inFlight = false;
        return;
      }
      // 编辑权拿不到就按只读续接（账户面板里可再取），不挡绑定。
      try { await controller.acquireLease(projectId); } catch { /* 只读续接 */ }
      try { await copySourceScope(previousScope, projectId); } catch { /* 本机资料留在原范围 */ }
      markSelfAttachedProject(userId, projectId);
      bindRef.current(projectId);
      const url = new URL(window.location.href);
      url.searchParams.set('project', projectId);
      window.history.replaceState(null, '', url.pathname + url.search);
    })();
  }, [controller, bits, count]);
}
