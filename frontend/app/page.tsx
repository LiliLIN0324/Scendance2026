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
      {!entered && <IntroPage controller={controller} onEnter={enterEditor} />}
      {/* Keep in-progress briefs, image URLs, chat and proposals in memory when
          returning to the introduction. The editor still mounts only on entry. */}
      {editorStarted && (
        <div hidden={!entered}>
          <RoomOrganizer isActive={entered} controller={controller} onShowIntro={() => setEntered(false)} />
        </div>
      )}
    </>
  );
}
