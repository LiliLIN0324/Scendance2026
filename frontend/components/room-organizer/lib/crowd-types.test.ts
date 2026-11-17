import { describe, expect, it } from 'vitest';
import {
  CROWD_TYPE_MODELS,
  CROWD_TYPES,
  CROWD_TYPES_WITH_WALK_MODELS,
  crowdDirectory,
  crowdTypeModelSlugs,
  crowdTypeModelStatus,
  crowdTypeStatusLabel,
} from './crowd-types';
import { WALK_ROLES, walkRoleCrowdType } from './walk-roles';

describe('crowd type low-poly wiring', () => {
  it('low-poly slugs are unique within the registry', () => {
    const slugs = Object.values(CROWD_TYPE_MODELS).flat();
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('only maps slugs onto known crowd types', () => {
    const ids = new Set(CROWD_TYPES.map(type => type.id));
    for (const id of Object.keys(CROWD_TYPE_MODELS)) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('does not enable local low-poly people this round (no walk role falls back to a placeholder column)', () => {
    expect(CROWD_TYPE_MODELS).toEqual({});
    for (const type of CROWD_TYPES) {
      expect(crowdTypeModelSlugs(type.id)).toEqual([]);
    }
  });

  it('marks walk and empty types distinctly', () => {
    // 2026-11-16：古装漫游角色归游客，演员类目暂时没有 walk 模型。
    expect(crowdTypeModelStatus('visitor')).toBe('walk');
    expect(crowdTypeStatusLabel('visitor')).toBe('有漫游模型');
    expect(crowdTypeModelStatus('performer')).toBe('todo');
    expect(crowdTypeStatusLabel('performer')).toBe('待补模型');
    expect(crowdTypeModelStatus('medical')).toBe('walk');
    expect(crowdTypeModelStatus('fire')).toBe('walk');
    expect(crowdTypeStatusLabel('fire')).toBe('有漫游模型');
    expect(crowdTypeModelStatus('executive')).toBe('walk');
    expect(crowdTypeModelStatus('staff')).toBe('todo');
    expect(crowdTypeModelStatus('exhibitor')).toBe('todo');
    expect(crowdTypeModelStatus('audience')).toBe('todo');
    expect(crowdTypeStatusLabel('staff')).toBe('待补模型');
    expect(crowdTypeModelStatus('security')).toBe('walk');
    expect(crowdTypeModelStatus('police')).toBe('walk');
    expect(crowdTypeModelStatus('volunteer')).toBe('walk');
    expect(crowdTypeModelStatus('manager')).toBe('walk');
    expect(crowdTypeModelStatus('admin')).toBe('walk');
    expect(crowdTypeStatusLabel('security')).toBe('有漫游模型');
  });
});

describe('walk model source single source of truth', () => {
  it('derives walk types from the walk-roles registry', () => {
    const derived = new Set(WALK_ROLES.map(walkRoleCrowdType));
    expect(new Set(CROWD_TYPES_WITH_WALK_MODELS)).toEqual(derived);
  });

  it('classifies every registered walk role under a walk type', () => {
    for (const role of WALK_ROLES) {
      expect(crowdTypeModelStatus(walkRoleCrowdType(role))).toBe('walk');
    }
  });

  it('marks a type walk only when it owns a walk role', () => {
    for (const type of CROWD_TYPES) {
      const ownsRole = WALK_ROLES.some(role => walkRoleCrowdType(role) === type.id);
      expect(crowdTypeModelStatus(type.id) === 'walk').toBe(ownsRole);
    }
  });
});

describe('crowd directory', () => {
  it('merges walk roles and low-poly slugs by type with derived status', () => {
    const directory = crowdDirectory();
    expect(directory).toHaveLength(CROWD_TYPES.length);
    for (const entry of directory) {
      expect(entry.status).toBe(crowdTypeModelStatus(entry.id));
      expect(entry.statusLabel).toBe(crowdTypeStatusLabel(entry.id));
      expect(entry.slugs).toEqual(crowdTypeModelSlugs(entry.id));
      const ownedRoles = WALK_ROLES.filter(role => walkRoleCrowdType(role) === entry.id);
      expect(entry.walkAssetIds).toEqual(ownedRoles.map(role => role.assetId));
    }
  });

  it('every registered walk role appears in exactly one directory entry', () => {
    const directory = crowdDirectory();
    const listed = directory.flatMap(entry => entry.walkAssetIds);
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort()).toEqual([...WALK_ROLES.map(role => role.assetId)].sort());
  });
});
