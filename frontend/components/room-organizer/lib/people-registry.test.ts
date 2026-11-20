import { describe, expect, it } from 'vitest';
import { LOCAL_WALK_ASSET_IDS } from './glb-limits';
import { CROWD_TYPES } from './crowd-types';
import {
  PEOPLE_REGISTRY,
  defaultPersonForType,
  findPerson,
  findPersonById,
  gendersOfType,
  peopleOfType,
  peopleRegistry,
  selectablePeople,
} from './people-registry';

describe('人物登记表（单一人群真源）', () => {
  it('可选 22 人，旧单模不在其中', () => {
    expect(selectablePeople()).toHaveLength(22);
    expect(selectablePeople().every(slot => !slot.legacy)).toBe(true);
    expect(peopleRegistry().filter(slot => slot.legacy)).toHaveLength(5);
  });

  it('同一 (类型, 性别, 古装款) 只登记一次', () => {
    const seen = new Set<string>();
    for (const slot of selectablePeople()) {
      const key = `${slot.crowdType}|${slot.gender ?? 'none'}|${slot.variant ?? ''}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('保安/警察/志愿者/主管/管理员各只有男、女两张，不再有第三张单模', () => {
    for (const type of ['security', 'police', 'volunteer', 'manager', 'admin'] as const) {
      const slots = peopleOfType(type);
      expect(slots).toHaveLength(2);
      expect(slots.map(slot => slot.name)).toEqual([
        `${slots[0]!.name.replace(/[男女]$/, '')}男`,
        `${slots[1]!.name.replace(/[男女]$/, '')}女`,
      ]);
    }
  });

  it('游客按古装款区分，男女都有三款', () => {
    const visitors = peopleOfType('visitor');
    expect(visitors).toHaveLength(6);
    expect(new Set(visitors.map(slot => slot.variant))).toEqual(new Set(['tang', 'song', 'ming']));
    expect([...gendersOfType('visitor')].sort()).toEqual(['female', 'male']);
  });

  it('默认角色按 PEOPLE-05 性别沿用，且永远不是 legacy', () => {
    expect(defaultPersonForType('security')?.name).toBe('保安男');
    expect(defaultPersonForType('police')?.name).toBe('警察男');
    expect(defaultPersonForType('admin')?.name).toBe('管理员男');
    expect(defaultPersonForType('volunteer')?.name).toBe('志愿者女');
    expect(defaultPersonForType('manager')?.name).toBe('主管女');
    expect(defaultPersonForType('fire')?.name).toBe('消防男');
    expect(defaultPersonForType('medical')?.name).toBe('医务人员男');
    expect(defaultPersonForType('executive')?.name).toBe('经理男');
    for (const type of CROWD_TYPES) {
      expect(defaultPersonForType(type.id)?.legacy ?? false).toBe(false);
    }
    // 没有模型的类型返回 null，调用方照旧出人位标记。
    for (const type of ['staff', 'performer', 'exhibitor', 'audience'] as const) {
      expect(defaultPersonForType(type)).toBeNull();
    }
  });

  it('旧单模仍可解析（老方案还原），但不进选择器', () => {
    const legacyId = '7a9f1e21-8c34-4d51-a007-b00000000007';
    const slot = findPerson(legacyId);
    expect(slot?.name).toBe('保安');
    expect(slot?.legacy).toBe(true);
    expect(slot?.walkable).toBe(true);
    expect(findPersonById(slot!.id)?.assetId).toBe(legacyId);
    expect(selectablePeople().some(entry => entry.assetId === legacyId)).toBe(false);
  });

  it('登记表的 assetId 与可走 GLB 白名单一一对上', () => {
    const registered = new Set(PEOPLE_REGISTRY.map(slot => slot.assetId).filter(Boolean));
    expect(registered).toEqual(new Set(LOCAL_WALK_ASSET_IDS));
  });

  it('每个可走槽位都有名字、头像与人群类型', () => {
    for (const slot of selectablePeople()) {
      expect(slot.name.trim().length).toBeGreaterThan(0);
      expect(slot.image.startsWith('/assets/avatars/')).toBe(true);
      expect(slot.crowdType).toBeTruthy();
      expect(slot.source).toBe('walk');
    }
  });
});
