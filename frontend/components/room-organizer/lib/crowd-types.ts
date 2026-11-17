/**
 * 「不同人群」清单（用户 m02574 / m02594）。
 *
 * 以前物料库里这一页叫「漫游角色」，只放 6 个古装漫游演员，跟 2D 规划里的劳动力
 * 岗位是两回事。现在合并成一页：先按人群类型列清楚现场有哪些人，再由素材库的
 * 人物模型 / 漫游演员补模型。没模型的类型先占位（后期生成或找公开模型）。
 *
 * 与户外规划的劳动力岗位对齐（lib/oneplan-catalog.ts 的 LABOR_ROLES），另外多出
 * 工作人员 / 演员 / 游客 / 观众几类——规划和 3D 都常用，但不算「岗位」。
 */
import { WALK_ROLES, walkRoleCrowdType } from './walk-roles';

export interface CrowdType {
  id: string;
  name: string;
  /** 一句话说明这类人在现场做什么。 */
  note: string;
}

export const CROWD_TYPES: readonly CrowdType[] = [
  { id: 'staff', name: '工作人员', note: '布场、检票、引导' },
  { id: 'security', name: '保安', note: '秩序与安保' },
  { id: 'police', name: '警察', note: '现场执勤' },
  { id: 'medical', name: '医护', note: '医疗点值守' },
  { id: 'fire', name: '消防', note: '消防值守' },
  { id: 'volunteer', name: '志愿者', note: '问询与协助' },
  { id: 'manager', name: '主管', note: '现场调度' },
  { id: 'executive', name: '经理', note: '活动统筹与决策' },
  { id: 'admin', name: '管理员', note: '场地管理' },
  { id: 'performer', name: '演员', note: '表演与漫游角色' },
  { id: 'visitor', name: '游客', note: '参观、打卡与漫游（汉服/唐服/明服等古装角色）' },
  { id: 'exhibitor', name: '展商', note: '摊位值守' },
  { id: 'audience', name: '观众', note: '人流示意' },
] as const;

export type CrowdTypeId = (typeof CROWD_TYPES)[number]['id'];

export type CrowdTypeModelStatus = 'walk' | 'lowpoly' | 'todo';

/**
 * 有漫游模型的类型：由漫游角色登记（lib/walk-roles.ts）反推，未标注的角色归游客。
 * 2026-11-16 用户：「传统服饰的（汉服/唐服/明服），把他们当作游客，不要当演员」——
 * 所以古装漫游角色归 visitor，performer 留给真正的演出人员。
 * 这样「哪些类型有 walk 模型」只有 walk-roles 一处声明，避免与这里的硬编码清单漂移。
 * 低模清单仍独立挂在 CROWD_TYPE_MODELS，两者可以同时存在。
 */
export const CROWD_TYPES_WITH_WALK_MODELS = new Set<string>(WALK_ROLES.map(walkRoleCrowdType));

/**
 * 库内低模人物按类型挂上。每个 slug 只属于一类，避免同一模型在多处重复出现。
 *
 * 2026-11-15 口径：本期不启用本地低模人物占位——无 walk 角色的类别直接出人位标记，
 * 等对应可漫游角色补齐后再上模型。清单暂留空结构，GLB 文件仍在公共库，未删除。
 */
export const CROWD_TYPE_MODELS: Readonly<Record<string, readonly string[]>> = {};

export function crowdTypeModelSlugs(id: string): readonly string[] {
  return CROWD_TYPE_MODELS[id] ?? [];
}

export function crowdTypeIdForModelSlug(slug: string): CrowdTypeId | null {
  for (const [id, slugs] of Object.entries(CROWD_TYPE_MODELS)) {
    if (slugs.includes(slug)) return id as CrowdTypeId;
  }
  return null;
}

export function crowdTypeModelStatus(id: string): CrowdTypeModelStatus {
  if (CROWD_TYPES_WITH_WALK_MODELS.has(id)) return 'walk';
  if (crowdTypeModelSlugs(id).length > 0) return 'lowpoly';
  return 'todo';
}

export function crowdTypeStatusLabel(id: string): string {
  switch (crowdTypeModelStatus(id)) {
    case 'walk':
      return '有漫游模型';
    case 'lowpoly':
      return '有低模';
    default:
      return '待补模型';
  }
}

export function crowdTypeName(id: string): string {
  return CROWD_TYPES.find(type => type.id === id)?.name ?? id;
}

/** 一类人群在素材目录里的完整登记：漫游角色 + 低模 + 状态，一处分组，面板不再内联拼。 */
export interface CrowdDirectoryEntry {
  id: CrowdTypeId;
  name: string;
  note: string;
  status: CrowdTypeModelStatus;
  statusLabel: string;
  /** 该类下的漫游角色 assetId（已绑骨上云）。 */
  walkAssetIds: string[];
  /** 该类下的本地低模 slug。 */
  slugs: readonly string[];
}

/** 统一目录：按人群类型合并 walk 角色与低模清单，计数与状态都从登记层派生。 */
export function crowdDirectory(): CrowdDirectoryEntry[] {
  return CROWD_TYPES.map(type => ({
    id: type.id,
    name: type.name,
    note: type.note,
    status: crowdTypeModelStatus(type.id),
    statusLabel: crowdTypeStatusLabel(type.id),
    walkAssetIds: WALK_ROLES
      .filter(role => walkRoleCrowdType(role) === type.id)
      .map(role => role.assetId),
    slugs: crowdTypeModelSlugs(type.id),
  }));
}
