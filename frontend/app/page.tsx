'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { IntroPage } from '@/components/intro/intro-page';
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

export default function Page(): JSX.Element {
  const { controller } = useAuth()!;
  const [entered, setEntered] = useState(false);
  const [editorStarted, setEditorStarted] = useState(false);
  useEffect(() => {
    // The landing page is ready before the optional editor chunk is requested.
    // Clear the static-export watchdog so reading the introduction cannot reload it.
    (window as unknown as { __pcReady?: boolean }).__pcReady = true;
    clearChunkReloadGuard();
  }, []);

  useEffect(() => {
    if (entered) window.dispatchEvent(new Event('resize'));
  }, [entered]);

  function enterEditor(): void {
    setEditorStarted(true);
    setEntered(true);
  }

  return (
    <>
      {process.env.NEXT_PUBLIC_LOCAL_FIXTURE === '1' && <aside role="status" style={{position:'fixed',bottom:4,left:'50%',transform:'translateX(-50%)',zIndex:10000,padding:'4px 10px',borderRadius:6,background:'#283f36',color:'#fff',fontSize:11,pointerEvents:'none'}}>独立本地预览 · 测试账号与本地数据库</aside>}
      {!entered && <IntroPage controller={controller} onEnter={enterEditor} />}
      {/* The editor mounts on first entry and stays mounted; reopening the landing
          page needs a fresh load of / (the header logo opens the 官网 instead). */}
      {editorStarted && (
        <div hidden={!entered}>
          <RoomOrganizer isActive={entered} controller={controller} />
        </div>
      )}
    </>
  );
}
