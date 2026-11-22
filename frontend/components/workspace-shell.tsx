'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  clearChunkReloadGuard,
  reloadOnceForChunkError,
} from '@/components/room-organizer/lib/chunk-reload';
import {
  latestLocalActivityRecord,
  latestOutdoorProjectId,
  LOCAL_ACTIVITY_ID_PREFIX,
  resolveFallbackOutdoorProject,
  resolveOutdoorProjectId,
} from '@/components/room-organizer/lib/outdoor-project-store';
import { onOutdoorProjectSwitch } from '@/components/room-organizer/lib/outdoor-project-switch';
import {
  adoptOutdoorActivity,
  listAdoptableActivities,
  type AdoptableActivity,
} from '@/components/room-organizer/lib/outdoor-plan-adoption';
import { OutdoorCloudRecover } from '@/components/room-organizer/components/outdoor-cloud-recover';
import { useAuth } from '@/lib/auth-provider';

const RoomOrganizer = dynamic(
  () =>
    import('@/components/room-organizer')
      .then((module) => {
        // Editor chunk loaded — signal the head watchdog and clear the guard.
        clearChunkReloadGuard();
        if (typeof window !== 'undefined') {
          (window as unknown as { __pcReady?: boolean }).__pcReady = true;
        }
        return module.RoomOrganizer;
      })
      .catch((err) => {
        // A returning visitor after a redeploy can load cached HTML whose
        // hashed editor chunk now 404s; next/dynamic would otherwise show the
        // loading fallback forever. Reload once to fetch fresh assets.
        if (reloadOnceForChunkError(err)) {
          // A reload is navigating away — render nothing in the meantime.
          return function ChunkReloading(): null {
            return null;
          };
        }
        throw err; // persistent failure → error boundary (offers a reset)
      }),
  { ssr: false, loading: () => <BootSkeleton /> }
);

/**
 * 打开工作台时的骨架屏（T-VISUAL-2026）。
 * 不再用绿色进度条：进度条既说不出走到了哪，又给「快好了」的假承诺。
 * 这里只是把工作台外壳（顶栏 / 模式轨 / 画布 / 右栏 / 素材架）的形状先摆出来，
 * 用 --plane 块 1.2s 呼吸等插件下载完；文案在角落安静说明状态。
 */
export function BootSkeleton(): JSX.Element {
  return (
    <div className="sc-boot" role="status" aria-live="polite">
      <div className="sc-boot-main" aria-hidden="true">
        <div className="sc-boot-rail">
          <span className="sc-boot-mark" />
          <span className="sc-boot-tile" />
          <span className="sc-boot-tile" />
          <span className="sc-boot-tile" />
          <span className="sc-boot-tile" />
          <span className="sc-boot-rail-foot">
            <span className="sc-boot-tile" />
            <span className="sc-boot-dot" />
          </span>
        </div>
        <div className="sc-boot-canvas" />
        <div className="sc-boot-aside">
          <span className="sc-boot-line" style={{ width: '56%' }} />
          <span className="sc-boot-card" />
          <span className="sc-boot-card" />
          <span className="sc-boot-card sc-boot-card--tall" />
        </div>
      </div>
      <div className="sc-boot-foot">
        <span className="sc-boot-thumb" aria-hidden="true" />
        <span className="sc-boot-thumb" aria-hidden="true" />
        <span className="sc-boot-thumb" aria-hidden="true" />
        <span className="sc-boot-thumb" aria-hidden="true" />
        <p className="sc-boot-note">正在打开幕景工作台</p>
      </div>
    </div>
  );
}

/**
 * 根路径无参数时决定挂哪个项目（2026-11-11 用户拍板；2026-11-22 补本机活动兜底）：
 * - 有最近指针且指向云项目 / 案例副本 / 本机活动 → 续那个 projectId；
 * - 指针缺失、或指向纯起步草稿 `default-outdoor` → 从草稿索引找回最近编辑的本机活动 `house-*`
 *   （空草稿不该把更近编辑过的本机活动短路掉，否则刷新会话槽漂移、历史接不回）；
 * - 都没有 → 新建纯本机默认草稿（`default-outdoor`，起步锚点平湖秋月）。
 * 找场地是工作台里的"搜地点"，不再先跳独立页。
 */
function decideDefaultOutdoorProject(): string {
  return resolveFallbackOutdoorProject();
}

export function WorkspaceShell({ children }: { children: React.ReactNode }): JSX.Element {
  const { controller, ready } = useAuth()!;
  const pathname = usePathname();
  const [editorStarted, setEditorStarted] = useState(false);
  const workspacePath = pathname === '/' || pathname.replace(/\/$/, '') === '/editor';
  const entered = workspacePath && ready;
  // 户外项目判定（P2-a）：与 editorStarted 同批同步判定，户外命中时不挂 RoomOrganizer。
  const [outdoorProjectId, setOutdoorProjectId] = useState<string | null>(null);
  // 换设备找回：本机没有任何草稿、云端却有活动时问一次（只问一次，不打扰）。
  const [recover, setRecover] = useState<AdoptableActivity[] | null>(null);
  const [recoverBusy, setRecoverBusy] = useState<string | null>(null);
  const recoverAskedRef = useRef(false);
  // 采纳云端活动时异地同 id（如都在 default-outdoor）也要让工作台重挂一次，读新记录。
  const [projectEpoch, setProjectEpoch] = useState(0);

  useEffect(() => {
    (window as unknown as { __pcReady?: boolean }).__pcReady = true;
    clearChunkReloadGuard();
    if (!workspacePath || !ready) { setOutdoorProjectId(null); return; }
    // 工作台无任何参数（`/` 或 `/editor` 别名）：续最近户外项目或起步默认户外 2D。
    // 带参进入（登录回跳 ?login=1、?restore=backup、?project=…）视为明确意图。
    if (!window.location.search) {
      // 无参数：续最近指针（云项目 / 案例副本）；指针缺失则找回最近本机活动；都没有才起步默认草稿。
      const fallbackId = decideDefaultOutdoorProject();
      setOutdoorProjectId(current => current ?? fallbackId);
      setEditorStarted(true);
      // 枚举兜底续回的本机活动：把身份写进 URL，二次刷新走带参解析，不依赖最近指针。
      if (fallbackId.startsWith(LOCAL_ACTIVITY_ID_PREFIX)) {
        const url = new URL(window.location.href);
        url.searchParams.set('project', fallbackId);
        url.searchParams.set('mode', 'outdoor');
        window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
      }
      // 2026-11-17：这台设备上什么都没有、云端却有活动 → 问一次要不要接着编。
      // 失败/空列表一律安静退回默认草稿（云端只是副本，不该拦着开工）。
      const fresh = latestOutdoorProjectId() === null && latestLocalActivityRecord() === null;
      if (fresh && controller && !recoverAskedRef.current) {
        recoverAskedRef.current = true;
        void listAdoptableActivities(controller).then(list => {
          if (list.length > 0) setRecover(list);
        });
      }
      return;
    }
    // 带参但无本机草稿（旧链接/登录回跳/恢复备份）也统一落默认地图草稿，不再回退室内壳体。
    const resolvedId = resolveOutdoorProjectId(window.location.search) ?? decideDefaultOutdoorProject();
    setOutdoorProjectId(resolvedId);
    setEditorStarted(true);
    // 兜底枚举到本机活动时同样把身份写进 URL：二次刷新走带参解析，不依赖最近指针与枚举。
    if (resolvedId.startsWith(LOCAL_ACTIVITY_ID_PREFIX)) {
      const url = new URL(window.location.href);
      url.searchParams.set('project', resolvedId);
      url.searchParams.set('mode', 'outdoor');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [workspacePath, ready, pathname, controller]);

  /** 选一份云端活动：拉回整份并落本机，然后直接打开它。 */
  const handleRecoverPick = (activity: AdoptableActivity) => {
    setRecoverBusy(activity.activityId);
    void adoptOutdoorActivity(controller ?? null, activity).then(result => {
      setRecoverBusy(null);
      setRecover(null);
      if (!result) return; // 读不到/不合法：安静留在本机草稿
      setOutdoorProjectId(result.projectId);
      setProjectEpoch(epoch => epoch + 1);
    });
  };

  // 2026-11-17 用户拍板「按不换页改」：面板里换经典案例只换工作台当前项目——
  // 写本机记录由面板负责，这里只换 outdoorProjectId + 重挂画布（与「换设备找回」同一条路径），
  // URL 用 replaceState 跟着走，文档不重载，没有白屏，也不用再走一遍入场骨架。
  useEffect(() => onOutdoorProjectSwitch(projectId => {
    if (!editorStarted) return false; // 工作台还没起来：不接，让调用方整页跳
    const url = new URL(window.location.href);
    url.searchParams.set('project', projectId);
    url.searchParams.set('mode', 'outdoor');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setOutdoorProjectId(projectId);
    setProjectEpoch(epoch => epoch + 1);
    return true;
  }), [editorStarted]);

  useEffect(() => {
    if (entered) window.dispatchEvent(new Event('resize'));
  }, [entered]);

  return <>
    {children}
    {/* Keep briefs, reference photos and proposals alive during login-page round trips. */}
    {/* 所有项目统一挂同一壳体；地图草稿按 outdoorProjectId 落本机 store，右侧常驻唯一地图。 */}
    {editorStarted && (
      <div hidden={!entered}>
        <RoomOrganizer key={projectEpoch} isActive={entered} controller={controller} outdoorProjectId={outdoorProjectId} />
      </div>)}
    {recover && recover.length > 0 && (
      <OutdoorCloudRecover
        activities={recover}
        busyId={recoverBusy}
        onPick={handleRecoverPick}
        onDismiss={() => setRecover(null)}
      />
    )}
  </>;
}
