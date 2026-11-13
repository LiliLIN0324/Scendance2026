// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { clearSupabaseBrowserCookies } from '@/lib/supabase/client';
import { AuthCard } from './auth-card';

const mockFetch = vi.fn<typeof fetch>();
const sessions: BackendSession[] = [];

function controller(configured = true): BackendSession {
  const session = new BackendSession(getBackendConfig(configured
    ? { url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }
    : { url: '', anonKey: '' }));
  sessions.push(session);
  return session;
}

function submitCredentials(): void {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'editor@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password-only' } });
  fireEvent.click(screen.getByRole('button', { name: '登录并进入工作台' }));
}

beforeEach(() => {
  // @supabase/ssr 把会话落在 document.cookie 上：跨用例残留会让下一个 client 先走恢复流程，
  // 打乱 mockFetch 的响应队列，所以每个用例都从干净的存储开始。
  clearSupabaseBrowserCookies();
  window.localStorage.clear();
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllGlobals();
});

describe('account login card', () => {
  it('keeps the fields usable but the submit inert when the backend is unconfigured', () => {
    const session = controller(false);
    render(<AuthCard controller={session} onAuthenticated={vi.fn()} />);
    expect((screen.getByRole('button', { name: '登录并进入工作台' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('密码') as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'editor@example.com' } });
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('editor@example.com');
    expect(screen.getByRole('status').textContent).toContain('登录服务尚未配置');
    // 工作台已经在眼前，浮窗里不再需要「先体验本地工作台」。
    expect(screen.queryByRole('button', { name: '先体验本地工作台' })).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses the actual Auth contract and only authenticates after success', async () => {
    const session = controller();
    const onAuthenticated = vi.fn();
    let complete!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render(<AuthCard controller={session} onAuthenticated={onAuthenticated} />);
    submitCredentials();
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '正在登录…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('form', { name: '工作室登录' }).getAttribute('aria-busy')).toBe('true');
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '访客进入' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('form', { name: '工作室登录' }));
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://example.supabase.co/auth/v1/token?grant_type=password');
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toMatchObject({ email: 'editor@example.com', password: 'test-password-only' });
    await act(async () => {
      complete(new Response(JSON.stringify({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'editor-id', email: 'editor@example.com' } }), { status: 200 }));
    });
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(session.getSnapshot().user?.email).toBe('editor@example.com');
  });

  it('reports invalid credentials and stays on the form', async () => {
    const session = controller();
    const onAuthenticated = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    render(<AuthCard controller={session} onAuthenticated={onAuthenticated} />);
    submitCredentials();
    expect((await screen.findByRole('alert')).textContent).toBe('邮箱或密码不正确。');
    expect(onAuthenticated).not.toHaveBeenCalled();
    expect(session.getSnapshot().user).toBeNull();
    expect((screen.getByRole('button', { name: '登录并进入工作台' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('allows a retry after a network failure without manufacturing a session', async () => {
    const session = controller();
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<AuthCard controller={session} onAuthenticated={vi.fn()} />);
    submitCredentials();
    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法连接登录服务');
    expect(screen.getByRole('form', { name: '工作室登录' }).getAttribute('aria-busy')).toBe('false');
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('editor@example.com');
    expect(session.getSnapshot().user).toBeNull();
  });

  it('recovers from a malformed login response and clears the error on a successful retry', async () => {
    const session = controller();
    const onAuthenticated = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    render(<AuthCard controller={session} onAuthenticated={onAuthenticated} />);
    submitCredentials();
    expect((await screen.findByRole('alert')).textContent).toBe('登录服务暂时无法完成验证，请稍后重试。');
    expect(session.getSnapshot().user).toBeNull();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'editor-id', email: 'editor@example.com' } }), { status: 200 }));
    submitCredentials();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
    expect(session.getSnapshot().user?.email).toBe('editor@example.com');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

it('registers and verifies an email inside the card before authenticating', async () => {
  const session = controller();
  const onAuthenticated = vi.fn();
  render(<AuthCard controller={session} onAuthenticated={onAuthenticated} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign up · 注册' }));
  fireEvent.change(screen.getByLabelText('如何称呼你'), { target: { value: '测试创作者' } });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-long-password' } });
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-user' })));
  fireEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await screen.findByLabelText('六位验证码');
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('密码')).toBeNull();
  expect(screen.getByRole('button', { name: /秒后可重新发送/ }).hasAttribute('disabled')).toBe(true);
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'otp_expired' }), { status: 403 }));
  fireEvent.change(screen.getByLabelText('六位验证码'), { target: { value: '012345' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并进入工作台' }));
  expect((await screen.findByRole('alert')).textContent).toContain('验证码已失效');
  expect(onAuthenticated).not.toHaveBeenCalled();
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'new-user' } })));
  fireEvent.click(screen.getByRole('button', { name: '验证并进入工作台' }));
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
});

it('switches modes in place, preserves email and clears passwords and errors', async () => {
  render(<AuthCard controller={controller()} onAuthenticated={vi.fn()} />);
  mockFetch.mockResolvedValueOnce(new Response('{}', { status: 400 }));
  submitCredentials();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Sign up · 注册' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('editor@example.com');
  expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe('');
  expect(screen.getByLabelText('密码').getAttribute('minlength')).toBe('12');
  fireEvent.click(screen.getByRole('button', { name: '输入已有验证码' }));
  expect(screen.getByLabelText('六位验证码')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '修改邮箱' }));
  expect(screen.getByLabelText('邮箱')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in · 登录' }));
  expect(screen.queryByLabelText('如何称呼你')).toBeNull();
  expect(screen.getByRole('link', { name: '忘记密码？' }).getAttribute('href')).toBe('/reset-password');
});

it('creates a real guest session before reporting authentication', async () => {
  const session = controller();
  const onAuthenticated = vi.fn();
  let complete!: (response: Response) => void;
  mockFetch.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  render(<AuthCard controller={session} onAuthenticated={onAuthenticated} />);
  fireEvent.click(screen.getByRole('button', { name: '访客进入' }));
  expect(screen.getByRole('button', { name: '正在进入…' }).hasAttribute('disabled')).toBe(true);
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledOnce();
  expect(mockFetch.mock.calls[0][0]).toBe('https://example.supabase.co/auth/v1/signup');
  expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body))).toMatchObject({ data: { display_name: '访客' } });
  await act(async () => complete(new Response(JSON.stringify({ access_token: 'guest-access', refresh_token: 'guest-refresh', expires_in: 3600, user: { id: 'guest-id', is_anonymous: true } }))));
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
  expect(session.getSnapshot().user).toMatchObject({ id: 'guest-id', is_anonymous: true });
});

it.each(['network', 'malformed'])('keeps guest entry retryable after a %s failure without a fake login', async failure => {
  const session = controller();
  const onAuthenticated = vi.fn();
  if (failure === 'network') mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  else mockFetch.mockResolvedValueOnce(new Response('{}'));
  render(<AuthCard controller={session} onAuthenticated={onAuthenticated} />);
  fireEvent.click(screen.getByRole('button', { name: '访客进入' }));
  expect((await screen.findByRole('alert')).textContent).toContain('暂时无法创建访客会话');
  expect(session.getSnapshot().user).toBeNull();
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '访客进入' }).hasAttribute('disabled')).toBe(false);
});

describe('demo credentials in the account card', () => {
  const demo = { email: 'demo@scendance.example', password: 'demo-only-2026' };

  it('shows the pair and fills the form with one tap', async () => {
    const session = controller();
    const onAuthenticated = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'demo-access', refresh_token: 'demo-refresh', expires_in: 3600, user: { id: 'demo-id', email: demo.email } })));
    render(<AuthCard controller={session} onAuthenticated={onAuthenticated} demoAccount={demo} />);
    expect(screen.getByRole('group', { name: '演示账号' }).textContent).toContain(demo.email);
    fireEvent.click(screen.getByRole('button', { name: '填入' }));
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe(demo.email);
    expect((screen.getByLabelText('密码') as HTMLInputElement).value).toBe(demo.password);
    fireEvent.click(screen.getByRole('button', { name: '登录并进入工作台' }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
  });

  it('stays out of the card when the build has no demo account', () => {
    render(<AuthCard controller={controller()} onAuthenticated={vi.fn()} />);
    expect(screen.queryByRole('group', { name: '演示账号' })).toBeNull();
  });
});

it('waits for session restoration before allowing credentials to be submitted', () => {
  render(<AuthCard controller={controller()} onAuthenticated={vi.fn()} ready={false} />);
  expect(screen.getByRole('button', { name: '正在恢复会话…' }).hasAttribute('disabled')).toBe(true);
  fireEvent.submit(screen.getByRole('form', { name: '工作室登录' }));
  expect(mockFetch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '访客进入' }).hasAttribute('disabled')).toBe(true);
});

describe('already signed in', () => {
  it('shows the restored account and enters the workspace without a password field', () => {
    const session = controller();
    const onEnter = vi.fn();
    const live = session.getSnapshot();
    vi.spyOn(session, 'getSnapshot').mockReturnValue({ ...live, user: { id: 'editor-id', email: 'editor@example.com' } as unknown as typeof live.user });
    render(<AuthCard controller={session} onAuthenticated={vi.fn()} onEnter={onEnter} />);
    expect(screen.queryByLabelText('密码')).toBeNull();
    expect(screen.queryByLabelText('邮箱')).toBeNull();
    expect(screen.getByText('editor@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '进入工作台' }));
    expect(onEnter).toHaveBeenCalledOnce();
  });

  it('drops a guest session and shows the form again', async () => {
    const session = controller();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'guest-access', refresh_token: 'guest-refresh', expires_in: 3600, user: { id: 'guest-id', is_anonymous: true } })));
    render(<AuthCard controller={session} onAuthenticated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '访客进入' }));
    await waitFor(() => expect(screen.getByText('访客')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '退出访客，换一个账号' }));
    await waitFor(() => expect(screen.getByRole('form', { name: '工作室登录' })).toBeTruthy());
    expect(session.getSnapshot().user).toBeNull();
    expect(screen.queryByRole('button', { name: '退出访客，换一个账号' })).toBeNull();
  });

  it('offers the plain sign-out wording for a named account', async () => {
    const session = controller();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u', email: 'demo@scendance.example' } })));
    render(<AuthCard controller={session} onAuthenticated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'demo@scendance.example' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'demo-only-2026' } });
    fireEvent.click(screen.getByRole('button', { name: '登录并进入工作台' }));
    await waitFor(() => expect(screen.getByText('demo@scendance.example')).toBeTruthy());
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
  });
});
