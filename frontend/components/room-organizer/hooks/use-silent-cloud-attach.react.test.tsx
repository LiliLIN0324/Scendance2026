// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeSelfAttachedProject } from '@/lib/workspace-api';
import { makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { useSilentCloudAttach } from './use-silent-cloud-attach';
import type { BackendSession } from '@/lib/backend-session';
import type { RoomLayout } from '../lib/types';

const mocks = vi.hoisted(() => ({
  listStudios: vi.fn(),
  businessRequest: vi.fn(),
  createProject: vi.fn(),
  acquireLease: vi.fn(),
}));
const snapshot = vi.hoisted(() => ({
  value: {
    configured: true,
    user: { id: 'me', email: 'me@example.com' } as { id: string; email?: string; is_anonymous?: boolean } | null,
    project: null as { id: string } | null,
    lease: null as { projectId: string } | null,
    writeBlocked: true,
    geometryBinding: null as unknown,
  },
}));
vi.mock('@/lib/backend-session', () => ({ useBackendSession: () => snapshot.value }));
vi.mock('@/lib/source-storage', () => ({ flushSourceScope: vi.fn(async () => {}), copySourceScope: vi.fn(async () => {}) }));

const controller = {
  ...mocks,
  subscribe: () => () => {},
  getSnapshot: () => snapshot.value,
} as unknown as BackendSession;

const studio = { id: 'studio-1', name: '个人工作室', role: 'owner', displayName: '负责人' };
const created = { id: 'p-new', name: '未命名方案', studio_id: 'studio-1', revision: 1 };

/** 云端可保存的空场地（无屋顶/内墙/多边形），items 为画布上的物料。 */
function cloudLayout(items: Parameters<typeof makeItem>[0][] = [{}], overrides: Parameters<typeof makeLayout>[0] = {}): RoomLayout {
  return makeLayout({
    name: '',
    roof: { style: 'none', color: '#000000' },
    floors: [{ id: 'ground', name: 'Ground Floor', floorColor: '#c9a57d', items: items.map((item) => makeItem({ id: crypto.randomUUID(), ...item })) }],
    ...overrides,
  });
}

function Probe({ layout, onBind }: { layout: RoomLayout; onBind: (id: string) => void }): null {
  useSilentCloudAttach({ controller, layout, onBindProject: onBind });
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  snapshot.value = { configured: true, user: { id: 'me', email: 'me@example.com' }, project: null, lease: null, writeBlocked: true, geometryBinding: null };
  mocks.listStudios.mockResolvedValue([studio]);
  mocks.createProject.mockResolvedValue(created);
  mocks.acquireLease.mockResolvedValue({});
});

afterEach(cleanup);

describe('无感挂云', () => {
  it('登录 + 未连接 + 摆上第一件物料：建项目、取编辑权、绑定并同步 URL', async () => {
    const onBind = vi.fn();
    render(<Probe layout={cloudLayout()} onBind={onBind} />);
    await waitFor(() => expect(onBind).toHaveBeenCalledWith('p-new'));
    expect(mocks.businessRequest).not.toHaveBeenCalled();
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
    const [studioId, name, scene] = mocks.createProject.mock.calls[0]!;
    expect(studioId).toBe('studio-1');
    expect(name).toMatch(/^未命名方案 · \d{2}-\d{2}$/);
    expect(scene).toMatchObject({ schemaVersion: 1 });
    expect((scene as { objects: unknown[] }).objects).toHaveLength(1);
    expect(mocks.acquireLease).toHaveBeenCalledWith('p-new');
    expect(new URLSearchParams(window.location.search).get('project')).toBe('p-new');
    expect(consumeSelfAttachedProject('me', 'p-new')).toBe(true);
  });

  it('画布已有名字时沿用画布名', async () => {
    const onBind = vi.fn();
    render(<Probe layout={cloudLayout([{}], { name: '春夏市集' })} onBind={onBind} />);
    await waitFor(() => expect(onBind).toHaveBeenCalledWith('p-new'));
    expect(mocks.createProject.mock.calls[0]![1]).toBe('春夏市集');
  });

  it('没有工作室时静默建「个人工作室」再建项目', async () => {
    mocks.listStudios.mockResolvedValue([]);
    mocks.businessRequest.mockResolvedValue(studio);
    const onBind = vi.fn();
    render(<Probe layout={cloudLayout()} onBind={onBind} />);
    await waitFor(() => expect(onBind).toHaveBeenCalledWith('p-new'));
    expect(mocks.businessRequest).toHaveBeenCalledWith('/studios', 'POST', expect.objectContaining({ name: '个人工作室' }));
    expect(mocks.createProject.mock.calls[0]![0]).toBe('studio-1');
  });

  it('只立壳（没有物料）不触发', async () => {
    render(<Probe layout={cloudLayout([])} onBind={vi.fn()} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('门柱出入口等结构标记不算物料，不触发', async () => {
    render(<Probe layout={cloudLayout([{ structuralColumnId: 'col-1' }])} onBind={vi.fn()} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('访客（未登录或匿名）不触发', async () => {
    snapshot.value.user = null;
    const { unmount } = render(<Probe layout={cloudLayout()} onBind={vi.fn()} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    unmount();
    snapshot.value.user = { id: 'guest', is_anonymous: true };
    render(<Probe layout={cloudLayout()} onBind={vi.fn()} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('画布已绑定当前云项目时不另建', async () => {
    snapshot.value.project = { id: 'p-existing' };
    render(<Probe layout={cloudLayout([{}], { id: 'p-existing' })} onBind={vi.fn()} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('持有其他项目编辑权时不另建', async () => {
    snapshot.value.lease = { projectId: 'p-busy' };
    snapshot.value.writeBlocked = false;
    render(<Probe layout={cloudLayout()} onBind={vi.fn()} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.createProject).not.toHaveBeenCalled();
  });

  it('挂成功后继续编辑不重复建', async () => {
    const onBind = vi.fn();
    const { rerender } = render(<Probe layout={cloudLayout()} onBind={onBind} />);
    await waitFor(() => expect(onBind).toHaveBeenCalledWith('p-new'));
    snapshot.value.project = { id: 'p-new' };
    rerender(<Probe layout={cloudLayout([{}], { id: 'p-new' })} onBind={onBind} />);
    rerender(<Probe layout={cloudLayout([{}, {}], { id: 'p-new' })} onBind={onBind} />);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
  });

  it('取编辑权失败仍完成绑定（只读续接）', async () => {
    mocks.acquireLease.mockRejectedValue(new Error('409'));
    const onBind = vi.fn();
    render(<Probe layout={cloudLayout()} onBind={onBind} />);
    await waitFor(() => expect(onBind).toHaveBeenCalledWith('p-new'));
    expect(mocks.createProject).toHaveBeenCalledTimes(1);
  });

  it('建项目失败不打扰，下一件物料进场时重试', async () => {
    mocks.createProject.mockRejectedValueOnce(new Error('network'));
    const onBind = vi.fn();
    const { rerender } = render(<Probe layout={cloudLayout()} onBind={onBind} />);
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledTimes(1));
    expect(onBind).not.toHaveBeenCalled();
    rerender(<Probe layout={cloudLayout([{}, {}])} onBind={onBind} />);
    await waitFor(() => expect(onBind).toHaveBeenCalledWith('p-new'));
    expect(mocks.createProject).toHaveBeenCalledTimes(2);
  });
});
