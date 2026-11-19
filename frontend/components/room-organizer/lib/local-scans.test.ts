// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { metersFromForwardBox } from './splat-meters';

const LOCAL_PROXY = 'http://127.0.0.1:3199';
const REMOTE_RELAY = 'https://relay.example.test';
const WEST_LAKE_FAST = 'c338f720-3f60-4adb-8f3b-023300000002';
// 2026-11-19 用户拍板：批量删除后索引只剩两条——西湖 0233 极速档与 11/08 新场景。
const SCAN_11_08 = '48245ba8-8f0c-456f-a4c4-6a13526e08b9';
// 2026-11-19 已删（见 data/local-scans.json 的 removed）：只剩墓碑，不再进索引；
// 茶室 130 这个号在回退测试里只当普通 uuid 夹具用。
const WEST_LAKE_NORMAL = 'c338f720-3f60-4adb-8f3b-023300000001';
const TOMBSTONED_ID = '26932bea-190d-4e8d-b2f2-54641d084043';

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
    expect(await registerLocalScans()).toBe(2);
    const assets = listAholoAssets();
    expect(assets).toHaveLength(2);
    const westLake = assets.find(asset => asset.assetId === WEST_LAKE_FAST);
    expect(westLake?.name).toBe('西湖 0233 · 极速档');
    expect(westLake?.kind).toBe('spz');
    expect(westLake?.bytes).toBe(7_795_522);
    // 极速档的 lod-meta forwardBox：宽 51.5 m、深 63.3 m、高 20 m。
    expect(westLake?.meters).toEqual({ width: 51.5, depth: 63.3, height: 20 });
    // 11/08 那场：机器名进注册表时换成日期名，宽深高按真实包围盒。
    const latest = assets.find(asset => asset.assetId === SCAN_11_08);
    expect(latest?.name).toMatch(/^实景扫描 \d{2}\/\d{2}$/);
    expect(latest?.name).not.toMatch(/本机|云端|高斯/);
    expect(latest?.meters).toEqual({ width: 40.9, depth: 15.7, height: 45.8 });
    // ±2047 这种坏档仍然不能当尺度：守卫在 splat-meters，不靠调用方自己记得。
    expect(metersFromForwardBox({ min: [-2047.46, -2047.68, -2047.03], max: [2047.43, 2047.95, 2047.23] })).toBeNull();
    // 索引带的 lodUrl 要跟记录一起落进注册表，否则派生好的 LOD 没人用。
    expect(westLake?.lodUrl).toBe('/scans/scan-xihu-0233-low/lod-meta.json');
    expect(latest?.lodUrl).toBe('/scans/scan-48245ba8/lod-meta.json');
    expect(assets.every(asset => Boolean(asset.lodUrl))).toBe(true);
  });

  it('重复登记不会灌水：已登记的条目跳过，资产表数量不变', async () => {
    const { registerLocalScans } = await loadWithProxy(LOCAL_PROXY);
    const { listAholoAssets } = await import('./aholo-assets');
    stubProbe(() => true);
    expect(await registerLocalScans()).toBe(2);
    expect(await registerLocalScans()).toBe(0);
    expect(listAholoAssets()).toHaveLength(2);
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
    expect(await registerLocalScans()).toBe(2);
    expect(listAholoAssets()).toHaveLength(3);
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
    expect(registerCloudScans()).toBe(2);
    const westLake = listAholoAssets().find(asset => asset.assetId === WEST_LAKE_FAST);
    expect(westLake?.origin).toBe('cloud');
    expect(resolveAholoAssetUrl(WEST_LAKE_FAST)).toBe(`${CLOUD_ASSETS_BASE}/scans/${WEST_LAKE_FAST}.spz`);
    // 云端登记走云端 LOD（scans/<id>/lod-meta.json），不指站内的 /scans/<dir>/：
    // 那一整个目录在 .gitignore 里，部署站读不到。
    expect(westLake?.lodUrl).toBe(`${CLOUD_ASSETS_BASE}/scans/${WEST_LAKE_FAST}/lod-meta.json`);
    // 2026-11-19 用户：「没有其他和我的区分，这些都是我们的云资产」——
    // 索引里的「本机高斯 48245ba8」进注册表时换成日期名，线上不看机器前缀与资产号。
    const gauss = listAholoAssets().find(asset => asset.assetId === SCAN_11_08);
    expect(gauss?.name).toMatch(/^实景扫描 \d{2}\/\d{2}$/);
    expect(gauss?.name).not.toMatch(/本机|云端|高斯/);
  });

  it('本机副本优先：能直连本机文件时云端登记只补缺、不覆盖', async () => {
    const { registerLocalScans, registerCloudScans } = await loadWithProxy(LOCAL_PROXY);
    const { resolveAholoAssetUrl } = await import('./aholo-assets');
    stubProbe(() => true);
    expect(await registerLocalScans()).toBe(2);
    expect(registerCloudScans()).toBe(0);
    expect(resolveAholoAssetUrl(WEST_LAKE_FAST)).toBe(`${LOCAL_PROXY}/asset/${WEST_LAKE_FAST}.spz`);
  });

  it('本机文件没了：登记跳过、改用云端副本，不再挂 127.0.0.1', async () => {
    const { registerLocalScans, registerCloudScans } = await loadWithProxy(LOCAL_PROXY);
    const { CLOUD_ASSETS_BASE } = await import('./cloud-assets');
    const { resolveAholoAssetUrl } = await import('./aholo-assets');
    stubProbe(() => false);
    expect(await registerLocalScans()).toBe(0);
    expect(registerCloudScans()).toBe(2);
    expect(resolveAholoAssetUrl(WEST_LAKE_FAST)).toBe(`${CLOUD_ASSETS_BASE}/scans/${WEST_LAKE_FAST}.spz`);
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
    rememberAholoAsset({ assetId: TOMBSTONED_ID, kind: 'spz', name: '回退夹具', bytes: 35_000_000, savedAt: 1 });
    expect(findAholoAsset(TOMBSTONED_ID)?.origin).toBeUndefined();
    // 本机探活失败（模拟文件被清），云端副本 200。
    stubProbe(url => url.startsWith(CLOUD_ASSETS_BASE));
    expect(await repairScanFallback(TOMBSTONED_ID)).toBe(true);
    expect(findAholoAsset(TOMBSTONED_ID)?.origin).toBe('cloud');
    expect(resolveAholoAssetUrl(TOMBSTONED_ID)).toBe(`${CLOUD_ASSETS_BASE}/scans/${TOMBSTONED_ID}.spz`);
    // 已经指向云端就不再探活。
    expect(await repairScanFallback(TOMBSTONED_ID)).toBe(false);
  });

  it('本机文件在就保持本机来源，不白跑一次云端', async () => {
    const { repairScanFallback } = await loadWithProxy(LOCAL_PROXY);
    const { findAholoAsset, rememberAholoAsset } = await import('./aholo-assets');
    rememberAholoAsset({ assetId: TOMBSTONED_ID, kind: 'spz', name: '回退夹具', bytes: 35_000_000, savedAt: 1 });
    stubProbe(() => true);
    expect(await repairScanFallback(TOMBSTONED_ID)).toBe(false);
    expect(findAholoAsset(TOMBSTONED_ID)?.origin).toBeUndefined();
  });
});

describe('清单删除的资产退注册表（墓碑同步）', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('墓碑里的资产号从注册表退掉，没删的照旧留着', async () => {
    const { forgetRemovedScans, removedScanIds } = await loadWithProxy(LOCAL_PROXY);
    const { findAholoAsset, rememberAholoAsset } = await import('./aholo-assets');
    // 墓碑就是清单里的 removed：六个已删资产号都在，极速档与 11/08 不在。
    expect(removedScanIds()).toContain(WEST_LAKE_NORMAL);
    expect(removedScanIds()).toContain(TOMBSTONED_ID);
    expect(removedScanIds()).not.toContain(WEST_LAKE_FAST);
    expect(removedScanIds()).not.toContain(SCAN_11_08);
    rememberAholoAsset({ assetId: WEST_LAKE_NORMAL, kind: 'spz', name: '西湖 0233 · 标准档', bytes: 23_239_097, savedAt: 1 });
    rememberAholoAsset({ assetId: WEST_LAKE_FAST, kind: 'spz', name: '西湖 0233 · 极速档', bytes: 7_795_522, savedAt: 1 });
    expect(forgetRemovedScans()).toBe(1);
    expect(findAholoAsset(WEST_LAKE_NORMAL)).toBeUndefined();
    expect(findAholoAsset(WEST_LAKE_FAST)?.name).toBe('西湖 0233 · 极速档');
    // 没有历史登记时是空跑，不报错也不改动。
    expect(forgetRemovedScans()).toBe(0);
  });
});
