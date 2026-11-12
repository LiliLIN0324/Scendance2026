// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { MemberChat } from './member-chat';
import type { TeamSnapshot } from '../lib/team-data';

const studioId = '50000000-0000-4000-8000-000000000001';
const me = { userId: 'user-a', role: 'owner' as const, displayName: '丽丽', email: 'lily@example.com' };
const peer = { userId: 'user-b', role: 'editor' as const, displayName: '终树', email: 'zhongshu@example.com' };
const team: TeamSnapshot = { userId: 'user-a', studioId, teamName: '幕景', members: [me, peer], loading: false, error: '' };
let controller: BackendSession;
let thread: Record<string, unknown>[];
let posts: { url: string; body: Record<string, unknown> | undefined }[];
let failSend = false;

function respond(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

beforeEach(async () => {
  thread = [{ id: 'm1', fromUserId: 'user-b', toUserId: 'user-a', body: '方案改了两版', createdAt: '2026-11-03T10:00:00Z', readAt: null }];
  posts = [];
  failSend = false;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    if (/\/messages\/read/.test(url)) { posts.push({ url, body }); return respond({ marked: 1 }); }
    if (/\/messages(\?|$)/.test(url) && init?.method === 'POST') {
      posts.push({ url, body });
      if (failSend) return new Response(JSON.stringify({ error: { code: 'NETWORK_ERROR' } }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      // 云端给自己的留话一落库就算已读，本机桩跟着照做，否则窗口会替自己发一次「标已读」。
      const message = { id: `m${thread.length + 1}`, fromUserId: 'user-a', toUserId: String(body?.peerId), body: body?.body, createdAt: '2026-11-03T10:01:00Z', readAt: body?.peerId === 'user-a' ? '2026-11-03T10:01:00Z' : null };
      thread.push(message);
      return respond(message);
    }
    if (/\/messages(\?|$)/.test(url)) return respond(thread);
    return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
  }));
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
  await controller.signIn('test@example.com', 'password');
});

afterEach(() => {
  cleanup();
  controller.dispose();
  vi.unstubAllGlobals();
});

function open(peerId = 'user-b', onClose = () => {}) {
  render(<MemberChat controller={controller} team={team} peerId={peerId} onClose={onClose}/>);
}

describe('the conversation that fills the left column', () => {
  it('shows what the member sent and takes the unread mark off', async () => {
    open();
    expect(await screen.findByText('方案改了两版')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '终树 · 编辑成员' })).toBeTruthy();
    await waitFor(() => expect(posts.some(post => /\/messages\/read/.test(post.url) && post.body?.peerId === 'user-b')).toBe(true));
  });

  it('sends what is typed and empties the box', async () => {
    open();
    const box = await screen.findByRole('textbox', { name: '发给 终树 的消息' });
    fireEvent.change(box, { target: { value: '收到，我上看板' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('收到，我上看板')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '发给 终树 的消息' }) as HTMLInputElement).value).toBe('');
    expect(posts.some(post => !/read/.test(post.url) && post.body?.body === '收到，我上看板')).toBe(true);
  });

  it('keeps the draft when a send fails', async () => {
    open();
    await screen.findByText('方案改了两版');
    failSend = true;
    const box = screen.getByRole('textbox', { name: '发给 终树 的消息' }) as HTMLInputElement;
    fireEvent.change(box, { target: { value: '这条发不出去' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(box.value).toBe('这条发不出去');
    // 输入框里留着那句是草稿，消息列表里不能出现——textarea 的文本内容和值同一段文字，所以只查对话区。
    expect(screen.queryByText('这条发不出去', { selector: '.ap-feed *' })).toBeNull();
  });

  it('is a note to myself when the peer is the signed-in account', async () => {
    // 留话不经过别人，所以不该有「标已读」的请求；先清空别人的那条，免得窗口一开就替他读了。
    thread = [];
    open('user-a');
    expect(screen.getByRole('heading', { name: '给自己留话' })).toBeTruthy();
    const box = screen.getByRole('textbox', { name: '写给自己的消息' });
    fireEvent.change(box, { target: { value: '明天问终树要尺寸' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByText('明天问终树要尺寸')).toBeTruthy();
    expect(posts.some(post => /\/messages\/read/.test(post.url))).toBe(false);
  });

  it('closes from the header without touching the canvas', () => {
    const onClose = vi.fn();
    open('user-b', onClose);
    fireEvent.click(screen.getByRole('button', { name: '关闭对话' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('the conversation card wired into the left-stack half-card system', () => {
  // 2026-11-12 左栏半卡片堆栈：与户外/Bingo/拍摄场地同一套交互（is-stack-first/second、is-detached）。
  it('takes the stack class and the DOM order when it joins the splitter pair', async () => {
    render(<MemberChat controller={controller} team={team} peerId="user-b" onClose={() => {}}
      className="is-stack-first" style={{ order: 0 }}/>);
    await screen.findByText('方案改了两版');
    const root = document.querySelector('.sc-person-chat') as HTMLElement;
    expect(root.className).toContain('is-stack-first');
    expect(root.style.order).toBe('0');
  });

  it('turns into a detached window with the float bar, the resize handle and the grab header', async () => {
    const pull = vi.fn();
    render(<MemberChat controller={controller} team={team} peerId="user-b" onClose={() => {}}
      className="is-detached" style={{ ['--sc-float-x' as string]: '120px', ['--sc-float-y' as string]: '80px', ['--sc-float-w' as string]: '480px', ['--sc-float-h' as string]: '528px' }}
      onHeaderPointerDown={pull}
      floatBar={<div className="sc-agent-float-bar"><strong>私信</strong><span>独立小窗</span><button type="button" aria-label="收回私信面板">收回</button></div>}
      floatFooter={<div className="sc-float-resize" role="separator" aria-label="调整独立窗口大小"/>}/>);
    await screen.findByText('方案改了两版');
    const root = document.querySelector('.sc-person-chat') as HTMLElement;
    expect(root.className).toContain('is-detached');
    expect(root.style.getPropertyValue('--sc-float-x')).toBe('120px');
    expect(screen.getByRole('button', { name: '收回私信面板' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: '调整独立窗口大小' })).toBeTruthy();
    // 头部按下交给外部的拖拽状态机；样式同步出现「可以抓」的手势光标。
    const head = document.querySelector('.sc-person-chat-head') as HTMLElement;
    expect(head.style.cursor).toBe('grab');
    expect(head.style.touchAction).toBe('none');
    fireEvent.pointerDown(head);
    expect(pull).toHaveBeenCalledOnce();
  });
});
