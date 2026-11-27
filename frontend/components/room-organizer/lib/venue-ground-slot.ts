import {
  createStarterOutdoorPlan,
  readOutdoorProjectRecord,
  saveOutdoorProjectRecord,
  type KeyValueStorage,
  type OutdoorProjectRecord,
} from './outdoor-project-store';
import type { PlanGround, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 场地地面（ground）的唯一落盘口（S3 前置，2026-11-25，路线 1）。
 *
 * 背景：卫星/自绘底图原来写进 layout 的字节字段（floorPlanImage / mapGroundPolygon …），
 * 那是「地图选址 venue 项目」的路径；而 plan.ground 只写在户外项目里。要让写侧只剩一个
 * 事实来源，venue 项目也得有地方放 ground —— 复用同一份 `scendance-outdoor-plan-v1:<projectId>`
 * 记录（同钥匙、同 schema），只写 `plan.ground`，不启用 2D 画圈，也不抢「最近项目」指针。
 *
 * 约束：
 * - 没有 projectId 不写 —— 宁可不落盘，也不要造一份无主记录。
 * - 已有记录只改 `ground`（连同 updatedAt），zones / facilities / boundary 等一律原样留着。
 * - 没有记录时用 starter plan（boundary 为空是合法的「尚未圈范围」），不编边界。
 * - 不在这里补 capturedAt：取图那一刻的时间由取图方给。
 */
export type GroundSlotResult =
  | { ok: true; record: OutdoorProjectRecord }
  | { ok: false; reason: 'no-project' | 'unavailable' | 'quota' | 'unknown' };

export function writeGroundToPlan(
  projectId: string | null | undefined,
  ground: PlanGround,
  options: {
    storage?: KeyValueStorage | null;
    /** 新建记录时用的名字（venue 项目用 layout 名）。 */
    name?: string;
    /** 新建/更新时间；缺省用当前时间。 */
    now?: string;
    /** 已有记录但 plan 为 null 时，先落一份 starter plan 再挂 ground。 */
    anchor?: SitePlanData['anchor'];
  } = {},
): GroundSlotResult {
  const id = (projectId ?? '').trim();
  if (!id) return { ok: false, reason: 'no-project' };

  const now = options.now ?? new Date().toISOString();
  const existing = readOutdoorProjectRecord(id, options.storage ?? null);

  const base: OutdoorProjectRecord = existing ?? {
    v: 1,
    projectId: id,
    name: options.name?.trim() || '场地',
    createdAt: now,
    updatedAt: now,
    plan: createStarterOutdoorPlan(options.anchor),
  };

  const plan: SitePlanData = { ...(base.plan ?? createStarterOutdoorPlan(options.anchor)), ground };

  const saved = saveOutdoorProjectRecord(
    { ...base, plan, updatedAt: now },
    options.storage ?? null,
    // 不抢「最近项目」指针：venue 项目不是为了续开 2D 草稿而存在。
    false,
  );
  if (!saved.ok) return { ok: false, reason: saved.reason };

  const reread = readOutdoorProjectRecord(id, options.storage ?? null);
  return { ok: true, record: reread ?? { ...base, plan, updatedAt: now } };
}

/** 读出现有 ground（给「写之前先保住已有 polygon」的调用点用）。 */
export function readPlanGround(
  projectId: string | null | undefined,
  storage?: KeyValueStorage | null,
): PlanGround | null {
  const id = (projectId ?? '').trim();
  if (!id) return null;
  return readOutdoorProjectRecord(id, storage ?? null)?.plan?.ground ?? null;
}
