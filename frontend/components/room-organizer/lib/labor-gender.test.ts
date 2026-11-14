import { describe, expect, it } from 'vitest';
import { sitePlanDataSchema } from '../../../../supabase/functions/_shared/site-plan';
import { CUSTOM_POINT_ROLE, LABOR_PERSON_ROLES, LABOR_ROLES } from './oneplan-catalog';
import { WALK_ROLES } from './walk-roles';
import {
  DEFAULT_LABOR_GENDER,
  LABOR_AHOLO_SLOTS,
  isCustomPointRole,
  isLaborPersonRole,
  laborAholoGlbUrl,
  laborAholoSlot,
  laborRoleHasGender,
  normalizeLaborGender,
} from './labor-gender';
import { crowdTypeForRole, resolveLaborPersonModel } from './plan-crowd-placement';

const SAMPLE_ID = 'e5000000-0000-4000-8000-000000000001';

function parseWorkers(workers: unknown[]) {
  return sitePlanDataSchema.parse({
    schemaVersion: 1,
    boundary: [],
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers,
  });
}

describe('labor gender attribute and aholo slots', () => {
  it('keeps nine labor icons and eight person roles', () => {
    expect([...LABOR_ROLES]).toEqual([
      '自定义点', '消防', '经理', '医务人员', '警察', '保安', '管理员', '主管', '志愿者',
    ]);
    expect(LABOR_PERSON_ROLES).toHaveLength(8);
    expect(LABOR_PERSON_ROLES).not.toContain('自定义点');
  });

  it('treats 自定义点 as a pin, not a gendered person', () => {
    expect(isCustomPointRole(CUSTOM_POINT_ROLE)).toBe(true);
    expect(laborRoleHasGender(CUSTOM_POINT_ROLE)).toBe(false);
    expect(isLaborPersonRole(CUSTOM_POINT_ROLE)).toBe(false);
    expect(laborAholoSlot(CUSTOM_POINT_ROLE, 'female')).toBeNull();
  });

  it('defaults missing or invalid gender to male without throwing', () => {
    expect(normalizeLaborGender(undefined)).toBe(DEFAULT_LABOR_GENDER);
    expect(normalizeLaborGender('female')).toBe('female');
    expect(normalizeLaborGender('male')).toBe('male');
    expect(normalizeLaborGender('other')).toBe('male');
  });

  it('reserves 16 distinct future slots and does not pretend they are ready', () => {
    expect(LABOR_AHOLO_SLOTS).toHaveLength(16);
    const ids = LABOR_AHOLO_SLOTS.map(slot => slot.assetId);
    expect(new Set(ids).size).toBe(16);
    expect(LABOR_AHOLO_SLOTS.every(slot => slot.ready === false)).toBe(true);
    expect(laborAholoGlbUrl('消防', 'male')).toBeNull();
    expect(laborAholoGlbUrl('警察', 'female')).toBeNull();
    const walkIds = new Set(WALK_ROLES.map(role => role.assetId));
    for (const id of ids) expect(walkIds.has(id)).toBe(false);
  });

  it('keeps 经理 and 主管 as distinct roles and slots', () => {
    expect(crowdTypeForRole('经理')).toBe('executive');
    expect(crowdTypeForRole('主管')).toBe('manager');
    expect(laborAholoSlot('经理', 'male')?.assetId).not.toBe(laborAholoSlot('主管', 'male')?.assetId);
    expect(laborAholoSlot('经理', 'female')?.role).toBe('经理');
    expect(laborAholoSlot('主管', 'female')?.role).toBe('主管');
  });

  it('parses old plans without gender and new plans with gender', () => {
    const legacy = parseWorkers([
      { id: SAMPLE_ID, role: '消防', count: 1, position: { x: 1, y: 2 }, notes: '' },
    ]);
    expect(legacy.workers[0]?.gender).toBeUndefined();

    const modern = parseWorkers([
      { id: SAMPLE_ID, role: '消防', count: 1, position: { x: 1, y: 2 }, gender: 'female', notes: '' },
    ]);
    expect(modern.workers[0]?.gender).toBe('female');
  });

  it('resolves models by role+gender without inventing missing GLBs', () => {
    const missing = resolveLaborPersonModel('消防');
    expect(missing.gender).toBe('male');
    expect(missing.source).toBe('lowpoly');
    expect(missing.glbUrl).toContain('low-poly-character-figures-firefighter-standing-8ded7b6f');

    const femaleMedic = resolveLaborPersonModel('医务人员', 'female');
    expect(femaleMedic.gender).toBe('female');
    expect(femaleMedic.source).toBe('lowpoly');
    expect(femaleMedic.glbUrl).toContain('low-poly-character-figures-medic-standing-c9e96efa');

    const police = resolveLaborPersonModel('警察', 'female');
    expect(police.source).toBe('fallback');
    expect(police.glbUrl).toBeNull();
    expect(police.assetId).toBe(laborAholoSlot('警察', 'female')?.assetId);

    const pin = resolveLaborPersonModel('自定义点', 'female');
    expect(pin.source).toBe('none');
    expect(pin.gender).toBeNull();
    expect(pin.glbUrl).toBeNull();
  });

  it('does not replace or remove hanfu walk roles', () => {
    expect(WALK_ROLES.map(role => role.name)).toEqual(expect.arrayContaining([
      '唐女', '唐男', '宋女', '宋男', '明女', '明男',
    ]));
    expect(WALK_ROLES.filter(role => ['唐女', '唐男', '宋女', '宋男', '明女', '明男'].includes(role.name)).every(role => role.walkable)).toBe(true);
  });
});
