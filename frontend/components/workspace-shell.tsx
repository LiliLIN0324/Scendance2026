'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  clearChunkReloadGuard,
  reloadOnceForChunkError,
} from '@/components/room-organizer/lib/chunk-reload';
import {
  latestOutdoorProjectId,
  requestsOutdoorMode,
} from '@/components/room-organizer/lib/outdoor-project-store';
import { STORAGE_KEY } from '@/components/room-organizer/lib/constants';
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
 * 户外规划（2026-11-12 用户拍板）：**不再有独立的整页户外工作台**。
 * `?start=outdoor` / `mode=outdoor` 一律进主工作台（RoomOrganizer），
 * 打开即把户外 2D 卡片开到画布上（左轨/右轨/物件库都在主界面里）。
 */
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
 * 「最近活动」判定（`/` 无参数时有最近活动就续上次，没有就直接开户外 2D）：
 * - 本机画布草稿里有物料（室内工作台上次在用）；
 * - 存过户外规划草稿（最近一次户外项目）。
 * 坏草稿 / 存储不可用一律按"没有活动"处理。
 *
 * 找场地是工作台里的能力（搜地点 / 场馆 / 地址），不该挡在入口前面。
 */
function hasRecentActivity(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { floors?: { items?: unknown[] }[] };
      if ((parsed.floors?.[0]?.items?.length ?? 0) > 0) return true;
    }
  } catch {
    // 坏草稿按无活动处理。
  }
  return latestOutdoorProjectId() !== null;
}

export function WorkspaceShell({ children }: { children: React.ReactNode }): JSX.Element {
  const { controller, ready } = useAuth()!;
  const pathname = usePathname();
  const [editorStarted, setEditorStarted] = useState(false);
  const workspacePath = pathname === '/' || pathname.replace(/\/$/, '') === '/editor';
  const entered = workspacePath && ready;
  // 本次打开是否直接进户外 2D（不是独立页：户外卡片开在主工作台画布上）。
  const [startOutdoor, setStartOutdoor] = useState(false);

  useEffect(() => {
    (window as unknown as { __pcReady?: boolean }).__pcReady = true;
    clearChunkReloadGuard();
    if (!workspacePath || !ready) { setStartOutdoor(false); return; }
    // 根路径且没有任何参数：有最近活动就续上次（室内），没有就直接开户外 2D（主工作台内）。
    // 带参进入（登录回跳 ?login=1、?restore=backup、?project=…）视为明确意图。
    if (pathname.replace(/\/$/, '') === '' && !window.location.search) {
      setStartOutdoor(!hasRecentActivity());
      setEditorStarted(true);
      return;
    }
    setStartOutdoor(requestsOutdoorMode(window.location.search));
    setEditorStarted(true);
  }, [workspacePath, ready, pathname]);

  useEffect(() => {
    if (entered) window.dispatchEvent(new Event('resize'));
  }, [entered]);

  return <>
    {children}
    {/* Keep briefs, reference photos and proposals alive during login-page round trips. */}
    {editorStarted && (
      <div hidden={!entered}>
        <RoomOrganizer isActive={entered} controller={controller} startOutdoor={startOutdoor} />
      </div>
    )}
  </>;
}
