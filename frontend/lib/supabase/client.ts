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
    },
    global: {
      fetch: (input, init) => globalThis.fetch(input, init),
    },
  });
}