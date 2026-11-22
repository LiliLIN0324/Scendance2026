import { DIRECT_BASE, rememberAholoAsset, type AholoAsset } from './aholo-assets';
import { probeScanUrl } from './local-scans';

/**
 * 实景包上传：把用户从 Aholo Reality 下载的 .spz / .ply 收进本机资产库。
 *
 * 2026-11-19 用户：「我的实景扫描上传不到我的平台……图二这里应该新增一个上传功能」。
 * 现状只有两条进库的路——生成时由代理代下产物落盘、或脚本对账 .cache 后重建索引——
 * 手上已有的实景包没有入口。这里补齐第三条：选文件 → 字节直传本机资产代理
 * （POST /asset/upload）→ 按同一套命名落进 .cache/aholo → 登记进浏览器资产注册表，
 * 列表里立刻出现，地址仍是 `DIRECT_BASE/asset/<id>.<kind>`（Spark 靠后缀认格式）。
 *
 * 边界写死在这里，别人问「为什么不用云盘」时有据可查：静态站没有可写存储，
 * R2 只有公开读、写入要凭据，浏览器端不能持有；所以上传只到本机。
 */

/** 只收实景包；物件 GLB 走的是另一条物料生成链路。 */
export const SCAN_UPLOAD_EXTENSIONS = ['.spz', '.ply'] as const;

/** 与代理侧上限一致（2 GiB）：用户手上的 PLY 实测到 1800 MB。 */
export const SCAN_UPLOAD_MAX_BYTES = 2048 * 1024 * 1024;

export const NOT_SCAN_MESSAGE = '只收 Aholo Reality 导出的 .spz 或 .ply；.zip 请先解压再选。';
export const EMPTY_SCAN_MESSAGE = '这个文件是空的，没有可打开的场地。';
export const NOT_SPLAT_MESSAGE = '文件头不是 SPZ / PLY，通常是下载没完成或选错了文件。';
export const PROXY_OFF_MESSAGE = '连不上本机资产代理。先运行 npm run dev（会一并拉起 3199 代理），或单独运行 node tools/aholo/lux3d-dev-proxy.mjs。';
export const HTTPS_ORIGIN_MESSAGE = '当前页面是 https，浏览器不允许它访问本机 3199 代理。请在本机用 npm run dev 打开工作台再上传。';
export const STORAGE_FULL_MESSAGE = '浏览器没能存下这条资产记录（本地存储可能已满），文件已在磁盘上，清一点空间再传一次。';

export type ScanUploadPick = { name: string; size: number };

/** 单看文件名与大小就能拒掉的错误；返回 null 才可以继续读字节。 */
export function validateScanPick(pick: ScanUploadPick): string | null {
  const name = pick.name.trim().toLowerCase();
  if (!SCAN_UPLOAD_EXTENSIONS.some(extension => name.endsWith(extension))) return NOT_SCAN_MESSAGE;
  if (!Number.isFinite(pick.size) || pick.size <= 0) return EMPTY_SCAN_MESSAGE;
  if (pick.size > SCAN_UPLOAD_MAX_BYTES) return tooLargeMessage();
  return null;
}

export function tooLargeMessage(maxBytes = SCAN_UPLOAD_MAX_BYTES): string {
  return `实景包超过 ${Math.round(maxBytes / 1024 / 1024)} MB，代理收不下；请先在 Aholo 侧导出更小的 SPZ 再传。`;
}

/** 去掉目录与扩展名，给列表一个能读的名字（与 GLB 导入同一套读法）。 */
export function scanDisplayName(fileName: string): string {
  const base = (fileName.split(/[\\/]/).pop() ?? '').trim();
  const name = base.replace(/\.(spz|ply)$/i, '').trim();
  return name || '上传的实景';
}

/** LOD 目录名只收 URL 安全字符：与 aholo-assets 的 lodUrl 站内路径规则同源。 */
const LOD_BASE_PATTERN = /^[A-Za-z0-9_-]{1,48}$/;

/**
 * 与本实景包同名的 LOD 目录名：`make-lod.mjs --out frontend/public/scans/<主干>` 生成的目录，
 * 上传时就能按约定自动挂上，不必再让人手填路径。中文名不能进 URL，直接不认。
 */
export function scanLodBase(fileName: string): string | null {
  const base = (fileName.split(/[\\/]/).pop() ?? '').trim().replace(/\.(spz|ply)$/i, '').trim();
  return LOD_BASE_PATTERN.test(base) ? base : null;
}

/**
 * 上传前探一次同名的本地 LOD（`/scans/<主干>/lod-meta.json`）：
 * 有就随上传一起登记进资产记录，预览按相机距离换档；没有就照旧全量解码。
 * 探不到、形状不对、或 meta 里记的不是这个包，一律当没有——不能把别的场地 LOD 挂上来。
 */
export async function findScanLodUrl(fileName: string): Promise<string | undefined> {
  const base = scanLodBase(fileName);
  if (!base || typeof location === 'undefined') return undefined;
  const url = `/scans/${base}/lod-meta.json`;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return undefined;
    const meta = await response.json() as { files?: unknown; source?: unknown };
    if (!Array.isArray(meta.files) || meta.files.length < 2) return undefined;
    const name = (fileName.split(/[\\/]/).pop() ?? '').trim().toLowerCase();
    if (typeof meta.source === 'string' && meta.source.trim() && meta.source.trim().toLowerCase() !== name) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/**
 * 按头部魔数定类型：gzip 壳的 SPZ（1f 8b 08）与裸 SPZ（NGSP）都算 SPZ，PLY 认「ply」。
 * 不看文件名后缀——代理侧同样按魔数复核，两边口径一致才不会出现「传上去打不开」。
 */
export function splatKindFromHead(head: Uint8Array): 'spz' | 'ply' | null {
  if (head.length >= 3 && head[0] === 0x1f && head[1] === 0x8b && head[2] === 0x08) return 'spz';
  const magic4 = String.fromCharCode(...head.subarray(0, 4));
  if (magic4 === 'NGSP') return 'spz';
  if (String.fromCharCode(...head.subarray(0, 3)) === 'ply') return 'ply';
  return null;
}

/** 只读文件头，不把 1.8 GB 读进内存。 */
export async function readScanHead(file: Blob, bytes = 12): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  if (typeof slice.arrayBuffer === 'function') return new Uint8Array(await slice.arrayBuffer());
  return new Uint8Array(await new Response(slice).arrayBuffer());
}

function scanUploadUrl(): string {
  return `${DIRECT_BASE}/asset/upload`;
}

/** https 页面打 http://127.0.0.1 会被浏览器当混合内容拦掉，先给人话，不让它变成一句 Failed to fetch。 */
function assertReachableOrigin(): void {
  if (typeof location === 'undefined' || location.protocol !== 'https:') return;
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(DIRECT_BASE)) return;
  throw new Error(HTTPS_ORIGIN_MESSAGE);
}

type TransportResult = { assetId: unknown; kind: unknown; bytes: unknown };

function parseBody(text: string): { error?: string } & Partial<TransportResult> {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed as { error?: string } & Partial<TransportResult> : {};
  } catch {
    return {};
  }
}

/** 有 XHR 才拿得到上传进度；1.8 GB 的包没有进度就不像在传。 */
function sendWithProgress(url: string, file: Blob, onProgress: (loaded: number, total: number) => void): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded, event.total); };
    xhr.onerror = () => reject(new Error(PROXY_OFF_MESSAGE));
    xhr.ontimeout = () => reject(new Error(PROXY_OFF_MESSAGE));
    xhr.onabort = () => reject(new Error('上传已取消。'));
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText ?? '' });
    xhr.send(file);
  });
}

async function sendBytes(url: string, file: Blob, onProgress?: (loaded: number, total: number) => void): Promise<TransportResult> {
  const canStream = typeof XMLHttpRequest !== 'undefined';
  let status: number;
  let text: string;
  if (canStream && onProgress) {
    ({ status, text } = await sendWithProgress(url, file, onProgress));
  } else {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
        credentials: 'omit',
      });
    } catch {
      throw new Error(PROXY_OFF_MESSAGE);
    }
    status = response.status;
    text = await response.text();
  }
  const body = parseBody(text);
  if (status < 200 || status >= 300) {
    const detail = typeof body.error === 'string' && body.error.trim();
    throw new Error(detail || `本机代理拒绝了这次上传（HTTP ${status}）。`);
  }
  if (typeof body.assetId !== 'string') throw new Error('代理没有回资产号，文件可能没落盘。');
  return body as TransportResult;
}

/**
 * 上传一个实景包并登记进「我的实景扫描」。
 * 失败一律抛一句能照着改的话；成功返回注册表里的那条记录（地址由 assetId + kind 推出）。
 */
export async function uploadScanFile(
  file: File | Blob,
  options: {
    name?: string;
    onProgress?: (loaded: number, total: number) => void;
    /** 同目录已派生好的 LOD 元数据（站内路径）；有就随记录一起登记，预览按距离换档。 */
    lodUrl?: string;
  } = {},
): Promise<AholoAsset> {
  const name = (options.name ?? (file as File).name ?? '').trim();
  const rejected = validateScanPick({ name, size: file.size });
  if (rejected) throw new Error(rejected);
  const kind = splatKindFromHead(await readScanHead(file));
  if (!kind) throw new Error(NOT_SPLAT_MESSAGE);
  assertReachableOrigin();
  const body = await sendBytes(scanUploadUrl(), file, options.onProgress);
  // 代理按魔数复核后回的类型才是事实：两边不一致说明文件在中途被换过，宁可不登记。
  if (body.kind !== kind) throw new Error(`代理把这份文件认成 ${String(body.kind)}，与文件头不一致，已放弃登记。`);
  const bytes = Number(body.bytes);
  const saved = rememberAholoAsset({
    assetId: String(body.assetId),
    kind,
    name: scanDisplayName(name),
    bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : file.size,
    savedAt: Date.now(),
    ...(options.lodUrl ? { lodUrl: options.lodUrl } : {}),
  });
  if (!saved) throw new Error(STORAGE_FULL_MESSAGE);
  return saved;
}

/**
 * 上传后立刻验活（2026-11-22）：落盘 ≠ 取得到。
 *
 * 以前坏文件要等用户点卡片、落位、加载时才暴露，回执却说「点它就能在 3D 里看」。
 * 这里按同一套 HEAD 口径探一次（经 `probeScanUrl`，不另立判定），面板据此在
 * 回执里当场给结论，并把该卡片标成「加载失败」。
 */
export async function probeUploadedScan(asset: Pick<AholoAsset, 'assetId' | 'kind'>): Promise<boolean> {
  if (asset.kind !== 'spz' && asset.kind !== 'ply') return true;
  return probeScanUrl(`${DIRECT_BASE}/asset/${asset.assetId}.${asset.kind}`);
}
