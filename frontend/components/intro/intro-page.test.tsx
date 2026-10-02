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
  it('allows an honest local entry without creating a user or making network requests', () => {
    const session = controller(false);
    const onEnter = vi.fn();
    render(<IntroPage controller={session} onEnter={onEnter} />);
    expect((screen.getByRole('button', { name: '登录并进入工作台' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('云端登录与 AI 生成将在服务连接后开放');
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
    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://example.supabase.co/auth/v1/token?grant_type=password');
    expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toEqual({ email: 'editor@example.com', password: 'test-password-only' });
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
});
