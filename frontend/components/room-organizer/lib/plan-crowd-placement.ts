/**
 * 「不同人群」→ 3D 落点（纯函数层）。
 *
 * 用户口径：不同人群也要服从 2D 的展开逻辑（m04148）——2D 里一个岗位点位写着
 * 「保安 · 6 人」，3D 里就该在**同一个点位**摆 6 个人（模型），而不是另画一套。
 *
 * 这里只做纯计算：岗位名 → 人群类型 → 素材库 slug，以及 count 个实例在点位周围
 * 的**确定性散布**偏移（同一个 worker id + count 永远得到同一组偏移，刷新不跳）。
 * 渲染在 `components/outdoor-plan-3d.tsx` 里做。
 *
 * 坐标系：输入输出都是站点 ENU（x 东、y 北，单位米），与 2D 画布同一套。
 */

import type { PlanPoint, PlanWorkerGender } from '../../../../supabase/functions/_shared/site-plan';
import { CROWD_TYPE_MODELS, type CrowdTypeId } from './crowd-types';
import {
  isCustomPointRole,
  laborAholoGlbUrl,
  laborAholoSlot,
  laborRoleHasGender,
  normalizeLaborGender,
  type LaborGender,
  type LaborPersonModelSource,
} from './labor-gender';

/** 单个岗位最多渲染几个人（worker.count 上限 9999，全放会卡死）。 */
export const MAX_CROWD_INSTANCES_PER_WORKER = 24;

/** 岗位关键词 → 人群类型。顺序敏感：先匹配到的赢。 */
const ROLE_TO_CROWD: ReadonlyArray<{ readonly role: string; readonly crowdType: CrowdTypeId }> = [
  { role: '消防', crowdType: 'fire' },
  { role: '义务', crowdType: 'medical' },
  { role: '医务', crowdType: 'medical' },
  { role: '医护', crowdType: 'medical' },
  { role: '医疗', crowdType: 'medical' },
  { role: '警察', crowdType: 'police' },
  { role: '安保', crowdType: 'security' },
  { role: '保安', crowdType: 'security' },
  { role: '管理员', crowdType: 'admin' },
  { role: '主管', crowdType: 'manager' },
  { role: '经理', crowdType: 'executive' },
  { role: '志愿', crowdType: 'volunteer' },
  { role: '演员', crowdType: 'performer' },
  { role: '展商', crowdType: 'exhibitor' },
  { role: '观众', crowdType: 'audience' },
  { role: '工作', crowdType: 'staff' },
  { role: '员工', crowdType: 'staff' },
  { role: '自定义', crowdType: 'staff' },
];

/** 2D 岗位名 → 人群类型；认不出来就按工作人员算。 */
export function crowdTypeForRole(role: string): CrowdTypeId {
  const text = (role ?? '').trim();
  if (!text) return 'staff';
  for (const entry of ROLE_TO_CROWD) {
    if (text.includes(entry.role)) return entry.crowdType;
  }
  return 'staff';
}

/** 人群类型 → 素材库模型 slug（该类型没模型时返回 null）。 */
export function crowdModelSlugForType(crowdType: CrowdTypeId, index = 0): string | null {
  const slugs = CROWD_TYPE_MODELS[crowdType] ?? [];
  if (slugs.length === 0) return null;
  const i = ((index % slugs.length) + slugs.length) % slugs.length;
  return slugs[i] ?? null;
}

/** 素材库人物模型的公开路径。 */
export function crowdGlbUrl(slug: string): string {
  return `/showcase/assets/library/model/${slug}.glb`;
}

/** 2D 岗位点位（只取本模块需要的字段）。 */
export interface PlanCrowdWorker {
  id: string;
  role: string;
  count: number;
  position: PlanPoint;
  color?: string | undefined;
  /** 缺省按男；自定义点忽略。 */
  gender?: PlanWorkerGender | undefined;
}

/** 一个可渲染的人群实例。 */
export interface CrowdPlacement {
  id: string;
  workerId: string;
  role: string;
  crowdType: CrowdTypeId;
  gender: LaborGender | null;
  /** 模型来源：就绪的 Aholo / 现有低模 / 无模型回落。 */
  modelSource: LaborPersonModelSource;
  /** 素材库 slug；null 表示该人群暂时没有低模（可能已是 Aholo，或只画人位标记）。 */
  slug: string | null;
  /** 模型 URL；没有可用模型时为 null（2D 贴纸 / 现有人位标记，不造灰盒子）。 */
  glbUrl: string | null;
  /** 实例绝对落点（ENU，已含散布偏移）。 */
  at: PlanPoint;
  /** 相对岗位点位的散布偏移（ENU）。 */
  offset: { x: number; y: number };
  color: string;
}

const DEFAULT_WORKER_COLOR = '#5e7fa6';

/**
 * 散布偏移：黄金角螺旋，保证第 i 个人不会叠在同一点上。
 * 半径随序号缓增，点位附近人挤一点、外圈散一点。
 */
export function crowdSpreadOffset(index: number): { x: number; y: number } {
  const angle = index * 2.399963229728653;
  const radius = 0.45 + 0.26 * Math.sqrt(index);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

export interface LaborPersonModel {
  source: LaborPersonModelSource;
  role: string;
  gender: LaborGender | null;
  assetId: string | null;
  slug: string | null;
  glbUrl: string | null;
}

/**
 * 按岗位 + 性别解析 3D 人物：就绪的 Aholo 优先；否则消防/医务等现有低模；
 * 自定义点永远不给人物模型；其余未出模岗位保持无 GLB 回落。
 */
export function resolveLaborPersonModel(role: string, gender?: unknown, index = 0): LaborPersonModel {
  const trimmed = (role ?? '').trim();
  if (!trimmed || isCustomPointRole(trimmed)) {
    return { source: 'none', role: trimmed, gender: null, assetId: null, slug: null, glbUrl: null };
  }
  const resolvedGender = laborRoleHasGender(trimmed) ? normalizeLaborGender(gender) : null;
  const slot = laborAholoSlot(trimmed, resolvedGender);
  const aholoUrl = laborAholoGlbUrl(trimmed, resolvedGender);
  if (aholoUrl) {
    return {
      source: 'aholo',
      role: trimmed,
      gender: resolvedGender,
      assetId: slot?.assetId ?? null,
      slug: null,
      glbUrl: aholoUrl,
    };
  }
  const slug = crowdModelSlugForType(crowdTypeForRole(trimmed), index);
  if (slug) {
    return {
      source: 'lowpoly',
      role: trimmed,
      gender: resolvedGender,
      assetId: slot?.assetId ?? null,
      slug,
      glbUrl: crowdGlbUrl(slug),
    };
  }
  return {
    source: 'fallback',
    role: trimmed,
    gender: resolvedGender,
    assetId: slot?.assetId ?? null,
    slug: null,
    glbUrl: null,
  };
}

/**
 * 把 2D 岗位展开成 N 个人群实例。
 *
 * - count 超过 {@link MAX_CROWD_INSTANCES_PER_WORKER} 时截断（2D 上的数字仍是准的）。
 * - 没有可用模型的岗位照样产出实例，3D 侧画人位标记；Aholo 出模并把槽位置 ready 后自动换成真模型。
 * - 自定义点不挂人物模型。
 */
export function planCrowdPlacements(
  workers: readonly PlanCrowdWorker[],
  options: { maxPerWorker?: number } = {},
): CrowdPlacement[] {
  const max = Math.max(1, options.maxPerWorker ?? MAX_CROWD_INSTANCES_PER_WORKER);
  const placements: CrowdPlacement[] = [];
  for (const worker of workers) {
    const crowdType = crowdTypeForRole(worker.role);
    const total = Math.max(0, Math.min(Math.floor(worker.count), max));
    for (let index = 0; index < total; index += 1) {
      const model = resolveLaborPersonModel(worker.role, worker.gender, index);
      const offset = crowdSpreadOffset(index);
      placements.push({
        id: `${worker.id}#${index}`,
        workerId: worker.id,
        role: worker.role,
        crowdType,
        gender: model.gender,
        modelSource: model.source,
        slug: model.slug,
        glbUrl: model.glbUrl,
        at: { x: worker.position.x + offset.x, y: worker.position.y + offset.y },
        offset,
        color: worker.color ?? DEFAULT_WORKER_COLOR,
      });
    }
  }
  return placements;
}
