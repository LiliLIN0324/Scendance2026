// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from './backend-session';

const config = getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'public-test' });
const auth = { access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-test' } };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => { sessionStorage.clear(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

it('verifies signup with its own OTP purpose and persists only the confirmed session', async () => {
  const session = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response(auth));
  await session.verifyEmailCode(' test@example.com ', '012345', 'signup');
  expect(String(fetchMock.mock.calls[0][0])).toBe(`${config.url}/auth/v1/verify`);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ email: 'test@example.com', token: '012345', type: 'signup' });
  expect(session.getSnapshot().user).toEqual(auth.user);
  expect(document.cookie).toContain('sb-example-auth-token');
});

it('keeps recovery credentials separate from editor login until password change', async () => {
  const session = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response(auth));
  await session.verifyEmailCode('test@example.com', '012345', 'recovery');
  expect(session.getSnapshot()).toMatchObject({ user: null, recoveryReady: true, writeBlocked: true });

  await expect(session.listStudios()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  fetchMock.mockResolvedValueOnce(response(auth.user)).mockResolvedValueOnce(new Response(null, { status: 204 }));
  expect(await session.updatePassword('a-new-long-password')).toEqual({ signedOutEverywhere: true });
  expect(fetchMock.mock.calls[1]).toEqual([`${config.url}/auth/v1/user`, expect.objectContaining({ method: 'PUT', body: JSON.stringify({ password: 'a-new-long-password' }), headers: expect.objectContaining({ Authorization: 'Bearer access-test' }) })]);
  expect(String(fetchMock.mock.calls[2][0])).toContain('/logout?scope=global');
  expect(session.getSnapshot()).toMatchObject({ user: null, recoveryReady: false, status: 'signed_out' });
  await expect(session.updatePassword('another-long-password')).rejects.toThrow('重新获取验证码');
});

it('does not update a password with an ordinary signed-in session or an invalid OTP', async () => {
  const session = new BackendSession(config);
  fetchMock.mockResolvedValueOnce(response(auth));
  await session.signIn('test@example.com', 'a-long-password');
  await expect(session.updatePassword('a-new-long-password')).rejects.toThrow('重新获取验证码');
  for (const code of ['12345', '1234567', 'abcdef']) await expect(session.verifyEmailCode('test@example.com', code, 'recovery')).rejects.toThrow('六位');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('reports expired codes, throttling, and repeated passwords without echoing server details', async () => {
  const session = new BackendSession(config);
  fetchMock.mockResolvedValueOnce(response({ code: 'otp_expired', msg: 'sensitive-server-detail' }, 403));
  await expect(session.verifyEmailCode('test@example.com', '123456', 'signup')).rejects.toThrow('验证码已失效');
  expect(session.getSnapshot().user).toBeNull();
  fetchMock.mockResolvedValueOnce(response({ code: 'over_email_send_rate_limit' }, 429));
  await expect(session.resendSignup('test@example.com', 'https://app.example/auth/callback')).rejects.toThrow('过于频繁');
  fetchMock.mockResolvedValueOnce(response(auth));
  await session.verifyEmailCode('test@example.com', '123456', 'recovery');
  fetchMock.mockResolvedValueOnce(response({ code: 'same_password' }, 422));
  await expect(session.updatePassword('same-long-password')).rejects.toThrow('不能与旧密码相同');
  expect(session.getSnapshot().recoveryReady).toBe(true);
});

it('uses the recovery endpoint and treats a missing user like a successful request', async () => {
  const session = new BackendSession(config);
  fetchMock.mockResolvedValueOnce(response({ code: 'user_not_found' }, 404));
  await session.requestPasswordReset(' missing@example.com ', 'https://app.example/reset-password');
  expect(String(fetchMock.mock.calls[0][0])).toBe(`${config.url}/auth/v1/recover?redirect_to=https%3A%2F%2Fapp.example%2Freset-password`);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ email: 'missing@example.com' });
  expect(session.getSnapshot()).toMatchObject({ user: null, recoveryReady: false });
});

it('rejects malformed verification responses and responses arriving after signout', async () => {
  const session = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response({ user: auth.user }));
  await expect(session.verifyEmailCode('test@example.com', '123456', 'signup')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = session.verifyEmailCode('test@example.com', '123456', 'recovery');
  await session.signOut();
  finish(response(auth));
  await expect(pending).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  expect(session.getSnapshot().recoveryReady).toBe(false);

});

it('accepts legacy recovery links without exposing a normal editor session', async () => {
  const session = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response(auth.user));
  await session.acceptCallback('#access_token=access-test&refresh_token=refresh-test&expires_in=3600&type=recovery');
  expect(session.getSnapshot()).toMatchObject({ user: null, recoveryReady: true });

});

it('reports global signout failure separately from a successful password change', async () => {
  const session = new BackendSession(config, sessionStorage);
  fetchMock.mockResolvedValueOnce(response(auth));
  await session.verifyEmailCode('test@example.com', '123456', 'recovery');
  fetchMock.mockResolvedValueOnce(response(auth.user)).mockResolvedValueOnce(response({}, 500));
  expect(await session.updatePassword('a-new-long-password')).toEqual({ signedOutEverywhere: false });
  expect(session.getSnapshot()).toMatchObject({ user: null, recoveryReady: false });

});

it('can discard an expired recovery session and requires another verification', async () => {
  const session = new BackendSession(config);
  fetchMock.mockResolvedValueOnce(response({ ...auth, expires_in: 1 }));
  await session.verifyEmailCode('test@example.com', '123456', 'recovery');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
  await expect(session.updatePassword('a-new-long-password')).rejects.toThrow('重新获取验证码');
  vi.restoreAllMocks();
  session.clearPasswordRecovery();
  expect(session.getSnapshot().recoveryReady).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
