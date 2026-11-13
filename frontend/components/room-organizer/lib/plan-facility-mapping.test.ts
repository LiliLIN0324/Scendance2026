import { describe, expect, it } from 'vitest';
import { isOneplanPlaceableTemplateId } from '../../../../supabase/functions/_shared/oneplan-whitelist';
import { findFacilityTemplate } from './site-plan-facilities';
import {
  BUILTIN_TEMPLATE,
  ONEPLAN_TEMPLATE,
  resolveFacilityTarget,
} from './plan-facility-mapping';

describe('plan-facility-mapping（室内类型 → plan 设施模板落点）', () => {
  it('内置语义对齐内置 8 模板：厕位 / 舞台幕布', () => {
    expect(resolveFacilityTarget('toilet')).toEqual({ kind: 'builtin', templateId: 'toilet-2.4x1.2' });
    expect(resolveFacilityTarget('backdrop')).toEqual({ kind: 'builtin', templateId: 'stage-platform-8x6' });
  });

  it('能对上户外语义的类型落到 oneplan 白名单条目', () => {
    expect(resolveFacilityTarget('chair')).toEqual({ kind: 'oneplan', templateId: 'oneplan:scale:chair' });
    expect(resolveFacilityTarget('sofa')).toEqual({ kind: 'oneplan', templateId: 'oneplan:scale:sofa' });
    expect(resolveFacilityTarget('plant')).toEqual({ kind: 'oneplan', templateId: 'oneplan:icon:plant' });
    expect(resolveFacilityTarget('cctv')).toEqual({ kind: 'oneplan', templateId: 'oneplan:icon:cctv-camera' });
    expect(resolveFacilityTarget('stairs')).toEqual({ kind: 'oneplan', templateId: 'oneplan:scale:stairs' });
    expect(resolveFacilityTarget('pool')).toEqual({ kind: 'oneplan', templateId: 'oneplan:icon:water-pool' });
  });

  it('墙体 / 隔断 / 门窗 / 人员不进 facility，进 skip 并带原因', () => {
    for (const type of ['partition', 'fence', 'door', 'window']) {
      const target = resolveFacilityTarget(type);
      expect(target.kind).toBe('skip');
      if (target.kind === 'skip') expect(target.reason).toContain('walls');
    }
    expect(resolveFacilityTarget('person')).toEqual({ kind: 'skip', reason: expect.stringContaining('workers') });
  });

  it('纯室内家居 / 装饰与未知 legacy 类型回落 misc 占位', () => {
    for (const type of ['bed', 'wardrobe', 'rug', 'painting', 'vase', 'curtains', 'unknown-legacy-thing']) {
      expect(resolveFacilityTarget(type)).toEqual({ kind: 'misc' });
    }
  });

  it('守卫：内置映射全部命中内置模板目录，oneplan 映射全部命中可放置白名单', () => {
    for (const templateId of Object.values(BUILTIN_TEMPLATE)) {
      expect(findFacilityTemplate(templateId)).not.toBeNull();
    }
    for (const templateId of Object.values(ONEPLAN_TEMPLATE)) {
      expect(isOneplanPlaceableTemplateId(templateId)).toBe(true);
    }
  });
});
