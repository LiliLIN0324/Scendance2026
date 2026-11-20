/**
 * 通用私有文件归档客户端（任务 B / C03–C07）。
 *
 * 契约真源是 A 报告 `docs/plans/2026-11-20-cloud-storage-task-a.md` 的 v1 接口表：
 * prepareArchiveUpload → 对象直传（不经 Edge body）→ completeArchiveUpload，
 * 服务端校验实际大小与 SHA-256 后登记既有 assets 表。本文件只做三件事：
 *
 * 1. **传输探测**：`resolveCloudArchiveTransport` 按 A 承诺在 `backendSession` 上加的
 *    方法名做特征检测。方法没上线时返回 null——生产界面必须如实显示「未接入」，
 *    不允许任何 localStorage 假成功顶替云端归档。
 * 2. **SHA-256 增量计算**：prepare 请求需要内容指纹；扫描包实测到 1.8 GB，
 *    不能整块读进内存，这里按块喂给一个纯 TS 的流式实现（无新增依赖）。
 * 3. **直传执行器**：把「算哈希 → prepare → PUT 对象 → complete → 校验回执」
 *    封装成持久上传队列（archive-queue.ts）要的 `ArchiveUpload` 形状。
 *
 * 直传鉴权形态（A 报告里是 `uploadUrl?, token?`）在 A 落码前是假定值：token 以
 * `Authorization: Bearer` 头随 PUT 发送。A 的实际实现若不同（如 query token），
 * 只改 `putObjectToStorage` 一处，并在 B 报告里同步。
 */

import type { ArchiveUpload, ArchiveJob } from './archive-queue';

/** A 契约 v1：GET /cloud/capabilities 的返回。 */
export interface CloudCapabilities {
  version: number;
  superAdmin: boolean;
  officialStudioId: string | null;
}

export type ArchiveAssetKind = 'model' | 'scan' | 'floorplan' | 'photo' | 'attachment';

/**
 * A 契约（supabase/functions/_shared/cloud-storage-contract.ts）里的格式白名单。
 * 服务端是 strictObject 枚举：不在名单里的扩展名会被 422 拒收，这里提前拦下并如实说明。
 */
export const ARCHIVE_FORMATS = ['glb', 'spz', 'ply', 'png', 'jpeg', 'webp', 'pdf', 'svg', 'dxf', 'dwg', 'zip', 'json', 'txt', 'csv', 'docx', 'xlsx', 'pptx', 'mp4', 'mov', 'insv', 'osv'] as const;
export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number];

const ARCHIVE_MIME: Record<ArchiveFormat, string> = {
  glb: 'model/gltf-binary', spz: 'application/octet-stream', ply: 'application/octet-stream',
  png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf', svg: 'image/svg+xml',
  dxf: 'application/dxf', dwg: 'application/acad', zip: 'application/zip', json: 'application/json',
  txt: 'text/plain', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp4: 'video/mp4', mov: 'video/quicktime', insv: 'application/octet-stream', osv: 'application/octet-stream',
};

/** A 契约 v1：归档资产回执（CloudArchiveAsset）。字段按最小集校验，多出的字段不读。 */
export interface CloudArchiveAsset {
  id: string;
  name: string;
  kind: string;
  format: string;
  byteSize: number;
  sha256: string;
  createdAt?: string;
  studioId?: string | null;
  integrity?: 'full' | 'size-only';
}

export interface PrepareArchiveUploadInput {
  requestId: string;
  studioId?: string;
  name: string;
  kind: string;
  format: string;
  byteSize: number;
  sha256: string;
}

/** A 的 ArchiveUploadReceipt：可空字段一律按可空处理，不做非空假设。 */
export interface PrepareArchiveUploadResult {
  uploadId: string;
  assetId: string | null;
  state: 'pending' | 'complete';
  uploadUrl: string | null;
  token: string | null;
  storagePath: string;
  asset?: CloudArchiveAsset | null;
}

/**
 * A 契约里 B 消费的归档接口；由 A 在 backendSession 上实现，B 只做结构探测。
 * - 直传优先走 A 的 `uploadArchiveToSignedUrl`（鉴权形态由 A 封装）；
 *   没有该方法时退回裸 PUT + Bearer（仅测试替身使用）。
 * - 临时地址方法 A 的实际名是 `archiveAssetUrl`；`getArchiveAssetUrl` 是报告草案名，兼容两者。
 */
export interface CloudArchiveTransport {
  getCloudCapabilities(): Promise<CloudCapabilities>;
  prepareArchiveUpload(input: PrepareArchiveUploadInput): Promise<PrepareArchiveUploadResult>;
  completeArchiveUpload(uploadId: string): Promise<CloudArchiveAsset>;
  listArchiveAssets(studioId?: string): Promise<CloudArchiveAsset[]>;
  uploadArchiveToSignedUrl?(receipt: PrepareArchiveUploadResult, body: Blob, mime: string, onProgress?: (loaded: number, total: number) => void): Promise<void>;
  archiveAssetUrl?(assetId: string): Promise<{ id: string; url: string; expiresIn: number }>;
  getArchiveAssetUrl?(assetId: string): Promise<{ id: string; url: string; expiresIn: number }>;
}

/** 按权限换取临时读取地址：两种方法名都兼容，都没有时报明确错误。 */
export async function fetchArchiveAssetUrl(transport: CloudArchiveTransport, assetId: string): Promise<{ id: string; url: string; expiresIn: number }> {
  const fetcher = transport.archiveAssetUrl?.bind(transport) ?? transport.getArchiveAssetUrl?.bind(transport);
  if (!fetcher) throw new Error('归档地址接口未接入（后端契约未部署）。');
  return fetcher(assetId);
}

/** A 契约：完整项目保存/读取（C06/C07 用；与归档传输分开探测）。A 的 session 返回 unknown，读侧自行解析。 */
export interface CompleteProjectManifestWire {
  version: 1;
  scene: unknown;
  outdoor: Record<string, unknown> | null;
  sources: Record<string, unknown>;
  dependencies: Array<{ assetId: string; visibility: 'private' | 'published' }>;
}

export interface CompleteProjectTransport {
  saveCompleteProject(projectId: string, input: {
    requestId: string; sessionId: string; generation: number; expectedRevision: number; manifest: CompleteProjectManifestWire;
  }): Promise<unknown>;
  getCompleteProject(projectId: string): Promise<unknown>;
}

export interface CompleteProjectSnapshot {
  projectId: string;
  revision: number;
  manifest: CompleteProjectManifestWire;
  confirmedAt: string;
  dependencyCount: number;
}

/** 解析 save/getCompleteProject 的 unknown 返回；形状不符就抛可读错误，不冒充完整归档。 */
export function parseCompleteProjectSnapshot(value: unknown): CompleteProjectSnapshot {
  const record = value as { projectId?: unknown; revision?: unknown; manifest?: unknown; confirmedAt?: unknown; dependencyCount?: unknown } | null;
  const manifest = record?.manifest as CompleteProjectManifestWire | undefined;
  if (!record || typeof record.projectId !== 'string' || typeof record.revision !== 'number' ||
    !manifest || manifest.version !== 1 || !Array.isArray(manifest.dependencies) ||
    typeof record.confirmedAt !== 'string' || typeof record.dependencyCount !== 'number') {
    throw new Error('完整归档回执形状不符，未确认云端状态。');
  }
  return { projectId: record.projectId, revision: record.revision, manifest, confirmedAt: record.confirmedAt, dependencyCount: record.dependencyCount };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export const CLOUD_ARCHIVE_UNAVAILABLE_MESSAGE =
  '云端归档通道未接入（后端契约尚未部署）。本机保存与队列记录照常，且不会显示任何虚假的云端成功。';

/** 结构探测：A 的 backendSession 方法没上线时返回 null，生产必须如实显示不可用。 */
export function resolveCloudArchiveTransport(session: unknown): CloudArchiveTransport | null {
  if (!session || typeof session !== 'object') return null;
  const candidate = session as Record<string, unknown>;
  const required = ['getCloudCapabilities', 'prepareArchiveUpload', 'completeArchiveUpload', 'listArchiveAssets'];
  for (const name of required) {
    if (typeof candidate[name] !== 'function') return null;
  }
  return session as CloudArchiveTransport;
}

export function resolveCompleteProjectTransport(session: unknown): CompleteProjectTransport | null {
  if (!session || typeof session !== 'object') return null;
  const candidate = session as Record<string, unknown>;
  if (typeof candidate.saveCompleteProject !== 'function' || typeof candidate.getCompleteProject !== 'function') return null;
  return session as CompleteProjectTransport;
}

/** 服务端错误码 → 能照着做的人话；未知错误原样带出，不吞细节。 */
export function archiveErrorText(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    if (code === 'IDEMPOTENCY_CONFLICT') return '同一次上传的请求内容与首次不一致（requestId 冲突）。请保留原文件重试；不要改内容复用同一次上传。';
    if (code === 'UPLOAD_INTEGRITY_FAILED') return '服务器核验到文件大小或哈希与登记不符，已拒绝登记。原文件保留，请重新上传。';
    if (code === 'CLOUD_STORAGE_UNAVAILABLE') return '云端归档服务暂不可用。本机记录保留，稍后重试。';
    if (code === 'DEPENDENCY_INCOMPLETE') return '依赖还没有全部归档，服务器拒绝这次完整保存。请先补传缺的文件。';
    if (code === 'REVISION_CONFLICT' || code === 'LEASE_LOST') return '云端版本或编辑权已变化，这次保存没有覆盖服务器。请核对后重试。';
  }
  if (error instanceof Error && error.message) return error.message;
  return '归档失败，原文件保留，可重试。';
}

/** 校验归档回执：没有真实 UUID / 大小 / 哈希，一律不算上传成功。 */
export function assertArchiveReceipt(receipt: CloudArchiveAsset, file: { size: number }, sha256: string): void {
  if (!receipt || typeof receipt.id !== 'string' || !UUID_PATTERN.test(receipt.id)) {
    throw new Error('服务器没有返回有效资产编号，未确认云端归档成功。');
  }
  if (!Number.isFinite(receipt.byteSize) || receipt.byteSize !== file.size) {
    throw new Error(`服务器回执大小（${String(receipt.byteSize)}）与文件大小（${file.size}）不一致，未确认云端归档成功。`);
  }
  if (typeof receipt.sha256 !== 'string' || !SHA256_PATTERN.test(receipt.sha256)) {
    throw new Error('服务器回执缺少有效内容哈希，未确认云端归档成功。');
  }
  if (sha256 && receipt.sha256.toLowerCase() !== sha256.toLowerCase()) {
    throw new Error('服务器回执哈希与本地计算不一致，未确认云端归档成功。');
  }
}

/**
 * 由扩展名推 format；不在 A 白名单里的格式直接抛可读错误——服务端 strictObject
 * 会 422 拒收，与其让队列撞墙，不如在入队/上传前就说明白。
 */
export function archiveFormatOf(name: string, kind: ArchiveAssetKind): ArchiveFormat {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext && (ARCHIVE_FORMATS as readonly string[]).includes(ext)) return ext as ArchiveFormat;
  if (!ext && kind === 'model') return 'glb';
  throw new Error(ext ? `暂不支持归档 .${ext} 格式；本机原件保留，可先转成支持的格式（${ARCHIVE_FORMATS.slice(0, 8).join('/')} 等）再传。` : '文件缺少扩展名，无法判断归档格式；请保留原件并重命名后再传。');
}

/** format → 直传 MIME；与 A 的 archiveMime 表同源。 */
export function archiveMimeOf(format: string): string {
  return ARCHIVE_MIME[format as ArchiveFormat] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// SHA-256（FIPS 180-4，增量块处理）。零依赖实现：扫描包最大 2 GiB，
// 不能整块读内存，也不能为此引入新依赖（依赖变更需人工 review）。
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number): number => ((value >>> bits) | (value << (32 - bits))) >>> 0;

export class Sha256Hasher {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Uint32Array(64);
  private buffer = new Uint8Array(64);
  private buffered = 0;
  private bytes = 0;

  update(chunk: Uint8Array): this {
    this.bytes += chunk.byteLength;
    let offset = 0;
    if (this.buffered > 0) {
      const take = Math.min(64 - this.buffered, chunk.byteLength);
      this.buffer.set(chunk.subarray(0, take), this.buffered);
      this.buffered += take;
      offset = take;
      if (this.buffered === 64) { this.compress(this.buffer, 0); this.buffered = 0; }
    }
    while (offset + 64 <= chunk.byteLength) { this.compress(chunk, offset); offset += 64; }
    const rest = chunk.byteLength - offset;
    if (rest > 0) { this.buffer.set(chunk.subarray(offset, offset + rest), 0); this.buffered = rest; }
    return this;
  }

  digestHex(): string {
    const bits = this.bytes * 8;
    const hi = Math.floor(bits / 0x100000000);
    const lo = bits % 0x100000000;
    // 先记字节数再喂填充：update 会累加 this.bytes。
    const padLength = this.buffered < 56 ? 64 - this.buffered : 128 - this.buffered;
    const pad = new Uint8Array(padLength);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(padLength - 8, hi);
    view.setUint32(padLength - 4, lo);
    this.update(pad);
    let hex = '';
    for (const word of this.h) hex += word.toString(16).padStart(8, '0');
    return hex;
  }

  private compress(block: Uint8Array, offset: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t += 1) {
      w[t] = ((block[offset + t * 4] << 24) | (block[offset + t * 4 + 1] << 16) | (block[offset + t * 4 + 2] << 8) | block[offset + t * 4 + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t += 1) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (s1 + w[t - 7] + s0 + w[t - 16]) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i += 1) this.h[i] = (this.h[i] + next[i]) >>> 0;
  }
}

export const ARCHIVE_HASH_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * 分块计算一个 Blob 的 SHA-256（hex）。进度按已读字节上报，2 GiB 的包
 * 校验可能要几分钟，界面必须能看到它在动，而不是以为挂了。
 */
export async function computeSha256Hex(
  blob: Blob,
  options: { chunkBytes?: number; signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {},
): Promise<string> {
  const chunkBytes = options.chunkBytes ?? ARCHIVE_HASH_CHUNK_BYTES;
  const hasher = new Sha256Hasher();
  let loaded = 0;
  for (let offset = 0; offset < blob.size; offset += chunkBytes) {
    if (options.signal?.aborted) throw new Error('归档已取消。');
    const slice = blob.slice(offset, Math.min(offset + chunkBytes, blob.size));
    hasher.update(new Uint8Array(await slice.arrayBuffer()));
    loaded = Math.min(offset + chunkBytes, blob.size);
    options.onProgress?.(loaded, blob.size);
  }
  return hasher.digestHex();
}

/** 直传对象存储的默认形态：PUT + Authorization: Bearer。A 的实现不同时只改这里。 */
function putObjectToStorage(
  uploadUrl: string,
  token: string | undefined,
  file: Blob,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  // HTTP 409 = 对象已存在（x-upsert:false）。storagePath 是 actor/requestId/sha256 内容寻址路径，
  // 命中它只可能是同一次上传意图的前次尝试已把同一内容写到对象存储（V03：对象成功但登记失败
  // 后重试）。按成功处理并继续走 complete——服务端会重新复核大小与哈希，不是幽灵成功。
  const isAlreadyStored = (status: number): boolean => status === 409;
  if (typeof XMLHttpRequest === 'undefined') {
    const init: RequestInit = { method: 'PUT', body: file, signal, cache: 'no-store' };
    if (token) init.headers = { Authorization: `Bearer ${token}` };
    return fetch(uploadUrl, init).then(async response => {
      if (!response.ok && !isAlreadyStored(response.status)) throw new Error(`对象存储拒绝了这次上传（HTTP ${response.status}）。原文件保留，可重试。`);
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.timeout = 0;
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded, event.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 || isAlreadyStored(xhr.status)) resolve();
      else reject(new Error(`对象存储拒绝了这次上传（HTTP ${xhr.status}）。原文件保留，可重试。`));
    };
    xhr.onerror = () => reject(new Error('对象存储连接失败。原文件保留，可重试。'));
    xhr.ontimeout = () => reject(new Error('对象存储上传超时。原文件保留，可重试。'));
    xhr.onabort = () => reject(new Error('上传已取消。'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

export interface DirectArchiveUploadOptions {
  /** 注入替身测试用；缺省 computeSha256Hex。 */
  sha256Of?: (file: Blob, signal: AbortSignal, onProgress: (loaded: number, total: number) => void) => Promise<string>;
  putObject?: typeof putObjectToStorage;
}

/**
 * 把 A 契约的三步归档封成队列要的 `ArchiveUpload`：
 * hash（带进度）→ prepare（requestId 幂等）→ 对象直传 → complete → 校验回执。
 * 直传优先走 A 的 `uploadArchiveToSignedUrl`（鉴权由 A 封装）；prepare 返回
 * state 'complete' 说明这个内容服务器已有（幂等重放），直接登记成功。
 */
export function createDirectArchiveUpload(transport: CloudArchiveTransport, options: DirectArchiveUploadOptions = {}): ArchiveUpload {
  const sha256Of = options.sha256Of ?? ((file, signal, onProgress) => computeSha256Hex(file, { signal, onProgress }));
  const putObject = options.putObject ?? putObjectToStorage;
  return async (job: ArchiveJob, file: Blob, signal: AbortSignal, progress: (loaded: number, total: number, phase?: 'hash' | 'upload') => void) => {
    const format = archiveFormatOf(job.name, job.kind);
    const sha256 = job.sha256 && SHA256_PATTERN.test(job.sha256) ? job.sha256 : await sha256Of(file, signal, (loaded, total) => progress(loaded, total, 'hash'));
    progress(0, file.size, 'upload');
    const prepared = await transport.prepareArchiveUpload({
      requestId: job.requestId,
      ...(job.studioId ? { studioId: job.studioId } : {}),
      name: job.name,
      kind: job.kind,
      format,
      byteSize: file.size,
      sha256,
    });
    if (prepared.state !== 'complete') {
      if (transport.uploadArchiveToSignedUrl) {
        await transport.uploadArchiveToSignedUrl(prepared, file, archiveMimeOf(format), (loaded, total) => progress(loaded, total, 'upload'));
      } else {
        if (!prepared.uploadUrl) throw new Error('服务器没有给直传地址，这次上传没有进行。原文件保留。');
        await putObject(prepared.uploadUrl, prepared.token ?? undefined, file, signal, (loaded, total) => progress(loaded, total, 'upload'));
      }
    }
    const receipt = await transport.completeArchiveUpload(prepared.uploadId);
    assertArchiveReceipt(receipt, file, sha256);
    return { id: receipt.id, byteSize: receipt.byteSize, sha256: receipt.sha256 };
  };
}
