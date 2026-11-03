// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import type { TeamSnapshot } from '../lib/team-data';
import { useTeam } from '../lib/team-data';
import { AccountTeamPanel } from './account-team-panel';
import { RailTeamBlock } from './rail-team-block';
import { loadAvatar, saveAvatar } from './account-avatars';

const studioId = '50000000-0000-4000-8000-000000000001';
const owner = { userId: 'user-a', role: 'owner' as const, displayName: '丽丽', email: 'lily@example.com' };
const editor = { userId: 'user-b', role: 'editor' as const, displayName: '终树', email: 'zhongshu@example.com' };
let controller: BackendSession;

function respond(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }

/** 团队取数按地址路由：左轨和团队页同时读，靠顺序排队会先打平。 */
function stubTeamRoutes(unread: unknown = []) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (/\/messages\/unread/.test(url)) return respond(unread);
    if (/\/studios\/[^/]+\/members/.test(url)) return respond([owner, editor]);
    if (/\/studios\/?$/.test(url)) return respond([{ id: studioId, name: '幕景', role: 'owner', displayName: '丽丽' }]);
    return respond({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', aud: 'authenticated', email: 'test@example.com' } });
  }));
}

/** 左轨与团队页读的是同一份取数，这里用最小外壳把两处渲染在一起。 */
function RailAndPanel(): JSX.Element {
  const team = useTeam(controller);
  return <><RailTeamBlock controller={controller} team={team} onOpenChat={() => {}} onOpenTeam={() => {}}/><AccountTeamPanel controller={controller}/></>;
}

function snapshot(overrides: Partial<TeamSnapshot>): TeamSnapshot {
  return { userId: 'user-a', studioId, teamName: '幕景', members: [owner, editor], loading: false, error: '', ...overrides };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  stubTeamRoutes();
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
});

afterEach(() => {
  cleanup();
  controller.dispose();
  vi.unstubAllGlobals();
});

describe('rail members and the team page share one source', () => {
  it('renders the same two members in the rail and in the team list', async () => {
    await controller.signIn('test@example.com', 'password');
    render(<RailAndPanel/>);
    expect(await screen.findByRole('button', { name: '给自己留话' })).toBeTruthy();
    const rail = screen.getByRole('navigation', { name: '团队成员' });
    // 自己那颗用这台设备选过的头像（没选过就是按账号分的那张），同事那颗还是首字母。
    expect([...rail.querySelectorAll('.sc-rail-member')].map(node => node.textContent)).toEqual(['', '终']);
    const mineRail = rail.querySelector('.sc-settings-avatar') as HTMLElement;
    const mineRow = document.querySelector('.sc-settings-row .sc-settings-avatar') as HTMLElement;
    expect(mineRail.querySelector('img')?.getAttribute('src')).toBe(loadAvatar('user-a').src);
    expect(mineRow.querySelector('img')?.getAttribute('src')).toBe(loadAvatar('user-a').src);
    // 每人一档色、同团队不撞色，而且左轨和成员行必须是同一档。
    const railTones = [...rail.querySelectorAll('.sc-settings-avatar')].map(node => node.getAttribute('data-tone'));
    const rowTones = [...document.querySelectorAll('.sc-settings-row .sc-settings-avatar')].map(node => node.getAttribute('data-tone'));
    expect(railTones).toEqual(rowTones);
    expect(new Set(railTones).size).toBe(2);
    expect(railTones.every(tone => /^(0[1-9]|10)$/.test(tone ?? ''))).toBe(true);
    const avatar = rail.querySelector('.sc-settings-avatar') as HTMLElement;
    expect(avatar.style.getPropertyValue('--sc-avatar-bg')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(avatar.style.getPropertyValue('--sc-avatar-ink')).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(screen.getByRole('heading', { name: '成员' })).toBeTruthy();
    expect(screen.getByText('丽丽 · 你')).toBeTruthy();
    expect(screen.getByText('lily@example.com')).toBeTruthy();
    expect(screen.getByText('zhongshu@example.com')).toBeTruthy();
    expect(screen.queryByText(/账号 ID/)).toBeNull();
    expect(screen.getByRole('button', { name: '移除成员终树' })).toBeTruthy();
    expect(screen.getByLabelText('成员邮箱')).toBeTruthy();
    expect(screen.queryByText('林雨舟')).toBeNull();
    expect(screen.queryByText('许知夏')).toBeNull();
  });

  it('puts the avatar picked on this device everywhere my own face shows up', async () => {
    await controller.signIn('test@example.com', 'password');
    render(<RailAndPanel/>);
    expect(await screen.findByRole('button', { name: '给自己留话' })).toBeTruthy();
    // 在账户中心点一次头像就是走 saveAvatar：左轨和成员行不用刷新，得立刻换成同一张。
    act(() => { saveAvatar('user-a', '07'); });
    const picked = '/assets/avatars/preset/07.svg';
    const rail = screen.getByRole('navigation', { name: '团队成员' });
    expect(rail.querySelector('.sc-settings-avatar img')?.getAttribute('src')).toBe(picked);
    expect(document.querySelector('.sc-settings-row .sc-settings-avatar img')?.getAttribute('src')).toBe(picked);
    // 同事选的头像存在他自己的设备上，这里还是字母圆片。
    expect([...rail.querySelectorAll('.sc-rail-member')][1].textContent).toBe('终');
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
    render(<RailAndPanel/>);
    expect(await screen.findByText('丽丽 · 你')).toBeTruthy();
    expect(document.querySelectorAll('.sc-settings-contact')).toHaveLength(0);
  });

  it('says why the rail is empty before login and adds no placeholder people', async () => {
    render(<RailAndPanel/>);
    expect(await screen.findByRole('button', { name: '登录后查看团队成员' })).toBeTruthy();
    expect(screen.getByText('在账户中心登录后，这里会显示你所在团队的成员。')).toBeTruthy();
    expect(screen.queryByText('林雨舟')).toBeNull();
  });

  it('opens the conversation of the member whose avatar is clicked', () => {
    const onOpenChat = vi.fn();
    render(<RailTeamBlock controller={controller} team={snapshot({})} onOpenChat={onOpenChat} onOpenTeam={() => {}}/>);
    fireEvent.click(screen.getByRole('button', { name: '给 终树 发消息' }));
    expect(onOpenChat).toHaveBeenCalledWith(editor);
    // 自己那颗不叫对话，叫留话。
    expect(screen.getByRole('button', { name: '给自己留话' })).toBeTruthy();
  });

  it('puts a red count only on the avatar that has messages waiting', async () => {
    stubTeamRoutes([{ userId: 'user-b', count: 2 }]);
    await controller.signIn('test@example.com', 'password');
    render(<RailTeamBlock controller={controller} team={snapshot({})} onOpenChat={() => {}} onOpenTeam={() => {}}/>);
    const waiting = await screen.findByRole('button', { name: '给 终树 发消息，2 条未读' });
    expect(waiting.querySelector('.sc-rail-member-badge')?.textContent).toBe('2');
    expect(screen.getByRole('button', { name: '给自己留话' }).querySelector('.sc-rail-member-badge')).toBeNull();
  });

  it('keeps a load failure readable instead of showing an empty team', () => {
    render(<RailTeamBlock controller={controller} team={snapshot({ members: [], error: '团队加载失败，点击重试。' })} onOpenChat={() => {}} onOpenTeam={() => {}}/>);
    expect(screen.getByRole('button', { name: '团队加载失败，点击重试。' })).toBeTruthy();
  });
});
