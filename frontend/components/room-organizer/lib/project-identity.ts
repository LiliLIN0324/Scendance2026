/**
 * 本机草稿、评审短链、账户「所有方案」共用的项目身份。
 *
 * 2026-11-23：未上传的本机草稿（URL `project=house-<uuid>`，卡片写「本机 · 未上传」）
 * 仍能发出 `/r/` 短链，账户却把同一个 id 当成云项目去打开，于是报链接无效或项目已删除。
 * 一份草稿只许有一种身份：能分享的本机项目，或明确拒绝分享。不能一边能发出短链，一边被说成已删除。
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
