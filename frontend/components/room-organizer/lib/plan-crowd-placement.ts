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

import { CROWD_TYPE_MODELS, type CrowdTypeId } from './crowd-types';
import { findPerson, defaultPersonForType } from './people-registry';
import { walkRoleGlbUrl } from './walk-roles';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

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
  { role: '游客', crowdType: 'visitor' },
  { role: '参观', crowdType: 'visitor' },
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

/** 绑定代号是否登记在可走漫游角色表里（未登记或不可走视为未绑定，回退到岗位默认）。 */
function registeredWalkAsset(assetId: string | undefined): string | null {
  if (!assetId) return null;
  const role = findPerson(assetId);
  return role?.walkable && role.assetId ? role.assetId : null;
}

/** 该类人群的默认漫游角色：由人物登记表的默认性别表决定，不在男女之间轮换。 */
export function defaultWalkAssetIdForType(crowdType: CrowdTypeId): string | null {
  return defaultPersonForType(crowdType)?.assetId ?? null;
}

/** 2D 岗位点位（只取本模块需要的字段）。 */
export interface PlanCrowdWorker {
  id: string;
  role: string;
  count: number;
  position: PlanPoint;
  color?: string | undefined;
  /** 绑定的漫游人物代号（可选）：固定到具体角色；不绑按岗位归类取默认角色。 */
  assetId?: string | undefined;
}

/** 一个可渲染的人群实例。 */
export interface CrowdPlacement {
  id: string;
  workerId: string;
  role: string;
  crowdType: CrowdTypeId;
  /** 解析出的云端漫游人物代号；null 表示该实例不用云端 walk 模型。 */
  assetId: string | null;
  /** 素材库 slug；null 表示该人群暂时没有模型（仍画人位标记）。 */
  slug: string | null;
  /** 模型 URL；slug 为 null 时也是 null。 */
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
 * 首人居中对齐岗位落点圆盘；其余人小半径簇拥在圆盘范围内，
 * 半径随序号缓增（多人时外圈才逐步散开）。
 */
export function crowdSpreadOffset(index: number): { x: number; y: number } {
  if (index <= 0) return { x: 0, y: 0 };
  const angle = index * 2.399963229728653;
  const radius = 0.26 + 0.12 * Math.sqrt(index - 1);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * 把 2D 岗位展开成 N 个人群实例。
 *
 * - count 超过 {@link MAX_CROWD_INSTANCES_PER_WORKER} 时截断（2D 上的数字仍是准的）。
 * - 没有模型的岗位（保安 / 警察 / 志愿者 / 主管 / 管理员）照样产出实例，
 *   3D 侧画人位标记，等素材库补齐模型后自动换成真模型。
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
    const boundAssetId = registeredWalkAsset(worker.assetId);
    const defaultAssetId = defaultWalkAssetIdForType(crowdType);
    for (let index = 0; index < total; index += 1) {
      // 固定到人：点位绑定的角色优先；未绑定取该类默认角色；都没有就出人位标记（本期不挂本地低模）。
      const assetId = boundAssetId ?? defaultAssetId;
      const slug = assetId ? null : crowdModelSlugForType(crowdType, index);
      const offset = crowdSpreadOffset(index);
      placements.push({
        id: `${worker.id}#${index}`,
        workerId: worker.id,
        role: worker.role,
        crowdType,
        assetId,
        slug,
        glbUrl: assetId ? walkRoleGlbUrl(assetId) : slug ? crowdGlbUrl(slug) : null,
        at: { x: worker.position.x + offset.x, y: worker.position.y + offset.y },
        offset,
        color: worker.color ?? DEFAULT_WORKER_COLOR,
      });
    }
  }
  return placements;
}
