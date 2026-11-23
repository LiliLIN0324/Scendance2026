// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { saveAvatar } from './account-avatars';
import { AccountTeamPanel } from './account-team-panel';

const studioId = '50000000-0000-4000-8000-000000000001';
const owner = { userId: 'user-a', role: 'owner' as const, displayName: '丽丽', email: 'lily@example.com' };
const editor = { userId: 'user-b', role: 'editor' as const, displayName: '终树', email: 'zhongshu@example.com' };
let controller: BackendSession;
let mem: MemoryStorage;

function respond(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

/** 团队取数按地址路由：账户面板与消息面板同时读，靠顺序排队会先打平。 */
function stubTeamRoutes(unread: unknown = []) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/\/messages\/unread/.test(url)) return respond(unread);
    if (/\/studios\/[^/]+\/members/.test(url)) return respond([owner, editor]);
    if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' }]);
    return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
  }));
}

beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  stubTeamRoutes();
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
});

afterEach(() => {
  cleanup();
  controller.dispose();
  mem?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('account team panel', () => {
  it('lists the studio members with emails and the invite flow', async () => {
    await controller.signIn('test@example.com', 'password');
    render(<AccountTeamPanel controller={controller}/>);
    expect(await screen.findByRole('heading', { name: '成员' })).toBeTruthy();
    expect(screen.queryByText('团队名称')).toBeNull();
    expect(screen.getAllByText('成员').length).toBeGreaterThan(1);
    expect(screen.getByText('丽丽 · 你')).toBeTruthy();
    expect(screen.getByText('lily@example.com')).toBeTruthy();
    expect(screen.getByText('zhongshu@example.com')).toBeTruthy();
    expect(screen.queryByText('账号 ID/')).toBeNull();
    expect(screen.getByRole('button', { name: '移除成员终树' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '邀请' })).toBeTruthy();
    expect(screen.queryByLabelText('成员邮箱')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '邀请' }));
    expect(screen.getByLabelText('成员邮箱')).toBeTruthy();
    expect(screen.getByTitle('负责人')).toBeTruthy();
    expect(screen.queryByText('林雨舟')).toBeNull();
    expect(screen.queryByText('许知夏')).toBeNull();
  });

  it('hides the invite and remove controls from non-owners instead of erroring on click', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/messages\/unread/.test(url)) return respond([]);
      if (/\/studios\/[^/]+\/members/.test(url)) return respond([owner, editor]);
      if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' }]);
      return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-b', aud: 'authenticated', email: 'zhongshu@example.com' } });
    }));
    await controller.signIn('zhongshu@example.com', 'password');
    render(<AccountTeamPanel controller={controller}/>);
    expect(await screen.findByText('终树 · 你')).toBeTruthy();
    // 2026-11-22 用户拍板：不能用就不渲染。非负责人不再出现点了才报错的「邀请」钮。
    expect(screen.queryByRole('button', { name: '邀请' })).toBeNull();
    expect(screen.queryByRole('button', { name: '移除成员丽丽' })).toBeNull();
    // 改名同样只属于负责人：非负责人看到纯标题。
    expect(screen.queryByRole('button', { name: '重命名团队幕景' })).toBeNull();
    expect(screen.getByRole('heading', { name: '幕景' })).toBeTruthy();
    // 刷新对谁都可用。
    expect(screen.getByRole('button', { name: '刷新成员' })).toBeTruthy();
  });

  it('tells the team note that only the owner can invite or remove', async () => {
    await controller.signIn('test@example.com', 'password');
    render(<AccountTeamPanel controller={controller}/>);
    await screen.findByText('丽丽 · 你');
    fireEvent.click(screen.getByRole('button', { name: '团队说明' }));
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('只有负责人能改团队名、邀请或移除成员');
    expect(note.textContent).toContain('对方需先有账号');
    // 只改文案，不扩大邀请权限。
    expect(screen.getByRole('button', { name: '邀请' })).toBeTruthy();
  });

  it('shows the avatar picked on this device on my own row', async () => {    await controller.signIn('test@example.com', 'password');
    render(<AccountTeamPanel controller={controller}/>);
    await screen.findByText('丽丽 · 你');
    act(() => { saveAvatar('user-a', '07'); });
    const picked = '/assets/avatars/preset/07.svg';
    const mineRow = document.querySelector('.sc-settings-row .sc-settings-avatar') as HTMLElement;
    expect(mineRow.querySelector('img')?.getAttribute('src')).toBe(picked);
    // 同事选的头像存在他自己的设备上，这里还是字母圆片。
    expect([...document.querySelectorAll('.sc-settings-row .sc-settings-avatar')][1].textContent).toBe('终');
  });

  it('renames the team from the panel header and pushes the new name upstream', async () => {
    let currentName = '幕景';
    const calls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method, body: String(init?.body ?? '') });
      if (/\/messages\/unread/.test(url)) return respond([]);
      if (/\/studios\/[^/]+\/members/.test(url)) return respond([owner, editor]);
      if (/\/studios\/[^/]+$/.test(url) && method === 'PATCH') {
        currentName = (JSON.parse(String(init?.body)) as { name: string }).name;
        return respond({ id: studioId, name: currentName, role: 'owner', displayName: '丽丽' });
      }
      if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: currentName, role: 'owner', displayName: '丽丽' }]);
      return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
    }));
    await controller.signIn('test@example.com', 'password');
    const onStudioRenamed = vi.fn();
    render(<AccountTeamPanel controller={controller} onStudioRenamed={onStudioRenamed}/>);
    fireEvent.click(await screen.findByRole('button', { name: '重命名团队幕景' }));
    const input = screen.getByLabelText('团队新名称') as HTMLInputElement;
    expect(input.value).toBe('幕景');
    fireEvent.change(input, { target: { value: '  幕景二组  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('button', { name: '重命名团队幕景二组' })).toBeTruthy();
    const patch = calls.find(call => call.method === 'PATCH');
    expect(patch && JSON.parse(patch.body)).toEqual({ name: '幕景二组' });
    expect(onStudioRenamed).toHaveBeenCalledWith(studioId, '幕景二组');
    // 成员名单不跟着变名字而消失：同一个团队、同一批人。
    expect(screen.getByText('丽丽 · 你')).toBeTruthy();
  });

  it('still lists a member when the backend sends no email', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/messages\/unread/.test(url)) return respond([]);
      if (/\/studios\/[^/]+\/members/.test(url)) return respond([{ userId: 'user-a', role: 'owner', displayName: '丽丽' }]);
      if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' }]);
      return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
    }));
    await controller.signIn('test@example.com', 'password');
    render(<AccountTeamPanel controller={controller}/>);
    expect(await screen.findByText('丽丽 · 你')).toBeTruthy();
    expect(document.querySelectorAll('.sc-settings-contact')).toHaveLength(0);
  });

  it('says why the panel is empty before login and adds no placeholder people', async () => {
    render(<AccountTeamPanel controller={controller}/>);
    expect(await screen.findByText('登录后才能看到团队成员。')).toBeTruthy();
    expect(screen.getByText('登录后这里会列出成员。')).toBeTruthy();
    expect(screen.queryByText('林雨舟')).toBeNull();
  });
});
