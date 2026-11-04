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
  await waitFor(() => expect(screen.getByRole('button', { name: '发送验证码' }).hasAttribute('disabled')).toBe(false));
  fetchMock.mockResolvedValueOnce(response({}));
  fireEvent.click(screen.getByRole('button', { name: '发送验证码' }));
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
  const resend = screen.getByRole('button', { name: /重新发送验证码|秒后可重新发送/ });
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
