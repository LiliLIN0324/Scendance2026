import { describe, expect, it } from 'vitest';
import { LABOR_GENDER_SLOTS } from './labor-gender';
import {
  DEFAULT_WALK_ROLE_ID,
  findWalkRole,
  walkRoleCrowdType,
  walkRoleGlbUrl,
  WALK_ROLES,
} from './walk-roles';

const READY_LABOR = LABOR_GENDER_SLOTS.filter(slot => slot.ready);

describe('walk-roles 派生清单', () => {
  it('基线 11 槽在前，16 个 ready labor 槽并入在后', () => {
    expect(WALK_ROLES).toHaveLength(11 + READY_LABOR.length);
    const laborAssetIds = new Set(READY_LABOR.map(slot => slot.assetId));
    const tail = WALK_ROLES.slice(-READY_LABOR.length);
    expect(tail.every(role => laborAssetIds.has(role.assetId))).toBe(true);
    // 前 11 条不含 labor assetId。
    expect(WALK_ROLES.slice(0, 11).every(role => !laborAssetIds.has(role.assetId))).toBe(true);
  });

  it('每个 labor 槽可走、带人群类型与头像，名带性别后缀', () => {
    const byAsset = new Map(WALK_ROLES.map(role => [role.assetId, role]));
    for (const slot of READY_LABOR) {
      const role = byAsset.get(slot.assetId);
      expect(role, `labor 槽 ${slot.id} 应入列`).toBeDefined();
      expect(role!.walkable).toBe(true);
      expect(role!.crowdType).toBe(slot.crowdType);
      expect(role!.image).toBe(`/assets/avatars/labor-${slot.id}.jpg`);
      expect(role!.name).toBe(`${slot.roleLabel}${slot.gender === 'female' ? '女' : '男'}`);
    }
  });

  it('labor 男女各半，岗位覆盖 8 类', () => {
    const males = READY_LABOR.filter(s => s.gender === 'male');
    const females = READY_LABOR.filter(s => s.gender === 'female');
    expect(males).toHaveLength(8);
    expect(females).toHaveLength(8);
    expect(new Set(READY_LABOR.map(s => s.crowdType))).toHaveLength(8);
  });

  it('findWalkRole 命中已知代号，未命中兜底到首条', () => {
    const first = WALK_ROLES[0]!;
    expect(findWalkRole(first.assetId).assetId).toBe(first.assetId);
    expect(findWalkRole('00000000-0000-4000-8000-000000000000').assetId).toBe(first.assetId);
    expect(DEFAULT_WALK_ROLE_ID).toBe(first.assetId);
  });

  it('古装（汉服/唐服/明服）角色归游客，不再算演员；角色 GLB 地址走云端', () => {
    expect(walkRoleCrowdType(WALK_ROLES[0]!)).toBe('visitor');
    for (const role of WALK_ROLES.filter(r => /唐|宋|明/.test(r.name))) {
      expect(walkRoleCrowdType(role), role.name).toBe('visitor');
    }
    const role = WALK_ROLES.find(r => r.crowdType === 'security')!;
    expect(walkRoleGlbUrl(role.assetId)).toContain(role.assetId);
  });
});
