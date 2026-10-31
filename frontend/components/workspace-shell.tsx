'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  clearChunkReloadGuard,
  reloadOnceForChunkError,
} from '@/components/room-organizer/lib/chunk-reload';
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

export function WorkspaceShell({ children }: { children: React.ReactNode }): JSX.Element {
  const { controller, ready } = useAuth()!;
  const pathname = usePathname();
  const [editorStarted, setEditorStarted] = useState(false);
  const workspacePath = pathname === '/' || pathname.replace(/\/$/, '') === '/editor';
  const entered = workspacePath && ready;

  useEffect(() => {
    (window as unknown as { __pcReady?: boolean }).__pcReady = true;
    clearChunkReloadGuard();
    if (!workspacePath || !ready) return;
    setEditorStarted(true);
  }, [workspacePath, ready]);

  useEffect(() => {
    if (entered) window.dispatchEvent(new Event('resize'));
  }, [entered]);

  return <>
    {/* 本机预览标记：贴在顶栏，浮在底部会压住物料抽屉。 */}
    {process.env.NEXT_PUBLIC_LOCAL_FIXTURE === '1' && <aside role="status" style={{position:'fixed',top:17,left:'50%',transform:'translateX(-50%)',zIndex:10000,padding:'3px 9px',borderRadius:6,background:'#283f36',color:'#fff',fontSize:11,pointerEvents:'none'}}>独立本地预览 · 测试账号与本地数据库</aside>}
    {children}
    {/* Keep briefs, reference photos and proposals alive during login-page round trips. */}
    {editorStarted && <div hidden={!entered}>
      <RoomOrganizer isActive={entered} controller={controller} />
    </div>}
  </>;
}
