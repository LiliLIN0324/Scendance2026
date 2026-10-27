import { beforeEach, vi } from 'vitest';
import { clearSupabaseBrowserCookies } from './lib/supabase/client';

// layout.tsx 用 next/font/google 接 Inter 与思源黑体；jsdom 里没有字体管线，mock 成空壳。
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter', style: { fontFamily: 'var(--font-inter)' } }),
  Noto_Sans_SC: () => ({ variable: '--font-noto-sc', style: { fontFamily: 'var(--font-noto-sc)' } }),
}));

beforeEach(() => {
  clearSupabaseBrowserCookies();
  if (typeof document !== 'undefined') {
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.split('=')[0]?.trim();
      if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  }
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  if (typeof localStorage !== 'undefined') localStorage.clear();
});