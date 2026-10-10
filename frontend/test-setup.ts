import { beforeEach } from 'vitest';
import { clearSupabaseBrowserCookies } from './lib/supabase/client';

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