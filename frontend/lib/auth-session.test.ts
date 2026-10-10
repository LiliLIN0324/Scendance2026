// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { safeReturnPath } from './auth-provider';
import { BackendSession, getBackendConfig } from './backend-session';

const config = getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'public-test' });
const auth = { access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-test', email: 'test@example.com' } };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { sessionStorage.clear(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

it('restores a verified session after reload without reusing the editor lease identity', async () => {
  const first = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response(auth));
  await first.signIn('test@example.com', 'test-password');
  const oldId = first.getSnapshot().sessionId;
  first.dispose();
  const second = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response(auth.user));
  await second.restoreSession();
  expect(String(fetchMock.mock.calls[1][0])).toBe(`${config.url}/auth/v1/user`);
  expect(second.getSnapshot()).toMatchObject({ user: auth.user, lease: null, status: 'ready' });
  expect(second.getSnapshot().sessionId).not.toBe(oldId);
  fetchMock.mockResolvedValueOnce(response({}));
  await second.signOut();
  expect(sessionStorage.length).toBe(0);
});

it('rejects revoked cookie sessions after Auth verification', async () => {
  const first = new BackendSession(config);
  fetchMock.mockResolvedValueOnce(response(auth));
  await first.signIn('test@example.com', 'test-password');
  fetchMock.mockResolvedValueOnce(response({}, 401));
  const reopened = new BackendSession(config);
  await reopened.restoreSession();
  expect(reopened.getSnapshot().user).toBeNull();
  expect(reopened.getSnapshot().writeBlocked).toBe(true);
  first.dispose();
  reopened.dispose();
});

it('refreshes an expired cookie session and waits for confirmation after signup', async () => {
  const session = new BackendSession(config);
  fetchMock.mockResolvedValueOnce(response({ ...auth, expires_in: 1 }));
  await session.signIn('test@example.com', 'test-password');
  fetchMock.mockResolvedValueOnce(response(auth));
  fetchMock.mockResolvedValueOnce(response([]));
  await session.listProjects();
  expect(String(fetchMock.mock.calls[1][0])).toContain('grant_type=refresh_token');
  expect(session.getSnapshot().user).toEqual(auth.user);
  const signup = new BackendSession(config);
  fetchMock.mockResolvedValueOnce(response({ id: 'new-user' }));
  expect(await signup.signUp('new@example.com', 'long-test-password', '新人', 'https://app.example/auth/callback')).toBe(false);
  expect(signup.getSnapshot().user).toBeNull();
  session.dispose();
  signup.dispose();
});

it('rejects external and recursive return destinations', () => {
  for (const value of ['//evil.example', '/\\evil.example', 'https://evil.example', '/auth/callback', '/reset-password', null]) expect(safeReturnPath(value)).toBe('/');
  expect(safeReturnPath('/?scene=1#view')).toBe('/?scene=1#view');
});

it('restores the same guest identity after reload and reuses it without another signup', async () => {
  const guest = { ...auth, user: { id: 'guest-test', is_anonymous: true } };
  const first = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response(guest));
  await first.signInAsGuest();
  first.dispose();
  const second = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response(guest.user));
  await second.restoreSession();
  expect(await second.signInAsGuest()).toEqual(guest.user);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  second.dispose();
});

it('does not let a late guest response restore a signed-out identity', async () => {
  const session = new BackendSession(config, sessionStorage);
  let complete!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const pending = session.signInAsGuest();
  await session.signOut();
  complete(response({ ...auth, user: { id: 'guest-test', is_anonymous: true } }));
  await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(session.getSnapshot().user).toBeNull();
  expect(sessionStorage.length).toBe(0);
  session.dispose();
});
