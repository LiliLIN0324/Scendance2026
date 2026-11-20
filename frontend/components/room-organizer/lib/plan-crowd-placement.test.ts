import { describe, expect, it } from 'vitest';
import {
  crowdGlbUrl,
  crowdModelSlugForType,
  crowdSpreadOffset,
  crowdTypeForRole,
  MAX_CROWD_INSTANCES_PER_WORKER,
  planCrowdPlacements,
} from './plan-crowd-placement';
import { PEOPLE_REGISTRY, defaultPersonForType } from './people-registry';
import { walkRoleGlbUrl } from './walk-roles';

const assetIdOf = (name: string): string =>
  PEOPLE_REGISTRY.find(slot => slot.name === name)!.assetId as string;

describe('plan-crowd-placement（2D 岗位 → 3D 人群实例）', () => {
  it('岗位名映射到人群类型', () => {
    expect(crowdTypeForRole('消防')).toBe('fire');
    expect(crowdTypeForRole('医务人员')).toBe('medical');
    expect(crowdTypeForRole('警察')).toBe('police');
    expect(crowdTypeForRole('保安')).toBe('security');
    expect(crowdTypeForRole('志愿者')).toBe('volunteer');
    expect(crowdTypeForRole('主管')).toBe('manager');
    expect(crowdTypeForRole('经理')).toBe('executive');
    expect(crowdTypeForRole('管理员')).toBe('admin');
    expect(crowdTypeForRole('自定义点')).toBe('staff');
    expect(crowdTypeForRole('完全不认识的岗位')).toBe('staff');
    expect(crowdTypeForRole('')).toBe('staff');
  });

  it('默认角色由登记表默认性别决定：保安/警察/管理员出男、志愿者/主管出女、经理出男', () => {
    expect(defaultPersonForType('security')?.name).toBe('保安男');
    expect(defaultPersonForType('police')?.name).toBe('警察男');
    expect(defaultPersonForType('admin')?.name).toBe('管理员男');
    expect(defaultPersonForType('volunteer')?.name).toBe('志愿者女');
    expect(defaultPersonForType('manager')?.name).toBe('主管女');
    expect(defaultPersonForType('executive')?.name).toBe('经理男');
    // 没有模型的类型拿到 null，调用方照旧出人位标记。
    expect(defaultPersonForType('audience')).toBeNull();
  });

  it('本期所有人群类型都不挂本地低模 slug，返回 null', () => {
    for (const crowdType of ['medical', 'fire', 'security', 'police', 'volunteer', 'manager', 'admin', 'staff', 'exhibitor', 'audience']) {
      expect(crowdModelSlugForType(crowdType)).toBeNull();
    }
  });

  it('低模 URL 仍指向素材库公开路径（纯构造，链路已不再取用低模）', () => {
    expect(crowdGlbUrl('some-slug')).toBe('/showcase/assets/library/model/some-slug.glb');
  });

  it('散布偏移确定：首人居中对齐落点圆盘，其余簇拥在盘内', () => {
    const a = crowdSpreadOffset(0);
    const b = crowdSpreadOffset(0);
    expect(a).toEqual(b);
    expect(a).toEqual({ x: 0, y: 0 });
    const first = crowdSpreadOffset(1);
    expect(first).not.toEqual(a);
    // 岗位落点圆盘半径约 0.405m，前几位实例收在盘内/边缘。
    expect(Math.hypot(first.x, first.y)).toBeLessThan(0.45);
    for (let i = 1; i <= 4; i += 1) {
      const o = crowdSpreadOffset(i);
      expect(Math.hypot(o.x, o.y)).toBeLessThan(0.55);
    }
  });

  it('未绑定角色时按人群类型取默认云端 walk 角色，count 份都是同一角色副本', () => {
    const placements = planCrowdPlacements([
      { id: 'w1', role: '保安', count: 6, position: { x: 10, y: 20 } },
    ]);
    expect(placements).toHaveLength(6);
    const expected = assetIdOf('保安男');
    for (const placement of placements) {
      expect(placement.workerId).toBe('w1');
      expect(placement.crowdType).toBe('security');
      expect(placement.assetId).toBe(expected);
      expect(placement.slug).toBeNull();
      expect(placement.glbUrl).toBe(walkRoleGlbUrl(expected));
      expect(Math.hypot(placement.at.x - 10, placement.at.y - 20)).toBeLessThan(3);
    }
  });

  it('点位绑定具体角色时固定到该角色，不按性别轮换', () => {
    const policeFemale = assetIdOf('警察女');
    const placements = planCrowdPlacements([
      { id: 'w2', role: '警察', count: 3, position: { x: 0, y: 0 }, assetId: policeFemale },
    ]);
    expect(placements).toHaveLength(3);
    for (const placement of placements) {
      expect(placement.assetId).toBe(policeFemale);
      expect(placement.glbUrl).toBe(walkRoleGlbUrl(policeFemale));
      expect(placement.slug).toBeNull();
    }
  });

  it('绑定代号未登记时回退到该类默认角色，不沿用坏代号', () => {
    const placements = planCrowdPlacements([
      { id: 'w3', role: '警察', count: 1, position: { x: 0, y: 0 }, assetId: '00000000-0000-4000-8000-000000000000' },
    ]);
    expect(placements[0]?.assetId).toBe(assetIdOf('警察男'));
    expect(placements[0]?.glbUrl).toBe(walkRoleGlbUrl(assetIdOf('警察男')));
  });

  it('旧单模绑定仍生效：老方案里的 assetId 不会被换掉', () => {
    const legacy = '7a9f1e21-8c34-4d51-a007-b00000000007';
    const placements = planCrowdPlacements([
      { id: 'w8', role: '保安', count: 1, position: { x: 0, y: 0 }, assetId: legacy },
    ]);
    expect(placements[0]?.assetId).toBe(legacy);
    expect(placements[0]?.glbUrl).toBe(walkRoleGlbUrl(legacy));
  });

  it('有 walk 角色的岗位优先云端模型，不再回退低模', () => {
    const placements = planCrowdPlacements([
      { id: 'w4', role: '消防', count: 2, position: { x: 0, y: 0 } },
    ]);
    expect(placements[0]?.slug).toBeNull();
    expect(placements[0]?.glbUrl).toContain('/people/');
  });

  it('没有 walk 角色的岗位出人位标记：assetId/slug/glbUrl 均为 null，不再回退本地低模', () => {
    const audience = planCrowdPlacements([
      { id: 'w5', role: '观众', count: 9999, position: { x: 0, y: 0 } },
    ]);
    expect(audience).toHaveLength(MAX_CROWD_INSTANCES_PER_WORKER);
    expect(audience[0]?.assetId).toBeNull();
    expect(audience[0]?.slug).toBeNull();
    expect(audience[0]?.glbUrl).toBeNull();

    const unknown = planCrowdPlacements([
      { id: 'w6', role: '自定义点', count: 1, position: { x: 0, y: 0 } },
    ]);
    expect(unknown[0]?.assetId).toBeNull();
    expect(unknown[0]?.slug).toBeNull();
    expect(unknown[0]?.glbUrl).toBeNull();
  });

  it('保留岗位颜色', () => {
    const placements = planCrowdPlacements([
      { id: 'w7', role: '工作人员', count: 1, position: { x: 0, y: 0 }, color: '#ff8800' },
    ]);
    expect(placements[0]?.color).toBe('#ff8800');
  });
});
