/**
 * 经典案例 × 活动身份对齐（2026-11-17）。
 *
 * 病根：打开经典案例只换了户外规划的槽位（outdoorPlanSlotId → replica- 伪 id），
 * 当前活动本体（layout.id / layout.name）原地不动——案例内容被装进「新活动 HH:MM」，
 * 活动列表长出无名条目，自动保存还会用活动名把记录名「经典案例 · xxx」冲掉
 * （outdoor-plan-overlay 的 flushSave 以 activityName 优先）。
 *
 * 口径：案例打开后，当前活动就「是」那个案例——id 与名字跟本机记录走，
 * 同一 id 复用（重复打开仍是那一案）。云端户外项目打开时 layout.id 本就换成
 * 项目 id（backendSceneToLayout 的 projectId），这里是同一条路径。
 */

import { readOutdoorProjectRecord } from './outdoor-project-store';
import type { RoomLayout } from './types';

export interface CaseActivityAlignmentInput {
  /** 外壳当前指向的项目 id（经典案例是 replica- 前缀的伪 id）。 */
  projectId: string;
  /** 当前活动本体。 */
  current: RoomLayout;
  /** 画布当前绑定的云项目 id；绑定中不动身份，避免拆掉云端编辑绑定。 */
  boundCloudProjectId?: string | null | undefined;
}

/** 需要换身份时返回新布局（原布局其余字段不动）；无需对齐返回 null。 */
export function caseActivityAlignment(input: CaseActivityAlignmentInput): RoomLayout | null {
  const projectId = input.projectId.trim();
  if (!projectId.startsWith('replica-')) return null;
  if (input.current.id === projectId) return null;
  if (input.boundCloudProjectId && input.boundCloudProjectId === input.current.id) return null;
  const record = readOutdoorProjectRecord(projectId);
  if (!record) return null;
  return { ...input.current, id: projectId, name: record.name };
}
