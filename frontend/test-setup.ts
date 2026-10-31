import { beforeEach, vi } from 'vitest';
import { clearSupabaseBrowserCookies } from './lib/supabase/client';

// layout.tsx 用 next/font/local 接 Inter 与 Playfair；jsdom 里没有字体管线，mock 成空壳。
vi.mock('next/font/local', () => ({
  default: (options?: { variable?: string }) => {
    const variable = options?.variable ?? '--font-local';
    return { variable, style: { fontFamily: 'var(' + variable + ')' } };
  },
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