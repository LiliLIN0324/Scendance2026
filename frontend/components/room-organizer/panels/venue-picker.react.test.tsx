// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout, makeViewSettings } from '../lib/__testfixtures__/fixtures';
import { AgentPanel, LayoutAgentProvider, VenuePickerOverlay } from './agent-panel';
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
vi.mock('@/lib/backend-session', () => ({ useBackendSession: () => snapshot }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

const state = vi.hoisted(() => ({ layout: null as unknown as RoomLayout, apply: vi.fn(), view: null as unknown, setView: vi.fn() }));
const studioMock = vi.hoisted(() => ({
  exportActivity: vi.fn(async () => {}),
  generate: vi.fn(async () => {}),
  discardPreview: vi.fn(),
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
  it('空白场地默认选中，「开始布置」走本机立壳', () => {
    const onBlankVenue = vi.fn();
    render(<VenuePicker onClose={vi.fn()} onBlankVenue={onBlankVenue}/>);
    fireEvent.click(screen.getByRole('button', { name: '开始布置' }));
    expect(onBlankVenue).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('列出云项目，选中后同标签打开', async () => {
    render(<VenuePicker onClose={vi.fn()} onBlankVenue={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button', { name: /云端验证/ }));
    await waitFor(() => expect(mocks.getProject).toHaveBeenCalledWith('p-1'));
    await screen.findByLabelText('场地俯视预览');
    fireEvent.click(screen.getByRole('button', { name: '开始布置' }));
    expect(mocks.push).toHaveBeenCalledWith('/editor/?project=p-1');
  });

  it('新建项目只输名字，建完同标签打开', async () => {
    render(<VenuePicker onClose={vi.fn()} onBlankVenue={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button', { name: /新建项目/ }));
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: '春夏市集' } });
    fireEvent.click(screen.getByRole('button', { name: '开始布置' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/editor/?project=p-new'));
    expect(mocks.createProject).toHaveBeenCalledWith('studio-1', '春夏市集', expect.objectContaining({ schemaVersion: 1 }));
  });

  it('没有工作室时静默建「个人工作室」再列项目', async () => {
    mocks.listStudios.mockResolvedValue([]);
    mocks.businessRequest.mockImplementation((path: string, method?: string) => Promise.resolve(
      method === 'POST' && path === '/studios' ? studio : path.endsWith('/projects') ? [project] : []));
    render(<VenuePicker onClose={vi.fn()} onBlankVenue={vi.fn()}/>);
    await screen.findByRole('button', { name: /云端验证/ });
    expect(mocks.businessRequest).toHaveBeenCalledWith('/studios', 'POST', expect.objectContaining({ name: '个人工作室' }));
  });

  it('访客只见「从空白开始」，不碰云端', () => {
    snapshot.user = null;
    render(<VenuePicker onClose={vi.fn()} onBlankVenue={vi.fn()}/>);
    expect(screen.getByRole('button', { name: /从空白开始/ })).toBeTruthy();
    expect(screen.getByText(/登录后可接着上次的方案继续/)).toBeTruthy();
    expect(mocks.listStudios).not.toHaveBeenCalled();
  });

  it('从「你可以做什么」chip 打开弹层，取消即关', async () => {
    harness();
    fireEvent.click(screen.getByRole('button', { name: '新建/换场地' }));
    expect(await screen.findByRole('dialog', { name: '换场地 / 新建' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '换场地 / 新建' })).toBeNull();
  });

  it('弹层里选空白场地，开始布置 = 现有立壳链', async () => {
    const onApply = harness();
    fireEvent.click(screen.getByRole('button', { name: '新建/换场地' }));
    fireEvent.click(await screen.findByRole('button', { name: '开始布置' }));
    expect(onApply).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '换场地 / 新建' })).toBeNull();
  });
});
