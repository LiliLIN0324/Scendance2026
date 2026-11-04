// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { packGltf } from '../../../../supabase/functions/_shared/models';
import { tetrahedron } from '../../../../tests/model-fixture';
import { clearGlbAssetCache } from '../three/glb-assets';
import { listAholoAssets } from './aholo-assets';
import { addPendingMaterial, listPendingMaterials, removePendingMaterial } from './material-generate';
import { fetchLux3dTask, glbOutputOf, importLatestPendingMaterials, importPendingMaterial } from './lux3d-import';

const TASK = '4475964';
const ASSET_ID = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
const GLB = 'https://cos.example.test/lux3d/4475964/textured.glb?q-signature=secret';
const SPZ = 'https://cos.example.test/lux3d/4475964/world.spz?q-signature=secret';

/** 四面体按轴拉成 2×1.5×0.5，才能验出宽高深顺序。 */
function bytes(): Uint8Array {
  const fixture = tetrahedron();
  const floats = new Float32Array(fixture.resources['model.bin']!.buffer);
  for (let vertex = 0; vertex < 12; vertex += 3) {
    floats[vertex] = (floats[vertex] ?? 0) * 2;
    floats[vertex + 1] = (floats[vertex + 1] ?? 0) * 1.5;
    floats[vertex + 2] = (floats[vertex + 2] ?? 0) * 0.5;
  }
  fixture.json.accessors![0]!.max = [2, 1.5, 0.5];
  return packGltf(fixture.json, fixture.resources);
}

function json(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, headers: new Headers(), json: async () => body } as unknown as Response;
}

function binary(data: Uint8Array) {
  return {
    ok: true, status: 200,
    headers: new Headers({ 'content-length': String(data.byteLength) }),
    arrayBuffer: async () => data.buffer as ArrayBuffer,
  } as unknown as Response;
}

/** 只模拟本机代理：任务详情、落盘、回源；任何多余请求都算失败。 */
function stubProxy(task: unknown, { failAsset = false } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url.pathname}`);
    if (method === 'GET' && url.pathname === '/task') return json(task);
    if (method === 'POST' && url.pathname === '/asset') {
      return failAsset ? json({ error: '远端模型下载失败' }, false) : json({ assetId: ASSET_ID, kind: 'glb', bytes: bytes().byteLength });
    }
    if (method === 'GET' && url.pathname === `/asset/${ASSET_ID}.glb`) return binary(bytes());
    throw new Error(`unexpected ${method} ${url.pathname}`);
  }));
  return calls;
}

function remember(taskid: string, name: string, submittedAt: number) {
  addPendingMaterial({ id: `pending:${taskid}`, name, shipped: false, submittedAt });
}

function clearPending() {
  for (const card of listPendingMaterials()) removePendingMaterial(card.id);
}

describe('Lux3D 生成结果自动取回', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPending();
    clearGlbAssetCache();
  });

  afterEach(() => {
    clearPending();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearGlbAssetCache();
  });

  it('产物里有 .glb 就落盘入库，并从待取回列表移除', async () => {
    stubProxy({ status: 3, outputs: [SPZ, GLB] });
    remember(TASK, '白色圆桌', 1);
    const result = await importPendingMaterial(`pending:${TASK}`, { localProxy: true });
    expect(result.state).toBe('imported');
    if (result.state !== 'imported') throw new Error('expected imported');
    expect(result.item.source).toBe('generated');
    expect(result.item.assetId).toBe(ASSET_ID);
    expect(result.item.width).toBeCloseTo(2, 5);
    expect(result.item.depth).toBeCloseTo(0.5, 5);
    expect(result.item.height).toBeCloseTo(1.5, 5);
    expect(listPendingMaterials()).toHaveLength(0);
    expect(listAholoAssets()).toHaveLength(1);
  });

  it('任务还在生成：保留待取回卡片并给出进度', async () => {
    stubProxy({ status: 1, outputs: [], progress: 42 });
    remember(TASK, '白色圆桌', 1);
    const result = await importPendingMaterial(`pending:${TASK}`, { localProxy: true });
    expect(result).toMatchObject({ state: 'pending', message: '生成中 42%，完成后会自动放进物料库' });
    expect(listPendingMaterials()).toHaveLength(1);
  });

  it('任务失败或取消：清掉卡片，避免永远转圈', async () => {
    for (const status of [4, 6] as const) {
      stubProxy({ status, outputs: [] });
      remember(TASK, '白色圆桌', 1);
      const result = await importPendingMaterial(`pending:${TASK}`, { localProxy: true });
      expect(result.state).toBe('failed');
      expect(listPendingMaterials()).toHaveLength(0);
    }
  });

  it('完成但没有 GLB：给出明确原因并清卡', async () => {
    stubProxy({ status: 3, outputs: [SPZ] });
    remember(TASK, '白色圆桌', 1);
    const result = await importPendingMaterial(`pending:${TASK}`, { localProxy: true });
    expect(result).toMatchObject({ state: 'failed', message: '任务已完成，但产物里没有 GLB 模型。' });
    expect(listPendingMaterials()).toHaveLength(0);
  });

  it('网络失败标成可重试，卡片保留', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    remember(TASK, '白色圆桌', 1);
    const result = await importPendingMaterial(`pending:${TASK}`, { localProxy: true });
    expect(result).toMatchObject({ state: 'failed', retryable: true });
    expect(listPendingMaterials()).toHaveLength(1);
  });

  it('取回最新：从最新任务往回试，跳过仍在生成的那条', async () => {
    remember('1001', '旧椅子', 10);
    remember('1002', '新茶几', 20);
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && url.pathname === '/task') {
        return url.searchParams.get('taskid') === '1002'
          ? json({ status: 1, outputs: [], progress: 10 })
          : json({ status: 3, outputs: [GLB] });
      }
      if (method === 'POST' && url.pathname === '/asset') return json({ assetId: ASSET_ID, kind: 'glb', bytes: bytes().byteLength });
      if (method === 'GET' && url.pathname === `/asset/${ASSET_ID}.glb`) return binary(bytes());
      throw new Error(`unexpected ${method} ${url.pathname}`);
    }));
    const result = await importLatestPendingMaterials({ localProxy: true });
    expect(result.state).toBe('imported');
    if (result.state !== 'imported') throw new Error('expected imported');
    expect(result.item.name).toBe('旧椅子');
    expect(listPendingMaterials().map(card => card.id)).toEqual(['pending:1002']);
  });

  it('没有本机代理时诚实报错，不假装入库', async () => {
    remember(TASK, '白色圆桌', 1);
    const result = await importPendingMaterial(`pending:${TASK}`, { localProxy: false });
    expect(result.state).toBe('failed');
    expect(listPendingMaterials()).toHaveLength(1);
  });

  it('任务详情缺状态或非 GLB 产物都不算成功', async () => {
    stubProxy({ status: 9, outputs: [] });
    await expect(fetchLux3dTask(TASK)).rejects.toThrow('任务详情格式无效');
    expect(glbOutputOf([SPZ, 'https://cos.example.test/a.glb.png'])).toBeUndefined();
    expect(glbOutputOf([SPZ, GLB])).toBe(GLB);
  });
});
