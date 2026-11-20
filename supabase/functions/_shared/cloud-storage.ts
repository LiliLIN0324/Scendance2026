import { z } from 'zod';
import { ApiError, canonical, randomToken, sha256, uuid } from './domain.ts';
import { readBounded, type Env } from './http.ts';
import type { Backend } from './backend.ts';
import {
  archiveUploadReceiptSchema,
  archiveUploadSchema,
  casePublishSchema,
  caseRestoreSchema,
  caseUnpublishSchema,
  caseWriteSchema,
  cloudCapabilitiesSchema,
  completeSaveSchema,
  completeShareReceiptSchema,
  completeShareSchema,
  type ArchiveUploadReceipt,
  type CloudCaseDraft,
  type CloudCaseVersion,
} from './cloud-storage-contract.ts';

/**
 * /cloud/* 路由（Task A · 2026-11-20 草案）。
 *
 * 职责边界：数据校验与授权决策都在 `public.cloud_storage_rpc`（审核 SQL）里；
 * 这一层只做 HTTP 形状、JWT、幂等指纹、直传地址签发、对象完整性复核和
 * 「storagePath 换短期签名地址」。storagePath / tokenHash 等内部字段绝不出网。
 * 后端未部署 cloud_storage_rpc 时所有 /cloud/* 一律 503 CLOUD_STORAGE_UNAVAILABLE，
 * 不提供任何本机 mock 降级。
 */

/** 路由专用的更大 JSON 上限：完整清单（scene+户外+依赖登记）可能超过通用 256KiB。 */
const CLOUD_JSON_LIMIT = 32 * 1024 * 1024;
/** 完整清单在 SQL 侧另有 16MiB 硬闸（cloud_check_manifest），这里只是传输余量。 */
export const CLOUD_MANIFEST_LIMIT_BYTES = 16 * 1024 * 1024;
/** Edge 侧逐字节校验 SHA-256 的阈值；超过则只核大小并如实标记 size-only。 */
export const CLOUD_HASH_VERIFY_LIMIT_BYTES = 64 * 1024 * 1024;

export interface CloudRouteContext {
  backend: Backend;
  env: Env;
  path: string;
  method: string;
  respond: (data: unknown, status?: number) => Response;
}

async function callCloud(backend: Backend, actor: string | null, action: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  if (!backend.cloud) throw new ApiError('CLOUD_STORAGE_UNAVAILABLE', 503);
  try {
    return await backend.cloud(actor, action, data) as Record<string, unknown>;
  } catch (error) {
    // 未部署审核 SQL 的后端：未知 RPC 表现为 DATABASE_ERROR。能力缺失如实报 503，
    // 不让前端把「未部署」当成普通失败去无限重试。
    if (error instanceof ApiError && error.code === 'DATABASE_ERROR') throw new ApiError('CLOUD_STORAGE_UNAVAILABLE', 503);
    throw error;
  }
}

/**
 * 幂等指纹：canonical 请求体（含 requestId）的 SHA-256。
 * 重试 = 同 requestId 同内容 → 原确认；同 requestId 不同内容 → SQL 侧 IDEMPOTENCY_CONFLICT；
 * 新 requestId 同内容 = 新的主动操作，允许再次执行。
 */
async function cloudFingerprint(body: Record<string, unknown>): Promise<string> {
  return sha256(canonical(body));
}

function trimSlash(path: string): string {
  return path.replace(/\/+$/, '');
}

/** snake_case 数据库行 → camelCase 归档资产视图；storage_path 永不出网。 */
function viewArchiveAsset(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind),
    format: String(row.format),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    ownerId: String(row.owner_id),
    studioId: row.studio_id === null || row.studio_id === undefined ? null : String(row.studio_id),
    integrity: row.integrity === 'size-only' ? 'size-only' as const : 'full' as const,
    metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, unknown>,
    createdAt: String(row.created_at),
  };
}

/** 公开发布视图里的 metadata 不能夹带内部预览路径。 */
function sanitizeMetadata(metadata: unknown): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) } : {};
  delete base.previewPath;
  return base;
}

/**
 * 对象完整性复核：大小必查；阈值内逐字节复核 SHA-256，超过则如实标记 size-only。
 * 大小或哈希不符一律 UPLOAD_INTEGRITY_FAILED，不制造幽灵成功。
 */
async function verifyUploadedObject(backend: Backend, storagePath: string, expectedSize: number, expectedSha256: string): Promise<'full' | 'size-only'> {
  if (!backend.stat || !backend.readSourceBytes) throw new ApiError('CLOUD_STORAGE_UNAVAILABLE', 503);
  let size: number;
  try {
    size = (await backend.stat(storagePath)).size;
  } catch (error) {
    if (error instanceof ApiError && ['OBJECT_NOT_FOUND', 'STORAGE_DOWNLOAD_FAILED'].includes(error.code)) {
      throw new ApiError('UPLOAD_OBJECT_MISSING', 422);
    }
    throw error;
  }
  if (size !== expectedSize) throw new ApiError('UPLOAD_INTEGRITY_FAILED', 422);
  if (size > CLOUD_HASH_VERIFY_LIMIT_BYTES) return 'size-only';
  const bytes = await backend.readSourceBytes(storagePath);
  if (await sha256(bytes) !== expectedSha256) throw new ApiError('UPLOAD_INTEGRITY_FAILED', 422);
  return 'full';
}

interface DepRow {
  assetId: string; name: string; kind: string; format: string; storagePath: string;
  metadata: unknown; byteSize: number; sha256: string; integrity: string;
}

/** 已发布依赖快照 → 公开资产视图：换签名地址、剥内部路径。 */
async function viewPublishedDeps(backend: Backend, deps: unknown): Promise<Array<Record<string, unknown>>> {
  if (!Array.isArray(deps)) return [];
  return Promise.all(deps.map(async raw => {
    const dep = raw as DepRow;
    const url = await backend.sign(dep.storagePath, 300);
    return {
      id: dep.assetId, name: dep.name, kind: dep.kind, format: dep.format,
      byteSize: dep.byteSize, sha256: dep.sha256,
      integrity: dep.integrity === 'size-only' ? 'size-only' as const : 'full' as const,
      metadata: sanitizeMetadata(dep.metadata), url, expiresIn: 300,
    };
  }));
}

/** 已发布依赖清单：公开 manifest 只保留 assetId + published 可见性，不含私有来源。 */
function publishedDependencies(deps: unknown): Array<{ assetId: string; visibility: 'published' }> {
  if (!Array.isArray(deps)) return [];
  return deps.map(dep => ({ assetId: (dep as DepRow).assetId, visibility: 'published' as const }));
}

/** cloud_storage_rpc 的案例视图 → 契约 CloudCaseDraft 形状。 */
function viewCaseDraft(row: Record<string, unknown>): CloudCaseDraft {
  const status = row.status === 'published' ? 'published' as const : 'unpublished' as const;
  return {
    id: String(row.id),
    stableId: String(row.stableId),
    title: String(row.title),
    description: String(row.description),
    category: String(row.category),
    coverAssetId: row.coverAssetId === null || row.coverAssetId === undefined ? null : String(row.coverAssetId),
    sortOrder: Number(row.sortOrder),
    provenance: String(row.provenance),
    projectId: String(row.projectId),
    version: Number(row.currentVersion),
    status,
    publicationId: row.publicationId === null || row.publicationId === undefined ? null : String(row.publicationId),
    revision: Number(row.manifestRevision),
    publishedAt: row.publishedAt === null || row.publishedAt === undefined ? null : String(row.publishedAt),
  };
}

function viewCaseVersion(row: Record<string, unknown>): CloudCaseVersion {
  const action = row.action === 'restore' ? 'restore' as const : row.action === 'unpublish' ? 'unpublish' as const : 'publish' as const;
  return {
    version: Number(row.version),
    publicationId: String(row.publicationId),
    revision: Number(row.revision),
    createdAt: String(row.createdAt),
    action,
    ...(typeof row.actorId === 'string' ? { actorId: row.actorId } : {}),
  };
}

/** 匿名可读的公开入口；其余 /cloud/* 全部要求 Bearer JWT。 */
function isPublicCloudPath(path: string, method: string): boolean {
  const clean = trimSlash(path);
  if (clean === '/cloud/cases' && method === 'GET') return true;
  if (clean === '/cloud/shares/read' && method === 'POST') return true;
  // GET /cloud/cases/:stableId —— 'manage'（草稿列表）与 '/versions' 是管理员口。
  const caseRead = clean.match(/^\/cloud\/cases\/([^/]+)$/);
  if (caseRead && method === 'GET' && caseRead[1] !== 'manage') return true;
  return false;
}

export async function handleCloudRequest(request: Request, ctx: CloudRouteContext): Promise<Response> {
  const { backend, path, method, respond } = ctx;
  const clean = trimSlash(path);
  let actor: string | null = null;
  if (!isPublicCloudPath(clean, method)) {
    const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw new ApiError('UNAUTHENTICATED', 401);
    actor = await backend.user(token);
  }

  const jsonBody = async (): Promise<Record<string, unknown>> => {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('JSON_REQUIRED', 415);
    const raw = JSON.parse(new TextDecoder().decode(await readBounded(request, CLOUD_JSON_LIMIT))) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('INVALID_JSON');
    return raw as Record<string, unknown>;
  };

  // ---- 能力探测（C01/C02 客户端消费的服务端真相）--------------------------
  if (clean === '/cloud/capabilities' && method === 'GET') {
    const result = await callCloud(backend, actor, 'cloud.capabilities');
    return respond(cloudCapabilitiesSchema.parse({
      version: 1,
      superAdmin: result.superAdmin === true,
      officialStudioId: typeof result.officialStudioId === 'string' ? result.officialStudioId : null,
    }));
  }

  // ---- 归档上传（C03/C04）------------------------------------------------
  if (clean === '/cloud/uploads' && method === 'POST') {
    const input = archiveUploadSchema.parse(await jsonBody());
    const fingerprint = await cloudFingerprint(input);
    const result = await callCloud(backend, actor, 'cloud.upload.prepare', { ...input, fingerprint });
    const prepared: ArchiveUploadReceipt = {
      uploadId: uuid.parse(String(result.uploadId)),
      assetId: result.assetId ? uuid.parse(String(result.assetId)) : null,
      state: result.state === 'complete' ? 'complete' : 'pending',
      storagePath: String(result.storagePath),
      uploadUrl: null,
      token: null,
    };
    if (prepared.state === 'pending') {
      if (!backend.createUploadUrl) throw new ApiError('CLOUD_STORAGE_UNAVAILABLE', 503);
      // 直传地址每次新鲜签发（短时效凭据），uploadId/storagePath 保持稳定以幂等对账。
      const signed = await backend.createUploadUrl(prepared.storagePath);
      prepared.uploadUrl = signed.url;
      prepared.token = signed.token;
    }
    return respond(archiveUploadReceiptSchema.parse(prepared), 201);
  }
  const uploadComplete = clean.match(/^\/cloud\/uploads\/([^/]+)\/complete$/);
  if (uploadComplete && method === 'POST') {
    const uploadId = uuid.parse(uploadComplete[1]);
    const intent = await callCloud(backend, actor, 'cloud.upload.intent', { uploadId });
    if (String(intent.state) === 'failed') throw new ApiError('UPLOAD_STATE_INVALID', 409);
    const integrity = String(intent.state) === 'pending'
      ? await verifyUploadedObject(backend, String(intent.storagePath), Number(intent.byteSize), String(intent.sha256))
      : (String(intent.integrity ?? 'full') === 'size-only' ? 'size-only' as const : 'full' as const);
    const registered = await callCloud(backend, actor, 'cloud.upload.register', {
      uploadId,
      actualByteSize: Number(intent.byteSize),
      integrity,
    });
    return respond({ ...viewArchiveAsset(registered.asset as Record<string, unknown>), reused: registered.reused === true });
  }

  // ---- 归档资产（C03）----------------------------------------------------
  if (clean === '/cloud/assets' && method === 'GET') {
    const studioId = new URL(request.url).searchParams.get('studioId');
    const rows = await callCloud(backend, actor, 'cloud.assets.list', studioId ? { studioId } : {});
    return respond((Array.isArray(rows) ? rows : []).map(row => viewArchiveAsset(row as Record<string, unknown>)));
  }
  const assetUrl = clean.match(/^\/cloud\/assets\/([^/]+)\/url$/);
  if (assetUrl && method === 'POST') {
    const assetId = uuid.parse(assetUrl[1]);
    const row = await callCloud(backend, actor, 'cloud.assets.url', { assetId });
    return respond({
      id: String(row.id),
      url: await backend.sign(String(row.storage_path), 300),
      expiresIn: 300,
      name: String(row.name),
      format: String(row.format),
      kind: String(row.kind),
      byteSize: Number(row.byte_size),
      sha256: String(row.sha256),
      integrity: row.integrity === 'size-only' ? 'size-only' as const : 'full' as const,
    });
  }

  // ---- 完整项目保存（C06）------------------------------------------------
  const cloudProject = clean.match(/^\/cloud\/projects\/([^/]+)$/);
  if (cloudProject && method === 'PUT') {
    const projectId = uuid.parse(cloudProject[1]);
    const input = completeSaveSchema.parse(await jsonBody());
    const fingerprint = await cloudFingerprint(input);
    return respond(await callCloud(backend, actor, 'cloud.project.save', { projectId, ...input, fingerprint }));
  }
  if (cloudProject && method === 'GET') {
    const projectId = uuid.parse(cloudProject[1]);
    return respond(await callCloud(backend, actor, 'cloud.project.get', { projectId }));
  }

  // ---- 完整受控分享（C12/C13）--------------------------------------------
  const projectShare = clean.match(/^\/cloud\/projects\/([^/]+)\/shares$/);
  if (projectShare && method === 'POST') {
    const projectId = uuid.parse(projectShare[1]);
    const input = completeShareSchema.parse(await jsonBody());
    const fingerprint = await cloudFingerprint(input);
    const token = randomToken();
    const result = await callCloud(backend, actor, 'cloud.share.create', {
      projectId, ...input, tokenHash: await sha256(token), issuedToken: token, fingerprint,
    });
    // token 只随首次响应发出一次；同 requestId 重试拿到原确认但 token=null（服务端仅存哈希）。
    return respond(completeShareReceiptSchema.parse({
      shareId: String(result.shareId),
      publicationId: String(result.publicationId),
      revision: Number(result.revision),
      token: typeof result.issuedToken === 'string' ? result.issuedToken : null,
    }), 201);
  }
  if (clean === '/cloud/shares/read' && method === 'POST') {
    const input = await jsonBody();
    const token = z.string().regex(/^[a-f0-9]{64}$/).parse(input.token);
    const tokenHash = await sha256(token);
    const payload = await callCloud(backend, null, 'cloud.share.read', { tokenHash });
    const assets = await viewPublishedDeps(backend, payload.deps);
    // 签名后复核撤销：慢请求期间被撤销的分享不再返回内容。
    const recheck = await callCloud(backend, null, 'cloud.share.read', { tokenHash });
    if (recheck.publicationId !== payload.publicationId || recheck.revision !== payload.revision) {
      throw new ApiError('SHARE_NOT_FOUND', 404);
    }
    return respond({
      publicationId: String(payload.publicationId),
      revision: Number(payload.revision),
      manifest: {
        version: 1 as const,
        scene: payload.scene ?? null,
        outdoor: payload.outdoor ?? null,
        dependencies: publishedDependencies(payload.deps),
      },
      assets,
    });
  }

  // ---- 案例运营（C08–C10）------------------------------------------------
  const caseAction = clean.match(/^\/cloud\/cases\/([^/]+)\/(publish|unpublish|restore)$/);
  const caseVersions = clean.match(/^\/cloud\/cases\/([^/]+)\/versions$/);
  const caseStable = clean.match(/^\/cloud\/cases\/([^/]+)$/);
  if (caseAction && method === 'POST') {
    const stableId = decodeURIComponent(caseAction[1]);
    const action = caseAction[2];
    const input = action === 'publish'
      ? casePublishSchema.parse(await jsonBody())
      : action === 'restore'
        ? caseRestoreSchema.parse(await jsonBody())
        : caseUnpublishSchema.parse(await jsonBody());
    const fingerprint = await cloudFingerprint(input);
    const result = await callCloud(backend, actor, `cloud.case.${action}`, { ...input, stableId, fingerprint });
    return respond(viewCaseDraft(result));
  }
  if (caseStable && method === 'PUT') {
    const stableId = decodeURIComponent(caseStable[1]);
    const input = caseWriteSchema.parse(await jsonBody());
    const fingerprint = await cloudFingerprint(input);
    const result = await callCloud(backend, actor, 'cloud.case.upsert', { ...input, stableId, fingerprint });
    return respond(viewCaseDraft(result), 201);
  }
  if (caseVersions && method === 'GET') {
    const stableId = decodeURIComponent(caseVersions[1]);
    const rows = await callCloud(backend, actor, 'cloud.case.versions', { stableId });
    return respond((Array.isArray(rows) ? rows : []).map(row => viewCaseVersion(row as Record<string, unknown>)));
  }
  if (clean === '/cloud/cases/manage' && method === 'GET') {
    const rows = await callCloud(backend, actor, 'cloud.case.drafts.list');
    return respond((Array.isArray(rows) ? rows : []).map(row => viewCaseDraft(row as Record<string, unknown>)));
  }
  if (clean === '/cloud/cases' && method === 'GET') {
    const rows = await callCloud(backend, null, 'cloud.cases.list');
    return respond(await Promise.all((Array.isArray(rows) ? rows : []).map(async raw => {
      const row = raw as Record<string, unknown>;
      const coverPath = typeof row.coverPath === 'string' ? row.coverPath : null;
      return {
        id: String(row.id),
        title: String(row.title),
        description: String(row.description),
        category: String(row.category),
        provenance: String(row.provenance),
        coverAssetId: row.coverAssetId === null || row.coverAssetId === undefined ? null : String(row.coverAssetId),
        coverUrl: coverPath ? await backend.sign(coverPath, 300) : null,
        sortOrder: Number(row.sortOrder),
        publicationId: String(row.publicationId),
        revision: Number(row.revision),
        version: Number(row.version),
        publishedAt: String(row.publishedAt),
        updatedAt: String(row.updatedAt),
      };
    })));
  }
  if (caseStable && method === 'GET') {
    const stableId = decodeURIComponent(caseStable[1]);
    const payload = await callCloud(backend, null, 'cloud.case.read', { stableId });
    const assets = await viewPublishedDeps(backend, payload.deps);
    // 签名后复核：入口已切换或下架时不再返回旧内容。
    const recheck = await callCloud(backend, null, 'cloud.case.read', { stableId });
    if (recheck.publicationId !== payload.publicationId || recheck.version !== payload.version) {
      throw new ApiError('CASE_NOT_FOUND', 404);
    }
    return respond({
      case: {
        id: String(payload.id),
        title: String(payload.title),
        description: String(payload.description),
        category: String(payload.category),
        version: Number(payload.version),
        publishedAt: String(payload.publishedAt),
      },
      projectId: String(payload.projectId),
      publicationId: String(payload.publicationId),
      revision: Number(payload.revision),
      manifest: {
        version: 1 as const,
        scene: payload.scene ?? null,
        outdoor: payload.outdoor ?? null,
        dependencies: publishedDependencies(payload.deps),
      },
      assets,
    });
  }

  throw new ApiError('ROUTE_NOT_FOUND', 404);
}
