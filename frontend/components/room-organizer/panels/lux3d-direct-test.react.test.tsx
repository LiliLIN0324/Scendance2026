// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAholoCatalogItem } from '../lib/aholo-model-placement';
import { Lux3dDirectTest } from './lux3d-direct-test';
import type { CatalogItem } from '../lib/types';

// 摆放链路本身有独立的真实测试；这里只验证面板把它接对。
vi.mock('../lib/aholo-model-placement', () => ({ loadAholoCatalogItem: vi.fn() }));

const STORAGE_KEY = 'scendance:lux3d-direct-task';
const HISTORY_KEY = 'scendance:aholo-history';
const HISTORY_FIELDS = ['at', 'kind', 'label', 'prompt', 'startedAt', 'status', 'taskid'] as const;
type HistoryItem = { kind: string; taskid: string; prompt: string; startedAt: number; status: number; label: string; at: number };
const PROMPT = '一张白色圆桌';
const TASK_ID = '4425274';
const NOW = new Date('2026-10-22T08:00:00Z').getTime();
const GLB_URL = 'https://cdn.example.test/textured.glb?signature=glb-secret';
const ZIP_URL = 'https://cdn.example.test/result.zip?signature=zip-secret';
const IMAGE_ID = '4425275';
const WORLD_ID = 'WorldAbC123';
const WORLD_NAME = '午后咖啡馆';
const WORLD_PROMPT = '木质咖啡馆，大窗户，午后阳光';
const IMAGE_NAME = 'reference.png';
const IMAGE_DATA = 'data:image/png;base64,aW1hZ2UtcHJpdmF0ZS1ieXRlcw==';
const PANO_URL = 'https://cdn.example.test/panorama.jpg?signature=pano-secret';
const PLY_URL = 'https://cdn.example.test/scene.ply?signature=ply-secret';
const SPZ_URL = 'https://cdn.example.test/scene.spz?signature=spz-secret';
const LOD_URL = 'https://cdn.example.test/lod.json?signature=lod-secret';
const ASSET_ID = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
const LOCAL_GLB = `http://127.0.0.1:3199/asset/${ASSET_ID}.glb`;
const PLACED_ITEM: CatalogItem = {
  type: 'glb-asset', name: PROMPT, width: 1.2, depth: 1.2, height: 0.75, color: '#ffffff',
  icon: '◇', price: 0, category: 'decor', source: 'generated', materialId: 'asset',
  assetId: ASSET_ID, glbUrl: LOCAL_GLB,
};
const CAPABILITY_CASES = [
  { kind: 'text', tab: '文字建模', id: TASK_ID, prefix: 'scendance:lux3d-direct', prompt: PROMPT, idLabel: 'Aholo 任务号' },
  { kind: 'image', tab: '图片建模', id: IMAGE_ID, prefix: 'scendance:aholo-image', prompt: IMAGE_NAME, idLabel: '图片建模任务号' },
  { kind: 'world', tab: '场景生成', id: WORLD_ID, prefix: 'scendance:aholo-world', prompt: WORLD_PROMPT, idLabel: 'World ID' },
] as const;
const NEW_CAPABILITIES = [CAPABILITY_CASES[1], CAPABILITY_CASES[2]] as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function taskResponse(status: number, statusLabel = '运行中', outputs: string[] = []) {
  return jsonResponse({ status, statusLabel, outputs });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

// 每条路由独立计数；未知请求也只在 mock 内失败，绝不回退到真实 fetch。
function mockProxy() {
  type Handler = (url: URL, init?: RequestInit) => Promise<Response>;
  const health = vi.fn<Handler>().mockImplementation(async () => jsonResponse({ ok: true, keyConfigured: true }));
  const create = vi.fn<Handler>().mockImplementation(async () => jsonResponse({ taskid: Number(TASK_ID) }));
  const task = vi.fn<Handler>().mockImplementation(async () => taskResponse(1));
  const imageCreate = vi.fn<Handler>().mockImplementation(async () => jsonResponse({ taskid: Number(IMAGE_ID) }));
  const worldCreate = vi.fn<Handler>().mockImplementation(async () => jsonResponse({ taskid: WORLD_ID }));
  const world = vi.fn<Handler>().mockImplementation(async () => taskResponse(1));
  const unexpectedRequests: string[] = [];
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const options = typeof input === 'object' && 'method' in input
      ? { method: input.method, signal: input.signal, ...init }
      : init;
    const method = (options?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && url.pathname === '/health') return health(url, options);
    if (method === 'POST' && url.pathname === '/text-to-3d') return create(url, options);
    if (method === 'POST' && url.pathname === '/image-to-3d') return imageCreate(url, options);
    if (method === 'POST' && url.pathname === '/world') return worldCreate(url, options);
    if (method === 'GET' && url.pathname === '/task') return task(url, options);
    if (method === 'GET' && url.pathname === '/world') return world(url, options);
    unexpectedRequests.push(`${method} ${url}`);
    throw new Error(`Unexpected mocked request: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { health, create, imageCreate, worldCreate, task, world, fetchMock, unexpectedRequests };
}

type ProxyMock = ReturnType<typeof mockProxy>;

// 模拟原生 fetch：只有 AbortSignal 真正中止才拒绝，不能用立即 reject 冒充超时。
function pendingUntilAbort(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

async function renderPanel(strict = false, onPlace?: (item: CatalogItem) => boolean, onPreviewScene?: (source: { url: string; name?: string; taskid?: string }) => Promise<void>) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(strict
      ? <StrictMode><Lux3dDirectTest onPlace={onPlace} onPreviewScene={onPreviewScene} /></StrictMode>
      : <Lux3dDirectTest onPlace={onPlace} onPreviewScene={onPreviewScene} />);
  });
  return view;
}

function generateButton() {
  return screen.getByRole('button', { name: '直连生成（消耗额度）' }) as HTMLButtonElement;
}

function enterPrompt(prompt = PROMPT) {
  fireEvent.change(screen.getByLabelText('物件描述'), { target: { value: prompt } });
}

async function submitPrompt(prompt = PROMPT) {
  enterPrompt(prompt);
  const button = generateButton();
  expect(button.disabled).toBe(false);
  await act(async () => { fireEvent.click(button); });
  return button;
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function expectStatus(title: string) {
  expect(within(screen.getByRole('status')).getByText(title)).toBeTruthy();
}

function expectElapsed(seconds: number) {
  // 接受现有的 s 或中文秒单位，不依赖计时器的 CSS/内部 state。
  expect(screen.getByText(new RegExp(`(?:^|\\D)${seconds}\\s*(?:s\\b|秒)`))).toBeTruthy();
}

function expectNoInventedPercentage(container: HTMLElement) {
  expect(container.textContent).not.toMatch(/\d+(?:\.\d+)?\s*[%％]/);
  expect(container.querySelector('[role="progressbar"][aria-valuenow], progress[value]')).toBeNull();
}

function expectOnlyOriginalTask(proxy: ProxyMock, id = TASK_ID) {
  expect(proxy.task.mock.calls.length).toBeGreaterThan(0);
  expect(proxy.task.mock.calls.every(([url]) => url.searchParams.get('taskid') === id)).toBe(true);
}

// 手动完成读取，覆盖慢读取、失败、过期回调；不替组件生成 data URL。
function mockFileReaders() {
  const readers: TestFileReader[] = [];
  class TestFileReader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL = vi.fn();
    abort = vi.fn();
    constructor() { readers.push(this); }
    finish(result = IMAGE_DATA) { this.result = result; this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  vi.stubGlobal('FileReader', TestFileReader);
  return readers;
}

type FileReaders = ReturnType<typeof mockFileReaders>;

async function selectTab(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('tab', { name })); });
  return screen.getByRole('tabpanel', { name });
}

function activePanel() {
  return screen.getByRole('tabpanel');
}

function selectFile(file = new File(['image-private-bytes'], IMAGE_NAME, { type: 'image/png' })) {
  fireEvent.change(screen.getByLabelText('参考图片'), { target: { files: [file] } });
  return file;
}

async function prepareNewTask(kind: 'image' | 'world', readers: FileReaders) {
  await selectTab(kind === 'image' ? '图片建模' : '场景生成');
  if (kind === 'image') {
    selectFile();
    act(() => { readers[readers.length - 1].finish(); });
  } else {
    fireEvent.change(screen.getByLabelText('场景名称'), { target: { value: ` ${WORLD_NAME} ` } });
    fireEvent.change(screen.getByLabelText('场景描述'), { target: { value: ` ${WORLD_PROMPT} ` } });
  }
}

async function clickGenerate() {
  const button = generateButton();
  expect(button.disabled).toBe(false);
  await act(async () => { fireEvent.click(button); });
  return button;
}

function expectNoPosts(proxy: ProxyMock) {
  expect(proxy.create).not.toHaveBeenCalled();
  expect(proxy.imageCreate).not.toHaveBeenCalled();
  expect(proxy.worldCreate).not.toHaveBeenCalled();
}

function expectQueries(handler: ProxyMock['task'], path: string, parameter: string, id: string) {
  expect(handler.mock.calls.length).toBeGreaterThan(0);
  for (const [url, init] of handler.mock.calls) {
    expect(init?.method ?? 'GET').toBe('GET');
    expect(url.pathname).toBe(path);
    expect([...url.searchParams.entries()]).toEqual([[parameter, id]]);
    expect(init?.body).toBeUndefined();
  }
}

function historyItems(raw: string | null): HistoryItem[] {
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as HistoryItem[];
}

function storedKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!);
}

function expectMetadataOnly(writes: Array<[key: string, value: string]>) {
  expect(writes.length).toBeGreaterThan(0);
  for (const [key, value] of writes) {
    expect(key === HISTORY_KEY || CAPABILITY_CASES.some(({ prefix }) => key === `${prefix}-task` || key === `${prefix}-pending`)).toBe(true);
    expect(value).not.toMatch(/data:image|base64|signature=|https:\/\/cdn\.example\.test/);
    expect(value).not.toContain(IMAGE_DATA.split(',')[1]);
    if (key === HISTORY_KEY) {
      for (const item of historyItems(value)) expect(Object.keys(item).sort()).toEqual([...HISTORY_FIELDS]);
      continue;
    }
    const saved = JSON.parse(value) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(key.endsWith('-task') ? ['prompt', 'startedAt', 'taskid'] : ['prompt', 'startedAt']);
  }
  expect(storedKeys().filter(key => key !== HISTORY_KEY)).toEqual([]);
}

describe('Lux3D 本机直连面板', () => {
  let proxy: ProxyMock;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sessionStorage.clear();
    localStorage.clear();
    proxy = mockProxy();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('代理没启动时给出启动命令，并锁住生成按钮', async () => {
    proxy.health.mockRejectedValue(new TypeError('fetch failed'));
    await renderPanel();
    expect(screen.getByRole('alert').textContent).toContain('node tools/aholo/lux3d-dev-proxy.mjs');
    enterPrompt();
    expect(generateButton().disabled).toBe(true);
    fireEvent.click(generateButton());
    expect(proxy.create).not.toHaveBeenCalled();
    expect(proxy.task).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('描述为 %j 时不提交', async prompt => {
    await renderPanel();
    enterPrompt(prompt);
    expect(generateButton().disabled).toBe(true);
    fireEvent.click(generateButton());
    expect(proxy.create).not.toHaveBeenCalled();
    expect(proxy.task).not.toHaveBeenCalled();
  });

  it('health 为 HTTP 200 但 keyConfigured=false 时仍禁止生成', async () => {
    proxy.health.mockImplementation(async () => jsonResponse({ ok: true, keyConfigured: false }));
    await renderPanel();
    enterPrompt();
    expect(generateButton().disabled).toBe(true);
    fireEvent.click(generateButton());
    await advance(60_000);
    expect(proxy.create).not.toHaveBeenCalled();
    expect(proxy.task).not.toHaveBeenCalled();
  });

  it('StrictMode effect 重放后仍接受 HTTP 200 的任务号，立即 GET 且连点只 POST 一次', async () => {
    await renderPanel(true);
    enterPrompt(`  ${PROMPT}  `);
    const button = generateButton();
    expect(button.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(proxy.create).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(proxy.create.mock.calls[0][1]?.body))).toEqual({ prompt: PROMPT });
    expect(proxy.task).toHaveBeenCalledTimes(1);
    expectOnlyOriginalTask(proxy);
    expectStatus('生成中');
    expect(screen.queryByText(new RegExp(TASK_ID))).toBeNull();
    expect(screen.getByText(/已等 \d+s/)).toBeTruthy();
    expect(button.disabled).toBe(true);
  });

  it('POST 未返回时立即显示正在提交、等待任务号，计时逐秒更新且收到任务号不重置', async () => {
    const create = deferred<Response>();
    proxy.create.mockReturnValue(create.promise);
    const { container } = await renderPanel();
    const button = await submitPrompt();
    expectStatus('正在提交');
    expect(screen.getByRole('status').textContent).toMatch(/(?:等待|申请|获取).*任务(?:号|编号)/);
    expect(button.disabled).toBe(true);
    expectElapsed(0);
    expectNoInventedPercentage(container);
    await advance(1000);
    expectElapsed(1);
    await advance(1000);
    expectElapsed(2);
    expect(proxy.create).toHaveBeenCalledTimes(1);
    expect(proxy.task).not.toHaveBeenCalled();
    await act(async () => { create.resolve(jsonResponse({ taskid: TASK_ID })); });
    expect(proxy.task).toHaveBeenCalledTimes(1);
    expectStatus('生成中');
    expectElapsed(2);
    await advance(1000);
    expectElapsed(3);
    expectNoInventedPercentage(container);
  });

  it('初始化/等待执行都展示排队中，再按 0→1→3 展示生成中、生成完成和下载链接', async () => {
    proxy.task
      .mockImplementationOnce(async () => taskResponse(0, '初始化'))
      .mockImplementationOnce(async () => taskResponse(0, '等待执行'))
      .mockImplementationOnce(async () => taskResponse(1, '运行中'))
      .mockImplementationOnce(async () => taskResponse(3, '成功', [GLB_URL, ZIP_URL]));
    const storageWrites = vi.spyOn(Storage.prototype, 'setItem');
    const { container } = await renderPanel();
    const button = await submitPrompt();
    expect(proxy.task).toHaveBeenCalledTimes(1);
    expectStatus('排队中');
    expect(button.disabled).toBe(true);
    expectNoInventedPercentage(container);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toEqual({
      taskid: TASK_ID, prompt: PROMPT, startedAt: NOW,
    });

    await advance(4999);
    expect(proxy.task).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(proxy.task).toHaveBeenCalledTimes(2);
    expectStatus('排队中');
    expect(button.disabled).toBe(true);
    await advance(5000);
    expect(proxy.task).toHaveBeenCalledTimes(3);
    expectStatus('生成中');
    expect(screen.getByText(/已等 \d+s/)).toBeTruthy();
    expect(button.disabled).toBe(true);
    expectNoInventedPercentage(container);
    await advance(5000);
    expectStatus('生成完成');
    expect(screen.queryByText(/已等 \d+s/)).toBeNull();
    expect(screen.getByRole('link', { name: 'GLB 模型' }).getAttribute('href')).toBe(GLB_URL);
    expect(screen.getByRole('link', { name: /ZIP/ }).getAttribute('href')).toBe(ZIP_URL);
    expectNoInventedPercentage(container);
    await advance(60_000);
    expect(proxy.task).toHaveBeenCalledTimes(4);
    expect(proxy.create).toHaveBeenCalledTimes(1);

    // 检查每次写入，防止完成后清除缓存掩盖曾经持久化签名 URL。
    for (const [key, value] of storageWrites.mock.calls) {
      expect(value).not.toContain(GLB_URL);
      expect(value).not.toContain(ZIP_URL);
      expect(value).not.toContain('signature=');
      if (key === HISTORY_KEY) {
        for (const item of historyItems(value)) expect(Object.keys(item).sort()).toEqual([...HISTORY_FIELDS]);
        continue;
      }
      const saved = JSON.parse(value) as Record<string, unknown>;
      expect(Object.keys(saved).every(field => ['taskid', 'prompt', 'startedAt'].includes(field))).toBe(true);
      if (key === STORAGE_KEY) {
        expect(saved).toEqual({ taskid: TASK_ID, prompt: PROMPT, startedAt: NOW });
      }
    }
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it.each([
    { status: 4, statusLabel: '失败', title: '生成失败' },
    { status: 6, statusLabel: '已取消', title: '已取消' },
  ])('status=$status 显示$title并停止轮询', async ({ status, statusLabel, title }) => {
    proxy.task
      .mockImplementationOnce(async () => taskResponse(1))
      .mockImplementationOnce(async () => taskResponse(status, statusLabel));
    await renderPanel();
    const button = await submitPrompt();
    expectStatus('生成中');
    expect(button.disabled).toBe(true);
    await advance(5000);
    expectStatus(title);
    expect(screen.queryByRole('link', { name: 'GLB 模型' })).toBeNull();
    expect(screen.queryByRole('link', { name: /ZIP/ })).toBeNull();
    await advance(60_000);
    expect(proxy.task).toHaveBeenCalledTimes(2);
    expect(proxy.create).toHaveBeenCalledTimes(1);
  });

  it('慢查询期间不重叠，请求结束后完整等待 5 秒才再次轮询', async () => {
    const query = deferred<Response>();
    proxy.task.mockReturnValueOnce(query.promise);
    await renderPanel();
    const button = await submitPrompt();
    expect(proxy.task).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    await advance(20_000);
    expect(proxy.task).toHaveBeenCalledTimes(1);
    expect(proxy.create).toHaveBeenCalledTimes(1);
    await act(async () => { query.resolve(taskResponse(1)); });
    await advance(4999);
    expect(proxy.task).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(proxy.task).toHaveBeenCalledTimes(2);
    expectOnlyOriginalTask(proxy);
  });

  it.each(['network', 'http'] as const)('%s 查询失败显示 alert，继续查询只 GET 原任务且不能重复生成', async failure => {
    if (failure === 'network') proxy.task.mockRejectedValueOnce(new TypeError('fetch failed'));
    else proxy.task.mockImplementationOnce(async () => jsonResponse({ error: '查询服务暂不可用' }, 503));
    const retry = deferred<Response>();
    proxy.task.mockReturnValueOnce(retry.promise);
    await renderPanel();
    const button = await submitPrompt();
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    await advance(15_000);
    expect(proxy.task).toHaveBeenCalledTimes(1);
    expect(proxy.create).toHaveBeenCalledTimes(1);
    const retryButton = screen.getByRole('button', { name: '继续查询（不重复生成）' });
    await act(async () => {
      fireEvent.click(retryButton);
      fireEvent.click(retryButton);
    });
    expect(proxy.task).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(true);
    await advance(10_000);
    expect(proxy.task).toHaveBeenCalledTimes(2);
    await act(async () => { retry.resolve(taskResponse(1)); });
    expectStatus('生成中');
    expect(screen.queryByRole('alert')).toBeNull();
    await advance(5000);
    expect(proxy.task).toHaveBeenCalledTimes(3);
    expectOnlyOriginalTask(proxy);
    expect(proxy.create).toHaveBeenCalledTimes(1);
  });

  it.each(['network', 'http'] as const)('%s 提交失败提示结果未确认，不自动重发付费请求', async failure => {
    if (failure === 'network') proxy.create.mockRejectedValueOnce(new TypeError('fetch failed'));
    else proxy.create.mockImplementationOnce(async () => jsonResponse({ error: 'upstream unavailable' }, 502));
    await renderPanel();
    await submitPrompt();
    expect(screen.getByText(/结果(?:未|待)确认/)).toBeTruthy();
    await advance(60_000);
    expect(proxy.create).toHaveBeenCalledTimes(1);
    expect(proxy.task).not.toHaveBeenCalled();
  });

  it('POST 在 34999ms 仍等待、35000ms 被 AbortController 中止，结果未确认且不自动重发', async () => {
    let signal: AbortSignal | null | undefined;
    proxy.create.mockImplementation((_, init) => {
      signal = init?.signal;
      return pendingUntilAbort(signal);
    });
    await renderPanel();
    const button = await submitPrompt();
    expect(signal).toBeInstanceOf(AbortSignal);
    await advance(34_999);
    expect(signal?.aborted).toBe(false);
    expectStatus('正在提交');
    expect(button.disabled).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
    await advance(1);
    expect(signal?.aborted).toBe(true);
    expect(screen.getByText(/结果(?:未|待)确认/)).toBeTruthy();
    await advance(60_000);
    expect(proxy.create).toHaveBeenCalledTimes(1);
    expect(proxy.task).not.toHaveBeenCalled();
  });

  it('GET 超时也在 35 秒中止并保留原任务，只允许手动继续查询', async () => {
    let signal: AbortSignal | null | undefined;
    proxy.task.mockImplementationOnce((_, init) => {
      signal = init?.signal;
      return pendingUntilAbort(signal);
    });
    await renderPanel();
    const button = await submitPrompt();
    expect(signal).toBeInstanceOf(AbortSignal);
    await advance(34_999);
    expect(signal?.aborted).toBe(false);
    expect(proxy.task).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    await advance(1);
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    expect(button.disabled).toBe(true);
    await advance(60_000);
    expect(proxy.task).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '继续查询（不重复生成）' })); });
    expect(proxy.task).toHaveBeenCalledTimes(2);
    expectOnlyOriginalTask(proxy);
    expect(proxy.create).toHaveBeenCalledTimes(1);
    expectStatus('生成中');
  });

  it('StrictMode 重开从 sessionStorage 恢复描述、原任务与开始时间，只 GET 不 POST', async () => {
    const taskid = TASK_ID;
    const saved = { taskid, prompt: PROMPT, startedAt: NOW - 12_000 };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const view = await renderPanel(true);
    expect((screen.getByLabelText('物件描述') as HTMLInputElement).value).toBe(PROMPT);
    expectOnlyOriginalTask(proxy, taskid);
    expect(proxy.create).not.toHaveBeenCalled();
    expectStatus('生成中');
    expectElapsed(12);
    await advance(1000);
    expectElapsed(13);
    view.unmount();
    const queriesBeforeReopen = proxy.task.mock.calls.length;
    await renderPanel(true);
    expect(proxy.task.mock.calls.length).toBeGreaterThan(queriesBeforeReopen);
    expectOnlyOriginalTask(proxy, taskid);
    expect(proxy.create).not.toHaveBeenCalled();
    expectElapsed(13);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toEqual(saved);
  });

  it.each(['submitting', 'querying', 'scheduled'] as const)('%s 阶段卸载后，迟到响应或定时器都不能继续轮询', async phase => {
    // 刻意让迟到响应忽略 signal，验证卸载保护本身，而不只验证 fetch 的中止行为。
    const create = deferred<Response>();
    const query = deferred<Response>();
    if (phase === 'submitting') proxy.create.mockReturnValueOnce(create.promise);
    if (phase === 'querying') proxy.task.mockReturnValueOnce(query.promise);
    const view = await renderPanel();
    await submitPrompt();
    expect(proxy.create).toHaveBeenCalledTimes(1);
    const queryCount = phase === 'submitting' ? 0 : 1;
    expect(proxy.task).toHaveBeenCalledTimes(queryCount);
    view.unmount();
    await act(async () => {
      create.resolve(jsonResponse({ taskid: TASK_ID }));
      query.resolve(taskResponse(1));
    });
    await advance(60_000);
    expect(proxy.task).toHaveBeenCalledTimes(queryCount);
    expect(proxy.create).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Aholo 三 tab 契约、隔离与恢复', () => {
  let proxy: ProxyMock;
  let readers: FileReaders;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sessionStorage.clear();
    localStorage.clear();
    proxy = mockProxy();
    readers = mockFileReaders();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
    expect(proxy.unexpectedRequests).toEqual([]);
  });

  it('文字默认选中，其他 tab 首次访问才挂载，之后 hidden 保留同一表单和图片', async () => {
    await renderPanel();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['文字建模', '图片建模', '场景生成']);
    expect(screen.getByRole('tab', { name: '文字建模' }).getAttribute('aria-selected')).toBe('true');
    const textPanel = activePanel();
    const emptyPanels = screen.getAllByRole('tabpanel', { hidden: true }).filter(panel => panel !== textPanel);
    for (const panel of emptyPanels) {
      expect(panel.hasAttribute('hidden')).toBe(true);
      expect(panel.childElementCount).toBe(0);
    }
    enterPrompt();
    await prepareNewTask('image', readers);
    const imagePanel = activePanel();
    const preview = screen.getByRole('img', { name: '建模参考图片预览' });
    expect(textPanel.hasAttribute('hidden')).toBe(true);
    await prepareNewTask('world', readers);
    const name = screen.getByLabelText('场景名称');
    const description = screen.getByLabelText('场景描述');
    expect(imagePanel.hasAttribute('hidden')).toBe(true);
    expect(await selectTab('图片建模')).toBe(imagePanel);
    expect(screen.getByRole('img', { name: '建模参考图片预览' })).toBe(preview);
    expect(preview.getAttribute('src')).toBe(IMAGE_DATA);
    expect(await selectTab('文字建模')).toBe(textPanel);
    expect((screen.getByLabelText('物件描述') as HTMLTextAreaElement).value).toBe(PROMPT);
    await selectTab('场景生成');
    expect(screen.getByLabelText('场景名称')).toBe(name);
    expect(screen.getByLabelText('场景描述')).toBe(description);
    expect((description as HTMLTextAreaElement).value.trim()).toBe(WORLD_PROMPT);
    expect(proxy.health).toHaveBeenCalledTimes(1);
    expectNoPosts(proxy);
    expect(proxy.task).not.toHaveBeenCalled();
    expect(proxy.world).not.toHaveBeenCalled();
  });

  it('方向键循环、Home/End 同步焦点、选中状态、roving tabindex 与可见 panel', async () => {
    await renderPanel();
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    for (const [key, expected] of [
      ['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 0], ['ArrowLeft', 2],
      ['Home', 0], ['End', 2], ['ArrowLeft', 1], ['Escape', 1],
    ] as const) {
      await act(async () => { fireEvent.keyDown(document.activeElement!, { key }); });
      expect(document.activeElement).toBe(tabs[expected]);
      for (const [index, tab] of tabs.entries()) {
        expect(tab.getAttribute('aria-selected')).toBe(String(index === expected));
        expect(tab.tabIndex).toBe(index === expected ? 0 : -1);
        const panel = document.getElementById(tab.getAttribute('aria-controls')!)!;
        expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
        expect(panel.hasAttribute('hidden')).toBe(index !== expected);
      }
      expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
    }
    expectNoPosts(proxy);
  });

  it('三 tab 可同时提交；hidden 不中断 POST/轮询、不重发，pending/task 分别保存且不含图片或签名', async () => {
    const requests = [deferred<Response>(), deferred<Response>(), deferred<Response>()];
    const creates = [proxy.create, proxy.imageCreate, proxy.worldCreate];
    creates.forEach((handler, index) => handler.mockReturnValueOnce(requests[index].promise));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await renderPanel();
    await submitPrompt();
    await prepareNewTask('image', readers);
    const imageButton = await clickGenerate();
    fireEvent.click(imageButton);
    await prepareNewTask('world', readers);
    const worldButton = await clickGenerate();
    fireEvent.click(worldButton);
    expect(sessionStorage.length).toBe(3);
    for (const entry of CAPABILITY_CASES) {
      expect(JSON.parse(sessionStorage.getItem(`${entry.prefix}-pending`)!)).toEqual({ prompt: entry.prompt, startedAt: NOW });
      expect(sessionStorage.getItem(`${entry.prefix}-task`)).toBeNull();
    }
    for (const handler of creates) {
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][1]?.signal?.aborted).toBe(false);
    }
    expect(proxy.task).not.toHaveBeenCalled();
    expect(proxy.world).not.toHaveBeenCalled();
    await selectTab('文字建模');
    await advance(2000);
    await act(async () => {
      requests.forEach((request, index) => request.resolve(jsonResponse({ taskid: CAPABILITY_CASES[index].id })));
    });
    expect(proxy.task.mock.calls.map(([url]) => url.searchParams.get('taskid')).sort()).toEqual([TASK_ID, IMAGE_ID]);
    expectQueries(proxy.world, '/world', 'worldId', WORLD_ID);
    for (const entry of CAPABILITY_CASES) {
      expect(sessionStorage.getItem(`${entry.prefix}-pending`)).toBeNull();
      expect(JSON.parse(sessionStorage.getItem(`${entry.prefix}-task`)!)).toEqual({ taskid: entry.id, prompt: entry.prompt, startedAt: NOW });
    }
    await advance(5000);
    expect(proxy.task).toHaveBeenCalledTimes(4);
    expect(proxy.world).toHaveBeenCalledTimes(2);
    for (const entry of CAPABILITY_CASES) {
      await selectTab(entry.tab);
      expectStatus('生成中');
      expect(activePanel().textContent).not.toContain(String(entry.id));
      expect(within(activePanel()).getByText(/已等 7s/)).toBeTruthy();
    }
    for (const handler of creates) expect(handler).toHaveBeenCalledTimes(1);
    expect(proxy.task).toHaveBeenCalledTimes(4);
    expect(proxy.world).toHaveBeenCalledTimes(2);
    expect(proxy.health).toHaveBeenCalledTimes(1);
    expectMetadataOnly(writes.mock.calls);
  });

  it.each(NEW_CAPABILITIES)('$tab 查询在途切走再切回不中断、不重叠，结束后 5 秒才继续', async entry => {
    const query = deferred<Response>();
    const handler = entry.kind === 'world' ? proxy.world : proxy.task;
    handler.mockReturnValueOnce(query.promise);
    await renderPanel();
    await prepareNewTask(entry.kind, readers);
    await clickGenerate();
    const signal = handler.mock.calls[0][1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    await selectTab('文字建模');
    await advance(10_000);
    await selectTab(entry.tab);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(false);
    await selectTab('文字建模');
    await act(async () => { query.resolve(taskResponse(1)); });
    await advance(4999);
    expect(handler).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(handler).toHaveBeenCalledTimes(2);
    expectQueries(handler, entry.kind === 'world' ? '/world' : '/task', entry.kind === 'world' ? 'worldId' : 'taskid', entry.id);
    expect(entry.kind === 'world' ? proxy.worldCreate : proxy.imageCreate).toHaveBeenCalledTimes(1);
  });

  it.each(['offline', 'missing-key'] as const)('%s 时新 tab 的上传/名称/描述和生成按钮也锁住', async reason => {
    if (reason === 'offline') proxy.health.mockRejectedValue(new TypeError('fetch failed'));
    else proxy.health.mockResolvedValue(jsonResponse({ keyConfigured: false }));
    await renderPanel();
    await selectTab('图片建模');
    expect((screen.getByLabelText('参考图片') as HTMLInputElement).disabled).toBe(true);
    expect(generateButton().disabled).toBe(true);
    fireEvent.click(generateButton());
    await selectTab('场景生成');
    expect((screen.getByLabelText('场景名称') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('场景描述') as HTMLTextAreaElement).disabled).toBe(true);
    expect(generateButton().disabled).toBe(true);
    fireEvent.click(generateButton());
    expectNoPosts(proxy);
  });

  it.each([
    ['image/png', 'png', 1], ['image/jpeg', 'jpg', 1],
    ['image/png', 'png', 5 * 1024 * 1024], ['image/jpeg', 'jpeg', 5 * 1024 * 1024],
  ] as const)('接受 %s 的 %i 字节边界，FileReader data URL 预览并可移除', async (mime, extension, size) => {
    await renderPanel();
    await selectTab('图片建模');
    const input = screen.getByLabelText('参考图片') as HTMLInputElement;
    expect(input.accept).toBe('image/png,image/jpeg');
    expect(generateButton().disabled).toBe(true);
    const file = selectFile(new File([new Uint8Array(size)], `reference.${extension}`, { type: mime }));
    expect(readers).toHaveLength(1);
    expect(readers[0].readAsDataURL).toHaveBeenCalledExactlyOnceWith(file);
    expect(screen.getByText('正在读取图片…')).toBeTruthy();
    expect(generateButton().disabled).toBe(true);
    const data = `data:${mime};base64,AQ==`;
    act(() => { readers[0].finish(data); });
    expect(screen.getByRole('img', { name: '建模参考图片预览' }).getAttribute('src')).toBe(data);
    expect(generateButton().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '移除图片' }));
    expect(screen.queryByRole('img', { name: '建模参考图片预览' })).toBeNull();
    expect(screen.queryByText(`图片：reference.${extension}`)).toBeNull();
    expect(input.value).toBe('');
    expect(generateButton().disabled).toBe(true);
    expectNoPosts(proxy);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it.each([
    { name: 'empty.png', type: 'image/png', size: 0 },
    { name: 'large.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 },
    { name: 'large.jpg', type: 'image/jpeg', size: 5 * 1024 * 1024 + 1 },
    { name: 'spoofed.png', type: 'image/gif', size: 1 },
    { name: 'unsupported.webp', type: 'image/webp', size: 1 },
    { name: 'active.svg', type: 'image/svg+xml', size: 1 },
    { name: 'unknown.png', type: '', size: 1 },
  ])('拒绝 $name ($type/$size bytes)，不读取不提交且清除旧预览', async ({ name, type, size }) => {
    await renderPanel();
    await prepareNewTask('image', readers);
    selectFile(new File([new Uint8Array(size)], name, { type }));
    expect(readers).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toMatch(/5 MB.*PNG.*JPEG/);
    expect(screen.queryByRole('img', { name: '建模参考图片预览' })).toBeNull();
    expect(generateButton().disabled).toBe(true);
    fireEvent.click(generateButton());
    expectNoPosts(proxy);
    expect(sessionStorage.length).toBe(0);
  });

  it('读取失败显示错误，重新选择成功后清错；读取时不能提交', async () => {
    await renderPanel();
    await selectTab('图片建模');
    selectFile();
    fireEvent.click(generateButton());
    expectNoPosts(proxy);
    act(() => { readers[0].fail(); });
    expect(screen.getByRole('alert').textContent).toContain('图片读取失败');
    expect(screen.queryByText('正在读取图片…')).toBeNull();
    expect(generateButton().disabled).toBe(true);
    selectFile();
    act(() => { readers[1].finish(); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(generateButton().disabled).toBe(false);
  });

  it('快速换图忽略旧读取回调，切 tab 不打断新读取；卸载中止读取', async () => {
    const view = await renderPanel();
    await selectTab('图片建模');
    selectFile();
    selectFile(new File(['new'], 'new.jpg', { type: 'image/jpeg' }));
    expect(readers[0].abort).toHaveBeenCalledTimes(1);
    act(() => { readers[0].finish('data:image/png;base64,b2xk'); readers[0].fail(); });
    expect(screen.queryByRole('img', { name: '建模参考图片预览' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(generateButton().disabled).toBe(true);
    await selectTab('场景生成');
    expect(readers[1].abort).not.toHaveBeenCalled();
    act(() => { readers[1].finish('data:image/jpeg;base64,bmV3'); });
    await selectTab('图片建模');
    expect(screen.getByRole('img', { name: '建模参考图片预览' }).getAttribute('src')).toBe('data:image/jpeg;base64,bmV3');
    expect(screen.getByText('图片：new.jpg')).toBeTruthy();
    selectFile();
    view.unmount();
    expect(readers[2].abort).toHaveBeenCalledTimes(1);
    act(() => { readers[2].finish(); readers[2].fail(); });
    expectNoPosts(proxy);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('图片成功只 POST {img}，数字任务号转成原号 GET，GLB/ZIP 可下载且 Storage 从未写入图片/签名', async () => {
    proxy.task.mockResolvedValue(taskResponse(3, '成功', [GLB_URL, ZIP_URL]));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await renderPanel(true);
    await prepareNewTask('image', readers);
    const button = await clickGenerate();
    expect(proxy.imageCreate).toHaveBeenCalledTimes(1);
    const [url, init] = proxy.imageCreate.mock.calls[0];
    expect(url.pathname).toBe('/image-to-3d');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ img: IMAGE_DATA });
    expectQueries(proxy.task, '/task', 'taskid', IMAGE_ID);
    expectStatus('生成完成');
    expect(button.disabled).toBe(false);
    expect(screen.getByRole('link', { name: 'GLB 模型' }).getAttribute('href')).toBe(GLB_URL);
    expect(screen.getByRole('link', { name: /ZIP/ }).getAttribute('href')).toBe(ZIP_URL);
    expectNoInventedPercentage(activePanel());
    expect(sessionStorage.getItem('scendance:aholo-image-pending')).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('scendance:aholo-image-task')!)).toEqual({ taskid: IMAGE_ID, prompt: IMAGE_NAME, startedAt: NOW });
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expectMetadataOnly(writes.mock.calls);
    await advance(60_000);
    expect(proxy.task).toHaveBeenCalledTimes(1);
    expect(proxy.imageCreate).toHaveBeenCalledTimes(1);
    expect(proxy.create).not.toHaveBeenCalled();
    expect(proxy.worldCreate).not.toHaveBeenCalled();
  });
});

describe('Aholo World 场景生成', () => {
  let proxy: ProxyMock;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sessionStorage.clear();
    localStorage.clear();
    proxy = mockProxy();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
    expect(proxy.unexpectedRequests).toEqual([]);
  });

  async function submitWorld() {
    await selectTab('场景生成');
    fireEvent.change(screen.getByLabelText('场景名称'), { target: { value: ` ${WORLD_NAME} ` } });
    fireEvent.change(screen.getByLabelText('场景描述'), { target: { value: ` ${WORLD_PROMPT} ` } });
    return clickGenerate();
  }

  it('只 POST 去空白后的名称与描述，字母数字 ID 走 GET /world 且不扣第二次额度', async () => {
    await renderPanel();
    const button = await submitWorld();
    expect(proxy.worldCreate).toHaveBeenCalledTimes(1);
    const [url, init] = proxy.worldCreate.mock.calls[0];
    expect(url.pathname).toBe('/world');
    expect(JSON.parse(String(init?.body))).toEqual({ name: WORLD_NAME, prompt: WORLD_PROMPT });
    expectQueries(proxy.world, '/world', 'worldId', WORLD_ID);
    expect(proxy.task).not.toHaveBeenCalled();
    expectStatus('生成中');
    await advance(60_000);
    expect(proxy.worldCreate).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
  });

  it('成功后展示真实全景与 PLY／SPZ／LOD 三个文件，并说明预览不参与碰撞', async () => {
    proxy.world.mockImplementation(async () => jsonResponse({
      status: 3, statusLabel: '成功', outputs: [PLY_URL, SPZ_URL, LOD_URL], progress: 1, panoUrl: PANO_URL,
    }));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await renderPanel();
    await submitWorld();
    expectStatus('生成完成');
    expect(within(activePanel()).getByRole('img', { name: 'World 场景全景图' }).getAttribute('src')).toBe(PANO_URL);
    for (const [name, href] of [['PLY 场景', PLY_URL], ['SPZ 场景', SPZ_URL], ['LOD 元数据', LOD_URL]] as const) {
      expect(within(activePanel()).getByRole('link', { name }).getAttribute('href')).toBe(href);
    }
    expect(within(activePanel()).getByText(/只作环境预览，不参与碰撞/)).toBeTruthy();
    // 没接预览管线就不许摆一颗点了没反应的按钮。
    expect(within(activePanel()).queryByRole('button', { name: '在 3D 场景预览' })).toBeNull();
    expectMetadataOnly(writes.mock.calls);
    expect(JSON.parse(sessionStorage.getItem('scendance:aholo-world-task')!)).toEqual({ taskid: WORLD_ID, prompt: WORLD_PROMPT, startedAt: NOW });
  });

  it('场景预览优先取 SPZ、按描述与任务号交给预览，失败就说失败', async () => {
    proxy.world.mockImplementation(async () => jsonResponse({
      status: 3, statusLabel: '成功', outputs: [PLY_URL, SPZ_URL, LOD_URL], progress: 1, panoUrl: PANO_URL,
    }));
    const onPreviewScene = vi.fn(async () => undefined);
    await renderPanel(false, undefined, onPreviewScene);
    await submitWorld();
    expectStatus('生成完成');
    const button = within(activePanel()).getByRole('button', { name: '在 3D 场景预览' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await act(async () => { fireEvent.click(button); });
    expect(onPreviewScene).toHaveBeenCalledWith({ url: SPZ_URL, name: WORLD_NAME, taskid: WORLD_ID });
    expect(within(activePanel()).getByText(/已按场地尺寸铺成 3D 背景/)).toBeTruthy();
    // 预览只走本机落盘那条路，绝不替她再点一次生成。
    expect(proxy.worldCreate).toHaveBeenCalledTimes(1);

    await act(async () => { onPreviewScene.mockRejectedValueOnce(new Error('无法解码这个 3DGS 场景')); });
    await act(async () => { fireEvent.click(within(activePanel()).getByRole('button', { name: '在 3D 场景预览' })); });
    expect(within(activePanel()).getByRole('alert').textContent).toContain('无法解码');
    expect(within(activePanel()).queryByText(/已按场地尺寸铺成 3D 背景/)).toBeNull();
  });

  it('只有 PLY 时也拿它预览；LOD 元数据不是场景本体', async () => {
    proxy.world.mockImplementation(async () => jsonResponse({
      status: 3, statusLabel: '成功', outputs: [PLY_URL, LOD_URL], progress: 1,
    }));
    const onPreviewScene = vi.fn(async () => undefined);
    await renderPanel(false, undefined, onPreviewScene);
    await submitWorld();
    await act(async () => { fireEvent.click(within(activePanel()).getByRole('button', { name: '在 3D 场景预览' })); });
    expect(onPreviewScene).toHaveBeenCalledWith({ url: PLY_URL, name: WORLD_NAME, taskid: WORLD_ID });
  });

  it.each([
    { label: '未提供', body: {} },
    { label: '非法', body: { progress: 1.4 } },
    { label: '非数字', body: { progress: '50%' } },
  ])('$label progress 时不显示百分比也不假造进度', async ({ body }) => {
    proxy.world.mockImplementation(async () => jsonResponse({ status: 1, statusLabel: '运行中', outputs: [], ...body }));
    await renderPanel();
    await submitWorld();
    expectNoInventedPercentage(activePanel());
    expect(within(activePanel()).getByText(/Aholo 未提供百分比进度/)).toBeTruthy();
  });

  it('接口给出真实 progress 才显示进度条与百分比', async () => {
    proxy.world.mockImplementation(async () => jsonResponse({ status: 1, statusLabel: '运行中', outputs: [], progress: 0.42 }));
    await renderPanel();
    await submitWorld();
    const bar = within(activePanel()).getByRole('progressbar', { name: 'Aholo 场景进度' }) as HTMLProgressElement;
    expect(bar.value).toBe(0.42);
    expect(within(activePanel()).getByText('42%')).toBeTruthy();
    expect(within(activePanel()).queryByText(/Aholo 未提供百分比进度/)).toBeNull();
  });

  it('文字 tab 的待确认任务不锁住场景生成，两者各自轮询', async () => {
    sessionStorage.setItem('scendance:lux3d-direct-pending', JSON.stringify({ prompt: '一张中式躺椅', startedAt: NOW }));
    await renderPanel(true);
    const textPanel = document.getElementById('aholo-panel-text')!;
    expect(textPanel.textContent).toContain('提交结果待确认');
    const button = await submitWorld();
    expect(button.disabled).toBe(true);
    expect(proxy.worldCreate).toHaveBeenCalledTimes(1);
    expect(proxy.create).not.toHaveBeenCalled();
    expect(textPanel.textContent).toContain('提交结果待确认');
    expect(textPanel.textContent).not.toContain('生成中');
  });
});

const HISTORY_LIMIT = 30;

function seedHistory(items: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

function historyToggle() {
  return screen.getByRole('button', { name: /^(历史记录（\d+）|收起历史)$/ });
}

function openHistory() {
  const toggle = historyToggle();
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return document.getElementById('aholo-history')!;
}

describe('Aholo 本机历史记录', () => {
  let proxy: ProxyMock;
  let readers: FileReaders;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sessionStorage.clear();
    localStorage.clear();
    proxy = mockProxy();
    readers = mockFileReaders();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
    expect(proxy.unexpectedRequests).toEqual([]);
  });

  it('默认收起且给出空态，按钮文案与条数随生成更新', async () => {
    await renderPanel();
    const toggle = screen.getByRole('button', { name: '历史记录（0）' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe('aholo-history');
    expect(document.getElementById('aholo-history')!.hasAttribute('hidden')).toBe(true);
    expect(document.getElementById('aholo-history')!.textContent).toContain('本机还没有生成记录');
    await submitPrompt();
    expect(screen.getByRole('button', { name: '历史记录（1）' })).toBe(toggle);
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('收起历史');
    expect(document.getElementById('aholo-history')!.hasAttribute('hidden')).toBe(false);
    expect(within(openHistory()).getByText('文字建模')).toBeTruthy();
    expect(within(openHistory()).getByText(PROMPT)).toBeTruthy();
    expect(document.querySelector('.sc-lux-direct')!.textContent).toContain('回 Aholo 取最新结果');
    expect(openHistory().textContent).not.toContain(TASK_ID);
    expect(document.getElementById('aholo-panel-text')!.textContent).not.toContain(TASK_ID);
  });

  it('提交即记一条，后续查询更新同一条而非追加，且不含产物链接', async () => {
    await renderPanel();
    await submitPrompt();
    const items = historyItems(localStorage.getItem(HISTORY_KEY));
    expect(items).toEqual([{ kind: 'text', taskid: TASK_ID, prompt: PROMPT, startedAt: NOW, status: 1, label: '运行中', at: NOW }]);
    proxy.task.mockResolvedValue(taskResponse(3, '成功', [GLB_URL, ZIP_URL]));
    await advance(5000);
    const stored = localStorage.getItem(HISTORY_KEY)!;
    expect(historyItems(stored)).toHaveLength(1);
    expect(historyItems(stored)[0]).toMatchObject({ status: 3, label: '成功', at: NOW + 5000 });
    expect(stored).not.toMatch(/https|signature=|\.glb|\.zip/);
    expect(within(openHistory()).getByText(/生成完成/)).toBeTruthy();
  });

  it('三种能力各记一条，新的排在最前', async () => {
    await renderPanel();
    await submitPrompt('一张白色圆桌');
    await prepareNewTask('image', readers);
    await clickGenerate();
    await prepareNewTask('world', readers);
    await clickGenerate();
    expect(historyItems(localStorage.getItem(HISTORY_KEY)).map(item => [item.kind, item.taskid, item.prompt])).toEqual([
      ['world', WORLD_ID, WORLD_PROMPT], ['image', IMAGE_ID, IMAGE_NAME], ['text', TASK_ID, '一张白色圆桌'],
    ]);
  });

  it('超过 30 条时丢最旧的，同任务号不会被挤掉', async () => {
    seedHistory(Array.from({ length: HISTORY_LIMIT }, (_, index) => ({
      kind: 'text', taskid: String(1000 + index), prompt: `旧任务 ${index}`, startedAt: NOW - index, status: 3, label: '成功', at: NOW - index,
    })));
    await renderPanel();
    expect(historyToggle().textContent).toBe(`历史记录（${HISTORY_LIMIT}）`);
    await submitPrompt();
    const items = historyItems(localStorage.getItem(HISTORY_KEY));
    expect(items).toHaveLength(HISTORY_LIMIT);
    expect(items[0].taskid).toBe(TASK_ID);
    expect(items.map(item => item.taskid)).not.toContain('1029');
    await advance(5000);
    expect(historyItems(localStorage.getItem(HISTORY_KEY))).toHaveLength(HISTORY_LIMIT);
  });

  it('损坏、未知能力或非法任务号的记录不进列表', async () => {
    seedHistory([
      { kind: 'world', taskid: 'bad/../id', prompt: '非法', startedAt: NOW, status: 1, label: '运行中', at: NOW },
      { kind: 'hologram', taskid: '1', prompt: '未知', startedAt: NOW, status: 1, label: '运行中', at: NOW } as unknown as HistoryItem,
      { kind: 'text', taskid: TASK_ID, prompt: '', startedAt: NOW, status: 1, label: '运行中', at: NOW },
    ]);
    await renderPanel();
    const list = openHistory();
    expect(historyToggle().textContent).toBe('收起历史');
    expect(within(list).getByText(/^本机记录 1 条$/)).toBeTruthy();
    expect(list.textContent).not.toContain('非法');
    expect(list.textContent).not.toContain('未知');
    expect(within(list).getByText('（无描述）')).toBeTruthy();
  });

  it('点「查看」切到对应 tab 并只 GET 原任务，不重复扣额度', async () => {
    seedHistory([{ kind: 'world', taskid: WORLD_ID, prompt: WORLD_PROMPT, startedAt: NOW - 60_000, status: 1, label: '运行中', at: NOW - 60_000 }]);
    await renderPanel();
    const list = openHistory();
    await act(async () => { fireEvent.click(within(list).getByRole('button', { name: '查看' })); });
    expect(screen.getByRole('tab', { name: '场景生成' }).getAttribute('aria-selected')).toBe('true');
    expectQueries(proxy.world, '/world', 'worldId', WORLD_ID);
    expectNoPosts(proxy);
    expectStatus('生成中');
    expect(JSON.parse(sessionStorage.getItem('scendance:aholo-world-task')!)).toEqual({ taskid: WORLD_ID, prompt: WORLD_PROMPT, startedAt: NOW - 60_000 });
    expect(historyItems(localStorage.getItem(HISTORY_KEY))).toHaveLength(1);
    expect(document.getElementById('aholo-panel-text')!.textContent).not.toContain('生成中');
  });

  it('本机还有未确认完成的任务时，生成前先提示会再扣一次额度', async () => {
    seedHistory([{ kind: 'text', taskid: '9999', prompt: '上一个任务', startedAt: NOW - 60_000, status: 1, label: '运行中', at: NOW - 60_000 }]);
    await renderPanel();
    const panel = document.getElementById('aholo-panel-text')!;
    expect(panel.textContent).toContain('未确认完成的文字建模');
    expect(panel.textContent).toContain('再扣一次额度');
    expect(panel.textContent).not.toContain('9999');
    expectNoPosts(proxy);
    expect(proxy.task).not.toHaveBeenCalled();
    await submitPrompt();
    expect(panel.textContent).not.toContain('再扣一次额度');
  });

  it('轮询回来的描述为空时保留原描述，列表不会退化成「（无描述）」', async () => {
    seedHistory([{ kind: 'text', taskid: TASK_ID, prompt: PROMPT, startedAt: NOW - 5_000, status: 1, label: '运行中', at: NOW - 5_000 }]);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ taskid: TASK_ID, prompt: '', startedAt: NOW - 5_000 }));
    await renderPanel();
    await advance(5000);
    const items = historyItems(localStorage.getItem(HISTORY_KEY));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ taskid: TASK_ID, prompt: PROMPT, status: 1 });
    expect(within(openHistory()).getByText(PROMPT)).toBeTruthy();
  });

  it('已确认完成的历史任务不再提示重复扣额度', async () => {
    seedHistory([{ kind: 'text', taskid: TASK_ID, prompt: PROMPT, startedAt: NOW, status: 3, label: '成功', at: NOW }]);
    await renderPanel();
    expect(document.getElementById('aholo-panel-text')!.textContent).not.toContain('再扣一次额度');
  });

  it('清空只删本机记录，仍在跟踪的任务会在下一次查询回到列表', async () => {
    await renderPanel();
    await submitPrompt();
    const list = openHistory();
    fireEvent.click(within(list).getByRole('button', { name: '清空' }));
    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(within(list).getByText(/本机还没有生成记录/)).toBeTruthy();
    await advance(5000);
    expect(proxy.create).toHaveBeenCalledTimes(1);
    expect(historyItems(localStorage.getItem(HISTORY_KEY))).toHaveLength(1);
    fireEvent.click(historyToggle());
    expect(historyToggle().textContent).toBe('历史记录（1）');
    expect(document.getElementById('aholo-history')!.hasAttribute('hidden')).toBe(true);
  });

  it('历史列表不参与 tab 焦点切换，也不新增创建请求', async () => {
    seedHistory([{ kind: 'text', taskid: TASK_ID, prompt: PROMPT, startedAt: NOW, status: 3, label: '成功', at: NOW }]);
    await renderPanel();
    const tabs = screen.getAllByRole('tab');
    await openHistory();
    tabs[0].focus();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }); });
    expect(document.activeElement).toBe(tabs[1]);
    expectNoPosts(proxy);
    expect(proxy.task).not.toHaveBeenCalled();
  });
});

describe('Aholo 产物放进布置场景 (#66)', () => {
  let proxy: ProxyMock;
  let onPlace: ReturnType<typeof placeSpy>;

  function placeSpy() {
    return vi.fn<(item: CatalogItem) => boolean>(() => true);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    sessionStorage.clear();
    localStorage.clear();
    proxy = mockProxy();
    onPlace = placeSpy();
    vi.mocked(loadAholoCatalogItem).mockReset().mockResolvedValue({ ...PLACED_ITEM });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
    expect(proxy.unexpectedRequests).toEqual([]);
  });

  function placeButton() {
    return screen.getByRole('button', { name: '放进 3D 场景' }) as HTMLButtonElement;
  }

  // 文字建模直接走到「生成完成」，此时才谈得上把 GLB 摆进场景。
  // 每次查询都要新 Response：同一个实例的 body 只能读一次。
  async function succeedWith(outputs: string[], host: (item: CatalogItem) => boolean = onPlace) {
    proxy.task.mockImplementation(async () => taskResponse(3, '成功', outputs));
    await renderPanel(false, host);
    await submitPrompt();
    return activePanel();
  }

  it('一键取回：按产物地址、描述与任务号请求，再把实测好的物料交给布置场景', async () => {
    const panel = await succeedWith([GLB_URL, ZIP_URL]);
    await act(async () => { fireEvent.click(placeButton()); });
    expect(loadAholoCatalogItem).toHaveBeenCalledTimes(1);
    expect(loadAholoCatalogItem).toHaveBeenCalledWith({ url: GLB_URL, name: PROMPT, taskid: TASK_ID });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace.mock.calls[0][0]).toEqual({ ...PLACED_ITEM });
    expect(within(panel).getByText('已放进场景，可直接拖动。')).toBeTruthy();
    expect(placeButton().disabled).toBe(false);
    expect(panel.textContent).not.toContain('signature=');
  });

  it('没接布置场景时不给摆放入口，也不请求落盘', async () => {
    proxy.task.mockImplementation(async () => taskResponse(3, '成功', [GLB_URL, ZIP_URL]));
    await renderPanel();
    await submitPrompt();
    expect(screen.queryByRole('button', { name: '放进 3D 场景' })).toBeNull();
    expect(loadAholoCatalogItem).not.toHaveBeenCalled();
  });

  it('取回途中按钮锁住、连点只请求一次，成功回来才交给场景', async () => {
    const pending = deferred<CatalogItem>();
    vi.mocked(loadAholoCatalogItem).mockReturnValue(pending.promise);
    const panel = await succeedWith([GLB_URL]);
    const button = placeButton();
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(loadAholoCatalogItem).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('正在取回模型…');
    expect(onPlace).not.toHaveBeenCalled();
    await act(async () => { pending.resolve({ ...PLACED_ITEM }); });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('放进 3D 场景');
    expect(within(panel).getByText('已放进场景，可直接拖动。')).toBeTruthy();
  });

  it('取回失败说明原因、不假装已放好，修好后可以再点一次', async () => {
    vi.mocked(loadAholoCatalogItem).mockRejectedValue(new Error('连不上本机代理，先运行：node tools/aholo/lux3d-dev-proxy.mjs'));
    const panel = await succeedWith([GLB_URL]);
    await act(async () => { fireEvent.click(placeButton()); });
    expect(screen.getByRole('alert').textContent).toContain('node tools/aholo/lux3d-dev-proxy.mjs');
    expect(onPlace).not.toHaveBeenCalled();
    expect(panel.textContent).not.toContain('已放进场景');
    expect(placeButton().disabled).toBe(false);
    await act(async () => {
      vi.mocked(loadAholoCatalogItem).mockResolvedValue({ ...PLACED_ITEM });
      fireEvent.click(placeButton());
    });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('布置场景没放下它时提示点其他位置，而不是报「已放进」', async () => {
    onPlace.mockReturnValue(false);
    const panel = await succeedWith([GLB_URL]);
    await act(async () => { fireEvent.click(placeButton()); });
    expect(within(panel).getByText('请点击场地中的其他位置放下它。')).toBeTruthy();
    expect(panel.textContent).not.toContain('已放进场景');
  });

  it('产物里没有 GLB（只有 ZIP）时不给摆放按钮', async () => {
    const panel = await succeedWith([ZIP_URL]);
    expect(within(panel).queryByRole('button', { name: '放进 3D 场景' })).toBeNull();
    expect(loadAholoCatalogItem).not.toHaveBeenCalled();
  });

  it.each([
    { status: 4, label: '失败' },
    { status: 6, label: '已取消' },
  ])('status=$status 即便上游带回链接也不给摆放入口', async ({ status, label }) => {
    proxy.task.mockImplementation(async () => taskResponse(status, label, [GLB_URL]));
    await renderPanel(false, onPlace);
    await submitPrompt();
    expect(screen.queryByRole('button', { name: '放进 3D 场景' })).toBeNull();
    expect(loadAholoCatalogItem).not.toHaveBeenCalled();
    expect(proxy.create).toHaveBeenCalledTimes(1);
  });

  it('场景生成是 3DGS，只列文件链接、不摆物件', async () => {
    proxy.world.mockResolvedValue(jsonResponse({
      status: 3, statusLabel: '成功', outputs: [PLY_URL, SPZ_URL, LOD_URL], progress: 1, panoUrl: PANO_URL,
    }));
    await renderPanel(false, onPlace);
    await selectTab('场景生成');
    fireEvent.change(screen.getByLabelText('场景名称'), { target: { value: WORLD_NAME } });
    fireEvent.change(screen.getByLabelText('场景描述'), { target: { value: WORLD_PROMPT } });
    await clickGenerate();
    expectStatus('生成完成');
    expect(screen.queryByRole('button', { name: '放进 3D 场景' })).toBeNull();
    expect(loadAholoCatalogItem).not.toHaveBeenCalled();
  });

  it('重新生成会作废上一次未完成的取回，不再把它放进新任务', async () => {
    const pending = deferred<CatalogItem>();
    vi.mocked(loadAholoCatalogItem).mockReturnValue(pending.promise);
    const panel = await succeedWith([GLB_URL]);
    await act(async () => { fireEvent.click(placeButton()); });
    expect(loadAholoCatalogItem).toHaveBeenCalledTimes(1);
    enterPrompt('一张中式躺椅');
    const generate = generateButton();
    expect(generate.disabled).toBe(false);
    await act(async () => { fireEvent.click(generate); });
    await act(async () => { pending.resolve({ ...PLACED_ITEM }); });
    expect(onPlace).not.toHaveBeenCalled();
    expect(panel.textContent).not.toContain('已放进场景');
    expect(proxy.create).toHaveBeenCalledTimes(2);
    expectStatus('生成完成');
  });
});
