import { describe, expect, it } from 'vitest';
import { PLAN_PROP_SIZE, planPropKind, type PlanPropKind } from './plan-footprint-geometry';
import {
  FACILITY_KIND_LABELS,
  LEGACY_FACILITY_TEMPLATE_KINDS,
  facilityKindOfTemplate,
  facilityTypeLabel,
  resolveFacilityTemplate,
} from './plan-facility-catalog';
import { PLAN_FACILITY_TEMPLATES } from './site-plan-facilities';

const KINDS = Object.keys(PLAN_PROP_SIZE) as PlanPropKind[];

describe('plan-facility-catalog（2026-11-11 目录合并）', () => {
  it('旧内置模板仍是可解析的别名，名字/尺寸保持历史口径', () => {
    const tent = resolveFacilityTemplate('tent-3x3');
    expect(tent).toMatchObject({ templateId: 'tent-3x3', name: '后勤帐篷', width: 3, depth: 3 });
    // 医疗帐篷是 4×3，不能因为共用「帐篷」类型被压成 3×3。
    const medical = resolveFacilityTemplate('medical-tent-4x3');
    expect(medical).toMatchObject({ name: '医疗帐篷', width: 4, depth: 3 });
  });

  it('每个内置模板 id 都能在别名表里找到同一个 3D 物件类型', () => {
    for (const template of PLAN_FACILITY_TEMPLATES) {
      expect(LEGACY_FACILITY_TEMPLATE_KINDS[template.templateId]).toBeDefined();
      expect(facilityKindOfTemplate(template.templateId)).toBe(LEGACY_FACILITY_TEMPLATE_KINDS[template.templateId]);
      expect(facilityTypeLabel(template.templateId)).toBe(template.name);
    }
  });

  it('oneplan: 条目按 slug 落到同一物件类型，并用统一尺寸表', () => {
    const tent = resolveFacilityTemplate('oneplan:icon:tent');
    expect(tent).toMatchObject({ name: FACILITY_KIND_LABELS.tent, width: 3, depth: 3, note: 'icon:tent' });
    const trailer = resolveFacilityTemplate('oneplan:scale:food-trailer');
    expect(trailer).toMatchObject({ name: FACILITY_KIND_LABELS.foodTruck, width: 6, depth: 2.5 });
    const toilet = resolveFacilityTemplate('oneplan:scale:portable-toilet');
    expect(facilityKindOfTemplate('oneplan:scale:portable-toilet')).toBe('toilet');
    expect(toilet).toMatchObject({ name: FACILITY_KIND_LABELS.toilet, width: 1.2, depth: 1.2 });
    expect(facilityKindOfTemplate('oneplan:icon:security-checkpoint')).toBe('post');
  });

  it('清单/图例不再漏出原始 oneplan id，未知 id 原样返回', () => {
    expect(facilityTypeLabel('oneplan:icon:tent')).toBe('帐篷');
    expect(facilityTypeLabel('vendor-custom-3x3')).toBe('vendor-custom-3x3');
    expect(resolveFacilityTemplate('vendor-custom-3x3')).toBeNull();
  });

  it('尺寸表与 3D 物件类型一一对应，且没有 0 尺寸', () => {
    for (const kind of KINDS) {
      expect(PLAN_PROP_SIZE[kind].width).toBeGreaterThan(0);
      expect(PLAN_PROP_SIZE[kind].depth).toBeGreaterThan(0);
      expect(planPropKind(`oneplan:icon:${kind}`)).toBeTruthy();
    }
  });
});