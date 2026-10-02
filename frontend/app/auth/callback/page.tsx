'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BrandMark } from '@/components/brand-mark';
import { createBackendSession, useBackendSession } from '@/lib/backend-session';
import '../auth.css';

/**
 * Where the sign-up confirmation link lands (#auth). Supabase returns the session in the URL
 * hash, so this route consumes it, lets the controller persist it to sessionStorage, then
 * forwards to the app. Keeping the hash out of the address bar is deliberate: it holds tokens.
 */
export default function AuthCallbackPage(): JSX.Element {
  const [controller] = useState(() => createBackendSession());
  const [error, setError] = useState('');
  const started = useRef(false);
  const cloud = useBackendSession(controller);
  const router = useRouter();

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const hash = window.location.hash;
    window.history.replaceState(null, '', window.location.pathname);
    void controller.acceptCallback(hash)
      .catch((thrown: unknown) => setError(thrown instanceof Error ? thrown.message : '登录验证失败，请重试。'));
  }, [controller]);

  useEffect(() => {
    if (cloud.user) router.replace('/');
  }, [cloud.user, router]);

  return <main className="sc-auth-page">
    <section className="sc-auth-card">
      <div className="sc-auth-mark" aria-hidden="true"><BrandMark size={22} /></div>
      <h1>幕景 Scendance</h1>
      <p className="sc-auth-status" role={error ? 'alert' : 'status'}>
        {error || (cloud.user ? '已验证，正在进入工作台…' : '正在确认邮箱，准备你的工作室…')}
      </p>
      {error && <Link href="/">返回介绍页</Link>}
    </section>
  </main>;
}
