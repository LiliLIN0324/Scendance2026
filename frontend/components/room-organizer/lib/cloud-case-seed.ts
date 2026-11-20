/**
 * 官网中国案例的云端种子 payload（任务 C08 收口，2026-11-20 集成）。
 *
 * 口径（主计划 §5.3）：
 * - 只迁 `origin === 'cn'` 的官网中国案例；海外案是 OnePlan「Site plans we love」的
 *   内部学习授权复刻（replica-cases.ts 头注），**不得批量公开**，不进种子。
 * - stableId = 案例 slug（`cn-*`），与静态副本 `replica-<slug>` 同 ID 收敛：同一个人
 *   副本不因来源（静态/云端）不同而分裂；重复迁入幂等。
 * - provenance = 官网案例说明（locationNote）+ 来源链接；这是发布页要展示的来源/授权口径。
 * - plan 走 sitePlanDataSchema 复核：坏数据不进云端目录。
 * 网络执行见 frontend/lib/cloud-case-seed.integration.test.ts（默认只做本模块校验，
 * 设置 CLOUD_SEED_REMOTE=1 才对已部署后端执行真实迁入）。
 */

import { sitePlanDataSchema, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { CN_REPLICA_CASES, type ReplicaCase } from './replica-cases';

export interface CloudCaseSeedPayload {
  /** 稳定案例 ID（= 案例 slug，A 契约 cloudCaseIdSchema 同形）。 */
  stableId: string;
  title: string;
  description: string;
  category: string;
  /** 来源/授权说明（A 契约必填，≤4000 字；截断如实标注）。 */
  provenance: string;
  sortOrder: number;
  /** 完整户外规划 payload（saveCompleteProject 的 manifest.outdoor）。 */
  plan: SitePlanData;
}

const PROVENANCE_MAX = 4000;
const TITLE_MAX = 120;

function provenanceOf(example: ReplicaCase): string {
  const parts = [
    example.locationNote?.trim(),
    example.refLink ? `来源链接：${example.refLink}` : '',
    '布置为「拟设 · 拟放」演示口径；出摊前按当届图纸与现场复尺。',
  ].filter(Boolean);
  const text = parts.join(' ');
  return text.length <= PROVENANCE_MAX ? text : `${text.slice(0, PROVENANCE_MAX - 20)}…（超长截断）`;
}

/** 官网中国案例的种子 payload；顺序稳定，重复调用产出一致（幂等迁入的输入）。 */
export function cnCaseSeedPayloads(cases: readonly ReplicaCase[] = CN_REPLICA_CASES): CloudCaseSeedPayload[] {
  const cnCases = cases.filter(example => example.origin === 'cn');
  return cnCases.map((example, index) => {
    // 种子必须是有效户外方案：直接 parse，坏数据当场抛出，不进云端目录。
    const plan = sitePlanDataSchema.parse(example.buildPlan());
    const title = example.title.slice(0, TITLE_MAX);
    return {
      stableId: example.id,
      title,
      description: `${example.region} · ${example.category}`.trim(),
      category: example.category,
      provenance: provenanceOf(example),
      sortOrder: index,
      plan,
    };
  });
}

/**
 * 纯函数：对一个已登录管理员的会话，算出某个种子是否还需要迁入。
 * 幂等口径：草稿列表（管理员口）或公开目录里已有同 stableId 的案例 → 跳过。
 */
export function needsSeeding(
  payload: Pick<CloudCaseSeedPayload, 'stableId'>,
  known: Readonly<{ drafts?: readonly { id: string }[]; published?: readonly { id: string }[] }>,
): boolean {
  const inDrafts = (known.drafts ?? []).some(draft => draft.id === payload.stableId);
  const inPublished = (known.published ?? []).some(published => published.id === payload.stableId);
  return !inDrafts && !inPublished;
}
