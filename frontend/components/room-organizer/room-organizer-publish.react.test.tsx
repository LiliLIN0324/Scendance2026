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
import { STORAGE_KEY } from './lib/constants';
import type { PublishGateSnapshot } from './lib/project-manifest';
import type { BackendProject, BackendSnapshot } from '@/lib/backend-session';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
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
    getSnapshot: () => baseSnapshot,
    subscribe: () => () => undefined,
    retain: () => () => undefined,
    release: () => undefined,
    localDraftAuthorityVersion: () => '0:0',
    isGeometryBound: () => false,
    businessRequest,
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
  const layout = makeLayout({ id, name: '发布链测试活动', width: 12, height: 9, roof: { style: 'none' }, floors: [makeFloor({ id: 'f', items: [] })] });
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
