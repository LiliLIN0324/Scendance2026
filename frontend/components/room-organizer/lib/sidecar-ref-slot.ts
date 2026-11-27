import {
  createStarterOutdoorPlan,
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
  type KeyValueStorage,
  type OutdoorProjectRecord,
} from './outdoor-project-store';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 侧车引用挂回 plan 正源的唯一落盘口（D6-2，2026-11-27）。
 *
 * 背景：活动安排 / 制作计划各为一条本机独立侧车记录（`lib/sidecar-records.ts`），
 * plan 正源只存记录引用 id（`operationsRef` / `planRef`），不再整包塞 eventOperations /
 * productionPlan。本函数负责把「刚保存成功的侧车记录 id」挂到既有户外 plan 记录上。
 *
 * 约束（对齐 `writeGroundToPlan`）：
 * - 没有 projectId 或空 recordId 不写——宁可不落盘，也不造无主记录 / 悬空指针。
 * - 已有记录只改对应 ref（连同 updatedAt），zones / facilities / boundary / ground 原样留着。
 * - 没有记录时用 starter plan（boundary 为空合法），不编边界。
 * - `trackLastProject=false`：侧车 ref 回写不是续开草稿动作，不顶「最近项目」指针。
 */

export type SidecarRefKind = 'operations' | 'plan';

export type SidecarRefSlotResult =
  | { ok: true; record: OutdoorProjectRecord }
  | { ok: false; reason: 'no-project' | 'unavailable' | 'quota' | 'unknown' };

/** 把侧车记录 id 写进 plan 的对应 ref 字段，并回读落盘记录。 */
export function writeSidecarRefToPlan(
  projectId: string | null | undefined,
  kind: SidecarRefKind,
  recordId: string,
  options: {
    storage?: KeyValueStorage | null;
    /** 新建记录时用的名字。 */
    name?: string;
    /** 新建/更新时间；缺省用当前时间。 */
    now?: string;
  } = {},
): SidecarRefSlotResult {
  const id = (projectId ?? '').trim();
  const ref = recordId.trim();
  if (!id || !ref) return { ok: false, reason: 'no-project' };

  const now = options.now ?? new Date().toISOString();
  const existing = readOutdoorProjectRecord(id, options.storage ?? null);

  const base: OutdoorProjectRecord = existing ?? {
    v: 1,
    projectId: id,
    name: options.name?.trim() || '场地',
    createdAt: now,
    updatedAt: now,
    plan: createStarterOutdoorPlan(),
  };

  const plan: SitePlanData = base.plan ?? createStarterOutdoorPlan();
  const nextPlan: SitePlanData =
    kind === 'operations'
      ? { ...plan, operationsRef: ref }
      : { ...plan, planRef: ref };

  const saved = saveOutdoorProjectRecord(
    { ...base, plan: nextPlan, updatedAt: now },
    options.storage ?? null,
    // 不抢「最近项目」指针：ref 回写依附既有活动记录。
    false,
  );
  if (!saved.ok) return { ok: false, reason: saved.reason };

  const reread = readOutdoorProjectRecord(id, options.storage ?? null);
  return { ok: true, record: reread ?? { ...base, plan: nextPlan, updatedAt: now } };
}
