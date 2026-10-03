'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  clearChunkReloadGuard,
  reloadOnceForChunkError,
} from '@/components/room-organizer/lib/chunk-reload';
import { useAuth } from '@/lib/auth-provider';
import { useBackendSession } from '@/lib/backend-session';

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
  {
    ssr: false,
    loading: () => (
      <div className="pc-world sc-loading-screen">
        <div className="pc-glass sc-loading-card" role="status">
          <p>
            正在打开幕景工作台…
          </p>
          <span className="sc-loading-line" aria-hidden="true" />
        </div>
      </div>
    ),
  }
);

export function WorkspaceShell({ children }: { children: React.ReactNode }): JSX.Element {
  const { controller, ready } = useAuth()!;
  const cloud = useBackendSession(controller);
  const router = useRouter();
  const pathname = usePathname();
  const [editorStarted, setEditorStarted] = useState(false);
  const [localEntry, setLocalEntry] = useState(false);
  const entered = pathname === '/' && ready && (!!cloud.user || localEntry);

  useEffect(() => {
    (window as unknown as { __pcReady?: boolean }).__pcReady = true;
    clearChunkReloadGuard();
    if (pathname !== '/' || !ready) return;
    if (cloud.user || new URLSearchParams(window.location.search).get('local') === '1') {
      setLocalEntry(true);
      setEditorStarted(true);
    } else router.replace('/auth');
  }, [pathname, ready, cloud.user, router]);

  useEffect(() => {
    if (entered) window.dispatchEvent(new Event('resize'));
  }, [entered]);

  return <>
    {process.env.NEXT_PUBLIC_LOCAL_FIXTURE === '1' && <aside role="status" style={{position:'fixed',bottom:4,left:'50%',transform:'translateX(-50%)',zIndex:10000,padding:'4px 10px',borderRadius:6,background:'#283f36',color:'#fff',fontSize:11,pointerEvents:'none'}}>独立本地预览 · 测试账号与本地数据库</aside>}
    {children}
    {/* Keep briefs, reference photos and proposals alive during login-page round trips. */}
    {editorStarted && <div hidden={!entered}>
      <RoomOrganizer isActive={entered} controller={controller} />
    </div>}
  </>;
}
