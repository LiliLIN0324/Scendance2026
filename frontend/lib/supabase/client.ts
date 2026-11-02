'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const memoryCookies = new Map<string, string>();

export function clearSupabaseBrowserCookies(): void {
  memoryCookies.clear();
  if (typeof document === 'undefined') return;
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name?.startsWith('sb-')) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}

export function createSupabaseBrowserClient(url: string, publishableKey: string): SupabaseClient {
  return createBrowserClient(url, publishableKey, {
    isSingleton: process.env.NODE_ENV !== 'test',
    auth: {
      autoRefreshToken: false,
    },
    ...(typeof document === 'undefined' ? {
      cookies: {
        getAll: () => Array.from(memoryCookies, ([name, value]) => ({ name, value })),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) memoryCookies.set(name, value);
        },
      },
    } : {}),
    cookieOptions: {
      path: '/',
      sameSite: 'lax',
      // 持久登录：Supabase 的 auth cookie 默认是会话 cookie，关掉浏览器就消失。
      // 给 90 天寿命，只要 refresh token 还有效（默认不轮换过期），开新浏览器仍是登录态。
      maxAge: 60 * 60 * 24 * 90,
      secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    },
    global: {
      fetch: (input, init) => globalThis.fetch(input, init),
    },
  });
}