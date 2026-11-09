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
import { layoutToBackendScene, SceneAdapterError } from '../lib/backend-adapter';
import { notify } from '../lib/editor-notices';
import { materialCount } from '../lib/structural-layout';
import type { RoomLayout } from '../lib/types';

interface Options {
  controller: BackendSession;
  layout: RoomLayout;
  onBindProject(projectId: string): void;
  /** Opt in only after session facts and scope are loaded and the binding is authorized. */
  enabled?: boolean;
  isCurrent?: (() => boolean) | undefined;
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

export function useSilentCloudAttach({ controller, layout, onBindProject, enabled = false, isCurrent }: Options): void {
  const bits = useSyncExternalStore(controller.subscribe, () => selectAttachBits(controller));
  const stateRef = useRef({ inFlight: false, done: false, lastCount: 0, lastAdapterError: '' });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const permissionRef = useRef({enabled,isCurrent}); permissionRef.current={enabled,isCurrent};
  const canAttach = (): boolean => { try {return permissionRef.current.enabled && !!permissionRef.current.isCurrent?.();} catch {return false;} };
  const bindRef = useRef(onBindProject);
  bindRef.current = onBindProject;
  const count = layout.floors.reduce((sum, floor) => sum + materialCount(floor.items), 0);

  useEffect(() => {
    const state = stateRef.current;
    if (state.done || state.inFlight || !canAttach()) return;
    const snapshot = controller.getSnapshot();
    if (!snapshot.configured || !snapshot.user || snapshot.user.is_anonymous) return;
    if (snapshot.geometryBinding) return;
    if (snapshot.project && layoutRef.current.id === snapshot.project.id) return;
    if (snapshot.lease && !snapshot.writeBlocked) return;
    if (!count || count <= state.lastCount) return;
    try {
      layoutToBackendScene(layoutRef.current);
      state.lastAdapterError = '';
    } catch (error) {
      const key = error instanceof SceneAdapterError ? error.code : 'unknown';
      if (state.lastAdapterError !== key) {
        state.lastAdapterError = key;
        notify(error instanceof SceneAdapterError ? error.message : '云端自动保存未完成，当前画布未变。请核对本机保存状态。', 'error');
      }
      return;
    }
    state.lastCount = count;
    state.inFlight = true;
    const userId = snapshot.user.id;
    void (async () => {
      const startedLayout = layoutRef.current;
      const capturedAuthority = permissionRef.current.isCurrent;
      const stillAuthorized = () => { try { return canAttach() && permissionRef.current.isCurrent === capturedAuthority && !!capturedAuthority?.(); } catch { return false; } };
      const previousScope = startedLayout.id ?? 'local';
      let projectId: string;
      let submittedLayout: RoomLayout | undefined;
      const changed = (): boolean => {
        if (stillAuthorized() && layoutRef.current === startedLayout) return false;
        state.inFlight = false;
        state.lastCount = 0;
        notify('云端连接期间本机内容发生变化，未自动绑定。当前画布未变，请核对本机保存状态后重试。', 'error');
        return true;
      };
      try {
        await flushSourceScope(previousScope);
        if (changed()) return;
        let studios = await controller.listStudios();
        if (changed()) return;
        if (!studios.length) {
          const created = await controller.businessRequest<Studio>('/studios', 'POST', { requestId: crypto.randomUUID(), name: '个人工作室', displayName: '负责人' });
          if (changed()) return;
          studios = [created];
        }
        const studioId = preferredStudio(userId, studios);
        rememberStudio(userId, studioId);
        const current = layoutRef.current;
        const scene = layoutToBackendScene(current);
        submittedLayout = current;
        const project = await controller.createProject(studioId, current.name?.trim() || defaultAttachName(), scene);
        projectId = project.id;
        // 项目已在云端存在：此后任何失败都不再重建，只补续接。
        state.done = true;
        if(project.projection?.requiresOriginalSceneForWrite){
          state.inFlight=false;
          notify(`云端项目已创建（编号 ${project.id}），但含未核验原始记录，目前仅供只读核对；本机草稿未绑定、未替换。`,'error');
          return;
        }
      } catch (error) {
        state.inFlight = false;
        if (error instanceof SceneAdapterError) {
          state.lastCount = 0;
          if (state.lastAdapterError !== error.code) { state.lastAdapterError = error.code; notify(error.message, 'error'); }
        } else notify('云端自动保存未完成，当前画布未变。请核对本机保存状态后重试。', 'error');
        return;
      }
      if (!stillAuthorized() || layoutRef.current !== submittedLayout) {
        state.inFlight = false;
        notify('云端草稿建立期间本机内容发生变化，未自动绑定。当前画布未变，请先核对云端草稿和本机保存状态。', 'error');
        return;
      }
      // 编辑权拿不到就按只读续接（账户面板里可再取），不挡绑定。
      try { await controller.acquireLease(projectId); } catch { /* 只读续接 */ }
      if (!stillAuthorized() || layoutRef.current !== submittedLayout) {
        state.inFlight = false;
        notify('云端草稿建立期间本机内容发生变化，未自动绑定。当前画布未变，请先核对云端草稿和本机保存状态。', 'error');
        return;
      }
      try { await copySourceScope(previousScope, projectId); } catch { /* 本机资料留在原范围 */ }
      if (!stillAuthorized() || layoutRef.current !== submittedLayout) {
        state.inFlight = false;
        notify('云端草稿建立期间本机内容发生变化，未自动绑定。当前画布未变，请先核对云端草稿和本机保存状态。', 'error');
        return;
      }
      markSelfAttachedProject(userId, projectId);
      bindRef.current(projectId);
      const url = new URL(window.location.href);
      url.searchParams.set('project', projectId);
      window.history.replaceState(null, '', url.pathname + url.search);
    })();
  }, [controller, bits, count, layout, enabled, isCurrent]);
}
