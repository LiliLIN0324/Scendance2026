import { DIRECT_BASE, findAholoAsset, isLux3dLocalProxy, rememberAholoAsset } from './aholo-assets';
import { metersFromForwardBox } from './splat-meters';
import index from './local-scan-index.json';

/** 索引里的一条本机扫描；来源是 scripts/build-local-scan-index.mjs 对账 .cache/aholo 的结果。 */
export type LocalScanIndexEntry = {
  assetId: string;
  kind: 'spz' | 'ply';
  name: string;
  bytes: number;
  savedAt: number;
  /** lod-meta 的米制包围盒，用来换算真实尺度；坏档没有这一项。 */
  forwardBox?: { min?: number[]; max?: number[] };
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
 * 把索引里的本机扫描登记进资产注册表。
 *
 * 注册表存在浏览器本地且按来源隔离：127.0.0.1 与 localhost 各存各的，换浏览器更是从零开始。
 * 文件才是本机的事实——所以这里按文件索引重新登记一次，同一批高斯在任何来源下都能找回。
 * 已经登记过的跳过，不动用户在浏览器里攒下的其它资产。
 */
export function registerLocalScans(): number {
  if (!isLux3dLocalProxy() || !proxyPointsAtThisMachine()) return 0;
  let added = 0;
  for (const entry of localScanIndex()) {
    if (findAholoAsset(entry.assetId)) continue;
    const meters = metersFromForwardBox(entry.forwardBox);
    const saved = rememberAholoAsset({
      assetId: entry.assetId,
      kind: entry.kind,
      name: entry.name,
      bytes: entry.bytes,
      savedAt: entry.savedAt,
      ...(meters ? { meters } : {}),
    });
    if (saved) added += 1;
  }
  return added;
}
