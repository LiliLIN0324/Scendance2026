/**
 * 云端案例目录与案例运营（任务 C，2026-11-20）。
 *
 * 口径：
 *  - 后端契约以任务 A 的草案 v1 为准（docs/plans/2026-11-20-cloud-storage-task-a.md），
 *    传输统一走 backendSession 方法；本模块不做平行 wire schema，也不自建传输。
 *  - A 的 backendSession 方法尚未落码，这里按方法名做**运行时能力探测**：
 *    方法不存在时每个操作都明确失败（不可用），生产不 mock、不用 localStorage 冒充云端目录，
 *    界面按「不可用」如实展示。A 落码后这里自动接通，无需改动。
 *  - 普通用户「使用此案例」= 读公开案例清单/详情，另存独立个人副本（replica- 前缀），
 *    绝不写官方项目，也不继承原项目云端身份（副本记录不带 remoteActivityId/remoteRevision）。
 *  - 管理员维护（草稿/发布/更新/历史/下架/恢复）全部消费服务端结果；
 *    superAdmin 以 getCloudCapabilities 的服务端回答为准，客户端不猜。
 */

import { z } from 'zod';
import {
  sitePlanDataSchema,
  type SitePlanData,
} from '../../../../supabase/functions/_shared/site-plan';
import {
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
  type KeyValueStorage,
} from './outdoor-project-store';
import type { BackendSession } from '@/lib/backend-session';

/** 平台能力（GET /cloud/capabilities）：管理员以服务端每次查询为准，撤权即时生效。 */
export const cloudCapabilitiesSchema = z.object({
  version: z.number(),
  superAdmin: z.boolean(),
  officialStudioId: z.string().nullable().optional(),
});

/** 公开目录条目（GET /cloud/cases）：只含已发布元信息，无草稿与私有引用。字段以 A 契约 v1 为准。 */
export const cloudCasePublicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  category: z.string().optional().default(''),
  coverAssetId: z.string().nullable().optional(),
  /** 封面是服务端按权限签发的临时地址（300s）；只收 https，拒绝任何非 https 的注入面。 */
  coverUrl: z.string().refine(value => value.startsWith('https://')).nullable().optional(),
  sortOrder: z.number().optional().default(0),
  provenance: z.string().optional().default(''),
  publicationId: z.string().optional(),
  revision: z.number(),
  publishedAt: z.string().optional(),
});

/** 管理员视角草稿（GET /cloud/cases/manage 等）：version 是 CAS 乐观锁版本；status 是发布态。 */
export const cloudCaseDraftSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional().default(''),
  category: z.string().optional().default(''),
  coverAssetId: z.string().nullable().optional(),
  sortOrder: z.number().optional().default(0),
  provenance: z.string().optional().default(''),
  projectId: z.string().min(1),
  version: z.number(),
  status: z.enum(['draft', 'published', 'unpublished']).optional().default('draft'),
  publicationId: z.string().nullable().optional(),
  revision: z.number().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

/** 历史版本摘要（GET /cloud/cases/:id/versions）：恢复只允许指向该案例自己的历史。 */
export const cloudCaseVersionSchema = z.object({
  publicationId: z.string().min(1),
  revision: z.number(),
  createdAt: z.string().optional(),
});

/**
 * 公开案例详情（GET /cloud/cases/:id）：manifest 只含 scene/outdoor 与 published 依赖，
 * 私有原资料（sources）不在公开 payload 里（A 契约：manifest 是 Omit<CompleteManifest,'sources'>）。
 *
 * 集成验收修正（2026-11-20）：A 的 readCloudCase 响应里 `case` 是
 * `{id,title,description,category,version,publishedAt}`（无 revision/updatedAt，见
 * supabase/functions/_shared/cloud-storage.ts 的 GET /cloud/cases/:stableId 分支），
 * 与目录条目（cloudCasePublicSchema，带 revision/coverUrl 等）不是同一个形状。
 * 这里按详情响应的实际形状解析；字段只放代码真正消费的（title/publishedAt 等）。
 */
export const cloudCaseReadSchema = z.object({
  case: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional().default(''),
    category: z.string().optional().default(''),
    version: z.number().optional(),
    revision: z.number().optional(),
    publishedAt: z.string().optional(),
  }),
  publicationId: z.string(),
  revision: z.number(),
  manifest: z.object({
    scene: z.unknown().optional(),
    outdoor: z.unknown().nullable().optional(),
  }).passthrough(),
  assets: z.array(z.unknown()).optional().default([]),
});

/** A 契约的稳定案例 ID 规则（cloudCaseIdSchema）；前端先拦一道，避免整份表单提交后才被拒。 */
export const cloudCaseIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;

export type CloudCapabilities = z.infer<typeof cloudCapabilitiesSchema>;
export type CloudCasePublic = z.infer<typeof cloudCasePublicSchema>;
export type CloudCaseDraft = z.infer<typeof cloudCaseDraftSchema>;
export type CloudCaseVersion = z.infer<typeof cloudCaseVersionSchema>;
export type CloudCaseRead = z.infer<typeof cloudCaseReadSchema>;

/**
 * A 报告 v1 / supabase/functions/_shared/cloud-storage-contract.ts 的 backendSession 方法名。
 * A 尚未把这些方法挂上 backendSession；方法尚未存在时探测结果为不可用，
 * A 落码后按这些名字与签名接通（改动签名需回本模块对齐）。
 */
export interface CloudCaseSessionContract {
  getCloudCapabilities(): Promise<unknown>;
  listCloudCases(): Promise<unknown>;
  readCloudCase(id: string): Promise<unknown>;
  upsertCloudCase(stableId: string, input: {
    requestId: string;
    expectedVersion: number;
    title: string;
    description: string;
    category: string;
    coverAssetId: string | null;
    sortOrder: number;
    projectId: string;
    /** 来源/授权说明（A 契约必填，1..4000 字）。 */
    provenance: string;
  }): Promise<unknown>;
  listCloudCaseDrafts(): Promise<unknown>;
  publishCloudCase(id: string, input: {
    requestId: string;
    expectedVersion: number;
    expectedRevision: number;
  }): Promise<unknown>;
  unpublishCloudCase(id: string, input: { requestId: string; expectedVersion: number }): Promise<unknown>;
  listCloudCaseVersions(id: string): Promise<unknown>;
  restoreCloudCase(id: string, input: {
    requestId: string;
    expectedVersion: number;
    publicationId: string;
  }): Promise<unknown>;
}

export type CloudCaseOpError =
  | { code: 'unavailable'; message: string }
  | { code: 'invalid'; message: string }
  | { code: 'failed'; message: string };

export type CloudCaseOp<T> = { ok: true; value: T } | { ok: false; error: CloudCaseOpError };

const UNAVAILABLE_MESSAGE = '云端案例服务在这套后端上还没有接通。';

/** 服务端错误尽量带上后端给的语义（如 CLOUD_STORAGE_UNAVAILABLE / CASE_VERSION_CONFLICT）。 */
function opError(error: unknown): CloudCaseOpError {
  if (error instanceof z.ZodError) {
    return { code: 'invalid', message: '云端案例返回的数据不符合契约，已拒绝展示。' };
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  return { code: 'failed', message: message || '云端案例请求失败。' };
}

/**
 * 探测 backendSession 上已接通的云端案例方法。返回 null = 这套后端没有这些方法，
 * 所有操作按不可用处理；不制造任何本机替代数据。
 */
export function detectCloudCaseSession(
  controller: BackendSession | CloudCaseSessionContract | null | undefined,
): CloudCaseSessionContract | null {
  if (!controller) return null;
  const candidate = controller as unknown as Partial<CloudCaseSessionContract>;
  const names: (keyof CloudCaseSessionContract)[] = [
    'getCloudCapabilities', 'listCloudCases', 'readCloudCase',
    'upsertCloudCase', 'listCloudCaseDrafts', 'publishCloudCase',
    'unpublishCloudCase', 'listCloudCaseVersions', 'restoreCloudCase',
  ];
  for (const name of names) {
    if (typeof candidate[name] !== 'function') return null;
  }
  return candidate as CloudCaseSessionContract;
}

/** 平台能力。方法缺失或请求失败都如实报不可用/失败，不默认任何角色。 */
export async function fetchCloudCapabilities(session: CloudCaseSessionContract | null): Promise<CloudCaseOp<CloudCapabilities>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  try {
    return { ok: true, value: cloudCapabilitiesSchema.parse(await session.getCloudCapabilities()) };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/** 公开案例目录（普通用户浏览；未登录也可由后端按公开语义放行）。 */
export async function listCloudCases(session: CloudCaseSessionContract | null): Promise<CloudCaseOp<CloudCasePublic[]>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  try {
    const rows = await session.listCloudCases();
    if (!Array.isArray(rows)) return { ok: false, error: { code: 'invalid', message: '云端案例目录返回格式不符合契约。' } };
    return { ok: true, value: rows.map(row => cloudCasePublicSchema.parse(row)) };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/** 公开案例详情：manifest.outdoor 过站点规划 schema，坏数据不进画布。 */
export async function readCloudCase(session: CloudCaseSessionContract | null, id: string): Promise<CloudCaseOp<CloudCaseRead>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  const caseId = id.trim();
  if (!caseId) return { ok: false, error: { code: 'invalid', message: '案例标识为空。' } };
  try {
    return { ok: true, value: cloudCaseReadSchema.parse(await session.readCloudCase(caseId)) };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/**
 * 公开案例的户外规划数据；不是有效 SitePlanData 时明确拒绝（宁可不另存，不给画布灌坏数据）。
 * A 契约里 manifest.outdoor 是「完整户外 payload」记录；规划本体可能在 `.plan` 下也可能是
 * 记录本身——两种都试，都对不上就拒绝，不猜。
 */
export function cloudCaseOutdoorPlan(payload: CloudCaseRead): { ok: true; plan: SitePlanData } | { ok: false; message: string } {
  const outdoor = payload.manifest.outdoor;
  if (outdoor == null) return { ok: false, message: '这个案例没有可另存的户外规划数据。' };
  const candidates: unknown[] = [outdoor];
  if (typeof outdoor === 'object' && 'plan' in outdoor) candidates.unshift((outdoor as { plan?: unknown }).plan);
  for (const candidate of candidates) {
    const parsed = sitePlanDataSchema.safeParse(candidate);
    if (parsed.success) return { ok: true, plan: parsed.data };
  }
  return { ok: false, message: '这个案例的规划数据不是有效的户外方案，暂不能另存。' };
}

/**
 * 稳定案例 ID 的前端推导：案例副本项目（replica-<slug>）取回原 slug，
 * 其余用项目 id 原样作为稳定 ID 起点给管理员确认，不再另造一套编号规则。
 */
export function suggestCloudCaseStableId(projectId: string | null | undefined): string {
  const raw = (projectId ?? '').trim();
  if (!raw) return '';
  return raw.startsWith('replica-') ? raw.slice('replica-'.length) : raw;
}

/** 管理员：草稿列表。 */
export async function listCloudCaseDrafts(session: CloudCaseSessionContract | null): Promise<CloudCaseOp<CloudCaseDraft[]>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  try {
    const rows = await session.listCloudCaseDrafts();
    if (!Array.isArray(rows)) return { ok: false, error: { code: 'invalid', message: '案例草稿列表返回格式不符合契约。' } };
    return { ok: true, value: rows.map(row => cloudCaseDraftSchema.parse(row)) };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/** 管理员：保存草稿（创建从 expectedVersion 0 起；草稿更新不改变公众版本）。provenance 必填。 */
export async function upsertCloudCase(
  session: CloudCaseSessionContract | null,
  stableId: string,
  input: Omit<Parameters<CloudCaseSessionContract['upsertCloudCase']>[1], 'requestId'>,
): Promise<CloudCaseOp<CloudCaseDraft>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  const id = stableId.trim();
  if (!id) return { ok: false, error: { code: 'invalid', message: '请先填写稳定案例 ID。' } };
  if (!cloudCaseIdPattern.test(id)) {
    return { ok: false, error: { code: 'invalid', message: '稳定案例 ID 只能用字母、数字、连字符或下划线，且以字母或数字开头。' } };
  }
  if (!input.provenance.trim()) {
    return { ok: false, error: { code: 'invalid', message: '请先填写来源/授权说明。' } };
  }
  try {
    return {
      ok: true,
      value: cloudCaseDraftSchema.parse(await session.upsertCloudCase(id, { requestId: crypto.randomUUID(), ...input })),
    };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/** 管理员：发布/更新。依赖核验+不可变版本+指针原子切换由服务端负责；失败保留原入口。 */
export async function publishCloudCase(
  session: CloudCaseSessionContract | null,
  id: string,
  input: { expectedVersion: number; expectedRevision: number },
): Promise<CloudCaseOp<CloudCaseDraft>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  try {
    return {
      ok: true,
      value: cloudCaseDraftSchema.parse(await session.publishCloudCase(id.trim(), {
        requestId: crypto.randomUUID(),
        expectedVersion: input.expectedVersion,
        expectedRevision: input.expectedRevision,
      })),
    };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/** 管理员：下架（目录与稳定公开入口同时失效由服务端保证）。 */
export async function unpublishCloudCase(
  session: CloudCaseSessionContract | null,
  id: string,
  expectedVersion: number,
): Promise<CloudCaseOp<CloudCaseDraft>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  try {
    return {
      ok: true,
      value: cloudCaseDraftSchema.parse(await session.unpublishCloudCase(id.trim(), { requestId: crypto.randomUUID(), expectedVersion })),
    };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/** 管理员：历史版本列表。 */
export async function listCloudCaseVersions(session: CloudCaseSessionContract | null, id: string): Promise<CloudCaseOp<CloudCaseVersion[]>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  try {
    const rows = await session.listCloudCaseVersions(id.trim());
    if (!Array.isArray(rows)) return { ok: false, error: { code: 'invalid', message: '案例历史返回格式不符合契约。' } };
    return { ok: true, value: rows.map(row => cloudCaseVersionSchema.parse(row)) };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/** 管理员：恢复历史版本（服务端新建发布记录，不改旧 publication）。 */
export async function restoreCloudCase(
  session: CloudCaseSessionContract | null,
  id: string,
  input: { expectedVersion: number; publicationId: string },
): Promise<CloudCaseOp<CloudCaseDraft>> {
  if (!session) return { ok: false, error: { code: 'unavailable', message: UNAVAILABLE_MESSAGE } };
  try {
    return {
      ok: true,
      value: cloudCaseDraftSchema.parse(await session.restoreCloudCase(id.trim(), {
        requestId: crypto.randomUUID(),
        expectedVersion: input.expectedVersion,
        publicationId: input.publicationId,
      })),
    };
  } catch (error) {
    return { ok: false, error: opError(error) };
  }
}

/**
 * 「使用此案例」：把公开案例另存为独立个人副本（V11）。
 *
 * - 副本 id = `replica-<稳定案例 ID>`；静态国内案例的种子迁移保留同一 id，
 *   同一个人副本不会因为来源（静态/云端）不同而分裂。
 * - 已有副本原样续用：官方更新、重复点击都不覆盖本机已有修改（V11）。
 * - 新建副本是全新记录：不带 remoteActivityId/remoteRevision——
 *   副本的云端身份只能由它自己后续同步建立，绝不继承打开时的当前项目。
 * - 写入后复读校验：存储静默失败时明确报错，不假成功。
 */
export async function ensureCloudCaseCopyRecord(
  session: CloudCaseSessionContract | null,
  stableId: string,
  storage?: KeyValueStorage | null,
): Promise<{ created: boolean; projectId: string }> {
  const id = stableId.trim();
  if (!id) throw new Error('案例标识为空，无法另存。');
  const projectId = `replica-${id}`;
  const existing = readOutdoorProjectRecord(projectId, storage);
  if (existing) return { created: false, projectId };
  const read = await readCloudCase(session, id);
  if (!read.ok) throw new Error(read.error.message);
  const plan = cloudCaseOutdoorPlan(read.value);
  if (!plan.ok) throw new Error(plan.message);
  const now = new Date().toISOString();
  saveOutdoorProjectRecord({
    v: 1,
    projectId,
    name: `官方案例 · ${read.value.case.title}`.slice(0, 60),
    createdAt: now,
    updatedAt: now,
    plan: plan.plan,
  }, storage);
  if (!readOutdoorProjectRecord(projectId, storage)) {
    throw new Error('浏览器未能保存案例副本，请检查存储空间后重试。');
  }
  return { created: true, projectId };
}
