// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metersFromForwardBox } from './splat-meters';

const LOCAL_PROXY = 'http://127.0.0.1:3199';
const REMOTE_RELAY = 'https://relay.example.test';
const TEAROOM = '26932bea-190d-4e8d-b2f2-54641d084043';
const ROOM130 = '6645e211-d690-4673-a4b4-85888d09906d';
const WEST_LAKE_FAST = 'c338f720-3f60-4adb-8f3b-023300000002';

/** 直连地址在模块加载时读进常量，所以要先 stub 环境变量再重载模块。 */
async function loadWithProxy(base: string) {
  vi.stubEnv('NEXT_PUBLIC_LUX3D_DIRECT_URL', base);
  vi.resetModules();
  return import('./local-scans');
}

/** 2026-11-19：本机登记前会探一次文件在不在；这里按需要把探活结果钉死。 */
function stubProbe(answer: (url: string) => boolean) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: answer(String(url)) })));
}

describe('本机扫描登记', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('按文件索引把实景扫描登记进资产表，带上落盘时间与真实尺度', async () => {
    const { registerLocalScans } = await loadWithProxy(LOCAL_PROXY);
    const { listAholoAssets } = await import('./aholo-assets');
    stubProbe(() => true);
    expect(await registerLocalScans()).toBe(8);
    const assets = listAholoAssets();
    expect(assets).toHaveLength(8);
    const westLake = assets.find(asset => asset.assetId === WEST_LAKE_FAST);
    expect(westLake?.name).toBe('西湖 0233 · 极速档');
    expect(westLake?.kind).toBe('spz');
    expect(westLake?.bytes).toBe(7_795_522);
    // 茶室 130 有 lod-meta 的 forwardBox：宽 20.4 m、深 17.2 m、高 35.8 m。
    expect(assets.find(asset => asset.assetId === TEAROOM)?.meters).toEqual({ width: 20.4, depth: 17.2, height: 35.8 });
    // 2026-11-19：房间 130 以前被测试夹具目录 tearoom-lod-test 盖掉，读到的 ±2047 假盒被尺度守卫挡下；
    // 改成「夹具目录不参与反查」后它读自己的 scan-room130-2048，宽深按真实包围盒。
    expect(assets.find(asset => asset.assetId === ROOM130)?.meters).toMatchObject({ width: 40.8, depth: 27.1 });
    // ±2047 这种坏档仍然不能当尺度：守卫在 splat-meters，不靠调用方自己记得。
    expect(metersFromForwardBox({ min: [-2047.46, -2047.68, -2047.03], max: [2047.43, 2047.95, 2047.23] })).toBeNull();
    // 索引带的 lodUrl 要跟记录一起落进注册表，否则派生好的 LOD 没人用。
    expect(assets.find(asset => asset.assetId === TEAROOM)?.lodUrl).toBe('/scans/tearoom-130/lod-meta.json');
    expect(assets.every(asset => Boolean(asset.lodUrl))).toBe(true);
  });

  it('重复登记不会灌水：已登记的条目跳过，资产表数量不变', async () => {
    const { registerLocalScans } = await loadWithProxy(LOCAL_PROXY);
    const { listAholoAssets } = await import('./aholo-assets');
    stubProbe(() => true);
    expect(await registerLocalScans()).toBe(8);
    expect(await registerLocalScans()).toBe(0);
    expect(listAholoAssets()).toHaveLength(8);
  });

  it('磁盘上没文件就不登记：这是「加载不出来」的根源，不能装成本机有副本', async () => {
    const { registerLocalScans } = await loadWithProxy(LOCAL_PROXY);
    const { listAholoAssets } = await import('./aholo-assets');
    stubProbe(() => false);
    expect(await registerLocalScans()).toBe(0);
    expect(listAholoAssets()).toHaveLength(0);
  });

  it('代理不在这台电脑上就不登记：部署站不该挂着别人机器的扫描', async () => {
    const { registerLocalScans } = await loadWithProxy(REMOTE_RELAY);
    const { listAholoAssets } = await import('./aholo-assets');
    stubProbe(() => true);
    expect(await registerLocalScans()).toBe(0);
    expect(listAholoAssets()).toHaveLength(0);
  });

  it('用户自己攒下的其它资产不会被本机扫描挤掉', async () => {
    const { registerLocalScans } = await loadWithProxy(LOCAL_PROXY);
    const { listAholoAssets, rememberAholoAsset } = await import('./aholo-assets');
    stubProbe(() => true);
    rememberAholoAsset({
      assetId: '00000000-0000-4000-8000-000000000000', kind: 'glb',
      name: '一把木椅', bytes: 1_024, savedAt: 1_700_000_000_000,
    });
    expect(await registerLocalScans()).toBe(8);
    expect(listAholoAssets()).toHaveLength(9);
  });
});

describe('云端扫描登记', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('没有本机代理也登记：部署站靠云端副本找回这批实景，地址走云端资产库', async () => {
    const { registerCloudScans } = await loadWithProxy(REMOTE_RELAY);
    const { CLOUD_ASSETS_BASE } = await import('./cloud-assets');
    const { listAholoAssets, resolveAholoAssetUrl } = await import('./aholo-assets');
    expect(registerCloudScans()).toBe(8);
    const westLake = listAholoAssets().find(asset => asset.assetId === WEST_LAKE_FAST);
    expect(westLake?.origin).toBe('cloud');
    expect(westLake?.name).toBe('西湖 0233 · 极速档');
    expect(resolveAholoAssetUrl(WEST_LAKE_FAST)).toBe(`${CLOUD_ASSETS_BASE}/scans/${WEST_LAKE_FAST}.spz`);
    // 云端登记也要带 LOD：索引里有站内目录就用它（线上静态文件一样能读）。
    expect(westLake?.lodUrl).toBe('/scans/scan-xihu-0233-low/lod-meta.json');
    // 2026-11-19 用户：「没有其他和我的区分，这些都是我们的云资产」——
    // 索引里的「本机高斯 26932bea」进注册表时换成日期名，线上不看机器前缀与资产号。
    const gauss = listAholoAssets().find(asset => asset.assetId === TEAROOM);
    expect(gauss?.name).toMatch(/^实景扫描 \d{2}\/\d{2}$/);
    expect(gauss?.name).not.toMatch(/本机|云端|高斯/);
  });

  it('本机副本优先：能直连本机文件时云端登记只补缺、不覆盖', async () => {
    const { registerLocalScans, registerCloudScans } = await loadWithProxy(LOCAL_PROXY);
    const { resolveAholoAssetUrl } = await import('./aholo-assets');
    stubProbe(() => true);
    expect(await registerLocalScans()).toBe(8);
    expect(registerCloudScans()).toBe(0);
    expect(resolveAholoAssetUrl(TEAROOM)).toBe(`${LOCAL_PROXY}/asset/${TEAROOM}.spz`);
  });

  it('本机文件没了：登记跳过、改用云端副本，不再挂 127.0.0.1', async () => {
    const { registerLocalScans, registerCloudScans } = await loadWithProxy(LOCAL_PROXY);
    const { CLOUD_ASSETS_BASE } = await import('./cloud-assets');
    const { resolveAholoAssetUrl } = await import('./aholo-assets');
    stubProbe(() => false);
    expect(await registerLocalScans()).toBe(0);
    expect(registerCloudScans()).toBe(8);
    expect(resolveAholoAssetUrl(TEAROOM)).toBe(`${CLOUD_ASSETS_BASE}/scans/${TEAROOM}.spz`);
  });
});

describe('本机地址失效回退云端', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('本机 404、云端有副本：改写 origin 为 cloud，取源随之改走云端', async () => {
    const { repairScanFallback } = await loadWithProxy(LOCAL_PROXY);
    const { CLOUD_ASSETS_BASE } = await import('./cloud-assets');
    const { findAholoAsset, rememberAholoAsset, resolveAholoAssetUrl } = await import('./aholo-assets');
    rememberAholoAsset({ assetId: TEAROOM, kind: 'spz', name: '茶室 130', bytes: 35_000_000, savedAt: 1 });
    expect(findAholoAsset(TEAROOM)?.origin).toBeUndefined();
    // 本机探活失败（模拟文件被清），云端副本 200。
    stubProbe(url => url.startsWith(CLOUD_ASSETS_BASE));
    expect(await repairScanFallback(TEAROOM)).toBe(true);
    expect(findAholoAsset(TEAROOM)?.origin).toBe('cloud');
    expect(resolveAholoAssetUrl(TEAROOM)).toBe(`${CLOUD_ASSETS_BASE}/scans/${TEAROOM}.spz`);
    // 已经指向云端就不再探活。
    expect(await repairScanFallback(TEAROOM)).toBe(false);
  });

  it('本机文件在就保持本机来源，不白跑一次云端', async () => {
    const { repairScanFallback } = await loadWithProxy(LOCAL_PROXY);
    const { findAholoAsset, rememberAholoAsset } = await import('./aholo-assets');
    rememberAholoAsset({ assetId: TEAROOM, kind: 'spz', name: '茶室 130', bytes: 35_000_000, savedAt: 1 });
    stubProbe(() => true);
    expect(await repairScanFallback(TEAROOM)).toBe(false);
    expect(findAholoAsset(TEAROOM)?.origin).toBeUndefined();
  });
});
