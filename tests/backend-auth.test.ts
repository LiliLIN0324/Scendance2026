import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackend } from '../supabase/functions/_shared/backend.ts';

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth }) }));
const backend = () => createBackend(key => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-test' }[key]));
afterEach(() => vi.resetAllMocks());

describe('workbench authenticated guest access', () => {
  it('accepts a verified anonymous user with its own actor identity', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'guest-identity', is_anonymous: true } }, error: null });
    expect(await backend().user('guest-token')).toBe('guest-identity');
    expect(auth.getUser).toHaveBeenCalledWith('guest-token');
  });
  it('still rejects a missing or invalid signed user session', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid token') });
    await expect(backend().user('invalid')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
