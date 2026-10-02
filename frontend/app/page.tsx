'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
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
            正在打开场域工作台…
          </p>
          <span className="sc-loading-line" aria-hidden="true" />
        </div>
      </div>
    ),
  }
);

export default function Page(): JSX.Element {
  const auth = useAuth()!;
  const cloud = useBackendSession(auth.controller);
  const router = useRouter();
  useEffect(() => {
    if (auth.ready && !cloud.user) router.replace('/auth?next=%2F');
  }, [auth.ready, cloud.user, router]);
  if (!auth.ready || !cloud.user) return <main className="sc-auth-page"><p role="status">正在打开你的工作室…</p></main>;
  return <RoomOrganizer />;
}
