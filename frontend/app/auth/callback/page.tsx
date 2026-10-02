'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-provider';
import { useBackendSession } from '@/lib/backend-session';

export default function CallbackPage(): JSX.Element {
  const auth = useAuth()!;
  const cloud = useBackendSession(auth.controller);
  const router = useRouter();
  useEffect(() => {
    if (auth.ready && cloud.recoveryReady) router.replace('/reset-password');
    else if (auth.ready && cloud.user) router.replace('/');
  }, [auth.ready, cloud.user, cloud.recoveryReady, router]);
  return <main className="sc-auth-page"><section className="sc-auth-callback"><h1>幕景 Scendance</h1><p role="status">{auth.error || '正在确认邮箱，准备你的工作室…'}</p>{auth.ready && !cloud.user && <a href="/auth">返回登录</a>}</section></main>;
}
