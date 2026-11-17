// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { AgentPanel, LayoutAgentProvider, VenuePickerOverlay } from './agent-panel';
import { SceneApiError } from '../../../../client/scene-client';
import { VenuePicker } from './venue-picker';
import type { RoomLayout } from '../lib/types';
import type { WorkbenchMode } from '../lib/workbench-mode';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  listStudios: vi.fn(),
  businessRequest: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
}));
const snapshot: { user: { id: string } | null } = { user: { id: 'me' } };
const controller = { ...mocks, subscribe: () => () => {}, getSnapshot: () => snapshot };
vi.mock('@/lib/auth-provider', () => ({ useAuth: () => ({ ready: true, controller }) }));
vi.mock('@/lib/backend-session', async () => {
  const actual = await vi.importActual<typeof import('@/lib/backend-session')>('@/lib/backend-session');
  return { useBackendSession: () => snapshot, backendFailureText: actual.backendFailureText };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

const state = vi.hoisted(() => ({ layout: null as unknown as RoomLayout, apply: vi.fn(), view: null as unknown, setView: vi.fn() }));
const studioMock = vi.hoisted(() => ({
  exportActivity: vi.fn(async () => {}),
  generate: vi.fn(async () => {}),
  discardPreview: vi.fn(),
  discardPreviewForHistoryReview: vi.fn(() => false),
  setBrief: vi.fn(),
  brief: { event: null as string | null, guests: null as number | null },
  hasSavedBrief: false,
  preview: null as unknown,
  stale: false,
  expired: false,
  busy: false,
  recoverable: false,
  connection: '离线引导',
}));
vi.mock('../contexts', () => ({
  useRoomEditor: () => ({
    layout: state.layout,
    activeFloor: state.layout.floors[0],
    activeFloorIndex: 0,
    actions: { applyLayout: state.apply, setFloorPlan: vi.fn() },
    view: state.view,
    setView: state.setView,
    collidingIds: new Set<string>(),
  }),
}));
vi.mock('./creative-studio', () => ({ useStudioAgent: () => studioMock, useLocalProjectBackup: () => null }));

const studio = { id: 'studio-1', name: '个人工作室', role: 'owner', displayName: '负责人' };
const project = { id: 'p-1', name: '云端验证', studio_id: 'studio-1', revision: 3 };
const scene = { schemaVersion: 1, venue: { shape: 'rectangle', width: 10, depth: 6, height: 3, entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral' };

const callbacks = {
  workbenchMode: 'layout' as WorkbenchMode,
  onOpenMaterials: vi.fn(), onSelectMode: vi.fn(), onOpenReview: vi.fn(),
  onOpenDelivery: vi.fn(), onFit: vi.fn(),
};

function harness(onApply = vi.fn()) {
  state.layout = makeLayout();
  state.view = makeViewSettings();
  state.apply = onApply;
  render(<LayoutAgentProvider onApplyResearchArea={vi.fn()} callbacks={callbacks} onPreview={vi.fn()} onApply={onApply}><AgentPanel activeAgent="space"/><VenuePickerOverlay/></LayoutAgentProvider>);
  return onApply;
}

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  snapshot.user = { id: 'me' };
  state.view = makeViewSettings();
  mocks.listStudios.mockResolvedValue([studio]);
  mocks.businessRequest.mockImplementation((path: string) => Promise.resolve(path.endsWith('/projects') ? [project] : []));
  mocks.getProject.mockResolvedValue({ ...project, scene });
  mocks.createProject.mockResolvedValue({ id: 'p-new', name: '新方案', studio_id: 'studio-1', revision: 1, scene });
});

afterEach(cleanup);

describe('VenuePicker（换场地 / 新建）', () => {
  it('空白开始：登录态建云项目并写本机地图草稿，整页进地图', async () => {
    render(<VenuePicker onClose={vi.fn()} />);
    await screen.findByRole('button', { name: /云端验证/ });
    fireEvent.click(screen.getByRole('button', { name: '开始规划' }));
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledWith('studio-1', '我的活动方案', expect.objectContaining({ schemaVersion: 1 })));
    expect(mocks.push).not.toHaveBeenCalled();
    const raw = localStorage.getItem('scendance-outdoor-plan-v1:p-new');
    expect(raw).toBeTruthy();
    const record = JSON.parse(raw!) as { plan: { boundary: unknown[] } };
    expect(record.plan.boundary).toHaveLength(0);
  });

  it('列出云项目，选中后同标签打开', async () => {
    render(<VenuePicker onClose={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button', { name: /云端验证/ }));
    await waitFor(() => expect(mocks.getProject).toHaveBeenCalledWith('p-1'));
    await screen.findByLabelText('场地俯视预览');
    fireEvent.click(screen.getByRole('button', { name: '开始规划' }));
    expect(mocks.push).toHaveBeenCalledWith('/editor/?project=p-1');
  });

  it('新建项目只输名字，建完写本机地图草稿并整页进地图', async () => {
    render(<VenuePicker onClose={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }));
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '春夏市集' } });
    fireEvent.click(screen.getByRole('button', { name: '开始规划' }));
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledWith('studio-1', '春夏市集', expect.objectContaining({ schemaVersion: 1 })));
    expect(mocks.push).not.toHaveBeenCalled();
    const raw = localStorage.getItem('scendance-outdoor-plan-v1:p-new');
    expect(raw).toBeTruthy();
    const record = JSON.parse(raw!) as { name: string; plan: { boundary: unknown[] } };
    expect(record.name).toBe('春夏市集');
    expect(record.plan.boundary).toHaveLength(0);
  });

  it('复刻示例：选中案例卡→一键建项目写入整套复刻案（锚点/区块/设施/流线/出入口齐全）', async () => {
    render(<VenuePicker onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /复刻示例/ }));
    // 默认选中首案（Scotiabank 冰球日）；确认选单里有它
    expect(await screen.findByRole('option', { name: /Scotiabank Hockey Day Canada/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始规划' }));
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalledWith('studio-1', '复刻示例 · Scotiabank Hockey Day Canada', expect.objectContaining({ schemaVersion: 1 })));
    expect(mocks.push).not.toHaveBeenCalled();
    const raw = localStorage.getItem('scendance-outdoor-plan-v1:p-new');
    expect(raw).toBeTruthy();
    const record = JSON.parse(raw!) as {
      name: string;
      plan: { anchor?: { lng: number; lat: number; source: string }; boundary: unknown[]; zones: unknown[]; facilities: unknown[]; routes: unknown[]; nodes: unknown[] };
    };
    expect(record.name).toBe('复刻示例 · Scotiabank Hockey Day Canada');
    expect(record.plan.anchor).toEqual({ lng: -123.370099, lat: 48.423153, crs: 'gcj-02', source: 'preset' });
    expect(record.plan.boundary.length).toBeGreaterThanOrEqual(3);
    expect(record.plan.zones.length).toBe(9);
    expect(record.plan.facilities.length).toBe(71);
    expect(record.plan.routes.length).toBeGreaterThanOrEqual(3);
    expect(record.plan.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it('从地图开始：选活动地点（天地图检索）→ 建云项目 → 本机户外标记带锚点', async () => {
    // Location 是 webidl [Unforgeable]，assign 无法 mock——整页跳转契约由
    // resolveOutdoorProjectId 单测（start=outdoor 命中）+ 浏览器实测覆盖，
    // 这里钉住跳转前的三件事：地点检索、云端建项目、本机户外标记落盘（含 anchor）。
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      places: [{ id: 'poi-1', name: '西湖十景(平湖秋月)', address: '西湖北部孤山南麓东端滨湖地带', lng: 120.146169, lat: 30.252176 }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<VenuePicker onClose={vi.fn()}/>);
      fireEvent.click(await screen.findByRole('button', { name: /从地图开始/ }));
      fireEvent.change(screen.getByLabelText('活动名称'), { target: { value: '西湖市集' } });
      fireEvent.change(screen.getByLabelText('活动地点'), { target: { value: '浙江省杭州 平湖秋月' } });
      const option = await screen.findByRole('option', { name: /平湖秋月/ }, { timeout: 3000 });
      fireEvent.click(option);
      expect(await screen.findByTestId('venue-place-picked')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: '开始规划' }));
      await waitFor(() => expect(mocks.createProject).toHaveBeenCalledWith('studio-1', '西湖市集', expect.objectContaining({ schemaVersion: 1 })));
      expect(mocks.push).not.toHaveBeenCalled();
      const raw = localStorage.getItem('scendance-outdoor-plan-v1:p-new');
      expect(raw).toBeTruthy();
      const record = JSON.parse(raw!) as {
        name: string;
        plan: { boundary: unknown[]; anchor?: { lng: number; lat: number; crs: string; source: string } };
      };
      expect(record.name).toBe('西湖市集');
      // 2026-11-11 拍板：起步 plan 零边界（边界由用户在 2D 里画），只带选点的地理锚点。
      expect(record.plan.boundary).toHaveLength(0);
      expect(record.plan.anchor).toEqual({ lng: 120.146169, lat: 30.252176, crs: 'gcj-02', source: 'picker' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('模糊建议栏：最近选过的地点先给建议，键盘 ↑↓ + Enter 选中', async () => {
    localStorage.setItem('scendance-place-recent-v1', JSON.stringify([
      { id: 'recent-1', name: '平湖秋月', address: '西湖北部孤山南麓', lng: 120.141439, lat: 30.254484 },
      { id: 'recent-2', name: '杭州大剧院', address: '上城区之江路', lng: 120.215334, lat: 30.244534 },
    ]));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ places: [] }), { status: 404, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<VenuePicker onClose={vi.fn()}/>);
      fireEvent.click(await screen.findByRole('button', { name: /从地图开始/ }));
      const input = screen.getByLabelText('活动地点') as HTMLInputElement;
      fireEvent.focus(input);
      const options = await screen.findAllByRole('option');
      expect(options.map(option => option.textContent)).toEqual([
        expect.stringContaining('平湖秋月'),
        expect.stringContaining('杭州大剧院'),
      ]);
      expect(screen.getAllByText('最近')).toHaveLength(2);
      // ↓ 落到第一条，再 ↓ 落到第二条，Enter 选中
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      const picked = await screen.findByTestId('venue-place-picked');
      expect(picked.textContent).toContain('杭州大剧院');
      expect(input.value).toBe('杭州大剧院');
      // 选中后写回最近列表，且新的排最前
      const recent = JSON.parse(localStorage.getItem('scendance-place-recent-v1')!) as { id: string }[];
      expect(recent.map(item => item.id)).toEqual(['recent-2', 'recent-1']);
      // Esc 收起建议栏（不关弹层）
      fireEvent.change(input, { target: { value: '杭州' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('模糊建议栏：输入只命中一部分时按相关度排，完全命中的在前', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      places: [
        { id: 'far', name: '杭州大剧院', address: '上城区之江路', lng: 120.215334, lat: 30.244534 },
        { id: 'near', name: '平湖秋月', address: '西湖北部孤山南麓', lng: 120.141439, lat: 30.254484 },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      render(<VenuePicker onClose={vi.fn()}/>);
      fireEvent.click(await screen.findByRole('button', { name: /从地图开始/ }));
      fireEvent.change(screen.getByLabelText('活动地点'), { target: { value: '平湖秋月' } });
      const options = await screen.findAllByRole('option', {}, { timeout: 3000 });
      expect(options[0]?.textContent).toContain('平湖秋月');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('访客看不到「从地图开始」（云就绪才显示）', () => {
    snapshot.user = null;
    render(<VenuePicker onClose={vi.fn()}/>);
    expect(screen.queryByRole('button', { name: /从地图开始/ })).toBeNull();
  });

  it('没有工作室时静默建「个人工作室」再列项目', async () => {
    mocks.listStudios.mockResolvedValue([]);
    mocks.businessRequest.mockImplementation((path: string, method?: string) => Promise.resolve(
      method === 'POST' && path === '/studios' ? studio : path.endsWith('/projects') ? [project] : []));
    render(<VenuePicker onClose={vi.fn()}/>);
    await screen.findByRole('button', { name: /云端验证/ });
    expect(mocks.businessRequest).toHaveBeenCalledWith('/studios', 'POST', expect.objectContaining({ name: '个人工作室' }));
  });

  it('访客只见「从空白开始」，不碰云端', () => {
    snapshot.user = null;
    render(<VenuePicker onClose={vi.fn()}/>);
    expect(screen.getByRole('button', { name: /从空白开始/ })).toBeTruthy();
    expect(screen.getByText(/登录后可接着上次的方案继续/)).toBeTruthy();
    expect(mocks.listStudios).not.toHaveBeenCalled();
  });

  it('从空间工具打开弹层，取消即关', async () => {
    harness();
    fireEvent.click(screen.getByRole('button', { name: '新建/换场地' }));
    expect(await screen.findByRole('dialog', { name: '换场地 / 新建' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '换场地 / 新建' })).toBeNull();
  });

  it('新建失败时弹层显示可读说明，而不是裸的 ROUTE_NOT_FOUND', async () => {
    mocks.createProject.mockRejectedValue(new SceneApiError('ROUTE_NOT_FOUND', 404, null));
    render(<VenuePicker onClose={vi.fn()} />);
    await screen.findByRole('button', { name: /云端验证/ });
    fireEvent.click(screen.getByRole('button', { name: '开始规划' }));
    const note = await screen.findByText('请求的接口不存在，这次操作没有发出。');
    expect(note.textContent).not.toBe('ROUTE_NOT_FOUND');
  });

  it('弹层里选空白开始，走地图草稿通路而不立室内壳', async () => {
    const onApply = harness();
    fireEvent.click(screen.getByRole('button', { name: '新建/换场地' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始规划' }));
    await waitFor(() => expect(mocks.createProject).toHaveBeenCalled());
    expect(onApply).not.toHaveBeenCalled();
  });
});
