import { describe, expect, it } from 'vitest';
import { CROWD_TYPES } from './crowd-types';
import {
  LABOR_GENDER_ASSET_IDS,
  LABOR_GENDER_SLOTS,
  LABOR_ROLE_CROWD_TYPE,
  laborSlotByAssetId,
  laborSlotsForGender,
  laborSlotsForRole,
  type LaborRoleId,
} from './labor-gender';

const ROLES: LaborRoleId[] = [
  'security',
  'police',
  'volunteer',
  'manager',
  'admin',
  'fire',
  'medical',
  'executive',
];

describe('PEOPLE-06 劳动力男女登记层', () => {
  it('共 16 槽：8 岗各男女两槽', () => {
    expect(LABOR_GENDER_SLOTS).toHaveLength(16);
    expect(laborSlotsForGender('male')).toHaveLength(8);
    expect(laborSlotsForGender('female')).toHaveLength(8);
    for (const role of ROLES) {
      expect(laborSlotsForRole(role)).toHaveLength(2);
      expect(laborSlotsForRole(role).map((slot) => slot.gender).sort()).toEqual(['female', 'male']);
    }
  });

  it('assetId 唯一、前缀统一，且能按 id 反查槽位', () => {
    const assetIds = LABOR_GENDER_SLOTS.map((slot) => slot.assetId);
    expect(new Set(assetIds).size).toBe(assetIds.length);
    for (const slot of LABOR_GENDER_SLOTS) {
      expect(slot.assetId).toMatch(/^7a9f1e21-8c34-4d52-/);
      expect(LABOR_GENDER_ASSET_IDS.has(slot.assetId)).toBe(true);
      expect(laborSlotByAssetId(slot.assetId)?.id).toBe(slot.id);
    }
  });

  it('上云验收后全部就绪，提示词与岗位名非空', () => {
    for (const slot of LABOR_GENDER_SLOTS) {
      expect(slot.ready).toBe(true);
      expect(slot.prompt.trim().length).toBeGreaterThan(0);
      expect(slot.roleLabel.trim().length).toBeGreaterThan(0);
    }
  });

  it('岗位映射到既有且存在的人群类型，经理与主管各自独立', () => {
    const knownIds = new Set(CROWD_TYPES.map((type) => type.id));
    for (const role of ROLES) {
      const crowdType = LABOR_ROLE_CROWD_TYPE[role];
      expect(knownIds.has(crowdType)).toBe(true);
      for (const slot of laborSlotsForRole(role)) {
        expect(slot.crowdType).toBe(crowdType);
      }
    }
    expect(LABOR_ROLE_CROWD_TYPE.manager).toBe('manager');
    expect(LABOR_ROLE_CROWD_TYPE.executive).toBe('executive');
    expect(LABOR_ROLE_CROWD_TYPE.manager).not.toBe(LABOR_ROLE_CROWD_TYPE.executive);
  });

  it('槽位 id 由岗位与性别拼成，无重号', () => {
    const ids = LABOR_GENDER_SLOTS.map((slot) => slot.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const slot of LABOR_GENDER_SLOTS) {
      const suffix = slot.gender === 'male' ? '-m' : '-f';
      expect(slot.id.endsWith(suffix)).toBe(true);
    }
  });
});
