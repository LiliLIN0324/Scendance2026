import { DIRECT_BASE, findAholoAsset, isLux3dLocalProxy, listAholoAssets, rememberAholoAsset } from './aholo-assets';
import { cloudScanLodUrl, cloudScanUrl } from './cloud-assets';
import index from './local-scan-index.json';
import { readableScanName } from './scan-names';
import { metersFromForwardBox } from './splat-meters';

/** 索引里的一条本机扫描；来源是 scripts/build-local-scan-index.mjs 对账 .cache/aholo 的结果。 */
export type LocalScanIndexEntry = {
  assetId: string;
  kind: 'spz' | 'ply';
  name: string;
  bytes: number;
  savedAt: number;
  /** lod-meta 的米制包围盒，用来换算真实尺度；坏档没有这一项。 */
  forwardBox?: { min?: number[]; max?: number[] };
  /** 同目录派生好的 LOD 元数据（站内路径）；有它预览才会按距离换档。 */
  lodUrl?: string;
};

/** 索引全量（按落盘时间倒序）。 */
export function localScanIndex(): LocalScanIndexEntry[] {
  return index as unknown as LocalScanIndexEntry[];
}

/** 直连代理是否指向这台电脑：只有指向本机才谈得上「本机扫描」。 */
export function proxyPointsAtThisMachine(): boolean {
  try {
    const host = new URL(DIRECT_BASE).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * 本机代理只支持 GET/HEAD；用 HEAD 探活，不把几十 MB 的场景包读进内存再被客户端断掉。
 * 响应头一到就结束（HEAD 本来没有实体）。
 */
async function reachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal, cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  } finally {
    controller.abort();
  }
}

/**
 * 把索引里的本机扫描登记进资产注册表。
 *
 * 注册表存在浏览器本地且按来源隔离：127.0.0.1 与 localhost 各存各的，换浏览器更是从零开始。
 * 文件才是本机的事实——所以这里按文件索引重新登记一次，同一批高斯在任何来源下都能找回。
 *
 * 2026-11-19 用户：「其他的为什么加载不出来？」——索引是「我们的云资产」清单，
 * 并不代表本机磁盘上还留着文件（`.cache/aholo` 清过就只剩云端副本）。
 * 所以登记前先探一次：文件不在就跳过，交给 `registerCloudScans` 用云端地址登记，
 * 别让卡片挂在 127.0.0.1 上一直 404。
 */
export async function registerLocalScans(): Promise<number> {
  if (!isLux3dLocalProxy() || !proxyPointsAtThisMachine()) return 0;
  let added = 0;
  for (const entry of localScanIndex()) {
    if (findAholoAsset(entry.assetId)) continue;
    if (!await reachable(`${DIRECT_BASE}/asset/${entry.assetId}.${entry.kind}`)) continue;
    const meters = metersFromForwardBox(entry.forwardBox);
    const saved = rememberAholoAsset({
      assetId: entry.assetId,
      kind: entry.kind,
      name: readableScanName(entry.name, entry.savedAt),
      bytes: entry.bytes,
      savedAt: entry.savedAt,
      ...(meters ? { meters } : {}),
      // 索引带 lodUrl（build-local-scan-index 反查到资产号就会写）：登记时一并落进注册表，
      // 否则 `/scans/<主干>/lod-meta.json` 摆在那里也没人用，预览照旧全量解码。
      ...(entry.lodUrl ? { lodUrl: entry.lodUrl } : {}),
    });
    if (saved) added += 1;
  }
  return added;
}

/**
 * 单条回退：本机地址取不到、云端有副本时，把这条改写成 `origin: 'cloud'`。
 *
 * 2026-11-19：注册表记的是 `127.0.0.1:3199/asset/<id>`，而 `.cache/aholo` 里的文件可能已被清掉——
 * 此时加载必得 404、卡片永远「加载失败」，可 R2 上明明有完整副本。探到这种情况就换来源，
 * 下一次取源（`storedAholoSceneSource`）会自动走云端资产库。
 * 返回是否真的改写了记录。
 */
export async function repairScanFallback(assetId: string): Promise<boolean> {
  const asset = findAholoAsset(assetId);
  if (!asset || asset.origin === 'cloud' || asset.kind === 'glb') return false;
  if (await reachable(`${DIRECT_BASE}/asset/${asset.assetId}.${asset.kind}`)) return false;
  if (!await reachable(cloudScanUrl(asset.assetId, asset.kind))) return false;
  return Boolean(rememberAholoAsset({ ...asset, origin: 'cloud' }));
}

/**
 * 反向回退（2026-11-19）：登记写成了 `origin: 'cloud'`，但云端根本没有副本、本机文件还在。
 * 表现就是卡片永远「加载失败」、切 3D 全空（「实景扫描 11/19」实测就是这种）。
 * 探到本机代理能取到就改回 `origin: 'local'`；返回是否真的改写了记录。
 */
export async function repairScanToLocal(assetId: string): Promise<boolean> {
  const asset = findAholoAsset(assetId);
  if (!asset || asset.origin !== 'cloud' || asset.kind === 'glb') return false;
  if (!isLux3dLocalProxy() || !proxyPointsAtThisMachine()) return false;
  if (!await reachable(`${DIRECT_BASE}/asset/${asset.assetId}.${asset.kind}`)) return false;
  // origin 只有 'cloud' 与「缺省 = 本机」两种，所以回切就是把字段去掉。
  const { origin: _cloudOrigin, ...rest } = asset;
  return Boolean(rememberAholoAsset(rest));
}

/** 批量版：打开面板时把「登记还指着本机、文件已经不在了」的历史条目一次性修掉。 */
export async function repairStaleScans(): Promise<number> {
  if (!isLux3dLocalProxy() || !proxyPointsAtThisMachine()) return 0;
  let repaired = 0;
  for (const asset of listAholoAssets()) {
    if (await repairScanFallback(asset.assetId)) repaired += 1;
  }
  return repaired;
}

/**
 * 把云端资产库副本登记进注册表：不挑来源、不挑构建，线上站点也能找回这批实景。
 * 必须在 registerLocalScans 之后调用——本机能直连文件时优先本机副本，云端只补缺。
 */
export function registerCloudScans(): number {
  let added = 0;
  for (const entry of localScanIndex()) {
    if (findAholoAsset(entry.assetId)) continue;
    const meters = metersFromForwardBox(entry.forwardBox);
    // 云端条目走云端 LOD：`scans/<id>/lod-meta.json` 由 tools/aholo/r2-upload-scan-lod.mjs 上传，
    // 它的第 0 档指回同桶的 scans/<id>.spz。站内目录 frontend/public/scans 被 .gitignore 忽略、
    // 部署站读不到，拿它当首选只会让线上每次都 404 后退回单文件。
    const lodUrl = cloudScanLodUrl(entry.assetId);
    const saved = rememberAholoAsset({
      assetId: entry.assetId,
      kind: entry.kind,
      // 同上：库里每一份都是我们的云资产，不再按「本机 / 云端」改写名字。
      name: readableScanName(entry.name, entry.savedAt),
      bytes: entry.bytes,
      savedAt: entry.savedAt,
      ...(meters ? { meters } : {}),
      ...(lodUrl ? { lodUrl } : {}),
      origin: 'cloud',
    });
    if (saved) added += 1;
  }
  return added;
}
