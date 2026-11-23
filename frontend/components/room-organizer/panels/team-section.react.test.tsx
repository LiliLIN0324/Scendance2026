// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { TeamSection } from './team-section';
import { MemoryStorage } from '../../../lib/test-support-memory-storage';

const mem = new MemoryStorage();
Object.defineProperty(globalThis, 'Storage', { configurable: true, value: MemoryStorage });
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: mem });
Object.defineProperty(window, 'localStorage', { configurable: true, value: mem });

const studioId = '50000000-0000-4000-8000-000000000002';
const owner = { userId: 'user-a', role: 'owner' as const, displayName: '丽丽', email: 'lily@example.com' };
const editor = { userId: 'user-b', role: 'editor' as const, displayName: '终树', email: 'zhongshu@example.com' };
let controller: BackendSession;

function respond(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

function patchBody(init?: RequestInit): unknown {
  try { return JSON.parse(String(init?.body ?? '{}')); } catch { return {}; }
}

/** 团队分区取数按地址路由：名单与默认读数、保存回执都从这里摹。 */
function stubRoutes(settings: unknown = {}) {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: String(init?.body ?? '') });
    if (/\/messages\/unread/.test(url)) return respond([]);
    if (/\/studios\/[^/]+\/settings/.test(url)) return respond(method === 'PATCH' ? patchBody(init) : settings);
    if (/\/studios\/[^/]+\/members/.test(url)) return respond([owner, editor]);
    if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' }]);
    return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
  }));
  return calls;
}

beforeEach(() => {
  mem.clear();
  window.history.replaceState(null, '', '/');
  stubRoutes();
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
});

afterEach(() => {
  cleanup();
  controller.dispose();
  vi.unstubAllGlobals();
});

async function renderSection(opts: { owner?: boolean; signedIn?: boolean; signIn?: boolean; studioStatus?: 'ready' | 'signed-out'; studioSettings?: unknown; studioName?: string } = {}) {
  const onSave = vi.fn(async (patch: unknown) => patch);
  const onDelete = vi.fn();
  // useTeam 依赖会话：默认先登录再挂载，成员名单才取得到；未登录用例显式关掉。
  if (opts.signIn ?? true) await controller.signIn('test@example.com', 'password');
  render(<TeamSection
    controller={controller}
    studioId={studioId}
    studioName={opts.studioName ?? '幕景'}
    owner={opts.owner ?? true}
    signedIn={opts.signedIn ?? true}
    studioSettings={(opts.studioSettings ?? { companyName: '拾光活动' }) as never}
    studioStatus={opts.studioStatus ?? 'ready'}
    onSaveStudioSettings={onSave as never}
    onDeleteStudio={onDelete}
  />);
  return { onSave, onDelete };
}

describe('account dialog team section', () => {
  it('lists members and editable team defaults for the owner, saving through the given callback', async () => {
    const { onSave } = await renderSection();
    expect(await screen.findByText('丽丽 · 你')).toBeTruthy();
    const input = screen.getByLabelText('团队公司名') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('拾光活动');
    fireEvent.change(input, { target: { value: '拾光二组' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ companyName: '拾光二组' }));
    expect(await screen.findByText('已写入团队默认。已有方案不追溯。')).toBeTruthy();
    // 保存成功后草稿清空，输入框回到服务端值。
    await waitFor(() => expect((screen.getByLabelText('团队公司名') as HTMLInputElement).value).toBe('拾光活动'));
  });

  it('shows defaults read-only to editors and hides invite and delete', async () => {
    // 面板的 owner 判定来自会话里的成员名单，不是 prop：要 editor 视角就得用 user-b 登录。
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/messages\/unread/.test(url)) return respond([]);
      if (/\/studios\/[^/]+\/settings/.test(url)) return respond({});
      if (/\/studios\/[^/]+\/members/.test(url)) return respond([owner, editor]);
      if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' }]);
      return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-b', aud: 'authenticated', email: 'zhongshu@example.com' } });
    }));
    await renderSection({ owner: false });
    expect(await screen.findByText('终树 · 你')).toBeTruthy();
    expect((screen.getByLabelText('团队公司名') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('你能查看团队默认。只有负责人能修改。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '邀请' })).toBeNull();
    expect(screen.queryByRole('button', { name: /删除团队/ })).toBeNull();
    expect(screen.getByRole('heading', { name: '幕景' })).toBeTruthy();
  });

  it('deletes the team from the danger zone only after confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onDelete } = await renderSection();
    await screen.findByText('丽丽 · 你');
    fireEvent.click(screen.getByRole('button', { name: '删除团队幕景' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(String(confirmSpy.mock.calls[0]?.[0])).toContain('幕景');
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '删除团队幕景' }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it('explains why defaults are unavailable before login and renders no rows', async () => {
    await renderSection({ signedIn: false, signIn: false, studioStatus: 'signed-out' });
    expect(await screen.findByText('登录后才能读写团队默认。')).toBeTruthy();
    expect(screen.queryByLabelText('团队公司名')).toBeNull();
    // 成员区照旧解释登录前置。
    expect(screen.getByText('登录后才能看到团队成员。')).toBeTruthy();
  });

  it('follows the given studio context for the member list', async () => {
    const second = '50000000-0000-4000-8000-000000000003';
    const fetchMock = vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/messages\/unread/.test(url)) return respond([]);
      if (/\/studios\/[^/]+\/settings/.test(url)) return respond({});
      if (/\/studios\/[^/]+\/members/.test(url)) {
        return respond(url.includes(second) ? [{ userId: 'user-x', role: 'owner', displayName: '乙组负责人' }] : [owner, editor]);
      }
      if (/\/studios\/?$/.test(url)) return respond([
        { id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' },
        { id: second, name: '二组', role: 'owner', displayName: '丽丽' },
      ]);
      return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => { await controller.signIn('test@example.com', 'password'); });
    render(<TeamSection controller={controller} studioId={second} studioName="二组" owner signedIn studioSettings={null} studioStatus="ready" />);
    expect(await screen.findByText('乙组负责人')).toBeTruthy();
    expect(screen.queryByText('丽丽 · 你')).toBeNull();
    const memberCall = fetchMock.mock.calls.find(call => String(call[0]).includes(second) && String(call[0]).includes('members'));
    expect(memberCall).toBeTruthy();
  });
});
