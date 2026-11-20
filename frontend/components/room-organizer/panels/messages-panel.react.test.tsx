// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { MessagesPanel } from './messages-panel';
import { RailMessagesButton } from './rail-messages-button';
import type { TeamSnapshot } from '../lib/team-data';

const studioId = '50000000-0000-4000-8000-000000000001';
const me = { userId: 'user-a', role: 'owner' as const, displayName: '丽丽', email: 'lily@example.com' };
const peer = { userId: 'user-b', role: 'editor' as const, displayName: '终树', email: 'zhongshu@example.com' };
let controller: BackendSession;
let thread: Record<string, unknown>[];
let notices: Record<string, unknown>[];

function respond(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

function snapshot(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return { userId: 'user-a', studioId, teamName: '幕景', members: [me, peer], loading: false, error: '', ...overrides };
}

function stubRoutes(unread: unknown = []) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    if (/\/notices\/unread/.test(url)) return respond({ count: notices.filter(n => !n.readAt).length });
    if (/\/notices\/read/.test(url)) {
      const target = notices.find(n => n.id === String(body?.noticeId));
      if (target) target.readAt = '2026-11-20T09:05:00Z';
      return respond({ marked: 1 });
    }
    if (/\/notices(\?|$)/.test(url)) return respond(notices);
    if (/\/messages\/unread/.test(url)) return respond(unread);
    if (/\/messages\/read/.test(url)) return respond({ marked: 1 });
    if (/\/messages(\?|$)/.test(url) && init?.method === 'POST') {
      const message = { id: `m${thread.length + 1}`, fromUserId: 'user-a', toUserId: String(body?.peerId), body: body?.body, createdAt: '2026-11-03T10:01:00Z', readAt: null };
      thread.push(message);
      return respond(message);
    }
    if (/\/messages(\?|$)/.test(url)) return respond(thread);
    if (/\/studios\/[^/]+\/members/.test(url)) return respond([me, peer]);
    if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' }]);
    return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
  }));
}

beforeEach(async () => {
  thread = [{ id: 'm1', fromUserId: 'user-b', toUserId: 'user-a', body: '方案改了两版', createdAt: '2026-11-03T10:00:00Z', readAt: null }];
  notices = [{ id: 'n1', kind: 'announcement', title: '欢迎使用幕景', body: '公告正文样例', link: null, createdAt: '2026-11-20T09:00:00Z', readAt: null }];
  stubRoutes();
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
  await controller.signIn('test@example.com', 'password');
});

afterEach(() => {
  cleanup();
  controller.dispose();
  vi.unstubAllGlobals();
});

function Shell({ team = snapshot(), open = false, onToggle = () => {}, onOpenAccount = () => {}, panelProps = {} }: {
  team?: TeamSnapshot;
  open?: boolean;
  onToggle?: () => void;
  onOpenAccount?: () => void;
  panelProps?: Record<string, unknown>;
}): JSX.Element {
  return <>
    <RailMessagesButton controller={controller} team={team} open={open} onToggle={onToggle} onOpenAccount={onOpenAccount}/>
    <MessagesPanel controller={controller} team={team} onClose={() => {}} {...panelProps}/>
  </>;
}

describe('messages rail entry', () => {
  it('shows the total of private and official unread on the rail button', async () => {
    stubRoutes([{ userId: 'user-b', count: 2 }]);
    render(<Shell/>);
    const waiting = await screen.findByRole('button', { name: '和 终树 的对话，2 条未读' });
    expect(waiting.querySelector('.sc-message-row-badge')?.textContent).toBe('2');
    const rail = screen.getByRole('button', { name: '消息' });
    expect(rail.querySelector('.sc-rail-message-badge')?.textContent).toBe('3');
  });

  it('toggles the panel when clicked while signed in', () => {
    const onToggle = vi.fn();
    render(<Shell onToggle={onToggle}/>);
    fireEvent.click(screen.getByRole('button', { name: '消息' }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('routes to the account dialog before login instead of opening a fake chat', () => {
    const onOpenAccount = vi.fn();
    const guest = snapshot({ userId: '', members: [] });
    render(<Shell team={guest} onOpenAccount={onOpenAccount}/>);
    fireEvent.click(screen.getByRole('button', { name: '登录后查看消息' }));
    expect(onOpenAccount).toHaveBeenCalledOnce();
  });
});

describe('messages panel list', () => {
  it('pins the official notice above the member conversations', async () => {
    render(<Shell/>);
    expect(await screen.findByRole('button', { name: '官方通知，1 条未读' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '和 终树 的对话' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '给自己留话' })).toBeTruthy();
  });

  it('opens the member thread and goes back to the list', async () => {
    render(<Shell/>);
    fireEvent.click(await screen.findByRole('button', { name: '和 终树 的对话' }));
    expect(await screen.findByRole('heading', { name: '终树 · 编辑成员' })).toBeTruthy();
    expect(await screen.findByText('方案改了两版')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '返回消息列表' }));
    expect(await screen.findByRole('button', { name: '和 终树 的对话' })).toBeTruthy();
  });

  it('opens the official list, reads a notice, and returns without a composer', async () => {
    render(<Shell/>);
    fireEvent.click(await screen.findByRole('button', { name: '官方通知，1 条未读' }));
    const row = await screen.findByRole('button', { name: '欢迎使用幕景，未读' });
    expect(row.querySelector('.sc-message-row-badge')?.textContent).toBe('未读');
    fireEvent.click(row);
    expect(await screen.findByRole('heading', { name: '通知详情' })).toBeTruthy();
    expect(screen.getByText('公告正文样例')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回通知列表' }));
    expect(await screen.findByRole('button', { name: '欢迎使用幕景' })).toBeTruthy();
  });

  it('shows the login hint instead of member rows before login', async () => {
    const guest = snapshot({ userId: '', members: [] });
    render(<Shell team={guest}/>);
    expect(await screen.findByText(/登录后查看团队消息/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '和 终树 的对话' })).toBeNull();
  });

  it('passes the stack class and DOM order to the list root', () => {
    render(<Shell panelProps={{ className: 'is-stack-first', style: { order: 0 } }}/>);
    const root = document.querySelector('.sc-messages-panel') as HTMLElement;
    expect(root.className).toContain('is-stack-first');
    expect(root.style.order).toBe('0');
  });

  it('renders the notice link only for http(s) URLs', async () => {
    notices = [
      { id: 'n1', kind: 'event', title: '线下活动', body: '活动正文样例', link: 'https://example.com/party', createdAt: '2026-11-20T09:00:00Z', readAt: null },
      { id: 'n2', kind: 'system', title: '坏链接通知', body: '正文样例', link: 'javascript:alert(1)', createdAt: '2026-11-20T09:01:00Z', readAt: null },
    ];
    render(<Shell/>);
    fireEvent.click(await screen.findByRole('button', { name: '官方通知，2 条未读' }));

    fireEvent.click(await screen.findByRole('button', { name: '线下活动，未读' }));
    const link = screen.getByRole('link', { name: '查看相关内容' });
    expect(link.getAttribute('href')).toBe('https://example.com/party');

    fireEvent.click(screen.getByRole('button', { name: '返回通知列表' }));
    fireEvent.click(await screen.findByRole('button', { name: '坏链接通知，未读' }));
    expect(screen.queryByRole('link', { name: '查看相关内容' })).toBeNull();
  });

  it('shows Chinese labels for every notice kind', async () => {
    notices = [
      { id: 'k1', kind: 'announcement', title: '公告样例', body: '正文', link: null, createdAt: '2026-11-20T09:00:00Z', readAt: null },
      { id: 'k2', kind: 'version', title: '版本样例', body: '正文', link: null, createdAt: '2026-11-20T09:01:00Z', readAt: null },
      { id: 'k3', kind: 'event', title: '活动样例', body: '正文', link: null, createdAt: '2026-11-20T09:02:00Z', readAt: null },
      { id: 'k4', kind: 'system', title: '系统样例', body: '正文', link: null, createdAt: '2026-11-20T09:03:00Z', readAt: null },
    ];
    render(<Shell/>);
    fireEvent.click(await screen.findByRole('button', { name: '官方通知，4 条未读' }));
    const cases: Array<[string, string]> = [
      ['公告样例', '公告'],
      ['版本样例', '版本更新'],
      ['活动样例', '活动'],
      ['系统样例', '系统通知'],
    ];
    for (const [title, label] of cases) {
      const row = await screen.findByRole('button', { name: `${title}，未读` });
      expect(row.querySelector('.sc-message-row-sub')?.textContent).toContain(label);
    }
  });

  it('shows the list error state when notices fail to load', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/notices(\?|$)/.test(url)) throw new Error('通知拉不下来');
      if (/\/notices\/unread/.test(url)) return respond({ count: 0 });
      if (/\/messages\/unread/.test(url)) return respond([]);
      if (/\/messages(\?|$)/.test(url)) return respond(thread);
      if (/\/studios\/[^/]+\/members/.test(url)) return respond([me, peer]);
      if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' }]);
      return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
    }));
    render(<Shell/>);
    fireEvent.click(await screen.findByRole('button', { name: '官方通知' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/通知拉不下来/);
  });
});
