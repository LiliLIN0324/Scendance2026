// @vitest-environment jsdom
/**
 * 右上角发布链 · publishVersion 集成测试（2026-11-20，集成任务）。
 *
 * 走真实 UI 路径：右上角分享钮 →「发布」页签 →「发布并复制链接」。
 * controller 用最小替身（BackendSession 的消费面），不建真实网络会话；
 * publishGateProvider 用 registerPublishGateProvider 注入，与生产同一条链。
 *
 * 覆盖主计划代表性复现：
 * - PUB-06/V08：发布请求体绑定入口捕获的 revision（4），不是读取时的最新值；
 * - V07/PUB-05：闸门快照 scopeId 与当前活动不一致时拒绝发布（防跨项目串台）；
 * - fail-closed：闸门 complete=false（缺口非空）时阻止发布并给缺口文案；
 * - 未挂云项目：不再把 layout.id 当云身份兜底发请求。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeFloor, makeLayout } from './lib/__testfixtures__/fixtures';
import { layoutStore } from './hooks/use-layout-store';
import { registerPublishGateProvider } from './lib/project-manifest';
import { INITIAL_LAYOUT } from './lib/initial-layout';
import { backendSceneToLayout, layoutToBackendScene } from './lib/backend-adapter';
import type { Scene } from '../../../supabase/functions/_shared/domain';
import { STORAGE_KEY } from './lib/constants';
import type { PublishGateSnapshot } from './lib/project-manifest';
import type { BackendProject, BackendSnapshot } from '@/lib/backend-session';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
// jsdom 没有 IndexedDB：本机点验账册读不出来会被当成「无法确认云转换不丢资料」而挡住保存链。
// 这里按「本机没有点验记录」处理——与真实浏览器里空账本的结果一致，不放宽任何云端守卫。
vi.mock('@/lib/material-checkin-storage', async original => {
  const actual = await original<typeof import('@/lib/material-checkin-storage')>();
  return { ...actual, readMaterialCheckins: async () => undefined };
});
// jsdom 没有 IndexedDB：本机图片/表单存储整条读不到。按「本机没有资料」处理，
// 让云端保存链能真正走到保存动作；不放宽任何云端守卫（点验账册仍按空账本判定）。
vi.mock('@/lib/source-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/source-storage')>();
  return {
    ...actual,
    readSourceRecord: vi.fn(async () => undefined),
    listStoredSources: vi.fn(async () => []),
    flushSourceScope: vi.fn(async () => undefined),
    copySourceScope: vi.fn(async () => undefined),
  };
});
import { RoomOrganizer } from './room-organizer';

const captured = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; body: unknown }>,
}));

function makeGate(scopeId: string, overrides: Partial<PublishGateSnapshot> = {}): PublishGateSnapshot {
  return {
    scopeId,
    projectId: 'proj-1',
    cloudRevision: 4,
    manifest: null,
    gaps: [],
    complete: true,
    readyForPublish: true,
    note: 'ok',
    conflict: null,
    ...overrides,
  };
}

/** 最小替身：getSnapshot/businessRequest 显式实现；其余方法 Proxy 兜底为 thenable 空结果。 */
function stubController(overrides: {
  snapshot?: Partial<BackendSnapshot>;
  respond?: (path: string, body: unknown) => unknown;
  /** P1（恢复入口）：真实保存链 / 取回编辑权链用到的后端方法，测试里显式断言它们被调用。 */
  methods?: Record<string, unknown>;
} = {}) {
  const baseSnapshot: BackendSnapshot = {
    configured: true,
    sessionId: 's1',
    user: { id: 'user-1' },
    recoveryReady: false,
    project: (overrides.snapshot?.project ?? { id: 'proj-1', name: '项目甲', studio_id: 'st-1', revision: 4, scene: null, materials: [] }) as BackendProject,
    lease: { projectId: 'proj-1', sessionId: 's1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 4 },
    revision: 4,
    draft: null,
    localRevision: 4,
    dirty: false,
    status: 'editing',
    writeBlocked: false,
    error: null,
    ...overrides.snapshot,
  };
  const businessRequest = vi.fn(async (path: string, _method: string, body: unknown) => {
    captured.requests.push({ path, body });
    if (path === '/assets') return []; // 物料面板列表：空数组即可，别让 assets.filter 崩。
    return overrides.respond
      ? overrides.respond(path, body)
      : { shareId: '11111111-1111-4111-8111-111111111111', publicationId: '22222222-2222-4222-8222-222222222222', revision: 4, createdAt: new Date().toISOString(), url: 'https://stub.local/view/#' + 'a'.repeat(64), token: 'a'.repeat(64) };
  });
  const EMPTY_ASYNC = { assetUrls: {}, assetNames: {}, items: [], list: [], providers: [], models: [], ok: true, revision: 0 };
  const stub: Record<string, unknown> = {
    config: { configured: true, url: 'https://stub.local', anonKey: 'k', apiUrl: 'https://stub.local/f/scene-api' },
    // 快照可改：登录回来 / 云端确认版本后，测试要能改这份唯一事实源再触发一次预检。
    __snapshot: baseSnapshot,
    getSnapshot: () => baseSnapshot,
    subscribe: () => () => undefined,
    retain: () => () => undefined,
    release: () => undefined,
    localDraftAuthorityVersion: () => '0:0',
    isGeometryBound: () => false,
    businessRequest,
    ...(overrides.methods ?? {}),
  };
  const cache = new Map<string, unknown>();
  return new Proxy(stub, {
    get(target, prop: string | symbol) {
      if (typeof prop !== 'string') return Reflect.get(target, prop);
      if (prop in target) return target[prop];
      if (!cache.has(prop)) {
        // 组件树其余消费统一拿到 thenable 空结果；仅测试替身使用，不进生产。
        cache.set(prop, vi.fn(async () => structuredClone(EMPTY_ASYNC)));
      }
      return cache.get(prop);
    },
  }) as unknown as import('@/lib/backend-session').BackendSession;
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // jsdom 缺 scrollTo：agent-panel 钉底滚动 effect 需要（既有套件同款桩，见 use-outdoor-agent-workflow 测试）。
  Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: () => undefined });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  captured.requests = [];
  localStorage.clear();
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});

afterEach(() => {
  cleanup();
  registerPublishGateProvider(null);
  layoutStore.setState({ layout: INITIAL_LAYOUT, activeFloorIndex: 0 });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function primeLayout(id: string) {
  // 场地显式写成矩形：默认壳体是多边形地图（西湖），云端保存链按契约拒收多边形场地。
  // 这里把它压成矩形云场地，和「已挂云项目」的起点一致。
  const layout = makeLayout({
    id, name: '发布链测试活动', width: 12, height: 9, roof: { style: 'none' }, floors: [makeFloor({ id: 'f', items: [] })],
    backendVenue: { shape: 'rectangle', width: 12, depth: 9, height: 3, entrances: [] },
  });
  layoutStore.setState({ layout, activeFloorIndex: 0 });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  return layout;
}

/**
 * 云项目起点：真实云项目是 v2 场景，场地是矩形。
 * 默认壳体（西湖多边形地图）按契约不能存云端（多边形场地未接入），所以这里用 v2 场景起步，
 * 让保存链能真正跑到 controller.saveScene / createProject。
 */
function cloudScene(): Scene {
  return {
    schemaVersion: 2,
    venue: { shape: 'rectangle', width: 12, depth: 9, height: 3, entrances: [] },
    objects: [],
    structure: { walls: [], openings: [], columns: [] },
    sources: [],
    dimensions: [],
    camera: 'overview',
    lighting: 'neutral',
  } as unknown as Scene;
}

function primeCloudLayout(id: string) {
  const scene = cloudScene();
  const layout = { ...backendSceneToLayout(scene, { projectId: id, name: '发布链测试活动' }), id, name: '发布链测试活动' };
  layoutStore.setState({ layout, activeFloorIndex: 0 });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  return layout;
}

async function openPublishTab() {
  fireEvent.click(await screen.findByRole('button', { name: '分享' }, { timeout: 20000 }));
  fireEvent.click(await screen.findByRole('tab', { name: '发布' }));
}

async function clickPublish() {
  // 预检进行中不显示主按钮，庄重环境渲染较慢：等同「检查完再点」，与用户实际顺序一致。
  const cta = await screen.findByRole('button', { name: '发布并复制链接' }, { timeout: 10000 });
  fireEvent.click(cta);
}

// provider 注册顺序：RoomOrganizer 挂载时会在 effect 里注册真实 provider（后注册者生效）；
// 测试在 render 之后注册替身，确保发布链读到的是本用例的闸门快照。
it('publishes with the captured revision and hands the server url (V08/PUB-06 主链)', async () => {
  primeLayout('pub-a');
  const controller = stubController();
  render(<RoomOrganizer controller={controller} />);
  registerPublishGateProvider(async () => makeGate('pub-a'));
  await openPublishTab();
  await act(async () => { await clickPublish(); });
  await waitFor(() => expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(1));
  const request = captured.requests.find(r => r.path.includes('/publish'))!;
  // expectedRevision 绑定入口捕获的 4（替身 snapshot.revision），不是读取时的新值。
  expect(request.body).toEqual({ expectedRevision: 4 });
  // 成功后交付行出现（服务端返回的 url）；两个 ShareMenu 挂载点都可能渲染，按计数断言。
  expect((await screen.findAllByTestId('share-link-row')).length).toBeGreaterThan(0);
  expect(screen.getAllByTitle('https://stub.local/view/#' + 'a'.repeat(64)).length).toBeGreaterThan(0);
}, 30000);

it('refuses publishing when the gate snapshot belongs to another activity (V07/PUB-05)', async () => {
  primeLayout('pub-b');
  const controller = stubController();
  render(<RoomOrganizer controller={controller} />);
  // 闸门快照的 scopeId 与当前活动不一致：模拟「发布等待中切了项目」的迟到状态。
  registerPublishGateProvider(async () => makeGate('pub-other'));
  await openPublishTab();
  await act(async () => { await clickPublish(); });
  // 拒绝发布：不发请求，面板提示切换。
  await waitFor(() => expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0));
  expect((await screen.findAllByText('活动已切换，请回到要发布的项目里重新发布。')).length).toBeGreaterThan(0);
}, 30000);

it('blocks publishing with gap names when the archive gate is incomplete (fail-closed)', async () => {
  primeLayout('pub-c');
  const controller = stubController();
  render(<RoomOrganizer controller={controller} />);
  registerPublishGateProvider(async () => makeGate('pub-c', {
    complete: false,
    gaps: [{ localId: 'scan-1', kind: 'scan', name: '西湖 0233 · 极速档', reason: 'not-uploaded' }],
  }));
  await openPublishTab();
  await act(async () => { await clickPublish(); });
  await waitFor(() => expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0));
  expect((await screen.findAllByText(/西湖 0233 · 极速档/)).length).toBeGreaterThan(0);
}, 30000);

it('does not treat layout.id as a cloud project id when unbound (PUB-02)', async () => {
  primeLayout('pub-d');
  const controller = stubController({ snapshot: { project: null, lease: null, revision: null } });
  render(<RoomOrganizer controller={controller} />);
  registerPublishGateProvider(async () => makeGate('pub-d'));
  await openPublishTab();
  await act(async () => { await clickPublish(); });
  // 未挂云项目：报「保存云项目」而不是拿 layout.id 发 /publish。
  await waitFor(() => expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0));
  expect((await screen.findAllByText('这份方案还没挂到项目上，保存云项目后再发布。')).length).toBeGreaterThan(0);
}, 30000);

// ---------------------------------------------------------------------------
// P1（恢复入口，2026-11-20）：预检阻塞动作接真实链路。
// 每条恢复动作都只落盘 / 取权 / 切视图，绝不触发发布——下面每条用例都断言这一点。
// ---------------------------------------------------------------------------

/** 快照是唯一事实源：登录回来、云端确认版本后改这份，再触发一次预检。 */
function stubSnapshot(controller: unknown): BackendSnapshot {
  return (controller as unknown as { __snapshot: BackendSnapshot }).__snapshot;
}

it('V01: 未登录的预检给「去登录」；登录回来只重查，不会自动发布', async () => {
  primeLayout('pub-v01');
  const controller = stubController({ snapshot: { user: null, project: null, lease: null, revision: null } });
  render(<RoomOrganizer controller={controller} />);
  registerPublishGateProvider(async () => makeGate('pub-v01'));
  await openPublishTab();
  const login = await screen.findByRole('button', { name: '去登录' });
  await act(async () => { fireEvent.click(login); });
  // 走既有登录入口：账户中心登录浮窗打开，登录表单在。
  await waitFor(() => expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true));
  expect(screen.getAllByRole('button', { name: '登录并进入工作台' }).length).toBeGreaterThan(0);
  // 登录动作不触发发布。
  expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0);
  // 登录回来：账号恢复后重新点「发布」页签 → 原地重查（未登录阻塞项消失）。
  stubSnapshot(controller).user = { id: 'user-1' };
  await act(async () => { fireEvent.click(await screen.findByRole('tab', { name: '发布' })); });
  await waitFor(() => expect(screen.queryByRole('button', { name: '去登录' })).toBeNull());
  // 依然没有自动发布。
  expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0);
}, 30000);

it('V02: 本地草稿还没挂云项目时，预检给「保存为云项目」；点它走既有的创建云项目链，不发布', async () => {
  primeCloudLayout('pub-v02');
  const createProject = vi.fn(async (studioId: string, name: string, scene: unknown) => ({ id: 'proj-new', name, studio_id: studioId, revision: 1, scene, materials: [] }));
  const acquireLease = vi.fn(async (projectId: string) => ({ projectId, sessionId: 's1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 1, scene: layoutToBackendScene(layoutStore.getState().layout) }));
  const controller = stubController({ snapshot: { project: null, lease: null, revision: null, dirty: false }, methods: { createProject, acquireLease } });
  render(<RoomOrganizer controller={controller} />);
  registerPublishGateProvider(async () => makeGate('pub-v02'));
  await openPublishTab();
  const saveProject = await screen.findByRole('button', { name: '保存为云项目' });
  await act(async () => { fireEvent.click(saveProject); });
  // 走的是项目卡里既有的「存为方案」链（createProject），没有另造保存接口。
  await waitFor(() => expect(createProject).toHaveBeenCalled());
  expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0);
}, 30000);

it('V03: 有未保存修改时，预检给「保存当前修改」；点它走既有保存链，保存后按新版本重查', async () => {
  primeCloudLayout('proj-1');
  let controllerRef: import('@/lib/backend-session').BackendSession | null = null;
  const saveScene = vi.fn(async () => {
    const snapshot = stubSnapshot(controllerRef);
    snapshot.revision = 5;
    snapshot.dirty = false;
    snapshot.project = { ...(snapshot.project as BackendProject), revision: 5 };
    return { revision: 5, updatedAt: new Date().toISOString(), warnings: [] };
  });
  const controller = stubController({ snapshot: { revision: null, dirty: false }, methods: { saveScene } });
  controllerRef = controller;
  render(<RoomOrganizer controller={controller} />);
  registerPublishGateProvider(async () => makeGate('proj-1'));
  await openPublishTab();
  const save = await screen.findByRole('button', { name: '保存当前修改' });
  await act(async () => { fireEvent.click(save); });
  await new Promise(resolve => setTimeout(resolve, 600));
  // 走的是既有保存链：素材上云 → controller.saveScene（与自动保存同一条链）。
  await waitFor(() => expect(saveScene).toHaveBeenCalled());
  expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0);
  // 保存完成后重新核对本次版本：未保存阻塞项消失，状态行报新版本。
  await act(async () => { fireEvent.click(await screen.findByRole('tab', { name: '发布' })); });
  await waitFor(() => expect(screen.queryByRole('button', { name: '保存当前修改' })).toBeNull());
  expect((await screen.findAllByText(/已保存到云端 · 版本 5/)).length).toBeGreaterThan(0);
}, 30000);

it('V06: 编辑权被收回时，预检给「取回编辑权」；点它走既有取权入口，重查后授权恢复，且不发布', async () => {
  primeCloudLayout('proj-1');
  let controllerRef: import('@/lib/backend-session').BackendSession | null = null;
  const acquireLease = vi.fn(async (projectId: string, validate?: (scene: unknown, project: unknown) => void) => {
    const scene = layoutToBackendScene(layoutStore.getState().layout);
    const project = { id: projectId, name: '项目甲', studio_id: 'st-1', revision: 4, scene, materials: [] };
    validate?.(scene, project);
    const snapshot = stubSnapshot(controllerRef);
    snapshot.lease = { projectId, sessionId: 's1', generation: 2, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 4 };
    snapshot.writeBlocked = false;
    return { projectId, sessionId: 's1', generation: 2, expiresAt: snapshot.lease.expiresAt, revision: 4, scene };
  });
  const controller = stubController({
    snapshot: {
      writeBlocked: true, lease: null, dirty: false,
      project: { id: 'proj-1', name: '项目甲', studio_id: 'st-1', revision: 4, scene: cloudScene(), materials: [] },
    },
    methods: { acquireLease },
  });
  controllerRef = controller;
  render(<RoomOrganizer controller={controller} />);
  registerPublishGateProvider(async () => makeGate('proj-1'));
  await openPublishTab();
  const grant = await screen.findByRole('button', { name: '取回编辑权' });
  await act(async () => { fireEvent.click(grant); });
  // 走的是既有取权入口（acquireLease），与项目卡上点当前项目同一条链。
  await waitFor(() => expect(acquireLease).toHaveBeenCalled());
  expect(acquireLease.mock.calls[0]?.[0]).toBe('proj-1');
  expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0);
  // 处理后重新检查授权：只读阻塞项消失。
  await act(async () => { fireEvent.click(await screen.findByRole('tab', { name: '发布' })); });
  await waitFor(() => expect(screen.queryByRole('button', { name: '取回编辑权' })).toBeNull());
}, 30000);

it('V06: 版本冲突时预检给「处理版本冲突」；点它只把户外提示露出来，不发布、不自动择一', async () => {
  primeLayout('proj-1');
  const controller = stubController({ snapshot: { dirty: false } });
  render(<RoomOrganizer controller={controller} />);
  registerPublishGateProvider(async () => makeGate('proj-1', { conflict: { remoteRevision: 7, remoteName: '队友那版' } }));
  await openPublishTab();
  const conflict = await screen.findByRole('button', { name: '处理版本冲突' });
  await act(async () => { fireEvent.click(conflict); });
  // 冲突没处理完就不发布。
  expect(captured.requests.filter(r => r.path.includes('/publish'))).toHaveLength(0);
  // 既有处理入口被露出来：户外提示里的「用我这版 / 用服务器那版」由用户自己选，不自动择一。
  expect((await screen.findAllByText(/已切到户外地图/)).length).toBeGreaterThan(0);
  expect((await screen.findAllByText(/存在版本冲突/)).length).toBeGreaterThan(0);
}, 30000);
