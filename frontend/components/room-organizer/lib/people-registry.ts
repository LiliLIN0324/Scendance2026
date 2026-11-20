/**
 * 人物登记表：场上能出现哪些人，只在这里登记一次。
 *
 * 2026-11-20 之前是两份并列清单：walk-roles 的 11 条基线 + labor-gender 的 16 槽直接
 * 追加（`...LABOR_WALK_ROLES`），结果保安 / 警察 / 志愿者 / 主管 / 管理员各出三张卡，
 * 其中 PEOPLE-05 的单模与 PEOPLE-06 的男/女槽提示词逐字相同，等于同一个描述生成了两次。
 *
 * 现在按 roadmap 的「统一角色登记表」收口：`人群类型 × 性别（× 古装角色款）→ 唯一槽位`。
 * 旧单模保留为 `legacy` 槽：仍然可解析、可加载、可漫游（老方案的 assetId 不至于变成
 * 空白人），但不再进任何选择器。
 *
 * 约定：
 * - `LABOR_GENDER_SLOTS` 仍是生成批次档案（prompt / 交接包出处），这里只消费它的结果。
 * - 低模这一档先留空（2026-11-15 口径：本期不启用本地低模占位）；表里留 `lowpoly` 位，
 *   将来 `CROWD_TYPE_MODELS` 非空时不用改调用方。
 * - 重复槽位在模块加载时直接抛错：宁可启动就炸，也不要再悄悄多出一张卡。
 */

import { LABOR_GENDER_SLOTS } from './labor-gender';
import type { CrowdTypeId } from './crowd-types';

/** 无坐姿剪辑时，卡片与属性面板统一用这句话说明落座按下沉对位。 */
export const WALK_ROLE_NO_SIT_NOTE = '无坐姿动作 · 落座按下沉对位';

export type PersonGender = 'male' | 'female';

/** 模型来源：可漫游 GLB / 素材库静态低模 / 暂无模型的人位标记。 */
export type PersonSource = 'walk' | 'lowpoly' | 'placeholder';

export interface PersonSlot {
  /** 稳定身份：`security:male`、`visitor:tang-female`、`legacy:security`。 */
  id: string;
  crowdType: CrowdTypeId;
  /** 旧单模没有性别概念，记 null。 */
  gender: PersonGender | null;
  /** 古装角色按款区分（tang / song / ming），岗位槽没有这一维。 */
  variant?: string;
  name: string;
  image: string;
  source: PersonSource;
  walkable: boolean;
  note?: string;
  /** walk：云端 GLB 代号（people/<assetId>.glb）。 */
  assetId?: string;
  /** lowpoly：素材库 slug；本轮为空。 */
  slug?: string;
  /** 只还原、不进选择器。 */
  legacy: boolean;
}

interface VisitorSeed {
  key: string;
  variant: string;
  name: string;
  gender: PersonGender;
  assetId: string;
  image: string;
}

/** 古装漫游角色（2026-11-16 用户口径：汉/唐/宋/明服饰算游客，不算演员）。 */
const VISITOR_SEEDS: readonly VisitorSeed[] = [
  { key: 'tang-female', variant: 'tang', name: '唐女', gender: 'female', assetId: '7a9f1e21-8c34-4d51-a001-b00000000001', image: '/assets/avatars/walk-tang-f.jpg' },
  { key: 'tang-male', variant: 'tang', name: '唐男', gender: 'male', assetId: '7a9f1e21-8c34-4d51-a002-b00000000002', image: '/assets/avatars/walk-tang-m.jpg' },
  { key: 'song-female', variant: 'song', name: '宋女', gender: 'female', assetId: '7a9f1e21-8c34-4d51-a003-b00000000003', image: '/assets/avatars/walk-song-f.jpg' },
  { key: 'ming-female', variant: 'ming', name: '明女', gender: 'female', assetId: '7a9f1e21-8c34-4d51-a004-b00000000004', image: '/assets/avatars/walk-ming-f.jpg' },
  { key: 'ming-male', variant: 'ming', name: '明男', gender: 'male', assetId: '7a9f1e21-8c34-4d51-a005-b00000000005', image: '/assets/avatars/walk-ming-m.jpg' },
  { key: 'song-male', variant: 'song', name: '宋男', gender: 'male', assetId: '7a9f1e21-8c34-4d51-a006-b00000000006', image: '/assets/avatars/walk-song-m.jpg' },
];

const VISITOR_SLOTS: readonly PersonSlot[] = VISITOR_SEEDS.map(seed => ({
  id: `visitor:${seed.key}`,
  crowdType: 'visitor' as const,
  gender: seed.gender,
  variant: seed.variant,
  name: seed.name,
  image: seed.image,
  source: 'walk' as const,
  walkable: true,
  note: WALK_ROLE_NO_SIT_NOTE,
  assetId: seed.assetId,
  legacy: false,
}));

/** PEOPLE-06 劳动力男女批次：8 岗 × 男女，已验收上云。 */
const LABOR_SLOTS: readonly PersonSlot[] = LABOR_GENDER_SLOTS
  .filter(slot => slot.ready)
  .map(slot => ({
    id: `${slot.crowdType}:${slot.gender}`,
    crowdType: slot.crowdType,
    gender: slot.gender,
    name: `${slot.roleLabel}${slot.gender === 'female' ? '女' : '男'}`,
    image: `/assets/avatars/labor-${slot.id}.jpg`,
    source: 'walk' as const,
    walkable: true,
    note: WALK_ROLE_NO_SIT_NOTE,
    assetId: slot.assetId,
    legacy: false,
  }));

/**
 * PEOPLE-05 制服单模：与 PEOPLE-06 的 security-m / police-m / volunteer-f /
 * admin-m / manager-f 是同一描述生成的两次。留作旧方案还原入口，不进选择器。
 */
const LEGACY_SEEDS: ReadonlyArray<{ crowdType: CrowdTypeId; name: string; assetId: string; image: string }> = [
  { crowdType: 'security', name: '保安', assetId: '7a9f1e21-8c34-4d51-a007-b00000000007', image: '/assets/avatars/walk-security.jpg' },
  { crowdType: 'police', name: '警察', assetId: '7a9f1e21-8c34-4d51-a008-b00000000008', image: '/assets/avatars/walk-police.jpg' },
  { crowdType: 'volunteer', name: '志愿者', assetId: '7a9f1e21-8c34-4d51-a009-b00000000009', image: '/assets/avatars/walk-volunteer.jpg' },
  { crowdType: 'manager', name: '主管', assetId: '7a9f1e21-8c34-4d51-a00a-b0000000000a', image: '/assets/avatars/walk-manager.jpg' },
  { crowdType: 'admin', name: '管理员', assetId: '7a9f1e21-8c34-4d51-a00b-b0000000000b', image: '/assets/avatars/walk-admin.jpg' },
];

const LEGACY_SLOTS: readonly PersonSlot[] = LEGACY_SEEDS.map(seed => ({
  id: `legacy:${seed.crowdType}`,
  crowdType: seed.crowdType,
  gender: null,
  name: seed.name,
  image: seed.image,
  source: 'walk' as const,
  walkable: true,
  note: WALK_ROLE_NO_SIT_NOTE,
  assetId: seed.assetId,
  legacy: true,
}));

/**
 * 默认性别：沿用 PEOPLE-05 那一版的性别，未绑定点位换表后外观不变。
 * 游客没有岗位性别概念，取登记顺序首位（唐女），与旧行为一致。
 */
const DEFAULT_GENDER: Partial<Record<CrowdTypeId, PersonGender>> = {
  security: 'male',
  police: 'male',
  admin: 'male',
  volunteer: 'female',
  manager: 'female',
  fire: 'male',
  medical: 'male',
  executive: 'male',
};

const REGISTRY: readonly PersonSlot[] = [...VISITOR_SLOTS, ...LABOR_SLOTS, ...LEGACY_SLOTS];

/** 只读全表快照：walk-roles 的兼容视图与测试从这里取，不要另建第二份清单。 */
export const PEOPLE_REGISTRY = REGISTRY;

/** 同一 (人群类型, 性别, 古装款) 只能有一个可选用槽位；重复就在加载时报错。 */
function assertUnique(slots: readonly PersonSlot[]): void {
  const seen = new Set<string>();
  for (const slot of slots) {
    if (slot.legacy) continue;
    const key = `${slot.crowdType}|${slot.gender ?? 'none'}|${slot.variant ?? ''}`;
    if (seen.has(key)) {
      throw new Error(`人物登记重复：${slot.crowdType} / ${slot.gender ?? 'none'} / ${slot.variant ?? '-'}（${slot.id}）`);
    }
    seen.add(key);
  }
}
assertUnique(REGISTRY);

/** 全表（含 legacy），供测试、统计与还原使用。 */
export function peopleRegistry(): readonly PersonSlot[] {
  return REGISTRY;
}

/** 选择器可见的人：不含 legacy，也不含将来可能出现的 lowpoly 占位。 */
export function selectablePeople(): readonly PersonSlot[] {
  return REGISTRY.filter(slot => !slot.legacy && slot.walkable);
}

export function peopleOfType(crowdType: CrowdTypeId): readonly PersonSlot[] {
  return REGISTRY.filter(slot => slot.crowdType === crowdType && !slot.legacy);
}

/** 该类型实际有哪几种性别（游客有男有女，岗位槽各一条）。 */
export function gendersOfType(crowdType: CrowdTypeId): readonly PersonGender[] {
  const seen = new Set<PersonGender>();
  for (const slot of peopleOfType(crowdType)) {
    if (slot.gender) seen.add(slot.gender);
  }
  return [...seen];
}

/** 该类默认给谁：先按 DEFAULT_GENDER，找不到再取登记顺序第一个可走的人。 */
export function defaultPersonForType(crowdType: CrowdTypeId): PersonSlot | null {
  const list = peopleOfType(crowdType).filter(slot => slot.walkable);
  if (list.length === 0) return null;
  if (crowdType === 'visitor') return list[0] ?? null;
  const preferred = DEFAULT_GENDER[crowdType];
  if (preferred) {
    const hit = list.find(slot => slot.gender === preferred);
    if (hit) return hit;
  }
  return list[0] ?? null;
}

/** 按云端 GLB 代号反查，含 legacy（旧方案还原）。 */
export function findPerson(assetId: string | undefined): PersonSlot | null {
  if (!assetId) return null;
  return REGISTRY.find(slot => slot.assetId === assetId) ?? null;
}

/** 按稳定槽位 id 反查（派生路人用，不依赖可读角色名）。 */
export function findPersonById(id: string): PersonSlot | null {
  return REGISTRY.find(slot => slot.id === id) ?? null;
}
