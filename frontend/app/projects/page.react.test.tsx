// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectsPage from './page';

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), listStudios: vi.fn(), listProjects: vi.fn(), businessRequest: vi.fn(), createProject: vi.fn() }));
const snapshot: { user: { id: string }; writeBlocked: boolean; project: { id: string; name: string } | null; error: null } = { user: { id: 'my-account' }, writeBlocked: true, project: null, error: null };
const controller = { ...mocks, subscribe: () => () => {}, getSnapshot: () => snapshot };
vi.mock('@/lib/auth-provider', () => ({ useAuth: () => ({ ready: true, controller }) }));
vi.mock('@/lib/backend-session', () => ({ useBackendSession: () => snapshot }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
const studios = [{ id: 'studio-a', name: '工作室 A', role: 'owner' }, { id: 'studio-b', name: '工作室 B', role: 'owner' }];

beforeEach(() => {
  vi.clearAllMocks();
  snapshot.writeBlocked = true; snapshot.project = null;
  mocks.listStudios.mockResolvedValue(studios);
  mocks.listProjects.mockResolvedValue([]);
  mocks.businessRequest.mockResolvedValue([]);
});
afterEach(cleanup);

describe('workspace integration', () => {
  it('requires handing off the current lease before linking to another project', async () => {
    snapshot.writeBlocked = false; snapshot.project = { id: 'project-a', name: '当前方案' };
    mocks.listProjects.mockResolvedValue([{ id: 'project-b', studio_id: 'studio-a', name: '另一个方案', revision: 1 }]);
    render(<ProjectsPage />);
    await screen.findByText('另一个方案');
    expect(screen.queryByRole('link', { name: '打开方案 ↗' })).toBeNull();
    expect(screen.getByText('请先释放当前项目的编辑权')).toBeTruthy();
  });
  it('locks the studio selector while a member change is pending', async () => {
    render(<ProjectsPage />);
    await screen.findByRole('option', { name: '工作室 A' });
    let complete!: (value: unknown) => void;
    mocks.businessRequest.mockImplementation((_path, method) => method === 'PUT' ? new Promise(resolve => { complete = resolve; }) : Promise.resolve([]));
    fireEvent.change(screen.getByLabelText('成员账号 ID'), { target: { value: 'account-b' } });
    fireEvent.change(screen.getByLabelText('成员显示名'), { target: { value: '队友' } });
    fireEvent.submit(screen.getByRole('button', { name: '添加编辑成员' }).closest('form')!);
    await waitFor(() => expect((screen.getByLabelText('工作室') as HTMLSelectElement).disabled).toBe(true));
    expect(mocks.businessRequest).toHaveBeenCalledWith('/studios/studio-a/members/account-b', 'PUT', { displayName: '队友' });
    complete({});
    await waitFor(() => expect((screen.getByLabelText('工作室') as HTMLSelectElement).disabled).toBe(false));
  });

  it('selects an accessible studio before refreshing its member list', async () => {
    render(<ProjectsPage />);
    await screen.findByRole('option', { name: '工作室 A' });
    mocks.listStudios.mockResolvedValue([studios[1]]);
    mocks.businessRequest.mockClear();
    mocks.businessRequest.mockImplementation(path => path.includes('studio-a') ? Promise.reject(new Error('STUDIO_NOT_FOUND')) : Promise.resolve([]));
    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }));
    await waitFor(() => expect((screen.getByLabelText('工作室') as HTMLSelectElement).value).toBe('studio-b'));
    expect(mocks.businessRequest.mock.calls.every(([path]) => !String(path).includes('studio-a'))).toBe(true);
  });

  it('creates a metre-based scene and opens the returned project ID', async () => {
    mocks.createProject.mockResolvedValue({ id: 'new-project' });
    render(<ProjectsPage />);
    await screen.findByRole('option', { name: '工作室 A' });
    fireEvent.submit(screen.getByRole('button', { name: '创建并打开' }).closest('form')!);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/editor/?project=new-project'));
    expect(mocks.createProject).toHaveBeenCalledWith('studio-a', '我的活动方案', expect.objectContaining({
      venue: { shape: 'rectangle', width: 12, depth: 10, height: 3, entrances: [] }, objects: [], schemaVersion: 1,
    }));
  });
});
