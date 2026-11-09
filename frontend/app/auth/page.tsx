'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-provider';
import { useBackendSession } from '@/lib/backend-session';

/** 登录注册已搬进工作台账户浮窗：旧入口保留，只负责带着安全返回目标跳过去。 */
export default function AuthPage(): null {
  const router = useRouter();
  const auth = useAuth()!;
  const cloud = useBackendSession(auth.controller);

  useEffect(() => {
    if (!auth.ready && new URLSearchParams(window.location.hash.replace(/^#/, '')).get('type') === 'recovery') return;
    if (cloud.recoveryReady) {
      router.replace('/reset-password');
      return;
    }
    const next = new URLSearchParams(window.location.search).get('next');
    router.replace(`/?login=1${next ? `&next=${encodeURIComponent(next)}` : ''}`);
  }, [auth.ready, cloud.recoveryReady, router]);

  return null;
}
