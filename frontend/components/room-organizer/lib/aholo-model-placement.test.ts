// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packGltf } from '../../../../supabase/functions/_shared/models';
import { tetrahedron } from '../../../../tests/model-fixture';
import { clearGlbAssetCache, getGlbAssetState } from '../three/glb-assets';
import { DIRECT_BASE, listAholoAssets, rememberAholoAsset } from './aholo-assets';
import { loadAholoCatalogItem, loadAholoSceneSource, loadStoredAholoCatalogItem, metersFromForwardBox, storedAholoSceneSource } from './aholo-model-placement';
import { isPackagedGlbUrl } from './glb-url';

const TASK_ID = '4475964';
const COS_URL = 'https://cos.example.test/lux3d/4475964/textured.glb?q-signature=secret';
const ASSET_ID = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';

/** 四面体本来就是 1×1×1，按轴拉长后才能验出宽高深没有串轴；accessor 的 min/max 要一起改。 */
function glb(scale: [number, number, number]): Uint8Array {
  const fixture = tetrahedron();
  const floats = new Float32Array(fixture.resources['model.bin']!.buffer);
  for (let vertex = 0; vertex < 12; vertex += 3) {
    for (let axis = 0; axis < 3; axis++) floats[vertex + axis] = (floats[vertex + axis] ?? 0) * scale[axis];
  }
  fixture.json.accessors![0]!.max = [...scale];
  return packGltf(fixture.json, fixture.resources);
}

function json(body: unknown) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body } as unknown as Response;
}

function binary(bytes: Uint8Array) {
  return {
    ok: true, status: 200, body: undefined,
    headers: new Headers({ 'content-length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  } as unknown as Response;
}

/** 只模拟本机代理：POST /asset 落盘、GET /asset/<id>.glb 回源，其余请求一律算错。 */
function stubProxy(reply: { kind?: string; bytes?: Uint8Array } = {}) {
  const kind = reply.kind ?? 'glb';
  const bytes = reply.bytes ?? glb([2, 1.5, 0.5]);
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url.pathname}`);
    if (method === 'POST' && url.pathname === '/asset') return json({ assetId: ASSET_ID, kind, bytes: bytes.byteLength });
    if (method === 'GET' && url.pathname === `/asset/${ASSET_ID}.${kind}`) return binary(bytes);
    throw new Error(`unexpected ${method} ${url.pathname}`);
  }));
  return { calls, bytes };
}

describe('Aholo 产物摆进布置场景 (#66)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearGlbAssetCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearGlbAssetCache();
    localStorage.clear();
  });

  it('落盘换成本机地址，并按模型真实包围盒给出宽高深', async () => {
    const proxy = stubProxy({});
    const item = await loadAholoCatalogItem({ url: COS_URL, name: '一张白色圆桌', taskid: TASK_ID });
    expect(proxy.calls).toEqual(['POST /asset', `GET /asset/${ASSET_ID}.glb`]);
    expect(item).toMatchObject({
      type: 'glb-asset', name: '一张白色圆桌', assetId: ASSET_ID, source: 'generated', materialId: 'asset',
      glbUrl: `${DIRECT_BASE}/asset/${ASSET_ID}.glb`,
    });
    // 四面体 x∈[0,2] y∈[0,1.5] z∈[0,0.5]：宽取 x、高取 y、深取 z。
    expect(item.width).toBeCloseTo(2, 5);
    expect(item.height).toBeCloseTo(1.5, 5);
    expect(item.depth).toBeCloseTo(0.5, 5);
    expect(getGlbAssetState(ASSET_ID).status).toBe('ready');
    expect(listAholoAssets()).toEqual([
      { assetId: ASSET_ID, kind: 'glb', name: '一张白色圆桌', bytes: proxy.bytes.byteLength, savedAt: expect.any(Number), taskid: TASK_ID },
    ]);
    expect(JSON.stringify(item)).not.toMatch(/cos\.example\.test|q-signature/);
  });

  it('同一任务号再点一次复用本机文件，不再落盘也不再下载', async () => {
    const proxy = stubProxy({});
    const first = await loadAholoCatalogItem({ url: COS_URL, name: '一张白色圆桌', taskid: TASK_ID });
    const second = await loadAholoCatalogItem({ url: COS_URL, name: '一张白色圆桌', taskid: TASK_ID });
    expect(proxy.calls).toHaveLength(2);
    expect(second).toEqual(first);
    expect(listAholoAssets()).toHaveLength(1);
  });

  it('落盘的不是 GLB 时不请求模型，也不假装能摆放', async () => {
    const proxy = stubProxy({ kind: 'spz' });
    await expect(loadAholoCatalogItem({ url: COS_URL, name: '午后咖啡馆', taskid: TASK_ID }))
      .rejects.toThrow(/点云文件/);
    expect(proxy.calls).toEqual(['POST /asset']);
    expect(getGlbAssetState(ASSET_ID).status).toBe('idle');
  });

  it('本机回源的字节不是有效 GLB 时透出原因，并记下失败态', async () => {
    const proxy = stubProxy({ bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) });
    await expect(loadAholoCatalogItem({ url: COS_URL, name: '一张白色圆桌', taskid: TASK_ID }))
      .rejects.toThrow(/GLB/);
    expect(proxy.calls).toHaveLength(2);
    expect(getGlbAssetState(ASSET_ID).status).toBe('error');
  });

  it('代理没启动时报错指向启动命令，且不写注册表', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(loadAholoCatalogItem({ url: COS_URL, name: '一张白色圆桌', taskid: TASK_ID }))
      .rejects.toThrow('lux3d-dev-proxy.mjs');
    expect(listAholoAssets()).toEqual([]);
  });

  it('物料库重复摆放只认资产号，向本机代理取一次就量出尺寸', async () => {
    const proxy = stubProxy({});
    rememberAholoAsset({ assetId: ASSET_ID, kind: 'glb', name: '一张白色圆桌', bytes: 1024, savedAt: 1 });
    const item = await loadStoredAholoCatalogItem(ASSET_ID);
    expect(proxy.calls).toEqual([`GET /asset/${ASSET_ID}.glb`]);
    expect(item).toMatchObject({ assetId: ASSET_ID, name: '一张白色圆桌', glbUrl: `${DIRECT_BASE}/asset/${ASSET_ID}.glb` });
    expect(item.width).toBeCloseTo(2, 5);
  });

  it('注册表里没有的资产号不发起请求，直说本机已经没有', async () => {
    const proxy = stubProxy({});
    await expect(loadStoredAholoCatalogItem('00000000-0000-4000-8000-000000000000'))
      .rejects.toThrow('本机已经没有这个模型');
    expect(proxy.calls).toEqual([]);
  });

  it('3DGS 场景落盘后只交本机稳定地址，那条签名链接到此为止', async () => {
    const proxy = stubProxy({ kind: 'spz' });
    const source = await loadAholoSceneSource({ url: COS_URL.replace('.glb', '.spz'), name: '午后咖啡馆', taskid: TASK_ID });
    expect(proxy.calls).toEqual(['POST /asset']);
    expect(source).toEqual({
      assetId: ASSET_ID, name: '午后咖啡馆', url: `${DIRECT_BASE}/asset/${ASSET_ID}.spz`,
    });
  });

  it('环境预览列表里的重复打开：只认资产号，一次请求都不发', async () => {
    const proxy = stubProxy({ kind: 'spz' });
    rememberAholoAsset({ assetId: ASSET_ID, kind: 'spz', name: '午后咖啡馆', bytes: 20 * 1024 * 1024, savedAt: 1 });
    expect(storedAholoSceneSource(ASSET_ID)).toEqual({
      assetId: ASSET_ID, name: '午后咖啡馆', url: `${DIRECT_BASE}/asset/${ASSET_ID}.spz`,
    });
    expect(proxy.calls).toEqual([]);
  });

  it('物件模型不能当场景预览，两者走的是不同入口', async () => {
    rememberAholoAsset({ assetId: ASSET_ID, kind: 'glb', name: '一张白色圆桌', bytes: 1024, savedAt: 1 });
    expect(() => storedAholoSceneSource(ASSET_ID)).toThrow('请在「生成物件」里摆进场景');
    expect(() => storedAholoSceneSource('00000000-0000-4000-8000-000000000000')).toThrow('本机已经没有这个场景');
  });

  it('仓库留档的物件向本站取那份路径，图纸带着它也能重开', async () => {
    const bytes = glb([2, 1.5, 0.5]);
    const path = '/showcase/assets/generated/model/chinese-wood-armchair.glb';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost:3000');
      calls.push(url.pathname);
      if (url.pathname !== path) throw new Error(`unexpected ${url.pathname}`);
      return binary(bytes);
    }));
    const item = await loadStoredAholoCatalogItem('shipped-chinese-wood-armchair');
    expect(item).toMatchObject({
      assetId: 'shipped-chinese-wood-armchair', name: '中式木扶手椅', source: 'generated', glbUrl: path,
    });
    expect(item.width).toBeCloseTo(2, 5);
    // 同源路径不会过期，所以保存时不必剪掉它，换浏览器也还能摆。
    expect(isPackagedGlbUrl(item.glbUrl)).toBe(true);
    expect(calls).toEqual([path]);
  });

  it('仓库留档的场景不查注册表、不发请求，直接给本站那条 SPZ', () => {
    expect(storedAholoSceneSource('shipped-small-launch-hall')).toEqual({
      assetId: 'shipped-small-launch-hall', name: '小型发布会场地',
      url: '/showcase/assets/generated/scene/small-launch-hall.spz',
    });
  });
});

describe('lod-meta forwardBox 换算真实尺度（高斯优先）', () => {
  it('按实测证据（6.32 × 5.91 × 3.45 m）换算宽深高，保留一位小数', () => {
    expect(metersFromForwardBox({
      min: [-2.9712802322485494, -2.880020668781839, -1.367995017790145],
      max: [3.3480754337585843, 3.0265181297767363, 2.0854901090206344],
    })).toEqual({ width: 6.3, depth: 5.9, height: 3.5 });
  });

  it('轴序不串：Z-up 的 forwardBox 里 z 是高度，x/y 是宽深', () => {
    expect(metersFromForwardBox({ min: [0, 0, 0], max: [4, 3, 6] })).toEqual({ width: 4, depth: 3, height: 6 });
  });

  it('坏档拒绝：缺轴、非数字、以及 0.5–120 m 之外的离谱值', () => {
    expect(metersFromForwardBox(null)).toBeNull();
    expect(metersFromForwardBox({ min: [0, 0], max: [1, 1, 1] })).toBeNull();
    expect(metersFromForwardBox({ min: [0, 0, 'x'], max: [1, 1, 1] })).toBeNull();
    expect(metersFromForwardBox({ min: [0, 0, 0], max: [0.1, 0.1, 0.1] })).toBeNull();
    expect(metersFromForwardBox({ min: [0, 0, 0], max: [500, 5, 3] })).toBeNull();
  });
});
