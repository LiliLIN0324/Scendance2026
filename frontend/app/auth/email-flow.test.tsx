// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/lib/auth-provider';
import { BackendSession, createBackendSession, getBackendConfig } from '@/lib/backend-session';
import ResetPasswordPage from '../reset-password/page';
import CallbackPage from './callback/page';
import AuthPage from './page';

const navigation = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));
vi.mock('@/lib/backend-session', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/backend-session')>(), createBackendSession: vi.fn() }));
const fetchMock = vi.fn<typeof fetch>();
const auth = { access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-test' } };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let controller: BackendSession;
beforeEach(() => {
  window.history.replaceState(null, '', '/auth');
  sessionStorage.clear(); fetchMock.mockReset(); navigation.replace.mockReset(); navigation.push.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'public-test' }), sessionStorage);
  vi.mocked(createBackendSession).mockReturnValue(controller);
});
afterEach(() => { cleanup(); controller.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('sends the legacy login route into the workspace with a login hint', async () => {
  render(<AuthProvider><AuthPage /></AuthProvider>);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/?login=1'));
});

it('completes recovery without redirecting to the editor and checks password confirmation', async () => {
  window.history.replaceState(null, '', '/reset-password');
  render(<AuthProvider><ResetPasswordPage /></AuthProvider>);
  fireEvent.change(screen.getByLabelText('注册邮箱'), { target: { value: 'test@example.com' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '发送重置邮件' }).hasAttribute('disabled')).toBe(false));
  fetchMock.mockResolvedValueOnce(response({}));
  fireEvent.click(screen.getByRole('button', { name: '发送重置邮件' }));
  expect((await screen.findByRole('status')).textContent).toContain('如果该邮箱已注册');
  fetchMock.mockResolvedValueOnce(response(auth));
  fireEvent.change(screen.getByLabelText('六位验证码'), { target: { value: '012345' } });
  fireEvent.click(screen.getByRole('button', { name: '验证邮箱' }));
  await screen.findByLabelText('新密码');
  expect(controller.getSnapshot().user).toBeNull();
  expect(navigation.replace).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'a-new-long-password' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'a-different-password' } });
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  expect((await screen.findByRole('alert')).textContent).toContain('两次输入的密码不一致');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockResolvedValueOnce(response(auth.user)).mockResolvedValueOnce(new Response(null, { status: 204 }));
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'a-new-long-password' } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'a-new-long-password' } });
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  await screen.findByRole('heading', { name: '密码已更新' });
  expect(screen.queryByLabelText('新密码')).toBeNull();
  expect(sessionStorage.length).toBe(0);
});

it('supports an existing code after reload and blocks immediate repeat sends', async () => {
  render(<AuthProvider><ResetPasswordPage /></AuthProvider>);
  fireEvent.change(screen.getByLabelText('注册邮箱'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: '输入已有验证码' }));
  await screen.findByLabelText('六位验证码');
  const resend = screen.getByRole('button', { name: /重新发送邮件|秒后可重新发送/ });
  await waitFor(() => expect((resend as HTMLButtonElement).disabled).toBe(false));
  fetchMock.mockResolvedValueOnce(response({}));
  fireEvent.click(resend);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  fireEvent.click(resend);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('strips recovery credentials from the URL before routing the old callback to password reset', async () => {
  window.history.replaceState(null, '', '/auth/callback#access_token=access-test&refresh_token=refresh-test&expires_in=3600&type=recovery');
  fetchMock.mockResolvedValueOnce(response(auth.user));
  render(<AuthProvider><CallbackPage /></AuthProvider>);
  await waitFor(() => expect(window.location.hash).toBe(''));
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/reset-password'));
  expect(controller.getSnapshot().user).toBeNull();
});

it('routes a recovery link landing on the workspace to password reset without signing in', async () => {
  window.history.replaceState(null, '', '/#access_token=access-test&refresh_token=refresh-test&expires_in=3600&type=recovery');
  render(<AuthProvider><div>工作台</div></AuthProvider>);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/reset-password'));
  expect(window.location.hash).toBe('');
  expect(controller.getSnapshot()).toMatchObject({ user: null, recoveryReady: true });
});

it('recognizes a recovery link when the browser session client is created after landing', async () => {
  controller.dispose();
  window.history.replaceState(null, '', '/#access_token=access-test&refresh_token=refresh-test&expires_in=3600&type=recovery');
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'public-test' }), sessionStorage);
  vi.mocked(createBackendSession).mockReturnValue(controller);
  render(<AuthProvider><div>工作台</div></AuthProvider>);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/reset-password'));
  expect(controller.getSnapshot()).toMatchObject({ user: null, recoveryReady: true, writeBlocked: true });
  expect(window.location.hash).toBe('');
});

it('keeps a recovery link on the legacy login route out of ordinary login navigation', async () => {
  window.history.replaceState(null, '', '/auth#access_token=access-test&refresh_token=refresh-test&expires_in=3600&type=recovery');
  render(<AuthProvider><AuthPage /></AuthProvider>);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/reset-password'));
  expect(navigation.replace).not.toHaveBeenCalledWith('/?login=1');
  expect(window.location.hash).toBe('');
  expect(controller.getSnapshot()).toMatchObject({ user: null, recoveryReady: true });
});

it('does not restore an ordinary session from an incomplete recovery link', async () => {
  window.history.replaceState(null, '', '/#type=recovery');
  const restore = vi.spyOn(controller, 'restoreSession');
  render(<AuthProvider><div>工作台</div></AuthProvider>);
  await waitFor(() => expect(window.location.hash).toBe(''));
  expect(restore).not.toHaveBeenCalled();
  expect(controller.getSnapshot().user).toBeNull();
  expect(navigation.replace).not.toHaveBeenCalledWith('/reset-password');
});

it('treats a code callback landing on reset-password as recovery, not a normal signed-in session', async () => {
  window.history.replaceState(null, '', '/reset-password?code=synthetic-code');
  const internal = controller as unknown as { supabase: { auth: { getSession: () => Promise<unknown> } } };
  vi.spyOn(internal.supabase.auth, 'getSession').mockResolvedValue({ data: { session: auth }, error: null });
  render(<AuthProvider><ResetPasswordPage /></AuthProvider>);
  await screen.findByLabelText('新密码');
  expect(controller.getSnapshot()).toMatchObject({ user: null, recoveryReady: true, writeBlocked: true });
  expect(window.location.search).toBe('');
  expect(navigation.replace).not.toHaveBeenCalledWith('/');
});

it('sends a reset link pointing directly to recovery and explains both email forms', async () => {
  window.history.replaceState(null, '', '/reset-password');
  render(<AuthProvider><ResetPasswordPage /></AuthProvider>);
  fireEvent.change(screen.getByLabelText('注册邮箱'), { target: { value: 'test@example.com' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '发送重置邮件' }).hasAttribute('disabled')).toBe(false));
  fetchMock.mockResolvedValueOnce(response({}));
  fireEvent.click(screen.getByRole('button', { name: '发送重置邮件' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  expect(String(fetchMock.mock.calls[0]![0])).toContain(`redirect_to=${encodeURIComponent(`${window.location.origin}/reset-password`)}`);
  expect(await screen.findByText(/点击邮件中的重置链接/)).toBeTruthy();
  expect(screen.getByLabelText('六位验证码')).toBeTruthy();
});

it.each([
  ['/auth', '/?login=1'],
  ['/auth?next=%2F', '/?login=1&next=%2F'],
  ['/auth?next=%2Fprojects%3Fview%3Drecent%23saved', '/?login=1&next=%2Fprojects%3Fview%3Drecent%23saved'],
  ['/auth?next=https%3A%2F%2Fevil.example', '/?login=1&next=https%3A%2F%2Fevil.example'],
  ['/auth?next=%2Fauth', '/?login=1&next=%2Fauth'],
])('forwards %s to the workspace login hint, leaving the destination to the login gate', async (path, target) => {
  window.history.replaceState(null, '', path);
  render(<AuthProvider><AuthPage /></AuthProvider>);
  await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(target));
  expect(navigation.push).not.toHaveBeenCalled();
});
