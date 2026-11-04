'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** 登录注册已搬进工作台账户浮窗：旧入口保留，只负责带着安全返回目标跳过去。 */
export default function AuthPage(): null {
  const router = useRouter();

  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get('next');
    router.replace(`/?login=1${next ? `&next=${encodeURIComponent(next)}` : ''}`);
  }, [router]);

  return null;
}
