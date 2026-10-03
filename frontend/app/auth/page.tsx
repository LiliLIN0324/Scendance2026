'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { safeReturnPath } from '@/lib/auth-provider';

export default function AuthPage(): JSX.Element {
  const router = useRouter();
  useEffect(() => {
    const next = safeReturnPath(new URLSearchParams(window.location.search).get('next'));
    router.replace(`${next === '/' ? '/' : `/?next=${encodeURIComponent(next)}`}#sign-in`);
  }, [router]);
  return <main className="sc-auth-page"><p role="status">正在打开登录入口…</p><Link href="/#sign-in">前往登录</Link></main>;
}
