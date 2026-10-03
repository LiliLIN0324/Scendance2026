// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProjectsPage from './page';

const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), listStudios: vi.fn(), businessRequest: vi.fn(), createProject: vi.fn() }));
const snapshot: { user: { id: string }; writeBlocked: boolean; project: { id: string; name: string } | null; error: null } = { user: { id: 'my-account' }, writeBlocked: true, project: null, error: null };
const controller = { ...mocks, subscribe: () => () => {}, getSnapshot: () => snapshot };
vi.mock('@/lib/auth-provider', () => ({ useAuth: () => ({ ready: true, controller }) }));
vi.mock('@/lib/backend-session', () => ({ useBackendSession: () => snapshot }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
const studios = [{ id: 'studio-a', name: '工作室 A', role: 'owner' }, { id: 'studio-b', name: '工作室 B', role: 'owner' }];
let projects: { id: string; studio_id: string; name: string; revision: number }[];
const members = [{ userId: 'my-account', displayName: '负责人 A', role: 'owner' }, { userId: 'teammate', displayName: '设计师 A', role: 'editor' }];
function read(path: string) {
  return path.endsWith('/projects') ? projects.filter(project => path.includes(project.studio_id)) : path.includes('studio-a') ? members : [];
}
async function ready() { await screen.findByText('这个工作室还没有项目'); }
function openPanel(name: string) { fireEvent.click(within(screen.getByRole('navigation', { name: '工作室管理' })).getByRole('button', { name: new RegExp(name) })); }
function changeStudio(value: string) { fireEvent.change(screen.getByLabelText('工作室'), { target: { value } }); }

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  snapshot.user = { id: 'my-account' }; snapshot.writeBlocked = true; snapshot.project = null;
  projects = [];
  mocks.listStudios.mockResolvedValue(studios);
  mocks.businessRequest.mockImplementation(path => Promise.resolve(read(path)));
});
afterEach(cleanup);

describe('workspace management', () => {
  it('requires handing off the current lease before linking to another project', async () => {
    snapshot.writeBlocked = false; snapshot.project = { id: 'project-a', name: '当前方案' };
    projects = [{ id: 'project-b', studio_id: 'studio-a', name: '另一个方案', revision: 1 }];
    render(<ProjectsPage />);
    await screen.findByText('另一个方案');
    expect(screen.queryByRole('link', { name: '打开方案 ↗' })).toBeNull();
    expect(screen.getByText('请先释放当前项目的编辑权')).toBeTruthy();
  });
  it('shows project ownership and inherited participants without mixing workspaces', async () => {
    projects = [{ id: 'project-a', studio_id: 'studio-a', name: '发布会方案', revision: 1 }, { id: 'project-b', studio_id: 'studio-b', name: '其他团队的方案', revision: 2 }];
    render(<ProjectsPage />);
    fireEvent.click(await screen.findByText('发布会方案'));
    expect(screen.getByText('所属工作室')).toBeTruthy();
    expect(screen.getByText('设计师 A')).toBeTruthy();
    expect(screen.queryByText('其他团队的方案')).toBeNull();
    changeStudio('studio-b');
    expect(screen.queryByText('设计师 A')).toBeNull();
    await screen.findByText('其他团队的方案');
    expect(screen.queryByText('发布会方案')).toBeNull();
  });
  it('locks the studio selector while a member change is pending', async () => {
    render(<ProjectsPage />); await ready(); openPanel('成员');
    let complete!: (value: unknown) => void;
    mocks.businessRequest.mockImplementation((path, method) => method === 'PUT' ? new Promise(resolve => { complete = resolve; }) : Promise.resolve(read(path)));
    fireEvent.change(screen.getByLabelText('成员账号 ID'), { target: { value: 'account-b' } });
    fireEvent.change(screen.getByLabelText('成员显示名'), { target: { value: '队友' } });
    fireEvent.click(screen.getByRole('button', { name: '添加编辑成员' }));
    await waitFor(() => expect((screen.getByLabelText('工作室') as HTMLSelectElement).disabled).toBe(true));
    expect(mocks.businessRequest).toHaveBeenCalledWith('/studios/studio-a/members/account-b', 'PUT', { displayName: '队友' });
    await act(async () => complete({}));
    await waitFor(() => expect((screen.getByLabelText('工作室') as HTMLSelectElement).disabled).toBe(false));
  });
  it('selects an accessible studio before refreshing its member list', async () => {
    render(<ProjectsPage />); await ready();
    mocks.listStudios.mockResolvedValue([studios[1]]);
    mocks.businessRequest.mockClear();
    mocks.businessRequest.mockImplementation(path => path.includes('studio-a') ? Promise.reject(new Error('STUDIO_NOT_FOUND')) : Promise.resolve([]));
    fireEvent.click(screen.getByRole('button', { name: '刷新列表' }));
    await waitFor(() => expect((screen.getByLabelText('工作室') as HTMLSelectElement).value).toBe('studio-b'));
    await ready();
    expect(mocks.businessRequest.mock.calls.every(([path]) => !String(path).includes('studio-a'))).toBe(true);
  });
  it('creates a metre-based scene in the selected studio and opens the returned project ID', async () => {
    mocks.createProject.mockResolvedValue({ id: 'new-project' });
    render(<ProjectsPage />); await ready(); changeStudio('studio-b'); await ready();
    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    fireEvent.click(screen.getByRole('button', { name: '创建并打开' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/editor/?project=new-project'));
    expect(mocks.createProject).toHaveBeenCalledWith('studio-b', '我的活动方案', expect.objectContaining({
      venue: { shape: 'rectangle', width: 12, depth: 10, height: 3, entrances: [] }, objects: [], schemaVersion: 1,
    }));
  });
  it('renames a studio while preserving its selection and project IDs', async () => {
    render(<ProjectsPage />); await ready(); openPanel('设置');
    mocks.businessRequest.mockImplementation((path, method) => method === 'PATCH' ? Promise.resolve({ ...studios[0], name: '拾光工作室' }) : Promise.resolve(read(path)));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: ' 拾光工作室 ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));
    await screen.findByRole('option', { name: '拾光工作室' });
    expect(mocks.businessRequest).toHaveBeenCalledWith('/studios/studio-a', 'PATCH', { name: '拾光工作室' });
    expect((screen.getByLabelText('工作室') as HTMLSelectElement).value).toBe('studio-a');
  });
  it('disables deleting a nonempty workspace', async () => {
    projects = [{ id: 'project-a', studio_id: 'studio-a', name: '有内容的项目', revision: 0 }];
    render(<ProjectsPage />); await screen.findByText('有内容的项目'); openPanel('设置');
    expect((screen.getByRole('button', { name: '删除工作室' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/还有 1 个项目/)).toBeTruthy();
  });
  it('requires the exact name and switches workspace only after a successful delete', async () => {
    render(<ProjectsPage />); await ready(); openPanel('设置');
    fireEvent.click(screen.getByRole('button', { name: '删除工作室' }));
    expect((screen.getByRole('button', { name: '永久删除' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('输入工作室名称「工作室 A」以确认'), { target: { value: '工作室 A' } });
    mocks.businessRequest.mockImplementation((path, method) => method === 'DELETE' ? Promise.reject(new Error('工作室中仍有项目')) : Promise.resolve(read(path)));
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await screen.findByText('工作室中仍有项目');
    expect((screen.getByLabelText('工作室') as HTMLSelectElement).value).toBe('studio-a');
    mocks.businessRequest.mockImplementation((path, method) => method === 'DELETE' ? Promise.resolve({ removed: true }) : Promise.resolve(read(path)));
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await screen.findByText('工作室「工作室 A」已删除。');
    expect((screen.getByLabelText('工作室') as HTMLSelectElement).value).toBe('studio-b');
    expect(screen.queryByRole('option', { name: '工作室 A' })).toBeNull();
  });
  it('hides owner actions from editors', async () => {
    mocks.listStudios.mockResolvedValue([{ ...studios[0], role: 'editor' }]);
    render(<ProjectsPage />); await ready(); openPanel('设置');
    expect(screen.queryByRole('button', { name: '删除工作室' })).toBeNull();
    expect(screen.queryByRole('button', { name: '保存名称' })).toBeNull();
    openPanel('成员');
    expect(screen.queryByRole('button', { name: '添加编辑成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '移除' })).toBeNull();
  });
  it('ignores a late response from the previously selected studio', async () => {
    let resolveMembers!: (value: unknown) => void;
    mocks.businessRequest.mockImplementation(path => path === '/studios/studio-a/members' ? new Promise(resolve => { resolveMembers = resolve; }) : Promise.resolve(read(path)));
    render(<ProjectsPage />); await screen.findByRole('option', { name: '工作室 A' });
    changeStudio('studio-b'); await ready(); openPanel('成员');
    await act(async () => resolveMembers(members));
    expect(screen.queryByText('设计师 A')).toBeNull();
  });
  it('remembers selection for this account and ignores inaccessible saved studios', async () => {
    const first = render(<ProjectsPage />); await ready(); changeStudio('studio-b'); await ready(); first.unmount();
    const second = render(<ProjectsPage />); await ready();
    expect((screen.getByLabelText('工作室') as HTMLSelectElement).value).toBe('studio-b'); second.unmount();
    mocks.listStudios.mockResolvedValue([studios[0]]);
    render(<ProjectsPage />); await ready();
    expect((screen.getByLabelText('工作室') as HTMLSelectElement).value).toBe('studio-a');
  });
  it('provides a create action when the last workspace was deleted', async () => {
    mocks.listStudios.mockResolvedValue([studios[0]]);
    render(<ProjectsPage />); await ready(); openPanel('设置');
    fireEvent.click(screen.getByRole('button', { name: '删除工作室' }));
    fireEvent.change(screen.getByLabelText('输入工作室名称「工作室 A」以确认'), { target: { value: '工作室 A' } });
    mocks.businessRequest.mockResolvedValue({ removed: true });
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }));
    await screen.findByText('从一个工作室开始');
    fireEvent.click(screen.getByRole('button', { name: '创建工作室' }));
    expect(screen.getByLabelText('工作室名称')).toBeTruthy();
  });
});
