import { describe, expect, it } from 'vitest';
import { LABOR_GENDER_SLOTS } from './labor-gender';
import { PEOPLE_REGISTRY, findPerson, peopleOfType, selectablePeople } from './people-registry';
import {
  DEFAULT_WALK_ROLE_ID,
  LEGACY_WALK_ROLES,
  WALK_ROLES,
  findWalkRole,
  walkRoleCrowdType,
  walkRoleGlbUrl,
} from './walk-roles';

const READY_LABOR = LABOR_GENDER_SLOTS.filter(slot => slot.ready);

describe('walk-roles 派生清单（登记表兼容视图）', () => {
  it('可选 22 条：6 个古装游客 + 16 个 labor 槽，旧单模不在其中', () => {
    expect(WALK_ROLES).toHaveLength(6 + READY_LABOR.length);
    const legacyIds = new Set(LEGACY_WALK_ROLES.map(role => role.assetId));
    expect(WALK_ROLES.some(role => legacyIds.has(role.assetId))).toBe(false);
    // 每个 labor 槽都在可选清单里，一条不多一条不少。
    const assetIds = new Set(WALK_ROLES.map(role => role.assetId));
    for (const slot of READY_LABOR) expect(assetIds.has(slot.assetId)).toBe(true);
  });

  it('旧单模保留 5 条，仍可解析、仍可加载', () => {
    expect(LEGACY_WALK_ROLES).toHaveLength(5);
    for (const role of LEGACY_WALK_ROLES) {
      expect(role.walkable).toBe(true);
      expect(findWalkRole(role.assetId).assetId).toBe(role.assetId);
      expect(walkRoleGlbUrl(role.assetId)).toContain(role.assetId);
    }
    const legacy = findWalkRole('7a9f1e21-8c34-4d51-a007-b00000000007');
    expect(legacy.name).toBe('保安');
    expect(legacy.crowdType).toBe('security');
  });

  it('角色名不重复，且一个岗位只出一种性别组合', () => {
    const names = WALK_ROLES.map(role => role.name);
    expect(new Set(names).size).toBe(names.length);
    for (const type of ['security', 'police', 'volunteer', 'manager', 'admin'] as const) {
      const slots = peopleOfType(type);
      expect(slots).toHaveLength(2);
      expect(slots.map(slot => slot.gender).sort()).toEqual(['female', 'male']);
    }
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

  it('findWalkRole 命中已知代号，未命中兜底到首条', () => {
    const first = WALK_ROLES[0]!;
    expect(findWalkRole(first.assetId).assetId).toBe(first.assetId);
    expect(findWalkRole('00000000-0000-4000-8000-000000000000').assetId).toBe(first.assetId);
    expect(DEFAULT_WALK_ROLE_ID).toBe(first.assetId);
    expect(first.name).toBe('唐女');
  });

  it('古装（汉服/唐服/明服）角色归游客，不再算演员；角色 GLB 地址走云端', () => {
    expect(walkRoleCrowdType(WALK_ROLES[0]!)).toBe('visitor');
    for (const role of WALK_ROLES.filter(r => /唐|宋|明/.test(r.name))) {
      expect(walkRoleCrowdType(role), role.name).toBe('visitor');
    }
    const role = WALK_ROLES.find(r => r.crowdType === 'security')!;
    expect(walkRoleGlbUrl(role.assetId)).toContain(role.assetId);
  });

  it('登记表与可选清单一致：没有孤儿槽位，也没有第二份清单', () => {
    const selectableIds = selectablePeople().map(slot => slot.id);
    expect(selectableIds).toHaveLength(WALK_ROLES.length);
    const registered = PEOPLE_REGISTRY.filter(slot => !slot.legacy && slot.walkable && slot.assetId);
    expect(new Set(registered.map(slot => slot.assetId))).toEqual(new Set(WALK_ROLES.map(role => role.assetId)));
    // 反查按 assetId 一一对上。
    for (const role of WALK_ROLES) expect(findPerson(role.assetId)?.name).toBe(role.name);
  });
});
