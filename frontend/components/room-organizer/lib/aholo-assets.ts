import { isGlbUrl } from './glb-url';

/**
 * 直连生成通道地址：默认是本机 lux3d-dev-proxy，也可在构建时用
 * `NEXT_PUBLIC_LUX3D_DIRECT_URL` 指向部署好的中转（HTTPS）。密钥只留在代理/中转侧。
 */
export const DIRECT_BASE = (process.env.NEXT_PUBLIC_LUX3D_DIRECT_URL ?? 'http://127.0.0.1:3199').replace(/\/+$/, '');

/**
 * 直连通道是否可用：
 * - 配了 `NEXT_PUBLIC_LUX3D_DIRECT_URL` → 任何构建都可用（本地代理或部署的中转）；
 * - 没配 → 只有本地开发默认走 127.0.0.1:3199，线上不去猜一个连不上的本机地址。
 * 线上没有直连通道时，生成与取回走云端任务队列（`/jobs`），不依赖本机脚本。
 */
export function isLux3dLocalProxy(): boolean {
  if (process.env.NEXT_PUBLIC_LUX3D_DIRECT_URL) {
    try {
      new URL(DIRECT_BASE);
      return true;
    } catch {
      return false;
    }
  }
  return process.env.NODE_ENV === 'development';
}

export type AholoAssetKind = 'glb' | 'spz' | 'ply';
/** 观感面板里的四种生成方式：前两种产物件（物料生成），后两种产场地（场地生成）。 */
export type AholoDirectKind = 'text' | 'image' | 'world' | 'recon';
const KINDS: AholoAssetKind[] = ['glb', 'spz', 'ply'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const taskidPattern = /^[A-Za-z0-9_-]{1,128}$/;
const REGISTRY_KEY = 'scendance:aholo-assets';
const REGISTRY_MAX = 40;
// 场景包（SPZ/PLY）本机回源也可能上百 MB；比代理侧的 300 秒再多一点，让代理的原文错误先返回。
const ASSET_TIMEOUT_MS = 330_000;

/**
 * 场景资产的拍摄位置（docs/19 地理底图）：采集中心经纬度与覆盖半径。
 * 只作元数据给底图对齐用，不参与碰撞/落盘几何，更不进重建素材（RECON_MATERIAL_BAN）。
 *
 * 坐标系边界（MAP-04，详见 lib/geo-coords.ts）：本类型的坐标一律按 GCJ-02 解释——
 * picker/lookup 本来就取自高德；将来若接入 GPS/EXIF/采集遥测（WGS-84）来源，
 * 必须先过 `wgs84ToGcj02` 再写入，否则底图自动锚定（room-organizer 的 scanAssetId 铺图）会偏几百米。
 */
export type AholoAssetGeo = {
  lng: number;
  lat: number;
  /** 采集覆盖半径（米）；缺了就由底图侧按资产尺度推。 */
  radiusM?: number;
  /**
   * 坐标来源：picker=地图圈画采集单；manual=人工标注（坐标系未标注，接入前先确认）；
   * lookup=地名查得（Bingo 调研路线）；telemetry=采集遥测/EXIF（WGS-84 原始坐标，
   * 进 GCJ-02 消费端前必须先过 `wgs84ToGcj02`，见 room-organizer 的 scanAssetId 自动铺图）。
   */
  source: 'picker' | 'manual' | 'lookup' | 'telemetry';
  /**
   * 采集主朝向（度，正北顺时针；如 DJI 遥测 heading）。MAP-04 通路预留：
   * scanAssetId 自动铺图时作为锚点 orientationDeg（「壳体平面图上方 = 采集朝向」的
   * 语义假设未经真资产核验，校准归 MAP-05）；缺省时锚点朝向沿用现有值（默认正北）。
   */
  headingDeg?: number;
};

function validGeo(value: unknown): value is AholoAssetGeo {
  if (!value || typeof value !== 'object') return false;
  const geo = value as Partial<AholoAssetGeo>;
  return typeof geo.lng === 'number' && Number.isFinite(geo.lng) && geo.lng >= -180 && geo.lng <= 180
    && typeof geo.lat === 'number' && Number.isFinite(geo.lat) && geo.lat >= -90 && geo.lat <= 90
    && (geo.radiusM === undefined || (Number.isFinite(geo.radiusM) && geo.radiusM > 0 && geo.radiusM <= 20000))
    && (geo.source === 'picker' || geo.source === 'manual' || geo.source === 'lookup' || geo.source === 'telemetry')
    && (geo.headingDeg === undefined || (Number.isFinite(geo.headingDeg) && Math.abs(geo.headingDeg) <= 360));
}

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
  /** 场景资产的拍摄位置；物件模型没有。 */
  geo?: AholoAssetGeo;
  /** 可选：本地派生 LOD 的元数据（站内路径，如 /scans/<id>/lod-meta.json）。 */
  lodUrl?: string;
};

const LOD_URL_PATTERN = /^\/scans\/[A-Za-z0-9_-]{1,48}\/lod-meta\.json$/;

function validLodUrl(value: unknown): value is string {
  return typeof value === 'string' && LOD_URL_PATTERN.test(value);
}

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
    (asset.geo === undefined || validGeo(asset.geo)) &&
    (asset.lodUrl === undefined || validLodUrl(asset.lodUrl)) &&
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
    ...(validGeo(asset.geo) ? { geo: asset.geo } : {}),
    ...(validLodUrl(asset.lodUrl) ? { lodUrl: asset.lodUrl } : {}),
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

async function postAsset(source: { url: string; name: string; taskid?: string; lodUrl?: string }): Promise<AholoAsset> {
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
    ...(validLodUrl(source.lodUrl) ? { lodUrl: source.lodUrl } : {}),
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
  geo?: AholoAssetGeo;
  /** 本地已派生好 LOD 时一并登记，预览即可按距离换档。 */
  lodUrl?: string;
}): Promise<AholoAsset & { url: string }> {
  // 同一任务号复用本机文件；这次若带来了真实尺度或拍摄位置而旧记录没有，就补写进注册表，历史场景也能按真实尺寸回放。
  const cached = findAholoAssetByTask(source.taskid);
  let asset = cached ?? await postAsset({ ...source, name: source.name ?? '' });
  const incoming = source.meters;
  if (!validMeters(asset.meters) && validMeters(incoming)) {
    asset = await rememberAholoAsset({ ...asset, meters: incoming }) ?? asset;
  }
  if (!validGeo(asset.geo) && validGeo(source.geo)) {
    asset = await rememberAholoAsset({ ...asset, geo: source.geo }) ?? asset;
  }
  if (!validLodUrl(asset.lodUrl) && validLodUrl(source.lodUrl)) {
    asset = await rememberAholoAsset({ ...asset, lodUrl: source.lodUrl }) ?? asset;
  }
  const url = aholoAssetUrl(asset);
  if (!url) throw new Error('落盘后仍无法生成本机地址。');
  return { ...asset, url };
}
