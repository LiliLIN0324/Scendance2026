/**
 * 本机草稿、评审短链、账户「所有方案」共用的项目身份。
 *
 * 2026-11-23：未上传的本机草稿（URL `project=house-<uuid>`，卡片写「本机 · 未上传」）
 * 仍能发出 `/r/` 短链，账户却把同一个 id 当成云项目去打开，于是报链接无效或项目已删除。
 * 一份草稿只许有一种身份：能分享的本机项目，或明确拒绝分享。不能一边能发出短链，一边被说成已删除。
 *
 * 2026-11-24（B1）：身份从「看 id 格式」改成「看记录正源」。`projectLinkKind` 保留为**格式分组**
 * （评审短链、云清单仍在用），真正决定身份的是 `classifyProjectIdentity`：
 * controller 挂载 + 后端回读可达性 + 本机信封，格式只在最后兜底分组。
 */

import { DEFAULT_OUTDOOR_PROJECT_ID, LOCAL_ACTIVITY_ID_PREFIX } from './outdoor-project-store';

/** 云端 `projects.id`。本机草稿不是这种号。 */
export const CLOUD_PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProjectLinkKind = 'local-draft' | 'cloud' | 'invalid';

/**
 * `?project=` 在账户里该怎么解析。
 * - `local-draft`：`house-*`、`default-outdoor`、`replica-*`。本机项目，可以分享，不得去云端查。
 * - `cloud`：裸 uuid。只有画布确实挂在这个已打开的云项目上，评审链接才绑它。
 * - `invalid`：两边都不是。账户维持「项目链接无效」；评审链接拒绝。
 */
export function projectLinkKind(id: string | null | undefined): ProjectLinkKind {
  const value = id?.trim() ?? '';
  if (!value) return 'invalid';
  if (value.startsWith(LOCAL_ACTIVITY_ID_PREFIX) || value === DEFAULT_OUTDOOR_PROJECT_ID || value.startsWith('replica-')) {
    return 'local-draft';
  }
  if (CLOUD_PROJECT_ID.test(value)) return 'cloud';
  return 'invalid';
}

/**
 * 身份正源四态（互斥）。终态下 `orphan` 不允许作为可切换身份，只是过渡期的「失效 / 待迁移」兜底。
 * - `bound-cloud`：正源在云端。已打开并挂在该项目上，或列表里回读可达（尚未打开也算云端正源）。
 * - `local-draft`：本机前缀（`house-*` / `default-outdoor` / `replica-*`）的本机草稿，从不去云端查。
 * - `cache-copy`：本机存着副本、但当前没挂在云项目上（或云端回读已失效）。只读查看，不参与写租约。
 * - `orphan`：既非本机前缀、又没有本机信封、且云端回读不到。过渡期降级为「失效」，不进可打开列表。
 */
export type ProjectIdentityState = 'bound-cloud' | 'local-draft' | 'cache-copy' | 'orphan';

/** 后端单项目回读结果。`unknown`＝还没探活或探活因临时错误（网络抖动 / 502）没拿到结论。 */
export type ProjectReachability = 'reachable' | 'unreachable' | 'unknown';

export interface ProjectIdentityInput {
  id?: string | null | undefined;
  /** controller 当前挂着的云项目 id（`BackendSession.getSnapshot().project?.id`）。 */
  controllerProjectId?: string | null | undefined;
  /** 本机活动 ↔ 云项目的几何工作台绑定；其 `cloudProjectId` 也是「挂在这个云项目上」的证据。 */
  geometryBinding?: { localActivityId?: string | null | undefined; cloudProjectId?: string | null | undefined } | null | undefined;
  /** 本机信封（`outdoor-project-store` / 会话槽）里有没有这个 scope 的记录。 */
  localRecordExists?: boolean | undefined;
  reachability?: ProjectReachability | undefined;
}

/**
 * 身份正源分类（纯函数：不读 window、不发请求、不改存储）。
 *
 * 派生顺序按「正源优先」：本机前缀（本机身份只可能是草稿）→ 云端挂载 / 回读可达 → 本机信封
 * → 其余归 `orphan`。`id` 格式只在前两步做分组，不单独决定身份。
 *
 * 两条容易判错的边界：
 * - 裸 UUID 但本机有信封、云端没挂也没回读到 → `cache-copy`，不是云项目；
 * - 挂着云项目但**回读明确不可达**（`PROJECT_NOT_FOUND` / 无权 / 已软删）→ 挂载不作数，
 *   有本机信封就是 `cache-copy`，没有就是 `orphan`；临时失败（`unknown`）不降级。
 */
export function classifyProjectIdentity(input: ProjectIdentityInput): ProjectIdentityState {
  const id = input.id?.trim() ?? '';
  const reachability = input.reachability ?? 'unknown';
  if (id && projectLinkKind(id) === 'local-draft') return 'local-draft';
  const mounted = !!id && (
    (input.controllerProjectId?.trim() ?? '') === id ||
    (input.geometryBinding?.cloudProjectId?.trim() ?? '') === id
  );
  if (mounted && reachability !== 'unreachable') return 'bound-cloud';
  if (reachability === 'reachable' && projectLinkKind(id) === 'cloud') return 'bound-cloud';
  if (input.localRecordExists) return 'cache-copy';
  return 'orphan';
}

/**
 * 后端单项目回读失败 → 可达性。
 *
 * 只有「项目不存在 / 无权限」这类确定性结果才判 `unreachable`（列表侧据此隔离）；
 * 网络错误、登录过期、5xx、场景损坏类 502（也可能是部署版本没对齐）一律 `unknown`——
 * 临时失败不置永久失效标记，保留刷新重试入口。
 */
export function reachabilityFromError(error: unknown): ProjectReachability {
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code.trim()
    : '';
  if (code === 'PROJECT_NOT_FOUND' || code === 'FORBIDDEN' || code === 'STUDIO_NOT_FOUND') return 'unreachable';
  return 'unknown';
}

/**
 * 本机槽需不需要去云端核对归属。
 * 只看两个事实：它是裸 uuid（可能是云项目本机副本），且不是当前画布正挂着的那份。
 * 本机前缀（`house-*` / `default-outdoor` / `replica-*`）从不去云端查。
 */
export function localSlotNeedsCloudCheck(id: string, mountedProjectId?: string | null): boolean {
  const value = id?.trim() ?? '';
  if (!value) return false;
  if (projectLinkKind(value) !== 'cloud') return false;
  return value !== (mountedProjectId?.trim() ?? '');
}

export const REVIEW_LINK_SPLIT_DRAFT = '当前画布和打开的本机草稿不是同一份，评审链接未生成。';
export const REVIEW_LINK_UNBOUND_CLOUD = '这份编号在账户里对不上已打开的项目，评审链接未生成。';
export const REVIEW_LINK_NO_IDENTITY = '这份方案还没有可分享的项目身份，评审链接未生成。';

/**
 * 评审短链记在哪一个项目上。
 * 壳体正在打开的本机草稿（`house-*` / `replica-*`）就是这份身份：画布 id 必须是它。
 * `default-outdoor` 只是起步壳，不强迫画布改用这个号；画布自己的 `house-*` 仍然有效。
 */
export function reviewLinkProjectKey(input: {
  layoutId?: string | null | undefined;
  activeProjectId?: string | null | undefined;
  cloudProjectId?: string | null | undefined;
}): { ok: true; projectKey: string } | { ok: false; reason: string } {
  const layoutId = input.layoutId?.trim() ?? '';
  const active = input.activeProjectId?.trim() ?? '';
  const cloud = input.cloudProjectId?.trim() ?? '';
  const activeKind = projectLinkKind(active);
  if (activeKind === 'local-draft' && active !== DEFAULT_OUTDOOR_PROJECT_ID) {
    if (layoutId === active) return { ok: true, projectKey: active };
    return { ok: false, reason: REVIEW_LINK_SPLIT_DRAFT };
  }
  const layoutKind = projectLinkKind(layoutId);
  if (layoutKind === 'local-draft') return { ok: true, projectKey: layoutId };
  if (layoutKind === 'cloud' && layoutId === cloud) return { ok: true, projectKey: layoutId };
  if (layoutKind === 'cloud') return { ok: false, reason: REVIEW_LINK_UNBOUND_CLOUD };
  if (!layoutId) return { ok: true, projectKey: 'local-draft' };
  return { ok: false, reason: REVIEW_LINK_NO_IDENTITY };
}

/**
 * 云端分享清单只用已打开、且画布就是它的云项目号。
 * 本机草稿号不能拿去请求 `/projects/:id`，否则账户和分享会把它说成不存在。
 */
export function cloudLedgerProjectId(input: {
  layoutId?: string | null | undefined;
  cloudProjectId?: string | null | undefined;
}): string | null {
  const layoutId = input.layoutId?.trim() ?? '';
  const cloud = input.cloudProjectId?.trim() ?? '';
  if (projectLinkKind(cloud) !== 'cloud') return null;
  if (projectLinkKind(layoutId) === 'local-draft') return null;
  if (!layoutId || layoutId === cloud) return cloud;
  return null;
}
