import { cloudPeopleUrl } from './cloud-assets';
import { LABOR_GENDER_SLOTS } from './labor-gender';
import type { CrowdTypeId } from './crowd-types';

/**
 * 漫游角色清单：左侧「漫游角色」只负责选人，右侧 `tool-walk` 负责进出漫游。
 * 两边共用这一份，改角色不会多出第二个入口。
 *
 * `assetId` 是资产代理落盘缓存里的 GLB 文件名（现已整批上云，见 lib/cloud-assets.ts）：
 * 由 `docs/evidence/aholo/people04-hanfu-batch/_merge-walk.mjs` 把该槽位的
 * retarget-Idle_Loop / retarget-Walk_Loop 合并成一个双动画模型。
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

/**
 * PEOPLE-06 劳动力男女批次：ready 槽位已上云双动画 GLB，并入漫游角色表。
 * 头像取自交接包正面参考图（public/assets/avatars/labor-<slot>.jpg）。
 */
const LABOR_WALK_ROLES: readonly WalkRole[] = LABOR_GENDER_SLOTS
  .filter(slot => slot.ready)
  .map(slot => ({
    assetId: slot.assetId,
    name: `${slot.roleLabel}${slot.gender === 'female' ? '女' : '男'}`,
    image: `/assets/avatars/labor-${slot.id}.jpg`,
    walkable: true,
    crowdType: slot.crowdType,
  }));

export const WALK_ROLES: readonly WalkRole[] = [
  // 古装漫游角色（汉服/唐服/宋服/明服）算游客，不算演员（2026-11-16 用户口径）。
  { assetId: '7a9f1e21-8c34-4d51-a001-b00000000001', name: '唐女', image: '/assets/avatars/walk-tang-f.jpg', walkable: true, crowdType: 'visitor' },
  { assetId: '7a9f1e21-8c34-4d51-a002-b00000000002', name: '唐男', image: '/assets/avatars/walk-tang-m.jpg', walkable: true, crowdType: 'visitor' },
  { assetId: '7a9f1e21-8c34-4d51-a003-b00000000003', name: '宋女', image: '/assets/avatars/walk-song-f.jpg', walkable: true, crowdType: 'visitor' },
  { assetId: '7a9f1e21-8c34-4d51-a004-b00000000004', name: '明女', image: '/assets/avatars/walk-ming-f.jpg', walkable: true, crowdType: 'visitor' },
  { assetId: '7a9f1e21-8c34-4d51-a005-b00000000005', name: '明男', image: '/assets/avatars/walk-ming-m.jpg', walkable: true, crowdType: 'visitor' },
  { assetId: '7a9f1e21-8c34-4d51-a006-b00000000006', name: '宋男', image: '/assets/avatars/walk-song-m.jpg', walkable: true, crowdType: 'visitor' },
  { assetId: '7a9f1e21-8c34-4d51-a007-b00000000007', name: '保安', image: '/assets/avatars/walk-security.jpg', walkable: true, crowdType: 'security' },
  { assetId: '7a9f1e21-8c34-4d51-a008-b00000000008', name: '警察', image: '/assets/avatars/walk-police.jpg', walkable: true, crowdType: 'police' },
  { assetId: '7a9f1e21-8c34-4d51-a009-b00000000009', name: '志愿者', image: '/assets/avatars/walk-volunteer.jpg', walkable: true, crowdType: 'volunteer' },
  { assetId: '7a9f1e21-8c34-4d51-a00a-b0000000000a', name: '主管', image: '/assets/avatars/walk-manager.jpg', walkable: true, crowdType: 'manager' },
  { assetId: '7a9f1e21-8c34-4d51-a00b-b0000000000b', name: '管理员', image: '/assets/avatars/walk-admin.jpg', walkable: true, crowdType: 'admin' },
  ...LABOR_WALK_ROLES,
];

export const DEFAULT_WALK_ROLE_ID = WALK_ROLES[0]!.assetId;

export function findWalkRole(assetId: string): WalkRole {
  return WALK_ROLES.find(role => assetId === role.assetId) ?? WALK_ROLES[0]!;
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
