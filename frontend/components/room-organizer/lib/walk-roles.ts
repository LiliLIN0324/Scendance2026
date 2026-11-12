import { cloudPeopleUrl } from './cloud-assets';

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
  /** 挂到「不同人群」的哪一类；缺省为演员。 */
  crowdType?: 'performer' | 'security' | 'police' | 'volunteer' | 'manager' | 'admin';
};

export const WALK_ROLES: readonly WalkRole[] = [
  { assetId: '7a9f1e21-8c34-4d51-a001-b00000000001', name: '唐女', image: '/assets/avatars/walk-tang-f.jpg', walkable: true },
  { assetId: '7a9f1e21-8c34-4d51-a002-b00000000002', name: '唐男', image: '/assets/avatars/walk-tang-m.jpg', walkable: true },
  { assetId: '7a9f1e21-8c34-4d51-a003-b00000000003', name: '宋女', image: '/assets/avatars/walk-song-f.jpg', walkable: true },
  { assetId: '7a9f1e21-8c34-4d51-a004-b00000000004', name: '明女', image: '/assets/avatars/walk-ming-f.jpg', walkable: true },
  { assetId: '7a9f1e21-8c34-4d51-a005-b00000000005', name: '明男', image: '/assets/avatars/walk-ming-m.jpg', walkable: true },
  { assetId: '7a9f1e21-8c34-4d51-a006-b00000000006', name: '宋男', image: '/assets/avatars/walk-song-m.jpg', walkable: true },
  { assetId: '7a9f1e21-8c34-4d51-a007-b00000000007', name: '保安', image: '/assets/avatars/walk-security.jpg', walkable: true, crowdType: 'security' },
  { assetId: '7a9f1e21-8c34-4d51-a008-b00000000008', name: '警察', image: '/assets/avatars/walk-police.jpg', walkable: true, crowdType: 'police' },
  { assetId: '7a9f1e21-8c34-4d51-a009-b00000000009', name: '志愿者', image: '/assets/avatars/walk-volunteer.jpg', walkable: true, crowdType: 'volunteer' },
  { assetId: '7a9f1e21-8c34-4d51-a00a-b0000000000a', name: '主管', image: '/assets/avatars/walk-manager.jpg', walkable: true, crowdType: 'manager' },
  { assetId: '7a9f1e21-8c34-4d51-a00b-b0000000000b', name: '管理员', image: '/assets/avatars/walk-admin.jpg', walkable: true, crowdType: 'admin' },
];

export const DEFAULT_WALK_ROLE_ID = WALK_ROLES[0]!.assetId;

export function findWalkRole(assetId: string): WalkRole {
  return WALK_ROLES.find(role => assetId === role.assetId) ?? WALK_ROLES[0]!;
}

/**
 * 漫游人物的模型地址：人物 GLB 已整批上云（R2 scendance-assets），本地与线上同走云端地址。
 * 本机 3199 代理仍是生成/落盘链路，不再承担人物下发。
 */
export function walkRoleGlbUrl(assetId: string): string {
  return cloudPeopleUrl(assetId);
}
