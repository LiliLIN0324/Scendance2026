/**
 * SitePlan 版本化存储适配层（H1-b 前端侧）。
 *
 * 目标：在不动共享 Supabase schema 的前提下，把「版本化子资源 + 与旧 scene 并存」的
 * 语义收在一个可测试的纯 TS 层里。上层（use-layout-persistence 之类的本地持久化）可
 * 用它做快照装载、版本单调推进、并发冲突保护；真正的云端表/权限接线仍归 B 角色。
 *
 * 与 scene-client 的关系：旧 scene PUT 是「项目场景」一条线，SitePlan 是「规划」另一条
 * 子资源线。二者共用一个 projectId 但互不覆盖——保存规划不清空 scene，保存 scene 也
 * 不裁剪规划。本层用 projectId 区分，不引入 scene 的 schema 依赖。
 */

import {
  sitePlanSnapshotSchema,
  sitePlanHash,
  type SitePlanSnapshot,
} from '../../../../supabase/functions/_shared/site-plan';

/** 版本化存储错误：可读、校验失败、快照缺失。 */
export class SitePlanStoreError extends Error {
  constructor(
    public code: 'REVISION_CONFLICT' | 'STALE_SNAPSHOT' | 'INVALID_SNAPSHOT' | 'NOT_FOUND',
    message: string,
  ) {
    super(message);
  }
}

export interface SitePlanVersioned {
  /** 最近已确认的版本（= 最近一次成功保存的 revision）。 */
  revision: number;
  /** 本地最新快照（可能含未提交草稿，其 revision 与已确认版本不同）。 */
  snapshot: SitePlanSnapshot | undefined;
  /** 本地是否有未提交草稿（dirty = 快照.revision ≠ 已确认 revision）。 */
  dirty: boolean;
  /** 与 scene 并存：上次保存规划时的 scene 版本（仅对齐，不覆盖 scene）。 */
  sceneRevision: number | undefined;
}

export interface SitePlanPersistence {
  load(projectId: string, signal?: AbortSignal): Promise<SitePlanVersioned>;
  save(
    projectId: string,
    snapshot: SitePlanSnapshot,
    baseRevision: number,
    sceneRevision?: number,
    signal?: AbortSignal,
  ): Promise<{ revision: number; updatedAt: string }>;
}

/**
 * 内存版持久化器：演示版本化语义——
 * - 保存校验 baseRevision：若远端已前进，抛 REVISION_CONFLICT（并发冲突保护）。
 * - 快照必过 sitePlanSnapshotSchema，否则抛 INVALID_SNAPSHOT。
 * - 版本单调递增；dirty = 快照.revision ≠ 已确认 revision。
 * 云端实现将来替换成 Supabase 子资源表，接口不变。
 */
export function createInMemorySitePlanStore(now: () => Date = () => new Date()): SitePlanPersistence {
  // exactOptionalPropertyTypes 下用「显式可空」而非「可选属性」，避免 undefined 赋值报错。
  const rows = new Map<string, { revision: number; snapshot: SitePlanSnapshot | undefined; sceneRevision: number | undefined }>();
  return {
    async load(projectId: string): Promise<SitePlanVersioned> {
      const row = rows.get(projectId);
      if (!row) return { revision: 0, snapshot: undefined, dirty: false, sceneRevision: undefined };
      return {
        revision: row.revision,
        snapshot: row.snapshot,
        dirty: Boolean(row.snapshot && row.snapshot.revision !== row.revision),
        sceneRevision: row.sceneRevision,
      };
    },
    async save(projectId: string, snapshot: SitePlanSnapshot, baseRevision: number, sceneRevision?: number) {
      const parsed = sitePlanSnapshotSchema.safeParse(snapshot);
      if (!parsed.success) {
        throw new SitePlanStoreError('INVALID_SNAPSHOT', `快照校验失败: ${parsed.error.message}`);
      }
      const row = rows.get(projectId);
      if (row && row.revision !== baseRevision) {
        throw new SitePlanStoreError('REVISION_CONFLICT', `并发冲突: 基线 ${baseRevision} ≠ 已存 ${row.revision}`);
      }
      const nextRevision = (row?.revision ?? 0) + 1;
      rows.set(projectId, {
        revision: nextRevision,
        snapshot: { ...parsed.data, revision: nextRevision },
        sceneRevision,
      });
      return { revision: nextRevision, updatedAt: now().toISOString() };
    },
  };
}

/**
 * 与 scene 并存校验：保存规划不携带 scene 字段，scene 版本只做对齐记录。
 * 返回 false 表示「scene 已前进到规划记录之外的版本」——这只会触发一次提示，
 * 不阻断保存（并存语义是互不覆盖，不是版本必须同步）。
 */
export function sceneAheadOfLastPlanSave(storeState: SitePlanVersioned, expectedSceneRevision: number): boolean {
  return (
    storeState.sceneRevision !== undefined &&
    storeState.sceneRevision !== expectedSceneRevision
  );
}

/** 快照指纹一致性：交付前确认本地与已存版本同源。 */
export async function assertSameSnapshot(snapshot: SitePlanSnapshot, expectedHash: string): Promise<void> {
  const actual = await sitePlanHash(snapshot);
  if (actual !== expectedHash) throw new SitePlanStoreError('STALE_SNAPSHOT', '快照指纹不一致，交付版本已过期');
}