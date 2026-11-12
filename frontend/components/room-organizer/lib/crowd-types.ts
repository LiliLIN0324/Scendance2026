/**
 * 「不同人群」清单（用户 m02574 / m02594）。
 *
 * 以前物料库里这一页叫「漫游角色」，只放 6 个古装漫游演员，跟 2D 规划里的劳动力
 * 岗位是两回事。现在合并成一页：先按人群类型列清楚现场有哪些人，再由素材库的
 * 人物模型 / 漫游演员补模型。没模型的类型先占位（后期生成或找公开模型）。
 *
 * 与户外规划的劳动力岗位对齐（lib/oneplan-catalog.ts 的 LABOR_ROLES），另外多出
 * 工作人员 / 演员 / 观众三类——规划和 3D 都常用，但不算「岗位」。
 */
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
  { id: 'admin', name: '管理员', note: '场地管理' },
  { id: 'performer', name: '演员', note: '表演与漫游角色' },
  { id: 'exhibitor', name: '展商', note: '摊位值守' },
  { id: 'audience', name: '观众', note: '人流示意' },
] as const;

export type CrowdTypeId = (typeof CROWD_TYPES)[number]['id'];

export type CrowdTypeModelStatus = 'walk' | 'lowpoly' | 'todo';

/** 有漫游模型的类型。低模清单仍独立挂在 CROWD_TYPE_MODELS，两者可以同时存在。 */
export const CROWD_TYPES_WITH_WALK_MODELS = new Set<string>(['performer', 'security', 'police', 'volunteer', 'manager', 'admin']);

/**
 * 库内低模人物按类型挂上。每个 slug 只属于一类，避免同一模型在多处重复出现。
 * 保安 / 警察 / 志愿者 / 主管 / 管理员还没有对得上的制服低模。
 */
export const CROWD_TYPE_MODELS: Readonly<Record<string, readonly string[]>> = {
  staff: [
    'low-poly-character-figures-builder-standing-41a26918',
    'low-poly-character-figures-cleaner-with-mop-579c8a9e',
    'low-poly-character-figures-waiter-with-tray-59369bb3',
    'low-poly-character-figures-chef-standing-107eec87',
  ],
  medical: [
    'low-poly-character-figures-medic-standing-c9e96efa',
  ],
  fire: [
    'low-poly-character-figures-firefighter-standing-8ded7b6f',
  ],
  exhibitor: [
    'low-poly-character-figures-shop-worker-standing-44c74d70',
    'low-poly-character-figures-courier-with-parcel-9ba10dd9',
  ],
  audience: [
    'low-poly-character-figures-civilian-standing-idle-514e9033',
    'low-poly-character-figures-civilian-sitting-f51129df',
    'low-poly-character-figures-civilian-walking-06de0354',
    'low-poly-character-figures-civilian-waving-a7248cbd',
    'low-poly-character-figures-civilian-arms-crossed-d539191f',
    'low-poly-character-figures-civilian-coat-standing-d311fc0b',
    'low-poly-character-figures-civilian-coat-walking-52e652ed',
    'low-poly-character-figures-civilian-hands-in-pockets-65efe4c2',
    'low-poly-character-figures-civilian-leaning-7dd8a161',
    'low-poly-character-figures-civilian-on-phone-57698df1',
    'low-poly-character-figures-civilian-pushing-trolley-02fba33e',
    'low-poly-character-figures-civilian-running-de3617e6',
  ],
};

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
