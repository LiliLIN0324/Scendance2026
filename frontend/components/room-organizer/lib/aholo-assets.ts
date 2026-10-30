import { isGlbUrl } from './glb-url';

/** 本机直连代理地址；密钥只留在代理侧，前端只谈路径。 */
export const DIRECT_BASE = (process.env.NEXT_PUBLIC_LUX3D_DIRECT_URL ?? 'http://127.0.0.1:3199').replace(/\/+$/, '');

export type AholoAssetKind = 'glb' | 'spz' | 'ply';
const KINDS: AholoAssetKind[] = ['glb', 'spz', 'ply'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const taskidPattern = /^[A-Za-z0-9_-]{1,128}$/;
const REGISTRY_KEY = 'scendance:aholo-assets';
const REGISTRY_MAX = 40;
// 场景包（SPZ/PLY）本机回源也可能上百 MB；比代理侧的 300 秒再多一点，让代理的原文错误先返回。
const ASSET_TIMEOUT_MS = 330_000;

/** 一次落盘的元数据；签名链接不进这里，本机地址由 assetId + kind 推出。 */
export type AholoAsset = {
  assetId: string;
  kind: AholoAssetKind;
  name: string;
  bytes: number;
  savedAt: number;
  taskid?: string;
  /** 场景资产的真实尺度（米，来自 lod-meta forwardBox）；物件模型没有。 */
  meters?: { width: number; depth: number; height: number };
};

function validMeters(value: unknown): value is { width: number; depth: number; height: number } {
  if (!value || typeof value !== 'object') return false;
  const box = value as { width?: unknown; depth?: unknown; height?: unknown };
  return [box.width, box.depth, box.height].every(number => typeof number === 'number' && Number.isFinite(number) && number > 0);
}

function isValidAsset(value: unknown): value is AholoAsset {
  const asset = value as AholoAsset;
  return Boolean(asset) && uuidPattern.test(asset.assetId ?? '') && KINDS.includes(asset.kind) &&
    typeof asset.name === 'string' && Number.isFinite(asset.bytes) && asset.bytes > 0 &&
    Number.isFinite(asset.savedAt) &&
    (asset.taskid === undefined || (typeof asset.taskid === 'string' && taskidPattern.test(asset.taskid))) &&
    (asset.meters === undefined || validMeters(asset.meters)) &&
    Boolean(aholoAssetUrl(asset));
}

function currentStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readRegistry(storage: Storage | null): AholoAsset[] {
  if (!storage) return [];
  try {
    const raw: unknown = JSON.parse(storage.getItem(REGISTRY_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isValidAsset).slice(0, REGISTRY_MAX) : [];
  } catch {
    return [];
  }
}

function writeRegistry(storage: Storage | null, assets: AholoAsset[]): void {
  if (!storage) return;
  try {
    storage.setItem(REGISTRY_KEY, JSON.stringify(assets));
  } catch {
    /* 存不下只丢注册表，本机文件还在；重开图纸时退回「模型未能加载」提示。 */
  }
}

/** 落盘文件名就是资产号，所以稳定地址可由记录本身推出，不必把链接存进图纸。 */
export function aholoAssetUrl(asset: AholoAsset | undefined): string | undefined {
  if (!asset) return undefined;
  const url = `${DIRECT_BASE}/asset/${asset.assetId}.${asset.kind}`;
  return asset.kind === 'glb' && !isGlbUrl(url) ? undefined : url;
}

export function listAholoAssets(): AholoAsset[] {
  return readRegistry(currentStorage());
}

export function findAholoAsset(assetId?: string): AholoAsset | undefined {
  if (!assetId || !uuidPattern.test(assetId)) return undefined;
  return readRegistry(currentStorage()).find(asset => asset.assetId === assetId);
}

/** 签名链接每查一次都可能换新，所以去重只认生成任务号。 */
export function findAholoAssetByTask(taskid?: string): AholoAsset | undefined {
  if (!taskid || !taskidPattern.test(taskid)) return undefined;
  return readRegistry(currentStorage()).find(asset => asset.taskid === taskid);
}

/** 图纸里只剩资产号时，靠注册表命中本机缓存。 */
export function resolveAholoAssetUrl(assetId?: string): string | undefined {
  return aholoAssetUrl(findAholoAsset(assetId));
}

export function rememberAholoAsset(asset: AholoAsset): AholoAsset | undefined {
  const name = asset.name.trim().slice(0, 120);
  const record: AholoAsset = {
    assetId: asset.assetId,
    kind: asset.kind,
    name: name || '生成模型',
    bytes: asset.bytes,
    savedAt: Number.isFinite(asset.savedAt) && asset.savedAt > 0 ? asset.savedAt : Date.now(),
    ...(typeof asset.taskid === 'string' && taskidPattern.test(asset.taskid) ? { taskid: asset.taskid } : {}),
    ...(validMeters(asset.meters) ? { meters: asset.meters } : {}),
  };
  if (!isValidAsset(record)) return undefined;
  const storage = currentStorage();
  const next = [record, ...readRegistry(storage).filter(item => item.assetId !== record.assetId)];
  writeRegistry(storage, next);
  return record;
}

export function forgetAholoAsset(assetId: string): void {
  const storage = currentStorage();
  writeRegistry(storage, readRegistry(storage).filter(item => item.assetId !== assetId));
}

async function postAsset(source: { url: string; name: string; taskid?: string }): Promise<AholoAsset> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_TIMEOUT_MS);
  let response: Response;
  let body: { assetId?: unknown; kind?: unknown; bytes?: unknown; error?: unknown };
  try {
    response = await fetch(`${DIRECT_BASE}/asset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: source.url }),
      credentials: 'omit',
      signal: controller.signal,
    });
    body = await response.json() as typeof body;
  } catch {
    throw new Error('连不上本机代理，先运行：node tools/aholo/lux3d-dev-proxy.mjs');
  } finally {
    clearTimeout(timer);
  }
  const error = typeof body.error === 'string' ? body.error : '';
  if (!response.ok || error) throw new Error(error || `本机代理返回 HTTP ${response.status}`);
  const saved = rememberAholoAsset({
    assetId: String(body.assetId ?? ''),
    kind: body.kind as AholoAssetKind,
    name: source.name,
    bytes: Number(body.bytes) || 0,
    savedAt: Date.now(),
    ...(source.taskid ? { taskid: source.taskid } : {}),
  });
  if (!saved) throw new Error('落盘返回的资产号无效，已放弃。');
  return saved;
}

/** 把会过期的签名产物换成本机稳定地址；同一任务号已落过盘就直接复用，不再下载。 */
export async function importAholoAsset(source: {
  url: string;
  name?: string;
  taskid?: string;
  meters?: { width: number; depth: number; height: number };
}): Promise<AholoAsset & { url: string }> {
  // 同一任务号复用本机文件；这次若带来了真实尺度而旧记录没有，就补写进注册表，历史场景也能按真实尺寸回放。
  const cached = findAholoAssetByTask(source.taskid);
  let asset = cached ?? await postAsset({ ...source, name: source.name ?? '' });
  const incoming = source.meters;
  if (!validMeters(asset.meters) && validMeters(incoming)) {
    asset = await rememberAholoAsset({ ...asset, meters: incoming }) ?? asset;
  }
  const url = aholoAssetUrl(asset);
  if (!url) throw new Error('落盘后仍无法生成本机地址。');
  return { ...asset, url };
}
