// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('本机扫描登记', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('按文件索引把本机高斯登记进资产表，带上落盘时间与真实尺度', async () => {
    const { registerLocalScans } = await loadWithProxy(LOCAL_PROXY);
    const { listAholoAssets } = await import('./aholo-assets');
    expect(registerLocalScans()).toBe(8);
    const assets = listAholoAssets();
    expect(assets).toHaveLength(8);
    const westLake = assets.find(asset => asset.assetId === WEST_LAKE_FAST);
    expect(westLake?.name).toBe('西湖 0233 · 极速档');
    expect(westLake?.kind).toBe('spz');
    expect(westLake?.bytes).toBe(7_795_522);
    // 茶室 130 有 lod-meta 的 forwardBox：宽 20.4 m、深 17.2 m、高 35.8 m。
    expect(assets.find(asset => asset.assetId === TEAROOM)?.meters).toEqual({ width: 20.4, depth: 17.2, height: 35.8 });
    // 房间 130 的 forwardBox 是 ±2047 的坏档，不能拿来当场地尺寸。
    expect(assets.find(asset => asset.assetId === ROOM130)?.meters).toBeUndefined();
  });

  it('重复登记不会灌水：已登记的条目跳过，资产表数量不变', async () => {
    const { registerLocalScans } = await loadWithProxy(LOCAL_PROXY);
    const { listAholoAssets } = await import('./aholo-assets');
    expect(registerLocalScans()).toBe(8);
    expect(registerLocalScans()).toBe(0);
    expect(listAholoAssets()).toHaveLength(8);
  });

  it('代理不在这台电脑上就不登记：部署站不该挂着别人机器的扫描', async () => {
    const { registerLocalScans } = await loadWithProxy(REMOTE_RELAY);
    const { listAholoAssets } = await import('./aholo-assets');
    expect(registerLocalScans()).toBe(0);
    expect(listAholoAssets()).toHaveLength(0);
  });

  it('用户自己攒下的其它资产不会被本机扫描挤掉', async () => {
    const { registerLocalScans } = await loadWithProxy(LOCAL_PROXY);
    const { listAholoAssets, rememberAholoAsset } = await import('./aholo-assets');
    rememberAholoAsset({
      assetId: '00000000-0000-4000-8000-000000000000', kind: 'glb',
      name: '一把木椅', bytes: 1_024, savedAt: 1_700_000_000_000,
    });
    expect(registerLocalScans()).toBe(8);
    expect(listAholoAssets()).toHaveLength(9);
  });
});

describe('云端扫描登记', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
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
    // 「本机高斯」在云端语境改名，不再误导访客
    const gauss = listAholoAssets().find(asset => asset.assetId === TEAROOM);
    expect(gauss?.name).not.toContain('本机');
  });

  it('本机副本优先：能直连本机文件时云端登记只补缺、不覆盖', async () => {
    const { registerLocalScans, registerCloudScans } = await loadWithProxy(LOCAL_PROXY);
    const { resolveAholoAssetUrl } = await import('./aholo-assets');
    expect(registerLocalScans()).toBe(8);
    expect(registerCloudScans()).toBe(0);
    expect(resolveAholoAssetUrl(TEAROOM)).toBe(`${LOCAL_PROXY}/asset/${TEAROOM}.spz`);
  });
});
