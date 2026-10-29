// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DIRECT_BASE,
  aholoAssetUrl,
  findAholoAsset,
  findAholoAssetByTask,
  forgetAholoAsset,
  importAholoAsset,
  listAholoAssets,
  rememberAholoAsset,
  resolveAholoAssetUrl,
} from './aholo-assets';

const ID = '4165e104-e2c1-4f5e-b2a4-46602bf9f932';
const OTHER = '00000000-0000-4000-8000-000000000000';
const COS = 'https://aholo-cos.example.test/lux3d/4475964/MODEL.glb?sign=q-signature%3Dabc';

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function stubFetch(handler: (init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => handler(init) as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const stashed = () => ({ assetId: ID, kind: 'glb' as const, bytes: 6_433_368, url: `/asset/${ID}.glb` });

describe('Aholo 资产注册表', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('落盘只把待换的签名链接交给代理，换回本机稳定地址', async () => {
    const calls = stubFetch(() => jsonResponse(stashed()));
    const asset = await importAholoAsset({ url: COS, name: '一把木椅', taskid: '4475964' });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(calls.mock.calls[0][0]).toBe(`${DIRECT_BASE}/asset`);
    expect(JSON.parse(String(calls.mock.calls[0][1]?.body))).toEqual({ url: COS });
    expect(asset).toEqual({
      assetId: ID, kind: 'glb', name: '一把木椅', bytes: 6_433_368, taskid: '4475964',
      savedAt: expect.any(Number), url: `${DIRECT_BASE}/asset/${ID}.glb`,
    });
    expect(findAholoAsset(ID)?.name).toBe('一把木椅');
    expect(resolveAholoAssetUrl(ID)).toBe(`${DIRECT_BASE}/asset/${ID}.glb`);
  });

  it('同一任务号重复点击不再下载，直接复用已落盘的资产', async () => {
    const calls = stubFetch(() => jsonResponse(stashed()));
    const first = await importAholoAsset({ url: COS, name: '一把木椅', taskid: '4475964' });
    const second = await importAholoAsset({ url: COS.replace('abc', 'def'), name: '一把木椅', taskid: '4475964' });
    expect(calls).toHaveBeenCalledTimes(1);
    expect(second.url).toBe(first.url);
    expect(listAholoAssets()).toHaveLength(1);
  });

  it('不同任务号各落一份，注册表按新到旧排列并封顶 40 条', async () => {
    stubFetch(() => jsonResponse({ ...stashed(), assetId: crypto.randomUUID() }));
    for (let index = 0; index < 41; index += 1) {
      await importAholoAsset({ url: `${COS}&i=${index}`, name: `模型 ${index}`, taskid: `task-${index}` });
    }
    const items = listAholoAssets();
    expect(items).toHaveLength(40);
    expect(items[0]?.name).toBe('模型 40');
  });

  for (const [label, reply, message] of [
    ['代理报错原文', jsonResponse({ error: '产物不是 GLB / SPZ / PLY，未落盘' }, 415), '产物不是 GLB / SPZ / PLY，未落盘'],
    ['无错误文案的状态码', jsonResponse({}, 500), '本机代理返回 HTTP 500'],
    ['资产号不是 UUID', jsonResponse({ ...stashed(), assetId: '../etc/passwd' }), '落盘返回的资产号无效，已放弃。'],
    ['未知类型', jsonResponse({ ...stashed(), kind: 'exe' }), '落盘返回的资产号无效，已放弃。'],
  ] as const) {
    it(`落盘失败：${label}`, async () => {
      stubFetch(() => reply);
      await expect(importAholoAsset({ url: COS, name: '一把木椅' })).rejects.toThrow(message);
      expect(listAholoAssets()).toEqual([]);
    });
  }

  it('代理没起来时说清怎么连，而不是丢一个 fetch 堆栈', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(importAholoAsset({ url: COS })).rejects.toThrow('连不上本机代理，先运行：node tools/aholo/lux3d-dev-proxy.mjs');
  });

  it('脏注册表只留下可信记录，坏 JSON 不炸渲染', () => {
    localStorage.setItem('scendance:aholo-assets', 'not json');
    expect(listAholoAssets()).toEqual([]);
    localStorage.setItem('scendance:aholo-assets', JSON.stringify([
      { assetId: ID, kind: 'glb', name: '好', bytes: 10, savedAt: 1 },
      { assetId: 'nope', kind: 'glb', name: '坏号', bytes: 10, savedAt: 1 },
      { assetId: OTHER, kind: 'exe', name: '坏类型', bytes: 10, savedAt: 1 },
      { assetId: OTHER, kind: 'glb', name: '零字节', bytes: 0, savedAt: 1 },
      { assetId: OTHER, kind: 'glb', name: '坏任务号', bytes: 10, savedAt: 1, taskid: 'injection/../x' },
      null,
    ]));
    expect(listAholoAssets().map(item => item.name)).toEqual(['好']);
    expect(findAholoAssetByTask('nope')).toBeUndefined();
  });

  it('同资产号覆盖旧记录，去掉任务号后按号查不到', () => {
    expect(rememberAholoAsset({ assetId: ID, kind: 'glb', name: '  旧名  ', bytes: 1, savedAt: 1, taskid: 'a' })).toEqual({
      assetId: ID, kind: 'glb', name: '旧名', bytes: 1, savedAt: 1, taskid: 'a',
    });
    expect(rememberAholoAsset({ assetId: ID, kind: 'spz', name: '', bytes: 2, savedAt: 2 })).toEqual({
      assetId: ID, kind: 'spz', name: '生成模型', bytes: 2, savedAt: 2,
    });
    expect(listAholoAssets()).toHaveLength(1);
    expect(aholoAssetUrl(findAholoAsset(ID))).toBe(`${DIRECT_BASE}/asset/${ID}.spz`);
    forgetAholoAsset(ID);
    expect(resolveAholoAssetUrl(ID)).toBeUndefined();
    expect(resolveAholoAssetUrl(undefined)).toBeUndefined();
    expect(findAholoAsset(ID.toUpperCase())).toBeUndefined();
  });

  it('存储被禁用时仍能落盘并拿到地址，只是下次开页要重新落', async () => {
    const blocked = {
      getItem: () => null,
      setItem: () => { throw new Error('SecurityError'); },
    } as unknown as Storage;
    vi.stubGlobal('window', { localStorage: blocked });
    stubFetch(() => jsonResponse(stashed()));
    await expect(importAholoAsset({ url: COS, name: '一把木椅' })).resolves.toMatchObject({ url: `${DIRECT_BASE}/asset/${ID}.glb` });
  });
});
