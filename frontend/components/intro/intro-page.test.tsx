// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { IntroPage } from './intro-page';

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
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  for (const session of sessions.splice(0)) session.dispose();
  vi.unstubAllGlobals();
});

describe('introduction and sign-in entry', () => {
  it('keeps the fields usable but the submit inert when the backend is unconfigured', () => {
    const session = controller(false);
    const onEnter = vi.fn();
    render(<IntroPage controller={session} onEnter={onEnter} />);
    // Only the submit is gated. Disabling the inputs as well made the form look broken:
    // nothing was focusable, so there was no way to tell an unconfigured build from a dead one.
    expect((screen.getByRole('button', { name: '登录并进入工作台' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('密码') as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'editor@example.com' } });
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('editor@example.com');
    expect(screen.getByRole('status').textContent).toContain('登录服务尚未配置');
    fireEvent.click(screen.getByRole('button', { name: '先体验本地工作台' }));
    expect(onEnter).toHaveBeenCalledOnce();
    expect(session.getSnapshot().user).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses the actual Auth contract and only enters after successful authentication', async () => {
    const session = controller();
    const onEnter = vi.fn();
    let complete!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    render(<IntroPage controller={session} onEnter={onEnter} />);
    submitCredentials();
    expect(onEnter).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '正在登录…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('form', { name: '工作室登录' }).getAttribute('aria-busy')).toBe('true');
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '先体验本地工作台' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByRole('form', { name: '工作室登录' }));
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://example.supabase.co/auth/v1/token?grant_type=password');
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toMatchObject({ email: 'editor@example.com', password: 'test-password-only' });
    await act(async () => {
      complete(new Response(JSON.stringify({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'editor-id', email: 'editor@example.com' } }), { status: 200 }));
    });
    await waitFor(() => expect(onEnter).toHaveBeenCalledOnce());
    expect(session.getSnapshot().user?.email).toBe('editor@example.com');
  });

  it('keeps the user on the introduction and reports invalid credentials instead of entering', async () => {
    const session = controller();
    const onEnter = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    render(<IntroPage controller={session} onEnter={onEnter} />);
    submitCredentials();
    expect((await screen.findByRole('alert')).textContent).toBe('邮箱或密码不正确。');
    expect(onEnter).not.toHaveBeenCalled();
    expect(session.getSnapshot().user).toBeNull();
    expect((screen.getByRole('button', { name: '登录并进入工作台' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reuses the same authenticated session when returning from the editor', async () => {
    const session = controller();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'editor-id', email: 'editor@example.com' } }), { status: 200 }));
    await session.signIn('editor@example.com', 'test-password-only');
    const onEnter = vi.fn();
    const first = render(<IntroPage controller={session} onEnter={onEnter} />);
    fireEvent.click(screen.getByRole('button', { name: '进入工作台' }));
    first.unmount();
    render(<IntroPage controller={session} onEnter={onEnter} />);
    expect(screen.getByText('editor@example.com')).toBeTruthy();
    expect(screen.queryByLabelText('密码')).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('explains measured inputs and structure review without running recognition on entry', () => {
    render(<IntroPage controller={controller(false)} onEnter={vi.fn()} />);
    expect(screen.getByText(/上传图纸或现场照片，补充实测尺寸和活动需求/)).toBeTruthy();
    expect(screen.getByText(/核对空间结构，再在三维场景里完善你的方案/)).toBeTruthy();
    expect(screen.getByRole('img', { name: /活动空间概念插画/ })).toBeTruthy();
    expect(screen.getByText('活动空间概念示意 · 实际方案由你来布置')).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows local entry after a network failure without manufacturing an authenticated session', async () => {
    const session = controller();
    const onEnter = vi.fn();
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<IntroPage controller={session} onEnter={onEnter} />);
    submitCredentials();
    expect((await screen.findByRole('alert')).textContent).toContain('暂时无法连接登录服务');
    expect(screen.getByRole('form', { name: '工作室登录' }).getAttribute('aria-busy')).toBe('false');
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('editor@example.com');
    expect(onEnter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '先体验本地工作台' }));
    expect(onEnter).toHaveBeenCalledOnce();
    expect(session.getSnapshot().user).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('recovers from a malformed login response and clears the error on a successful retry', async () => {
    const session = controller();
    const onEnter = vi.fn();
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));
    render(<IntroPage controller={session} onEnter={onEnter} />);
    submitCredentials();
    expect((await screen.findByRole('alert')).textContent).toBe('登录服务暂时无法完成验证，请稍后重试。');
    expect(session.getSnapshot().user).toBeNull();
    expect(onEnter).not.toHaveBeenCalled();
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'editor-id', email: 'editor@example.com' } }), { status: 200 }));
    submitCredentials();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(onEnter).toHaveBeenCalledOnce());
    expect(session.getSnapshot().user?.email).toBe('editor@example.com');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});


it('registers and verifies an email inside the landing card before entering', async () => {
  const session = controller();
  const onEnter = vi.fn();
  render(<IntroPage controller={session} onEnter={onEnter} />);
  fireEvent.click(screen.getByRole('button', { name: 'Sign up · 注册' }));
  fireEvent.change(screen.getByLabelText('如何称呼你'), { target: { value: '测试创作者' } });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-long-password' } });
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'new-user' })));
  fireEvent.click(screen.getByRole('button', { name: '创建账号' }));
  await screen.findByLabelText('六位验证码');
  expect(onEnter).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('密码')).toBeNull();
  expect(screen.getByRole('button', { name: /秒后可重新发送/ }).hasAttribute('disabled')).toBe(true);
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'otp_expired' }), { status: 403 }));
  fireEvent.change(screen.getByLabelText('六位验证码'), { target: { value: '012345' } });
  fireEvent.click(screen.getByRole('button', { name: '验证并进入工作室' }));
  expect((await screen.findByRole('alert')).textContent).toContain('验证码已失效');
  expect(onEnter).not.toHaveBeenCalled();
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'new-user' } })));
  fireEvent.click(screen.getByRole('button', { name: '验证并进入工作室' }));
  await waitFor(() => expect(onEnter).toHaveBeenCalledOnce());
});


it('switches modes in place, preserves email and clears passwords and errors', async () => {
  render(<IntroPage controller={controller()} onEnter={vi.fn()} />);
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

it('waits for session restoration before allowing credentials to be submitted', () => {
  render(<IntroPage controller={controller()} ready={false} onEnter={vi.fn()} />);
  expect(screen.getByRole('button', { name: '正在恢复会话…' }).hasAttribute('disabled')).toBe(true);
  fireEvent.submit(screen.getByRole('form', { name: '工作室登录' }));
  expect(mockFetch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '访客进入' }).hasAttribute('disabled')).toBe(true);
});

it('creates a real guest session before entering through the authenticated return path', async () => {
  const session = controller();
  const onEnter = vi.fn();
  const onAuthenticated = vi.fn();
  let complete!: (response: Response) => void;
  mockFetch.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  render(<IntroPage controller={session} onEnter={onEnter} onAuthenticated={onAuthenticated} />);
  fireEvent.click(screen.getByRole('button', { name: '访客进入' }));
  expect(screen.getByRole('button', { name: '正在进入…' }).hasAttribute('disabled')).toBe(true);
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(mockFetch).toHaveBeenCalledOnce();
  expect(mockFetch.mock.calls[0][0]).toBe('https://example.supabase.co/auth/v1/signup');
  expect(JSON.parse(String(mockFetch.mock.calls[0][1]?.body))).toMatchObject({ data: { display_name: '访客' } });
  await act(async () => complete(new Response(JSON.stringify({ access_token: 'guest-access', refresh_token: 'guest-refresh', expires_in: 3600, user: { id: 'guest-id', is_anonymous: true } }))));
  await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
  expect(onEnter).not.toHaveBeenCalled();
  expect(session.getSnapshot().user).toMatchObject({ id: 'guest-id', is_anonymous: true });
  expect(screen.getByText('访客')).toBeTruthy();
});

it.each(['network', 'malformed'])('keeps guest entry retryable after a %s failure without a fake login', async failure => {
  const session = controller();
  const onAuthenticated = vi.fn();
  if (failure === 'network') mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  else mockFetch.mockResolvedValueOnce(new Response('{}'));
  render(<IntroPage controller={session} onEnter={vi.fn()} onAuthenticated={onAuthenticated} />);
  fireEvent.click(screen.getByRole('button', { name: '访客进入' }));
  expect((await screen.findByRole('alert')).textContent).toContain('暂时无法创建访客会话');
  expect(session.getSnapshot().user).toBeNull();
  expect(onAuthenticated).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '访客进入' }).hasAttribute('disabled')).toBe(false);
});
