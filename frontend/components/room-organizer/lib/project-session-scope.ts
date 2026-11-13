'use client';
import { DEFAULT_OUTDOOR_PROJECT_ID } from './outdoor-project-store';

/**
 * 地图项目会话身份键（M3a）。
 *
 * 会话 / 记忆按项目隔离：云项目用项目 id；本机草稿回退默认草稿槽。
 * 取代旧室内 `activity:${layout.id}` / `draft:unidentified` 键——
 * 会话不再绑定室内壳体 `layout.id`，改绑地图 projectId。
 */
export function projectSessionScope(projectId: string | null | undefined): string {
  const id = (projectId ?? '').trim();
  return id ? `project:${id}` : `project:${DEFAULT_OUTDOOR_PROJECT_ID}`;
}
