import { cloudPeopleUrl } from './cloud-assets';
import {
  PEOPLE_REGISTRY,
  WALK_ROLE_NO_SIT_NOTE,
  findPerson,
  selectablePeople,
  type PersonSlot,
} from './people-registry';
import type { CrowdTypeId } from './crowd-types';

/**
 * 漫游角色的兼容视图（真源已迁到 lib/people-registry.ts）。
 *
 * 2026-11-20：以前这里自己拼「11 条基线 + 16 条 labor」，同一个岗位出三张卡；
 * 现在只从登记表派生：
 * - `WALK_ROLES` = 可选用的人（22 条，不含旧单模）
 * - `LEGACY_WALK_ROLES` = 旧单模（只用于还原，不进选择器）
 * - `findWalkRole` 查全表，老方案里绑定的旧 assetId 仍能取到头像与名字
 *
 * 左侧「漫游角色」与右侧 `tool-walk` 仍共用这一份，改角色不会多出第二个入口。
 */
export type WalkRole = {
  assetId: string;
  name: string;
  image: string;
  /** 没有绑骨或没有 Idle/Walk 的角色只能选、不能走。 */
  walkable: boolean;
  /** 不能走时说明原因，显示在卡片下面。 */
  note?: string;
  /** 挂到「不同人群」的哪一类；缺省为游客。 */
  crowdType?: CrowdTypeId;
};

export { WALK_ROLE_NO_SIT_NOTE };

function toWalkRole(slot: PersonSlot): WalkRole {
  return {
    assetId: slot.assetId as string,
    name: slot.name,
    image: slot.image,
    walkable: slot.walkable,
    ...(slot.note ? { note: slot.note } : {}),
    crowdType: slot.crowdType,
  };
}

function withAsset(slots: readonly PersonSlot[]): readonly PersonSlot[] {
  return slots.filter(slot => Boolean(slot.assetId));
}

/** 可选用的人：6 个古装游客 + 16 个劳动力男女槽。 */
export const WALK_ROLES: readonly WalkRole[] = withAsset(selectablePeople()).map(toWalkRole);

/** 旧单模：仍可加载、仍可漫游，但不再出现在任何选择器里（只给老方案还原）。 */
export const LEGACY_WALK_ROLES: readonly WalkRole[] = withAsset(
  PEOPLE_REGISTRY.filter(slot => slot.legacy),
).map(toWalkRole);

export const DEFAULT_WALK_ROLE_ID = WALK_ROLES[0]!.assetId;

/** 按 assetId 查角色：先查可选，再查旧单模；都查不到兜底到首条（沿用旧行为）。 */
export function findWalkRole(assetId: string): WalkRole {
  const slot = findPerson(assetId);
  return slot ? toWalkRole(slot) : WALK_ROLES[0]!;
}

/**
 * 角色归属的人群类型；未标注的角色归游客（古装漫游角色不再算演员）。
 * 参数只用得上 `crowdType`，所以取结构化最小类型：面板里拼出来的卡片对象也能直接问。
 */
export function walkRoleCrowdType(role: { crowdType?: string | undefined }): string {
  return role.crowdType ?? 'visitor';
}

/**
 * 漫游人物的模型地址：人物 GLB 已整批上云（R2 scendance-assets），本地与线上同走云端地址。
 * 本机 3199 代理仍是生成/落盘链路，不再承担人物下发。
 */
export function walkRoleGlbUrl(assetId: string): string {
  return cloudPeopleUrl(assetId);
}
